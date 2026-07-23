#!/usr/bin/env node
/**
 * devtest.js — headless debug CLI for exercising the tool's core logic
 * without launching Electron or clicking anything.
 *
 * This talks directly to the same src-main/*.js modules the app uses —
 * no mocking, no duplicate logic. If a bug shows up here, it's a real bug.
 *
 * Usage:
 *   node scripts/devtest.js <command> [args...]
 *   npm run devtest -- <command> [args...]
 *
 * Commands:
 *   presets                              List bundled festival presets
 *   preset <id>                          Print one preset's full config
 *   resolution <srcW> <srcH> [presetId]  Show allowed output resolutions for a source size
 *   encode-args <presetId> <res> <fps> [--gpu] [--png|--video]
 *                                        Print the exact ffmpeg argv for an encode (dry run)
 *   verify <folderPath>                  Run Festival Verify Mode against a real delivery folder
 *   report <presetId> <res> <fps>        Print a sample delivery_report.txt
 *   md5 <filePath>                       Compute MD5 with live progress (tests the progress callback)
 *   gpu [platform] [codec]               Show GPU encoder candidates for a platform (mac/win/linux)
 *   all                                  Run every command above against fixture data as a smoke test
 *
 * Exit code is 0 on success, 1 if any check fails — safe to use in a loop.
 */

const path = require('path');
const fs = require('fs');

const presetsLoader   = require('../src-main/presets-loader');
const resolutionRules = require('../src-main/resolution-rules');
const { buildEncodeArgs, buildScreenerEncodeArgs } = require('../src-main/encode-args');
const { buildDeliveryReport } = require('../src-main/delivery-report');
const { verifyDelivery, buildVerificationReport } = require('../src-main/verify-delivery');
const { computeMd5 } = require('../src-main/utils');
const gpuDetection = require('../src-main/gpu-detection');

const PRESETS_DIR = path.join(__dirname, '..', 'presets');

