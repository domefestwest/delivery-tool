/**
 * project-io.js — save and load .dfwproj project files.
 *
 * A project file captures the entire form state so an artist can step away
 * and return without re-entering film title, source, stem assignments, etc.
 *
 * Schema: dfwproj/v1
 *   Paths are stored ABSOLUTE. On load, any path that doesn't resolve is
 *   surfaced as a warning so the user can re-pick the missing file.
 */

const fs = require('fs');

const SCHEMA = 'dfwproj/v1';

/**
 * Serialize a state snapshot to a .dfwproj file.
 *
 * @param {string} destPath — file path to write (.dfwproj extension recommended)
 * @param {object} state    — full form state
 * @returns {{ok, error}}
 */
function saveProject(destPath, state, toolVersion = '?') {
  const payload = {
    _schema: SCHEMA,
    _tool_version: toolVersion,
    _saved_at: new Date().toISOString(),

    filmTitle:  state.filmTitle || '',
    artistName: state.artistName || '',

    source: {
      type: state.sourceType || 'png',
      path: state.sourceType === 'video' ? (state.videoPath || '') : (state.pngFolder || ''),
      frameRate: state.sourceType === 'video' ? state.videoFrameRate : state.pngFrameRate,
    },

    encode: {
      resolutions: Array.isArray(state.selectedResolutions)
        ? state.selectedResolutions.map(r => r.label || r)
        : [state.resolution?.label].filter(Boolean),
      outputDir: state.outputDir || '',
      useGPU: !!state.useGPU,
    },

    audio: {
      mode: state.audioMode || 'none',
      stems: (state.audioStems || []).map(s => ({
        channel:  s.channel,
        filePath: s.filePath,
        filename: s.filename,
      })),
      interleavedPath: state.audioInterleaved || '',
      muxAudio: !!state.muxAudio,
    },
  };

  try {
    fs.writeFileSync(destPath, JSON.stringify(payload, null, 2), 'utf8');
    return { ok: true, path: destPath };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Load a .dfwproj file and validate.
 * Returns { ok, state, missingPaths, warnings } or { error }.
 */
function loadProject(srcPath) {
  let raw;
  try {
    raw = fs.readFileSync(srcPath, 'utf8');
  } catch (err) {
    return { error: 'Could not read project file: ' + err.message };
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return { error: 'Project file is not valid JSON: ' + err.message };
  }

  if (data._schema !== SCHEMA) {
    return { error: `Unsupported project schema: ${data._schema} (expected ${SCHEMA})` };
  }

  // Validate paths exist
  const missingPaths = [];
  const warnings = [];

  if (data.source?.path && !fs.existsSync(data.source.path)) {
    missingPaths.push({ field: 'source', path: data.source.path });
  }
  if (data.encode?.outputDir && !fs.existsSync(data.encode.outputDir)) {
    warnings.push(`Output folder no longer exists: ${data.encode.outputDir}`);
  }
  if (data.audio?.interleavedPath && !fs.existsSync(data.audio.interleavedPath)) {
    missingPaths.push({ field: 'audio.interleaved', path: data.audio.interleavedPath });
  }
  for (const stem of (data.audio?.stems || [])) {
    if (stem.filePath && !fs.existsSync(stem.filePath)) {
      missingPaths.push({ field: `audio.stem.${stem.channel}`, path: stem.filePath });
    }
  }

  return {
    ok: true,
    state: data,
    missingPaths,
    warnings,
    savedAt: data._saved_at,
    savedVersion: data._tool_version,
  };
}

module.exports = { saveProject, loadProject, SCHEMA };
