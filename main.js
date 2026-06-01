/**
 * main.js — Electron main process entry point.
 *
 * After the cross-platform refactor, this file is just:
 *   1. Electron lifecycle (window creation, app activation)
 *   2. IPC handler bindings — each handler delegates to a module in src-main/
 *   3. Application state (active ffmpeg paths, GPU encoder, current config)
 *
 * All platform-specific decisions live in src-main/platform.js.
 * All FFmpeg argument construction lives in src-main/encode-args.js.
 * All capability detection lives in src-main/ffmpeg-capabilities.js,
 *   gpu-detection.js, and dependency-check.js.
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// Modules (pure / I/O-explicit)
const platform        = require('./src-main/platform');
const { runWithTimeout } = require('./src-main/ffmpeg-capabilities');
const { runDependencyCheck } = require('./src-main/dependency-check');
const { processAudio }       = require('./src-main/audio-processor');
const { buildEncodeArgs }    = require('./src-main/encode-args');
const { buildDeliveryReport } = require('./src-main/delivery-report');
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

// ─── Bundled FFmpeg path ──────────────────────────────────────────────────────

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
    properties: ['openDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('dialog:open-file', async (_, opts) => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: opts?.title || 'Select File',
    filters: opts?.filters || [],
    properties: ['openFile'],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('dialog:open-files', async (_, opts) => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: opts?.title || 'Select Files',
    filters: opts?.filters || [],
    properties: ['openFile', 'multiSelections'],
  });
  return r.canceled ? null : r.filePaths;
});

ipcMain.handle('dialog:save-folder', async (_, opts) => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: opts?.title || 'Choose Output Folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('shell:open-path', async (_, p) => shell.openPath(p));

// ─── IPC: PNG sequence scanning ───────────────────────────────────────────────

ipcMain.handle('scan:png-sequence', async (_, folderPath) => {
  try {
    const files = fs.readdirSync(folderPath).filter(f => /\.png$/i.test(f)).sort();
    if (!files.length) return { error: 'No PNG files found in this folder.' };

    // Pattern detection: optional prefix + 2-10 digit run + .png
    // Allows bare-number sequences like 0001.png (empty prefix)
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

    // Build ffmpeg pattern with %0Nd
    const m = matchedFiles[0].match(/^(.*?)(\d{2,10})(\.png)$/i);
    const ffmpegPattern = path.join(folderPath, `${m[1]}%0${m[2].length}d.png`);

    return {
      pattern: patternStr,
      ffmpegPattern,
      frameCount: matchedFiles.length,
      bitDepth,
      firstFrame: path.join(folderPath, matchedFiles[0]),
      lastFrame: path.join(folderPath, matchedFiles[matchedFiles.length - 1]),
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

// ─── IPC: Encode ──────────────────────────────────────────────────────────────

ipcMain.handle('encode:start', async (_, encodeParams) => {
  if (!activeFFmpegPath) return { error: 'FFmpeg not available.' };
  if (encodeProcess) return { error: 'An encode is already running.' };

  const {
    sourceType, sourcePath, ffmpegPattern,
    frameRate, resolution, outputDir,
    filmTitle, artistName, config,
    audioMode, audioFiles, audioInterleaved,
    muxAudio, sourceBitDepth, useGPU,
  } = encodeParams;

  // Pick encoder
  const gpu = (useGPU !== false) && activeGPUEncoder;
  const encodeFFmpeg = gpu ? gpu.ffmpegPath : activeFFmpegPath;
  const encoderName  = gpu ? gpu.name : 'libx265';
  const encoderLabel = gpu ? gpu.label : 'CPU libx265';

  // Build folder structure
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

  // Build ffmpeg args via pure function
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

  return new Promise(resolve => {
    let stderr = '';
    const totalFrames = encodeParams.totalFrames || null;
    const encodeStartMs = Date.now();
    let lastFrameSeen = 0;
    let lastFpsSeen = null;

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

        mainWindow?.webContents.send('encode:progress', {
          frame: currentFrame,
          time: timeMatch ? timeMatch[1] : null,
          speed: speedMatch ? parseFloat(speedMatch[1]) : null,
          fps: fps || null,
          totalFrames,
          etaSeconds,
          elapsedMs: Date.now() - encodeStartMs,
        });
      }
      mainWindow?.webContents.send('encode:log', chunk);
    });

    encodeProcess.on('close', async code => {
      encodeProcess = null;
      if (code !== 0) {
        resolve({ error: `FFmpeg exited with code ${code}`, stderr });
        return;
      }

      // Audio processing (stems / interleaved / mux)
      const audioResult = await processAudio({
        audioMode, audioFiles, audioInterleaved,
        audioFolder, filmTitle: safeName,
        muxAudio, outputVideoPath,
        ffmpegPath: activeFFmpegPath,
        ffprobePath: activeFFprobePath,
      });

      const videoStat = fs.existsSync(outputVideoPath) ? fs.statSync(outputVideoPath) : null;
      const videoMd5 = videoStat ? await computeMd5(outputVideoPath).catch(() => null) : null;

      // x265 params for the report (CPU only)
      let x265ParamsForReport = null;
      if (!gpu) {
        x265ParamsForReport = config.video.x265_params;
        if (resolution.label === '8K' && frameRate === 60) {
          const vbv = config.video.high_res_high_fps_vbv;
          x265ParamsForReport += `:vbv-maxrate=${vbv.vbv_maxrate}:vbv-bufsize=${vbv.vbv_bufsize}`;
        }
      }

      // Combined warnings from encode-time + audio processing
      const allWarnings = [...(encodeParams.warnings || []), ...audioResult.warnings];

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

      resolve({
        success: true,
        deliveryFolder, reportPath, report,
        audioResult, videoMd5,
        videoSizeBytes: videoStat?.size || 0,
      });
    });

    encodeProcess.on('error', err => {
      encodeProcess = null;
      resolve({ error: err.message });
    });
  });
});

ipcMain.handle('encode:cancel', () => {
  if (encodeProcess) {
    encodeProcess.kill('SIGTERM');
    encodeProcess = null;
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
  if (!platform.isMac()) app.quit();
});
