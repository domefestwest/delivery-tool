/**
 * platform.js — single source of truth for ALL platform-dependent behavior.
 *
 * Every `process.platform === 'win32'` decision in the codebase MUST go through
 * a function exported here. This makes cross-platform behavior:
 *   1. Testable — pass a fake platform string to any function
 *   2. Auditable — one place to grep when checking Windows/Linux support
 *   3. Refactorable — change platform behavior once, applies everywhere
 *
 * Conventions:
 *   - All exported functions accept an optional `platform` arg (defaults to `process.platform`)
 *   - All path-building functions use `path.join()` — never string concatenation
 *   - Platform values: 'darwin' (macOS), 'win32' (Windows), 'linux' (everything else)
 */

const path = require('path');

const DEFAULT_PLATFORM = process.platform;

// ─── Predicates ───────────────────────────────────────────────────────────────

const isWin   = (p = DEFAULT_PLATFORM) => p === 'win32';
const isMac   = (p = DEFAULT_PLATFORM) => p === 'darwin';
const isLinux = (p = DEFAULT_PLATFORM) => p !== 'win32' && p !== 'darwin';

// ─── Binary names ─────────────────────────────────────────────────────────────

/** Returns the bundled directory name for this platform's binaries (mac/win/linux). */
function bundleDirName(platform = DEFAULT_PLATFORM) {
  if (isMac(platform))   return 'mac';
  if (isWin(platform))   return 'win';
  return 'linux';
}

/** Returns the executable filename (with .exe on Windows). */
function binaryName(name, platform = DEFAULT_PLATFORM) {
  return isWin(platform) ? `${name}.exe` : name;
}

// ─── Bundled FFmpeg path resolution ───────────────────────────────────────────

/**
 * Returns the absolute path to the bundled FFmpeg binary.
 * - In dev (unpackaged): {appRoot}/ffmpeg/{platform}/ffmpeg[.exe]
 * - In packaged app: {process.resourcesPath}/ffmpeg/{platform}/ffmpeg[.exe]
 *
 * @param {object} opts
 * @param {string} opts.appRoot      — typically __dirname of main.js (project root in dev)
 * @param {string} opts.resourcesPath — process.resourcesPath in packaged apps
 * @param {boolean} opts.isPackaged  — app.isPackaged
 * @param {string} [opts.platform]   — for testing; defaults to process.platform
 */
function getBundledFFmpegPath({ appRoot, resourcesPath, isPackaged, platform = DEFAULT_PLATFORM }) {
  const dir = bundleDirName(platform);
  const file = binaryName('ffmpeg', platform);
  const relative = path.join('ffmpeg', dir, file);
  return isPackaged
    ? path.join(resourcesPath, relative)
    : path.join(appRoot, relative);
}

/**
 * Returns the absolute path to FFprobe, given the FFmpeg binary path.
 * FFprobe always lives next to FFmpeg.
 */
function getFFprobePath(ffmpegPath, platform = DEFAULT_PLATFORM) {
  const dir = path.dirname(ffmpegPath);
  return path.join(dir, binaryName('ffprobe', platform));
}

// ─── System (PATH) ffmpeg candidates ──────────────────────────────────────────

/**
 * Returns an ordered list of system ffmpeg binary candidates to try.
 * On macOS: prefers Homebrew (Apple Silicon then Intel), then PATH.
 * On Windows: just 'ffmpeg.exe' (relies on PATH).
 * On Linux: prefers /usr/local/bin, then PATH.
 */
function getSystemFFmpegCandidates(platform = DEFAULT_PLATFORM) {
  if (isMac(platform)) {
    return [
      '/opt/homebrew/bin/ffmpeg',  // Apple Silicon Homebrew
      '/usr/local/bin/ffmpeg',     // Intel Homebrew + MacPorts
      'ffmpeg',                    // fallback to PATH
    ];
  }
  if (isWin(platform)) {
    return ['ffmpeg.exe'];
  }
  return [
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
    'ffmpeg',
  ];
}

/**
 * Given an ffmpeg binary path, returns the matching ffprobe path.
 * Used for system binaries — preserves the original binary's directory.
 */
function ffprobeForSystem(ffmpegBin, platform = DEFAULT_PLATFORM) {
  // Replace 'ffmpeg' or 'ffmpeg.exe' at the end with 'ffprobe' or 'ffprobe.exe'
  if (isWin(platform)) {
    return ffmpegBin.replace(/ffmpeg(\.exe)?$/i, 'ffprobe.exe');
  }
  return ffmpegBin.replace(/ffmpeg$/, 'ffprobe');
}

// ─── chmod safety ─────────────────────────────────────────────────────────────

/**
 * Returns true if we should attempt chmod +x on the binary.
 * Windows files don't use Unix execute bits, so it's a no-op there.
 */
function needsExecutableBit(platform = DEFAULT_PLATFORM) {
  return !isWin(platform);
}

// ─── Path normalization for FFmpeg arguments ──────────────────────────────────

/**
 * FFmpeg accepts both / and \ on Windows, but Node fs.* expects the native
 * separator. This converts the path to the platform's native separator,
 * which is what path.join() already does.
 *
 * Use this when joining a folder string from the renderer with a user-typed
 * pattern (e.g. "render_%04d.png"). The folder string from showOpenDialog
 * uses native separators, but a user-typed pattern might use either.
 */
function joinPattern(folder, pattern, platform = DEFAULT_PLATFORM) {
  // Strip any leading separator from the pattern to avoid double-separator
  const cleaned = pattern.replace(/^[\\/]+/, '');
  return path.join(folder, cleaned);
}

// ─── Default output directory (artist's Desktop) ──────────────────────────────

/**
 * Returns the default output directory for delivery packages.
 * In a real Electron context, prefer app.getPath('desktop').
 * This pure version is used in tests and fallback logic.
 */
function defaultOutputDir(homeDir, platform = DEFAULT_PLATFORM) {
  if (isWin(platform)) {
    return path.join(homeDir, 'Desktop');
  }
  // macOS and Linux: ~/Desktop is standard
  return path.join(homeDir, 'Desktop');
}

module.exports = {
  // Predicates
  isWin, isMac, isLinux,
  // Binary names
  bundleDirName, binaryName,
  // Path resolution
  getBundledFFmpegPath, getFFprobePath,
  getSystemFFmpegCandidates, ffprobeForSystem,
  // Helpers
  needsExecutableBit, joinPattern, defaultOutputDir,
};
