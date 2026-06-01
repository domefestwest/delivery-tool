/**
 * ffmpeg-capabilities.js — runtime FFmpeg binary capability detection.
 * No platform-specific code lives here — pass in the binary path,
 * get back capability data.
 */

const { spawn } = require('child_process');

/**
 * Spawn a process with a timeout. Captures both stdout and stderr.
 * Returns { code, stdout, stderr } on success, throws on timeout/error.
 *
 * Used for short-lived ffmpeg/ffprobe queries (-version, -encoders, etc.).
 * NOT used for the long-running encode process — that uses spawn() directly
 * with progress event handling.
 */
function runWithTimeout(bin, args, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timer = null;
    let proc;
    try {
      proc = spawn(bin, args);
    } catch (err) {
      return reject(err);
    }
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    timer = setTimeout(() => {
      try { proc.kill(); } catch (_) {}
      reject(new Error(`Timeout after ${timeoutMs}ms running ${bin}`));
    }, timeoutMs);
  });
}

/**
 * Check what a given FFmpeg binary can do. Runs three short queries:
 *   ffmpeg -version          → version string
 *   ffmpeg -encoders         → libx265 availability
 *   ffmpeg -h encoder=libx265 → 10-bit support
 *
 * Returns { version, hasX265, has10Bit }.
 * Throws if the binary can't be executed at all.
 */
async function checkFFmpegCapabilities(ffmpegBin) {
  // Version
  const versionResult = await runWithTimeout(ffmpegBin, ['-version']);
  const versionCombined = versionResult.stdout + versionResult.stderr;
  const versionMatch = versionCombined.match(/ffmpeg version ([^\s]+)/);
  const version = versionMatch ? versionMatch[1] : 'unknown';

  // x265 encoder presence
  const encodersResult = await runWithTimeout(ffmpegBin, ['-encoders']);
  const encoderOutput = encodersResult.stdout + encodersResult.stderr;
  const hasX265 = /libx265/.test(encoderOutput);

  // 10-bit support (only check if x265 is present, otherwise meaningless)
  let has10Bit = false;
  if (hasX265) {
    const detailResult = await runWithTimeout(ffmpegBin, ['-h', 'encoder=libx265']);
    const detailOutput = detailResult.stdout + detailResult.stderr;
    // libx265 with main10 profile output is the marker we need
    has10Bit = /yuv420p10le|10.?bit|10bit|main10/i.test(detailOutput);
  }

  return { version, hasX265, has10Bit };
}

module.exports = {
  runWithTimeout,
  checkFFmpegCapabilities,
};
