const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const crypto = require('crypto');
const os = require('os');

const isDev = process.env.ELECTRON_START_URL || !app.isPackaged;

// ─── Version ──────────────────────────────────────────────────────────────────
// Read from package.json so it stays in sync with npm version
function getAppVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    return pkg.version;
  } catch (_) {
    return app.getVersion();
  }
}

// ─── FFmpeg path resolution ───────────────────────────────────────────────────

function getBundledFFmpegPath() {
  const platform = process.platform;
  let relativePath;
  if (platform === 'darwin') {
    relativePath = path.join('ffmpeg', 'mac', 'ffmpeg');
  } else if (platform === 'win32') {
    relativePath = path.join('ffmpeg', 'win', 'ffmpeg.exe');
  } else {
    relativePath = path.join('ffmpeg', 'linux', 'ffmpeg');
  }

  // In production: extraResources lands in process.resourcesPath
  // In dev: relative to project root
  if (app.isPackaged) {
    return path.join(process.resourcesPath, relativePath);
  } else {
    return path.join(__dirname, relativePath);
  }
}

function getFFprobePath(ffmpegPath) {
  // ffprobe lives alongside ffmpeg
  const dir = path.dirname(ffmpegPath);
  const ext = process.platform === 'win32' ? '.exe' : '';
  return path.join(dir, `ffprobe${ext}`);
}

// ─── Dependency check ─────────────────────────────────────────────────────────

function runWithTimeout(bin, args, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const proc = spawn(bin, args, { timeout: timeoutMs });
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
    setTimeout(() => {
      proc.kill();
      reject(new Error('Timeout'));
    }, timeoutMs);
  });
}

async function checkFFmpegCapabilities(ffmpegBin) {
  // Get version string
  const versionResult = await runWithTimeout(ffmpegBin, ['-version']);
  const combined = versionResult.stdout + versionResult.stderr;
  const versionMatch = combined.match(/ffmpeg version ([^\s]+)/);
  const version = versionMatch ? versionMatch[1] : 'unknown';

  // Check for libx265 in encoders
  const encodersResult = await runWithTimeout(ffmpegBin, ['-encoders']);
  const encoderOutput = encodersResult.stdout + encodersResult.stderr;
  const hasX265 = /libx265/.test(encoderOutput);

  // Check for 10-bit support
  let has10Bit = false;
  if (hasX265) {
    const detailResult = await runWithTimeout(ffmpegBin, ['-h', 'encoder=libx265']);
    const detailOutput = detailResult.stdout + detailResult.stderr;
    // 10-bit shows up in the pix_fmts or as yuv420p10le / yuv422p10le etc.
    has10Bit = /yuv420p10le|10.?bit|10bit/i.test(detailOutput);
  }

  return { version, hasX265, has10Bit };
}

// ─── GPU encoder detection ────────────────────────────────────────────────────

// GPU encoder priority order per platform
const GPU_ENCODER_CANDIDATES = {
  darwin: [
    // macOS: VideoToolbox — MUST use system/Homebrew ffmpeg (static builds break VT entitlements)
    {
      name: 'hevc_videotoolbox',
      label: 'Apple VideoToolbox (GPU)',
      pixFmt: 'p010le',       // 10-bit YUV 4:2:0 — what VT outputs
      outputPixFmt: 'yuv420p10le', // what ffprobe reads back
      profile: 'main10',
      extraArgs: [],
      qualityArgs: ['-q:v', '55'], // VT quality 0-100, ~55-65 ≈ CRF 18 visually
      requiresSystemFFmpeg: true,  // static builds can't access VT entitlements
    },
  ],
  win32: [
    {
      name: 'hevc_nvenc',
      label: 'NVIDIA NVENC (GPU)',
      pixFmt: 'p010le',
      outputPixFmt: 'yuv420p10le',
      profile: 'main10',
      extraArgs: ['-spatial_aq', '1', '-temporal_aq', '1'],
      qualityArgs: ['-rc', 'vbr', '-cq', '18', '-b:v', '0', '-maxrate', '0', '-preset', 'p7'],
      requiresSystemFFmpeg: false,
    },
    {
      name: 'hevc_qsv',
      label: 'Intel Quick Sync (GPU)',
      pixFmt: 'p010le',
      outputPixFmt: 'yuv420p10le',
      profile: 'main10',
      extraArgs: [],
      qualityArgs: ['-global_quality', '18', '-preset', 'veryslow'],
      requiresSystemFFmpeg: false,
    },
    {
      name: 'hevc_amf',
      label: 'AMD AMF (GPU)',
      pixFmt: 'p010le',
      outputPixFmt: 'yuv420p10le',
      profile: 'main10',
      extraArgs: [],
      qualityArgs: ['-quality', 'quality', '-qp_i', '18', '-qp_p', '20', '-qp_b', '22'],
      requiresSystemFFmpeg: false,
    },
  ],
  linux: [
    {
      name: 'hevc_nvenc',
      label: 'NVIDIA NVENC (GPU)',
      pixFmt: 'p010le',
      outputPixFmt: 'yuv420p10le',
      profile: 'main10',
      extraArgs: ['-spatial_aq', '1', '-temporal_aq', '1'],
      qualityArgs: ['-rc', 'vbr', '-cq', '18', '-b:v', '0', '-preset', 'p7'],
      requiresSystemFFmpeg: false,
    },
    {
      name: 'hevc_vaapi',
      label: 'VA-API (GPU)',
      pixFmt: 'p010le',
      outputPixFmt: 'yuv420p10le',
      profile: 'main10',
      extraArgs: ['-vaapi_device', '/dev/dri/renderD128'],
      qualityArgs: ['-rc_mode', 'CQP', '-qp', '18'],
      requiresSystemFFmpeg: false,
    },
  ],
};

