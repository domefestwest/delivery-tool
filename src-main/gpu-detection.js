/**
 * gpu-detection.js — GPU encoder discovery for all platforms.
 *
 * Each platform has its own table of encoder candidates, tried in priority
 * order. For each candidate we:
 *   1. Check that the encoder appears in the bundled binary's -encoders list
 *   2. Run a tiny test encode to confirm it works at runtime
 *   3. Use the first one that succeeds
 *
 * macOS quirk: VideoToolbox requires the dynamically-linked system ffmpeg
 * because static builds can't access Apple's framework entitlements.
 * Other platforms can use the bundled binary directly.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const platform = require('./platform');
const { runWithTimeout } = require('./ffmpeg-capabilities');

// ─── GPU encoder candidate tables ─────────────────────────────────────────────

// HEVC encoders — used for dome master encoding (10-bit, dome quality).
const GPU_ENCODER_CANDIDATES = {
  darwin: [
    {
      name: 'hevc_videotoolbox',
      label: 'Apple VideoToolbox (GPU)',
      pixFmt: 'p010le',
      profile: 'main10',
      extraArgs: [],
      qualityArgs: ['-q:v', '55'],          // VT quality scale 0-100; ~55 ≈ CRF 18 visually
      requiresSystemFFmpeg: true,           // static builds lack VT entitlements
    },
  ],
  win32: [
    {
      name: 'hevc_nvenc',
      label: 'NVIDIA NVENC (GPU)',
      pixFmt: 'p010le',
      profile: 'main10',
      extraArgs: ['-spatial_aq', '1', '-temporal_aq', '1'],
      qualityArgs: ['-rc', 'vbr', '-cq', '18', '-b:v', '0', '-maxrate', '0', '-preset', 'p7'],
      requiresSystemFFmpeg: false,
    },
    {
      name: 'hevc_qsv',
      label: 'Intel Quick Sync (GPU)',
      pixFmt: 'p010le',
      profile: 'main10',
      extraArgs: [],
      qualityArgs: ['-global_quality', '18', '-preset', 'veryslow'],
      requiresSystemFFmpeg: false,
    },
    {
      name: 'hevc_amf',
      label: 'AMD AMF (GPU)',
      pixFmt: 'p010le',
      profile: 'main10',
      extraArgs: [],
      qualityArgs: ['-quality', 'quality', '-qp_i', '18', '-qp_p', '20', '-qp_b', '22'],
      requiresSystemFFmpeg: false,
    },
  ],
  linux: [
    {
      name: 'hevc_nvenc',
      label: 'NVIDIA NVENC (GPU)',
      pixFmt: 'p010le',
      profile: 'main10',
      extraArgs: ['-spatial_aq', '1', '-temporal_aq', '1'],
      qualityArgs: ['-rc', 'vbr', '-cq', '18', '-b:v', '0', '-preset', 'p7'],
      requiresSystemFFmpeg: false,
    },
    {
      name: 'hevc_vaapi',
      label: 'VA-API (GPU)',
      pixFmt: 'p010le',
      profile: 'main10',
      extraArgs: ['-vaapi_device', '/dev/dri/renderD128'],
      qualityArgs: ['-rc_mode', 'CQP', '-qp', '18'],
      requiresSystemFFmpeg: false,
    },
  ],
};

// H.264 encoders — used for screener encoding (8-bit, jury review quality).
// Quality params target roughly CRF 28 — fast, smaller files, acceptable
// for jury review on laptops.
const GPU_H264_ENCODER_CANDIDATES = {
  darwin: [
    {
      name: 'h264_videotoolbox',
      label: 'Apple VideoToolbox H.264 (GPU)',
      pixFmt: 'yuv420p',
      profile: 'high',
      extraArgs: [],
      qualityArgs: ['-q:v', '55'],
      requiresSystemFFmpeg: true,
    },
  ],
  win32: [
    {
      name: 'h264_nvenc',
      label: 'NVIDIA NVENC H.264 (GPU)',
      pixFmt: 'yuv420p',
      profile: 'high',
      extraArgs: ['-spatial_aq', '1'],
      qualityArgs: ['-rc', 'vbr', '-cq', '28', '-preset', 'p5'],
      requiresSystemFFmpeg: false,
    },
    {
      name: 'h264_qsv',
      label: 'Intel Quick Sync H.264 (GPU)',
      pixFmt: 'yuv420p',
      profile: 'high',
      extraArgs: [],
      qualityArgs: ['-global_quality', '28', '-preset', 'medium'],
      requiresSystemFFmpeg: false,
    },
    {
      name: 'h264_amf',
      label: 'AMD AMF H.264 (GPU)',
      pixFmt: 'yuv420p',
      profile: 'high',
      extraArgs: [],
      qualityArgs: ['-quality', 'balanced', '-qp_i', '24', '-qp_p', '26', '-qp_b', '28'],
      requiresSystemFFmpeg: false,
    },
  ],
  linux: [
    {
      name: 'h264_nvenc',
      label: 'NVIDIA NVENC H.264 (GPU)',
      pixFmt: 'yuv420p',
      profile: 'high',
      extraArgs: ['-spatial_aq', '1'],
      qualityArgs: ['-rc', 'vbr', '-cq', '28', '-preset', 'p5'],
      requiresSystemFFmpeg: false,
    },
    {
      name: 'h264_vaapi',
      label: 'VA-API H.264 (GPU)',
      pixFmt: 'yuv420p',
      profile: 'high',
      extraArgs: ['-vaapi_device', '/dev/dri/renderD128'],
      qualityArgs: ['-rc_mode', 'CQP', '-qp', '24'],
      requiresSystemFFmpeg: false,
    },
  ],
};

/**
 * Returns the candidate list for a given platform and codec.
 * Codec defaults to 'hevc' for backward compatibility.
 * Platform falls back to linux for anything not mac/win.
 */
