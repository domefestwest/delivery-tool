/**
 * verify-delivery.js — Festival-side verification of a received delivery.
 *
 * Reads a delivery_report.txt produced by buildDeliveryReport(), then re-checks
 * every file in the delivery folder:
 *   - MD5 checksum matches the report
 *   - Video file matches expected codec / resolution / fps / 10-bit
 *   - Audio stems are present and probe-able
 *
 * Produces a structured verification result + a plain-text verification report
 * the festival can save next to the delivery.
 *
 * Pure parsing is in parseDeliveryReport(). I/O-heavy verification lives in
 * verifyDelivery(), which composes existing modules:
 *   - utils.computeMd5
 *   - output-verification.probeAndVerify
 */

const fs = require('fs');
const path = require('path');

const { computeMd5 } = require('./utils');
const { probeAndVerify } = require('./output-verification');

// ─── Pure: parse delivery_report.txt ──────────────────────────────────────────

/**
 * Parse a delivery_report.txt body into a structured spec.
 * Returns { meta, video, source, audio, tool, warnings } or { error }.
 *
 * Forgiving — unknown lines are ignored; missing fields end up null.
 */
function parseDeliveryReport(text) {
  if (!text || typeof text !== 'string') {
    return { error: 'Empty or invalid report text' };
  }

  const lines = text.split(/\r?\n/);
  const out = {
    meta:   { filmTitle: null, artist: null, festival: null, encodeDate: null, encodeDuration: null },
    video:  { outputFile: null, codec: null, encoder: null, width: null, height: null,
              resolutionLabel: null, frameRate: null, bitDepth: null, pixFmt: null,
              fileSize: null, md5: null },
    source: { type: null, codec: null, fps: null, frameCount: null, bitDepth: null },
    audio:  { format: null, sampleRate: null, stems: [] },  // stems: [{channel, filename, md5}]
    tool:   { version: null, ffmpegVersion: null, ffmpegSource: null, gpuEncode: null },
    warnings: [],
  };

  // Section tracker so we know which "MD5" we're looking at, etc.
  let section = 'header';
  let inAudioStems = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { inAudioStems = false; continue; }

    if (line.startsWith('── VIDEO'))    { section = 'video';    inAudioStems = false; continue; }
    if (line.startsWith('── SOURCE'))   { section = 'source';   inAudioStems = false; continue; }
    if (line.startsWith('── AUDIO'))    { section = 'audio';    inAudioStems = false; continue; }
    if (line.startsWith('── WARNINGS')) { section = 'warnings'; inAudioStems = false; continue; }
    if (line.startsWith('── TOOL'))     { section = 'tool';     inAudioStems = false; continue; }
    if (line.startsWith('=='))          { inAudioStems = false; continue; }

    // Audio stems: "  L     foo_L.wav  MD5: abc123..."
    if (section === 'audio' && inAudioStems && /^\s+[A-Za-z]+\s+\S+\.wav/.test(line)) {
      const m = line.match(/^\s+(\S+)\s+(\S+\.wav)\s+MD5:\s*(\S+)/);
      if (m) {
        out.audio.stems.push({ channel: m[1], filename: m[2], md5: m[3] === '(unavailable)' ? null : m[3] });
        continue;
      }
    }

    // Generic "Label: value" line
    const kv = line.match(/^([A-Za-z][A-Za-z0-9 /]*):\s*(.*)$/);
    if (!kv) {
      if (section === 'warnings' && line.includes('⚠')) {
        out.warnings.push(line.replace(/^.*⚠\s*/, '').trim());
      }
      continue;
    }
    const key = kv[1].trim().toLowerCase();
    const val = kv[2].trim();

    if (section === 'header' || section === 'video' && key === 'film title') {
      if (key === 'film title')    out.meta.filmTitle = val;
      else if (key === 'artist/studio') out.meta.artist = val === '(not provided)' ? null : val;
      else if (key === 'festival') out.meta.festival = val;
      else if (key === 'encode date') out.meta.encodeDate = val;
      else if (key === 'encode duration') out.meta.encodeDuration = val;
    }

    if (section === 'video') {
      if (key === 'output file')   out.video.outputFile = val;
      else if (key === 'codec')    out.video.codec = val;
      else if (key === 'encoder')  out.video.encoder = val;
      else if (key === 'resolution') {
        const m = val.match(/^(\d+)[×x](\d+)(?:\s+\(([^)]+)\))?/);
        if (m) {
          out.video.width = parseInt(m[1], 10);
          out.video.height = parseInt(m[2], 10);
          out.video.resolutionLabel = m[3] || null;
        }
      }
      else if (key === 'frame rate') {
        const m = val.match(/^([\d.]+)/);
        if (m) out.video.frameRate = parseFloat(m[1]);
      }
      else if (key === 'bit depth') {
        out.video.bitDepth = val;
        const pix = val.match(/\(([^)]+)\)/);
        if (pix) out.video.pixFmt = pix[1];
      }
      else if (key === 'file size')    out.video.fileSize = val;
      else if (key === 'md5 checksum') out.video.md5 = val === '(unavailable)' ? null : val;
    }

    if (section === 'source') {
      if (key === 'source type')        out.source.type = val;
      else if (key === 'source codec')  out.source.codec = val;
      else if (key === 'source fps')    out.source.fps = val;
      else if (key === 'frame count')   out.source.frameCount = parseInt(val, 10) || null;
      else if (key === 'source bit depth') out.source.bitDepth = val;
    }

    if (section === 'audio') {
      if (key === 'audio format')  out.audio.format = val;
      else if (key === 'sample rate') out.audio.sampleRate = val;
      else if (key === 'audio' && /none/i.test(val)) out.audio.format = 'None';
      else if (key === 'stems') inAudioStems = true;
    }

    if (section === 'tool') {
      if (key === 'tool version')        out.tool.version = val;
      else if (key === 'ffmpeg version') out.tool.ffmpegVersion = val;
      else if (key === 'ffmpeg source')  out.tool.ffmpegSource = val;
      else if (key === 'gpu encode')     out.tool.gpuEncode = val;
    }
  }

  // Sanity: must at least have a video output filename
  if (!out.video.outputFile) {
    return { error: 'Could not find video output filename in report — is this a delivery_report.txt?' };
  }
  return out;
}

