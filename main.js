/**
 * main.js — Electron main process entry point.
 *
 * IPC orchestration + Electron lifecycle.
 * All business logic lives in src-main/* modules.
 */

const { app, BrowserWindow, ipcMain, dialog, shell, Notification, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const platform                = require('./src-main/platform');
const { runWithTimeout }      = require('./src-main/ffmpeg-capabilities');
const { runDependencyCheck }  = require('./src-main/dependency-check');
const { processAudio }        = require('./src-main/audio-processor');
const { buildEncodeArgs, buildScreenerEncodeArgs } = require('./src-main/encode-args');
const { buildDeliveryReport } = require('./src-main/delivery-report');
const { detectGaps, formatGapReport } = require('./src-main/gap-detector');
const { estimateOutputSize, recommendedFreeBytes } = require('./src-main/output-estimate');
const { checkOutputDiskSpace } = require('./src-main/disk-space');
const { probeAndVerify }      = require('./src-main/output-verification');
const { analyzeLoudness, classifyLoudness, analyzeMix } = require('./src-main/loudness');
const { zipDeliveryFolder }   = require('./src-main/zip-package');
const { generateThumbnail, cleanupOldThumbnails } = require('./src-main/preview-generator');
const { saveProject, loadProject } = require('./src-main/project-io');
const { checkForUpdate, schedulePeriodicCheck } = require('./src-main/update-checker');
const settingsStore           = require('./src-main/settings-store');
const {
  computeMd5,
  sanitizeFilmTitle,
  calculateETA,
} = require('./src-main/utils');

const isDev = process.env.ELECTRON_START_URL || !app.isPackaged;

// ─── Version ──────────────────────────────────────────────────────────────────

function getAppVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    return pkg.version;
  } catch (_) {
    return app.getVersion();
  }
}

function bundledFFmpegPath() {
  return platform.getBundledFFmpegPath({
    appRoot: __dirname,
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged,
  });
}

// ─── App state ────────────────────────────────────────────────────────────────

let mainWindow = null;
let depCheckResult = null;
let activeFFmpegPath = null;
let activeFFprobePath = null;
let activeConfig = null;
let activeGPUEncoder = null;       // HEVC GPU encoder (dome master mode)
let activeGPUH264Encoder = null;   // H.264 GPU encoder (screener mode)
let encodeProcess = null;
let powerSaveBlockerId = null;
let stopUpdateCheck = null;
let latestUpdateState = null;  // last result from the checker

function applyDepResult(result) {
  if (result.found && result.has10BitX265) {
    activeFFmpegPath = result.path;
    activeFFprobePath = result.ffprobePath;
    activeGPUEncoder = result.gpu?.available ? result.gpu : null;
    activeGPUH264Encoder = result.gpuH264?.available ? result.gpuH264 : null;
  }
}

