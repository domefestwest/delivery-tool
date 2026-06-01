/**
 * output-verification.js — verify the encoded output matches what we asked for.
 *
 * Critical safety net for GPU encoders: some have edge-case bugs where
 * they silently produce 8-bit output despite being told to produce 10-bit,
 * or downscale resolution if asked for something unusual.
 *
 * This module probes the actual output file via ffprobe and compares
 * against the expected spec. Pure verification function + IPC-friendly
 * runner.
 */

const { runWithTimeout } = require('./ffmpeg-capabilities');

/**
 * Run ffprobe on the output file and return parsed video info.
 */
async function probeOutput(ffprobePath, outputPath) {
  const r = await runWithTimeout(ffprobePath, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,pix_fmt,width,height,r_frame_rate,profile,nb_frames',
    '-show_entries', 'format=duration',
    '-of', 'json',
    outputPath,
  ], 15000);
  const data = JSON.parse(r.stdout || '{}');
  const v = data.streams?.[0];
  if (!v) return null;
  let fps = null;
  if (v.r_frame_rate) {
    const [n, d] = v.r_frame_rate.split('/').map(Number);
    fps = d ? n / d : n;
  }
  return {
    codec: v.codec_name,
    pixFmt: v.pix_fmt,
    width: v.width,
    height: v.height,
    fps: fps ? Math.round(fps * 100) / 100 : null,
    profile: v.profile,
    duration: parseFloat(data.format?.duration) || null,
  };
}

/**
 * Pure comparison function — given probe data and expected spec, return issues.
 *
 * @param {object} probe — output of probeOutput()
 * @param {object} expected — { codec, pixFmt, width, height, frameRate, durationSeconds }
 * @returns {object} { ok: bool, issues: [{ field, expected, actual, severity }] }
 */
function verifyOutput(probe, expected) {
  if (!probe) {
    return { ok: false, issues: [{ field: 'probe', expected: 'readable', actual: 'failed', severity: 'error' }] };
  }

  const issues = [];

  // Codec — must be hevc
  if (probe.codec !== expected.codec) {
    issues.push({
      field: 'codec', expected: expected.codec, actual: probe.codec,
      severity: 'error',
    });
  }

  // Pixel format — must be 10-bit
  // Accept yuv420p10le directly, or anything containing 10le (covers some GPU variants)
  const is10bit = /10le|10be/.test(probe.pixFmt || '');
  if (!is10bit) {
    issues.push({
      field: 'pix_fmt', expected: '10-bit (yuv420p10le)', actual: probe.pixFmt,
      severity: 'error',
    });
  } else if (probe.pixFmt !== expected.pixFmt) {
    // Different 10-bit variant — note but don't error (still 10-bit)
    issues.push({
      field: 'pix_fmt', expected: expected.pixFmt, actual: probe.pixFmt,
      severity: 'info',
    });
  }

  // Resolution — must match exactly (we don't resize)
  if (probe.width !== expected.width || probe.height !== expected.height) {
    issues.push({
      field: 'resolution',
      expected: `${expected.width}×${expected.height}`,
      actual: `${probe.width}×${probe.height}`,
      severity: 'error',
    });
  }

  // Frame rate — must be EXACT 30 or 60 (no drop-frame, no PAL)
  // Tight tolerance: anything more than 0.01 off counts as wrong.
  // 29.97 vs 30 = 0.03 drift, would be flagged here. Good.
  if (probe.fps && Math.abs(probe.fps - expected.frameRate) > 0.01) {
    issues.push({
      field: 'fps', expected: `${expected.frameRate}fps`, actual: `${probe.fps}fps`,
      severity: 'error',
    });
  }

  // Duration — should be within 1% of expected (for video sources)
  if (expected.durationSeconds && probe.duration) {
    const drift = Math.abs(probe.duration - expected.durationSeconds) / expected.durationSeconds;
    if (drift > 0.01) {
      issues.push({
        field: 'duration',
        expected: `${expected.durationSeconds.toFixed(2)}s`,
        actual: `${probe.duration.toFixed(2)}s`,
        severity: 'warning',
      });
    }
  }

  const errors = issues.filter(i => i.severity === 'error');
  return {
    ok: errors.length === 0,
    issues,
    summary: errors.length === 0
      ? `✓ Output matches spec (${probe.codec}, ${probe.pixFmt}, ${probe.width}×${probe.height}, ${probe.fps}fps)`
      : `✕ Output verification failed (${errors.length} error${errors.length > 1 ? 's' : ''})`,
  };
}

/**
 * One-shot helper: probe + verify in one call.
 */
async function probeAndVerify(ffprobePath, outputPath, expected) {
  try {
    const probe = await probeOutput(ffprobePath, outputPath);
    return { probe, ...verifyOutput(probe, expected) };
  } catch (err) {
    return {
      probe: null, ok: false,
      issues: [{ field: 'probe', expected: 'success', actual: err.message, severity: 'error' }],
      summary: '✕ Could not probe output file',
    };
  }
}

module.exports = { probeOutput, verifyOutput, probeAndVerify };
