import React, { useState, useEffect } from 'react';

function deadlineState(deadlineISO) {
  if (!deadlineISO) return null;
  const ms = new Date(deadlineISO).getTime() - Date.now();
  const days = ms / (1000 * 60 * 60 * 24);
  if (days < 0) return { status: 'past', daysLeft: Math.ceil(-days), label: `${Math.ceil(-days)} days past deadline` };
  if (days < 1) return { status: 'urgent', daysLeft: 0, label: `Deadline today!` };
  if (days < 7) return { status: 'soon', daysLeft: Math.floor(days), label: `${Math.floor(days)} day${days < 2 ? '' : 's'} until deadline` };
  return { status: 'ok', daysLeft: Math.floor(days), label: `${Math.floor(days)} days until deadline` };
}

export default function FestivalHeader({ config, depStatus, onLoadConfig }) {
  const [showCapModal, setShowCapModal] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [updateStatus, setUpdateStatus] = useState(null);

  // Subscribe to update events from main process
  useEffect(() => {
    // Fetch any cached status (in case the background check already fired)
    window.api.getUpdateStatus().then(s => { if (s) setUpdateStatus(s); });
    const unsub = window.api.onUpdateStatus(s => setUpdateStatus(s));
    return () => unsub();
  }, []);

  const festivalName = config
    ? `${config.festival_name} ${config.version}`
    : 'Dome Fest West 2027';
  const deadline = deadlineState(config?.submission_deadline);
  const deadlineColor = !deadline ? null :
    deadline.status === 'past' ? '#e05252' :
    deadline.status === 'urgent' ? '#ED8B1E' :
    deadline.status === 'soon' ? '#F2C200' : '#4caf6e';

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

          {deadline && (
            <>
              <div style={{ width: 1, height: 22, background: '#333' }} />
              <span title={`Submission deadline: ${new Date(config.submission_deadline).toLocaleString()}`}
                    style={{ color: deadlineColor, fontSize: 11, fontWeight: 700,
                             textTransform: 'uppercase', letterSpacing: '0.06em', cursor: 'help' }}>
                ⏰ {deadline.label}
              </span>
            </>
          )}
        </div>

        {/* Right cluster: update badge + FFmpeg status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {updateStatus?.hasUpdate && (
            <a
              href={updateStatus.release?.htmlUrl || '#'}
              target="_blank"
              rel="noopener noreferrer"
              onClick={async (e) => {
                e.preventDefault();
                if (updateStatus.release?.htmlUrl) {
                  await window.api.openPath(updateStatus.release.htmlUrl);
                }
              }}
              title={`Click to view release notes — published ${
                updateStatus.release?.publishedAt
                  ? new Date(updateStatus.release.publishedAt).toLocaleDateString()
                  : 'recently'
              }`}
              style={{
                background: 'rgba(237,139,30,0.18)',
                border: '1px solid rgba(237,139,30,0.45)',
                borderRadius: 5,
                color: '#ED8B1E',
                fontSize: 11,
                fontWeight: 700,
                padding: '4px 9px',
                textDecoration: 'none',
                letterSpacing: '0.04em',
              }}
            >
              ⬆ Update available — {updateStatus.latest}
            </a>
          )}

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
        </div>
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
