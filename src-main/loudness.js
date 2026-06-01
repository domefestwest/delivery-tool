/**
 * loudness.js — analyze audio loudness using FFmpeg's loudnorm filter.
 *
 * Why: a common festival rejection reason is audio mastered way too quiet
 * or too hot. Fulldome target is typically around -23 LUFS (the broadcast
 * standard, EBU R 128). We warn if the integrated loudness is more than
 * 4 LU off target, or if true peak goes above -1 dBTP (clipping risk).
 *
 * IMPORTANT: this module operates on a single source file. The CALLER is
 * responsible for passing the correct file:
 *   - If audio was muxed into the video: pass the muxed .mp4
 *   - If a 5.1 interleaved WAV was the source: pass that WAV
 *   - If 6 stems were delivered: pass a temporary downmix (see buildMixForAnalysis)
 *   - Stereo: either channel by itself is not the mix — use a merged file
 *
 * Passing a single stem produces meaningless numbers (you'd be measuring just
 * LFE or just L channel). The earlier implementation had this bug.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Build a temporary mixed audio file by amerging multiple stems into one
 * file with the correct channel layout. Returns the temp file path.
 *
 * Caller must clean up the temp file when done.
 *
 * @param {object} opts
 * @param {string} opts.ffmpegPath
 * @param {string[]} opts.stemPaths — in canonical 5.1 order [L,R,C,LFE,Ls,Rs] OR [L,R] for stereo
 * @returns {Promise<string|null>} path to the merged file
 */
async function buildMixForAnalysis({ ffmpegPath, stemPaths }) {
  if (!stemPaths || stemPaths.length === 0) return null;
  if (stemPaths.length === 1) return stemPaths[0];     // single file IS the mix

  const layoutMap = {
    2: 'stereo',
    6: '5.1',
  };
  const layout = layoutMap[stemPaths.length];
  if (!layout) return null; // 3/4/5 stems is an unsupported config; skip analysis

  const tempPath = path.join(os.tmpdir(),
    `dfw_mix_for_analysis_${process.pid}_${Date.now()}.wav`);

  const args = ['-y'];
  for (const p of stemPaths) {
    args.push('-i', p);
  }
  // amerge combines N mono/stereo files into one multichannel file
  const inputsRef = stemPaths.map((_, i) => `[${i}:a]`).join('');
  args.push('-filter_complex',
    `${inputsRef}amerge=inputs=${stemPaths.length}[aout]`);
  args.push('-map', '[aout]');
  args.push('-ar', '48000');
  args.push('-c:a', 'pcm_s24le');
  args.push(tempPath);

  return new Promise(resolve => {
    let stderr = '';
    const proc = spawn(ffmpegPath, args);
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('error', () => resolve(null));
    proc.on('close', code => {
      if (code !== 0 || !fs.existsSync(tempPath)) {
        console.warn('[loudness] buildMixForAnalysis failed:', stderr.slice(-200));
        return resolve(null);
      }
      resolve(tempPath);
    });
  });
}

/**
 * Run FFmpeg's loudnorm filter in analyze mode on a single file.
 * Returns measurement object or { error }.
 */
function analyzeLoudness(ffmpegPath, audioPath) {
  return new Promise(resolve => {
    if (!audioPath || !fs.existsSync(audioPath)) {
      return resolve({ error: `Audio file not found: ${audioPath}` });
    }

    let stderr = '';
    const proc = spawn(ffmpegPath, [
      '-i', audioPath,
      '-af', 'loudnorm=I=-23:LRA=7:TP=-2:print_format=json',
      '-f', 'null', '-',
    ]);
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('error', err => resolve({ error: err.message }));
    proc.on('close', code => {
      if (code !== 0 && !stderr.includes('Parsed_loudnorm')) {
        return resolve({ error: `FFmpeg exited ${code}` });
      }
      const jsonMatch = stderr.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
      if (!jsonMatch) {
        return resolve({ error: 'Could not parse loudnorm output' });
      }
      try {
        const data = JSON.parse(jsonMatch[0]);
        resolve({
          integratedLufs: parseFloat(data.input_i),
          truePeakDbtp:   parseFloat(data.input_tp),
          range:          parseFloat(data.input_lra),
          target:         -23.0,
          ok:             true,
        });
      } catch (err) {
        resolve({ error: 'JSON parse failed: ' + err.message });
      }
    });
  });
}

