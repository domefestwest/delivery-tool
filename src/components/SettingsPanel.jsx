import React, { useState, useEffect, useRef } from 'react';
import StemSelector from './AudioInput/StemSelector';
import InterleaveSelector from './AudioInput/InterleaveSelector';

/**
 * SettingsPanel — single card on the right of the layout. Consolidates:
 *   - FILM section (title + artist + recent dropdown)
 *   - OUTPUT section (resolution + folder)
 *   - AUDIO section (mode + dynamic UI + mux toggle)
 *   - ENCODER section (GPU/CPU + options gear)
 *
 * Each section is a separator-divided block in one card — way more compact
 * than the previous 4-card vertical stack.
 */

function formatRelativeTime(isoDate) {
  const then = new Date(isoDate).getTime();
  const sec = Math.floor((Date.now() - then) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  const d = Math.floor(sec / 86400);
  if (d < 30) return `${d}d ago`;
  return new Date(isoDate).toLocaleDateString();
}

function SectionLabel({ children, badge }) {
  return (
    <div className="section-label">
      <span>{children}</span>
      {badge && <span className="section-badge">{badge}</span>}
    </div>
  );
}

export default function SettingsPanel({
  config,
  // film
  filmTitle, artistName, onTitleChange, onArtistChange,
  recentEncodes, onReplayRecent,
  onSaveProject, onOpenProject,
  // mode (master vs screener)
  mode, onModeChange,
  // screener watermark
  watermarkType, onWatermarkTypeChange,
  watermarkText, onWatermarkTextChange,
  watermarkImage, onWatermarkImageChange,
  watermarkMoving, onWatermarkMovingChange,
  watermarkPosition, onWatermarkPositionChange,
  // output
  selectedResolutions, onSelectedResolutionsChange,
  sourceWidth, sourceHeight,
  outputDir, onOutputDirChange,
  // audio
  audioMode, onAudioModeChange,
  audioStems, onAudioStemsChange,
  audioInterleaved, onAudioInterleavedChange,
  muxAudio, onMuxAudioChange,
  // encoder
  depStatus, useGPU, onUseGPUChange,
  autoZip, onAutoZipChange,
  notifyOnComplete, onNotifyOnCompleteChange,
  autoOpenFolder, onAutoOpenFolderChange,
  preventSleep, onPreventSleepChange,
}) {
  const [showRecent, setShowRecent] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const recentRef = useRef(null);
  const optionsRef = useRef(null);

  const gpu = depStatus?.gpu;
  const gpuAvailable = gpu?.available;
  const willUseGPU = gpuAvailable && useGPU;
  const resolutions = config?.video?.allowed_resolutions || [];

  // Close popovers when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (showRecent && recentRef.current && !recentRef.current.contains(e.target)) {
        setShowRecent(false);
      }
      if (showOptions && optionsRef.current && !optionsRef.current.contains(e.target)) {
        setShowOptions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showRecent, showOptions]);

  const handleOutputDir = async () => {
    const dir = await window.api.saveFolder({
      title: 'Choose Output Folder',
      defaultPath: outputDir || undefined,
    });
    if (dir) onOutputDirChange(dir);
  };

  const screenerEnabled = !!config?.screener?.enabled;
  const isScreener = mode === 'screener';

  const handlePickWatermarkImage = async () => {
    const f = await window.api.openFile({
      title: 'Choose Watermark Image',
      filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg'] }],
    });
    if (f) onWatermarkImageChange(f);
  };

  return (
    <div className="card settings-panel">
      <div className="card-title">Settings</div>

      {/* ─── MODE (only shown when festival enables screener) ─── */}
      {screenerEnabled && (
        <div className="settings-section">
          <SectionLabel
            badge={isScreener ? (
              <span style={{
                background: 'rgba(232,184,75,0.15)', color: '#e8c96e',
                padding: '2px 8px', borderRadius: 4, fontSize: 10,
                fontWeight: 700, letterSpacing: '0.06em',
              }}>🧪 EXPERIMENTAL</span>
            ) : null}
          >
            DELIVERABLE
          </SectionLabel>
          <div className="segment-control compact">
            <button
              className={`segment-btn ${!isScreener ? 'active' : ''}`}
              onClick={() => onModeChange('master')}
              title="Encode a dome master for festival delivery"
            >
              🎬 Dome Master
            </button>
            <button
              className={`segment-btn ${isScreener ? 'active' : ''}`}
              onClick={() => onModeChange('screener')}
              title="Encode a low-resolution screener for jury review"
            >
              🎞 Screener
            </button>
          </div>
          {isScreener && (
            <div className="muted small" style={{ marginTop: 6, fontSize: 11, lineHeight: 1.5 }}>
              Screener mode produces a fast 2K H.264 file for jury review.
              Not for dome projection. Currently experimental.
            </div>
          )}
        </div>
      )}

      {/* ─── FILM ─── */}
      <div className="settings-section">
        <SectionLabel
          badge={
            <span ref={recentRef} style={{ position: 'relative', display: 'inline-flex', gap: 4 }}>
              <button
                className="text-btn"
                onClick={(e) => { e.stopPropagation(); setShowRecent(!showRecent); }}
                title="Recent encodes and project files"
              >
                📁 Open ▾
              </button>
              {showRecent && (
                <div className="popover popover-right">
                  <div className="popover-header">Project</div>
                  <button
                    className="popover-item"
                    onClick={() => { onOpenProject?.(); setShowRecent(false); }}
                    title="⌘O / Ctrl+O"
                  >
                    <div className="popover-item-title">📂 Open project file… <span style={{ color: '#555', fontSize: 11 }}>⌘O</span></div>
                    <div className="popover-item-sub">.dfwproj from a previous save</div>
                  </button>
                  <button
                    className="popover-item"
                    onClick={() => { onSaveProject?.(); setShowRecent(false); }}
                    title="⌘S / Ctrl+S"
                  >
                    <div className="popover-item-title">💾 Save current as project… <span style={{ color: '#555', fontSize: 11 }}>⌘S</span></div>
                    <div className="popover-item-sub">Pickup-where-you-left-off later</div>
                  </button>
                  {recentEncodes?.length > 0 && (
                    <>
                      <div className="popover-header">Recent Encodes</div>
                      {recentEncodes.map((r, i) => (
                        <button
                          key={i}
                          className="popover-item"
                          onClick={() => { onReplayRecent(r); setShowRecent(false); }}
                        >
                          <div className="popover-item-title">{r.filmTitle || '(untitled)'}</div>
                          <div className="popover-item-sub">
                            {r.resolution} · {r.frameRate}fps · {(r.encoder || '').replace(/\s*\(GPU\)/, '')}
                            <span style={{ color: '#555', marginLeft: 8 }}>
                              {formatRelativeTime(r.encodeDate)}
                            </span>
                          </div>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </span>
          }
        >
          FILM
        </SectionLabel>
        <div className="settings-row">
          <input
            className="input-field compact"
            type="text"
            placeholder="Film title *"
            value={filmTitle}
            onChange={e => onTitleChange(e.target.value)}
            style={{ flex: 2 }}
          />
          <input
            className="input-field compact"
            type="text"
            placeholder="Artist / studio"
            value={artistName}
            onChange={e => onArtistChange(e.target.value)}
            style={{ flex: 1.5 }}
            title="Saved between sessions"
          />
        </div>
      </div>

      {/* ─── OUTPUT (master mode) ─── */}
      {!isScreener && (
      <div className="settings-section">
        <SectionLabel
          badge={selectedResolutions?.length > 1 ? (
            <span className="muted small">batch of {selectedResolutions.length}</span>
          ) : null}
        >
          OUTPUT
        </SectionLabel>

        {/* Source-too-small warning: no resolution from this festival fits */}
        {sourceWidth && sourceHeight && resolutions.length > 0 &&
         resolutions.every(r => r.width > sourceWidth || r.height > sourceHeight) && (
          <div className="inline-warn warn-error" style={{ marginBottom: 10, fontSize: 12 }}>
            ⚠ Source is {sourceWidth}×{sourceHeight} — too small for any of this festival's
            accepted resolutions ({resolutions.map(r => r.label).join(', ')}).
            {config?.screener?.enabled && (
              <> Consider Screener mode for jury-review files.</>
            )}
          </div>
        )}

        <div className="settings-row" style={{ marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <div className="segment-control compact">
              {resolutions.map(res => {
                const isSelected = selectedResolutions?.some(r => r.label === res.label);
                const wouldUpscale = sourceWidth && sourceHeight &&
                  (res.width > sourceWidth || res.height > sourceHeight);
                return (
                  <button
                    key={res.label}
                    className={`segment-btn ${isSelected ? 'active' : ''}`}
                    disabled={wouldUpscale}
                    onClick={() => {
                      if (wouldUpscale) return;
                      const current = selectedResolutions || [];
                      if (isSelected) {
                        if (current.length > 1) {
                          onSelectedResolutionsChange(current.filter(r => r.label !== res.label));
                        }
                      } else {
                        const next = resolutions
                          .filter(r => !(sourceWidth && (r.width > sourceWidth || r.height > sourceHeight)))
                          .filter(r => r.label === res.label || current.some(c => c.label === r.label));
                        onSelectedResolutionsChange(next);
                      }
                    }}
                    style={wouldUpscale ? {
                      opacity: 0.35, cursor: 'not-allowed', textDecoration: 'line-through',
                    } : {}}
                    title={
                      wouldUpscale
                        ? `${res.width}×${res.height} — would require upscaling from ${sourceWidth}×${sourceHeight} source`
                        : `${res.width}×${res.height} — click to ${isSelected ? 'remove' : 'add'} to batch`
                    }
                  >
                    {res.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Explanation when some resolutions are disabled */}
        {sourceWidth && sourceHeight && resolutions.some(r =>
          r.width > sourceWidth || r.height > sourceHeight
        ) && resolutions.some(r =>
          r.width <= sourceWidth && r.height <= sourceHeight
        ) && (
          <div className="muted small" style={{ marginBottom: 8, fontSize: 11 }}>
            ℹ Higher resolutions disabled — source is {sourceWidth}×{sourceHeight},
            this tool never upscales.
          </div>
        )}

        {selectedResolutions?.length > 1 && (
          <div className="muted small" style={{ marginBottom: 8 }}>
            Will encode {selectedResolutions.map(r => r.label).join(' → ')} in sequence.
          </div>
        )}
        <div className="settings-row">
          <div className={`path-display compact ${outputDir ? 'has-value' : ''}`}
               title={outputDir || ''}>
            {outputDir || 'Output folder *'}
          </div>
          <button className="btn btn-secondary btn-icon" onClick={handleOutputDir}>📁</button>
        </div>
      </div>
      )}

      {/* ─── SCREENER OUTPUT (when in screener mode) ─── */}
      {isScreener && (
        <div className="settings-section">
          <SectionLabel>OUTPUT</SectionLabel>
          <div style={{
            background: 'var(--bg-1)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: '10px 14px', marginBottom: 8,
            fontSize: 12, lineHeight: 1.7,
          }}>
            <div>
              <span className="chip chip-yellow">{config?.screener?.resolution?.label || '2K'}</span>
              {' '}<span style={{ color: '#999' }}>
                {config?.screener?.resolution?.width || 2048}×{config?.screener?.resolution?.height || 2048}
                {' '}· {(config?.screener?.codec || 'libx264').toUpperCase()}
                {' '}· CRF {config?.screener?.crf ?? 28}
                {' '}· {config?.screener?.preset || 'fast'}
              </span>
            </div>
            <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
              Output: <code style={{ fontSize: 10 }}>{`{Title}_{FESTIVAL}{Year}_SCREENER.mp4`}</code>
            </div>
          </div>
          <div className="settings-row">
            <div className={`path-display compact ${outputDir ? 'has-value' : ''}`}
                 title={outputDir || ''}>
              {outputDir || 'Output folder *'}
            </div>
            <button className="btn btn-secondary btn-icon" onClick={handleOutputDir}>📁</button>
          </div>
        </div>
      )}

      {/* ─── SCREENER WATERMARK (when in screener mode) ─── */}
      {isScreener && (
        <div className="settings-section">
          <SectionLabel>WATERMARK</SectionLabel>
          <div className="segment-control compact" style={{ marginBottom: 10 }}>
            {[
              { id: 'none',  label: 'None' },
              { id: 'text',  label: 'Text' },
              { id: 'image', label: 'Image' },
            ].map(m => (
              <button
                key={m.id}
                className={`segment-btn ${watermarkType === m.id ? 'active' : ''}`}
                onClick={() => onWatermarkTypeChange(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>

          {watermarkType === 'text' && (
            <input
              className="input-field compact"
              type="text"
              value={watermarkText || ''}
              onChange={e => onWatermarkTextChange(e.target.value)}
              placeholder="e.g. SCREENER · DO NOT DISTRIBUTE"
              style={{ marginBottom: 8 }}
            />
          )}

          {watermarkType === 'image' && (
            <div className="settings-row" style={{ marginBottom: 8 }}>
              <div className={`path-display compact ${watermarkImage ? 'has-value' : ''}`}
                   title={watermarkImage || ''}>
                {watermarkImage
                  ? watermarkImage.split(/[\\/]/).pop()
                  : 'No image selected'}
              </div>
              <button className="btn btn-secondary btn-icon" onClick={handlePickWatermarkImage}>📁</button>
            </div>
          )}

          {watermarkType !== 'none' && (
            <>
              <div className="settings-row" style={{ marginBottom: 8, gap: 12 }}>
                <span className="muted small" style={{ fontSize: 11 }}>Position:</span>
                <div className="segment-control compact" style={{ flex: 1 }}>
                  {[
                    { id: 'center',       label: 'Center' },
                    { id: 'top-left',     label: '↖' },
                    { id: 'top-right',    label: '↗' },
                    { id: 'bottom-left',  label: '↙' },
                    { id: 'bottom-right', label: '↘' },
                  ].map(p => (
                    <button
                      key={p.id}
                      className={`segment-btn ${watermarkPosition === p.id ? 'active' : ''}`}
                      onClick={() => onWatermarkPositionChange(p.id)}
                      disabled={watermarkMoving}
                      style={watermarkMoving ? { opacity: 0.4, cursor: 'not-allowed' } : {}}
                      title={p.id}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={!!watermarkMoving}
                  onChange={e => onWatermarkMovingChange(e.target.checked)}
                />
                <span style={{ fontSize: 12 }}>
                  Move watermark between corners (anti-camcorder)
                </span>
              </label>
            </>
          )}

          <div className="muted small" style={{ marginTop: 8, fontSize: 11 }}>
            Watermark is overlaid at 30% opacity. Helps prevent screener leaks.
          </div>
        </div>
      )}

      {/* ─── AUDIO (master mode only — screener is always stereo AAC mux) ─── */}
      {!isScreener && (
      <div className="settings-section">
        <SectionLabel>AUDIO</SectionLabel>
        <div className="segment-control compact" style={{ marginBottom: 10 }}>
          {[
            { id: 'none',         label: 'None' },
            { id: 'stems',        label: '6 Stems' },
            { id: 'interleaved',  label: '5.1 WAV' },
          ].map(m => (
            <button
              key={m.id}
              className={`segment-btn ${audioMode === m.id ? 'active' : ''}`}
              onClick={() => onAudioModeChange(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>

        {audioMode === 'stems' && (
          <div style={{ marginTop: 4 }}>
            <StemSelector stems={audioStems} onStemsChange={onAudioStemsChange} />
          </div>
        )}
        {audioMode === 'interleaved' && (
          <div style={{ marginTop: 4 }}>
            <InterleaveSelector
              filePath={audioInterleaved}
              onFilePathChange={onAudioInterleavedChange}
            />
          </div>
        )}
        {audioMode === 'none' && (
          <div className="muted small">
            No audio in delivery package. A README placeholder will be created.
          </div>
        )}

        {audioMode !== 'none' && (
          <label className="checkbox-inline" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={muxAudio}
              onChange={e => onMuxAudioChange(e.target.checked)} />
            <span>Embed audio in video file</span>
          </label>
        )}
      </div>
      )}

      {/* ─── ENCODER ─── */}
      <div className="settings-section settings-section-last">
        <SectionLabel
          badge={
            <span ref={optionsRef} style={{ position: 'relative' }}>
              <button
                className="text-btn"
                onClick={(e) => { e.stopPropagation(); setShowOptions(!showOptions); }}
                title="Delivery options"
              >
                ⚙ Options
              </button>
              {showOptions && (
                <div className="popover popover-right" style={{ minWidth: 280 }}>
                  <div className="popover-header">Delivery Options</div>
                  <div style={{ padding: '6px 12px 10px' }}>
                    <PopoverCheckbox
                      label="Auto-zip on completion"
                      checked={autoZip} onChange={onAutoZipChange}
                    />
                    <PopoverCheckbox
                      label="Notify when done"
                      checked={notifyOnComplete} onChange={onNotifyOnCompleteChange}
                    />
                    <PopoverCheckbox
                      label="Auto-open folder"
                      checked={autoOpenFolder} onChange={onAutoOpenFolderChange}
                    />
                    <PopoverCheckbox
                      label="Prevent sleep during encode"
                      checked={preventSleep} onChange={onPreventSleepChange}
                    />
                  </div>
                </div>
              )}
            </span>
          }
        >
          ENCODER
        </SectionLabel>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, fontSize: 12, color: '#aaa',
        }}>
          <div>
            <span className={`chip ${willUseGPU ? 'chip-green' : 'chip-blue'}`}>
              {willUseGPU ? '⚡ GPU' : '🖥 CPU'}
            </span>
            <span style={{ marginLeft: 8 }}>
              {willUseGPU ? gpu.label : 'libx265 — CRF ' + (config?.video?.crf ?? 18)}
            </span>
          </div>
          {gpuAvailable && (
            <label className="checkbox-inline" title="Disable to use libx265 CPU encoder">
              <input type="checkbox" checked={useGPU}
                onChange={e => onUseGPUChange(e.target.checked)} />
              <span style={{ fontSize: 11 }}>GPU</span>
            </label>
          )}
        </div>

        {/* Hover help line */}
        <div className="muted small mono" style={{ marginTop: 6, fontSize: 11 }}>
          <span title="H.265 / HEVC — required by SkySkan.">libx265</span>
          {' · '}
          <span title="Constant Rate Factor — lower = better. CRF 18 is visually lossless.">
            CRF {config?.video?.crf}
          </span>
          {' · '}
          <span title="10-bit color depth (1024 levels/channel) prevents banding on dome screens.">
            10-bit
          </span>
          {' · '}
          <span title="'slow' preset gives ~20% better compression than 'medium' at same quality.">
            {config?.video?.preset}
          </span>
        </div>
      </div>
    </div>
  );
}

function PopoverCheckbox({ label, checked, onChange }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
      cursor: 'pointer', fontSize: 13, color: '#ddd',
    }}>
      <input
        type="checkbox" checked={!!checked}
        onChange={e => onChange(e.target.checked)}
        style={{ accentColor: '#ED8B1E', width: 14, height: 14 }}
      />
      <span>{label}</span>
    </label>
  );
}