function loadDefaultConfig() {
  const configPath = app.isPackaged
    ? path.join(process.resourcesPath, 'dfw_config.json')
    : path.join(__dirname, 'dfw_config.json');
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.error('[Config] Failed to load default config:', err);
    return null;
  }
}

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 860,
    minHeight: 640,
    title: 'Dome Festival Delivery Tool',
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const startUrl = process.env.ELECTRON_START_URL ||
    `file://${path.join(__dirname, 'build', 'index.html')}`;
  mainWindow.loadURL(startUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── Power save blocker helpers ───────────────────────────────────────────────

function startPowerSaveBlocker() {
  if (powerSaveBlockerId !== null) return;
  try {
    powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep');
    console.log('[Power] Sleep prevention ON (id=' + powerSaveBlockerId + ')');
  } catch (err) {
    console.warn('[Power] Could not start sleep blocker:', err.message);
  }
}

function stopPowerSaveBlocker() {
  if (powerSaveBlockerId === null) return;
  try {
    powerSaveBlocker.stop(powerSaveBlockerId);
    console.log('[Power] Sleep prevention OFF');
  } catch (_) {}
  powerSaveBlockerId = null;
}

// ─── IPC: Dependency check ────────────────────────────────────────────────────

ipcMain.handle('dep:check', async () => {
  depCheckResult = await runDependencyCheck({ bundledPath: bundledFFmpegPath() });
  applyDepResult(depCheckResult);
  console.log('[DependencyCheck] Final result:', JSON.stringify(depCheckResult, null, 2));
  return depCheckResult;
});

ipcMain.handle('dep:recheck', async () => {
  depCheckResult = await runDependencyCheck({ bundledPath: bundledFFmpegPath() });
  applyDepResult(depCheckResult);
  console.log('[DependencyCheck] Recheck result:', JSON.stringify(depCheckResult, null, 2));
  return depCheckResult;
});

// ─── IPC: Config ──────────────────────────────────────────────────────────────

ipcMain.handle('config:load-default', () => {
  activeConfig = loadDefaultConfig();
  return activeConfig;
});

ipcMain.handle('config:load-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Load Festival Config',
    filters: [{ name: 'JSON Config', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  try {
    activeConfig = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
    return activeConfig;
  } catch (err) {
    return { error: 'Failed to parse config: ' + err.message };
  }
});

// ─── IPC: Dialogs ─────────────────────────────────────────────────────────────

ipcMain.handle('dialog:open-folder', async (_, opts) => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: opts?.title || 'Select Folder',
    defaultPath: opts?.defaultPath,
    properties: ['openDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('dialog:open-file', async (_, opts) => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: opts?.title || 'Select File',
    filters: opts?.filters || [],
    defaultPath: opts?.defaultPath,
    properties: ['openFile'],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('dialog:open-files', async (_, opts) => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: opts?.title || 'Select Files',
    filters: opts?.filters || [],
    defaultPath: opts?.defaultPath,
    properties: ['openFile', 'multiSelections'],
  });
  return r.canceled ? null : r.filePaths;
});

ipcMain.handle('dialog:save-folder', async (_, opts) => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: opts?.title || 'Choose Output Folder',
    defaultPath: opts?.defaultPath,
    properties: ['openDirectory', 'createDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('shell:open-path', async (_, p) => shell.openPath(p));
ipcMain.handle('shell:show-in-folder', async (_, p) => shell.showItemInFolder(p));

// ─── IPC: Image sequence scanning (PNG and EXR) ───────────────────────────────

ipcMain.handle('scan:png-sequence', async (_, folderPath) => {
  try {
    // Look for PNG and EXR sequences. EXR is common in VFX-heavy workflows
    // (Houdini, Nuke, Maya) and preserves linear HDR data.
    const allFiles = fs.readdirSync(folderPath);
    const imageFiles = allFiles.filter(f => /\.(png|exr)$/i.test(f)).sort();
    if (!imageFiles.length) {
      return { error: 'No PNG or EXR image files found in this folder.' };
    }

    // Detect dominant extension (mixed folders are unusual; we pick whichever has more)
    const pngCount = imageFiles.filter(f => /\.png$/i.test(f)).length;
    const exrCount = imageFiles.filter(f => /\.exr$/i.test(f)).length;
    const ext = pngCount >= exrCount ? 'png' : 'exr';
    const extRegex = ext === 'png' ? /^(.*?)(\d{2,10})(\.png)$/i : /^(.*?)(\d{2,10})(\.exr)$/i;
    const files = imageFiles.filter(f =>
      ext === 'png' ? /\.png$/i.test(f) : /\.exr$/i.test(f));

    const patterns = {};
    for (const file of files) {
      const m = file.match(extRegex);
      if (m) {
        const key = `${m[1]}${'#'.repeat(m[2].length)}.${ext}`;
        (patterns[key] = patterns[key] || []).push(file);
      }
    }
    const best = Object.entries(patterns).sort((a, b) => b[1].length - a[1].length)[0];
    if (!best) {
      return { error: `Could not detect a numbered ${ext.toUpperCase()} sequence. Try entering the pattern manually.` };
    }
    const [patternStr, matchedFiles] = best;

    // Bit depth + dimensions from first frame
    let bitDepth = null;
    let width = null;
    let height = null;
    if (activeFFprobePath) {
      try {
        const firstFrame = path.join(folderPath, matchedFiles[0]);
        const probe = await runWithTimeout(activeFFprobePath, [
          '-v', 'error', '-select_streams', 'v:0',
          '-show_entries', 'stream=bits_per_raw_sample,pix_fmt,width,height',
          '-of', 'json', firstFrame,
        ]);
        const stream = JSON.parse(probe.stdout || '{}')?.streams?.[0];
        if (stream) {
          width = stream.width || null;
          height = stream.height || null;
          const bprs = parseInt(stream.bits_per_raw_sample, 10);
          const pf = stream.pix_fmt || '';
          if (ext === 'exr') {
            bitDepth = 16;
            if (/f32|f64|float/.test(pf)) bitDepth = 16;
          } else if (bprs === 16 || /16|48|64/.test(pf)) {
            bitDepth = 16;
          } else if (bprs === 8 || /^(rgb24|rgba|gray|pal8)$/.test(pf)) {
            bitDepth = 8;
          } else if (pf) {
            bitDepth = 8;
          }
        }
      } catch (_) {}
    }

    // Build ffmpeg pattern (extension preserved)
    const m = matchedFiles[0].match(extRegex);
    const ffmpegPattern = path.join(folderPath, `${m[1]}%0${m[2].length}d.${ext}`);

    const gaps = detectGaps(matchedFiles);

    return {
      pattern: patternStr,
      ffmpegPattern,
      frameCount: matchedFiles.length,
      bitDepth,
      width,
      height,
      sourceExt: ext,  // 'png' or 'exr' — for UI labels
      firstFrame: path.join(folderPath, matchedFiles[0]),
      lastFrame: path.join(folderPath, matchedFiles[matchedFiles.length - 1]),
      gaps,
      gapReport: formatGapReport(gaps),
    };
  } catch (err) {
    return { error: err.message };
  }
});

// ─── IPC: Video/audio probing ─────────────────────────────────────────────────

ipcMain.handle('probe:video', async (_, filePath) => {
  if (!activeFFprobePath) return { error: 'FFprobe not available.' };
  try {
    const r = await runWithTimeout(activeFFprobePath, [
      '-v', 'error', '-show_streams', '-show_format', '-of', 'json', filePath,
    ]);
    const info = JSON.parse(r.stdout || '{}');
    const v = info.streams?.find(s => s.codec_type === 'video');
    const a = info.streams?.find(s => s.codec_type === 'audio');
    if (!v) return { error: 'No video stream found in file.' };

    let fps = null;
    if (v.r_frame_rate) {
      const [n, d] = v.r_frame_rate.split('/').map(Number);
      fps = d ? n / d : n;
    }
    const bitDepth = parseInt(v.bits_per_raw_sample, 10) ||
      (/10/.test(v.pix_fmt) ? 10 : 8);

    return {
      width: v.width, height: v.height,
      fps: fps ? Math.round(fps * 100) / 100 : null,
      codec: v.codec_name, pixFmt: v.pix_fmt, bitDepth,
      colorSpace: v.color_space,
      colorPrimaries: v.color_primaries,
      colorTrc: v.color_transfer,
      duration: parseFloat(info.format?.duration) || null,
      fileSizeBytes: parseInt(info.format?.size, 10) || null,
      audioChannels: a ? parseInt(a.channels, 10) : 0,
      audioSampleRate: a ? parseInt(a.sample_rate, 10) : null,
      audioBitrate: a?.bit_rate || null,
    };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('probe:audio', async (_, filePath) => {
  if (!activeFFprobePath) return { error: 'FFprobe not available.' };
  try {
    const r = await runWithTimeout(activeFFprobePath, [
      '-v', 'error', '-show_streams', '-of', 'json', filePath,
    ]);
    const a = JSON.parse(r.stdout || '{}').streams?.find(s => s.codec_type === 'audio');
    if (!a) return { error: 'No audio stream found.' };
    const tags = a.tags || {};
    const isAmbisonic = /ambi/i.test(JSON.stringify(tags)) ||
      /ambisonic/i.test(a.channel_layout || '');
    return {
      channels: parseInt(a.channels, 10),
      channelLayout: a.channel_layout,
      sampleRate: parseInt(a.sample_rate, 10),
      codec: a.codec_name,
      isAmbisonic,
      duration: parseFloat(a.duration) || null,
    };
  } catch (err) {
    return { error: err.message };
  }
});

// ─── IPC: Source auto-detection (for drop zone) ───────────────────────────────
// Drop a path → tell the renderer whether it's a video, PNG sequence (or folder
// containing one), or unrecognized.

ipcMain.handle('source:detect', async (_, p) => {
  if (!p) return { kind: 'unknown' };
  if (!fs.existsSync(p)) return { kind: 'unknown', error: 'Path not found' };

  const stat = fs.statSync(p);

  // Directory → check for image sequences inside (PNG or EXR)
  if (stat.isDirectory()) {
    try {
      const files = fs.readdirSync(p).filter(f => /\.(png|exr)$/i.test(f));
      if (files.length > 0) {
        return { kind: 'png-folder', folderPath: p, pngCount: files.length };
      }
      return { kind: 'unknown', error: 'Folder has no PNG or EXR files' };
    } catch (err) {
      return { kind: 'unknown', error: err.message };
    }
  }

  // File: detect by extension
  if (/\.(mp4|mov|m4v)$/i.test(p)) {
    return { kind: 'video', filePath: p };
  }
  if (/\.(png|exr)$/i.test(p)) {
    // Single image → use its parent folder for sequence scan
    return { kind: 'png-folder', folderPath: path.dirname(p), pngCount: 1 };
  }
  return { kind: 'unknown', error: 'Unrecognized file type' };
});

// ─── IPC: Preview thumbnail ───────────────────────────────────────────────────

ipcMain.handle('preview:generate', async (_, opts) => {
  if (!activeFFmpegPath) return { error: 'FFmpeg not available' };
  return generateThumbnail({
    ffmpegPath: activeFFmpegPath,
    sourceType: opts.sourceType,
    sourcePath: opts.sourcePath,
    seekSeconds: opts.seekSeconds ?? 1,
  });
});

// ─── IPC: Pre-flight disk space check ─────────────────────────────────────────

ipcMain.handle('preflight:disk-space', async (_, opts) => {
  const { outputDir, resolutionLabel, frameRate, durationSeconds, isGPU } = opts;
  const estimate = estimateOutputSize({ resolutionLabel, frameRate, durationSeconds, isGPU });
  const recommended = recommendedFreeBytes(estimate.bytes);
  const check = await checkOutputDiskSpace({
    outputDir, estimatedBytes: estimate.bytes, recommendedBytes: recommended,
  });
  return { estimate, recommendedBytes: recommended, check };
});

// ─── IPC: Output verification ─────────────────────────────────────────────────

ipcMain.handle('verify:output', async (_, opts) => {
  if (!activeFFprobePath) return { error: 'FFprobe not available.' };
  return probeAndVerify(activeFFprobePath, opts.outputPath, opts.expected);
});

// ─── IPC: Audio loudness analysis ─────────────────────────────────────────────

ipcMain.handle('analyze:loudness', async (_, opts) => {
  if (!activeFFmpegPath) return { error: 'FFmpeg not available.' };
  const measurement = await analyzeLoudness(activeFFmpegPath, opts.audioPath);
  const target = opts.targetLufs ?? -23.0;
  return { measurement, classification: classifyLoudness(measurement, target) };
});

// ─── IPC: Zip delivery ────────────────────────────────────────────────────────

ipcMain.handle('zip:delivery', async (_, deliveryFolder) => {
  return zipDeliveryFolder(deliveryFolder);
});

// ─── IPC: Settings persistence ────────────────────────────────────────────────

ipcMain.handle('settings:read', () => {
  return settingsStore.readSettings(app.getPath('userData'));
});

ipcMain.handle('settings:update', (_, partial) => {
  return settingsStore.updateSettings(app.getPath('userData'), partial);
});

ipcMain.handle('settings:recent-add', (_, entry) => {
  return settingsStore.addRecentEncode(app.getPath('userData'), entry);
});

// ─── IPC: Update checker ──────────────────────────────────────────────────────

ipcMain.handle('update:check-now', async () => {
  const result = await checkForUpdate(getAppVersion());
  latestUpdateState = result;
  return result;
});

ipcMain.handle('update:get-status', () => latestUpdateState);

// ─── IPC: Project save/load (.dfwproj files) ──────────────────────────────────

ipcMain.handle('project:save', async (_, state) => {
  const filmTitle = (state?.filmTitle || 'Untitled').trim();
  const safeName = filmTitle.replace(/[^a-zA-Z0-9_-]/g, '_');
  const save = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Project',
    defaultPath: `${safeName}.domeproj`,
    filters: [
      { name: 'Dome Festival Project', extensions: ['domeproj'] },
      { name: 'Legacy DFW Project', extensions: ['dfwproj'] },
    ],
  });
  if (save.canceled || !save.filePath) return { canceled: true };
  return saveProject(save.filePath, state, getAppVersion());
});

ipcMain.handle('project:open', async () => {
  const open = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Project',
    filters: [
      // Accept both new and legacy extensions
      { name: 'Dome Festival Projects', extensions: ['domeproj', 'dfwproj'] },
    ],
    properties: ['openFile'],
  });
  if (open.canceled || !open.filePaths.length) return { canceled: true };
  return loadProject(open.filePaths[0]);
});

// ─── IPC: Save debug log ──────────────────────────────────────────────────────
// Writes a portable text file with system info, dep-check result, encode params,
// and full FFmpeg stderr — so artists can email Ryan a meaningful bug report.

ipcMain.handle('debug:save-log', async (_, opts) => {
  const defaultName = `dfdt-debug-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.txt`;
  const save = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Debug Log',
    defaultPath: defaultName,
    filters: [{ name: 'Text', extensions: ['txt'] }],
  });
  if (save.canceled || !save.filePath) return { canceled: true };

  const lines = [];
  const sep = '─'.repeat(72);
  lines.push('Dome Festival Delivery Tool — Debug Log');
  lines.push(sep);
  lines.push(`Generated:        ${new Date().toISOString()}`);
  lines.push(`Tool version:     v${getAppVersion()}`);
  lines.push(`Platform:         ${process.platform} ${process.arch}`);
  lines.push(`OS release:       ${require('os').release()}`);
  lines.push(`Node version:     ${process.versions.node}`);
  lines.push(`Electron version: ${process.versions.electron}`);
  lines.push(`Chrome version:   ${process.versions.chrome}`);
  lines.push('');
  lines.push(sep);
  lines.push('DEPENDENCY CHECK RESULT');
  lines.push(sep);
  lines.push(JSON.stringify(depCheckResult, null, 2));
  lines.push('');
  lines.push(sep);
  lines.push('ACTIVE CONFIG');
  lines.push(sep);
  lines.push(JSON.stringify(activeConfig, null, 2));
  lines.push('');
  lines.push(sep);
  lines.push('LAST ENCODE / SESSION CONTEXT');
  lines.push(sep);
  if (opts?.contextSummary) {
    lines.push(JSON.stringify(opts.contextSummary, null, 2));
  } else {
    lines.push('(no context provided)');
  }
  lines.push('');
  if (opts?.ffmpegLog) {
    lines.push(sep);
    lines.push('FFMPEG STDERR (LAST 20K CHARS)');
    lines.push(sep);
    lines.push(String(opts.ffmpegLog).slice(-20000));
    lines.push('');
  }
  if (opts?.errorMessage) {
    lines.push(sep);
    lines.push('ERROR MESSAGE');
    lines.push(sep);
    lines.push(String(opts.errorMessage));
    lines.push('');
  }
  lines.push(sep);
  lines.push('Email to: Ryan@domefestwest.com');
  lines.push(sep);

  try {
    fs.writeFileSync(save.filePath, lines.join('\n'), 'utf8');
    return { ok: true, path: save.filePath };
  } catch (err) {
    return { error: err.message };
  }
});

