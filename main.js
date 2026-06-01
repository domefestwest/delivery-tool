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
const { buildEncodeArgs }     = require('./src-main/encode-args');
const { buildDeliveryReport } = require('./src-main/delivery-report');
const { detectGaps, formatGapReport } = require('./src-main/gap-detector');
const { estimateOutputSize, recommendedFreeBytes } = require('./src-main/output-estimate');
const { checkOutputDiskSpace } = require('./src-main/disk-space');
const { probeAndVerify }      = require('./src-main/output-verification');
const { analyzeLoudness, classifyLoudness } = require('./src-main/loudness');
const { zipDeliveryFolder }   = require('./src-main/zip-package');
const { generateThumbnail, cleanupOldThumbnails } = require('./src-main/preview-generator');
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
let activeGPUEncoder = null;
let encodeProcess = null;
let powerSaveBlockerId = null;

function applyDepResult(result) {
  if (result.found && result.has10BitX265) {
    activeFFmpegPath = result.path;
    activeFFprobePath = result.ffprobePath;
    activeGPUEncoder = result.gpu?.available ? result.gpu : null;
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
    title: 'Dome Fest West Delivery Tool',
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

// ─── IPC: PNG sequence scanning (with gap detection) ──────────────────────────

ipcMain.handle('scan:png-sequence', async (_, folderPath) => {
  try {
    const files = fs.readdirSync(folderPath).filter(f => /\.png$/i.test(f)).sort();
    if (!files.length) return { error: 'No PNG files found in this folder.' };

    const patterns = {};
    for (const file of files) {
      const m = file.match(/^(.*?)(\d{2,10})(\.png)$/i);
      if (m) {
        const key = `${m[1]}${'#'.repeat(m[2].length)}.png`;
        (patterns[key] = patterns[key] || []).push(file);
      }
    }
    const best = Object.entries(patterns).sort((a, b) => b[1].length - a[1].length)[0];
    if (!best) {
      return { error: 'Could not detect a numbered PNG sequence. Try entering the pattern manually.' };
    }
    const [patternStr, matchedFiles] = best;

    // Bit depth from first frame
    let bitDepth = null;
    if (activeFFprobePath) {
      try {
        const firstFrame = path.join(folderPath, matchedFiles[0]);
        const probe = await runWithTimeout(activeFFprobePath, [
          '-v', 'error', '-select_streams', 'v:0',
          '-show_entries', 'stream=bits_per_raw_sample,pix_fmt',
          '-of', 'json', firstFrame,
        ]);
        const stream = JSON.parse(probe.stdout || '{}')?.streams?.[0];
        if (stream) {
          const bprs = parseInt(stream.bits_per_raw_sample, 10);
          const pf = stream.pix_fmt || '';
          if (bprs === 16 || /16|48|64/.test(pf)) bitDepth = 16;
          else if (bprs === 8 || /^(rgb24|rgba|gray|pal8)$/.test(pf)) bitDepth = 8;
          else if (pf) bitDepth = 8;
        }
      } catch (_) {}
    }

    // Build ffmpeg pattern
    const m = matchedFiles[0].match(/^(.*?)(\d{2,10})(\.png)$/i);
    const ffmpegPattern = path.join(folderPath, `${m[1]}%0${m[2].length}d.png`);

    // Gap detection (NEW)
    const gaps = detectGaps(matchedFiles);

    return {
      pattern: patternStr,
      ffmpegPattern,
      frameCount: matchedFiles.length,
      bitDepth,
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

  // Directory → check for PNGs inside
  if (stat.isDirectory()) {
    try {
      const files = fs.readdirSync(p).filter(f => /\.png$/i.test(f));
      if (files.length > 0) {
        return { kind: 'png-folder', folderPath: p, pngCount: files.length };
      }
      return { kind: 'unknown', error: 'Folder has no PNG files' };
    } catch (err) {
      return { kind: 'unknown', error: err.message };
    }
  }

  // File: detect by extension
  if (/\.(mp4|mov|m4v)$/i.test(p)) {
    return { kind: 'video', filePath: p };
  }
  if (/\.png$/i.test(p)) {
    // Single PNG → use its parent folder for sequence scan
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
  const folderName = `${safeName}_DFW${year}`;
  const deliveryFolder = path.join(outputDir, folderName);
  const videoFolder = path.join(deliveryFolder, 'video');
  const audioFolder = path.join(deliveryFolder, 'audio');
  fs.mkdirSync(videoFolder, { recursive: true });
  fs.mkdirSync(audioFolder, { recursive: true });

  const outputFilename = `${safeName}_DFW${year}_${resolution.label}.mp4`;
  const outputVideoPath = path.join(videoFolder, outputFilename);

  const ffArgs = buildEncodeArgs({
    sourceType, ffmpegPattern, sourcePath,
    frameRate, resolution, outputVideoPath,
    config, gpu, sourceBitDepth,
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

      // AUDIO LOUDNESS ANALYSIS (on first stem, or muxed track)
      let loudness = null;
      if (audioResult.stems && audioResult.stems.length > 0) {
        try {
          const targetLufs = config.audio_target_lufs ?? -23.0;
          // Analyze first stem (typically L) — sample, not full mix
          const measurement = await analyzeLoudness(activeFFmpegPath, audioResult.stems[0].path);
          loudness = {
            measurement,
            classification: classifyLoudness(measurement, targetLufs),
          };
        } catch (_) {}
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

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  activeConfig = loadDefaultConfig();
  createWindow();

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
  // Best-effort cleanup of old preview thumbnails
  try { cleanupOldThumbnails(); } catch (_) {}
});
