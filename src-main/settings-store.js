/**
 * settings-store.js — persistent user preferences + recent encodes history.
 *
 * Stored in {userData}/settings.json (was 'dfw-settings.json' before v0.16 —
 * see migrateLegacySettingsIfNeeded). Atomic writes via temp-rename pattern
 * so a crash mid-write can't corrupt the file.
 *
 * Holds:
 *   - artistName / studio defaults
 *   - lastOutputDir / lastSourceDir
 *   - preferGPU toggle
 *   - autoOpenFolderOnComplete
 *   - autoZip
 *   - notifyOnComplete
 *   - recentEncodes: [{ filmTitle, resolution, fps, encoder, deliveryFolder, encodeDate, durationMs }]
 */

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  artistName: '',
  studio: '',
  lastOutputDir: '',
  lastSourceDir: '',
  preferGPU: true,
  autoOpenFolderOnComplete: true,
  autoZip: false,
  notifyOnComplete: true,
  preventSleepDuringEncode: true,
  recentEncodes: [],
};

const RECENT_MAX = 10;

// Settings file historically lived at 'dfw-settings.json'. After the v0.16
// rebrand we use 'settings.json'. On first launch we transparently migrate any
// pre-existing dfw-settings.json so users don't lose their saved preferences.
function getSettingsPath(userDataDir) {
  return path.join(userDataDir, 'settings.json');
}

function getLegacySettingsPath(userDataDir) {
  return path.join(userDataDir, 'dfw-settings.json');
}

function migrateLegacySettingsIfNeeded(userDataDir) {
  const newPath = getSettingsPath(userDataDir);
  const legacyPath = getLegacySettingsPath(userDataDir);
  if (!fs.existsSync(newPath) && fs.existsSync(legacyPath)) {
    try {
      fs.copyFileSync(legacyPath, newPath);
      console.log('[Settings] Migrated legacy dfw-settings.json → settings.json');
    } catch (err) {
      console.warn('[Settings] Legacy migration failed:', err.message);
    }
  }
}

/**
 * Read settings, merging with defaults for any missing keys.
 * Auto-migrates a pre-v0.16 dfw-settings.json on first call if present.
 */
function readSettings(userDataDir) {
  migrateLegacySettingsIfNeeded(userDataDir);
  const file = getSettingsPath(userDataDir);
  try {
    if (!fs.existsSync(file)) return { ...DEFAULTS };
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { ...DEFAULTS, ...raw };
  } catch (err) {
    console.warn('[Settings] Read failed, using defaults:', err.message);
    return { ...DEFAULTS };
  }
}

/**
 * Atomic write — write to .tmp then rename.
 */
function writeSettings(userDataDir, settings) {
  try {
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }
    const file = getSettingsPath(userDataDir);
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Merge partial updates into existing settings + write.
 */
function updateSettings(userDataDir, partial) {
  const current = readSettings(userDataDir);
  const next = { ...current, ...partial };
  const res = writeSettings(userDataDir, next);
  return res.error ? { error: res.error } : next;
}

/**
 * Add an encode to the recent history. Keeps newest first, capped at RECENT_MAX.
 * Dedupes by deliveryFolder path so re-encodes don't pile up.
 */
function addRecentEncode(userDataDir, entry) {
  const current = readSettings(userDataDir);
  const recent = (current.recentEncodes || [])
    .filter(e => e.deliveryFolder !== entry.deliveryFolder);
  recent.unshift({
    filmTitle:     entry.filmTitle,
    artistName:    entry.artistName,
    resolution:    entry.resolution,
    frameRate:     entry.frameRate,
    encoder:       entry.encoder,
    sourceType:    entry.sourceType,
    deliveryFolder: entry.deliveryFolder,
    encodeDate:    entry.encodeDate || new Date().toISOString(),
    durationMs:    entry.durationMs,
    fileSizeBytes: entry.fileSizeBytes,
  });
  return updateSettings(userDataDir, {
    recentEncodes: recent.slice(0, RECENT_MAX),
  });
}

module.exports = {
  DEFAULTS,
  RECENT_MAX,
  getSettingsPath,
  readSettings,
  writeSettings,
  updateSettings,
  addRecentEncode,
};