// ─── I/O: verify a delivery folder against its report ────────────────────────

/**
 * Verify a delivery folder.
 *
 * @param {object} args
 * @param {string} args.folderPath    — path to the delivery folder
 * @param {string} args.ffprobePath   — path to ffprobe binary
 * @returns {Promise<object>} { ok, overall, checks, parsed, folderPath }
 */
async function verifyDelivery({ folderPath, ffprobePath }) {
  if (!folderPath || !fs.existsSync(folderPath)) {
    return { error: 'Folder not found: ' + folderPath };
  }
  if (!fs.statSync(folderPath).isDirectory()) {
    return { error: 'Not a folder: ' + folderPath };
  }

  // Find delivery_report.txt
  const reportPath = path.join(folderPath, 'delivery_report.txt');
  if (!fs.existsSync(reportPath)) {
    return { error: 'No delivery_report.txt found in folder. Is this a delivery folder produced by this tool?' };
  }

  let reportText;
  try { reportText = fs.readFileSync(reportPath, 'utf8'); }
  catch (err) { return { error: 'Could not read delivery_report.txt: ' + err.message }; }

  const parsed = parseDeliveryReport(reportText);
  if (parsed.error) return { error: parsed.error };

  const checks = [];

  // ─── Check 1: video file exists ─────────────────────────────────────────
  const videoPath = findFile(folderPath, parsed.video.outputFile);
  if (!videoPath) {
    checks.push({
      id: 'video-exists', label: 'Video file present',
      status: 'fail', expected: parsed.video.outputFile, actual: 'missing',
      detail: 'The video file named in the delivery report is not present in the folder.',
    });
  } else {
    checks.push({
      id: 'video-exists', label: 'Video file present',
      status: 'pass', expected: parsed.video.outputFile, actual: path.basename(videoPath),
    });
  }

  // ─── Check 2: video MD5 matches ─────────────────────────────────────────
  if (videoPath && parsed.video.md5) {
    try {
      const actualMd5 = await computeMd5(videoPath);
      checks.push({
        id: 'video-md5', label: 'Video MD5 checksum',
        status: actualMd5 === parsed.video.md5 ? 'pass' : 'fail',
        expected: parsed.video.md5,
        actual: actualMd5,
        detail: actualMd5 === parsed.video.md5
          ? 'File transferred intact — every byte matches what was encoded.'
          : 'File contents differ from what was encoded. This usually means the file was corrupted in transit, or the wrong file was uploaded.',
      });
    } catch (err) {
      checks.push({
        id: 'video-md5', label: 'Video MD5 checksum',
        status: 'fail', expected: parsed.video.md5, actual: 'error',
        detail: 'Could not compute MD5: ' + err.message,
      });
    }
  } else if (videoPath && !parsed.video.md5) {
    checks.push({
      id: 'video-md5', label: 'Video MD5 checksum',
      status: 'warn', expected: 'none in report', actual: '(skipped)',
      detail: 'The delivery report does not include an MD5 for the video. Cannot verify integrity.',
    });
  }

  // ─── Check 3: video spec matches via ffprobe ────────────────────────────
  if (videoPath && ffprobePath && parsed.video.width && parsed.video.height) {
    const expected = {
      codec: codecFromReport(parsed.video.codec),
      pixFmt: parsed.video.pixFmt || 'yuv420p10le',
      width: parsed.video.width,
      height: parsed.video.height,
      frameRate: parsed.video.frameRate || 30,
    };
    const result = await probeAndVerify(ffprobePath, videoPath, expected);
    const errors = (result.issues || []).filter(i => i.severity === 'error');
    checks.push({
      id: 'video-spec', label: 'Video spec matches report',
      status: errors.length === 0 ? 'pass' : 'fail',
      expected: `${expected.codec} ${expected.width}×${expected.height} ${expected.frameRate}fps 10-bit`,
      actual: result.probe
        ? `${result.probe.codec} ${result.probe.width}×${result.probe.height} ${result.probe.fps}fps ${result.probe.pixFmt}`
        : 'probe failed',
      detail: errors.length === 0
        ? 'Video file matches the codec, resolution, frame rate and bit depth recorded in the delivery report.'
        : 'Mismatches: ' + errors.map(e => `${e.field} expected ${e.expected}, got ${e.actual}`).join('; '),
    });
  }

  // ─── Check 4: audio stems present + MD5s match ──────────────────────────
  if (parsed.audio.stems.length > 0) {
    let stemPassCount = 0;
    let stemFailCount = 0;
    const stemDetails = [];
    for (const stem of parsed.audio.stems) {
      const stemPath = findFile(folderPath, stem.filename);
      if (!stemPath) {
        stemFailCount++;
        stemDetails.push(`${stem.channel}: MISSING (${stem.filename})`);
        continue;
      }
      if (!stem.md5) {
        stemPassCount++;
        stemDetails.push(`${stem.channel}: present (no MD5 in report)`);
        continue;
      }
      try {
        const actualMd5 = await computeMd5(stemPath);
        if (actualMd5 === stem.md5) {
          stemPassCount++;
          stemDetails.push(`${stem.channel}: ✓ match`);
        } else {
          stemFailCount++;
          stemDetails.push(`${stem.channel}: MD5 MISMATCH`);
        }
      } catch (err) {
        stemFailCount++;
        stemDetails.push(`${stem.channel}: error — ${err.message}`);
      }
    }
    checks.push({
      id: 'audio-stems', label: `Audio stems (${parsed.audio.stems.length})`,
      status: stemFailCount === 0 ? 'pass' : 'fail',
      expected: `${parsed.audio.stems.length} files, all MD5s match`,
      actual: `${stemPassCount} passed, ${stemFailCount} failed`,
      detail: stemDetails.join(' · '),
    });
  } else if (parsed.audio.format && /none/i.test(parsed.audio.format)) {
    checks.push({
      id: 'audio-stems', label: 'Audio stems',
      status: 'pass', expected: 'none', actual: 'none',
      detail: 'Delivery report indicates no audio was delivered.',
    });
  }

  // ─── Overall verdict ────────────────────────────────────────────────────
  const failCount = checks.filter(c => c.status === 'fail').length;
  const warnCount = checks.filter(c => c.status === 'warn').length;
  const overall = failCount > 0 ? 'fail' : warnCount > 0 ? 'warn' : 'pass';

  return {
    ok: failCount === 0,
    overall,
    checks,
    parsed,
    folderPath,
    verifiedAt: new Date().toISOString(),
  };
}

