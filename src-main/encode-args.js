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

/**
 * Build the ffmpeg argv array for SCREENER encoding (jury review files).
 *
 * Screener-mode is distinct from dome master encoding:
 *   • Lower resolution (typically 2K square) — fast to encode, fast to play back
 *   • H.264 8-bit — broadly compatible with any jury laptop/preview tool
 *   • Higher CRF (28 default) — smaller files, acceptable quality for review
 *   • Audio always muxed as stereo AAC — no stem separation
 *   • Single output file, no separate audio folder
 *   • Optional watermark overlay (PNG image or text, with opacity)
 *
 * @param {object} req
 * @param {string} req.sourceType           — 'png' | 'video'
 * @param {string} [req.ffmpegPattern]       — PNG sequence pattern
 * @param {string} [req.sourcePath]          — video file path
 * @param {number} req.frameRate
 * @param {object} req.screenerSpec          — from config.screener
 * @param {string} req.outputPath
 * @param {object} [req.watermark]           — { type, text, imagePath, opacity, position, moving }
 * @returns {string[]} argv array
 */
function buildScreenerEncodeArgs(req) {
  const {
    sourceType, ffmpegPattern, sourcePath,
    frameRate, screenerSpec, outputPath,
    watermark,
  } = req;

  const args = ['-y'];

  // ── Input ───────────────────────────────────────────────────────────────────
  if (sourceType === 'png') {
    args.push('-framerate', String(frameRate), '-i', ffmpegPattern);
  } else {
    args.push('-i', sourcePath);
  }

  // Watermark inputs come AFTER source so we can reference them as [1:v]
  let wmInputIndex = null;
  if (watermark?.type === 'image' && watermark.imagePath) {
    args.push('-i', watermark.imagePath);
    wmInputIndex = 1;
  }

  // ── Build filter graph ──────────────────────────────────────────────────────
  const w = screenerSpec.resolution.width;
  const h = screenerSpec.resolution.height;

  // Always scale to screener resolution, regardless of source size
  const filters = [];
  filters.push(`[0:v]scale=${w}:${h}:flags=lanczos,format=yuv420p[scaled]`);

  let finalVideo = '[scaled]';

  if (watermark?.type === 'image' && wmInputIndex !== null) {
    const opacity = watermark.opacity ?? 0.3;
    filters.push(
      `[${wmInputIndex}:v]format=rgba,colorchannelmixer=aa=${opacity},scale=iw*${w/2048}:ih*${w/2048}[wm]`
    );
    const overlayPosition = watermarkOverlayPosition(watermark, w, h);
    filters.push(`[scaled][wm]overlay=${overlayPosition}[out]`);
    finalVideo = '[out]';
  } else if (watermark?.type === 'text' && watermark.text) {
    const opacity = watermark.opacity ?? 0.3;
    const escapedText = String(watermark.text).replace(/'/g, "\\'");
    const fontSize = Math.max(40, Math.floor(w / 30));
    const textPos = watermarkTextPosition(watermark);
    filters.push(
      `[scaled]drawtext=text='${escapedText}':fontcolor=white@${opacity}:fontsize=${fontSize}:${textPos}[out]`
    );
    finalVideo = '[out]';
  }

  args.push('-filter_complex', filters.join(';'));
  args.push('-map', finalVideo);

  // ── Video codec ─────────────────────────────────────────────────────────────
  args.push('-c:v', screenerSpec.codec || 'libx264');
  args.push('-pix_fmt', screenerSpec.pix_fmt || 'yuv420p');
  args.push('-crf', String(screenerSpec.crf ?? 28));
  args.push('-preset', screenerSpec.preset || 'fast');
  if (screenerSpec.profile) args.push('-profile:v', screenerSpec.profile);
  args.push('-r', String(frameRate));

  // ── Audio (video source only — PNG has no audio) ────────────────────────────
  if (sourceType === 'video') {
    args.push('-map', '0:a?');           // include audio if present, don't fail if not
    args.push('-c:a', screenerSpec.audio_codec || 'aac');
    args.push('-b:a', screenerSpec.audio_bitrate || '192k');
    args.push('-ac', String(screenerSpec.audio_channels || 2));  // downmix to stereo
  } else {
    args.push('-an');
  }

  // ── Output ──────────────────────────────────────────────────────────────────
  args.push('-movflags', '+faststart'); // makes playback start before full download
  args.push(outputPath);

  return args;
}

/**
 * Build the overlay= expression for image watermarks (with optional moving).
 */
function watermarkOverlayPosition(watermark, w, h) {
  if (!watermark.moving) {
    // Static — center by default; corners if requested
    const pos = watermark.position || 'center';
    if (pos === 'top-left')     return '50:50';
    if (pos === 'top-right')    return 'W-w-50:50';
    if (pos === 'bottom-left')  return '50:H-h-50';
    if (pos === 'bottom-right') return 'W-w-50:H-h-50';
    return '(W-w)/2:(H-h)/2';   // center
  }
  // Moving: rotate between 4 positions every 15 seconds
  // Anti-camcorder: makes it harder to crop out the watermark
  const x = `if(lt(mod(t,60),15), 50, if(lt(mod(t,60),30), W-w-50, if(lt(mod(t,60),45), 50, W-w-50)))`;
  const y = `if(lt(mod(t,60),15), 50, if(lt(mod(t,60),30), 50, if(lt(mod(t,60),45), H-h-50, H-h-50)))`;
  return `x='${x}':y='${y}'`;
}

/**
 * Build the x/y position arguments for text watermarks.
 */
function watermarkTextPosition(watermark) {
  if (!watermark.moving) {
    const pos = watermark.position || 'center';
    if (pos === 'top-left')     return 'x=50:y=50';
    if (pos === 'top-right')    return 'x=w-text_w-50:y=50';
    if (pos === 'bottom-left')  return 'x=50:y=h-text_h-50';
    if (pos === 'bottom-right') return 'x=w-text_w-50:y=h-text_h-50';
    return 'x=(w-text_w)/2:y=(h-text_h)/2';
  }
  const x = `x='if(lt(mod(t,60),15), 50, if(lt(mod(t,60),30), w-text_w-50, if(lt(mod(t,60),45), 50, w-text_w-50)))'`;
  const y = `y='if(lt(mod(t,60),15), 50, if(lt(mod(t,60),30), 50, if(lt(mod(t,60),45), h-text_h-50, h-text_h-50)))'`;
  return `${x}:${y}`;
}

module.exports = {
  buildEncodeArgs,
  buildSplitStemsArgs,
  buildMuxArgs,
  buildStemNormalizeArgs,
  buildScreenerEncodeArgs,
};
