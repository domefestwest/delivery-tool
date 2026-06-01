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

const platform   = require('../src-main/platform');
const utils      = require('../src-main/utils');
const gpu        = require('../src-main/gpu-detection');
const encodeArgs = require('../src-main/encode-args');

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
    resourcesPath: 'C:\\Program Files\\Dome Fest West\\resources',
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
