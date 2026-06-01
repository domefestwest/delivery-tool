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
  depStatus, useGPU, onUseGPUChange
}) {
  const [encoding, setEncoding] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null);
  const [activeEncoder, setActiveEncoder] = useState(null); // { name, label, isGPU }
  const [log, setLog] = useState('');
  const [showLog, setShowLog] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startTimeRef = useRef(null);
  const timerRef = useRef(null);
  const logRef = useRef(null);

  const gpu = depStatus?.gpu;
  const gpuAvailable = gpu?.available;

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

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  // Subscribe to encode events
  useEffect(() => {
    const u1 = window.api.onEncodeProgress(data => setProgress(data));
    const u2 = window.api.onEncodeLog(chunk => setLog(prev => prev + chunk));
    const u3 = window.api.onEncodeEncoder(data => setActiveEncoder(data));
    return () => { u1(); u2(); u3(); };
  }, []);

  const buildWarnings = () => {
    const warnings = [];
    if (frameRateWarning?.type === 'dropframe') {
      warnings.push(`Drop-frame conformed: source was ${videoData?.fps?.toFixed(3)}fps, output will be ${videoFrameRate}fps`);
    }
    const bitDepth = sourceType === 'png' ? pngData?.bitDepth : videoData?.bitDepth;
    if (sourceType === 'png' && bitDepth === 8) {
      warnings.push('8-bit source PNG — potential for banding in source, not caused by encoder');
    }
    if (gpuAvailable && useGPU) {
      warnings.push(`Encoded with GPU: ${gpu.label} — quality-equivalent to CRF 18 libx265`);
    }
    return warnings;
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

    const effectiveFps = sourceType === 'png' ? pngFrameRate : videoFrameRate;
    const sourceBitDepth = sourceType === 'png' ? pngData?.bitDepth : videoData?.bitDepth;
    const audioFilesForIpc = audioStems.map(s => ({ channel: s.channel, filePath: s.filePath }));

    // Total frame count — needed for ETA calculation in main process.
    // PNG: exact count from scan. Video: derive from duration × frame rate.
    const totalFrames = sourceType === 'png'
      ? pngData?.frameCount
      : (videoData?.duration && effectiveFps
          ? Math.round(videoData.duration * effectiveFps)
          : null);

    const params = {
      sourceType,
      sourcePath: sourceType === 'png' ? pngFolder : videoPath,
      ffmpegPattern: pngData?.ffmpegPattern,
      totalFrames,
      frameRate: effectiveFps,
      resolution,
      outputDir,
      filmTitle: filmTitle.trim(),
      artistName: artistName.trim(),
      config,
      audioMode,
      audioFiles: audioFilesForIpc,
      audioInterleaved,
      muxAudio,
      sourceBitDepth,
      sourceCodec: videoData?.codec,
      sourceFps: videoData?.fps,
      warnings: buildWarnings(),
      useGPU: gpuAvailable && useGPU,
    };

    const res = await window.api.startEncode(params);
    setEncoding(false);

    if (res.error) {
      setError(res.error);
    } else {
      setResult(res);
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

  // Progress
  const progressPct = progress?.frame && progress?.totalFrames
    ? Math.min(99, Math.round((progress.frame / progress.totalFrames) * 100))
    : null;

  // Validation issues
  const issues = [];
  if (!filmTitle.trim()) issues.push('Film title required');
  if (sourceType === 'png' && !pngData) issues.push('Select a PNG sequence folder');
  if (sourceType === 'video' && !videoData) issues.push('Select a video file');
  if (frameRateWarning?.type === 'unsupported') issues.push('Unsupported frame rate — re-export required');
  if (!resolution) issues.push('Select target resolution');
  if (!(sourceType === 'png' ? pngFrameRate : videoFrameRate)) issues.push('Frame rate not set');
  if (!outputDir) issues.push('Select output folder');

  const willUseGPU = gpuAvailable && useGPU;

  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <div className="card-title">Encode & Deliver</div>

      {/* GPU / CPU toggle */}
      <div style={{
        background: '#1e1e1e',
        border: '1px solid #383838',
        borderRadius: 8,
        padding: '14px 18px',
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16
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
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 700,
                padding: '2px 8px',
                marginRight: 8,
                textTransform: 'uppercase',
                letterSpacing: '0.06em'
              }}>
                {willUseGPU ? '⚡ GPU' : '🖥 CPU'}
              </span>
              {willUseGPU ? gpu.label : 'libx265 (CPU)'}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: '#4a9ede' }}>
              <span style={{ background: 'rgba(74,158,222,0.15)', color: '#4a9ede', borderRadius: 4, fontSize: 11, fontWeight: 700, padding: '2px 8px', marginRight: 8, textTransform: 'uppercase' }}>🖥 CPU</span>
              libx265 (no GPU encoder detected on this system)
            </div>
          )}
        </div>
        {gpuAvailable && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
              <span style={{ color: '#999' }}>Use GPU acceleration</span>
              <input
                type="checkbox"
                checked={useGPU}
                onChange={e => onUseGPUChange(e.target.checked)}
                style={{ accentColor: '#4caf6e', width: 15, height: 15 }}
              />
            </label>
            <div style={{ fontSize: 11, color: '#555' }}>
              {willUseGPU
                ? `~6-20× faster · 10-bit · quality-equivalent to CRF ${config?.video?.crf ?? 18}`
                : `Slower · maximum compatibility · CRF ${config?.video?.crf ?? 18} libx265`}
            </div>
          </div>
        )}
      </div>

      {/* Validation checklist */}
      {!encodeReady && issues.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {issues.map((issue, i) => (
            <div key={i} style={{ color: '#666', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ color: '#444' }}>○</span> {issue}
            </div>
          ))}
        </div>
      )}

      {encodeReady && !encoding && !result && (
        <div style={{ marginBottom: 16 }}>
          <div className="alert alert-ok" style={{ fontSize: 13, marginBottom: 12 }}>
            ✓ Ready to encode — all required fields are set
          </div>
          <div style={{ background: '#1e1e1e', border: '1px solid #383838', borderRadius: 8, padding: '12px 16px', fontSize: 13, lineHeight: 1.9 }}>
            <SummaryRow label="Film" value={filmTitle} />
            <SummaryRow label="Source" value={
              sourceType === 'png'
                ? `PNG sequence · ${pngData?.frameCount?.toLocaleString()} frames · ${pngData?.bitDepth || '?'}-bit`
                : `${videoPath?.split('/').pop().split('\\').pop()} · ${videoData?.codec}`
            } />
            <SummaryRow label="Output" value={`${resolution?.label} · ${sourceType === 'png' ? pngFrameRate : videoFrameRate}fps · 10-bit HEVC`} />
            <SummaryRow label="Encoder" value={
              willUseGPU
                ? <span style={{ color: '#4caf6e' }}>⚡ {gpu.label}</span>
                : <span style={{ color: '#4a9ede' }}>🖥 libx265 CRF {config?.video?.crf} · preset {config?.video?.preset}</span>
            } />
            <SummaryRow label="Audio" value={audioMode === 'none' ? 'None' : audioMode === 'stems' ? `${audioStems.length} stems` : 'Interleaved WAV'} />
          </div>
        </div>
      )}

      {/* Encode / cancel button */}
      {!result && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button
            className="btn btn-primary btn-lg"
            onClick={handleEncode}
            disabled={!encodeReady || encoding}
            style={{ minWidth: 220 }}
          >
            {encoding ? '⏳ Encoding…' : '▶ Encode and Package'}
          </button>
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

      {/* Progress section */}
      {encoding && (
        <div style={{ marginTop: 20 }}>
          {/* Encoder badge */}
          {activeEncoder && (
            <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                background: activeEncoder.isGPU ? 'rgba(76,175,110,0.15)' : 'rgba(74,158,222,0.15)',
                color: activeEncoder.isGPU ? '#4caf6e' : '#4a9ede',
                borderRadius: 4, fontSize: 11, fontWeight: 700,
                padding: '2px 8px', textTransform: 'uppercase', letterSpacing: '0.06em'
              }}>
                {activeEncoder.isGPU ? '⚡ GPU' : '🖥 CPU'}
              </span>
              <span style={{ color: '#888', fontSize: 13 }}>{activeEncoder.label}</span>
            </div>
          )}

          {/* Video progress bar */}
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
              {progress?.fps && (
                <span style={{ color: '#666' }}>{Math.round(progress.fps)} fps</span>
              )}
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

          {/* ETA */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 12 }}>
            <span style={{ color: '#555' }}>{formatElapsed(elapsedMs)} elapsed</span>
            {progress?.etaSeconds != null && progress.etaSeconds > 0 && (
              <span style={{ color: '#F2C200', fontWeight: 600 }}>
                ⏱ {formatETA(progress.etaSeconds)}
              </span>
            )}
          </div>

          {/* Log toggle */}
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
            {result.videoMd5 && <span style={{ color: '#5a9', marginLeft: 10, fontSize: 12 }}>MD5: {result.videoMd5}</span>}
          </div>

          <div style={{ background: '#1e1e1e', border: '1px solid #383838', borderRadius: 8, padding: '14px 18px', marginBottom: 16, fontSize: 13 }}>
            <SummaryRow label="Location" value={<span className="mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>{result.deliveryFolder}</span>} />
            <SummaryRow label="Video size" value={formatBytes(result.videoSizeBytes)} />
            <SummaryRow label="Encoder" value={activeEncoder?.label || '—'} />
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
            <button className="btn btn-primary" onClick={handleOpenFolder}>📁 Open Delivery Folder</button>
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