/**
 * Find system ffmpeg on PATH (used for GPU encoding on macOS where
 * static binaries can't access VideoToolbox entitlements).
 */
async function findSystemFFmpeg() {
  const bins = process.platform === 'win32'
    ? ['ffmpeg.exe']
    : ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg'];

  for (const bin of bins) {
    try {
      const r = await runWithTimeout(bin, ['-version'], 5000);
      if (r.code === 0 || (r.stdout + r.stderr).includes('ffmpeg version')) {
        const ver = (r.stdout + r.stderr).match(/ffmpeg version ([^\s]+)/);
        const ffprobeBin = bin.replace('ffmpeg', 'ffprobe');
        return { path: bin, version: ver?.[1] || 'unknown', ffprobePath: ffprobeBin };
      }
    } catch (_) {}
  }
  return null;
}

/**
 * Test a specific GPU encoder with a 1-second synthetic encode.
 * Returns { works: bool, encoder, label, pixFmt, qualityArgs, ... }
 */
async function testGPUEncoder(ffmpegBin, candidate) {
  const testOutput = path.join(os.tmpdir(), `dfw_gpu_test_${candidate.name}.mp4`);
  try {
    const args = [
      '-y',
      '-f', 'lavfi', '-i', 'color=c=0x102030:s=128x128:r=30',
      '-frames:v', '5',
      '-c:v', candidate.name,
      '-pix_fmt', candidate.pixFmt,
      '-profile:v', candidate.profile,
      ...candidate.qualityArgs,
      ...candidate.extraArgs,
      testOutput
    ];
    const result = await runWithTimeout(ffmpegBin, args, 15000);
    const combined = result.stdout + result.stderr;

    // Verify file was actually written and has content
    const stat = fs.existsSync(testOutput) ? fs.statSync(testOutput) : null;
    const works = stat && stat.size > 0 && !combined.includes('Conversion failed');

    if (fs.existsSync(testOutput)) fs.unlinkSync(testOutput);
    return works;
  } catch (_) {
    if (fs.existsSync(testOutput)) try { fs.unlinkSync(testOutput); } catch (_) {}
    return false;
  }
}

/**
 * Full GPU encoder detection. Returns best available GPU config or null.
 */
async function detectGPUEncoder(bundledFFmpegPath) {
  const platform = process.platform;
  const candidates = GPU_ENCODER_CANDIDATES[platform] || [];

  for (const candidate of candidates) {
    let ffmpegBin = bundledFFmpegPath;

    if (candidate.requiresSystemFFmpeg) {
      // Must use system ffmpeg (e.g. macOS VideoToolbox needs framework entitlements)
      const sysFfmpeg = await findSystemFFmpeg();
      if (!sysFfmpeg) {
        console.log(`[GPU] ${candidate.name}: requires system ffmpeg, not found — skipping`);
        continue;
      }
      ffmpegBin = sysFfmpeg.path;
      console.log(`[GPU] Testing ${candidate.name} with system ffmpeg: ${ffmpegBin}`);
    } else {
      console.log(`[GPU] Testing ${candidate.name} with bundled ffmpeg`);
    }

    // Check encoder is listed
    try {
      const encoderList = await runWithTimeout(ffmpegBin, ['-encoders'], 8000);
      if (!new RegExp(candidate.name).test(encoderList.stdout + encoderList.stderr)) {
        console.log(`[GPU] ${candidate.name}: not in encoder list — skipping`);
        continue;
      }
    } catch (_) { continue; }

    // Run test encode
    const works = await testGPUEncoder(ffmpegBin, candidate);
    if (works) {
      console.log(`[GPU] ✓ ${candidate.name} works — using GPU acceleration`);
      return {
        ...candidate,
        ffmpegPath: ffmpegBin,
        available: true,
      };
    } else {
      console.log(`[GPU] ✗ ${candidate.name}: test encode failed`);
    }
  }

  console.log('[GPU] No working GPU encoder found — will use CPU libx265');
  return null;
}