// ─── IPC: Native completion notification ──────────────────────────────────────

ipcMain.handle('notify:encode-complete', (_, opts) => {
  if (!Notification.isSupported()) return { ok: false };
  const n = new Notification({
    title: opts?.title || 'Encode complete',
    body: opts?.body || 'Your delivery package is ready.',
    silent: false,
  });
  n.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
    if (opts?.openPath) shell.openPath(opts.openPath);
  });
  n.show();
  return { ok: true };
});

// ─── IPC: Test encode (5-second preview) ──────────────────────────────────────

ipcMain.handle('encode:test', async (_, encodeParams) => {
  if (!activeFFmpegPath) return { error: 'FFmpeg not available.' };
  if (encodeProcess) return { error: 'An encode is already running.' };

  const {
    sourceType, sourcePath, ffmpegPattern,
    frameRate, resolution, config,
    sourceBitDepth, useGPU,
  } = encodeParams;

  const gpu = (useGPU !== false) && activeGPUEncoder;
  const encodeFFmpeg = gpu ? gpu.ffmpegPath : activeFFmpegPath;

  // Output to OS temp dir, opens with system video player
  const tempOut = path.join(require('os').tmpdir(),
    `dfw_test_${Date.now()}_${resolution.label}.mp4`);

  // Build args, then PREPEND -frames:v limit to encode just 5 seconds worth
  const sampleFrames = frameRate * 5;
  const ffArgs = buildEncodeArgs({
    sourceType, ffmpegPattern, sourcePath,
    frameRate, resolution, outputVideoPath: tempOut,
    config, gpu, sourceBitDepth,
    sourceWidth: encodeParams.sourceWidth,
    sourceHeight: encodeParams.sourceHeight,
  });

  // Insert -frames:v just before the output path (which is always last)
  const argsWithLimit = [...ffArgs.slice(0, -1), '-frames:v', String(sampleFrames), tempOut];

  console.log('[TestEncode] Running 5-second test encode to:', tempOut);

  return new Promise(resolve => {
    let stderr = '';
    const startMs = Date.now();
    const proc = spawn(encodeFFmpeg, argsWithLimit);
    encodeProcess = proc;
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('error', err => {
      encodeProcess = null;
      resolve({ error: err.message });
    });
    proc.on('close', code => {
      encodeProcess = null;
      if (code !== 0 || !fs.existsSync(tempOut)) {
        return resolve({
          error: `Test encode failed (exit ${code}). ` + (stderr.slice(-300)),
        });
      }
      const durationMs = Date.now() - startMs;
      const sizeBytes = fs.statSync(tempOut).size;
      // Open with system player
      shell.openPath(tempOut);
      resolve({
        ok: true, tempPath: tempOut, sizeBytes, durationMs,
        framesEncoded: sampleFrames,
      });
    });
  });
});

