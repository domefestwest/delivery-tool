/**
 * audio-processor.js — handles all audio side-effects for an encode:
 *   - Stems mode: normalize each WAV to 44.1kHz/24-bit PCM
 *   - Interleaved mode: detect 5.1 vs stereo, split via channelsplit
 *   - None mode: write README.txt placeholder
 *   - Mux: if requested, embed audio into video using temp-replace strategy
 *
 * Pure-ish: takes ffmpegPath + ffprobePath as args, all I/O explicit.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { runWithTimeout } = require('./ffmpeg-capabilities');
const { computeMd5 } = require('./utils');
const {
  buildSplitStemsArgs,
  buildMuxArgs,
  buildStemNormalizeArgs,
} = require('./encode-args');

function spawnAndWait(bin, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => resolve({ code, stderr }));
    proc.on('error', reject);
  });
}

/**
 * Process audio for a delivery package.
 *
 * @param {object} req
 * @param {string} req.audioMode         — 'stems' | 'interleaved' | 'none'
 * @param {Array}  [req.audioFiles]      — for 'stems': [{ channel, filePath }, ...]
 * @param {string} [req.audioInterleaved] — for 'interleaved': path to multi-channel WAV
 * @param {string} req.audioFolder       — destination audio/ folder
 * @param {string} req.filmTitle         — sanitized film title (for stem filenames)
 * @param {boolean} req.muxAudio         — whether to embed audio in video
 * @param {string} req.outputVideoPath   — for mux: target video file
 * @param {string} req.ffmpegPath        — bundled ffmpeg
 * @param {string} req.ffprobePath       — bundled ffprobe
 * @returns {Promise<object>} { mode, stems, warnings, muxReplaced }
 */
async function processAudio(req) {
  const {
    audioMode, audioFiles, audioInterleaved, audioFolder,
    filmTitle, muxAudio, outputVideoPath, ffmpegPath, ffprobePath,
    onPhase,  // optional callback: ({step, total, label}) for UI progress
  } = req;
  const emit = (info) => { try { if (typeof onPhase === 'function') onPhase(info); } catch (_) {} };

  const warnings = [];

  // ── None: just write README ──────────────────────────────────────────────
  if (audioMode === 'none') {
    const readmePath = path.join(audioFolder, 'README.txt');
    fs.writeFileSync(readmePath, 'No audio delivered with this submission.\n', 'utf8');
    return { mode: 'none', stems: [], warnings, muxReplaced: false };
  }

  const stems = [];

  // ── Stems mode ───────────────────────────────────────────────────────────
  if (audioMode === 'stems') {
    const total = (audioFiles || []).length;
    let i = 0;
    for (const { channel, filePath } of (audioFiles || [])) {
      i++;
      emit({ step: i, total, label: `Normalizing audio stem ${channel} (${i}/${total})` });
      const destName = `${filmTitle}_${channel}.wav`;
      const destPath = path.join(audioFolder, destName);
      await spawnAndWait(ffmpegPath,
        buildStemNormalizeArgs({ inputPath: filePath, outputPath: destPath }));
      emit({ step: i, total, label: `Hashing audio stem ${channel} (${i}/${total})` });
      const md5 = await computeMd5(destPath).catch(() => null);
      stems.push({ channel, path: destPath, filename: destName, md5 });
    }
  }

  // ── Interleaved mode ─────────────────────────────────────────────────────
  if (audioMode === 'interleaved' && audioInterleaved) {
    // Probe channel count first
    const probeResult = await runWithTimeout(ffprobePath, [
      '-v', 'error', '-select_streams', 'a:0',
      '-show_entries', 'stream=channels',
      '-of', 'default', audioInterleaved,
    ], 8000).catch(() => ({ stdout: '', stderr: '' }));
    const is6ch = /channels=6/.test(probeResult.stdout + probeResult.stderr);

    if (is6ch) {
      const channelOrder = ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'];
      const stemPaths = {};
      for (const ch of channelOrder) {
        stemPaths[ch] = path.join(audioFolder, `${filmTitle}_${ch}.wav`);
      }
      emit({ step: 0, total: channelOrder.length, label: 'Splitting 5.1 interleaved into stems' });
      await spawnAndWait(ffmpegPath,
        buildSplitStemsArgs({ inputPath: audioInterleaved, stemPaths }));

      let i = 0;
      for (const ch of channelOrder) {
        i++;
        emit({ step: i, total: channelOrder.length, label: `Hashing audio stem ${ch} (${i}/${channelOrder.length})` });
        const destPath = stemPaths[ch];
        const md5 = await computeMd5(destPath).catch(() => null);
        stems.push({
          channel: ch, path: destPath,
          filename: path.basename(destPath), md5,
        });
      }
    } else {
      // Stereo
      emit({ step: 1, total: 1, label: 'Normalizing stereo audio' });
      const destName = `${filmTitle}_Stereo.wav`;
      const destPath = path.join(audioFolder, destName);
      await spawnAndWait(ffmpegPath,
        buildStemNormalizeArgs({ inputPath: audioInterleaved, outputPath: destPath }));
      emit({ step: 1, total: 1, label: 'Hashing stereo audio' });
      const md5 = await computeMd5(destPath).catch(() => null);
      stems.push({ channel: 'Stereo', path: destPath, filename: destName, md5 });
    }
  }

  // ── MUX into video using temp-replace strategy ───────────────────────────
  let muxReplaced = false;
  if (muxAudio && stems.length > 0) {
    const tempMuxPath = outputVideoPath + '.mux_tmp.mp4';
    const is51 = stems.length === 6;

    let muxOk = false;
    try {
      const { code } = await spawnAndWait(ffmpegPath, buildMuxArgs({
        videoPath: outputVideoPath,
        stemPaths: stems.map(s => s.path),
        outputPath: tempMuxPath,
        is51,
      }));
      muxOk = (code === 0);
    } catch (err) {
      warnings.push('MUX spawn error: ' + err.message);
    }

    if (muxOk && fs.existsSync(tempMuxPath)) {
      try {
        fs.unlinkSync(outputVideoPath);
        fs.renameSync(tempMuxPath, outputVideoPath);
        muxReplaced = true;
      } catch (err) {
        warnings.push('MUX file replace failed: ' + err.message);
      }
    } else if (fs.existsSync(tempMuxPath)) {
      try { fs.unlinkSync(tempMuxPath); } catch (_) {}
      warnings.push('MUX encode failed — delivery package contains video without embedded audio.');
    }
  }

  return { mode: audioMode, stems, warnings, muxReplaced };
}

module.exports = { processAudio };
