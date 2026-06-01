/**
 * encode-args.js — pure function that builds the FFmpeg argv array.
 *
 * No I/O. No platform-specific imports. Given a fully-described encode
 * request, return the exact arg array that will be passed to spawn().
 *
 * This is the heart of the encoder. Keeping it pure means:
 *   - We can unit-test every combination (CPU/GPU, PNG/video, 4K/6K/8K, etc.)
 *   - We can verify cross-platform parity by calling with platform overrides
 *   - We can audit the actual ffmpeg command without running it
 */

/**
 * Build the ffmpeg argv array for a video encode.
 *
 * @param {object} req — fully-resolved encode request
 * @param {string} req.sourceType        — 'png' | 'video'
 * @param {string} [req.ffmpegPattern]   — for PNG: the %04d.png pattern path
 * @param {string} [req.sourcePath]      — for video: the input file path
 * @param {number} req.frameRate         — 30 or 60
 * @param {object} req.resolution        — { label: '8K', width, height }
 * @param {string} req.outputVideoPath   — destination
 * @param {object} req.config            — festival config (for CRF/preset/x265 params)
 * @param {object|null} req.gpu          — GPU encoder config, or null for CPU
 * @param {number} [req.sourceBitDepth]  — 8 or 16, for PNG color tagging
 * @returns {string[]} argv array (NEVER a shell string — always array form)
 */
function buildEncodeArgs(req) {
  const {
    sourceType, ffmpegPattern, sourcePath,
    frameRate, resolution, outputVideoPath,
    config, gpu, sourceBitDepth,
  } = req;

  const args = [];

  // ── Input ───────────────────────────────────────────────────────────────────
  if (sourceType === 'png') {
    args.push('-framerate', String(frameRate));
    args.push('-i', ffmpegPattern);
  } else {
    args.push('-i', sourcePath);
    args.push('-r', String(frameRate));
  }

  // ── Video codec ─────────────────────────────────────────────────────────────
  if (gpu) {
    args.push('-c:v', gpu.name);
    args.push('-pix_fmt', gpu.pixFmt);
    args.push('-profile:v', gpu.profile);
    args.push(...gpu.qualityArgs);
    if (gpu.extraArgs && gpu.extraArgs.length) args.push(...gpu.extraArgs);
  } else {
    let x265Params = config.video.x265_params;
    // 8K @ 60fps adds VBV cap (per spec)
    if (resolution.label === '8K' && frameRate === 60) {
      const vbv = config.video.high_res_high_fps_vbv;
      x265Params += `:vbv-maxrate=${vbv.vbv_maxrate}:vbv-bufsize=${vbv.vbv_bufsize}`;
    }
    args.push('-c:v', 'libx265');
    args.push('-pix_fmt', config.video.pix_fmt);
    args.push('-crf', String(config.video.crf));
    args.push('-preset', config.video.preset);
    args.push('-x265-params', x265Params);
  }

  // ── Color space tagging (PNG source only — video sources passthrough) ──────
  if (sourceType === 'png') {
    if (sourceBitDepth === 16) {
      args.push('-colorspace', 'bt2020nc');
      args.push('-color_primaries', 'bt2020');
      args.push('-color_trc', 'smpte2084');
    } else {
      args.push('-colorspace', 'bt709');
      args.push('-color_primaries', 'bt709');
      args.push('-color_trc', 'bt709');
    }
  }

  // ── No audio in main encode (audio handled separately) ──────────────────────
  args.push('-an');
  args.push(outputVideoPath);

  return args;
}

/**
 * Build the ffmpeg argv array for splitting a 5.1 interleaved WAV into 6 stems.
 * Uses channelsplit filter (FFmpeg 5+ method; -map_channel removed in 5.0).
 *
 * @param {object} req
 * @param {string} req.inputPath
 * @param {object} req.stemPaths — { L, R, C, LFE, Ls, Rs } absolute output paths
 * @returns {string[]} argv array
 */
function buildSplitStemsArgs({ inputPath, stemPaths }) {
  return [
    '-y',
    '-i', inputPath,
    '-filter_complex',
    '[0:a]channelsplit=channel_layout=5.1[out_L][out_R][out_C][out_LFE][out_Ls][out_Rs]',
    '-map', '[out_L]',   '-ar', '44100', '-c:a', 'pcm_s24le', stemPaths.L,
    '-map', '[out_R]',   '-ar', '44100', '-c:a', 'pcm_s24le', stemPaths.R,
    '-map', '[out_C]',   '-ar', '44100', '-c:a', 'pcm_s24le', stemPaths.C,
    '-map', '[out_LFE]', '-ar', '44100', '-c:a', 'pcm_s24le', stemPaths.LFE,
    '-map', '[out_Ls]',  '-ar', '44100', '-c:a', 'pcm_s24le', stemPaths.Ls,
    '-map', '[out_Rs]',  '-ar', '44100', '-c:a', 'pcm_s24le', stemPaths.Rs,
  ];
}

/**
 * Build the ffmpeg argv array for muxing stems into the video.
 * Outputs to a temp file; caller is responsible for replacing the original.
 *
 * @param {object} req
 * @param {string} req.videoPath  — input video (will be copied, not re-encoded)
 * @param {string[]} req.stemPaths — array of audio file paths
 * @param {string} req.outputPath — temp output file path
 * @param {boolean} req.is51      — true if 6-stem 5.1, false if stereo
 * @returns {string[]} argv array
 */
function buildMuxArgs({ videoPath, stemPaths, outputPath, is51 }) {
  const args = ['-y', '-i', videoPath];
  for (const s of stemPaths) {
    args.push('-i', s);
  }
  args.push('-c:v', 'copy');
  args.push('-c:a', 'aac');
  args.push('-b:a', is51 ? '384k' : '192k');
  if (is51) {
    args.push('-ac', '6');
    args.push('-channel_layout', '5.1');
  }
  args.push(outputPath);
  return args;
}

/**
 * Build args to re-encode a single stem to PCM 24-bit 44.1kHz (canonical format).
 */
function buildStemNormalizeArgs({ inputPath, outputPath }) {
  return [
    '-y',
    '-i', inputPath,
    '-ar', '44100',
    '-c:a', 'pcm_s24le',
    outputPath,
  ];
}

module.exports = {
  buildEncodeArgs,
  buildSplitStemsArgs,
  buildMuxArgs,
  buildStemNormalizeArgs,
};