// ─── IPC: Encode (main) ───────────────────────────────────────────────────────

ipcMain.handle('encode:start', async (_, encodeParams) => {
  if (!activeFFmpegPath) return { error: 'FFmpeg not available.' };
  if (encodeProcess) return { error: 'An encode is already running.' };

  const {
    sourceType, sourcePath, ffmpegPattern,
    frameRate, resolution, outputDir,
    filmTitle, artistName, config,
    audioMode, audioFiles, audioInterleaved,
    muxAudio, sourceBitDepth, useGPU,
    autoZip, notifyOnComplete, preventSleep,
  } = encodeParams;

  const gpu = (useGPU !== false) && activeGPUEncoder;
  const encodeFFmpeg = gpu ? gpu.ffmpegPath : activeFFmpegPath;
  const encoderName  = gpu ? gpu.name : 'libx265';
  const encoderLabel = gpu ? gpu.label : 'CPU libx265';

  const year = config.version;
  const safeName = sanitizeFilmTitle(filmTitle);
  const festivalCode = config.festival_short || 'FEST';

  // Folder name from the festival config's template (defaulting to the
  // legacy {FilmTitle}_{FESTIVAL}{Year} pattern). Festivals can override
  // via delivery.folder_name_template — e.g. '{FilmTitle}_TOKYO{Year}'
  // for Tokyo Planetarium Festival, '{FilmTitle}_FPF{Year}' for FPF, etc.
  const template = config.delivery?.folder_name_template || '{FilmTitle}_{FESTIVAL}{Year}';
  const folderName = template
    .replace('{FilmTitle}', safeName)
    .replace('{FESTIVAL}', festivalCode)
    .replace('{Year}', year);

  const deliveryFolder = path.join(outputDir, folderName);
  const videoFolder = path.join(deliveryFolder, 'video');
  const audioFolder = path.join(deliveryFolder, 'audio');
  fs.mkdirSync(videoFolder, { recursive: true });
  fs.mkdirSync(audioFolder, { recursive: true });

  // Output filename mirrors the folder pattern but adds resolution and .mp4
  const outputFilename = `${safeName}_${festivalCode}${year}_${resolution.label}.mp4`;
  const outputVideoPath = path.join(videoFolder, outputFilename);

  const ffArgs = buildEncodeArgs({
    sourceType, ffmpegPattern, sourcePath,
    frameRate, resolution, outputVideoPath,
    config, gpu, sourceBitDepth,
    sourceWidth: encodeParams.sourceWidth,
    sourceHeight: encodeParams.sourceHeight,
  });

  const cmdLine = `${encodeFFmpeg} ${ffArgs.join(' ')}`;
  console.log(`[Encode] Using ${encoderLabel}`);
  console.log('[Encode] FFmpeg command:', cmdLine);
  mainWindow?.webContents.send('encode:log',
    `Encoder: ${encoderLabel}\nCommand:\n${cmdLine}\n`);
  mainWindow?.webContents.send('encode:encoder',
    { name: encoderName, label: encoderLabel, isGPU: !!gpu });

  // Power save blocker if requested
  if (preventSleep !== false) startPowerSaveBlocker();

  return new Promise(resolve => {
    let stderr = '';
    const totalFrames = encodeParams.totalFrames || null;
    const encodeStartMs = Date.now();
    let lastFrameSeen = 0;
    let lastFpsSeen = null;
    let lastSizeCheckMs = 0;

    encodeProcess = spawn(encodeFFmpeg, ffArgs);

    encodeProcess.stderr.on('data', data => {
      const chunk = data.toString();
      stderr += chunk;

      const frameMatch = chunk.match(/frame=\s*(\d+)/);
      const timeMatch  = chunk.match(/time=(\d+:\d+:\d+\.\d+)/);
      const speedMatch = chunk.match(/speed=\s*([\d.]+)x/);
      const fpsMatch   = chunk.match(/fps=\s*([\d.]+)/);

      if (frameMatch || timeMatch) {
        const currentFrame = frameMatch ? parseInt(frameMatch[1], 10) : lastFrameSeen;
        const fps = fpsMatch ? parseFloat(fpsMatch[1]) : lastFpsSeen;
        lastFrameSeen = currentFrame;
        if (fps) lastFpsSeen = fps;

        const etaSeconds = calculateETA({
          currentFrame, totalFrames, fps,
          speed: speedMatch ? parseFloat(speedMatch[1]) : null,
          frameRate,
        });

        // Live output file size (poll every 2 seconds to avoid stat thrashing)
        let liveSizeBytes = null;
        const now = Date.now();
        if (now - lastSizeCheckMs > 2000) {
          lastSizeCheckMs = now;
          try {
            if (fs.existsSync(outputVideoPath)) {
              liveSizeBytes = fs.statSync(outputVideoPath).size;
            }
          } catch (_) {}
        }

        mainWindow?.webContents.send('encode:progress', {
          frame: currentFrame,
          time: timeMatch ? timeMatch[1] : null,
          speed: speedMatch ? parseFloat(speedMatch[1]) : null,
          fps: fps || null,
          totalFrames,
          etaSeconds,
          elapsedMs: now - encodeStartMs,
          liveSizeBytes,
        });
      }
      mainWindow?.webContents.send('encode:log', chunk);
    });

    encodeProcess.on('close', async code => {
      encodeProcess = null;
      stopPowerSaveBlocker();

      if (code !== 0) {
        resolve({ error: `FFmpeg exited with code ${code}`, stderr });
        return;
      }

      const audioResult = await processAudio({
        audioMode, audioFiles, audioInterleaved,
        audioFolder, filmTitle: safeName,
        muxAudio, outputVideoPath,
        ffmpegPath: activeFFmpegPath,
        ffprobePath: activeFFprobePath,
      });

      const videoStat = fs.existsSync(outputVideoPath) ? fs.statSync(outputVideoPath) : null;
      const videoMd5 = videoStat ? await computeMd5(outputVideoPath).catch(() => null) : null;

      // OUTPUT VERIFICATION (post-encode)
      let verification = null;
      try {
        verification = await probeAndVerify(activeFFprobePath, outputVideoPath, {
          codec: 'hevc',
          pixFmt: 'yuv420p10le',
          width: resolution.width,
          height: resolution.height,
          frameRate,
          durationSeconds: encodeParams.sourceDuration,
        });
      } catch (_) {}

      // AUDIO LOUDNESS ANALYSIS — proper full-mix analysis.
      // Priority: muxed video → interleaved source → amerge of stems.
      // (The previous version analyzed only stems[0], which gave meaningless
      // numbers for multi-stem audio — e.g. measuring just LFE.)
      let loudness = null;
      if (audioResult.stems && audioResult.stems.length > 0) {
        try {
          const mixResult = await analyzeMix({
            ffmpegPath: activeFFmpegPath,
            muxedVideoPath: audioResult.muxReplaced ? outputVideoPath : null,
            interleavedSourcePath: audioMode === 'interleaved' ? audioInterleaved : null,
            stemPaths: audioResult.stems.map(s => s.path),
            targetLufs: config.audio_target_lufs ?? -23.0,
          });
          loudness = mixResult;
        } catch (err) {
          console.warn('[loudness] analysis threw:', err.message);
        }
      }

      let x265ParamsForReport = null;
      if (!gpu) {
        x265ParamsForReport = config.video.x265_params;
        if (resolution.label === '8K' && frameRate === 60) {
          const vbv = config.video.high_res_high_fps_vbv;
          x265ParamsForReport += `:vbv-maxrate=${vbv.vbv_maxrate}:vbv-bufsize=${vbv.vbv_bufsize}`;
        }
      }

      const allWarnings = [...(encodeParams.warnings || []), ...audioResult.warnings];
      if (loudness?.classification?.severity === 'warning' || loudness?.classification?.severity === 'error') {
        allWarnings.push(loudness.classification.message);
      }
      if (verification && !verification.ok) {
        allWarnings.push(verification.summary);
      }

      const report = buildDeliveryReport({
        filmTitle, artistName, config,
        resolution, frameRate,
        sourceType, sourceBitDepth,
        encodeParams,
        outputFilename,
        videoSizeBytes: videoStat?.size || 0,
        videoMd5,
        audioResult,
        warnings: allWarnings,
        x265Params: x265ParamsForReport,
        encoderLabel, encoderName, isGPU: !!gpu,
        encodeDurationMs: Date.now() - encodeStartMs,
        appVersion: getAppVersion(),
        ffmpegVersion: depCheckResult?.version,
        ffmpegSource: depCheckResult?.source,
      });

      const reportPath = path.join(deliveryFolder, 'delivery_report.txt');
      fs.writeFileSync(reportPath, report, 'utf8');

      // AUTO-ZIP if requested
      let zipResult = null;
      if (autoZip) {
        mainWindow?.webContents.send('encode:log', '\nCreating delivery ZIP…\n');
        zipResult = await zipDeliveryFolder(deliveryFolder);
        if (zipResult.error) {
          allWarnings.push('ZIP creation failed: ' + zipResult.error);
        }
      }

      // SAVE RECENT ENCODE
      try {
        settingsStore.addRecentEncode(app.getPath('userData'), {
          filmTitle, artistName,
          resolution: resolution.label,
          frameRate,
          encoder: encoderLabel,
          sourceType,
          deliveryFolder,
          encodeDate: new Date().toISOString(),
          durationMs: Date.now() - encodeStartMs,
          fileSizeBytes: videoStat?.size || 0,
        });
      } catch (_) {}

      // NATIVE NOTIFICATION
      if (notifyOnComplete !== false && Notification.isSupported()) {
        try {
          const n = new Notification({
            title: 'Encode complete',
            body: `${filmTitle} (${resolution.label}, ${frameRate}fps) ready for delivery.`,
            silent: false,
          });
          n.on('click', () => {
            if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
            shell.openPath(deliveryFolder);
          });
          n.show();
        } catch (_) {}
      }

      resolve({
        success: true,
        deliveryFolder, reportPath, report,
        audioResult, videoMd5,
        videoSizeBytes: videoStat?.size || 0,
        verification,
        loudness,
        zip: zipResult,
      });
    });

    encodeProcess.on('error', err => {
      encodeProcess = null;
      stopPowerSaveBlocker();
      resolve({ error: err.message });
    });
  });
});