/**
 * High-level helper: pick the correct source and analyze it.
 * Returns { measurement, classification, analyzedFile, sourceDescription }.
 *
 * Priority order:
 *   1. Muxed video output (if mux was performed) — most representative
 *   2. Interleaved WAV source (the actual mix file the artist delivered)
 *   3. amerge of stems (proper multichannel mix from individual files)
 *
 * @param {object} opts
 * @param {string} opts.ffmpegPath
 * @param {string} [opts.muxedVideoPath] — set only if the video has embedded audio
 * @param {string} [opts.interleavedSourcePath] — set only if user picked interleaved mode
 * @param {string[]} [opts.stemPaths] — full canonical-order stem paths from audioResult.stems
 * @param {number} [opts.targetLufs] — default -23
 */
async function analyzeMix({
  ffmpegPath, muxedVideoPath, interleavedSourcePath, stemPaths, targetLufs = -23.0,
}) {
  let analyzedFile = null;
  let sourceDescription = '';
  let tempToCleanup = null;

  if (muxedVideoPath && fs.existsSync(muxedVideoPath)) {
    analyzedFile = muxedVideoPath;
    sourceDescription = 'muxed video track';
  } else if (interleavedSourcePath && fs.existsSync(interleavedSourcePath)) {
    analyzedFile = interleavedSourcePath;
    sourceDescription = 'source interleaved WAV';
  } else if (stemPaths && stemPaths.length > 0) {
    if (stemPaths.length === 1) {
      analyzedFile = stemPaths[0];
      sourceDescription = 'single stem';
    } else {
      const mixed = await buildMixForAnalysis({ ffmpegPath, stemPaths });
      if (mixed) {
        analyzedFile = mixed;
        tempToCleanup = mixed === stemPaths[0] ? null : mixed;
        sourceDescription = stemPaths.length === 6
          ? '5.1 mix (amerged from 6 stems)'
          : `${stemPaths.length}-channel mix (amerged)`;
      }
    }
  }

  if (!analyzedFile) {
    return {
      measurement: { error: 'No suitable audio source for loudness analysis' },
      classification: { severity: 'unknown', message: 'Loudness analysis unavailable.' },
      analyzedFile: null,
      sourceDescription: 'no audio source',
    };
  }

  const measurement = await analyzeLoudness(ffmpegPath, analyzedFile);

  // Clean up temp mix file
  if (tempToCleanup && fs.existsSync(tempToCleanup)) {
    try { fs.unlinkSync(tempToCleanup); } catch (_) {}
  }

  return {
    measurement,
    classification: classifyLoudness(measurement, targetLufs),
    analyzedFile,
    sourceDescription,
  };
}

/**
 * Pure classification — given a measurement, produce a UI-ready verdict.
 */
function classifyLoudness(measurement, targetLufs = -23.0) {
  if (!measurement || measurement.error || measurement.integratedLufs == null) {
    return { severity: 'unknown', message: 'Loudness analysis unavailable.' };
  }
  const { integratedLufs, truePeakDbtp } = measurement;
  const diff = integratedLufs - targetLufs;
  const absDiff = Math.abs(diff);

  // True peak clipping check (above -1 dBTP is risky)
  if (truePeakDbtp > -1.0) {
    return {
      severity: 'error',
      lufs: integratedLufs, peak: truePeakDbtp,
      message: `Audio is clipping (true peak ${truePeakDbtp.toFixed(1)} dBTP). ` +
               `Reduce master output level by ${(truePeakDbtp + 2).toFixed(1)} dB minimum.`,
    };
  }

  if (absDiff <= 2.0) {
    return {
      severity: 'ok',
      lufs: integratedLufs, peak: truePeakDbtp,
      message: `Audio loudness ${integratedLufs.toFixed(1)} LUFS — within ${targetLufs} LUFS target.`,
    };
  }

  if (absDiff <= 4.0) {
    return {
      severity: 'warning',
      lufs: integratedLufs, peak: truePeakDbtp,
      message: `Audio loudness ${integratedLufs.toFixed(1)} LUFS — ${diff > 0 ? 'louder' : 'quieter'} than ` +
               `${targetLufs} LUFS target by ${absDiff.toFixed(1)} dB. May still be acceptable.`,
    };
  }

  return {
    severity: 'error',
    lufs: integratedLufs, peak: truePeakDbtp,
    message: `Audio loudness ${integratedLufs.toFixed(1)} LUFS is ${absDiff.toFixed(1)} dB ` +
             `${diff > 0 ? 'above' : 'below'} the ${targetLufs} LUFS target. ` +
             `Festivals will likely require remastering.`,
  };
}

module.exports = {
  analyzeLoudness,
  classifyLoudness,
  analyzeMix,
  buildMixForAnalysis,
};
