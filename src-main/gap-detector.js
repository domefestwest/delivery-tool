/**
 * gap-detector.js — find missing frames in a PNG sequence.
 *
 * Critical safety check: FFmpeg's image2 demuxer SILENTLY substitutes the
 * previous frame when a file is missing. Artists have shipped masters
 * with frozen frames they never knew were there. Detecting gaps before
 * encode prevents this.
 *
 * Pure function — takes an array of filenames, returns gap analysis.
 */

/**
 * Find gaps in a numbered PNG sequence.
 *
 * @param {string[]} files — sorted array of filenames matching the same pattern
 * @returns {object} {
 *   hasGaps: bool,
 *   firstFrame: number, lastFrame: number,
 *   expectedCount: number, actualCount: number,
 *   missing: number[],    // sorted list of missing frame numbers (capped to 50)
 *   missingTotal: number, // full count even if missing[] is capped
 *   ranges: [[start, end]], // contiguous missing ranges, e.g. [[12,15], [99,99]]
 * }
 */
function detectGaps(files) {
  if (!files || files.length === 0) {
    return {
      hasGaps: false,
      firstFrame: null, lastFrame: null,
      expectedCount: 0, actualCount: 0,
      missing: [], missingTotal: 0, ranges: [],
    };
  }

  // Extract frame numbers (works for both PNG and EXR sequences)
  const numbers = [];
  for (const f of files) {
    const m = f.match(/^.*?(\d{2,10})\.(png|exr)$/i);
    if (m) numbers.push(parseInt(m[1], 10));
  }
  if (numbers.length === 0) {
    return {
      hasGaps: false,
      firstFrame: null, lastFrame: null,
      expectedCount: 0, actualCount: 0,
      missing: [], missingTotal: 0, ranges: [],
    };
  }

  numbers.sort((a, b) => a - b);
  const firstFrame = numbers[0];
  const lastFrame  = numbers[numbers.length - 1];
  const expectedCount = lastFrame - firstFrame + 1;
  const actualCount   = numbers.length;

  if (actualCount === expectedCount) {
    return {
      hasGaps: false,
      firstFrame, lastFrame, expectedCount, actualCount,
      missing: [], missingTotal: 0, ranges: [],
    };
  }

  // Find missing numbers
  const present = new Set(numbers);
  const missing = [];
  for (let i = firstFrame; i <= lastFrame; i++) {
    if (!present.has(i)) missing.push(i);
  }

  // Collapse to contiguous ranges
  const ranges = [];
  let rStart = missing[0];
  let rEnd = missing[0];
  for (let i = 1; i < missing.length; i++) {
    if (missing[i] === rEnd + 1) {
      rEnd = missing[i];
    } else {
      ranges.push([rStart, rEnd]);
      rStart = missing[i];
      rEnd = missing[i];
    }
  }
  ranges.push([rStart, rEnd]);

  // Cap the returned missing[] for UI sanity
  const cappedMissing = missing.slice(0, 50);

  return {
    hasGaps: true,
    firstFrame, lastFrame, expectedCount, actualCount,
    missing: cappedMissing,
    missingTotal: missing.length,
    ranges,
  };
}

/**
 * Format a gap report as human-readable text for the UI.
 */
function formatGapReport(gaps) {
  if (!gaps.hasGaps) return null;
  const parts = [];
  parts.push(`${gaps.missingTotal} missing frame${gaps.missingTotal > 1 ? 's' : ''} ` +
             `in range ${gaps.firstFrame}–${gaps.lastFrame}`);
  if (gaps.ranges.length <= 5) {
    const rangeStr = gaps.ranges.map(([a, b]) =>
      a === b ? `${a}` : `${a}–${b}`).join(', ');
    parts.push(`(missing: ${rangeStr})`);
  } else {
    parts.push(`(${gaps.ranges.length} discontinuous gaps)`);
  }
  return parts.join(' ');
}

module.exports = { detectGaps, formatGapReport };
