/**
 * utils.js — pure utilities (no platform dependencies, no I/O).
 * Easy to unit test.
 */

const crypto = require('crypto');
const fs = require('fs');

// ─── Byte formatting ──────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes == null || isNaN(bytes)) return '—';
  if (bytes < 1024)            return `${bytes} B`;
  if (bytes < 1024 ** 2)       return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3)       return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

// ─── Duration formatting ──────────────────────────────────────────────────────

function formatDuration(ms) {
  if (ms == null || isNaN(ms) || ms < 0) return 'unknown';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

// ─── Film title sanitization (for filenames) ──────────────────────────────────

/**
 * Strips characters not safe for filenames on Windows, macOS, or Linux.
 * Keeps alphanumeric, underscore, hyphen. Everything else → underscore.
 * Note: leaves Windows reserved device names (CON, NUL, etc.) alone since
 * they're always combined with extensions, which makes them safe.
 */
function sanitizeFilmTitle(title) {
  if (!title) return '';
  return String(title).replace(/[^a-zA-Z0-9_-]/g, '_');
}

// ─── MD5 checksum (streaming, for large files) ───────────────────────────────

function computeMd5(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    stream.on('data', d => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// ─── ETA calculation ──────────────────────────────────────────────────────────

/**
 * Calculate estimated seconds remaining for an encode.
 *
 * @param {object} args
 * @param {number} args.currentFrame   — frame number from ffmpeg progress
 * @param {number} args.totalFrames    — total frames in the source
 * @param {number} [args.fps]          — current encode fps from ffmpeg
 * @param {number} [args.speed]        — encode speed multiplier (e.g. 1.5x)
 * @param {number} [args.frameRate]    — target output frame rate
 * @returns {number|null} seconds remaining, or null if can't calculate
 */
function calculateETA({ currentFrame, totalFrames, fps, speed, frameRate }) {
  if (!totalFrames || !currentFrame || currentFrame >= totalFrames) return null;
  const remaining = totalFrames - currentFrame;
  if (fps && fps > 0) {
    return Math.round(remaining / fps);
  }
  if (speed && speed > 0 && frameRate) {
    const realtimeSecs = remaining / frameRate;
    return Math.round(realtimeSecs / speed);
  }
  return null;
}

module.exports = {
  formatBytes, formatDuration,
  sanitizeFilmTitle, computeMd5,
  calculateETA,
};
