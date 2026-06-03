import React, { useState, useCallback, useRef } from 'react';

/**
 * VerifyDeliveryPanel — Festival-coordinator UI for verifying a received delivery.
 *
 * Replaces the encode UI entirely when Festival Verify Mode is active. Users
 * drop a delivery folder (or pick one), the tool re-hashes every file and
 * re-probes the video, then displays a per-check verdict.
 */
export default function VerifyDeliveryPanel() {
  const [folderPath, setFolderPath] = useState(null);
  const [result, setResult]         = useState(null);
  const [busy, setBusy]             = useState(false);
  const [dragOver, setDragOver]     = useState(false);
  const inputRef = useRef(null);

  const runVerify = useCallback(async (path) => {
    if (!path) return;
    setBusy(true);
    setResult(null);
    setFolderPath(path);
    try {
      const r = await window.api.verifyDelivery(path);
      setResult(r);
    } catch (err) {
      setResult({ error: err.message });
    } finally {
      setBusy(false);
    }
  }, []);

  const handlePick = useCallback(async () => {
    const r = await window.api.openFolder({ title: 'Pick a delivery folder to verify' });
    if (r && !r.canceled && r.path) runVerify(r.path);
  }, [runVerify]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    const p = window.api.getPathForFile(files[0]);
    if (p) runVerify(p);
  }, [runVerify]);

  const handleSaveReport = useCallback(async () => {
    if (!result || result.error) return;
    const r = await window.api.saveVerificationReport(result);
    if (r?.path) {
      window.api.showInFolder(r.path);
    } else if (r?.error) {
      alert('Could not save verification report: ' + r.error);
    }
  }, [result]);

  const handleDisableMode = useCallback(async () => {
    await window.api.disableVerifyMode();
  }, []);

  const handleClear = () => { setFolderPath(null); setResult(null); };

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto', color: '#e8e8e8' }}>
      {/* Mode banner */}
      <div style={{
        background: 'rgba(108, 71, 184, 0.12)',
        border: '1px solid rgba(108, 71, 184, 0.4)',
        borderRadius: 8,
        padding: '12px 16px',
        marginBottom: 20,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#b69bff' }}>
            🏛 Festival Verify Mode
          </div>
          <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>
            Verifies a received delivery against its <code>delivery_report.txt</code>.
            Re-hashes every file, re-probes the video. For festival coordinators.
          </div>
        </div>
        <button
          onClick={handleDisableMode}
          style={{
            background: 'none', border: '1px solid #555', color: '#bbb',
            padding: '5px 12px', borderRadius: 5, fontSize: 12, cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
          title="Turn off Festival Verify Mode and return to the encode interface"
        >
          Exit verify mode
        </button>
      </div>

      {/* Drop zone (only if no result) */}
      {!result && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={handlePick}
          style={{
            border: `2px dashed ${dragOver ? '#b69bff' : '#444'}`,
            borderRadius: 12,
            padding: '60px 24px',
            textAlign: 'center',
            cursor: 'pointer',
            background: dragOver ? 'rgba(108,71,184,0.06)' : 'transparent',
            transition: 'all 0.15s ease',
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 12 }}>📁</div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
            Drop a delivery folder here
          </div>
          <div style={{ fontSize: 12, color: '#888' }}>
            …or click to pick one. The folder must contain a <code>delivery_report.txt</code>.
          </div>
        </div>
      )}

      {/* Busy */}
      {busy && (
        <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>
          <div style={{ fontSize: 24, marginBottom: 10 }}>⏳</div>
          <div>Hashing files and probing video…</div>
          <div style={{ fontSize: 11, color: '#666', marginTop: 6 }}>
            Large 8K masters can take 30–60 seconds.
          </div>
        </div>
      )}

      {/* Result */}
      {result && !busy && (
        <ResultView
          result={result}
          folderPath={folderPath}
          onSaveReport={handleSaveReport}
          onClear={handleClear}
        />
      )}
    </div>
  );
}

function ResultView({ result, folderPath, onSaveReport, onClear }) {
  if (result.error) {
    return (
      <div style={{
        background: 'rgba(220,60,60,0.1)',
        border: '1px solid rgba(220,60,60,0.4)',
        borderRadius: 8,
        padding: 16,
        color: '#ff9494',
      }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>✗ Could not verify</div>
        <div style={{ fontSize: 13 }}>{result.error}</div>
        <button onClick={onClear} style={{
          marginTop: 14, background: 'none', border: '1px solid #555',
          color: '#bbb', padding: '5px 12px', borderRadius: 5, fontSize: 12,
          cursor: 'pointer',
        }}>Try another folder</button>
      </div>
    );
  }

  const verdictColor = result.overall === 'pass' ? '#4ade80'
                     : result.overall === 'warn' ? '#facc15'
                     : '#f87171';
  const verdictBg = result.overall === 'pass' ? 'rgba(74,222,128,0.08)'
                  : result.overall === 'warn' ? 'rgba(250,204,21,0.08)'
                  : 'rgba(248,113,113,0.08)';
  const verdictBorder = result.overall === 'pass' ? 'rgba(74,222,128,0.35)'
                      : result.overall === 'warn' ? 'rgba(250,204,21,0.35)'
                      : 'rgba(248,113,113,0.4)';
  const verdictText = result.overall === 'pass' ? '✓ PASS — delivery matches'
                    : result.overall === 'warn' ? '⚠ Pass with warnings'
                    : '✗ FAIL — delivery does not match';

  const meta = result.parsed?.meta || {};
  const video = result.parsed?.video || {};

  return (
    <div>
      {/* Verdict banner */}
      <div style={{
        background: verdictBg,
        border: `1px solid ${verdictBorder}`,
        borderRadius: 8,
        padding: '14px 18px',
        marginBottom: 16,
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: verdictColor }}>
          {verdictText}
        </div>
        <div style={{ fontSize: 12, color: '#aaa', marginTop: 6 }}>
          <strong>{meta.filmTitle || '(unknown)'}</strong>
          {meta.artist && <> · {meta.artist}</>}
          {meta.festival && <> · {meta.festival}</>}
        </div>
        <div style={{ fontSize: 11, color: '#777', marginTop: 2 }}>
          {video.resolutionLabel && `${video.resolutionLabel} `}
          {video.width && video.height && `${video.width}×${video.height} `}
          {video.codec} {video.frameRate && `${video.frameRate}fps`} {video.bitDepth}
        </div>
      </div>

      {/* Per-check list */}
      <div style={{
        background: '#1e1e1e',
        border: '1px solid #333',
        borderRadius: 8,
        overflow: 'hidden',
      }}>
        {result.checks.map((c, i) => <CheckRow key={c.id} check={c} last={i === result.checks.length - 1} />)}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button onClick={onSaveReport} style={{
          background: '#3a3a3a', border: '1px solid #555', color: '#e8e8e8',
          padding: '8px 16px', borderRadius: 5, fontSize: 13, cursor: 'pointer',
          fontWeight: 600,
        }}>💾 Save verification report</button>
        <button onClick={onClear} style={{
          background: 'none', border: '1px solid #444', color: '#bbb',
          padding: '8px 16px', borderRadius: 5, fontSize: 13, cursor: 'pointer',
        }}>Verify another delivery</button>
      </div>

      <div style={{ fontSize: 11, color: '#666', marginTop: 12 }}>
        Verified folder: <code>{folderPath}</code>
      </div>
    </div>
  );
}

function CheckRow({ check, last }) {
  const icon = check.status === 'pass' ? '✓' : check.status === 'warn' ? '⚠' : '✗';
  const color = check.status === 'pass' ? '#4ade80' : check.status === 'warn' ? '#facc15' : '#f87171';

  return (
    <div style={{
      padding: '12px 16px',
      borderBottom: last ? 'none' : '1px solid #2a2a2a',
      display: 'flex',
      gap: 12,
      alignItems: 'flex-start',
    }}>
      <div style={{ fontSize: 16, color, lineHeight: 1, marginTop: 1 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#e8e8e8' }}>
          {check.label}
        </div>
        <div style={{ fontSize: 11, color: '#888', marginTop: 4, fontFamily: 'monospace', wordBreak: 'break-all' }}>
          expected: {check.expected}
          <br />
          actual: {check.actual}
        </div>
        {check.detail && (
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 6, fontStyle: 'italic' }}>
            {check.detail}
          </div>
        )}
      </div>
    </div>
  );
}
