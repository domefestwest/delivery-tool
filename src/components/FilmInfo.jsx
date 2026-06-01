import React, { useState, useRef, useEffect } from 'react';

function formatRelativeTime(isoDate) {
  const then = new Date(isoDate).getTime();
  const now = Date.now();
  const sec = Math.floor((now - then) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  const days = Math.floor(sec / 86400);
  if (days < 30) return `${days}d ago`;
  return new Date(isoDate).toLocaleDateString();
}

export default function FilmInfo({
  filmTitle, artistName,
  onTitleChange, onArtistChange,
  recentEncodes = [],
  onReplayRecent,
}) {
  const [showRecent, setShowRecent] = useState(false);
  const popoverRef = useRef(null);

  useEffect(() => {
    if (!showRecent) return;
    const handler = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setShowRecent(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showRecent]);

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>Film Information</div>
        {recentEncodes.length > 0 && (
          <div style={{ position: 'relative' }} ref={popoverRef}>
            <button
              onClick={() => setShowRecent(!showRecent)}
              style={{
                background: 'transparent', border: '1px solid #404040',
                color: '#999', cursor: 'pointer', fontSize: 11,
                padding: '4px 10px', borderRadius: 4,
              }}
            >
              ⟲ Recent ({recentEncodes.length}) ▾
            </button>

            {showRecent && (
              <div style={{
                position: 'absolute', right: 0, top: '100%', marginTop: 4,
                background: '#242424', border: '1px solid #404040',
                borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                minWidth: 340, maxWidth: 420, zIndex: 100,
                maxHeight: 360, overflowY: 'auto',
              }}>
                <div style={{ padding: '8px 12px', borderBottom: '1px solid #333',
                              fontSize: 11, color: '#666', fontWeight: 700,
                              letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Recent Encodes
                </div>
                {recentEncodes.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => { onReplayRecent(r); setShowRecent(false); }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      background: 'transparent', border: 'none', color: '#ddd',
                      cursor: 'pointer', padding: '10px 12px',
                      borderBottom: i < recentEncodes.length - 1 ? '1px solid #2a2a2a' : 'none',
                      fontSize: 13,
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#2e2e2e'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>
                      {r.filmTitle || '(untitled)'}
                    </div>
                    <div style={{ color: '#888', fontSize: 11 }}>
                      {r.resolution} · {r.frameRate}fps · {r.encoder?.replace(/\s*\(GPU\)/, '')}
                      <span style={{ color: '#555', marginLeft: 8 }}>{formatRelativeTime(r.encodeDate)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="label">
            Film Title <span style={{ color: '#ED8B1E' }}>*</span>
          </label>
          <input
            className="input-field"
            type="text"
            placeholder="e.g. Beyond the Dome"
            value={filmTitle}
            onChange={e => onTitleChange(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="label">
            Artist / Studio Name
            <span title="Saved between sessions" style={{ color: '#555', marginLeft: 6, cursor: 'help' }}>ⓘ</span>
          </label>
          <input
            className="input-field"
            type="text"
            placeholder="e.g. Stellar Visuals"
            value={artistName}
            onChange={e => onArtistChange(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