ipcMain.handle('encode:cancel', () => {
  if (encodeProcess) {
    encodeProcess.kill('SIGTERM');
    encodeProcess = null;
    stopPowerSaveBlocker();
    return { canceled: true };
  }
  return { canceled: false };
});

// ─── IPC: Screener encode (experimental) ──────────────────────────────────────
// Separate handler from the main dome-master encode flow because the screener
// pipeline is much simpler — single output file, no stems, no MD5/loudness/
// verification, no batch resolution. Optimized for fast 2K H.264 with watermark.

ipcMain.handle('screener:start', async (_, params) => {
  if (!activeFFmpegPath) return { error: 'FFmpeg not available.' };
  if (encodeProcess) return { error: 'An encode is already running.' };

  const {
    sourceType, sourcePath, ffmpegPattern,
    frameRate, outputDir,
    filmTitle, artistName, config,
    watermark,
    useGPU,              // boolean — artist's preference for screener GPU acceleration
    notifyOnComplete, preventSleep,
  } = params;

  const screenerSpec = config?.screener;
  if (!screenerSpec || !screenerSpec.enabled) {
    return { error: 'Screener mode is not enabled in this festival config.' };
  }

  const year = config.version;
  const safeName = sanitizeFilmTitle(filmTitle);
  const festivalCode = config.festival_short || 'FEST';

  // Screener delivery folder gets a _SCREENER suffix so it's never confused
  // with a dome master delivery.
  const folderName = `${safeName}_${festivalCode}${year}_SCREENER`;
  const deliveryFolder = path.join(outputDir, folderName);
  fs.mkdirSync(deliveryFolder, { recursive: true });

  const outputFilename = `${safeName}_${festivalCode}${year}_SCREENER.mp4`;
  const outputVideoPath = path.join(deliveryFolder, outputFilename);

  // GPU H.264 encoder — use if available and not explicitly disabled
  const gpu = (useGPU !== false) && activeGPUH264Encoder;
  const encodeFFmpeg = gpu ? gpu.ffmpegPath : activeFFmpegPath;

  const ffArgs = buildScreenerEncodeArgs({
    sourceType, ffmpegPattern, sourcePath,
    frameRate,
    screenerSpec,
    outputPath: outputVideoPath,
    watermark: watermark?.type === 'none' ? null : watermark,
    gpuEncoder: gpu || null,
  });

  const encoderLabel = gpu ? gpu.label : 'Screener · libx264 CPU';
  const cmdLine = `${encodeFFmpeg} ${ffArgs.join(' ')}`;
  console.log(`[Screener] Using ${encoderLabel}`);
  console.log('[Screener] FFmpeg command:', cmdLine);
  mainWindow?.webContents.send('encode:log',
    `Encoder: ${encoderLabel}\nCommand:\n${cmdLine}\n`);
  mainWindow?.webContents.send('encode:encoder',
    { name: gpu ? gpu.name : 'libx264', label: encoderLabel, isGPU: !!gpu });

  if (preventSleep !== false) startPowerSaveBlocker();

  return new Promise(resolve => {
    let stderr = '';
    const startMs = Date.now();
    let lastSizeCheckMs = 0;

    encodeProcess = spawn(encodeFFmpeg, ffArgs);

    encodeProcess.stderr.on('data', data => {
      const chunk = data.toString();
      stderr += chunk;
      const frameMatch = chunk.match(/frame=\s*(\d+)/);
      const fpsMatch   = chunk.match(/fps=\s*([\d.]+)/);
      const speedMatch = chunk.match(/speed=\s*([\d.]+)x/);

      if (frameMatch) {
        let liveSizeBytes = null;
        const now = Date.now();
        if (now - lastSizeCheckMs > 2000) {
          lastSizeCheckMs = now;
          try {
            if (fs.existsSync(outputVideoPath)) {
              liveSizeBytes = fs.statSync(outputVideoPath).size;
            }
          } catch (_) {}
        }
        mainWindow?.webContents.send('encode:progress', {
          frame: parseInt(frameMatch[1], 10),
          fps: fpsMatch ? parseFloat(fpsMatch[1]) : null,
          speed: speedMatch ? parseFloat(speedMatch[1]) : null,
          totalFrames: params.totalFrames || null,
          elapsedMs: now - startMs,
          liveSizeBytes,
        });
      }
      mainWindow?.webContents.send('encode:log', chunk);
    });

    encodeProcess.on('close', async code => {
      encodeProcess = null;
      stopPowerSaveBlocker();
      if (code !== 0) {
        resolve({ error: `FFmpeg exited with code ${code}`, stderr });
        return;
      }

      const videoStat = fs.existsSync(outputVideoPath) ? fs.statSync(outputVideoPath) : null;
      const videoMd5 = videoStat ? await computeMd5(outputVideoPath).catch(() => null) : null;

      // Minimal report — screeners don't need the full dome-master delivery report
      const lines = [
        '='.repeat(60),
        `${config.festival_name} ${config.version} — Screener File`,
        '='.repeat(60),
        '',
        `Film Title:      ${filmTitle}`,
        `Artist/Studio:   ${artistName || '(not provided)'}`,
        `Encode Date:     ${new Date().toISOString().replace('T', ' ').split('.')[0]} UTC`,
        `Encode Duration: ${Math.round((Date.now() - startMs) / 1000)}s`,
        '',
        `THIS IS A SCREENER FILE — NOT FOR DOME PROJECTION`,
        '',
        `Output File:     ${outputFilename}`,
        `Codec:           ${screenerSpec.codec} (H.264) · ${screenerSpec.pix_fmt}`,
        `Resolution:      ${screenerSpec.resolution.width}×${screenerSpec.resolution.height}`,
        `Frame Rate:      ${frameRate}fps`,
        `CRF:             ${screenerSpec.crf}`,
        `File Size:       ${videoStat ? (videoStat.size / 1024 / 1024).toFixed(1) + ' MB' : 'unknown'}`,
        `MD5 Checksum:    ${videoMd5 || '(unavailable)'}`,
        `Watermark:       ${watermark?.type === 'none' || !watermark?.type ? 'none' :
                            watermark.type === 'text' ? `text "${watermark.text}" (${Math.round((watermark.opacity ?? 0.3) * 100)}%${watermark.moving ? ', moving' : ''})` :
                            `image (${Math.round((watermark.opacity ?? 0.3) * 100)}%${watermark.moving ? ', moving' : ''})`}`,
        '',
        '='.repeat(60),
        `Delivery questions? Contact ${config.contact_email}`,
        '='.repeat(60),
      ];
      const reportPath = path.join(deliveryFolder, 'screener_report.txt');
      fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');

      try {
        settingsStore.addRecentEncode(app.getPath('userData'), {
          filmTitle, artistName,
          resolution: screenerSpec.resolution.label + ' SCREENER',
          frameRate,
          encoder: 'Screener (H.264)',
          sourceType,
          deliveryFolder,
          encodeDate: new Date().toISOString(),
          durationMs: Date.now() - startMs,
          fileSizeBytes: videoStat?.size || 0,
        });
      } catch (_) {}

      if (notifyOnComplete !== false && Notification.isSupported()) {
        try {
          const n = new Notification({
            title: 'Screener encode complete',
            body: `${filmTitle} screener ready (${videoStat ? (videoStat.size / 1024 / 1024).toFixed(0) + ' MB' : ''}).`,
            silent: false,
          });
          n.on('click', () => {
            if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
            shell.openPath(deliveryFolder);
          });
          n.show();
        } catch (_) {}
      }

      resolve({
        success: true,
        deliveryFolder,
        outputPath: outputVideoPath,
        outputFilename,
        videoSizeBytes: videoStat?.size || 0,
        videoMd5,
        isScreener: true,
        report: lines.join('\n'),
      });
    });

    encodeProcess.on('error', err => {
      encodeProcess = null;
      stopPowerSaveBlocker();
      resolve({ error: err.message });
    });
  });
});

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  activeConfig = loadDefaultConfig();
  createWindow();

  // Start background update checking — first probe after 2s, then every 6h
  stopUpdateCheck = schedulePeriodicCheck(getAppVersion(), result => {
    latestUpdateState = result;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:status', result);
      if (result.hasUpdate) {
        console.log(`[Updates] New version available: ${result.latest} (current ${result.current})`);
      }
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopPowerSaveBlocker();
  if (!platform.isMac()) app.quit();
});

app.on('will-quit', () => {
  stopPowerSaveBlocker();
  if (stopUpdateCheck) { try { stopUpdateCheck(); } catch (_) {} }
  try { cleanupOldThumbnails(); } catch (_) {}
});
