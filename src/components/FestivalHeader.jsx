import React, { useState } from 'react';

export default function FestivalHeader({ config, depStatus, onLoadConfig }) {
  const [showCapModal, setShowCapModal] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const festivalName = config
    ? `${config.festival_name} ${config.version}`
    : 'Dome Fest West 2027';

  const handleLoadConfig = async () => {
    setLoadError(null);
    const result = await onLoadConfig();
    if (result?.error) setLoadError(result.error);
  };

  return (
    <>
      <header style={{
        background: '#111',
        borderBottom: '1px solid #333',
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 52,
        flexShrink: 0
      }}>
        {/* Left: festival branding */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18 }}>🎬</span>
            <div>
              <div style={{
                color: '#ED8B1E',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                lineHeight: 1
              }}>
                {config?.festival_short || 'DFW'}
              </div>
              <div style={{ color: '#e8e8e8', fontSize: 14, fontWeight: 700, lineHeight: 1.2 }}>
                {festivalName}
              </div>
            </div>
          </div>

          <div style={{ width: 1, height: 28, background: '#333' }} />

          <button
            onClick={handleLoadConfig}
            style={{
              background: 'none',
              border: '1px solid #404040',
              borderRadius: 5,
              color: '#999',
              cursor: 'pointer',
              fontSize: 12,
              padding: '4px 10px',
            }}
          >
            Load festival config
          </button>

          {loadError && (
            <span style={{ color: '#f08080', fontSize: 12 }}>⚠ {loadError}</span>
          )}
        </div>

        {/* Right: FFmpeg status */}
        <button
          onClick={() => setShowCapModal(true)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '4px 8px',
            borderRadius: 5,
          }}
          title="Click to see FFmpeg details"
        >
          <span style={{
            background: depStatus?.has10BitX265 ? '#4caf6e' : '#e05252',
            borderRadius: '50%',
            boxShadow: `0 0 6px ${depStatus?.has10BitX265 ? '#4caf6e' : '#e05252'}`,
            display: 'inline-block',
            height: 8,
            width: 8
          }} />
          <span style={{ color: '#888', fontSize: 12 }}>
            {depStatus?.has10BitX265
              ? `FFmpeg ${depStatus.version} ready`
              : 'FFmpeg unavailable'}
          </span>
        </button>
      </header>

      {/* Capability detail modal */}
      {showCapModal && (
        <div
          onClick={() => setShowCapModal(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#242424',
              border: '1px solid #404040',
              borderRadius: 10,
              maxWidth: 480,
              width: '90%',
              padding: 28
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ color: '#e8e8e8', fontSize: 16, fontWeight: 700 }}>FFmpeg Capability Details</h3>
              <button onClick={() => setShowCapModal(false)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 18 }}>×</button>
            </div>

            <Row label="Status" value={
              <span style={{ color: depStatus?.has10BitX265 ? '#4caf6e' : '#e05252', fontWeight: 700 }}>
                {depStatus?.has10BitX265 ? '✓ Ready' : '✗ Not available'}
              </span>
            } />
            <Row label="Version" value={depStatus?.version || 'unknown'} />
            <Row label="Source" value={depStatus?.source === 'bundled' ? 'Bundled (app-internal)' : depStatus?.source === 'system' ? 'System PATH' : 'None'} />
            <Row label="Binary path" value={<span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>{depStatus?.path || 'none'}</span>} />
            <Row label="libx265" value={depStatus?.hasX265 ? '✓ Present' : '✗ Missing'} />
            <Row label="10-bit x265" value={depStatus?.has10BitX265 ? '✓ Present' : '✗ Missing'} />

            {depStatus?.warning && (
              <div style={{
                marginTop: 16,
                background: 'rgba(232,184,75,0.1)',
                border: '1px solid rgba(232,184,75,0.3)',
                borderRadius: 6,
                color: '#e8c96e',
                fontSize: 12,
                lineHeight: 1.6,
                padding: '10px 14px'
              }}>
                ⚠ {depStatus.warning}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '7px 0', borderBottom: '1px solid #333', fontSize: 13 }}>
      <div style={{ color: '#666', width: 110, flexShrink: 0 }}>{label}</div>
      <div style={{ color: '#e8e8e8', flex: 1 }}>{value}</div>
    </div>
  );
}