async function runDependencyCheck() {
  console.log('[DependencyCheck] Starting dependency check…');

  const bundledPath = getBundledFFmpegPath();
  console.log('[DependencyCheck] Bundled FFmpeg path:', bundledPath);

  // 1. Try bundled binary for libx265
  let depResult = null;

  if (fs.existsSync(bundledPath)) {
    console.log('[DependencyCheck] Bundled binary found. Checking capabilities…');
    if (process.platform !== 'win32') {
      try { fs.chmodSync(bundledPath, 0o755); } catch (_) {}
    }
    try {
      const caps = await checkFFmpegCapabilities(bundledPath);
      console.log('[DependencyCheck] Bundled result:', caps);
      if (caps.hasX265 && caps.has10Bit) {
        const ffprobePath = getFFprobePath(bundledPath);
        if (process.platform !== 'win32' && fs.existsSync(ffprobePath)) {
          try { fs.chmodSync(ffprobePath, 0o755); } catch (_) {}
        }
        depResult = {
          found: true,
          path: bundledPath,
          ffprobePath: fs.existsSync(ffprobePath) ? ffprobePath : null,
          version: caps.version,
          has10BitX265: true,
          source: 'bundled',
          warning: null
        };
      }
    } catch (err) {
      console.log('[DependencyCheck] Bundled binary failed:', err.message);
    }
  } else {
    console.log('[DependencyCheck] Bundled binary not found at:', bundledPath);
  }

  // 2. Fall back to system FFmpeg if bundled not available
  if (!depResult) {
    console.log('[DependencyCheck] Trying system FFmpeg…');
    const systemBin = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    try {
      const caps = await checkFFmpegCapabilities(systemBin);
      console.log('[DependencyCheck] System FFmpeg result:', caps);
      if (caps.hasX265 && caps.has10Bit) {
        const systemFFprobe = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
        depResult = {
          found: true,
          path: systemBin,
          ffprobePath: systemFFprobe,
          version: caps.version,
          has10BitX265: true,
          source: 'system',
          warning: "Using system FFmpeg. For best results, reinstall this app to restore the bundled version."
        };
      } else if (caps.version !== 'unknown') {
        return {
          found: true,
          path: systemBin,
          ffprobePath: null,
          version: caps.version,
          has10BitX265: false,
          source: 'system',
          warning: "FFmpeg was found, but this version does not support 10-bit H.265 encoding, which is required for dome delivery. Please install a full FFmpeg build that includes libx265.",
          gpu: null
        };
      }
    } catch (err) {
      console.log('[DependencyCheck] System FFmpeg not found or failed:', err.message);
    }
  }

  if (!depResult) {
    console.log('[DependencyCheck] No working FFmpeg found.');
    return { found: false, path: null, ffprobePath: null, version: null, has10BitX265: false, source: null, warning: null, gpu: null };
  }

  // 3. GPU encoder detection (runs in parallel with the result we already have)
  console.log('[DependencyCheck] Probing GPU encoders…');
  let gpuEncoder = null;
  try {
    gpuEncoder = await detectGPUEncoder(depResult.path);
  } catch (err) {
    console.log('[DependencyCheck] GPU detection error (non-fatal):', err.message);
  }

  return {
    ...depResult,
    gpu: gpuEncoder ? {
      available: true,
      name: gpuEncoder.name,
      label: gpuEncoder.label,
      ffmpegPath: gpuEncoder.ffmpegPath,
      pixFmt: gpuEncoder.pixFmt,
      profile: gpuEncoder.profile,
      qualityArgs: gpuEncoder.qualityArgs,
      extraArgs: gpuEncoder.extraArgs,
    } : { available: false, label: 'CPU libx265 (no GPU encoder detected)' }
  };
}

// ─── App state ────────────────────────────────────────────────────────────────

let mainWindow = null;
let depCheckResult = null;
let activeFFmpegPath = null;
let activeFFprobePath = null;
let activeConfig = null;
let encodeProcess = null;
let activeGPUEncoder = null;   // detected GPU encoder config, or null

function loadDefaultConfig() {
  const configPath = app.isPackaged
    ? path.join(process.resourcesPath, 'dfw_config.json')
    : path.join(__dirname, 'dfw_config.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw);
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
      sandbox: false
    }
  });

  const startUrl = process.env.ELECTRON_START_URL || `file://${path.join(__dirname, 'build', 'index.html')}`;
  mainWindow.loadURL(startUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

function applyDepResult(result) {
  if (result.found && result.has10BitX265) {
    activeFFmpegPath = result.path;
    activeFFprobePath = result.ffprobePath;
    activeGPUEncoder = result.gpu?.available ? result.gpu : null;
  }
}

// Dependency check
ipcMain.handle('dep:check', async () => {
  depCheckResult = await runDependencyCheck();
  applyDepResult(depCheckResult);
  console.log('[DependencyCheck] Final result:', JSON.stringify(depCheckResult, null, 2));
  return depCheckResult;
});

// Re-run dependency check (retry button on onboarding screen)
ipcMain.handle('dep:recheck', async () => {
  depCheckResult = await runDependencyCheck();
  applyDepResult(depCheckResult);
  console.log('[DependencyCheck] Recheck result:', JSON.stringify(depCheckResult, null, 2));
  return depCheckResult;
});

// Load festival config
ipcMain.handle('config:load-default', () => {
  activeConfig = loadDefaultConfig();
  return activeConfig;
});

ipcMain.handle('config:load-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Load Festival Config',
    filters: [{ name: 'JSON Config', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths.length) return null;
  try {
    const raw = fs.readFileSync(result.filePaths[0], 'utf8');
    const config = JSON.parse(raw);
    activeConfig = config;
    return config;
  } catch (err) {
    return { error: 'Failed to parse config: ' + err.message };
  }
});

// File / folder pickers
ipcMain.handle('dialog:open-folder', async (_, opts) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: opts?.title || 'Select Folder',
    properties: ['openDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:open-file', async (_, opts) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: opts?.title || 'Select File',
    filters: opts?.filters || [],
    properties: ['openFile']
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:open-files', async (_, opts) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: opts?.title || 'Select Files',
    filters: opts?.filters || [],
    properties: ['openFile', 'multiSelections']
  });
  return result.canceled ? null : result.filePaths;
});

