/**
 * output-estimate.js — pure function estimating the encoded output file size.
 *
 * Used by the pre-flight disk-space check to decide whether the output
 * drive has enough room. These are HEURISTICS — actual sizes depend on
 * content complexity, but the ranges below are real-world averages
 * measured across DFW 2026 submissions.
 *
 * All values in MEGABITS per second (Mbps).
 */

// Approximate bitrates for libx265 CRF 18 10-bit, measured on real fulldome content.
// Higher resolutions need disproportionately more bitrate due to detail.
const BITRATE_TABLE_MBPS = {
  // resolution × fps → Mbps (approximate)
  '4K-30': 25,
  '4K-60': 45,
  '6K-30': 55,
  '6K-60': 95,
  '8K-30': 90,
  '8K-60': 165,
};

// GPU encoders (NVENC/QSV/VideoToolbox) tend to produce ~1.3-1.6× larger files
// at quality-equivalent settings vs libx265 because hardware encoders are less
// efficient than slow CPU presets.
const GPU_INFLATION = 1.4;

/**
 * Estimate output file size in bytes.
 *
 * @param {object} opts
 * @param {string} opts.resolutionLabel — '4K' | '6K' | '8K'
 * @param {number} opts.frameRate       — 30 or 60
 * @param {number} opts.durationSeconds — source duration
 * @param {boolean} [opts.isGPU]        — true for hardware encoder (larger files)
 * @returns {object} { bytes, low, high, label }
 */
function estimateOutputSize({ resolutionLabel, frameRate, durationSeconds, isGPU = false }) {
  if (!durationSeconds || durationSeconds <= 0) {
    return { bytes: null, low: null, high: null, label: 'unknown' };
  }

  const key = `${resolutionLabel}-${frameRate}`;
  const baseMbps = BITRATE_TABLE_MBPS[key];

  if (!baseMbps) {
    return { bytes: null, low: null, high: null, label: 'unknown (unsupported combo)' };
  }

  const mbps = isGPU ? baseMbps * GPU_INFLATION : baseMbps;
  const bytes = Math.round((mbps * 1_000_000 / 8) * durationSeconds);

  // Real-world variance: ±35% based on scene complexity (starfields vs dense motion)
  const low  = Math.round(bytes * 0.65);
  const high = Math.round(bytes * 1.35);

  return {
    bytes, low, high,
    mbps,
    label: `~${formatGB(bytes)} (range ${formatGB(low)}–${formatGB(high)})`,
  };
}

function formatGB(bytes) {
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/**
 * Recommended free space: 2× the estimate (safety margin for temp mux file
 * and OS overhead). Returns bytes.
 */
function recommendedFreeBytes(estimateBytes) {
  if (!estimateBytes) return 5 * 1024 ** 3; // default 5GB if estimate unknown
  return Math.round(estimateBytes * 2);
}

module.exports = {
  BITRATE_TABLE_MBPS,
  estimateOutputSize,
  recommendedFreeBytes,
};
