import React, { useState, useEffect, useCallback } from 'react';

/**
 * SourcePreview — the visual anchor of the app.
 *
 * Acts as BOTH the preview window AND the drop zone:
 *   - Empty state: drop instructions + two browse buttons
 *   - With source: thumbnail preview + info chips below
 *
 * Auto-detects whether dropped/picked content is a video or PNG sequence
 * via the source:detect IPC, so the user never has to "pick a tab" first.
 */

function classifyFps(fps, allowedFps) {
  if (!fps) return { status: 'unknown' };
  if (allowedFps.includes(Math.round(fps * 100) / 100)) {
    return { status: 'ok', conformTo: Math.round(fps) };
  }
  if (Math.abs(fps - 29.97) < 0.1) return { status: 'dropframe', conformTo: 30, detected: '29.97' };
  if (Math.abs(fps - 59.94) < 0.1) return { status: 'dropframe', conformTo: 60, detected: '59.94' };
  return { status: 'unsupported', detected: fps.toFixed(3) };
}

export default function SourcePreview({
  config,
  // Source state (shared with App)
  sourceType,        onSourceTypeChange,
  pngFolder, pngData, pngFrameRate,
  onPngFolderChange, onPngDataChange, onPngFrameRateChange,
  videoPath, videoData, videoFrameRate,
  onVideoPathChange, onVideoDataChange, onVideoFrameRateChange,
  onFrameRateWarning, frameRateWarning,
  // Project load (for the empty-state quick action)
  onOpenProject,
}) {
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [thumbUrl, setThumbUrl] = useState(null);
  const [thumbError, setThumbError] = useState(null);

  const allowedFps = config?.video?.allowed_framerates || [30, 60];

  // Determine effective state
  const activeSource = sourceType === 'png' ? pngData : videoData;
  const activeFrameRate = sourceType === 'png' ? pngFrameRate : videoFrameRate;
  const activeSourcePath = sourceType === 'png' ? pngData?.firstFrame : videoPath;
  const isLoaded = !!(activeSource && !activeSource.error);

  // Generate / refresh thumbnail when source changes
  useEffect(() => {
    if (!activeSourcePath || !isLoaded) {
      setThumbUrl(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setThumbError(null);
      const r = await window.api.generatePreview({
        sourceType,
        sourcePath: activeSourcePath,
      });
      if (cancelled) return;
      if (r.error) {
        setThumbError(r.error);
        setThumbUrl(null);
      } else {
        // Data URL — works with strict CSP, no file:// issues
        setThumbUrl(r.dataUrl);
      }
    })();
    return () => { cancelled = true; };
  }, [activeSourcePath, sourceType, isLoaded]);

  // Core source-loading routine — used by both browse buttons and drop handler
  const loadSource = useCallback(async (kind, pathArg) => {
    setBusy(true);
    try {
      if (kind === 'png-folder') {
        onSourceTypeChange('png');
        onPngFolderChange(pathArg);
        onPngDataChange(null);
        onPngFrameRateChange(null);
        const result = await window.api.scanPngSequence(pathArg);
        onPngDataChange(result.error ? { error: result.error } : result);
      } else if (kind === 'video') {
        onSourceTypeChange('video');
        onVideoPathChange(pathArg);
        onVideoDataChange(null);
        onVideoFrameRateChange(null);
        onFrameRateWarning(null);
        const result = await window.api.probeVideo(pathArg);
        if (result.error) {
          onVideoDataChange({ error: result.error });
        } else {
          onVideoDataChange(result);
          const fpsClass = classifyFps(result.fps, allowedFps);
          if (fpsClass.status === 'ok') {
            onVideoFrameRateChange(fpsClass.conformTo);
            onFrameRateWarning(null);
          } else if (fpsClass.status === 'dropframe') {
            onVideoFrameRateChange(fpsClass.conformTo);
            onFrameRateWarning({
              type: 'dropframe',
              message: `Drop-frame (${fpsClass.detected}fps) — conformed to ${fpsClass.conformTo}fps.`,
            });
          } else {
            onVideoFrameRateChange(null);
            onFrameRateWarning({
              type: 'unsupported',
              message: `Unsupported frame rate (${fpsClass.detected}fps). Re-export at exactly 30 or 60fps.`,
            });
          }
        }
      }
    } finally {
      setBusy(false);
    }
  }, [allowedFps, onSourceTypeChange, onPngFolderChange, onPngDataChange,
      onPngFrameRateChange, onVideoPathChange, onVideoDataChange,
      onVideoFrameRateChange, onFrameRateWarning]);

  // Browse handlers
  const handleBrowseVideo = async () => {
    const f = await window.api.openFile({
      title: 'Select Video File',
      filters: [{ name: 'Video Files', extensions: ['mp4', 'mov'] }],
    });
    if (f) loadSource('video', f);
  };
  const handleBrowsePNGs = async () => {
    const f = await window.api.openFolder({ title: 'Select PNG Sequence Folder' });
    if (f) loadSource('png-folder', f);
  };

  // Drag-drop with auto-detection
  const handleDragEnter = (e) => { e.preventDefault(); e.stopPropagation(); setDragActive(true); };
  const handleDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); setDragActive(false); };
  const handleDragOver  = (e) => { e.preventDefault(); e.stopPropagation(); };
  const handleDrop = async (e) => {
    e.preventDefault(); e.stopPropagation();
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    const fullPath = window.api.getPathForFile(files[0]);
    if (!fullPath) return;
    const detected = await window.api.detectSource(fullPath);
    if (detected.kind === 'video') {
      loadSource('video', detected.filePath);
    } else if (detected.kind === 'png-folder') {
      loadSource('png-folder', detected.folderPath);
    } else {
      // Unrecognized
      alert(detected.error || 'Could not detect source type. Drop a .mp4/.mov file or a folder containing PNGs.');
    }
  };

  const handleClear = () => {
    if (sourceType === 'png') {
      onPngFolderChange(null);
      onPngDataChange(null);
      onPngFrameRateChange(null);
    } else {
      onVideoPathChange(null);
      onVideoDataChange(null);
      onVideoFrameRateChange(null);
      onFrameRateWarning(null);
    }
    setThumbUrl(null);
  };

  // ───────────────────────────────────────────────────────────────────────────
  return (
    <div className="card source-preview-card">
      <div className="card-title">Source · Preview</div>

      {/* Preview / drop zone area (always square) */}
      <div
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className="preview-box"
        style={{
          border: dragActive ? '2px dashed #ED8B1E' : '1px solid #303030',
          background: dragActive ? 'rgba(237,139,30,0.06)' : '#0d0d0d',
        }}
      >
        {/* Empty state */}
        {!isLoaded && !busy && (
          <div className="preview-empty">
            <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.4 }}>
              {dragActive ? '⬇️' : '🎬'}
            </div>
            <div style={{ fontSize: 14, color: '#aaa', marginBottom: 4 }}>
              {dragActive ? 'Drop to load' : 'Drop a video or PNG folder here'}
            </div>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 18 }}>
              .mp4 · .mov · folders of .png frames
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" onClick={handleBrowseVideo}>
                Browse video…
              </button>
              <button className="btn btn-secondary" onClick={handleBrowsePNGs}>
                Browse PNGs…
              </button>
            </div>
            {onOpenProject && (
              <div style={{ marginTop: 14, fontSize: 11, color: '#444' }}>
                — or —{' '}
                <button
                  onClick={onOpenProject}
                  className="text-btn"
                  title="Open a .dfwproj file"
                >
                  📂 Open a saved project
                </button>
              </div>
            )}
          </div>
        )}

        {/* Loading */}
        {busy && (
          <div className="preview-empty">
            <div style={{ fontSize: 14, color: '#ED8B1E' }}>🔍 Analyzing…</div>
          </div>
        )}

        {/* Loaded thumbnail */}
        {isLoaded && thumbUrl && !busy && (
          <>
            <img src={thumbUrl} alt="preview"
                 style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            <button onClick={handleClear} className="preview-clear-btn" title="Remove source">
              ✕
            </button>
          </>
        )}

        {/* Loaded but no thumb yet */}
        {isLoaded && !thumbUrl && !busy && (
          <div className="preview-empty">
            <div style={{ fontSize: 14, color: '#888' }}>
              {thumbError ? 'Preview failed' : 'Generating preview…'}
            </div>
          </div>
        )}

        {/* Error state */}
        {activeSource?.error && !busy && (
          <div className="preview-empty">
            <div style={{ fontSize: 14, color: '#f08080' }}>✕ {activeSource.error}</div>
            <button className="btn btn-ghost" style={{ marginTop: 12, fontSize: 12 }}
                    onClick={handleClear}>Try again</button>
          </div>
        )}
      </div>

      {/* Source info chips below preview */}
      {isLoaded && (
        <div className="source-info">
          <div className="chip-row">
            <span className={`chip chip-${sourceType === 'video' ? 'blue' : 'green'}`}>
              {sourceType === 'video' ? '🎬 Video' : '🖼 PNG sequence'}
            </span>
            {sourceType === 'png' && pngData?.frameCount && (
              <span className="chip">{pngData.frameCount.toLocaleString()} frames</span>
            )}
            {sourceType === 'video' && videoData?.codec && (
              <span className="chip">{videoData.codec}</span>
            )}
            {sourceType === 'video' && videoData?.width && (
              <span className="chip">{videoData.width}×{videoData.height}</span>
            )}
            {sourceType === 'video' && videoData?.fps && (
              <span className="chip">{videoData.fps}fps</span>
            )}
            {sourceType === 'video' && videoData?.duration && (
              <span className="chip">
                {Math.floor(videoData.duration/60)}m {Math.round(videoData.duration%60)}s
              </span>
            )}
            {/* Bit depth chip */}
            {(sourceType === 'png' ? pngData?.bitDepth : videoData?.bitDepth) && (
              <span className={`chip ${
                (sourceType === 'png' ? pngData.bitDepth : videoData.bitDepth) === 8
                  ? 'chip-yellow' : 'chip-green'
              }`}>
                {sourceType === 'png' ? pngData.bitDepth : videoData.bitDepth}-bit
              </span>
            )}
          </div>

          {/* Critical warnings */}
          {sourceType === 'png' && pngData?.gaps?.hasGaps && (
            <div className="inline-warn warn-error">
              ⚠ Missing frames: {pngData.gapReport}.
              FFmpeg would silently substitute the previous frame — re-render before encoding.
            </div>
          )}
          {sourceType === 'png' && pngData?.bitDepth === 8 && (
            <div className="inline-warn warn-yellow">
              ⚠ 8-bit source — re-export at 16-bit PNG/EXR if possible to avoid banding.
            </div>
          )}
          {frameRateWarning?.type === 'dropframe' && (
            <div className="inline-warn warn-yellow">⚠ {frameRateWarning.message}</div>
          )}
          {frameRateWarning?.type === 'unsupported' && (
            <div className="inline-warn warn-error">✕ {frameRateWarning.message}</div>
          )}

          {/* Frame rate selector — only meaningful for PNG (video infers from probe) */}
          {sourceType === 'png' && !pngData?.error && (
            <div className="fps-row">
              <span className="fps-label">Frame rate</span>
              <div className="segment-control compact">
                {allowedFps.map(fps => (
                  <button
                    key={fps}
                    className={`segment-btn ${pngFrameRate === fps ? 'active' : ''}`}
                    onClick={() => onPngFrameRateChange(fps)}
                  >
                    {fps}fps
                  </button>
                ))}
              </div>
            </div>
          )}
          {sourceType === 'video' && videoFrameRate && (
            <div className="fps-row">
              <span className="fps-label">Output frame rate</span>
              <span className="chip chip-orange">{videoFrameRate}fps</span>
              <span style={{ color: '#555', fontSize: 11 }}>
                {frameRateWarning?.type === 'dropframe' ? '(conformed)' : '(matches source)'}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
