/**
 * delivery-report.js — pure function building the delivery_report.txt content.
 * No I/O, no platform deps — call with a fully-described context, get a string back.
 */

const { formatBytes, formatDuration } = require('./utils');

/**
 * @param {object} ctx
 * @param {string} ctx.filmTitle
 * @param {string} [ctx.artistName]
 * @param {object} ctx.config           — festival config (festival_name, version, contact_email, website)
 * @param {object} ctx.resolution       — { width, height, label }
 * @param {number} ctx.frameRate
 * @param {string} ctx.sourceType       — 'png' | 'video'
 * @param {number} [ctx.sourceBitDepth] — 8 or 16 for PNG
 * @param {object} ctx.encodeParams     — totalFrames, sourceCodec, sourceFps, etc.
 * @param {string} ctx.outputFilename
 * @param {number} ctx.videoSizeBytes
 * @param {string} [ctx.videoMd5]
 * @param {object} ctx.audioResult      — { mode, stems: [{channel, filename, md5}] }
 * @param {string[]} [ctx.warnings]
 * @param {string} [ctx.x265Params]     — only for CPU encodes
 * @param {string} ctx.encoderLabel     — e.g. "Apple VideoToolbox (GPU)"
 * @param {string} ctx.encoderName      — e.g. "hevc_videotoolbox"
 * @param {boolean} ctx.isGPU
 * @param {number} [ctx.encodeDurationMs]
 * @param {string} ctx.appVersion       — tool version
 * @param {string} ctx.ffmpegVersion
 * @param {string} ctx.ffmpegSource     — 'bundled' | 'system'
 * @returns {string} formatted report
 */
function buildDeliveryReport(ctx) {
  const {
    filmTitle, artistName, config, resolution, frameRate,
    sourceType, sourceBitDepth, encodeParams, outputFilename,
    videoSizeBytes, videoMd5, audioResult,
    warnings = [], x265Params,
    encoderLabel, encoderName, isGPU, encodeDurationMs,
    appVersion, ffmpegVersion, ffmpegSource,
  } = ctx;

  const dateStr = new Date().toISOString().replace('T', ' ').split('.')[0] + ' UTC';
  const L = [];

  L.push('='.repeat(60));
  L.push(`${config.festival_name} ${config.version} — Delivery Report`);
  L.push('='.repeat(60));
  L.push('');
  L.push(`Film Title:      ${filmTitle}`);
  L.push(`Artist/Studio:   ${artistName || '(not provided)'}`);
  L.push(`Festival:        ${config.festival_name} ${config.version}`);
  L.push(`Encode Date:     ${dateStr}`);
  L.push(`Encode Duration: ${encodeDurationMs ? formatDuration(encodeDurationMs) : 'unknown'}`);
  L.push('');
  L.push('── VIDEO ────────────────────────────────────────────────────');
  L.push(`Output File:     ${outputFilename}`);
  L.push(`Codec:           H.265 / HEVC`);
  L.push(`Encoder:         ${encoderLabel || 'libx265 (CPU)'}`);
  L.push(`Resolution:      ${resolution.width}×${resolution.height} (${resolution.label})`);
  L.push(`Frame Rate:      ${frameRate}fps`);
  L.push(`Bit Depth:       10-bit (yuv420p10le)`);
  if (!isGPU) {
    L.push(`CRF:             ${config.video.crf}`);
    L.push(`Preset:          ${config.video.preset}`);
    if (x265Params) L.push(`x265-params:     ${x265Params}`);
  }
  L.push(`File Size:       ${formatBytes(videoSizeBytes)}`);
  L.push(`MD5 Checksum:    ${videoMd5 || '(unavailable)'}`);
  L.push('');
  L.push('── SOURCE ───────────────────────────────────────────────────');
  if (sourceType === 'png') {
    L.push(`Source Type:     PNG Image Sequence`);
    L.push(`Frame Count:     ${encodeParams.totalFrames || 'unknown'}`);
    L.push(`Source Bit Depth:${sourceBitDepth ? sourceBitDepth + '-bit' : 'unknown'}`);
  } else {
    L.push(`Source Type:     Video File`);
    L.push(`Source Codec:    ${encodeParams.sourceCodec || 'unknown'}`);
    L.push(`Source FPS:      ${encodeParams.sourceFps || 'unknown'}`);
  }
  L.push('');
  L.push('── AUDIO ────────────────────────────────────────────────────');
  if (audioResult.mode === 'none') {
    L.push('Audio:           None delivered');
  } else {
    L.push(`Audio Format:    ${audioResult.stems.length === 6 ? '5.1 Surround' : 'Stereo'}`);
    L.push(`Sample Rate:     44.1 kHz`);
    L.push(`Stems:`);
    for (const s of audioResult.stems) {
      L.push(`  ${s.channel.padEnd(5)} ${s.filename}  MD5: ${s.md5 || '(unavailable)'}`);
    }
  }
  L.push('');
  if (warnings && warnings.length > 0) {
    L.push('── WARNINGS ─────────────────────────────────────────────────');
    for (const w of warnings) L.push(`  ⚠ ${w}`);
    L.push('');
  }
  L.push('── TOOL INFO ────────────────────────────────────────────────');
  L.push(`Tool Version:    v${appVersion}`);
  L.push(`FFmpeg Version:  ${ffmpegVersion || 'unknown'}`);
  L.push(`FFmpeg Source:   ${ffmpegSource || 'unknown'}`);
  L.push(`GPU Encode:      ${isGPU ? 'Yes — ' + encoderName : 'No — CPU libx265'}`);
  L.push('');
  L.push('='.repeat(60));
  L.push(`Delivery questions? Contact ${config.contact_email}`);
  L.push(`${config.website}`);
  L.push('='.repeat(60));

  return L.join('\n');
}

module.exports = { buildDeliveryReport };
