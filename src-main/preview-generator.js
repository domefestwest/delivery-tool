/**
 * preview-generator.js — generate small JPG thumbnails for the preview pane.
 *
 * Why thumbnails (not direct rendering):
 *   - 8K PNG sources can be 30MB+; loading them directly into the renderer
 *     is slow and uses huge amounts of memory
 *   - HEVC video preview in Chromium is inconsistent across systems
 *   - FFmpeg can scale + extract a single frame in <500ms regardless of source
 *
 * Output: 480×480 JPG (1:1 fits fulldome aspect perfectly).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { runWithTimeout } = require('./ffmpeg-capabilities');

const THUMB_SIZE = 480;

/**
 * Generate a thumbnail in OS temp dir. Returns the path.
 * Cached by source path hash so subsequent calls return instantly.
 *
 * @param {object} opts
 * @param {string} opts.ffmpegPath
 * @param {string} opts.sourceType  — 'video' | 'png'
 * @param {string} opts.sourcePath  — file path (video) or first-frame path (png)
 * @param {number} [opts.seekSeconds] — for video, where to grab the thumbnail (default 1s)
 * @returns {Promise<{ok, thumbPath, cached, error}>}
 */
async function generateThumbnail({ ffmpegPath, sourceType, sourcePath, seekSeconds = 1 }) {
  if (!ffmpegPath) return { error: 'FFmpeg not available' };
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return { error: 'Source file not found: ' + sourcePath };
  }

  // Cache key includes source path + mtime so changes invalidate cache
  const stat = fs.statSync(sourcePath);
  const cacheKey = crypto.createHash('md5')
    .update(`${sourceType}:${sourcePath}:${stat.mtimeMs}`)
    .digest('hex')
    .slice(0, 16);
  const thumbPath = path.join(os.tmpdir(), `dfw_preview_${cacheKey}.jpg`);

  if (fs.existsSync(thumbPath)) {
    try {
      const buffer = fs.readFileSync(thumbPath);
      return {
        ok: true,
        thumbPath,
        dataUrl: 'data:image/jpeg;base64,' + buffer.toString('base64'),
        cached: true,
        sizeBytes: buffer.length,
      };
    } catch (_) {
      // fall through to regeneration
    }
  }

  const scaleFilter =
    `scale=${THUMB_SIZE}:${THUMB_SIZE}:force_original_aspect_ratio=decrease,` +
    `pad=${THUMB_SIZE}:${THUMB_SIZE}:(ow-iw)/2:(oh-ih)/2:color=black`;

  // Strategy: for video, try the seek first (fast for long films).
  // If that produces an empty file (short video, seek past EOF), retry from frame 0.
  // For PNG: single attempt.
  const attempts = sourceType === 'video'
    ? [
        // First: seek BEFORE -i for fast keyframe-accurate preview
        ['-y', '-ss', String(seekSeconds), '-i', sourcePath, '-vframes', '1',
         '-vf', scaleFilter, '-q:v', '5', thumbPath],
        // Fallback: no seek, just take the very first frame
        ['-y', '-i', sourcePath, '-vframes', '1',
         '-vf', scaleFilter, '-q:v', '5', thumbPath],
      ]
    : [
        ['-y', '-i', sourcePath, '-vf', scaleFilter, '-q:v', '5', thumbPath],
      ];

  let lastErr = null;
  for (const args of attempts) {
    // Remove any previous attempt's artifact
    try { if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath); } catch (_) {}
    try {
      const result = await runWithTimeout(ffmpegPath, args, 15000);
      if (fs.existsSync(thumbPath) && fs.statSync(thumbPath).size >= 100) {
        // Return as base64 data URL — avoids file:// CSP issues in renderer.
        // Thumbnails are ~5-50KB so base64 overhead is negligible.
        const buffer = fs.readFileSync(thumbPath);
        const dataUrl = 'data:image/jpeg;base64,' + buffer.toString('base64');
        return {
          ok: true,
          thumbPath,
          dataUrl,
          cached: false,
          sizeBytes: buffer.length,
        };
      }
      lastErr = (result.stderr || '').slice(-200);
    } catch (err) {
      lastErr = err.message;
    }
  }
  return { error: `Thumbnail generation failed: ${lastErr || 'unknown error'}` };
}

/**
 * Delete stale preview thumbnails from the OS temp dir.
 * Called at app shutdown or on demand. Best-effort.
 */
function cleanupOldThumbnails(olderThanMs = 24 * 60 * 60 * 1000) {
  try {
    const tmp = os.tmpdir();
    const files = fs.readdirSync(tmp).filter(f => /^dfw_preview_[a-f0-9]+\.jpg$/.test(f));
    const cutoff = Date.now() - olderThanMs;
    let removed = 0;
    for (const f of files) {
      const fp = path.join(tmp, f);
      try {
        if (fs.statSync(fp).mtimeMs < cutoff) {
          fs.unlinkSync(fp);
          removed++;
        }
      } catch (_) {}
    }
    return { removed };
  } catch (_) {
    return { removed: 0 };
  }
}

module.exports = { generateThumbnail, cleanupOldThumbnails, THUMB_SIZE };
