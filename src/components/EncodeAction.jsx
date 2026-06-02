import React, { useState, useEffect, useRef } from 'react';

/**
 * EncodeAction — the bottom of the layout, full-width.
 *
 * Three states stacked:
 *   1. Pre-flight bar: disk + estimate + test encode button
 *   2. Encode button (when ready)
 *   3. Progress (when encoding) or Results (when done)
 */

const BANDING_NOTE = `If you see color banding on the dome, it is almost never caused by H.265 encoding at CRF 18 10-bit. The most common causes are:
  (1) the source PNG sequence was itself 8-bit,
  (2) the compositing software baked banding into the render, or
  (3) the dome's playback system is outputting an 8-bit signal.
Export your source from your compositing software at 16-bit PNG or EXR before using this tool.`;

function formatBytes(b) {
  if (!b) return '—';
  if (b < 1024 ** 3) return (b / 1024 ** 2).toFixed(1) + ' MB';
  return (b / 1024 ** 3).toFixed(2) + ' GB';
}
function formatETA(s) {
  if (s == null || s < 0 || !isFinite(s)) return null;
  if (s < 60) return `${Math.round(s)}s remaining`;
  if (s < 3600) {
    const m = Math.floor(s / 60); const sec = Math.round(s % 60);
    return `${m}m ${sec}s remaining`;
  }
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m remaining`;
}
function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60); const sec = s % 60;
  if (m < 60) return `${m}m ${sec}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export default function EncodeAction({
  config, filmTitle, artistName,
  sourceType, pngData, pngFolder, pngFrameRate,
  videoPath, videoData, videoFrameRate,
  mode, watermark,
  selectedResolutions, outputDir,
  audioMode, audioStems, audioInterleaved, muxAudio,
  frameRateWarning, encodeReady,
  depStatus, useGPU,
  autoZip, notifyOnComplete, autoOpenFolder, preventSleep,
}) {
  const isScreener = mode === 'screener';
  const [encoding, setEncoding] = useState(false);
  const [result, setResult]     = useState(null);            // single result or { batchResults: [] }
  const [error, setError]       = useState(null);
  const [progress, setProgress] = useState(null);
  const [activeEncoder, setActiveEncoder] = useState(null);
  const [log, setLog]           = useState('');
  const [showLog, setShowLog]   = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  // Batch state — when selectedResolutions.length > 1
  const [batchIdx, setBatchIdx]     = useState(null);
  const [batchTotal, setBatchTotal] = useState(null);
  const [currentRes, setCurrentRes] = useState(null);

  const [diskCheck, setDiskCheck] = useState(null);
  const [testing, setTesting]     = useState(false);
  const [testResult, setTestResult] = useState(null);

  // Use first resolution for previews/disk-check (representative).
  const resolution = selectedResolutions?.[0] || null;
  const isBatch = selectedResolutions?.length > 1;

  const startTimeRef = useRef(null);
  const timerRef     = useRef(null);
  const logRef       = useRef(null);

  const gpu = depStatus?.gpu;
  const gpuAvailable = gpu?.available;
  const willUseGPU = gpuAvailable && useGPU;

  const effectiveFps = sourceType === 'png' ? pngFrameRate : videoFrameRate;
  const sourceDuration = sourceType === 'png'
    ? (pngData?.frameCount && pngFrameRate ? pngData.frameCount / pngFrameRate : null)
    : videoData?.duration;

  // Elapsed timer
  useEffect(() => {
    if (encoding) {
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startTimeRef.current);
      }, 500);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [encoding]);

  // Log autoscroll
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  // IPC subscriptions
  useEffect(() => {
    const u1 = window.api.onEncodeProgress(d => setProgress(d));
    const u2 = window.api.onEncodeLog(c => setLog(prev => prev + c));
    const u3 = window.api.onEncodeEncoder(d => setActiveEncoder(d));
    return () => { u1(); u2(); u3(); };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      const tag = (e.target.tagName || '').toLowerCase();
      const inEditable = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;

      // Escape = cancel encode (works anywhere)
      if (e.key === 'Escape' && encoding) {
        e.preventDefault();
        handleCancel();
        return;
      }

      if (!mod || inEditable) return;
      const k = e.key.toLowerCase();

      if (k === 'e') {
        // Cmd+E = encode
        e.preventDefault();
        if (encodeReady && !encoding && !testing) handleEncode();
      } else if (k === 't') {
        // Cmd+T = test encode
        e.preventDefault();
        if (encodeReady && !encoding && !testing) handleTestEncode();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [encodeReady, encoding, testing]);  // handleEncode/handleTestEncode/handleCancel are stable references in this component

  // Pre-flight disk check whenever inputs change
  useEffect(() => {
    if (!encodeReady || !outputDir || !resolution || !effectiveFps || !sourceDuration) {
      setDiskCheck(null);
      return;
    }
    let cancelled = false;
    window.api.checkDiskSpace({
      outputDir,
      resolutionLabel: resolution.label,
      frameRate: effectiveFps,
      durationSeconds: sourceDuration,
      isGPU: willUseGPU,
    }).then(r => { if (!cancelled) setDiskCheck(r); });
    return () => { cancelled = true; };
  }, [outputDir, resolution, effectiveFps, sourceDuration, willUseGPU, encodeReady]);

  const buildWarnings = () => {
    const w = [];
    if (frameRateWarning?.type === 'dropframe') {
      w.push(`Drop-frame conformed: source was ${videoData?.fps?.toFixed(3)}fps`);
    }
    const bd = sourceType === 'png' ? pngData?.bitDepth : videoData?.bitDepth;
    if (sourceType === 'png' && bd === 8) {
      w.push('8-bit source PNG — potential for banding in source');
    }
    if (willUseGPU) {
      w.push(`Encoded with GPU: ${gpu.label} — quality-equivalent to CRF 18 libx265`);
    }
    if (pngData?.gaps?.hasGaps) {
      w.push(`Source had ${pngData.gaps.missingTotal} missing frames`);
    }
    return w;
  };

  const commonParams = (resForThisRun = resolution) => {
    const sourceBitDepth = sourceType === 'png' ? pngData?.bitDepth : videoData?.bitDepth;
    const totalFrames = sourceType === 'png'
      ? pngData?.frameCount
      : (videoData?.duration && effectiveFps
          ? Math.round(videoData.duration * effectiveFps) : null);
    // Source dimensions — passed through so the encoder can apply the
    // scale filter when target < source (downscale case).
    const sourceWidth  = sourceType === 'png' ? pngData?.width  : videoData?.width;
    const sourceHeight = sourceType === 'png' ? pngData?.height : videoData?.height;
    return {
      sourceType,
      sourcePath: sourceType === 'png' ? pngFolder : videoPath,
      ffmpegPattern: pngData?.ffmpegPattern,
      totalFrames,
      frameRate: effectiveFps,
      resolution: resForThisRun, config,
      sourceBitDepth,
      sourceWidth, sourceHeight,
      sourceCodec: videoData?.codec,
      sourceFps: videoData?.fps,
      sourceDuration,
      useGPU: gpuAvailable && useGPU,
    };
  };

  const handleTestEncode = async () => {
    if (!encodeReady || testing || encoding) return;
    setTesting(true);
    setTestResult(null);
    // Use first selected resolution for test
    const r = await window.api.testEncode(commonParams(resolution));
    setTesting(false);
    setTestResult(r);
  };

  const handleScreenerEncode = async () => {
    if (encoding) return;
    setEncoding(true);
    setResult(null); setError(null); setProgress(null);
    setActiveEncoder(null); setLog(''); setElapsedMs(0); setTestResult(null);

    const totalFrames = sourceType === 'png'
      ? pngData?.frameCount
      : (videoData?.duration && effectiveFps
          ? Math.round(videoData.duration * effectiveFps) : null);

    const r = await window.api.startScreener({
      sourceType,
      sourcePath: sourceType === 'png' ? pngFolder : videoPath,
      ffmpegPattern: pngData?.ffmpegPattern,
      frameRate: effectiveFps,
      totalFrames,
      outputDir,
      filmTitle: filmTitle.trim(),
      artistName: artistName.trim(),
      config,
      watermark,
      useGPU,           // honor the artist's GPU preference for screener too
      notifyOnComplete,
      preventSleep,
    });

    setEncoding(false);
    if (r.error) setError(r.error);
    else {
      setResult(r);
      if (autoOpenFolder && r.deliveryFolder) window.api.openPath(r.deliveryFolder);
    }
  };

  const handleEncode = async () => {
    if (isScreener) return handleScreenerEncode();
    if (!encodeReady || encoding) return;
    setEncoding(true);
    setResult(null); setError(null); setProgress(null);
    setActiveEncoder(null); setLog(''); setElapsedMs(0); setTestResult(null);

    const queue = selectedResolutions;
    setBatchTotal(isBatch ? queue.length : null);
    setBatchIdx(isBatch ? 0 : null);

    const batchResults = [];
    for (let i = 0; i < queue.length; i++) {
      const res = queue[i];
      if (isBatch) {
        setBatchIdx(i);
        setCurrentRes(res);
        setProgress(null);
        setLog(prev => prev + `\n══ Encoding ${i + 1} of ${queue.length}: ${res.label} ══\n`);
      }
      const params = {
        ...commonParams(res),
        outputDir,
        filmTitle: filmTitle.trim(),
        artistName: artistName.trim(),
        audioMode,
        audioFiles: audioStems.map(s => ({ channel: s.channel, filePath: s.filePath })),
        audioInterleaved, muxAudio,
        warnings: buildWarnings(),
        autoZip, notifyOnComplete: notifyOnComplete && (i === queue.length - 1),  // notify only on last
        preventSleep,
      };
      const r = await window.api.startEncode(params);
      batchResults.push({ resolution: res, ...r });
      if (r.error) {
        setError(`${res.label} failed: ${r.error}`);
        break;
      }
    }

    setEncoding(false);
    setBatchIdx(null);
    setBatchTotal(null);
    setCurrentRes(null);

    if (!batchResults.length) return;
    if (isBatch) {
      const successes = batchResults.filter(r => r.success);
      if (successes.length === queue.length) {
        // All succeeded
        setResult({ batchResults });
        if (autoOpenFolder && successes[0]?.deliveryFolder) {
          // Open the PARENT of the first delivery folder to see all batch outputs
          const parent = successes[0].deliveryFolder.replace(/[\\/][^\\/]+$/, '');
          window.api.openPath(parent);
        }
      } else {
        // Partial — still surface what we got
        setResult({ batchResults, partial: true });
      }
    } else {
      // Single encode — preserve old behavior
      const single = batchResults[0];
      if (!single.error) {
        setResult(single);
        if (autoOpenFolder && single.deliveryFolder) window.api.openPath(single.deliveryFolder);
      }
    }
  };

  const handleCancel = async () => {
    await window.api.cancelEncode();
    setEncoding(false);
    setError('Encode cancelled.');
  };
  const handleOpenFolder = () => result?.deliveryFolder && window.api.openPath(result.deliveryFolder);
  const handleZipNow = async () => {
    if (!result?.deliveryFolder) return;
    const z = await window.api.zipDelivery(result.deliveryFolder);
    setResult({ ...result, zip: z });
  };

  // Build a context summary for the debug log
  const buildContextSummary = () => ({
    filmTitle, artistName, sourceType,
    sourcePath: sourceType === 'png' ? pngFolder : videoPath,
    pngData: pngData ? {
      pattern: pngData.pattern, frameCount: pngData.frameCount,
      bitDepth: pngData.bitDepth, hasGaps: !!pngData.gaps?.hasGaps,
    } : null,
    videoData: videoData ? {
      codec: videoData.codec, width: videoData.width, height: videoData.height,
      fps: videoData.fps, duration: videoData.duration, bitDepth: videoData.bitDepth,
    } : null,
    resolution, frameRate: effectiveFps, outputDir,
    audioMode, audioStemCount: audioStems?.length || 0, muxAudio,
    useGPU, willUseGPU,
    frameRateWarning,
    result: result ? {
      deliveryFolder: result.deliveryFolder,
      videoSizeBytes: result.videoSizeBytes,
      videoMd5: result.videoMd5,
      verification: result.verification,
      loudness: result.loudness?.classification,
    } : null,
  });

  const handleSaveLog = async () => {
    const r = await window.api.saveDebugLog({
      contextSummary: buildContextSummary(),
      ffmpegLog: log,
      errorMessage: error,
    });
    if (r.ok) {
      setLog(prev => prev + `\n[Debug log saved to ${r.path}]\n`);
    } else if (r.error) {
      setLog(prev => prev + `\n[Save log failed: ${r.error}]\n`);
    }
  };

  const progressPct = progress?.frame && progress?.totalFrames
    ? Math.min(99, Math.round((progress.frame / progress.totalFrames) * 100)) : null;

  // Issues for non-ready state
  const issues = [];
  if (!filmTitle.trim()) issues.push('Film title');
  if (sourceType === 'png' && !pngData) issues.push('Source folder');
  if (sourceType === 'video' && !videoData) issues.push('Source video');
  if (frameRateWarning?.type === 'unsupported') issues.push('Frame rate unsupported');
  if (!effectiveFps) issues.push('Frame rate');
  if (!outputDir) issues.push('Output folder');
  // Screener mode doesn't need selected resolutions
  if (!isScreener && !selectedResolutions?.length) issues.push('Resolution(s)');

  // For screener mode, only need: title + source + fps + output (no resolution batch)
  const screenerReady = isScreener && filmTitle.trim() && (pngData || videoData)
    && effectiveFps && outputDir && config?.screener?.enabled;
  const effectiveEncodeReady = isScreener ? screenerReady : encodeReady;

  const diskIcon = diskCheck?.check?.status === 'ok' ? '✓'
    : diskCheck?.check?.status === 'tight' ? '⚠'
    : diskCheck?.check?.status === 'insufficient' ? '✕' : '?';
  const diskColor = diskCheck?.check?.status === 'ok' ? 'var(--green)'
    : diskCheck?.check?.status === 'tight' ? 'var(--yellow)'
    : diskCheck?.check?.status === 'insufficient' ? 'var(--red)' : 'var(--text-muted)';

  return (
    <div className="encode-action">
      {/* Pre-flight bar (always visible, shows status) */}
      {!encoding && !result && (
        <div className="preflight-bar">
          {encodeReady ? (
            <>
              {diskCheck && (
                <span className="preflight-pill" title={diskCheck.check?.message}>
                  <span style={{ color: diskColor, marginRight: 4, fontWeight: 700 }}>{diskIcon}</span>
                  Disk {diskCheck.check?.freeBytes
                    ? formatBytes(diskCheck.check.freeBytes) + ' free'
                    : 'unknown'}
                </span>
              )}
              {diskCheck?.estimate?.bytes && (
                <span className="preflight-pill">
                  Est. output {formatBytes(diskCheck.estimate.bytes)}
                </span>
              )}
              <span className="preflight-pill" style={{ marginLeft: 'auto' }}>
                <button
                  className="text-btn"
                  onClick={handleTestEncode}
                  disabled={testing}
                  title="⌘T / Ctrl+T — Encode 5 seconds, open in default player"
                >
                  {testing ? '⏳ Testing…' : '🎬 Test 5s'}
                </button>
              </span>
            </>
          ) : (
            <span className="preflight-pill" style={{ color: 'var(--text-muted)' }}>
              Missing: {issues.join(' · ')}
            </span>
          )}
        </div>
      )}

      {testResult && !result && !encoding && (
        <div className={`alert ${testResult.error ? 'alert-error' : 'alert-info'}`}
             style={{ marginBottom: 8, fontSize: 12 }}>
          {testResult.error
            ? `Test encode failed: ${testResult.error}`
            : `🎬 Test encode opened in default player (${testResult.framesEncoded} frames, ${formatBytes(testResult.sizeBytes)}). Verify color, resolution and motion are correct.`}
        </div>
      )}

      {/* Main encode button */}
      {!result && (
        <div className="encode-button-row">
          <button
            className="btn btn-primary btn-lg btn-encode"
            onClick={handleEncode}
            disabled={!effectiveEncodeReady || encoding || testing
                      || (!isScreener && diskCheck?.check?.status === 'insufficient')}
            title="⌘E / Ctrl+E"
          >
            {encoding ? '⏳ Encoding…'
              : isScreener ? '🎞 Encode Screener'
              : isBatch ? `▶ Encode ${selectedResolutions.length} resolutions`
              : '▶ Encode and Package'}
          </button>
          {encoding && (
            <button className="btn btn-danger" onClick={handleCancel} title="Esc">✕ Cancel</button>
          )}
        </div>
      )}

      {/* Progress */}
      {encoding && (
        <div className="encode-progress">
          {/* Batch position indicator */}
          {isBatch && batchTotal > 1 && (
            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
              <span className="chip chip-orange">
                Batch {(batchIdx ?? 0) + 1} of {batchTotal}
              </span>
              {currentRes && (
                <span style={{ color: '#e8e8e8', fontWeight: 600 }}>
                  Encoding {currentRes.label} ({currentRes.width}×{currentRes.height})
                </span>
              )}
            </div>
          )}
          {activeEncoder && (
            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className={`chip ${activeEncoder.isGPU ? 'chip-green' : 'chip-blue'}`}>
                {activeEncoder.isGPU ? '⚡ GPU' : '🖥 CPU'}
              </span>
              <span style={{ color: '#888', fontSize: 12 }}>{activeEncoder.label}</span>
            </div>
          )}
          <div className="encode-progress-meta">
            <span>
              {progress?.frame != null && (
                <>Frame {progress.frame.toLocaleString()}
                  {progress.totalFrames && ` / ${Number(progress.totalFrames).toLocaleString()}`}
                  {progressPct != null && ` · ${progressPct}%`}</>
              )}
            </span>
            <span style={{ display: 'flex', gap: 12 }}>
              {progress?.fps && <span style={{ color: '#666' }}>{Math.round(progress.fps)} fps</span>}
              {progress?.speed && (
                <span style={{ color: progress.speed >= 1 ? 'var(--green)' : 'var(--yellow)' }}>
                  {progress.speed.toFixed(1)}×
                </span>
              )}
            </span>
          </div>
          <div className="progress-bar-wrap">
            <div className="progress-bar-fill" style={{ width: progressPct != null ? `${progressPct}%` : '2%' }} />
          </div>
          <div className="encode-progress-footer">
            <span>
              {formatElapsed(elapsedMs)} elapsed
              {progress?.liveSizeBytes && (
                <span style={{ marginLeft: 12, color: '#888' }}>
                  · {formatBytes(progress.liveSizeBytes)} written
                </span>
              )}
            </span>
            {progress?.etaSeconds != null && progress.etaSeconds > 0 && (
              <span style={{ color: 'var(--gold)', fontWeight: 600 }}>
                ⏱ {formatETA(progress.etaSeconds)}
              </span>
            )}
          </div>
          <button
            onClick={() => setShowLog(!showLog)}
            style={{ background: 'none', border: 'none', color: '#555',
                     cursor: 'pointer', fontSize: 11, marginTop: 8 }}
          >
            {showLog ? '▲ Hide' : '▼ Show'} FFmpeg log
          </button>
          {showLog && (
            <div ref={logRef} className="log-output" style={{ marginTop: 6 }}>
              {log || 'Waiting for output…'}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && !encoding && (
        <div className="alert alert-error" style={{ marginTop: 12 }}>
          ✕ {error}
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 12px' }}
              onClick={() => { setError(null); setLog(''); }}>Try again</button>
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 12px' }}
              onClick={handleSaveLog}
              title="Save a debug log to email Ryan@domefestwest.com">
              💾 Save debug log…
            </button>
          </div>
          {log && (
            <pre style={{ marginTop: 10, fontSize: 11, fontFamily: 'monospace',
                          color: '#f08080', maxHeight: 200, overflow: 'auto',
                          whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {log.slice(-3000)}
            </pre>
          )}
        </div>
      )}

      {/* Success — single encode */}
      {result && !encoding && !result.batchResults && (
        <div className="encode-success">
          <div className="alert alert-ok" style={{ marginBottom: 12 }}>
            ✓ <strong>Delivery package complete!</strong> Encoded in {formatElapsed(elapsedMs)}.
          </div>

          {/* Verification panel */}
          {result.verification && (
            <div className={`alert ${result.verification.ok ? 'alert-ok' : 'alert-error'}`}
                 style={{ fontSize: 12, marginBottom: 8 }}>
              <strong>{result.verification.summary}</strong>
              {result.verification.issues?.length > 0 && (
                <ul style={{ margin: '4px 0 0 18px' }}>
                  {result.verification.issues.map((i, idx) => (
                    <li key={idx} style={{
                      color: i.severity === 'error' ? '#f08080'
                        : i.severity === 'warning' ? '#e8b84b' : '#888',
                    }}>
                      {i.field}: expected {i.expected}, got {i.actual}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Loudness */}
          {result.loudness?.classification && (
            <div className={`alert ${
              result.loudness.classification.severity === 'ok' ? 'alert-ok'
                : result.loudness.classification.severity === 'warning' ? 'alert-warn'
                : 'alert-error'
            }`} style={{ fontSize: 12, marginBottom: 8 }}>
              🔊 {result.loudness.classification.message}
            </div>
          )}

          <div className="encode-result-meta">
            <div>
              <span className="muted small">Location: </span>
              <span className="mono" style={{ fontSize: 11 }}>{result.deliveryFolder}</span>
            </div>
            <div className="muted small" style={{ marginTop: 2 }}>
              {formatBytes(result.videoSizeBytes)}
              {result.videoMd5 && ` · MD5 ${result.videoMd5.slice(0, 16)}…`}
              {result.zip?.ok && ` · ZIP ${formatBytes(result.zip.sizeBytes)}`}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={handleOpenFolder}>📁 Open Folder</button>
            {!result.zip?.ok && (
              <button className="btn btn-secondary" onClick={handleZipNow}>📦 Create ZIP</button>
            )}
            {result.zip?.ok && (
              <button className="btn btn-secondary" onClick={() => window.api.showInFolder(result.zip.zipPath)}>
                📦 Reveal ZIP
              </button>
            )}
            <button className="btn btn-secondary"
              onClick={() => { setResult(null); setLog(''); setProgress(null); setActiveEncoder(null); }}>
              New Encode
            </button>
            <button className="btn btn-ghost" onClick={handleSaveLog}
              title="Save a portable debug log (for support)">
              💾 Save log
            </button>
          </div>

          {/* Collapsible report */}
          <details style={{ marginTop: 14 }}>
            <summary style={{ cursor: 'pointer', color: '#888', fontSize: 12, padding: '4px 0' }}>
              ▾ Delivery report
            </summary>
            <pre style={{
              background: '#111', border: '1px solid #333', borderRadius: 6,
              color: '#aaa', fontFamily: 'monospace', fontSize: 11, lineHeight: 1.6,
              maxHeight: 260, overflow: 'auto', padding: '12px 14px',
              whiteSpace: 'pre-wrap', marginTop: 6,
            }}>
              {result.report}
            </pre>
          </details>

          {/* Banding note (collapsible) */}
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: 'pointer', color: '#4a9ede', fontSize: 12,
                              fontWeight: 600, padding: '4px 0' }}>
              📚 About color banding on dome
            </summary>
            <div style={{ color: '#aaa', fontSize: 12, lineHeight: 1.7,
                          whiteSpace: 'pre-line', marginTop: 6,
                          padding: '10px 14px', background: 'rgba(74,158,222,0.05)',
                          borderRadius: 6, border: '1px solid rgba(74,158,222,0.15)' }}>
              {BANDING_NOTE}
            </div>
          </details>
        </div>
      )}

      {/* Success — batch encode */}
      {result?.batchResults && !encoding && (
        <div className="encode-success">
          <div className={`alert ${result.partial ? 'alert-warn' : 'alert-ok'}`} style={{ marginBottom: 12 }}>
            {result.partial
              ? `⚠ Batch partial: ${result.batchResults.filter(b => b.success).length} of ${result.batchResults.length} resolutions completed.`
              : `✓ All ${result.batchResults.length} resolutions complete!`}
            {' '}Total: {formatElapsed(elapsedMs)}.
          </div>

          {result.batchResults.map((b, i) => (
            <div key={i} style={{
              background: 'var(--bg-1)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '10px 14px', marginBottom: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span className={`chip ${b.success ? 'chip-green' : 'chip-red'}`}>
                  {b.success ? '✓' : '✕'} {b.resolution.label}
                </span>
                <span style={{ color: '#aaa', fontSize: 12 }}>
                  {b.resolution.width}×{b.resolution.height}
                </span>
                {b.videoSizeBytes && (
                  <span style={{ color: '#888', fontSize: 11 }}>{formatBytes(b.videoSizeBytes)}</span>
                )}
                {b.verification && !b.verification.ok && (
                  <span className="chip chip-red" style={{ marginLeft: 4 }}>verify failed</span>
                )}
              </div>
              {b.error && (
                <div style={{ color: '#f08080', fontSize: 12, marginBottom: 6 }}>
                  ✕ {b.error}
                </div>
              )}
              {b.deliveryFolder && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <code style={{ fontSize: 11, color: '#888', flex: 1,
                                 overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.deliveryFolder}
                  </code>
                  <button className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }}
                    onClick={() => window.api.openPath(b.deliveryFolder)}>📁</button>
                </div>
              )}
            </div>
          ))}

          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary"
              onClick={() => { setResult(null); setLog(''); setProgress(null); setActiveEncoder(null); }}>
              New Encode
            </button>
            <button className="btn btn-ghost" onClick={handleSaveLog}>
              💾 Save log
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