// ─── Output helpers ────────────────────────────────────────────────────────
const c = {
  green: s => `\x1b[32m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
};

function ok(label, detail) {
  console.log(c.green('✓') + ' ' + label + (detail ? c.dim(' — ' + detail) : ''));
}
function fail(label, detail) {
  console.log(c.red('✗') + ' ' + label + (detail ? c.dim(' — ' + detail) : ''));
}
function section(title) {
  console.log('\n' + c.bold(title));
  console.log('─'.repeat(title.length));
}
function json(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

let hadFailure = false;

// ─── Commands ──────────────────────────────────────────────────────────────

function cmdPresets() {
  section('Bundled presets');
  const list = presetsLoader.listPresets(PRESETS_DIR);
  if (!list.length) { fail('No presets found in ' + PRESETS_DIR); hadFailure = true; return; }
  for (const p of list) {
    ok(`${p.id}`, `${p.name} · v${p.version}${p.isExample ? ' (example)' : ''}${p.hasIcon ? ' · has icon' : ''}`);
  }
}

function cmdPreset(id) {
  if (!id) { fail('Usage: preset <id>'); hadFailure = true; return; }
  section(`Preset: ${id}`);
  const cfg = presetsLoader.loadPreset(PRESETS_DIR, id);
  if (cfg.error) { fail('Load failed', cfg.error); hadFailure = true; return; }
  ok('Loaded', `${cfg.festival_name} ${cfg.version}`);
  json(cfg);
}

function cmdResolution(srcW, srcH, presetId) {
  srcW = parseInt(srcW, 10);
  srcH = parseInt(srcH, 10);
  if (!srcW || !srcH) { fail('Usage: resolution <srcWidth> <srcHeight> [presetId]'); hadFailure = true; return; }
  section(`Resolution governance for ${srcW}×${srcH} source`);

  const bracket = resolutionRules.describeSourceBracket(srcW);
  ok('Source bracket', bracket);

  const cfg = presetId ? presetsLoader.loadPreset(PRESETS_DIR, presetId) : null;
  if (presetId && cfg?.error) { fail('Preset load failed', cfg.error); hadFailure = true; return; }

  const allowed = cfg?.video?.allowed_resolutions
    || [{ label: '4K', width: 4096, height: 4096 }, { label: '6K', width: 6144, height: 6144 }, { label: '8K', width: 8192, height: 8192 }];

  // Note: an empty result here is expected/correct behavior for small sources
  // (screener-only), not a bug — so it's reported with ok(), not fail().
  const filtered = resolutionRules.filterAllowedResolutions(srcW, srcH, allowed);
  if (!filtered.length) {
    ok('Allowed master resolutions', 'none — source too small for any master resolution (screener-only, this is correct)');
  } else {
    ok('Allowed master resolutions', filtered.map(r => r.label).join(', '));
  }

  if (cfg) {
    const diag = resolutionRules.diagnoseSource(srcW, srcH, cfg);
    ok('Recommendation', diag.recommendation);
    if (diag.advisory) console.log('  ' + c.dim(diag.advisory));
  }
}

function cmdEncodeArgs(presetId, resLabel, fps, flags) {
  if (!presetId || !resLabel || !fps) {
    fail('Usage: encode-args <presetId> <resLabel> <fps> [--gpu] [--png|--video]');
    hadFailure = true;
    return;
  }
  section(`Encode args: ${presetId} @ ${resLabel} ${fps}fps`);

  const cfg = presetsLoader.loadPreset(PRESETS_DIR, presetId);
  if (cfg.error) { fail('Preset load failed', cfg.error); hadFailure = true; return; }

  const resolution = cfg.video.allowed_resolutions.find(r => r.label === resLabel);
  if (!resolution) {
    fail('Resolution not found in preset', `available: ${cfg.video.allowed_resolutions.map(r => r.label).join(', ')}`);
    hadFailure = true;
    return;
  }

  const useGPU = flags.includes('--gpu');
  const isPng = !flags.includes('--video');
  let gpu = null;
  if (useGPU) {
    const candidates = gpuDetection.getCandidates(process.platform, 'hevc');
    gpu = candidates[0] || null;
    if (!gpu) { fail('No GPU candidates for this platform'); hadFailure = true; return; }
  }

  const args = buildEncodeArgs({
    sourceType: isPng ? 'png' : 'video',
    ffmpegPattern: isPng ? '/fake/source/frame_%04d.png' : undefined,
    sourcePath: isPng ? undefined : '/fake/source/master.mov',
    frameRate: parseInt(fps, 10),
    resolution,
    outputVideoPath: '/fake/output/Test_Film.mp4',
    config: cfg,
    gpu,
    sourceBitDepth: 16,
    sourceWidth: resolution.width * 2,  // force the downscale path so it's visible in output
    sourceHeight: resolution.height * 2,
  });

  ok('Built argv', `${args.length} tokens`);
  console.log('\n' + c.dim('ffmpeg ' + args.map(a => /\s/.test(a) ? `"${a}"` : a).join(' ')));

  // Sanity checks that would have caught the real 4K->6K bug
  const hasScaleFilter = args.includes('-vf') && args[args.indexOf('-vf') + 1]?.startsWith('scale=');
  if (hasScaleFilter) ok('Scale filter present', 'downscale will be applied — matches requested resolution');
  else { fail('No scale filter found', 'source > target but no scale=W:H filter — this is the 4K->6K bug class'); hadFailure = true; }
}

function cmdVerify(folderPath) {
  if (!folderPath) { fail('Usage: verify <folderPath>'); hadFailure = true; return; }
  section(`Verify delivery: ${folderPath}`);
  if (!fs.existsSync(folderPath)) { fail('Folder does not exist'); hadFailure = true; return; }

  // ffprobe path: try bundled mac path as a best-effort default; skip spec check if absent.
  const guesses = [
    path.join(__dirname, '..', 'ffmpeg', 'mac', 'ffprobe'),
    path.join(__dirname, '..', 'ffmpeg', 'win', 'ffprobe.exe'),
    path.join(__dirname, '..', 'ffmpeg', 'linux', 'ffprobe'),
  ];
  const ffprobePath = guesses.find(p => fs.existsSync(p)) || null;
  if (!ffprobePath) console.log(c.dim('  (no bundled ffprobe found — video spec check will be skipped, MD5 checks still run)'));

  return verifyDelivery({ folderPath, ffprobePath }).then(result => {
    if (result.error) { fail('Verify errored', result.error); hadFailure = true; return; }
    ok('Parsed delivery_report.txt', result.parsed?.meta?.filmTitle || '(no title found)');
    for (const check of result.checks) {
      if (check.status === 'pass') ok(check.label, check.actual);
      else if (check.status === 'warn') console.log(c.yellow('⚠ ') + check.label + c.dim(' — ' + check.detail));
      else { fail(check.label, check.detail); hadFailure = true; }
    }
    console.log('\n' + c.bold('Overall: ') + (result.overall === 'pass' ? c.green('PASS') : result.overall === 'warn' ? c.yellow('WARN') : c.red('FAIL')));
    console.log('\n' + c.dim(buildVerificationReport(result, '0.0.0-devtest')));
  });
}

function cmdReport(presetId, resLabel, fps) {
  if (!presetId || !resLabel || !fps) { fail('Usage: report <presetId> <resLabel> <fps>'); hadFailure = true; return; }
  section(`Sample delivery report: ${presetId} @ ${resLabel} ${fps}fps`);
  const cfg = presetsLoader.loadPreset(PRESETS_DIR, presetId);
  if (cfg.error) { fail('Preset load failed', cfg.error); hadFailure = true; return; }
  const resolution = cfg.video.allowed_resolutions.find(r => r.label === resLabel);
  if (!resolution) { fail('Resolution not found in preset'); hadFailure = true; return; }

  const report = buildDeliveryReport({
    filmTitle: 'Devtest Sample Film',
    artistName: 'Test Artist',
    config: cfg,
    resolution, frameRate: parseInt(fps, 10),
    sourceType: 'png', sourceBitDepth: 16,
    encodeParams: { totalFrames: 5400 },
    outputFilename: `Devtest_Sample_Film_${resLabel}.mp4`,
    videoSizeBytes: 12_345_678_900,
    videoMd5: 'deadbeef0000000000000000000000',
    audioResult: { mode: '5.1', stems: ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'].map(ch => ({ channel: ch, filename: `Devtest_Sample_Film_${ch}.wav`, md5: 'abc123' })) },
    encoderLabel: 'libx265 (CPU)', encoderName: 'libx265', isGPU: false,
    appVersion: '0.0.0-devtest', ffmpegVersion: '8.1.1', ffmpegSource: 'bundled',
  });
  ok('Report generated', `${report.length} chars`);
  console.log('\n' + report);
}

async function cmdMd5(filePath) {
  if (!filePath) { fail('Usage: md5 <filePath>'); hadFailure = true; return; }
  if (!fs.existsSync(filePath)) { fail('File does not exist'); hadFailure = true; return; }
  section(`MD5: ${filePath}`);
  const size = fs.statSync(filePath).size;
  ok('File size', (size / 1024 / 1024).toFixed(1) + ' MB');
  let lastPct = -1;
  const start = Date.now();
  const hash = await computeMd5(filePath, ({ bytesHashed, totalBytes }) => {
    const pct = Math.round((bytesHashed / totalBytes) * 100);
    if (pct !== lastPct) {
      lastPct = pct;
      process.stdout.write(`\r  hashing… ${pct}%`);
    }
  });
  process.stdout.write('\n');
  ok('MD5', hash + c.dim(`  (${((Date.now() - start) / 1000).toFixed(1)}s)`));
}

function cmdGpu(platformArg, codecArg) {
  const platformStr = platformArg || process.platform;
  const codec = codecArg || 'hevc';
  section(`GPU candidates: ${platformStr} / ${codec}`);
  const candidates = gpuDetection.getCandidates(platformStr, codec);
  if (!candidates.length) { fail('No candidates for this platform/codec combo'); hadFailure = true; return; }
  for (const cand of candidates) {
    ok(cand.name, `${cand.label} · profile ${cand.profile}${cand.requiresSystemFFmpeg ? ' · needs system ffmpeg' : ''}`);
  }
}

async function cmdAll() {
  section('SMOKE TEST — running every check against fixture data');
  cmdPresets();
  const presets = presetsLoader.listPresets(PRESETS_DIR).filter(p => !p.isExample);
  const firstPreset = presets[0];
  if (firstPreset) {
    cmdPreset(firstPreset.id);
    cmdResolution(4096, 4096, firstPreset.id);
    cmdResolution(1920, 1080, firstPreset.id);
    const cfg = presetsLoader.loadPreset(PRESETS_DIR, firstPreset.id);
    const firstRes = cfg?.video?.allowed_resolutions?.[0];
    if (firstRes) {
      cmdEncodeArgs(firstPreset.id, firstRes.label, '30', []);
      cmdReport(firstPreset.id, firstRes.label, '30');
    }
  } else {
    fail('No non-example presets found — cannot run full smoke test');
    hadFailure = true;
  }
  cmdGpu('darwin', 'hevc');
  cmdGpu('win32', 'hevc');
  cmdGpu('linux', 'hevc');

  console.log('\n' + (hadFailure ? c.red(c.bold('SMOKE TEST: FAILURES FOUND')) : c.green(c.bold('SMOKE TEST: ALL CHECKS PASSED'))));
}

// ─── Dispatch ──────────────────────────────────────────────────────────────

async function main() {
  const [, , command, ...rest] = process.argv;
  const flags = rest.filter(a => a.startsWith('--'));
  const args = rest.filter(a => !a.startsWith('--'));

  switch (command) {
    case 'presets':      cmdPresets(); break;
    case 'preset':       cmdPreset(args[0]); break;
    case 'resolution':   cmdResolution(args[0], args[1], args[2]); break;
    case 'encode-args':  cmdEncodeArgs(args[0], args[1], args[2], flags); break;
    case 'verify':       await cmdVerify(args[0]); break;
    case 'report':       cmdReport(args[0], args[1], args[2]); break;
    case 'md5':          await cmdMd5(args[0]); break;
    case 'gpu':          cmdGpu(args[0], args[1]); break;
    case 'all':          await cmdAll(); break;
    default:
      console.log(`
${c.bold('devtest.js')} — headless debug CLI for the Dome Festival Delivery Tool

  node scripts/devtest.js <command> [args...]

Commands:
  presets                                List bundled festival presets
  preset <id>                            Print one preset's full config
  resolution <srcW> <srcH> [presetId]    Show allowed output resolutions for a source size
  encode-args <presetId> <res> <fps> [--gpu] [--video]
                                          Print the exact ffmpeg argv (dry run)
  verify <folderPath>                    Run Festival Verify Mode against a real folder
  report <presetId> <res> <fps>          Print a sample delivery_report.txt
  md5 <filePath>                         Compute MD5 with live progress
  gpu [platform] [codec]                 Show GPU encoder candidates
  all                                    Run every check as a smoke test

Examples:
  node scripts/devtest.js presets
  node scripts/devtest.js resolution 8192 8192 dfw-2027
  node scripts/devtest.js encode-args dfw-2027 4K 30 --gpu
  node scripts/devtest.js verify ~/Desktop/Some_Delivery_Folder
  node scripts/devtest.js all
`);
      if (command) { fail(`Unknown command: ${command}`); hadFailure = true; }
  }

  process.exit(hadFailure ? 1 : 0);
}

main().catch(err => {
  fail('Uncaught error', err.stack || err.message);
  process.exit(1);
});
