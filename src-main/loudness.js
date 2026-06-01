/**
 * loudness.js — analyze audio loudness using FFmpeg's ebur128 filter.
 *
 * Why: common festival rejection reason is audio that's mastered way too
 * quiet or too hot. Fulldome target is typically around -23 LUFS (the
 * broadcast standard, EBU R 128). We warn if the integrated loudness is
 * more than 4 LU off target.
 *
 * Uses the `loudnorm` filter in "analyze" mode (first pass), which outputs
 * a JSON block to stderr we can parse.
 */

const { spawn } = require('child_process');

/**
 * Run FFmpeg loudnorm analysis on an audio file.
 *
 * @param {string} ffmpegPath
 * @param {string} audioPath
 * @returns {Promise<object>} { integratedLufs, truePeakDbtp, range, ok } or { error }
 */
function analyzeLoudness(ffmpegPath, audioPath) {
  return new Promise(resolve => {
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
      // The JSON block in stderr looks like:
      //   [Parsed_loudnorm_0 @ 0x...] {
      //       "input_i" : "-18.30",
      //       "input_tp" : "-0.30",
      //       ...
      //   }
      const jsonMatch = stderr.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
      if (!jsonMatch) {
        return resolve({ error: 'Could not parse loudnorm output' });
      }
      try {
        const data = JSON.parse(jsonMatch[0]);
        const integratedLufs = parseFloat(data.input_i);
        const truePeakDbtp = parseFloat(data.input_tp);
        const range = parseFloat(data.input_lra);
        resolve({
          integratedLufs,
          truePeakDbtp,
          range,
          target: -23.0,
          ok: true,
        });
      } catch (err) {
        resolve({ error: 'JSON parse failed: ' + err.message });
      }
    });
  });
}

/**
 * Pure classification — given a loudness measurement, decide if it's
 * within festival tolerance and produce a UI-ready message.
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

module.exports = { analyzeLoudness, classifyLoudness };
