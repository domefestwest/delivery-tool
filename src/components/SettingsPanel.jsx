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
  // output
  resolution, onResolutionChange,
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

  return (
    <div className="card settings-panel">
      <div className="card-title">Settings</div>

      {/* ─── FILM ─── */}
      <div className="settings-section">
        <SectionLabel
          badge={recentEncodes?.length > 0 ? (
            <span ref={recentRef} style={{ position: 'relative' }}>
              <button
                className="text-btn"
                onClick={(e) => { e.stopPropagation(); setShowRecent(!showRecent); }}
              >
                ⟲ Recent ({recentEncodes.length})
              </button>
              {showRecent && (
                <div className="popover popover-right">
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
                </div>
              )}
            </span>
          ) : null}
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

      {/* ─── OUTPUT ─── */}
      <div className="settings-section">
        <SectionLabel>OUTPUT</SectionLabel>
        <div className="settings-row" style={{ marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <div className="segment-control compact">
              {resolutions.map(res => (
                <button
                  key={res.label}
                  className={`segment-btn ${resolution?.label === res.label ? 'active' : ''}`}
                  onClick={() => onResolutionChange(res)}
                  title={`${res.width}×${res.height}`}
                >
                  {res.label}
                </button>
              ))}
            </div>
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

      {/* ─── AUDIO ─── */}
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
