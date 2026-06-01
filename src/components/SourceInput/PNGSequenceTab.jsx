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
  const [dragActive, setDragActive] = useState(false);

  const allowedFps = config?.video?.allowed_framerates || ALLOWED_FPS;

  async function scanFolder(path) {
    onFolderChange(path);
    setConfirmed(false);
    onDataChange(null);
    setScanning(true);
    const result = await window.api.scanPngSequence(path);
    setScanning(false);
    onDataChange(result.error ? { error: result.error } : result);
  }

  const handleSelectFolder = async () => {
    const f = await window.api.openFolder({ title: 'Select PNG Sequence Folder' });
    if (f) scanFolder(f);
  };

  const handleRescan = async () => {
    if (folder) scanFolder(folder);
  };

  const handleConfirm = () => setConfirmed(true);

  // Drag-and-drop handlers
  const handleDragEnter = (e) => {
    e.preventDefault(); e.stopPropagation();
    setDragActive(true);
  };
  const handleDragLeave = (e) => {
    e.preventDefault(); e.stopPropagation();
    setDragActive(false);
  };
  const handleDragOver = (e) => {
    e.preventDefault(); e.stopPropagation();
  };
  const handleDrop = async (e) => {
    e.preventDefault(); e.stopPropagation();
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    // Try the first file's path — if it's a directory, scan it; else scan its parent
    const f = files[0];
    const fullPath = window.api.getPathForFile(f);
    if (!fullPath) return;
    // Heuristic: if dropping a single .png file, use its parent folder
    if (/\.png$/i.test(fullPath)) {
      const parent = fullPath.replace(/[\\/][^\\/]+$/, '');
      scanFolder(parent);
    } else {
      // Assume it's a directory or use its parent
      scanFolder(fullPath);
    }
  };

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{
        position: 'relative',
        border: dragActive ? '2px dashed #ED8B1E' : '2px dashed transparent',
        borderRadius: 8,
        padding: dragActive ? 16 : 0,
        margin: dragActive ? -16 : 0,
        background: dragActive ? 'rgba(237,139,30,0.05)' : 'transparent',
        transition: 'all 0.15s',
      }}
    >
      {dragActive && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          background: 'rgba(26,26,26,0.8)', borderRadius: 8,
          color: '#ED8B1E', fontSize: 18, fontWeight: 700,
          pointerEvents: 'none', zIndex: 10,
        }}>
          📁 Drop PNG folder or any frame to scan
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <label className="label">
          PNG Sequence Folder
          <span style={{ color: '#555', marginLeft: 6, fontSize: 11 }}>(or drag a folder/frame here)</span>
        </label>
        <div className="path-picker">
          <div className={`path-display ${folder ? 'has-value' : ''}`}>
            {folder || 'No folder selected'}
          </div>
          <button className="btn btn-secondary" onClick={handleSelectFolder}>
            Browse…
          </button>
        </div>
      </div>

      {scanning && (
        <div className="alert alert-info" style={{ marginBottom: 12 }}>
          🔍 Scanning for PNG sequence…
        </div>
      )}

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

      {/* Gap warning (CRITICAL: FFmpeg silently substitutes missing frames!) */}
      {data && !data.error && data.gaps?.hasGaps && (
        <div className="alert alert-error" style={{ marginBottom: 12 }}>
          ⚠ <strong>Missing frames detected.</strong> {data.gapReport}
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9 }}>
            FFmpeg silently substitutes the previous frame on missing files —
            your output would contain frozen frames at the gaps. Re-render
            the missing frames before encoding.
          </div>
        </div>
      )}

      {/* Detection result */}
      {data && !data.error && !confirmed && (
        <div style={{
          background: '#1e2a1e',
          border: '1px solid rgba(76,175,110,0.3)',
          borderRadius: 8, padding: '14px 18px', marginBottom: 12,
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
              {data.gaps && !data.gaps.hasGaps && (
                <span style={{ color: '#7ecf96', marginLeft: 8, fontSize: 12 }}>(contiguous ✓)</span>
              )}
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
                  const sep = folder.includes('\\') ? '\\' : '/';
                  onDataChange({
                    pattern: manualPattern,
                    ffmpegPattern: folder + sep + manualPattern,
                    frameCount: '?', bitDepth: null, gaps: { hasGaps: false }
                  });
                  setShowManual(false);
                }
              }}
            >
              Use this
            </button>
          </div>
        </div>
      )}

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
