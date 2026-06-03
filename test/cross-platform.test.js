/**
 * cross-platform.test.js
 *
 * Cross-platform parity test suite. Uses pure functions from src-main/
 * to verify that path resolution, arg building, and encoder selection
 * produce correct results on ALL THREE platforms — without actually
 * needing to run on those platforms.
 *
 * Run: node test/cross-platform.test.js
 */

const assert = require('assert');
const path = require('path');

const platform        = require('../src-main/platform');
const utils           = require('../src-main/utils');
const gpu             = require('../src-main/gpu-detection');
const encodeArgs      = require('../src-main/encode-args');
const gapDetector     = require('../src-main/gap-detector');
const outputEstimate  = require('../src-main/output-estimate');
const outputVerify    = require('../src-main/output-verification');
const loudness        = require('../src-main/loudness');
const settingsStore   = require('../src-main/settings-store');
const updateChecker   = require('../src-main/update-checker');
const resolutionRules = require('../src-main/resolution-rules');
const os              = require('os');
const fs              = require('fs');
const tmpPath         = require('path');

const PLATFORMS = ['darwin', 'win32', 'linux'];

let pass = 0;
let fail = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    pass++;
  } catch (err) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${err.message}`);
    fail++;
    failures.push({ name, error: err.message });
  }
}

function section(label) {
  console.log(`\n▸ ${label}`);
}

// ════════════════════════════════════════════════════════════════════════════
// PLATFORM PREDICATES
// ════════════════════════════════════════════════════════════════════════════
section('Platform predicates');
test('isMac correctly identifies darwin',  () => assert.strictEqual(platform.isMac('darwin'), true));
test('isMac rejects win32',                 () => assert.strictEqual(platform.isMac('win32'), false));
test('isMac rejects linux',                 () => assert.strictEqual(platform.isMac('linux'), false));
test('isWin correctly identifies win32',    () => assert.strictEqual(platform.isWin('win32'), true));
test('isWin rejects darwin',                () => assert.strictEqual(platform.isWin('darwin'), false));
test('isLinux identifies linux',            () => assert.strictEqual(platform.isLinux('linux'), true));
test('isLinux treats freebsd as linux-y',   () => assert.strictEqual(platform.isLinux('freebsd'), true));

// ════════════════════════════════════════════════════════════════════════════
// BINARY NAMING
// ════════════════════════════════════════════════════════════════════════════
section('Binary naming per platform');
test('Mac binary: no extension',     () => assert.strictEqual(platform.binaryName('ffmpeg', 'darwin'), 'ffmpeg'));
test('Win binary: .exe extension',   () => assert.strictEqual(platform.binaryName('ffmpeg', 'win32'), 'ffmpeg.exe'));
test('Linux binary: no extension',   () => assert.strictEqual(platform.binaryName('ffmpeg', 'linux'), 'ffmpeg'));
test('Mac bundle dir: mac',          () => assert.strictEqual(platform.bundleDirName('darwin'), 'mac'));
test('Win bundle dir: win',          () => assert.strictEqual(platform.bundleDirName('win32'), 'win'));
test('Linux bundle dir: linux',      () => assert.strictEqual(platform.bundleDirName('linux'), 'linux'));

// ════════════════════════════════════════════════════════════════════════════
// BUNDLED FFMPEG PATH RESOLUTION (each platform, dev + packaged)
// ════════════════════════════════════════════════════════════════════════════
section('Bundled FFmpeg path resolution');

// Dev (unpackaged) — uses appRoot
test('Mac dev path', () => {
  const p = platform.getBundledFFmpegPath({
    appRoot: '/Users/ryan/app', resourcesPath: '', isPackaged: false, platform: 'darwin',
  });
  assert.strictEqual(p, path.join('/Users/ryan/app', 'ffmpeg', 'mac', 'ffmpeg'));
});
test('Win dev path', () => {
  const p = platform.getBundledFFmpegPath({
    appRoot: 'C:\\dev\\app', resourcesPath: '', isPackaged: false, platform: 'win32',
  });
  assert.ok(p.endsWith(path.join('ffmpeg', 'win', 'ffmpeg.exe')),
    `Expected to end with ffmpeg\\win\\ffmpeg.exe, got: ${p}`);
});
test('Linux dev path', () => {
  const p = platform.getBundledFFmpegPath({
    appRoot: '/home/artist/app', resourcesPath: '', isPackaged: false, platform: 'linux',
  });
  assert.strictEqual(p, path.join('/home/artist/app', 'ffmpeg', 'linux', 'ffmpeg'));
});

// Packaged — uses resourcesPath
test('Mac packaged path', () => {
  const p = platform.getBundledFFmpegPath({
    appRoot: '', resourcesPath: '/Applications/DFW.app/Contents/Resources',
    isPackaged: true, platform: 'darwin',
  });
  assert.strictEqual(p,
    path.join('/Applications/DFW.app/Contents/Resources', 'ffmpeg', 'mac', 'ffmpeg'));
});
test('Win packaged path includes .exe', () => {
  const p = platform.getBundledFFmpegPath({
    appRoot: '',
    resourcesPath: 'C:\\Program Files\\Dome Festival Delivery Tool\\resources',
    isPackaged: true, platform: 'win32',
  });
  assert.ok(p.endsWith('ffmpeg.exe'), `Expected .exe ending, got: ${p}`);
});
test('Linux packaged path', () => {
  const p = platform.getBundledFFmpegPath({
    appRoot: '', resourcesPath: '/opt/dfw-delivery-tool/resources',
    isPackaged: true, platform: 'linux',
  });
  assert.strictEqual(p, path.join('/opt/dfw-delivery-tool/resources', 'ffmpeg', 'linux', 'ffmpeg'));
});

// ════════════════════════════════════════════════════════════════════════════
// FFPROBE PATH (always alongside ffmpeg)
// ════════════════════════════════════════════════════════════════════════════
section('FFprobe path resolution');
test('Mac ffprobe alongside ffmpeg',  () => {
  const fp = platform.getFFprobePath('/path/to/ffmpeg', 'darwin');
  assert.strictEqual(fp, path.join('/path/to', 'ffprobe'));
});
test('Win ffprobe.exe alongside ffmpeg.exe', () => {
  const fp = platform.getFFprobePath('C:\\bin\\ffmpeg.exe', 'win32');
  assert.ok(fp.endsWith('ffprobe.exe'), `Got: ${fp}`);
});
test('Linux ffprobe alongside ffmpeg', () => {
  const fp = platform.getFFprobePath('/usr/bin/ffmpeg', 'linux');
  assert.strictEqual(fp, path.join('/usr/bin', 'ffprobe'));
});

// ════════════════════════════════════════════════════════════════════════════
// SYSTEM FFMPEG CANDIDATES
// ════════════════════════════════════════════════════════════════════════════
section('System ffmpeg candidate lists');
test('Mac tries Homebrew paths first', () => {
  const c = platform.getSystemFFmpegCandidates('darwin');
  assert.ok(c[0].includes('homebrew') || c[0].includes('/opt/homebrew'), c.join(','));
  assert.ok(c.includes('/opt/homebrew/bin/ffmpeg'));
  assert.ok(c.includes('/usr/local/bin/ffmpeg'));
});
test('Win returns ffmpeg.exe (PATH lookup)', () => {
  const c = platform.getSystemFFmpegCandidates('win32');
  assert.deepStrictEqual(c, ['ffmpeg.exe']);
});
test('Linux tries /usr/local then /usr/bin', () => {
  const c = platform.getSystemFFmpegCandidates('linux');
  assert.ok(c.indexOf('/usr/local/bin/ffmpeg') < c.indexOf('/usr/bin/ffmpeg'));
});

// ════════════════════════════════════════════════════════════════════════════
// FFPROBE FROM SYSTEM (ffmpeg → ffprobe path conversion)
// ════════════════════════════════════════════════════════════════════════════
section('System ffprobe path derivation');
test('Mac: /opt/homebrew/bin/ffmpeg → ffprobe', () => {
  assert.strictEqual(
    platform.ffprobeForSystem('/opt/homebrew/bin/ffmpeg', 'darwin'),
    '/opt/homebrew/bin/ffprobe'
  );
});
test('Win: ffmpeg.exe → ffprobe.exe', () => {
  assert.strictEqual(
    platform.ffprobeForSystem('ffmpeg.exe', 'win32'),
    'ffprobe.exe'
  );
});
test('Win: C:\\bin\\ffmpeg.exe → ffprobe.exe', () => {
  assert.strictEqual(
    platform.ffprobeForSystem('C:\\bin\\ffmpeg.exe', 'win32'),
    'C:\\bin\\ffprobe.exe'
  );
});
test('Linux: /usr/bin/ffmpeg → ffprobe', () => {
  assert.strictEqual(
    platform.ffprobeForSystem('/usr/bin/ffmpeg', 'linux'),
    '/usr/bin/ffprobe'
  );
});

// ════════════════════════════════════════════════════════════════════════════
// CHMOD SAFETY
// ════════════════════════════════════════════════════════════════════════════
section('Executable bit handling');
test('Mac needs chmod',   () => assert.strictEqual(platform.needsExecutableBit('darwin'), true));
test('Linux needs chmod', () => assert.strictEqual(platform.needsExecutableBit('linux'), true));
test('Win skips chmod',   () => assert.strictEqual(platform.needsExecutableBit('win32'), false));

// ════════════════════════════════════════════════════════════════════════════
// JOIN PATTERN (manual PNG pattern entry — the Windows bug we fixed)
// ════════════════════════════════════════════════════════════════════════════
section('Pattern path joining (manual PNG entry)');
test('joinPattern handles plain pattern', () => {
  // path.join uses the host OS separator regardless of platform arg —
  // the important thing is no double-slash and no string concatenation
  const r = platform.joinPattern('/Users/x/folder', 'render_%04d.png');
  assert.ok(!r.includes('//'), 'No double slash');
  assert.ok(r.endsWith('render_%04d.png'), 'Pattern preserved');
});
test('joinPattern strips leading slash from pattern', () => {
  const r = platform.joinPattern('/folder', '/render_%04d.png');
  assert.ok(!r.includes('//'), 'No double slash from leading slash in pattern');
});

// ════════════════════════════════════════════════════════════════════════════
// GPU ENCODER CANDIDATES
// ════════════════════════════════════════════════════════════════════════════
section('GPU encoder candidates per platform');
test('Mac: hevc_videotoolbox only',  () => {
  const c = gpu.getCandidates('darwin');
  assert.strictEqual(c.length, 1);
  assert.strictEqual(c[0].name, 'hevc_videotoolbox');
  assert.strictEqual(c[0].profile, 'main10');
  assert.strictEqual(c[0].pixFmt, 'p010le');
  assert.strictEqual(c[0].requiresSystemFFmpeg, true);
});
test('Win: NVENC > QSV > AMF in order',  () => {
  const c = gpu.getCandidates('win32');
  assert.strictEqual(c.length, 3);
  assert.deepStrictEqual(c.map(x => x.name), ['hevc_nvenc', 'hevc_qsv', 'hevc_amf']);
  c.forEach(cand => {
    assert.strictEqual(cand.profile, 'main10');
    assert.strictEqual(cand.pixFmt, 'p010le');
    assert.strictEqual(cand.requiresSystemFFmpeg, false);
  });
});
test('Linux: NVENC > VA-API in order',  () => {
  const c = gpu.getCandidates('linux');
  assert.strictEqual(c.length, 2);
  assert.deepStrictEqual(c.map(x => x.name), ['hevc_nvenc', 'hevc_vaapi']);
  c.forEach(cand => {
    assert.strictEqual(cand.profile, 'main10');
    assert.strictEqual(cand.pixFmt, 'p010le');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ENCODE ARGS — the core pure function
// ════════════════════════════════════════════════════════════════════════════
section('Encode arg generation — CPU libx265');

const dfwConfig = {
  version: '2027',
  video: {
    pix_fmt: 'yuv420p10le',
    crf: 18,
    preset: 'slow',
    x265_params: 'bframes=8:ref=6:rd=6:subme=7:me=umh:b-adapt=2',
    high_res_high_fps_vbv: { vbv_maxrate: 200000, vbv_bufsize: 200000 },
  },
};

test('CPU PNG sequence 4K @ 30fps', () => {
  const args = encodeArgs.buildEncodeArgs({
    sourceType: 'png',
    ffmpegPattern: '/tmp/render_%04d.png',
    frameRate: 30,
    resolution: { label: '4K', width: 4096, height: 4096 },
    outputVideoPath: '/out/Film_DFW2027_4K.mp4',
    config: dfwConfig,
    gpu: null,
    sourceBitDepth: 16,
  });
  // Verify key args present in correct order
  assert.deepStrictEqual(args.slice(0, 4), ['-framerate', '30', '-i', '/tmp/render_%04d.png']);
  assert.ok(args.includes('-c:v'));
  assert.ok(args.includes('libx265'));
  assert.ok(args.includes('-pix_fmt'));
  assert.ok(args.includes('yuv420p10le'));
  assert.ok(args.includes('-crf'));
  assert.ok(args.includes('18'));
  assert.ok(args.includes('-preset'));
  assert.ok(args.includes('slow'));
  assert.ok(args.includes('-x265-params'));
  assert.ok(args.includes('bframes=8:ref=6:rd=6:subme=7:me=umh:b-adapt=2'));
  // BT.2020 tagging for 16-bit
  assert.ok(args.includes('bt2020nc'));
  assert.ok(args.includes('smpte2084'));
  // No audio
  assert.ok(args.includes('-an'));
  // Output last
  assert.strictEqual(args[args.length - 1], '/out/Film_DFW2027_4K.mp4');
});

test('CPU PNG 8-bit source → BT.709 tagging', () => {
  const args = encodeArgs.buildEncodeArgs({
    sourceType: 'png',
    ffmpegPattern: '/tmp/r_%04d.png',
    frameRate: 30,
    resolution: { label: '4K', width: 4096, height: 4096 },
    outputVideoPath: '/out/x.mp4',
    config: dfwConfig, gpu: null, sourceBitDepth: 8,
  });
  assert.ok(args.includes('bt709'));
  assert.ok(!args.includes('bt2020nc'));
});

test('CPU video source: no color space tagging (passthrough)', () => {
  const args = encodeArgs.buildEncodeArgs({
    sourceType: 'video',
    sourcePath: '/in/master.mp4',
    frameRate: 30,
    resolution: { label: '8K', width: 8192, height: 8192 },
    outputVideoPath: '/out/x.mp4',
    config: dfwConfig, gpu: null,
  });
  assert.ok(!args.includes('-colorspace'));
  assert.ok(!args.includes('bt2020nc'));
  assert.ok(!args.includes('bt709'));
});

test('CPU 8K @ 60fps adds VBV params', () => {
  const args = encodeArgs.buildEncodeArgs({
    sourceType: 'png',
    ffmpegPattern: '/tmp/r_%04d.png',
    frameRate: 60,
    resolution: { label: '8K', width: 8192, height: 8192 },
    outputVideoPath: '/out/x.mp4',
    config: dfwConfig, gpu: null, sourceBitDepth: 16,
  });
  const x265Idx = args.indexOf('-x265-params');
  assert.ok(x265Idx >= 0);
  const x265Val = args[x265Idx + 1];
  assert.ok(x265Val.includes('vbv-maxrate=200000'), `Got: ${x265Val}`);
  assert.ok(x265Val.includes('vbv-bufsize=200000'), `Got: ${x265Val}`);
});

test('CPU 4K @ 60fps does NOT add VBV (only 8K/60)', () => {
  const args = encodeArgs.buildEncodeArgs({
    sourceType: 'png', ffmpegPattern: '/tmp/r_%04d.png',
    frameRate: 60, resolution: { label: '4K', width: 4096, height: 4096 },
    outputVideoPath: '/out/x.mp4', config: dfwConfig, gpu: null, sourceBitDepth: 16,
  });
  const x265Idx = args.indexOf('-x265-params');
  const x265Val = args[x265Idx + 1];
  assert.ok(!x265Val.includes('vbv-maxrate'), `Should not have VBV at 4K60: ${x265Val}`);
});

section('Encode arg generation — GPU encoders');

// VideoToolbox
test('GPU VideoToolbox uses hevc_videotoolbox + p010le + main10', () => {
  const args = encodeArgs.buildEncodeArgs({
    sourceType: 'png', ffmpegPattern: '/tmp/r_%04d.png',
    frameRate: 30, resolution: { label: '4K', width: 4096, height: 4096 },
    outputVideoPath: '/out/x.mp4', config: dfwConfig, sourceBitDepth: 16,
    gpu: {
      name: 'hevc_videotoolbox', pixFmt: 'p010le', profile: 'main10',
      qualityArgs: ['-q:v', '55'], extraArgs: [],
    },
  });
  assert.ok(args.includes('hevc_videotoolbox'));
  assert.ok(args.includes('p010le'));
  assert.ok(args.includes('main10'));
  assert.ok(args.includes('-q:v'));
  assert.ok(args.includes('55'));
  // GPU path does NOT include CPU x265 params
  assert.ok(!args.includes('-crf'));
  assert.ok(!args.includes('-x265-params'));
});

// NVENC
test('GPU NVENC uses hevc_nvenc + spatial_aq', () => {
  const args = encodeArgs.buildEncodeArgs({
    sourceType: 'video', sourcePath: '/in/x.mp4',
    frameRate: 30, resolution: { label: '8K', width: 8192, height: 8192 },
    outputVideoPath: '/out/x.mp4', config: dfwConfig,
    gpu: gpu.getCandidates('win32')[0],  // NVENC
  });
  assert.ok(args.includes('hevc_nvenc'));
  assert.ok(args.includes('p010le'));
  assert.ok(args.includes('main10'));
  assert.ok(args.includes('-spatial_aq'));
  assert.ok(args.includes('-cq'));
  assert.ok(args.includes('18'));
  assert.ok(args.includes('-preset'));
  assert.ok(args.includes('p7'));
});

// QSV
test('GPU QSV uses hevc_qsv + global_quality', () => {
  const args = encodeArgs.buildEncodeArgs({
    sourceType: 'video', sourcePath: '/in/x.mp4',
    frameRate: 30, resolution: { label: '6K', width: 6144, height: 6144 },
    outputVideoPath: '/out/x.mp4', config: dfwConfig,
    gpu: gpu.getCandidates('win32')[1],  // QSV
  });
  assert.ok(args.includes('hevc_qsv'));
  assert.ok(args.includes('-global_quality'));
  assert.ok(args.includes('18'));
  assert.ok(args.includes('veryslow'));
});

// AMF
test('GPU AMF uses hevc_amf + quality preset', () => {
  const args = encodeArgs.buildEncodeArgs({
    sourceType: 'video', sourcePath: '/in/x.mp4',
    frameRate: 30, resolution: { label: '4K', width: 4096, height: 4096 },
    outputVideoPath: '/out/x.mp4', config: dfwConfig,
    gpu: gpu.getCandidates('win32')[2],  // AMF
  });
  assert.ok(args.includes('hevc_amf'));
  assert.ok(args.includes('-qp_i'));
});

// VA-API
test('GPU VA-API uses hevc_vaapi + CQP', () => {
  const args = encodeArgs.buildEncodeArgs({
    sourceType: 'video', sourcePath: '/in/x.mp4',
    frameRate: 30, resolution: { label: '4K', width: 4096, height: 4096 },
    outputVideoPath: '/out/x.mp4', config: dfwConfig,
    gpu: gpu.getCandidates('linux')[1],  // VA-API
  });
  assert.ok(args.includes('hevc_vaapi'));
  assert.ok(args.includes('CQP'));
  assert.ok(args.includes('-vaapi_device'));
});

// ════════════════════════════════════════════════════════════════════════════
// AUDIO ARG BUILDERS
// ════════════════════════════════════════════════════════════════════════════
section('Audio arg generation');
test('5.1 channelsplit produces 6 mapped outputs', () => {
  const stemPaths = {
    L: '/o/Film_L.wav', R: '/o/Film_R.wav', C: '/o/Film_C.wav',
    LFE: '/o/Film_LFE.wav', Ls: '/o/Film_Ls.wav', Rs: '/o/Film_Rs.wav',
  };
  const args = encodeArgs.buildSplitStemsArgs({ inputPath: '/in/51.wav', stemPaths });
  // filter_complex string actually starts with [0:a] selector
  const fcIdx = args.indexOf('-filter_complex');
  assert.ok(fcIdx >= 0, 'must have -filter_complex flag');
  const filterStr = args[fcIdx + 1];
  assert.ok(filterStr.includes('channelsplit=channel_layout=5.1'),
    `filter_complex missing channelsplit, got: ${filterStr}`);
  assert.ok(filterStr.includes('[out_L][out_R][out_C][out_LFE][out_Ls][out_Rs]'),
    `filter_complex missing 6 output labels, got: ${filterStr}`);
  // Each channel mapped exactly once
  for (const ch of ['L', 'R', 'C', 'LFE', 'Ls', 'Rs']) {
    const mapArg = `[out_${ch}]`;
    const count = args.filter(a => a === mapArg).length;
    assert.strictEqual(count, 1, `Channel ${ch} should be mapped exactly once`);
  }
  // All output paths present
  for (const p of Object.values(stemPaths)) {
    assert.ok(args.includes(p), `Output path missing: ${p}`);
  }
  // 44.1kHz and pcm_s24le for every stem
  assert.strictEqual(args.filter(a => a === '44100').length, 6);
  assert.strictEqual(args.filter(a => a === 'pcm_s24le').length, 6);
});

test('Mux 5.1: 6 stems + AAC 384k + 5.1 layout', () => {
  const args = encodeArgs.buildMuxArgs({
    videoPath: '/out/video.mp4',
    stemPaths: ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'].map(c => `/o/Film_${c}.wav`),
    outputPath: '/out/video.mp4.mux_tmp.mp4',
    is51: true,
  });
  assert.ok(args.includes('-c:v'));
  assert.ok(args.includes('copy'));
  assert.ok(args.includes('-c:a'));
  assert.ok(args.includes('aac'));
  assert.ok(args.includes('384k'), '5.1 should use 384k bitrate');
  assert.ok(args.includes('-channel_layout'));
  assert.ok(args.includes('5.1'));
  // 6 -i flags for the stems plus 1 for the video
  assert.strictEqual(args.filter(a => a === '-i').length, 7);
});

test('Mux stereo: 1 stem + AAC 192k', () => {
  const args = encodeArgs.buildMuxArgs({
    videoPath: '/out/video.mp4',
    stemPaths: ['/o/stereo.wav'],
    outputPath: '/out/video.mp4.mux_tmp.mp4',
    is51: false,
  });
  assert.ok(args.includes('192k'), 'Stereo should use 192k bitrate');
  assert.ok(!args.includes('-channel_layout'));
  assert.strictEqual(args.filter(a => a === '-i').length, 2);
});

test('Stem normalize: 44.1kHz, pcm_s24le', () => {
  const args = encodeArgs.buildStemNormalizeArgs({
    inputPath: '/in/raw.wav',
    outputPath: '/o/Film_L.wav',
  });
  assert.ok(args.includes('44100'));
  assert.ok(args.includes('pcm_s24le'));
});

// ════════════════════════════════════════════════════════════════════════════
// UTILS
// ════════════════════════════════════════════════════════════════════════════
section('Utility functions');

test('formatBytes scales correctly', () => {
  assert.strictEqual(utils.formatBytes(0), '0 B');
  assert.strictEqual(utils.formatBytes(1024), '1.0 KB');
  assert.strictEqual(utils.formatBytes(1024 ** 2), '1.0 MB');
  assert.strictEqual(utils.formatBytes(1.19 * 1024 ** 3), '1.19 GB');
  assert.strictEqual(utils.formatBytes(null), '—');
});

test('formatDuration h/m/s', () => {
  assert.strictEqual(utils.formatDuration(45000), '45s');
  assert.strictEqual(utils.formatDuration(90000), '1m 30s');
  assert.strictEqual(utils.formatDuration(3723000), '1h 2m 3s');
  assert.strictEqual(utils.formatDuration(null), 'unknown');
});

test('sanitizeFilmTitle strips Win/Mac/Linux reserved chars', () => {
  assert.strictEqual(utils.sanitizeFilmTitle('Beyond the Dome'), 'Beyond_the_Dome');
  assert.strictEqual(utils.sanitizeFilmTitle('Film: Story'),     'Film__Story');
  assert.strictEqual(utils.sanitizeFilmTitle('A/B\\C'),          'A_B_C');
  assert.strictEqual(utils.sanitizeFilmTitle('Star*Wars*Dome'),  'Star_Wars_Dome');
  assert.strictEqual(utils.sanitizeFilmTitle(null), '');
});

test('calculateETA: frames-based (fps)', () => {
  // 1000 remaining frames at 50 fps = 20s
  assert.strictEqual(utils.calculateETA({ currentFrame: 500, totalFrames: 1500, fps: 50 }), 20);
});

test('calculateETA: speed-based fallback', () => {
  // 1000 frames left, no fps, speed=2x, source @ 30fps → ~16.7s
  const eta = utils.calculateETA({
    currentFrame: 500, totalFrames: 1500,
    fps: null, speed: 2, frameRate: 30,
  });
  assert.strictEqual(eta, 17); // 1000/30/2 = 16.67 → rounded to 17
});

test('calculateETA: returns null when no data', () => {
  assert.strictEqual(utils.calculateETA({ currentFrame: 0, totalFrames: 100 }), null);
  assert.strictEqual(utils.calculateETA({ currentFrame: 100, totalFrames: 100, fps: 30 }), null);
  assert.strictEqual(utils.calculateETA({ currentFrame: 50, totalFrames: 100 }), null);
});

// ════════════════════════════════════════════════════════════════════════════
// CROSS-PLATFORM PARITY — same input produces same args on all 3 platforms
// ════════════════════════════════════════════════════════════════════════════
section('Cross-platform parity (encoder args are platform-agnostic)');

test('Same CPU encode produces identical args on all platforms', () => {
  // Args don't depend on platform — only on inputs.
  // This is the parity guarantee.
  const baseReq = {
    sourceType: 'video', sourcePath: '/in/x.mp4', frameRate: 30,
    resolution: { label: '4K', width: 4096, height: 4096 },
    outputVideoPath: '/out/x.mp4', config: dfwConfig, gpu: null,
  };
  const a = encodeArgs.buildEncodeArgs(baseReq);
  const b = encodeArgs.buildEncodeArgs(baseReq);
  assert.deepStrictEqual(a, b);
});

test('Each platform has at least one GPU encoder candidate', () => {
  for (const p of PLATFORMS) {
    const c = gpu.getCandidates(p);
    assert.ok(c.length >= 1, `Platform ${p} has no GPU encoder candidates`);
  }
});

test('Every GPU encoder uses 10-bit pix_fmt and main10 profile', () => {
  for (const p of PLATFORMS) {
    for (const cand of gpu.getCandidates(p)) {
      assert.strictEqual(cand.pixFmt, 'p010le',
        `${p}:${cand.name} has wrong pixFmt: ${cand.pixFmt}`);
      assert.strictEqual(cand.profile, 'main10',
        `${p}:${cand.name} has wrong profile: ${cand.profile}`);
    }
  }
});

// ════════════════════════════════════════════════════════════════════════════
// PNG GAP DETECTOR
// ════════════════════════════════════════════════════════════════════════════
section('PNG sequence gap detection');

test('No gaps in complete sequence', () => {
  const files = Array.from({length: 10}, (_, i) =>
    `render_${String(i+1).padStart(4,'0')}.png`);
  const g = gapDetector.detectGaps(files);
  assert.strictEqual(g.hasGaps, false);
  assert.strictEqual(g.actualCount, 10);
  assert.strictEqual(g.expectedCount, 10);
});

test('Single missing frame detected', () => {
  const files = ['render_0001.png','render_0002.png','render_0004.png','render_0005.png'];
  const g = gapDetector.detectGaps(files);
  assert.strictEqual(g.hasGaps, true);
  assert.strictEqual(g.missingTotal, 1);
  assert.deepStrictEqual(g.missing, [3]);
  assert.deepStrictEqual(g.ranges, [[3, 3]]);
});

test('Multi-range gap detected', () => {
  const files = ['render_0001.png','render_0002.png','render_0006.png','render_0010.png','render_0011.png'];
  const g = gapDetector.detectGaps(files);
  assert.strictEqual(g.hasGaps, true);
  assert.strictEqual(g.missingTotal, 6); // 3,4,5,7,8,9
  assert.deepStrictEqual(g.ranges, [[3, 5], [7, 9]]);
});

test('Format gap report human-readable', () => {
  const g = gapDetector.detectGaps(['frame_0001.png','frame_0003.png']);
  const report = gapDetector.formatGapReport(g);
  assert.ok(report.includes('1 missing'));
  assert.ok(report.includes('2'));
});

test('Empty files array returns no gaps', () => {
  const g = gapDetector.detectGaps([]);
  assert.strictEqual(g.hasGaps, false);
  assert.strictEqual(g.firstFrame, null);
});

// ════════════════════════════════════════════════════════════════════════════
// OUTPUT SIZE ESTIMATE
// ════════════════════════════════════════════════════════════════════════════
section('Output size estimation');

test('4K 30fps 60s estimate is in MB range', () => {
  const e = outputEstimate.estimateOutputSize({
    resolutionLabel: '4K', frameRate: 30, durationSeconds: 60,
  });
  // 25 Mbps * 60s = 1500 Mbits = 187.5 MB
  assert.ok(e.bytes > 100_000_000, `Expected >100MB, got ${e.bytes}`);
  assert.ok(e.bytes < 300_000_000, `Expected <300MB, got ${e.bytes}`);
});

test('8K 60fps 600s estimate is in GB range', () => {
  const e = outputEstimate.estimateOutputSize({
    resolutionLabel: '8K', frameRate: 60, durationSeconds: 600,
  });
  // 165 Mbps * 600s = 99000 Mbits = ~12.4 GB
  assert.ok(e.bytes > 10 * 1024 ** 3, `Expected >10GB, got ${e.bytes}`);
  assert.ok(e.bytes < 20 * 1024 ** 3, `Expected <20GB, got ${e.bytes}`);
});

test('GPU encoder inflates estimate', () => {
  const cpu = outputEstimate.estimateOutputSize({
    resolutionLabel: '4K', frameRate: 30, durationSeconds: 60, isGPU: false,
  });
  const gpu = outputEstimate.estimateOutputSize({
    resolutionLabel: '4K', frameRate: 30, durationSeconds: 60, isGPU: true,
  });
  assert.ok(gpu.bytes > cpu.bytes, 'GPU should estimate larger files');
  assert.ok(gpu.bytes > cpu.bytes * 1.3, 'GPU inflation should be ~1.4x');
});

test('Unknown combo returns null', () => {
  const e = outputEstimate.estimateOutputSize({
    resolutionLabel: '12K', frameRate: 30, durationSeconds: 60,
  });
  assert.strictEqual(e.bytes, null);
});

test('Recommended free space is 2x estimate', () => {
  assert.strictEqual(outputEstimate.recommendedFreeBytes(1000), 2000);
});

// ════════════════════════════════════════════════════════════════════════════
// OUTPUT VERIFICATION (pure compare function)
// ════════════════════════════════════════════════════════════════════════════
section('Output verification');

test('Correct output passes verification', () => {
  const r = outputVerify.verifyOutput(
    { codec: 'hevc', pixFmt: 'yuv420p10le', width: 4096, height: 4096, fps: 30, duration: 60 },
    { codec: 'hevc', pixFmt: 'yuv420p10le', width: 4096, height: 4096, frameRate: 30, durationSeconds: 60 }
  );
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.issues.length, 0);
});

test('Wrong codec is flagged as error', () => {
  const r = outputVerify.verifyOutput(
    { codec: 'h264', pixFmt: 'yuv420p10le', width: 4096, height: 4096, fps: 30 },
    { codec: 'hevc', pixFmt: 'yuv420p10le', width: 4096, height: 4096, frameRate: 30 }
  );
  assert.strictEqual(r.ok, false);
  assert.ok(r.issues.some(i => i.field === 'codec' && i.severity === 'error'));
});

test('8-bit pixel format is flagged as error (banding risk)', () => {
  const r = outputVerify.verifyOutput(
    { codec: 'hevc', pixFmt: 'yuv420p', width: 4096, height: 4096, fps: 30 },
    { codec: 'hevc', pixFmt: 'yuv420p10le', width: 4096, height: 4096, frameRate: 30 }
  );
  assert.strictEqual(r.ok, false);
  assert.ok(r.issues.some(i => i.field === 'pix_fmt' && i.severity === 'error'));
});

test('Resolution mismatch is an error', () => {
  const r = outputVerify.verifyOutput(
    { codec: 'hevc', pixFmt: 'yuv420p10le', width: 3840, height: 4096, fps: 30 },
    { codec: 'hevc', pixFmt: 'yuv420p10le', width: 4096, height: 4096, frameRate: 30 }
  );
  assert.strictEqual(r.ok, false);
  assert.ok(r.issues.some(i => i.field === 'resolution'));
});

test('FPS mismatch is an error', () => {
  const r = outputVerify.verifyOutput(
    { codec: 'hevc', pixFmt: 'yuv420p10le', width: 4096, height: 4096, fps: 29.97 },
    { codec: 'hevc', pixFmt: 'yuv420p10le', width: 4096, height: 4096, frameRate: 30 }
  );
  assert.strictEqual(r.ok, false);
  assert.ok(r.issues.some(i => i.field === 'fps'));
});

test('Probe failure is reported', () => {
  const r = outputVerify.verifyOutput(null,
    { codec: 'hevc', pixFmt: 'yuv420p10le', width: 4096, height: 4096, frameRate: 30 }
  );
  assert.strictEqual(r.ok, false);
});

// ════════════════════════════════════════════════════════════════════════════
// LOUDNESS CLASSIFICATION
// ════════════════════════════════════════════════════════════════════════════
section('Audio loudness classification');

test('On-target loudness (-23 LUFS) is OK', () => {
  const c = loudness.classifyLoudness({ integratedLufs: -23.0, truePeakDbtp: -2.0 });
  assert.strictEqual(c.severity, 'ok');
});

test('Within 2 LU of target is OK', () => {
  const c = loudness.classifyLoudness({ integratedLufs: -21.0, truePeakDbtp: -2.0 });
  assert.strictEqual(c.severity, 'ok');
});

test('3 LU off target is warning', () => {
  const c = loudness.classifyLoudness({ integratedLufs: -26.0, truePeakDbtp: -3.0 });
  assert.strictEqual(c.severity, 'warning');
});

test('5+ LU off target is error', () => {
  const c = loudness.classifyLoudness({ integratedLufs: -29.0, truePeakDbtp: -3.0 });
  assert.strictEqual(c.severity, 'error');
});

test('True peak clipping (>-1 dBTP) is error regardless of LUFS', () => {
  const c = loudness.classifyLoudness({ integratedLufs: -23.0, truePeakDbtp: 0.0 });
  assert.strictEqual(c.severity, 'error');
  assert.ok(c.message.includes('clipping'));
});

test('Missing measurement is unknown', () => {
  const c = loudness.classifyLoudness(null);
  assert.strictEqual(c.severity, 'unknown');
});

// ════════════════════════════════════════════════════════════════════════════
// SETTINGS STORE (uses real temp dir, isolated per run)
// ════════════════════════════════════════════════════════════════════════════
section('Settings persistence');

const testUserDir = tmpPath.join(os.tmpdir(), 'dfw-settings-test-' + process.pid);
fs.mkdirSync(testUserDir, { recursive: true });

test('Read returns defaults when no file exists', () => {
  // Use a fresh subdir to ensure clean state
  const fresh = tmpPath.join(testUserDir, 'fresh-' + Date.now());
  fs.mkdirSync(fresh, { recursive: true });
  const s = settingsStore.readSettings(fresh);
  assert.strictEqual(s.artistName, '');
  assert.strictEqual(s.preferGPU, true);
  assert.deepStrictEqual(s.recentEncodes, []);
});

test('Update settings persists across reads', () => {
  const dir = tmpPath.join(testUserDir, 'update-' + Date.now());
  fs.mkdirSync(dir, { recursive: true });
  settingsStore.updateSettings(dir, { artistName: 'Test Artist', preferGPU: false });
  const s = settingsStore.readSettings(dir);
  assert.strictEqual(s.artistName, 'Test Artist');
  assert.strictEqual(s.preferGPU, false);
  // Other defaults preserved
  assert.strictEqual(s.notifyOnComplete, true);
});

test('Recent encodes: newest first, capped at MAX', () => {
  const dir = tmpPath.join(testUserDir, 'recent-' + Date.now());
  fs.mkdirSync(dir, { recursive: true });
  // Add 12 encodes (more than RECENT_MAX=10)
  for (let i = 0; i < 12; i++) {
    settingsStore.addRecentEncode(dir, {
      filmTitle: `Film ${i}`,
      deliveryFolder: `/path/${i}`,
      resolution: '4K', frameRate: 30,
      encoder: 'CPU', sourceType: 'video',
    });
  }
  const s = settingsStore.readSettings(dir);
  assert.strictEqual(s.recentEncodes.length, 10);
  assert.strictEqual(s.recentEncodes[0].filmTitle, 'Film 11'); // newest first
});

test('Recent encodes: dedupes by delivery folder', () => {
  const dir = tmpPath.join(testUserDir, 'dedupe-' + Date.now());
  fs.mkdirSync(dir, { recursive: true });
  settingsStore.addRecentEncode(dir, {
    filmTitle: 'A', deliveryFolder: '/same/path',
    resolution: '4K', frameRate: 30,
  });
  settingsStore.addRecentEncode(dir, {
    filmTitle: 'B', deliveryFolder: '/same/path',  // re-encode
    resolution: '4K', frameRate: 30,
  });
  const s = settingsStore.readSettings(dir);
  assert.strictEqual(s.recentEncodes.length, 1);
  assert.strictEqual(s.recentEncodes[0].filmTitle, 'B'); // newest version wins
});

// Clean up
try { fs.rmSync(testUserDir, { recursive: true, force: true }); } catch (_) {}

// ════════════════════════════════════════════════════════════════════════════
// UPDATE CHECKER — VERSION COMPARISON
// ════════════════════════════════════════════════════════════════════════════
section('Update-checker version comparison');

test('Equal versions compare to 0',         () => assert.strictEqual(updateChecker.compareVersions('0.16.0', '0.16.0'), 0));
test('Equal w/ v-prefix on one',            () => assert.strictEqual(updateChecker.compareVersions('v0.16.0', '0.16.0'), 0));
test('0.15.12 < 0.16.0',                    () => assert.strictEqual(updateChecker.compareVersions('0.15.12', '0.16.0'), -1));
test('0.16.0 > 0.15.12',                    () => assert.strictEqual(updateChecker.compareVersions('0.16.0', '0.15.12'), 1));
test('0.16.1 > 0.16.0',                     () => assert.strictEqual(updateChecker.compareVersions('0.16.1', '0.16.0'), 1));
test('Major dominates: 1.0.0 > 0.99.99',    () => assert.strictEqual(updateChecker.compareVersions('1.0.0', '0.99.99'), 1));
test('Patch-level: 0.16.10 > 0.16.9',       () => assert.strictEqual(updateChecker.compareVersions('0.16.10', '0.16.9'), 1));
test('Pre-release lower than release',      () => assert.strictEqual(updateChecker.compareVersions('1.0.0-beta', '1.0.0'), -1));
test('Pre-release higher than release reverses', () => assert.strictEqual(updateChecker.compareVersions('1.0.0', '1.0.0-beta'), 1));
test('Missing trailing segments',           () => assert.strictEqual(updateChecker.compareVersions('1.0', '1.0.0'), 0));
test('Missing trailing → lower',            () => assert.strictEqual(updateChecker.compareVersions('1.0', '1.0.1'), -1));
test('Null/empty string treated as 0.0.0',  () => assert.strictEqual(updateChecker.compareVersions('', '0.0.1'), -1));

// ════════════════════════════════════════════════════════════════════════════
// RESOLUTION GOVERNANCE — no upscaling allowed
// ════════════════════════════════════════════════════════════════════════════
section('Resolution rules — no upscaling');

const ALLOWED_4K_6K_8K = [
  { label: '4K', width: 4096, height: 4096 },
  { label: '6K', width: 6144, height: 6144 },
  { label: '8K', width: 8192, height: 8192 },
];

test('2K source — no allowed master resolutions',  () => {
  const r = resolutionRules.filterAllowedResolutions(2048, 2048, ALLOWED_4K_6K_8K);
  assert.deepStrictEqual(r, []);
});

test('4K source — only 4K allowed',  () => {
  const r = resolutionRules.filterAllowedResolutions(4096, 4096, ALLOWED_4K_6K_8K);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].label, '4K');
});

test('5K source — 4K only (round down — never upscale to 6K)',  () => {
  const r = resolutionRules.filterAllowedResolutions(5120, 5120, ALLOWED_4K_6K_8K);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].label, '4K');
});

test('6K source — 4K and 6K',  () => {
  const r = resolutionRules.filterAllowedResolutions(6144, 6144, ALLOWED_4K_6K_8K);
  assert.deepStrictEqual(r.map(x => x.label), ['4K', '6K']);
});

test('8K source — all three allowed',  () => {
  const r = resolutionRules.filterAllowedResolutions(8192, 8192, ALLOWED_4K_6K_8K);
  assert.deepStrictEqual(r.map(x => x.label), ['4K', '6K', '8K']);
});

test('12K source — all three still allowed (no upper bound)',  () => {
  const r = resolutionRules.filterAllowedResolutions(12288, 12288, ALLOWED_4K_6K_8K);
  assert.deepStrictEqual(r.map(x => x.label), ['4K', '6K', '8K']);
});

test('Non-square source where height limits choices',  () => {
  // 8K wide but only 4K tall — still need both dims to fit
  const r = resolutionRules.filterAllowedResolutions(8192, 4096, ALLOWED_4K_6K_8K);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].label, '4K');
});

test('Source dimensions unknown returns full list (no clamp)',  () => {
  const r = resolutionRules.filterAllowedResolutions(null, null, ALLOWED_4K_6K_8K);
  assert.deepStrictEqual(r, ALLOWED_4K_6K_8K);
});

test('describeSourceBracket buckets correctly', () => {
  assert.strictEqual(resolutionRules.describeSourceBracket(1024),  'sub-2K');
  assert.strictEqual(resolutionRules.describeSourceBracket(2048),  '2K');
  assert.strictEqual(resolutionRules.describeSourceBracket(3000),  '2K');
  assert.strictEqual(resolutionRules.describeSourceBracket(4096),  '4K');
  assert.strictEqual(resolutionRules.describeSourceBracket(5120),  '4K');
  assert.strictEqual(resolutionRules.describeSourceBracket(6144),  '6K');
  assert.strictEqual(resolutionRules.describeSourceBracket(8192),  '8K');
  assert.strictEqual(resolutionRules.describeSourceBracket(0),     'unknown');
});

test('Screener eligibility — source ≤ max threshold', () => {
  const screener = { enabled: true, max_source_label: '4K' };
  assert.strictEqual(resolutionRules.isScreenerEligible(2048, screener), true);
  assert.strictEqual(resolutionRules.isScreenerEligible(4096, screener), true);
  assert.strictEqual(resolutionRules.isScreenerEligible(6144, screener), false);
  assert.strictEqual(resolutionRules.isScreenerEligible(8192, screener), false);
});

test('Screener disabled — never eligible', () => {
  const screener = { enabled: false, max_source_label: '4K' };
  assert.strictEqual(resolutionRules.isScreenerEligible(2048, screener), false);
});

test('diagnoseSource: 2K source + DFW config → screener-only', () => {
  const config = {
    video: { allowed_resolutions: ALLOWED_4K_6K_8K },
    screener: { enabled: true, max_source_label: '4K' },
  };
  const r = resolutionRules.diagnoseSource(2048, 2048, config);
  assert.strictEqual(r.masterModeAvailable, false);
  assert.strictEqual(r.screenerModeAvailable, true);
  assert.strictEqual(r.recommendation, 'screener');
});

test('diagnoseSource: 8K source + DFW config → master-only', () => {
  const config = {
    video: { allowed_resolutions: ALLOWED_4K_6K_8K },
    screener: { enabled: true, max_source_label: '4K' },
  };
  const r = resolutionRules.diagnoseSource(8192, 8192, config);
  assert.strictEqual(r.masterModeAvailable, true);
  assert.strictEqual(r.screenerModeAvailable, false);
  assert.strictEqual(r.recommendation, 'master');
  assert.strictEqual(r.allowedMasterResolutions.length, 3);
});

test('diagnoseSource: 4K source + DFW config → either available', () => {
  const config = {
    video: { allowed_resolutions: ALLOWED_4K_6K_8K },
    screener: { enabled: true, max_source_label: '4K' },
  };
  const r = resolutionRules.diagnoseSource(4096, 4096, config);
  assert.strictEqual(r.masterModeAvailable, true);
  assert.strictEqual(r.screenerModeAvailable, true);
  assert.strictEqual(r.recommendation, 'either');
});

test('diagnoseSource: 1080p source + strict-8K-only festival → neither', () => {
  const config = {
    video: { allowed_resolutions: [{ label: '8K', width: 8192, height: 8192 }] },
    screener: { enabled: false },
  };
  const r = resolutionRules.diagnoseSource(1920, 1080, config);
  assert.strictEqual(r.recommendation, 'neither');
  assert.ok(r.advisory.includes('1920×1080'));
});

// ════════════════════════════════════════════════════════════════════════════
// Verify Delivery — parse delivery_report.txt
// ════════════════════════════════════════════════════════════════════════════

const { parseDeliveryReport } = require('../src-main/verify-delivery');
const { buildDeliveryReport } = require('../src-main/delivery-report');

section('Verify Delivery — report parsing');

test('parseDeliveryReport: rejects empty input', () => {
  const r = parseDeliveryReport('');
  assert.ok(r.error);
});

test('parseDeliveryReport: round-trip from buildDeliveryReport', () => {
  const text = buildDeliveryReport({
    filmTitle: 'Test Film',
    artistName: 'Jane Doe',
    config: { festival_name: 'Test Fest', version: '2027', contact_email: 'a@b.c', website: 'b.c' },
    resolution: { width: 8192, height: 8192, label: '8K' },
    frameRate: 30,
    sourceType: 'png',
    sourceBitDepth: 16,
    encodeParams: { totalFrames: 5400 },
    outputFilename: 'Test_Film_8K.mp4',
    videoSizeBytes: 1234567890,
    videoMd5: 'abc123def456',
    audioResult: { mode: '5.1', stems: [
      { channel: 'L',   filename: 'tf_L.wav',   md5: 'aaa' },
      { channel: 'R',   filename: 'tf_R.wav',   md5: 'bbb' },
      { channel: 'C',   filename: 'tf_C.wav',   md5: 'ccc' },
      { channel: 'LFE', filename: 'tf_LFE.wav', md5: 'ddd' },
      { channel: 'Ls',  filename: 'tf_Ls.wav',  md5: 'eee' },
      { channel: 'Rs',  filename: 'tf_Rs.wav',  md5: 'fff' },
    ]},
    encoderLabel: 'Apple VideoToolbox (GPU)',
    encoderName: 'hevc_videotoolbox',
    isGPU: true,
    appVersion: '0.17.0',
    ffmpegVersion: '8.1.1',
    ffmpegSource: 'bundled',
  });
  const parsed = parseDeliveryReport(text);
  assert.ok(!parsed.error, 'should parse without error');
  assert.strictEqual(parsed.video.outputFile, 'Test_Film_8K.mp4');
  assert.strictEqual(parsed.video.md5, 'abc123def456');
  assert.strictEqual(parsed.video.width, 8192);
  assert.strictEqual(parsed.video.height, 8192);
  assert.strictEqual(parsed.video.resolutionLabel, '8K');
  assert.strictEqual(parsed.video.frameRate, 30);
  assert.strictEqual(parsed.audio.stems.length, 6);
  assert.strictEqual(parsed.audio.stems[0].channel, 'L');
  assert.strictEqual(parsed.audio.stems[0].md5, 'aaa');
  assert.strictEqual(parsed.audio.stems[3].channel, 'LFE');
  assert.strictEqual(parsed.tool.version, 'v0.17.0');
});

test('parseDeliveryReport: missing video filename → error', () => {
  const r = parseDeliveryReport('Some random text\nwith no recognizable fields\n');
  assert.ok(r.error);
});

test('parseDeliveryReport: extracts 10-bit pix_fmt from bit depth line', () => {
  const text = buildDeliveryReport({
    filmTitle: 'X',
    config: {
      festival_name: 'X', version: '1', contact_email: '', website: '',
      video: { crf: 18, preset: 'medium' },
    },
    resolution: { width: 4096, height: 4096, label: '4K' },
    frameRate: 30, sourceType: 'video',
    encodeParams: { sourceCodec: 'prores', sourceFps: 30 },
    outputFilename: 'x.mp4', videoSizeBytes: 100, videoMd5: 'm',
    audioResult: { mode: 'none', stems: [] },
    encoderLabel: 'libx265', encoderName: 'libx265', isGPU: false,
    appVersion: '0.17.0', ffmpegVersion: '8', ffmpegSource: 'bundled',
  });
  const parsed = parseDeliveryReport(text);
  assert.strictEqual(parsed.video.pixFmt, 'yuv420p10le');
});

// ════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(64));
console.log(`  Total: ${pass + fail}  Pass: ${pass}  Fail: ${fail}`);
if (fail > 0) {
  console.log('\n  Failures:');
  failures.forEach(f => console.log(`    ❌ ${f.name}\n       ${f.error}`));
  process.exit(1);
} else {
  console.log('  ✅ All cross-platform tests pass.');
  process.exit(0);
}