// ─── Save a human-readable verification report ───────────────────────────────

/**
 * Build a plain-text verification report from the verifyDelivery() result.
 * Pure function — easy to test.
 */
function buildVerificationReport(result, appVersion) {
  if (!result || result.error) return `VERIFICATION FAILED\n${result?.error || 'Unknown error'}\n`;

  const L = [];
  const dateStr = (result.verifiedAt || '').replace('T', ' ').split('.')[0] + ' UTC';

  L.push('='.repeat(60));
  L.push('DELIVERY VERIFICATION REPORT');
  L.push('='.repeat(60));
  L.push('');
  L.push(`Verified: ${dateStr}`);
  L.push(`Tool:     Dome Festival Delivery Tool v${appVersion}`);
  L.push(`Folder:   ${result.folderPath}`);
  L.push('');
  L.push(`Delivery: ${result.parsed?.meta?.filmTitle || '(unknown)'}`);
  L.push(`Artist:   ${result.parsed?.meta?.artist || '(not provided)'}`);
  L.push(`Festival: ${result.parsed?.meta?.festival || '(unknown)'}`);
  L.push(`Encoded:  ${result.parsed?.meta?.encodeDate || '(unknown)'}`);
  L.push('');
  L.push('─'.repeat(60));
  const verdictLabel = result.overall === 'pass' ? '✓ PASS'
                    : result.overall === 'warn' ? '⚠ PASS WITH WARNINGS'
                    : '✗ FAIL';
  L.push(`OVERALL:  ${verdictLabel}`);
  L.push('─'.repeat(60));
  L.push('');

  for (const c of result.checks) {
    const icon = c.status === 'pass' ? '✓' : c.status === 'warn' ? '⚠' : '✗';
    L.push(`${icon} ${c.label}`);
    L.push(`    expected: ${c.expected}`);
    L.push(`    actual:   ${c.actual}`);
    if (c.detail) L.push(`    note:     ${c.detail}`);
    L.push('');
  }

  L.push('='.repeat(60));
  if (result.overall === 'pass') {
    L.push('This delivery matches the original encode exactly.');
    L.push('Safe to accept for projection.');
  } else if (result.overall === 'warn') {
    L.push('This delivery is broadly correct but has some warnings.');
    L.push('Review the notes above before accepting.');
  } else {
    L.push('This delivery does NOT match what was encoded.');
    L.push('Contact the filmmaker — the file may be corrupted, ');
    L.push('the wrong file, or modified after encoding.');
  }
  L.push('='.repeat(60));

  return L.join('\n');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Find a file by basename anywhere inside the delivery folder (1 level deep).
 * Returns full path or null.
 */
function findFile(folderPath, basename) {
  if (!basename) return null;
  const direct = path.join(folderPath, basename);
  if (fs.existsSync(direct)) return direct;

  // Check subdirectories (video/, audio/)
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const sub = path.join(folderPath, entry.name, basename);
      if (fs.existsSync(sub)) return sub;
    }
  }
  return null;
}

/**
 * Map the report's "Codec" string to an ffprobe codec name.
 *   "H.265 / HEVC" → "hevc"
 *   "H.264 / AVC"  → "h264"
 */
function codecFromReport(reportCodec) {
  if (!reportCodec) return 'hevc';
  if (/hevc|h\.?265/i.test(reportCodec)) return 'hevc';
  if (/h\.?264|avc/i.test(reportCodec)) return 'h264';
  return reportCodec.toLowerCase();
}

module.exports = {
  parseDeliveryReport,
  verifyDelivery,
  buildVerificationReport,
};
