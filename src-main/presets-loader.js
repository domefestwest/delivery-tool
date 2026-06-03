/**
 * presets-loader.js — discover and load festival preset configs that
 * ship bundled with the app.
 *
 * The app comes with several preset festival configs in a `presets/` folder
 * (DFW, plus example templates). Artists pick one from a dropdown without
 * needing to download a config file separately. Festivals can still
 * distribute their own .json file for artists to load via "Custom config…".
 */

const fs = require('fs');
const path = require('path');

/**
 * Scan a presets directory and return summaries for each valid preset.
 *
 * @param {string} presetsDir
 * @returns {Array<{id, name, short, version, isExample, hasIcon, path, contactEmail}>}
 *   Sorted with real festivals first, examples last.
 */
function listPresets(presetsDir) {
  if (!fs.existsSync(presetsDir)) return [];

  const files = fs.readdirSync(presetsDir).filter(f => /\.json$/i.test(f));
  const presets = [];

  for (const file of files) {
    const fullPath = path.join(presetsDir, file);
    try {
      const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      if (!data.festival_name) continue;  // not a valid preset
      presets.push({
        id:           file.replace(/\.json$/i, ''),
        name:         data.festival_name,
        short:        data.festival_short || '',
        version:      data.version || '',
        isExample:    !!data._example,
        hasIcon:      !!data.festival_icon,
        contactEmail: data.contact_email || '',
        path:         fullPath,
      });
    } catch (_) {
      // skip unparseable files
    }
  }

  // Real presets first (alphabetical), then examples (alphabetical)
  presets.sort((a, b) => {
    if (a.isExample !== b.isExample) return a.isExample ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  return presets;
}

/**
 * Load a specific preset by id from the given directory.
 * Returns the full festival config object, or { error }.
 */
function loadPreset(presetsDir, id) {
  const fullPath = path.join(presetsDir, `${id}.json`);
  if (!fs.existsSync(fullPath)) {
    return { error: `Preset not found: ${id}` };
  }
  try {
    const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    // Strip the internal _example marker — the rest of the app doesn't need it
    const { _example, ...config } = data;
    return config;
  } catch (err) {
    return { error: `Could not parse preset: ${err.message}` };
  }
}

/**
 * Get the default preset id (DFW if present, else the first real preset,
 * else the first example).
 */
function getDefaultPresetId(presetsDir) {
  const presets = listPresets(presetsDir);
  if (presets.length === 0) return null;
  const dfw = presets.find(p => p.short === 'DFW');
  if (dfw) return dfw.id;
  const firstReal = presets.find(p => !p.isExample);
  if (firstReal) return firstReal.id;
  return presets[0].id;
}

module.exports = { listPresets, loadPreset, getDefaultPresetId };
