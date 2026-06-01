import React, { useState, useEffect, useRef } from 'react';

const BANDING_NOTE = `If you see color banding on the dome, it is almost never caused by H.265 encoding at CRF 18 10-bit. The most common causes are:
  (1) the source PNG sequence was itself 8-bit,
  (2) the compositing software baked banding into the render, or
  (3) the dome's playback system is outputting an 8-bit signal.
Export your source from your compositing software at 16-bit PNG or EXR before using this tool.`;

function formatBytes(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024 ** 3) return (bytes / 1024 ** 2).toFixed(1) + ' MB';
  return (bytes / 1024 ** 3).toFixed(2) + ' GB';
}

function formatETA(seconds) {
  if (seconds == null || seconds < 0 || !isFinite(seconds)) return null;
  if (seconds < 60) return `${Math.round(seconds)}s remaining`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m ${s}s remaining`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m remaining`;
}

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m < 60) return `${m}m ${sec}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export default function EncodePanel({
  config, filmTitle, artistName,
  sourceType, pngData, pngFolder, pngFrameRate,
  videoPath, videoData, videoFrameRate,
  resolution, outputDir,
  audioMode, audioStems, audioInterleaved, muxAudio,
  frameRateWarning, encodeReady,
  depStatus, useGPU, onUseGPUChange,
  autoZip, onAutoZipChange,
  notifyOnComplete, onNotifyOnCompleteChange,
  autoOpenFolder, onAutoOpenFolderChange,
  preventSleep, onPreventSleepChange,
}) {
  const [encoding, setEncoding] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null);
  const [activeEncoder, setActiveEncoder] = useState(null);
  const [log, setLog] = useState('');
  const [showLog, setShowLog] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  // Pre-flight state
  const [diskCheck, setDiskCheck] = useState(null);
  const [diskChecking, setDiskChecking] = useState(false);

  // Test encode state
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const startTimeRef = useRef(null);
  const timerRef = useRef(null);
  const logRef = useRef(null);

  const gpu = depStatus?.gpu;
  const gpuAvailable = gpu?.available;
  const willUseGPU = gpuAvailable && useGPU;

  // Compute source duration (for disk space estimate)
  const sourceDuration = sourceType === 'png'
    ? (pngData?.frameCount && pngFrameRate ? pngData.frameCount / pngFrameRate : null)
    : videoData?.duration;
  const effectiveFps = sourceType === 'png' ? pngFrameRate : videoFrameRate;

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

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  useEffect(() => {
    const u1 = window.api.onEncodeProgress(data => setProgress(data));
    const u2 = window.api.onEncodeLog(chunk => setLog(prev => prev + chunk));
    const u3 = window.api.onEncodeEncoder(data => setActiveEncoder(data));
    return () => { u1(); u2(); u3(); };
  }, []);

  // Run disk-space check whenever inputs change and we have enough info
  useEffect(() => {
    if (!encodeReady || !outputDir || !resolution || !effectiveFps || !sourceDuration) {
      setDiskCheck(null);
      return;
    }
    let cancelled = false;
    setDiskChecking(true);
    window.api.checkDiskSpace({
      outputDir,
      resolutionLabel: resolution.label,
      frameRate: effectiveFps,
      durationSeconds: sourceDuration,
      isGPU: willUseGPU,
    }).then(res => {
      if (!cancelled) {
        setDiskCheck(res);
        setDiskChecking(false);
      }
    });
    return () => { cancelled = true; };
  }, [outputDir, resolution, effectiveFps, sourceDuration, willUseGPU, encodeReady]);

  const buildWarnings = () => {
    const warnings = [];
    if (frameRateWarning?.type === 'dropframe') {
      warnings.push(`Drop-frame conformed: source was ${videoData?.fps?.toFixed(3)}fps, output will be ${videoFrameRate}fps`);
    }
    const bitDepth = sourceType === 'png' ? pngData?.bitDepth : videoData?.bitDepth;
    if (sourceType === 'png' && bitDepth === 8) {
      warnings.push('8-bit source PNG — potential for banding in source, not caused by encoder');
    }
    if (willUseGPU) {
      warnings.push(`Encoded with GPU: ${gpu.label} — quality-equivalent to CRF 18 libx265`);
    }
    if (pngData?.gaps?.hasGaps) {
      warnings.push(`Source had ${pngData.gaps.missingTotal} missing frames — encoded with FFmpeg's previous-frame substitution`);
    }
    return warnings;
  };

  const commonParams = () => {
    const sourceBitDepth = sourceType === 'png' ? pngData?.bitDepth : videoData?.bitDepth;
    const totalFrames = sourceType === 'png'
      ? pngData?.frameCount
      : (videoData?.duration && effectiveFps
          ? Math.round(videoData.duration * effectiveFps)
          : null);
    return {
      sourceType,
      sourcePath: sourceType === 'png' ? pngFolder : videoPath,
      ffmpegPattern: pngData?.ffmpegPattern,
      totalFrames,
      frameRate: effectiveFps,
      resolution,
      config,
      sourceBitDepth,
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
    const res = await window.api.testEncode(commonParams());
    setTesting(false);
    setTestResult(res);
  };

  const handleEncode = async () => {
    if (!encodeReady || encoding) return;
    setEncoding(true);
    setResult(null);
    setError(null);
    setProgress(null);
    setActiveEncoder(null);
    setLog('');
    setElapsedMs(0);
    setTestResult(null);

    const params = {
      ...commonParams(),
      outputDir,
      filmTitle: filmTitle.trim(),
      artistName: artistName.trim(),
      audioMode,
      audioFiles: audioStems.map(s => ({ channel: s.channel, filePath: s.filePath })),
      audioInterleaved,
      muxAudio,
      warnings: buildWarnings(),
      autoZip, notifyOnComplete, preventSleep,
    };

    const res = await window.api.startEncode(params);
    setEncoding(false);

    if (res.error) {
      setError(res.error);
    } else {
      setResult(res);
      if (autoOpenFolder && res.deliveryFolder) {
        window.api.openPath(res.deliveryFolder);
      }
    }
  };

  const handleCancel = async () => {
    await window.api.cancelEncode();
    setEncoding(false);
    setError('Encode cancelled.');
  };

  const handleOpenFolder = () => {
    if (result?.deliveryFolder) window.api.openPath(result.deliveryFolder);
  };

  const handleZipNow = async () => {
    if (!result?.deliveryFolder) return;
    setLog(prev => prev + '\nCreating ZIP…\n');
    const z = await window.api.zipDelivery(result.deliveryFolder);
    if (z.error) setLog(prev => prev + `ZIP error: ${z.error}\n`);
    else setLog(prev => prev + `ZIP created: ${z.zipPath} (${formatBytes(z.sizeBytes)})\n`);
    setResult({ ...result, zip: z });
  };

  const progressPct = progress?.frame && progress?.totalFrames
    ? Math.min(99, Math.round((progress.frame / progress.totalFrames) * 100))
    : null;

  const issues = [];
  if (!filmTitle.trim()) issues.push('Film title required');
  if (sourceType === 'png' && !pngData) issues.push('Select a PNG sequence folder');
  if (sourceType === 'video' && !videoData) issues.push('Select a video file');
  if (frameRateWarning?.type === 'unsupported') issues.push('Unsupported frame rate — re-export required');
  if (!resolution) issues.push('Select target resolution');
  if (!(sourceType === 'png' ? pngFrameRate : videoFrameRate)) issues.push('Frame rate not set');
  if (!outputDir) issues.push('Select output folder');

  // Disk space status icon
  const diskStatusIcon = diskCheck?.check?.status === 'ok' ? '✅'
    : diskCheck?.check?.status === 'tight' ? '⚠️'
    : diskCheck?.check?.status === 'insufficient' ? '❌'
    : diskCheck?.check?.status === 'unknown' ? '❓'
    : '';

  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <div className="card-title">Encode & Deliver</div>

      {/* Encoder + GPU toggle */}
      <div style={{
        background: '#1e1e1e', border: '1px solid #383838', borderRadius: 8,
        padding: '14px 18px', marginBottom: 14,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
            Encoder
          </div>
          {gpuAvailable ? (
            <div style={{ fontSize: 13, color: '#e8e8e8' }}>
              <span style={{
                background: willUseGPU ? 'rgba(76,175,110,0.15)' : 'rgba(74,158,222,0.15)',
                color: willUseGPU ? '#4caf6e' : '#4a9ede',
                borderRadius: 4, fontSize: 11, fontWeight: 700,
                padding: '2px 8px', marginRight: 8, textTransform: 'uppercase', letterSpacing: '0.06em',
              }}>
                {willUseGPU ? '⚡ GPU' : '🖥 CPU'}
              </span>
              {willUseGPU ? gpu.label : 'libx265 (CPU)'}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: '#4a9ede' }}>
              <span style={{ background: 'rgba(74,158,222,0.15)', color: '#4a9ede', borderRadius: 4, fontSize: 11, fontWeight: 700, padding: '2px 8px', marginRight: 8, textTransform: 'uppercase' }}>🖥 CPU</span>
              libx265 (no GPU encoder detected)
            </div>
          )}
        </div>
        {gpuAvailable && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
            <span style={{ color: '#999' }}>Use GPU</span>
            <input
              type="checkbox" checked={useGPU}
              onChange={e => onUseGPUChange(e.target.checked)}
              style={{ accentColor: '#4caf6e', width: 15, height: 15 }}
            />
          </label>
        )}
      </div>

      {/* Delivery options (toggles) */}
      <details style={{
        background: '#1e1e1e', border: '1px solid #383838', borderRadius: 8,
        marginBottom: 14, padding: '0',
      }}>
        <summary style={{
          padding: '10px 16px', cursor: 'pointer', fontSize: 12, color: '#888',
          fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
          userSelect: 'none',
        }}>
          ⚙ Delivery options
        </summary>
        <div style={{ padding: '4px 16px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <CheckboxOpt
            label="Auto-zip delivery package" desc="Single uploadable .zip alongside the folder"
            checked={autoZip} onChange={onAutoZipChange}
          />
          <CheckboxOpt
            label="Notify when complete" desc="System notification when encode finishes"
            checked={notifyOnComplete} onChange={onNotifyOnCompleteChange}
          />
          <CheckboxOpt
            label="Auto-open folder on complete" desc="Show delivery folder in Finder/Explorer"
            checked={autoOpenFolder} onChange={onAutoOpenFolderChange}
          />
          <CheckboxOpt
            label="Prevent sleep during encode" desc="Keep computer awake for long encodes"
            checked={preventSleep} onChange={onPreventSleepChange}
          />
        </div>
      </details>

      {/* Validation issues */}
      {!encodeReady && issues.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {issues.map((issue, i) => (
            <div key={i} style={{ color: '#666', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ color: '#444' }}>○</span> {issue}
            </div>
          ))}
        </div>
      )}

      {/* Pre-flight summary */}
      {encodeReady && !encoding && !result && (
        <div style={{ marginBottom: 16 }}>
          <div className="alert alert-ok" style={{ fontSize: 13, marginBottom: 12 }}>
            ✓ Ready to encode — all required fields are set
          </div>

          <div style={{ background: '#1e1e1e', border: '1px solid #383838', borderRadius: 8, padding: '12px 16px', fontSize: 13, lineHeight: 1.9 }}>
            <SummaryRow label="Film" value={filmTitle} />
            <SummaryRow label="Source" value={
              sourceType === 'png'
                ? `PNG · ${pngData?.frameCount?.toLocaleString()} frames · ${pngData?.bitDepth || '?'}-bit`
                : `${videoPath?.split('/').pop().split('\\').pop()} · ${videoData?.codec}`
            } />
            <SummaryRow label="Output" value={`${resolution?.label} · ${effectiveFps}fps · 10-bit HEVC`} />
            <SummaryRow label="Encoder" value={
              willUseGPU
                ? <span style={{ color: '#4caf6e' }}>⚡ {gpu.label}</span>
                : <span style={{ color: '#4a9ede' }}>🖥 libx265 CRF {config?.video?.crf}</span>
            } />
            <SummaryRow label="Audio" value={audioMode === 'none' ? 'None' : audioMode === 'stems' ? `${audioStems.length} stems` : 'Interleaved WAV'} />
            {sourceDuration && (
              <SummaryRow label="Duration" value={`${Math.round(sourceDuration)}s (${Math.round(sourceDuration / 60)}min)`} />
            )}
          </div>

          {/* Disk space check */}
          {diskCheck && (
            <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 6,
              background: diskCheck.check.status === 'insufficient' ? 'rgba(224,82,82,0.1)'
                : diskCheck.check.status === 'tight' ? 'rgba(232,184,75,0.1)'
                : 'rgba(76,175,110,0.08)',
              border: '1px solid ' + (
                diskCheck.check.status === 'insufficient' ? 'rgba(224,82,82,0.3)'
                : diskCheck.check.status === 'tight' ? 'rgba(232,184,75,0.3)'
                : 'rgba(76,175,110,0.2)'),
              fontSize: 12,
            }}>
              <div style={{ color: '#bbb' }}>
                {diskStatusIcon} <strong>Disk space:</strong> {diskCheck.check.message}
              </div>
              {diskCheck.estimate?.bytes && (
                <div style={{ color: '#666', fontSize: 11, marginTop: 3 }}>
                  Estimated output: {diskCheck.estimate.label}
                </div>
              )}
            </div>
          )}

          {/* Test result */}
          {testResult && (
            <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 6,
              background: testResult.error ? 'rgba(224,82,82,0.1)' : 'rgba(74,158,222,0.08)',
              border: '1px solid ' + (testResult.error ? 'rgba(224,82,82,0.3)' : 'rgba(74,158,222,0.2)'),
              fontSize: 12 }}>
              {testResult.error
                ? <span style={{ color: '#f08080' }}>✕ Test encode failed: {testResult.error}</span>
                : <span style={{ color: '#7ab8e8' }}>
                    🎬 Test encode opened in your default player ({testResult.framesEncoded} frames, {formatBytes(testResult.sizeBytes)}, {Math.round(testResult.durationMs / 1000)}s to encode). Check color, resolution and motion look correct.
                  </span>}
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      {!result && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary btn-lg"
            onClick={handleEncode}
            disabled={!encodeReady || encoding || testing || diskCheck?.check?.status === 'insufficient'}
            style={{ minWidth: 220 }}
          >
            {encoding ? '⏳ Encoding…' : '▶ Encode and Package'}
          </button>
          {encodeReady && !encoding && (
            <button
              className="btn btn-secondary"
              onClick={handleTestEncode}
              disabled={testing}
              title="Encode just the first 5 seconds and open in default player to verify settings"
            >
              {testing ? '⏳ Testing…' : '🎬 Test encode (5s)'}
            </button>
          )}
          {encoding && (
            <button className="btn btn-danger" onClick={handleCancel}>✕ Cancel</button>
          )}
          {encoding && (
            <span style={{ color: '#666', fontSize: 13 }}>
              {formatElapsed(elapsedMs)} elapsed
            </span>
          )}
        </div>
      )}

      {/* Progress */}
      {encoding && (
        <div style={{ marginTop: 20 }}>
          {activeEncoder && (
            <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                background: activeEncoder.isGPU ? 'rgba(76,175,110,0.15)' : 'rgba(74,158,222,0.15)',
                color: activeEncoder.isGPU ? '#4caf6e' : '#4a9ede',
                borderRadius: 4, fontSize: 11, fontWeight: 700,
                padding: '2px 8px', textTransform: 'uppercase', letterSpacing: '0.06em',
              }}>
                {activeEncoder.isGPU ? '⚡ GPU' : '🖥 CPU'}
              </span>
              <span style={{ color: '#888', fontSize: 13 }}>{activeEncoder.label}</span>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, color: '#888' }}>
            <span>Video encode</span>
            <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              {progress?.frame != null && (
                <span>
                  Frame {progress.frame.toLocaleString()}
                  {progress.totalFrames && ` / ${Number(progress.totalFrames).toLocaleString()}`}
                  {progressPct != null && ` · ${progressPct}%`}
                </span>
              )}
              {progress?.fps && <span style={{ color: '#666' }}>{Math.round(progress.fps)} fps</span>}
              {progress?.speed && (
                <span style={{ color: progress.speed >= 1 ? '#4caf6e' : '#e8b84b' }}>
                  {progress.speed.toFixed(1)}×
                </span>
              )}
            </span>
          </div>

          <div className="progress-bar-wrap">
            <div className="progress-bar-fill" style={{ width: progressPct != null ? `${progressPct}%` : '2%' }} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 12 }}>
            <span style={{ color: '#555' }}>
              {formatElapsed(elapsedMs)} elapsed
              {progress?.liveSizeBytes && (
                <span style={{ marginLeft: 12, color: '#888' }}>
                  Output: {formatBytes(progress.liveSizeBytes)}
                </span>
              )}
            </span>
            {progress?.etaSeconds != null && progress.etaSeconds > 0 && (
              <span style={{ color: '#F2C200', fontWeight: 600 }}>
                ⏱ {formatETA(progress.etaSeconds)}
              </span>
            )}
          </div>

          <div style={{ marginTop: 12 }}>
            <button
              onClick={() => setShowLog(!showLog)}
              style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 12 }}
            >
              {showLog ? '▲ Hide' : '▼ Show'} FFmpeg log
            </button>
          </div>

          {showLog && (
            <div ref={logRef} className="log-output" style={{ marginTop: 8 }}>
              {log || 'Waiting for output…'}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && !encoding && (
        <div className="alert alert-error" style={{ marginTop: 16 }}>
          ✕ {error}
          <div style={{ marginTop: 10 }}>
            <button className="btn btn-secondary" style={{ fontSize: 12, padding: '6px 14px' }}
              onClick={() => { setError(null); setLog(''); }}>
              Try again
            </button>
          </div>
          {log && (
            <pre style={{ marginTop: 10, fontSize: 11, fontFamily: 'monospace', color: '#f08080', maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {log.slice(-3000)}
            </pre>
          )}
        </div>
      )}

      {/* Success */}
      {result && !encoding && (
        <div style={{ marginTop: 4 }}>
          <div className="alert alert-ok" style={{ marginBottom: 16 }}>
            ✓ <strong>Delivery package complete!</strong>{' '}
            Encoded in {formatElapsed(elapsedMs)}.
            {result.videoMd5 && <span style={{ color: '#5a9', marginLeft: 10, fontSize: 12 }}>MD5: {result.videoMd5.slice(0, 16)}…</span>}
          </div>

          {/* Output verification panel */}
          {result.verification && (
            <div style={{
              background: result.verification.ok ? 'rgba(76,175,110,0.08)' : 'rgba(224,82,82,0.08)',
              border: '1px solid ' + (result.verification.ok ? 'rgba(76,175,110,0.3)' : 'rgba(224,82,82,0.3)'),
              borderRadius: 8, padding: '12px 16px', marginBottom: 12, fontSize: 12,
            }}>
              <div style={{ fontWeight: 700, marginBottom: 6, color: result.verification.ok ? '#7ecf96' : '#f08080' }}>
                {result.verification.summary}
              </div>
              {result.verification.issues?.length > 0 && (
                <ul style={{ margin: '4px 0 0 18px', color: '#aaa' }}>
                  {result.verification.issues.map((iss, i) => (
                    <li key={i} style={{ color: iss.severity === 'error' ? '#f08080' : iss.severity === 'warning' ? '#e8b84b' : '#888' }}>
                      <strong>{iss.field}:</strong> expected {iss.expected}, got {iss.actual}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Loudness panel */}
          {result.loudness?.classification && (
            <div style={{
              background: result.loudness.classification.severity === 'ok' ? 'rgba(76,175,110,0.08)'
                : result.loudness.classification.severity === 'warning' ? 'rgba(232,184,75,0.1)'
                : 'rgba(224,82,82,0.08)',
              border: '1px solid ' + (
                result.loudness.classification.severity === 'ok' ? 'rgba(76,175,110,0.3)'
                : result.loudness.classification.severity === 'warning' ? 'rgba(232,184,75,0.3)'
                : 'rgba(224,82,82,0.3)'),
              borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 12,
            }}>
              <span style={{
                color: result.loudness.classification.severity === 'ok' ? '#7ecf96'
                  : result.loudness.classification.severity === 'warning' ? '#e8c96e' : '#f08080',
                fontWeight: 600,
              }}>
                🔊 Audio: {result.loudness.classification.message}
              </span>
            </div>
          )}

          <div style={{ background: '#1e1e1e', border: '1px solid #383838', borderRadius: 8, padding: '14px 18px', marginBottom: 16, fontSize: 13 }}>
            <SummaryRow label="Location" value={<span className="mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>{result.deliveryFolder}</span>} />
            <SummaryRow label="Video size" value={formatBytes(result.videoSizeBytes)} />
            <SummaryRow label="Encoder" value={activeEncoder?.label || '—'} />
            {result.zip?.ok && (
              <SummaryRow label="ZIP" value={
                <span className="mono" style={{ fontSize: 11 }}>
                  {result.zip.zipPath.split(/[\\/]/).pop()} ({formatBytes(result.zip.sizeBytes)})
                </span>
              } />
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={handleOpenFolder}>📁 Open Delivery Folder</button>
            {!result.zip?.ok && (
              <button className="btn btn-secondary" onClick={handleZipNow}>📦 Create ZIP</button>
            )}
            {result.zip?.ok && (
              <button className="btn btn-secondary" onClick={() => window.api.showInFolder(result.zip.zipPath)}>
                📦 Show ZIP in Folder
              </button>
            )}
            <button className="btn btn-secondary" onClick={() => { setResult(null); setLog(''); setProgress(null); setActiveEncoder(null); }}>
              Start New Encode
            </button>
          </div>

          {/* Delivery report preview */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 6, fontWeight: 600 }}>delivery_report.txt</div>
            <pre style={{
              background: '#111', border: '1px solid #333', borderRadius: 6,
              color: '#aaa', fontFamily: 'monospace', fontSize: 11, lineHeight: 1.6,
              maxHeight: 260, overflow: 'auto', padding: '12px 14px', whiteSpace: 'pre-wrap'
            }}>
              {result.report}
            </pre>
          </div>

          {/* Banding education note */}
          <div style={{ background: 'rgba(74,158,222,0.08)', border: '1px solid rgba(74,158,222,0.2)', borderRadius: 8, padding: '14px 18px' }}>
            <div style={{ color: '#4a9ede', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
              📚 About Color Banding on Dome
            </div>
            <div style={{ color: '#aaa', fontSize: 12, lineHeight: 1.8, whiteSpace: 'pre-line' }}>
              {BANDING_NOTE}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 2 }}>
      <span style={{ color: '#666', width: 80, flexShrink: 0, fontSize: 12 }}>{label}</span>
      <span style={{ color: '#e8e8e8' }}>{value}</span>
    </div>
  );
}

function CheckboxOpt({ label, desc, checked, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', padding: '6px 0' }}>
      <input
        type="checkbox" checked={checked}
        onChange={e => onChange(e.target.checked)}
        style={{ accentColor: '#ED8B1E', marginTop: 2, width: 14, height: 14 }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, color: '#ddd' }}>{label}</div>
        {desc && <div style={{ fontSize: 11, color: '#666' }}>{desc}</div>}
      </div>
    </label>
  );
}