ipcMain.handle('dialog:save-folder', async (_, opts) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: opts?.title || 'Choose Output Folder',
    properties: ['openDirectory', 'createDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});

// Open folder in Finder/Explorer
ipcMain.handle('shell:open-path', async (_, filePath) => {
  await shell.openPath(filePath);
});

// ─── PNG sequence scanning ─────────────────────────────────────────────────────

ipcMain.handle('scan:png-sequence', async (_, folderPath) => {
  try {
    const files = fs.readdirSync(folderPath).filter(f => /\.png$/i.test(f)).sort();
    if (!files.length) return { error: 'No PNG files found in this folder.' };

    // Detect naming patterns: look for zero-padded number sequences
    // Patterns: frame_0001.png, render.0001.png, 0001.png, anything_####.png
    // NOTE: regex requires prefix to match at least 2 digits OR allow empty prefix (bare numbers)
    const patterns = {};
    for (const file of files) {
      // Match: optional prefix + 2-10 digit run + .png
      // Allows bare number files like 0001.png (empty prefix)
      const m = file.match(/^(.*?)(\d{2,10})(\.png)$/i);
      if (m) {
        const prefix = m[1];   // may be empty string for bare number sequences
        const numLen = m[2].length;
        const key = `${prefix}${'#'.repeat(numLen)}.png`;
        if (!patterns[key]) patterns[key] = [];
        patterns[key].push(file);
      }
    }

    const bestPattern = Object.entries(patterns)
      .sort((a, b) => b[1].length - a[1].length)[0];

    if (!bestPattern) {
      return { error: 'Could not detect a consistent numbered PNG sequence. Try entering the pattern manually.' };
    }

    const [patternStr, matchedFiles] = bestPattern;
    const frameCount = matchedFiles.length;

    // Detect bit depth from first frame via ffprobe
    let bitDepth = null;
    if (activeFFprobePath) {
      try {
        const firstFrame = path.join(folderPath, matchedFiles[0]);
        const probe = await runWithTimeout(activeFFprobePath, [
          '-v', 'error',
          '-select_streams', 'v:0',
          '-show_entries', 'stream=bits_per_raw_sample,pix_fmt',
          '-of', 'json',
          firstFrame
        ]);
        const info = JSON.parse(probe.stdout || '{}');
        const stream = info?.streams?.[0];
        if (stream) {
          const bprs = parseInt(stream.bits_per_raw_sample, 10);
          const pf = stream.pix_fmt || '';
          // 16-bit PNG pixel formats: rgb48be, rgb48le, rgba64be, rgba64le, gray16be/le, etc.
          if (bprs === 16 || /16|48|64/.test(pf)) bitDepth = 16;
          // 8-bit PNG pixel formats: rgb24, rgba, gray, pal8, etc.
          else if (bprs === 8 || pf === 'rgb24' || pf === 'rgba' || pf === 'gray' || pf === 'pal8' || /^rgb24|^rgba$/.test(pf)) bitDepth = 8;
          // Fallback: anything without explicit 16-bit markers is treated as 8-bit
          else if (pf && !bitDepth) bitDepth = 8;
        }
      } catch (_) {}
    }

    // Build ffmpeg glob pattern
    // Get the number portion details from first file
    const firstFile = matchedFiles[0];
    const m = firstFile.match(/^(.*?)(\d{2,10})(\.png)$/i);
    const prefix = m[1];
    const numLen = m[2].length;
    const ffmpegPattern = path.join(folderPath, `${prefix}%0${numLen}d.png`);

    return {
      pattern: patternStr,
      ffmpegPattern,
      frameCount,
      bitDepth,
      firstFrame: path.join(folderPath, matchedFiles[0]),
      lastFrame: path.join(folderPath, matchedFiles[matchedFiles.length - 1])
    };
  } catch (err) {
    return { error: err.message };
  }
});

// ─── Video file probing ─────────────────────────────────────────────────────────

ipcMain.handle('probe:video', async (_, filePath) => {
  if (!activeFFprobePath) return { error: 'FFprobe not available.' };
  try {
    const result = await runWithTimeout(activeFFprobePath, [
      '-v', 'error',
      '-show_streams',
      '-show_format',
      '-of', 'json',
      filePath
    ]);
    const info = JSON.parse(result.stdout || '{}');
    const videoStream = info.streams?.find(s => s.codec_type === 'video');
    const audioStream = info.streams?.find(s => s.codec_type === 'audio');

    if (!videoStream) return { error: 'No video stream found in file.' };

    // Parse frame rate
    let fps = null;
    if (videoStream.r_frame_rate) {
      const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
      fps = den ? num / den : num;
    }

    const bitDepth = parseInt(videoStream.bits_per_raw_sample, 10) ||
      (/10/.test(videoStream.pix_fmt) ? 10 : 8);

    return {
      width: videoStream.width,
      height: videoStream.height,
      fps: fps ? Math.round(fps * 100) / 100 : null,
      codec: videoStream.codec_name,
      pixFmt: videoStream.pix_fmt,
      bitDepth,
      colorSpace: videoStream.color_space,
      colorPrimaries: videoStream.color_primaries,
      colorTrc: videoStream.color_transfer,
      duration: parseFloat(info.format?.duration) || null,
      fileSizeBytes: parseInt(info.format?.size, 10) || null,
      audioChannels: audioStream ? parseInt(audioStream.channels, 10) : 0,
      audioSampleRate: audioStream ? parseInt(audioStream.sample_rate, 10) : null,
      audioBitrate: audioStream?.bit_rate || null
    };
  } catch (err) {
    return { error: err.message };
  }
});

// ─── Audio probing ──────────────────────────────────────────────────────────────

ipcMain.handle('probe:audio', async (_, filePath) => {
  if (!activeFFprobePath) return { error: 'FFprobe not available.' };
  try {
    const result = await runWithTimeout(activeFFprobePath, [
      '-v', 'error',
      '-show_streams',
      '-of', 'json',
      filePath
    ]);
    const info = JSON.parse(result.stdout || '{}');
    const audioStream = info.streams?.find(s => s.codec_type === 'audio');
    if (!audioStream) return { error: 'No audio stream found.' };

    // Check for ambisonic metadata
    const tags = audioStream.tags || {};
    const isAmbisonic = /ambi/i.test(JSON.stringify(tags)) ||
      /ambisonic/i.test(audioStream.channel_layout || '');

    return {
      channels: parseInt(audioStream.channels, 10),
      channelLayout: audioStream.channel_layout,
      sampleRate: parseInt(audioStream.sample_rate, 10),
      codec: audioStream.codec_name,
      isAmbisonic,
      duration: parseFloat(audioStream.duration) || null
    };
  } catch (err) {
    return { error: err.message };
  }
});

// ─── Encode ───────────────────────────────────────────────────────────────────

ipcMain.handle('encode:start', async (event, encodeParams) => {
  if (!activeFFmpegPath) return { error: 'FFmpeg not available.' };
  if (encodeProcess) return { error: 'An encode is already running.' };

  const {
    sourceType,       // 'png' | 'video'
    sourcePath,       // folder for png, file for video
    ffmpegPattern,    // for png sequences
    frameRate,
    resolution,
    outputDir,
    filmTitle,
    artistName,
    config,
    audioMode,        // 'stems' | 'interleaved' | 'none'
    audioFiles,       // array of { channel, filePath }
    audioInterleaved,
    muxAudio,
    sourceBitDepth,   // for png sequences
    useGPU,           // boolean — artist choice (defaults true if GPU available)
  } = encodeParams;

  // Determine which encoder to use
  const gpu = (useGPU !== false) && activeGPUEncoder;
  const encodeFFmpeg = gpu ? gpu.ffmpegPath : activeFFmpegPath;
  const encoderName  = gpu ? gpu.name : 'libx265';
  const encoderLabel = gpu ? gpu.label : 'CPU libx265';

  // Build output folder
  const year = config.version;
  const safeName = filmTitle.replace(/[^a-zA-Z0-9_-]/g, '_');
  const folderName = `${safeName}_DFW${year}`;
  const deliveryFolder = path.join(outputDir, folderName);
  const videoFolder = path.join(deliveryFolder, 'video');
  const audioFolder = path.join(deliveryFolder, 'audio');

  fs.mkdirSync(videoFolder, { recursive: true });
  fs.mkdirSync(audioFolder, { recursive: true });

  const outputFilename = `${safeName}_DFW${year}_${resolution.label}.mp4`;
  const outputVideoPath = path.join(videoFolder, outputFilename);

  // ── Build ffmpeg arguments ────────────────────────────────────────────────
  const ffArgs = [];

  if (sourceType === 'png') {
    ffArgs.push('-framerate', String(frameRate));
    ffArgs.push('-i', ffmpegPattern);
  } else {
    ffArgs.push('-i', sourcePath);
    ffArgs.push('-r', String(frameRate));
  }

  // ── Video codec ───────────────────────────────────────────────────────────
  if (gpu) {
    // GPU path: use detected hardware encoder
    ffArgs.push('-c:v', gpu.name);
    ffArgs.push('-pix_fmt', gpu.pixFmt);
    ffArgs.push('-profile:v', gpu.profile);
    ffArgs.push(...gpu.qualityArgs);
    if (gpu.extraArgs?.length) ffArgs.push(...gpu.extraArgs);
  } else {
    // CPU path: libx265 with full quality params from config
    let x265Params = config.video.x265_params;
    if (resolution.label === '8K' && frameRate === 60) {
      const vbv = config.video.high_res_high_fps_vbv;
      x265Params += `:vbv-maxrate=${vbv.vbv_maxrate}:vbv-bufsize=${vbv.vbv_bufsize}`;
    }
    ffArgs.push('-c:v', 'libx265');
    ffArgs.push('-pix_fmt', config.video.pix_fmt);
    ffArgs.push('-crf', String(config.video.crf));
    ffArgs.push('-preset', config.video.preset);
    ffArgs.push('-x265-params', x265Params);
  }

  // ── Color space tagging ───────────────────────────────────────────────────
  if (sourceType === 'png') {
    if (sourceBitDepth === 16) {
      ffArgs.push('-colorspace', 'bt2020nc');
      ffArgs.push('-color_primaries', 'bt2020');
      ffArgs.push('-color_trc', 'smpte2084');
    } else {
      ffArgs.push('-colorspace', 'bt709');
      ffArgs.push('-color_primaries', 'bt709');
      ffArgs.push('-color_trc', 'bt709');
    }
  }

  // No audio in main video file unless mux is requested
  ffArgs.push('-an');
  ffArgs.push(outputVideoPath);

  const cmdLine = `${encodeFFmpeg} ${ffArgs.join(' ')}`;
  console.log(`[Encode] Using ${encoderLabel}`);
  console.log('[Encode] FFmpeg command:', cmdLine);
  mainWindow?.webContents.send('encode:log', `Encoder: ${encoderLabel}\nCommand:\n${cmdLine}\n`);
  mainWindow?.webContents.send('encode:encoder', { name: encoderName, label: encoderLabel, isGPU: !!gpu });

  return new Promise((resolve) => {
    let stderr = '';
    const totalFrames = encodeParams.totalFrames || null;
    let encodeStartMs = Date.now();
    let lastFrameSeen = 0;
    let lastFpsSeen = null;

    encodeProcess = spawn(encodeFFmpeg, ffArgs);

    encodeProcess.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;

      // Parse progress from ffmpeg output
      // FFmpeg progress line: frame=  123 fps= 45 q=26.0 size=  1024kB time=00:00:04.10 bitrate= 204.1kbits/s speed=1.37x
      const frameMatch = chunk.match(/frame=\s*(\d+)/);
      const timeMatch  = chunk.match(/time=(\d+:\d+:\d+\.\d+)/);
      const speedMatch = chunk.match(/speed=\s*([\d.]+)x/);
      const fpsMatch   = chunk.match(/fps=\s*([\d.]+)/);

      if (frameMatch || timeMatch) {
        const currentFrame = frameMatch ? parseInt(frameMatch[1], 10) : lastFrameSeen;
        const fps = fpsMatch ? parseFloat(fpsMatch[1]) : lastFpsSeen;
        lastFrameSeen = currentFrame;
        if (fps) lastFpsSeen = fps;

        // ETA calculation
        let etaSeconds = null;
        if (totalFrames && currentFrame > 0) {
          if (fps && fps > 0) {
            // Most accurate: remaining frames / current encoding fps
            etaSeconds = Math.round((totalFrames - currentFrame) / fps);
          } else if (speedMatch) {
            // Fallback: use speed multiplier + frame rate to estimate
            const speed = parseFloat(speedMatch[1]);
            const framesRemaining = totalFrames - currentFrame;
            const realtimeRemaining = framesRemaining / frameRate;
            etaSeconds = Math.round(realtimeRemaining / speed);
          }
        }

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

    encodeProcess.on('close', async (code) => {
      encodeProcess = null;

      if (code !== 0) {
        resolve({ error: `FFmpeg exited with code ${code}`, stderr });
        return;
      }

      // Process audio
      const audioResult = await processAudio({
        audioMode, audioFiles, audioInterleaved,
        audioFolder, filmTitle: safeName,
        muxAudio, outputVideoPath, outputFilename,
        videoFolder, config, ffmpegPath: activeFFmpegPath
      });

      // Compute MD5 checksum of output video
      let videoMd5 = null;
      try {
        videoMd5 = await computeMd5(outputVideoPath);
      } catch (_) {}

      const videoStat = fs.existsSync(outputVideoPath) ? fs.statSync(outputVideoPath) : null;
      const encodeDurationMs = Date.now() - encodeStartMs;

      // Rebuild x265Params for the report (only relevant for CPU path)
      let x265ParamsForReport = null;
      if (!gpu) {
        x265ParamsForReport = config.video.x265_params;
        if (resolution.label === '8K' && frameRate === 60) {
          const vbv = config.video.high_res_high_fps_vbv;
          x265ParamsForReport += `:vbv-maxrate=${vbv.vbv_maxrate}:vbv-bufsize=${vbv.vbv_bufsize}`;
        }
      }

      // Write delivery report
      const report = buildDeliveryReport({
        filmTitle, artistName, config,
        resolution, frameRate,
        sourceType, sourceBitDepth,
        encodeParams,
        outputVideoPath, outputFilename,
        videoSizeBytes: videoStat?.size || 0,
        videoMd5,
        audioResult,
        warnings: encodeParams.warnings || [],
        x265Params: x265ParamsForReport,
        encoderLabel,
        encoderName,
        isGPU: !!gpu,
        encodeDurationMs,
      });

      const reportPath = path.join(deliveryFolder, 'delivery_report.txt');
      fs.writeFileSync(reportPath, report, 'utf8');

      resolve({
        success: true,
        deliveryFolder,
        reportPath,
        report,
        audioResult,
        videoMd5,
        videoSizeBytes: videoStat?.size || 0
      });
    });

    encodeProcess.on('error', (err) => {
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

// ─── Audio processing ─────────────────────────────────────────────────────────

async function processAudio({ audioMode, audioFiles, audioInterleaved, audioFolder,
  filmTitle, muxAudio, outputVideoPath, outputFilename,
  videoFolder, config, ffmpegPath }) {

  if (audioMode === 'none') {
    const readmePath = path.join(audioFolder, 'README.txt');
    fs.writeFileSync(readmePath, 'No audio delivered with this submission.\n', 'utf8');
    return { mode: 'none', stems: [] };
  }

  const stemNames = ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'];
  const stems = [];
  const warnings = [];

  if (audioMode === 'stems') {
    // Copy/convert each stem to the audio folder
    for (const { channel, filePath } of audioFiles) {
      const destName = `${filmTitle}_${channel}.wav`;
      const destPath = path.join(audioFolder, destName);
      // Re-encode to ensure sample rate compliance
      await new Promise((resolve, reject) => {
        const proc = spawn(ffmpegPath, [
          '-i', filePath,
          '-ar', '44100',
          '-c:a', 'pcm_s24le',
          '-y', destPath
        ]);
        proc.on('close', resolve);
        proc.on('error', reject);
      });
      const md5 = await computeMd5(destPath).catch(() => null);
      stems.push({ channel, path: destPath, filename: destName, md5 });
    }
  } else if (audioMode === 'interleaved') {
    // Split interleaved 5.1 into individual stems
    // Use -filter_complex channelsplit (map_channel removed in FFmpeg 5+)
    const channelOrder = ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'];
    // Build filter_complex and output args for a single-pass split
    // channelsplit produces named outputs: FL, FR, FC, LFE, BL, BR for 5.1
    const fc51Map = { L: 'FL', R: 'FR', C: 'FC', LFE: 'LFE', Ls: 'BL', Rs: 'BR' };

    // Probe to see if it's actually 6-channel before splitting
    const probeArgs = ['-v', 'error', '-select_streams', 'a:0',
      '-show_entries', 'stream=channels', '-of', 'default', audioInterleaved];
    const probeResult = await runWithTimeout(ffmpegPath.replace('ffmpeg', 'ffprobe').replace(/ffmpeg(\.exe)?$/, (m) => m.replace('ffmpeg', 'ffprobe')), probeArgs)
      .catch(() => ({ stdout: '', stderr: '' }));
    // Fallback: use ffprobe path from active state
    const is6ch = /channels=6/.test(probeResult.stdout + probeResult.stderr);

    if (is6ch) {
      // Single-pass channelsplit: all 6 channels in one ffmpeg call
      const filterOutputs = channelOrder.map(ch => `[out_${ch}]`).join('');
      const filterStr = `[0:a]channelsplit=channel_layout=5.1${channelOrder.map((ch, i) => ``).join('')}[out_L][out_R][out_C][out_LFE][out_Ls][out_Rs]`;

      // Build output paths
      const stemPaths = {};
      for (const ch of channelOrder) {
        stemPaths[ch] = path.join(audioFolder, `${filmTitle}_${ch}.wav`);
      }

      // FFmpeg args: -filter_complex channelsplit, then map each output
      const splitArgs = ['-y', '-i', audioInterleaved,
        '-filter_complex', '[0:a]channelsplit=channel_layout=5.1[out_L][out_R][out_C][out_LFE][out_Ls][out_Rs]',
        '-map', '[out_L]',   '-ar', '44100', '-c:a', 'pcm_s24le', stemPaths['L'],
        '-map', '[out_R]',   '-ar', '44100', '-c:a', 'pcm_s24le', stemPaths['R'],
        '-map', '[out_C]',   '-ar', '44100', '-c:a', 'pcm_s24le', stemPaths['C'],
        '-map', '[out_LFE]', '-ar', '44100', '-c:a', 'pcm_s24le', stemPaths['LFE'],
        '-map', '[out_Ls]',  '-ar', '44100', '-c:a', 'pcm_s24le', stemPaths['Ls'],
        '-map', '[out_Rs]',  '-ar', '44100', '-c:a', 'pcm_s24le', stemPaths['Rs']
      ];

      await new Promise((resolve, reject) => {
        const proc = spawn(ffmpegPath, splitArgs);
        proc.on('close', resolve);
        proc.on('error', reject);
      });

      for (const ch of channelOrder) {
        const destPath = stemPaths[ch];
        const destName = path.basename(destPath);
        const md5 = await computeMd5(destPath).catch(() => null);
        stems.push({ channel: ch, path: destPath, filename: destName, md5 });
      }
    } else {
      // Stereo — just copy with sample rate normalization
      const destName = `${filmTitle}_Stereo.wav`;
      const destPath = path.join(audioFolder, destName);
      await new Promise((resolve, reject) => {
        const proc = spawn(ffmpegPath, ['-y', '-i', audioInterleaved,
          '-ar', '44100', '-c:a', 'pcm_s24le', destPath]);
        proc.on('close', resolve);
        proc.on('error', reject);
      });
      const md5 = await computeMd5(destPath).catch(() => null);
      stems.push({ channel: 'Stereo', path: destPath, filename: destName, md5 });
    }
  }

  // MUX audio into video if requested.
  // Strategy: mux into a temp file, then replace the audio-less original with it.
  // Result: only ONE video file exists — the canonical name always contains audio when mux is on.
  if (muxAudio && stems.length > 0) {
    const tempMuxPath = outputVideoPath + '.mux_tmp.mp4';
    const is51 = stems.length === 6;
    const bitrateFlag = is51 ? '384k' : '192k';

    const muxArgs = ['-y', '-i', outputVideoPath];
    for (const s of stems) {
      muxArgs.push('-i', s.path);
    }
    muxArgs.push('-c:v', 'copy');
    muxArgs.push('-c:a', 'aac');
    muxArgs.push('-b:a', bitrateFlag);
    if (is51) {
      muxArgs.push('-ac', '6');
      muxArgs.push('-channel_layout', '5.1');
    }
    muxArgs.push(tempMuxPath);

    let muxOk = false;
    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath, muxArgs);
      proc.on('close', (code) => { muxOk = code === 0; resolve(); });
      proc.on('error', reject);
    }).catch(err => warnings.push('MUX failed: ' + err.message));

    if (muxOk && fs.existsSync(tempMuxPath)) {
      // Replace the audio-less file with the muxed version — same canonical filename
      try {
        fs.unlinkSync(outputVideoPath);
        fs.renameSync(tempMuxPath, outputVideoPath);
      } catch (err) {
        warnings.push('MUX file replace failed: ' + err.message);
        // Leave temp file in place as fallback
      }
    } else if (fs.existsSync(tempMuxPath)) {
      try { fs.unlinkSync(tempMuxPath); } catch (_) {}
      warnings.push('MUX encode failed — delivery package contains video without embedded audio.');
    }
  }

  return { mode: audioMode, stems, warnings };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function computeMd5(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    stream.on('data', d => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function buildDeliveryReport({ filmTitle, artistName, config, resolution, frameRate,
  sourceType, sourceBitDepth, encodeParams, outputFilename,
  videoSizeBytes, videoMd5, audioResult, warnings, x265Params,
  encoderLabel, encoderName, isGPU, encodeDurationMs }) {

  const now = new Date();
  const dateStr = now.toISOString().replace('T', ' ').split('.')[0] + ' UTC';
  const lines = [];

  lines.push('='.repeat(60));
  lines.push(`${config.festival_name} ${config.version} — Delivery Report`);
  lines.push('='.repeat(60));
  lines.push('');
  lines.push(`Film Title:      ${filmTitle}`);
  lines.push(`Artist/Studio:   ${artistName || '(not provided)'}`);
  lines.push(`Festival:        ${config.festival_name} ${config.version}`);
  lines.push(`Encode Date:     ${dateStr}`);
  lines.push(`Encode Duration: ${encodeDurationMs ? formatDuration(encodeDurationMs) : 'unknown'}`);
  lines.push('');
  lines.push('── VIDEO ────────────────────────────────────────────────────');
  lines.push(`Output File:     ${outputFilename}`);
  lines.push(`Codec:           H.265 / HEVC`);
  lines.push(`Encoder:         ${encoderLabel || 'libx265 (CPU)'}`);
  lines.push(`Resolution:      ${resolution.width}×${resolution.height} (${resolution.label})`);
  lines.push(`Frame Rate:      ${frameRate}fps`);
  lines.push(`Bit Depth:       10-bit (yuv420p10le)`);
  if (!isGPU) {
    lines.push(`CRF:             ${config.video.crf}`);
    lines.push(`Preset:          ${config.video.preset}`);
    if (x265Params) lines.push(`x265-params:     ${x265Params}`);
  }
  lines.push(`File Size:       ${formatBytes(videoSizeBytes)}`);
  lines.push(`MD5 Checksum:    ${videoMd5 || '(unavailable)'}`);
  lines.push('');
  lines.push('── SOURCE ───────────────────────────────────────────────────');
  if (sourceType === 'png') {
    lines.push(`Source Type:     PNG Image Sequence`);
    lines.push(`Frame Count:     ${encodeParams.totalFrames || 'unknown'}`);
    lines.push(`Source Bit Depth:${sourceBitDepth ? sourceBitDepth + '-bit' : 'unknown'}`);
  } else {
    lines.push(`Source Type:     Video File`);
    lines.push(`Source Codec:    ${encodeParams.sourceCodec || 'unknown'}`);
    lines.push(`Source FPS:      ${encodeParams.sourceFps || 'unknown'}`);
  }
  lines.push('');
  lines.push('── AUDIO ────────────────────────────────────────────────────');
  if (audioResult.mode === 'none') {
    lines.push('Audio:           None delivered');
  } else {
    lines.push(`Audio Format:    ${audioResult.stems.length === 6 ? '5.1 Surround' : 'Stereo'}`);
    lines.push(`Sample Rate:     44.1 kHz`);
    lines.push(`Stems:`);
    for (const s of audioResult.stems) {
      lines.push(`  ${s.channel.padEnd(5)} ${s.filename}  MD5: ${s.md5 || '(unavailable)'}`);
    }
  }
  lines.push('');
  if (warnings.length > 0) {
    lines.push('── WARNINGS ─────────────────────────────────────────────────');
    for (const w of warnings) {
      lines.push(`  ⚠ ${w}`);
    }
    lines.push('');
  }
  lines.push('── TOOL INFO ────────────────────────────────────────────────');
  lines.push(`Tool Version:    v${getAppVersion()}`);
  lines.push(`FFmpeg Version:  ${depCheckResult?.version || 'unknown'}`);
  lines.push(`FFmpeg Source:   ${depCheckResult?.source || 'unknown'}`);
  lines.push(`GPU Encode:      ${isGPU ? 'Yes — ' + encoderName : 'No — CPU libx265'}`);
  lines.push('');
  lines.push('='.repeat(60));
  lines.push(`Delivery questions? Contact ${config.contact_email}`);
  lines.push(`${config.website}`);
  lines.push('='.repeat(60));

  return lines.join('\n');
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  activeConfig = loadDefaultConfig();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
