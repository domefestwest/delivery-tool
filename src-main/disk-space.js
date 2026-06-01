/**
 * disk-space.js — query free space on a given path.
 *
 * Uses fs.statfs (Node 18.15+) which is cross-platform.
 * Falls back to null if the query fails (we surface a soft warning then).
 */

const fs = require('fs');
const path = require('path');

/**
 * Get free + total disk space for the filesystem containing the given path.
 * @param {string} targetPath — file or directory path on the target drive
 * @returns {Promise<object>} { freeBytes, totalBytes } or { error }
 */
async function getDiskSpace(targetPath) {
  try {
    // Walk up to find an existing parent (in case targetPath is a file
    // that doesn't exist yet but its parent does)
    let queryPath = targetPath;
    while (queryPath && !fs.existsSync(queryPath)) {
      const parent = path.dirname(queryPath);
      if (parent === queryPath) break; // hit root
      queryPath = parent;
    }
    if (!queryPath) return { error: 'No valid parent directory found' };

    // Use fs.statfs (Node 18.15+, cross-platform)
    if (typeof fs.statfs !== 'function' && typeof fs.promises?.statfs !== 'function') {
      return { error: 'fs.statfs not available — requires Node 18.15+' };
    }

    const stats = await fs.promises.statfs(queryPath);
    return {
      freeBytes:  stats.bsize * stats.bavail,
      totalBytes: stats.bsize * stats.blocks,
    };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Check whether the output drive has enough space for the encode.
 *
 * @param {object} opts
 * @param {string} opts.outputDir
 * @param {number} opts.estimatedBytes  — from output-estimate
 * @param {number} opts.recommendedBytes — typically 2× estimate
 * @returns {Promise<object>} {
 *   ok: bool, status: 'ok'|'tight'|'insufficient'|'unknown',
 *   freeBytes, recommendedBytes, message
 * }
 */
async function checkOutputDiskSpace({ outputDir, estimatedBytes, recommendedBytes }) {
  const space = await getDiskSpace(outputDir);
  if (space.error) {
    return {
      ok: true,                   // don't block on query failure — let encode try
      status: 'unknown',
      freeBytes: null,
      recommendedBytes,
      message: `Could not check disk space: ${space.error}`,
    };
  }

  const { freeBytes } = space;
  if (estimatedBytes && freeBytes < estimatedBytes) {
    return {
      ok: false,
      status: 'insufficient',
      freeBytes,
      recommendedBytes,
      message: `Not enough disk space. Need ~${gb(estimatedBytes)}, have ${gb(freeBytes)} free.`,
    };
  }
  if (recommendedBytes && freeBytes < recommendedBytes) {
    return {
      ok: true,
      status: 'tight',
      freeBytes,
      recommendedBytes,
      message: `Disk space is tight. Encode needs ~${gb(estimatedBytes)}, have ${gb(freeBytes)} free. ` +
               `Recommend ${gb(recommendedBytes)} for safety margin.`,
    };
  }
  return {
    ok: true,
    status: 'ok',
    freeBytes,
    recommendedBytes,
    message: `${gb(freeBytes)} free.`,
  };
}

function gb(bytes) {
  if (bytes == null) return '?';
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

module.exports = {
  getDiskSpace,
  checkOutputDiskSpace,
};
