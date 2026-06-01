import React, { useState } from 'react';

const ALLOWED_FPS = [30, 60];

export default function PNGSequenceTab({
  config, folder, data, frameRate,
  onFolderChange, onDataChange, onFrameRateChange
}) {
  const [scanning, setScanning] = useState(false);
  const [manualPattern, setManualPattern] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const allowedFps = config?.video?.allowed_framerates || ALLOWED_FPS;

  const handleSelectFolder = async () => {
    const folder = await window.api.openFolder({ title: 'Select PNG Sequence Folder' });
    if (!folder) return;
    onFolderChange(folder);
    setConfirmed(false);
    onDataChange(null);
    setScanning(true);
    const result = await window.api.scanPngSequence(folder);
    setScanning(false);
    if (result.error) {
      onDataChange({ error: result.error });
    } else {
      onDataChange(result);
    }
  };

  const handleRescan = async () => {
    if (!folder) return;
    setConfirmed(false);
    onDataChange(null);
    setScanning(true);
    const result = await window.api.scanPngSequence(folder);
    setScanning(false);
    onDataChange(result.error ? { error: result.error } : result);
  };

  const handleConfirm = () => setConfirmed(true);

  return (
    <div>
      {/* Folder picker */}
      <div style={{ marginBottom: 16 }}>
        <label className="label">PNG Sequence Folder</label>
        <div className="path-picker">
          <div className={`path-display ${folder ? 'has-value' : ''}`}>
            {folder || 'No folder selected'}
          </div>
          <button className="btn btn-secondary" onClick={handleSelectFolder}>
            Browse…
          </button>
        </div>
      </div>

      {/* Scanning indicator */}
      {scanning && (
        <div className="alert alert-info" style={{ marginBottom: 12 }}>
          🔍 Scanning for PNG sequence…
        </div>
      )}

      {/* Error */}
      {data?.error && (
        <div className="alert alert-error" style={{ marginBottom: 12 }}>
          ✕ {data.error}
          <button
            className="btn btn-ghost"
            style={{ marginLeft: 12, padding: '4px 10px', fontSize: 12 }}
            onClick={() => setShowManual(true)}
          >
            Enter pattern manually
          </button>
        </div>
      )}

      {/* Detection result */}
      {data && !data.error && !confirmed && (
        <div style={{
          background: '#1e2a1e',
          border: '1px solid rgba(76,175,110,0.3)',
          borderRadius: 8,
          padding: '14px 18px',
          marginBottom: 12
        }}>
          <div style={{ color: '#7ecf96', fontWeight: 700, marginBottom: 8 }}>
            ✓ Sequence detected
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.8 }}>
            <div><span style={{ color: '#666' }}>Pattern: </span>
              <code style={{ background: '#111', padding: '1px 6px', borderRadius: 3, color: '#F2C200' }}>{data.pattern}</code>
            </div>
            <div><span style={{ color: '#666' }}>Frame count: </span>
              <strong style={{ color: '#e8e8e8' }}>{data.frameCount.toLocaleString()} frames</strong>
            </div>
            <div style={{ marginTop: 8 }}>
              {data.bitDepth === 16 ? (
                <span style={{ color: '#4caf6e', fontWeight: 600 }}>
                  ✓ Source bit depth: 16-bit — full quality encoding possible
                </span>
              ) : data.bitDepth === 8 ? (
                <span style={{ color: '#e8b84b', fontWeight: 600 }}>
                  ⚠ Source bit depth: 8-bit — your source may introduce banding regardless of encoding settings.
                  Re-export from your compositing app at 16-bit PNG or EXR if possible.
                </span>
              ) : (
                <span style={{ color: '#666' }}>Bit depth: unable to detect</span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="btn btn-primary" onClick={handleConfirm}>
              ✓ Yes, this looks correct
            </button>
            <button className="btn btn-secondary" onClick={handleRescan}>
              Re-scan
            </button>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 12 }}
              onClick={() => setShowManual(true)}
            >
              Enter pattern manually
            </button>
          </div>
        </div>
      )}

      {/* Confirmed state */}
      {data && !data.error && confirmed && (
        <div className="alert alert-ok" style={{ marginBottom: 12 }}>
          ✓ {data.frameCount.toLocaleString()} frames · pattern: <code style={{ background: 'rgba(0,0,0,0.2)', padding: '1px 5px', borderRadius: 3 }}>{data.pattern}</code>
          <button
            onClick={() => setConfirmed(false)}
            style={{ background: 'none', border: 'none', color: '#7ecf96', cursor: 'pointer', marginLeft: 10, fontSize: 12, textDecoration: 'underline' }}
          >
            Change
          </button>
        </div>
      )}

      {/* Manual pattern input */}
      {showManual && (
        <div style={{ marginBottom: 12 }}>
          <label className="label">Manual pattern (FFmpeg glob format, e.g. <code>frame_%04d.png</code>)</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="input-field"
              value={manualPattern}
              onChange={e => setManualPattern(e.target.value)}
              placeholder="frame_%04d.png"
              style={{ fontFamily: 'monospace' }}
            />
            <button
              className="btn btn-secondary"
              onClick={() => {
                if (manualPattern && folder) {
                  // Use window.api to build the path safely (path.join in main process)
                  // In the renderer we approximate with the platform separator from the folder string
                  const sep = folder.includes('\\') ? '\\' : '/';
                  onDataChange({ pattern: manualPattern, ffmpegPattern: folder + sep + manualPattern, frameCount: '?', bitDepth: null });
                  setShowManual(false);
                }
              }}
            >
              Use this
            </button>
          </div>
        </div>
      )}

      {/* Frame rate selector */}
      {(confirmed || (data && !data.error)) && (
        <div style={{ marginTop: 16 }}>
          <label className="label">Frame Rate <span style={{ color: '#ED8B1E' }}>*</span></label>
          <div className="segment-control" style={{ maxWidth: 200 }}>
            {allowedFps.map(fps => (
              <button
                key={fps}
                className={`segment-btn ${frameRate === fps ? 'active' : ''}`}
                onClick={() => onFrameRateChange(fps)}
              >
                {fps}fps
              </button>
            ))}
          </div>
          <div style={{ color: '#666', fontSize: 11, marginTop: 6 }}>
            DFW accepts 30fps and 60fps only. Choose the frame rate of your source render.
          </div>
        </div>
      )}
    </div>
  );
}