function getCandidates(platformStr = process.platform, codec = 'hevc') {
  const tables = codec === 'h264' ? GPU_H264_ENCODER_CANDIDATES : GPU_ENCODER_CANDIDATES;
  if (platform.isMac(platformStr))   return tables.darwin;
  if (platform.isWin(platformStr))   return tables.win32;
  return tables.linux;
}

// ─── System ffmpeg discovery (for macOS VideoToolbox) ─────────────────────────

/**
 * Locate a system ffmpeg binary on PATH that we can use for GPU encoding.
 * Returns { path, version, ffprobePath } or null.
 */
async function findSystemFFmpeg(platformStr = process.platform) {
  const candidates = platform.getSystemFFmpegCandidates(platformStr);
  for (const bin of candidates) {
    try {
      const r = await runWithTimeout(bin, ['-version'], 5000);
      const combined = r.stdout + r.stderr;
      if (combined.includes('ffmpeg version')) {
        const versionMatch = combined.match(/ffmpeg version ([^\s]+)/);
        return {
          path: bin,
          version: versionMatch ? versionMatch[1] : 'unknown',
          ffprobePath: platform.ffprobeForSystem(bin, platformStr),
        };
      }
    } catch (_) {
      // try next candidate
    }
  }
  return null;
}

// ─── Single-encoder test ──────────────────────────────────────────────────────

/**
 * Run a tiny synthetic encode to confirm a GPU encoder actually works
 * on this machine. Returns boolean.
 */
async function testGPUEncoder(ffmpegBin, candidate) {
  const testOutput = path.join(os.tmpdir(), `dfdt_gpu_test_${candidate.name}_${process.pid}.mp4`);
  const args = [
    '-y',
    '-f', 'lavfi', '-i', 'color=c=0x102030:s=128x128:r=30',
    '-frames:v', '5',
    '-c:v', candidate.name,
    '-pix_fmt', candidate.pixFmt,
    '-profile:v', candidate.profile,
    ...candidate.qualityArgs,
    ...candidate.extraArgs,
    testOutput,
  ];
  try {
    const result = await runWithTimeout(ffmpegBin, args, 15000);
    const combined = result.stdout + result.stderr;
    const stat = fs.existsSync(testOutput) ? fs.statSync(testOutput) : null;
    const works = stat && stat.size > 0 && !/Conversion failed|Error.*encoding/i.test(combined);
    return Boolean(works);
  } catch (_) {
    return false;
  } finally {
    if (fs.existsSync(testOutput)) {
      try { fs.unlinkSync(testOutput); } catch (_) {}
    }
  }
}

// ─── Full GPU detection ───────────────────────────────────────────────────────

/**
 * Try every candidate for this platform in priority order.
 * Returns the first working GPU encoder config (with `available: true`)
 * or null if no GPU encoder is usable.
 *
 * Logs to console at each step so the dev console shows the full decision chain.
 */
async function detectGPUEncoder({
  bundledFFmpegPath,
  platformStr = process.platform,
  log = console.log,
  codec = 'hevc',   // 'hevc' (dome master) or 'h264' (screener)
}) {
  const candidates = getCandidates(platformStr, codec);
  log(`[GPU/${codec}] Detecting on platform=${platformStr}, ${candidates.length} candidate(s) to try`);

  for (const candidate of candidates) {
    let ffmpegBin = bundledFFmpegPath;

    if (candidate.requiresSystemFFmpeg) {
      const sys = await findSystemFFmpeg(platformStr);
      if (!sys) {
        log(`[GPU/${codec}] ${candidate.name}: needs system ffmpeg, not found — skipping`);
        continue;
      }
      ffmpegBin = sys.path;
      log(`[GPU/${codec}] ${candidate.name}: using system ffmpeg at ${ffmpegBin}`);
    }

    // Step 1: encoder must appear in -encoders output
    try {
      const r = await runWithTimeout(ffmpegBin, ['-encoders'], 8000);
      const combined = r.stdout + r.stderr;
      if (!new RegExp(`\\b${candidate.name}\\b`).test(combined)) {
        log(`[GPU/${codec}] ${candidate.name}: not in encoder list`);
        continue;
      }
    } catch (err) {
      log(`[GPU/${codec}] ${candidate.name}: encoder list query failed — ${err.message}`);
      continue;
    }

    // Step 2: actually test-encode a few frames
    const works = await testGPUEncoder(ffmpegBin, candidate);
    if (works) {
      log(`[GPU/${codec}] ✓ ${candidate.name} works — selected`);
      return {
        ...candidate,
        ffmpegPath: ffmpegBin,
        available: true,
      };
    }
    log(`[GPU/${codec}] ✗ ${candidate.name}: test encode failed`);
  }

  const fallback = codec === 'h264' ? 'CPU libx264' : 'CPU libx265';
  log(`[GPU/${codec}] No working GPU encoder — falling back to ${fallback}`);
  return null;
}

module.exports = {
  GPU_ENCODER_CANDIDATES,
  GPU_H264_ENCODER_CANDIDATES,
  getCandidates,
  findSystemFFmpeg,
  testGPUEncoder,
  detectGPUEncoder,
};
