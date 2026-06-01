import React, { useState } from 'react';

function classifyFps(fps, allowedFps) {
  if (!fps) return { status: 'unknown' };
  const rounded = Math.round(fps);

  // Exact match
  if (allowedFps.includes(Math.round(fps * 100) / 100)) {
    return { status: 'ok', conformTo: Math.round(fps) };
  }

  // Drop-frame variants
  if (Math.abs(fps - 29.97) < 0.1) return { status: 'dropframe', conformTo: 30, detected: '29.97' };
  if (Math.abs(fps - 59.94) < 0.1) return { status: 'dropframe', conformTo: 60, detected: '59.94' };

  return { status: 'unsupported', detected: fps.toFixed(3) };
}

function formatBytes(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024 ** 3) return (bytes / 1024 ** 2).toFixed(1) + ' MB';
  return (bytes / 1024 ** 3).toFixed(2) + ' GB';
}

export default function VideoFileTab({
  config, filePath, data, frameRate, frameRateWarning,
  onFilePathChange, onDataChange, onFrameRateChange, onFrameRateWarning
}) {
  const [probing, setProbing] = useState(false);

  const allowedFps = config?.video?.allowed_framerates || [30, 60];

  const handleSelectFile = async () => {
    const file = await window.api.openFile({
      title: 'Select Video File',
      filters: [{ name: 'Video Files', extensions: ['mp4', 'mov'] }]
    });
    if (!file) return;
    onFilePathChange(file);
    onDataChange(null);
    onFrameRateChange(null);
    onFrameRateWarning(null);
    setProbing(true);
    const result = await window.api.probeVideo(file);
    setProbing(false);

    if (result.error) {
      onDataChange({ error: result.error });
      return;
    }

    onDataChange(result);

    // Classify FPS
    const fpsClass = classifyFps(result.fps, allowedFps);
    if (fpsClass.status === 'ok') {
      onFrameRateChange(fpsClass.conformTo);
      onFrameRateWarning(null);
    } else if (fpsClass.status === 'dropframe') {
      onFrameRateChange(fpsClass.conformTo);
      onFrameRateWarning({
        type: 'dropframe',
        message: `⚠ Drop-frame detected (${fpsClass.detected}fps). Fiske's SkySkan playback system requires exactly 30fps or 60fps. Drop-frame rates cause unreliable playback on the dome. This tool will conform your file to ${fpsClass.conformTo}fps. Verify the output carefully — if your NLE exported at drop-frame by mistake, re-export at exactly 30fps or 60fps for best results.`
      });
    } else {
      onFrameRateChange(null);
      onFrameRateWarning({
        type: 'unsupported',
        message: `✕ Unsupported frame rate (${fpsClass.detected}fps). DFW only accepts 30fps or 60fps masters. Fulldome planetarium systems do not reliably play back at film-standard or PAL frame rates. Please re-export your master at exactly 30fps or 60fps.`
      });
    }
  };

  const fpsOk = frameRateWarning?.type !== 'unsupported' && frameRate;

  return (
    <div>
      {/* File picker */}
      <div style={{ marginBottom: 16 }}>
        <label className="label">Video File (.mp4 or .mov)</label>
        <div className="path-picker">
          <div className={`path-display ${filePath ? 'has-value' : ''}`}>
            {filePath || 'No file selected'}
          </div>
          <button className="btn btn-secondary" onClick={handleSelectFile}>
            Browse…
          </button>
        </div>
      </div>

      {probing && (
        <div className="alert alert-info" style={{ marginBottom: 12 }}>
          🔍 Analyzing file with FFprobe…
        </div>
      )}

      {data?.error && (
        <div className="alert alert-error" style={{ marginBottom: 12 }}>
          ✕ {data.error}
        </div>
      )}

      {/* File info grid */}
      {data && !data.error && (
        <div style={{
          background: '#1e1e1e',
          border: '1px solid #383838',
          borderRadius: 8,
          padding: '14px 18px',
          marginBottom: 12
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: '10px 24px',
            fontSize: 13
          }}>
            <InfoRow label="Resolution" value={`${data.width}×${data.height}`} />
            <InfoRow label="Frame Rate" value={
              <span style={{ color: fpsOk ? '#e8e8e8' : '#f08080' }}>
                {data.fps != null ? data.fps.toFixed(2) + 'fps' : '—'}
              </span>
            } />
            <InfoRow label="Codec" value={data.codec || '—'} />
            <InfoRow label="Bit Depth" value={data.bitDepth ? `${data.bitDepth}-bit` : '—'} />
            <InfoRow label="Pixel Format" value={<code style={{ fontSize: 11 }}>{data.pixFmt || '—'}</code>} />
            <InfoRow label="File Size" value={formatBytes(data.fileSizeBytes)} />
            <InfoRow label="Duration" value={data.duration ? `${Math.floor(data.duration / 60)}m ${Math.round(data.duration % 60)}s` : '—'} />
            <InfoRow label="Audio Channels" value={data.audioChannels || 'None'} />
            <InfoRow label="Audio Sample Rate" value={data.audioSampleRate ? (data.audioSampleRate / 1000).toFixed(1) + ' kHz' : '—'} />
          </div>

          {/* Color space */}
          {data.colorSpace && (
            <div style={{ marginTop: 10, fontSize: 12, color: '#666' }}>
              Color: {[data.colorPrimaries, data.colorSpace, data.colorTrc].filter(Boolean).join(' / ')}
            </div>
          )}
        </div>
      )}

      {/* Frame rate warnings */}
      {frameRateWarning?.type === 'dropframe' && (
        <div className="alert alert-warn" style={{ marginBottom: 12 }}>
          {frameRateWarning.message}
        </div>
      )}

      {frameRateWarning?.type === 'unsupported' && (
        <div className="alert alert-error" style={{ marginBottom: 12 }}>
          {frameRateWarning.message}
          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 8 }}>
            <strong>Why only 30/60fps?</strong> Fulldome planetarium systems use frame-accurate synchronization. Drop-frame timecode (29.97, 59.94) and PAL rates (25, 50) cause sync drift and unreliable playback. 24fps, while common in cinema, is not universally supported in dome environments. 30fps and 60fps are the only rates that guarantee consistent playback across all major dome playback systems.
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div>
      <div style={{ color: '#666', fontSize: 11, marginBottom: 2 }}>{label}</div>
      <div style={{ color: '#e8e8e8', fontWeight: 500 }}>{value}</div>
    </div>
  );
}
