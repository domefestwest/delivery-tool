/**
 * dependency-check.js — orchestrates the full FFmpeg dependency check.
 *
 * Algorithm:
 *   1. Check bundled binary → if it has 10-bit libx265, use it
 *   2. Else fall back to system PATH ffmpeg → if 10-bit, use it (with soft warning)
 *   3. Else if system ffmpeg found but lacks 10-bit, return capability-fail result
 *   4. Else return "not found" — onboarding screen will show
 *   5. Always probe GPU encoders at the end (non-fatal if it errors)
 *
 * Pure orchestration logic, all I/O goes through ffmpeg-capabilities and gpu-detection.
 */

const fs = require('fs');
const path = require('path');

const platform = require('./platform');
const { checkFFmpegCapabilities } = require('./ffmpeg-capabilities');
const { detectGPUEncoder } = require('./gpu-detection');

const SYSTEM_FALLBACK_WARNING =
  'Using system FFmpeg. For best results, reinstall this app to restore the bundled version.';

const NO_10BIT_WARNING =
  'FFmpeg was found, but this version does not support 10-bit H.265 encoding, ' +
  'which is required for dome delivery. Please install a full FFmpeg build that includes libx265.';

/**
 * Run the full dependency check.
 *
 * @param {object} opts
 * @param {string} opts.bundledPath    — absolute path where bundled ffmpeg should live
 * @param {string} [opts.platformStr]  — for testing; defaults to process.platform
 * @param {Function} [opts.log]        — console.log injection
 * @returns {Promise<object>} dep result with shape:
 *   { found, path, ffprobePath, version, has10BitX265, source, warning, gpu }
 */
async function runDependencyCheck({ bundledPath, platformStr = process.platform, log = console.log }) {
  log('[DependencyCheck] Starting dependency check…');
  log(`[DependencyCheck] Bundled FFmpeg path: ${bundledPath}`);

  let depResult = null;

  // ── Step 1: bundled binary ──────────────────────────────────────────────────
  if (fs.existsSync(bundledPath)) {
    log('[DependencyCheck] Bundled binary found. Checking capabilities…');
    if (platform.needsExecutableBit(platformStr)) {
      try { fs.chmodSync(bundledPath, 0o755); } catch (_) {}
    }
    try {
      const caps = await checkFFmpegCapabilities(bundledPath);
      log('[DependencyCheck] Bundled result: ' + JSON.stringify(caps));
      if (caps.hasX265 && caps.has10Bit) {
        const ffprobePath = platform.getFFprobePath(bundledPath, platformStr);
        if (platform.needsExecutableBit(platformStr) && fs.existsSync(ffprobePath)) {
          try { fs.chmodSync(ffprobePath, 0o755); } catch (_) {}
        }
        depResult = {
          found: true,
          path: bundledPath,
          ffprobePath: fs.existsSync(ffprobePath) ? ffprobePath : null,
          version: caps.version,
          has10BitX265: true,
          source: 'bundled',
          warning: null,
        };
      }
    } catch (err) {
      log(`[DependencyCheck] Bundled binary failed: ${err.message}`);
    }
  } else {
    log(`[DependencyCheck] Bundled binary not found at: ${bundledPath}`);
  }

  // ── Step 2: system fallback ─────────────────────────────────────────────────
  if (!depResult) {
    log('[DependencyCheck] Trying system FFmpeg…');
    const systemBin = platform.isWin(platformStr) ? 'ffmpeg.exe' : 'ffmpeg';
    try {
      const caps = await checkFFmpegCapabilities(systemBin);
      log('[DependencyCheck] System FFmpeg result: ' + JSON.stringify(caps));
      if (caps.hasX265 && caps.has10Bit) {
        const systemFFprobe = platform.isWin(platformStr) ? 'ffprobe.exe' : 'ffprobe';
        depResult = {
          found: true,
          path: systemBin,
          ffprobePath: systemFFprobe,
          version: caps.version,
          has10BitX265: true,
          source: 'system',
          warning: SYSTEM_FALLBACK_WARNING,
        };
      } else if (caps.version !== 'unknown') {
        // Found but lacking 10-bit — short-circuit, no GPU probe needed
        return {
          found: true,
          path: systemBin,
          ffprobePath: null,
          version: caps.version,
          has10BitX265: false,
          source: 'system',
          warning: NO_10BIT_WARNING,
          gpu: null,
        };
      }
    } catch (err) {
      log(`[DependencyCheck] System FFmpeg not found: ${err.message}`);
    }
  }

  // ── Step 3: nothing works ───────────────────────────────────────────────────
  if (!depResult) {
    log('[DependencyCheck] No working FFmpeg found.');
    return {
      found: false,
      path: null,
      ffprobePath: null,
      version: null,
      has10BitX265: false,
      source: null,
      warning: null,
      gpu: null,
    };
  }

  // ── Step 4: GPU probe (non-fatal) ───────────────────────────────────────────
  log('[DependencyCheck] Probing GPU encoders…');
  let gpu = null;
  try {
    gpu = await detectGPUEncoder({
      bundledFFmpegPath: depResult.path,
      platformStr,
      log,
    });
  } catch (err) {
    log(`[DependencyCheck] GPU detection error (non-fatal): ${err.message}`);
  }

  return {
    ...depResult,
    gpu: gpu
      ? {
          available: true,
          name: gpu.name,
          label: gpu.label,
          ffmpegPath: gpu.ffmpegPath,
          pixFmt: gpu.pixFmt,
          profile: gpu.profile,
          qualityArgs: gpu.qualityArgs,
          extraArgs: gpu.extraArgs,
        }
      : {
          available: false,
          label: 'CPU libx265 (no GPU encoder detected)',
        },
  };
}

module.exports = {
  runDependencyCheck,
  SYSTEM_FALLBACK_WARNING,
  NO_10BIT_WARNING,
};
