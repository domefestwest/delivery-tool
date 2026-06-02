/**
 * resolution-rules.js — governance rules around source vs. output resolution.
 *
 * Core invariant: NEVER upscale. A 2K source can only produce 2K or smaller.
 * A 5K source can produce 4K (round down to the nearest allowed). An 8K source
 * can produce 4K, 6K, or 8K from the festival's allowed list.
 *
 * Why this matters: encoding a 2K source "at 8K" produces a file that LOOKS
 * 8K to playback systems but is actually a 2K image scaled up — fake dome
 * master. Festivals reject these on dome day. This module prevents the artist
 * from creating that situation in the first place.
 */

/**
 * Filter a festival's allowed resolutions to only those the source can
 * legitimately produce without upscaling.
 *
 * @param {number} sourceWidth
 * @param {number} sourceHeight
 * @param {Array<{label, width, height}>} allowedResolutions
 * @returns {Array<{label, width, height}>} subset that doesn't require upscaling
 */
function filterAllowedResolutions(sourceWidth, sourceHeight, allowedResolutions) {
  if (!sourceWidth || !sourceHeight) return allowedResolutions || [];
  if (!Array.isArray(allowedResolutions)) return [];
  return allowedResolutions.filter(res =>
    res.width <= sourceWidth && res.height <= sourceHeight
  );
}

/**
 * Classify a source resolution into a friendly bracket name.
 * Brackets are based on the standard fulldome resolution buckets.
 *
 * @param {number} sourceWidth
 * @returns {string} 'sub-2K' | '2K' | '4K' | '6K' | '8K' | 'unknown'
 */
function describeSourceBracket(sourceWidth) {
  if (!sourceWidth) return 'unknown';
  if (sourceWidth < 2048) return 'sub-2K';
  if (sourceWidth < 4096) return '2K';
  if (sourceWidth < 6144) return '4K';
  if (sourceWidth < 8192) return '6K';
  return '8K';
}

/**
 * Returns a friendly human-readable explanation of why a particular
 * allowed resolution can't be used for this source.
 *
 * @param {object} resolution — { label, width, height }
 * @param {number} sourceWidth
 * @param {number} sourceHeight
 * @returns {string|null} explanation, or null if the resolution IS allowed
 */
function explainResolutionUnavailable(resolution, sourceWidth, sourceHeight) {
  if (!resolution || !sourceWidth || !sourceHeight) return null;
  if (resolution.width <= sourceWidth && resolution.height <= sourceHeight) return null;
  return `Source is ${sourceWidth}×${sourceHeight}; outputting at ${resolution.label} ` +
         `(${resolution.width}×${resolution.height}) would require upscaling.`;
}

/**
 * Decide whether the source qualifies for screener mode.
 *
 * @param {number} sourceWidth
 * @param {object} screenerConfig — { enabled, max_source_label }
 * @returns {boolean}
 */
function isScreenerEligible(sourceWidth, screenerConfig) {
  if (!screenerConfig || !screenerConfig.enabled) return false;
  if (!sourceWidth) return false;
  // Bracket thresholds in pixels for the labels artists know
  const thresholds = { '2K': 2048, '4K': 4096, '6K': 6144, '8K': 8192 };
  const maxLabel = screenerConfig.max_source_label || '4K';
  const threshold = thresholds[maxLabel] || 4096;
  // Screener available when source is at or below the threshold (use ≤ for safety)
  return sourceWidth <= threshold;
}

/**
 * Top-level diagnosis: given a source and a festival config, what should
 * the artist see in the UI?
 *
 * @returns {object} {
 *   sourceBracket,             // friendly bracket name
 *   masterModeAvailable,       // can the artist make a dome master at all?
 *   allowedMasterResolutions,  // filtered list of allowed master output sizes
 *   screenerModeAvailable,     // is screener mode appropriate?
 *   recommendation,            // 'master' | 'screener' | 'either' | 'neither'
 *   advisory,                  // a user-facing string explaining the situation
 * }
 */
function diagnoseSource(sourceWidth, sourceHeight, config) {
  if (!sourceWidth || !sourceHeight) {
    return {
      sourceBracket: 'unknown',
      masterModeAvailable: false,
      allowedMasterResolutions: [],
      screenerModeAvailable: false,
      recommendation: 'neither',
      advisory: 'Source dimensions not yet detected.',
    };
  }

  const sourceBracket = describeSourceBracket(sourceWidth);
  const allowedMasterResolutions = filterAllowedResolutions(
    sourceWidth, sourceHeight, config?.video?.allowed_resolutions || []
  );
  const masterModeAvailable = allowedMasterResolutions.length > 0;
  const screenerModeAvailable = isScreenerEligible(sourceWidth, config?.screener);

  let recommendation = 'neither';
  let advisory = '';

  if (masterModeAvailable && screenerModeAvailable) {
    recommendation = 'either';
    advisory = `${sourceBracket} source — Dome Master and Screener both available.`;
  } else if (masterModeAvailable) {
    recommendation = 'master';
    const highest = allowedMasterResolutions[allowedMasterResolutions.length - 1];
    advisory = `${sourceBracket} source — can deliver up to ${highest.label}.`;
  } else if (screenerModeAvailable) {
    recommendation = 'screener';
    advisory = `${sourceBracket} source — too small for dome master delivery. ` +
               `Use Screener mode for jury review.`;
  } else {
    recommendation = 'neither';
    advisory = `Source is ${sourceWidth}×${sourceHeight}, which is too small for ` +
               `this festival's accepted resolutions ` +
               `(${(config?.video?.allowed_resolutions || []).map(r => r.label).join(', ')}).`;
  }

  return {
    sourceBracket,
    masterModeAvailable,
    allowedMasterResolutions,
    screenerModeAvailable,
    recommendation,
    advisory,
  };
}

module.exports = {
  filterAllowedResolutions,
  describeSourceBracket,
  explainResolutionUnavailable,
  isScreenerEligible,
  diagnoseSource,
};
