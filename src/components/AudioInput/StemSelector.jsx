import React, { useState } from 'react';

const CHANNELS = ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'];

// Try to auto-detect channel from filename.
// \b word-boundary doesn't catch underscore-separated tokens (e.g. film_LFE)
// so we use a separator-aware pattern: (^|[_\-. ])TOKEN($|[_\-. ])
function detectChannel(filename) {
  const base = filename.replace(/\.[^.]+$/, '').toLowerCase();
  // Helper: match TOKEN surrounded by start-of-string, end-of-string, or separators (_-. space)
  // NOTE: \b doesn't work here — underscore is \w so word boundaries don't fire across _
  const tok = (t) => new RegExp(`(^|[_\\-.\\s])${t}($|[_\\-.\\s]|(?=[A-Z]))`, 'i');
  const word = (t) => new RegExp(`(^|[_\\-.\\s])${t}($|[_\\-.\\s])`, 'i');

  // LFE first (must come before single-letter L check)
  if (word('lfe').test(base) || word('sub').test(base) || word('lf').test(base)) return 'LFE';
  // Ls / Rs surround (before L/R single-letter)
  if (word('ls').test(base) || word('lsurr').test(base) || /left.?surr/i.test(base) || word('rearleft').test(base)) return 'Ls';
  if (word('rs').test(base) || word('rsurr').test(base) || /right.?surr/i.test(base) || word('rearright').test(base)) return 'Rs';
  // Full words: left, right, center
  if (word('left').test(base)) return 'L';
  if (word('right').test(base)) return 'R';
  if (/[_\-.]cent(er|re)?($|[_\-.])/i.test(base) || word('center').test(base) || word('centre').test(base)) return 'C';
  // Single-letter suffixes: _L, _R, _C at end or surrounded by separators
  if (word('l').test(base)) return 'L';
  if (word('r').test(base)) return 'R';
  if (word('c').test(base)) return 'C';
  return null;
}

export default function StemSelector({ stems, onStemsChange }) {
  const [loading, setLoading] = useState(false);

  const handleAddFiles = async () => {
    const files = await window.api.openFiles({
      title: 'Select Audio Stem Files',
      filters: [{ name: 'WAV Audio', extensions: ['wav'] }]
    });
    if (!files) return;

    const newStems = files.map(f => ({
      filePath: f,
      filename: f.split('/').pop().split('\\').pop(),
      channel: detectChannel(f.split('/').pop().split('\\').pop()) || ''
    }));

    // Merge — avoid duplicates by path
    const existing = stems.filter(s => !newStems.find(n => n.filePath === s.filePath));
    onStemsChange([...existing, ...newStems]);
  };

  const handleRemove = (index) => {
    const next = stems.filter((_, i) => i !== index);
    onStemsChange(next);
  };

  const handleChannelChange = (index, channel) => {
    const next = stems.map((s, i) => i === index ? { ...s, channel } : s);
    onStemsChange(next);
  };

  const assignedChannels = stems.map(s => s.channel).filter(Boolean);
  const missingChannels = CHANNELS.filter(c => !assignedChannels.includes(c));
  const duplicates = CHANNELS.filter(c => assignedChannels.filter(a => a === c).length > 1);

  return (
    <div>
      <div style={{ marginBottom: 10 }}>
        <button className="btn btn-secondary" onClick={handleAddFiles}>
          + Add Stem Files
        </button>
        <span style={{ color: '#666', fontSize: 12, marginLeft: 12 }}>
          Select up to 6 WAV files (L, R, C, LFE, Ls, Rs)
        </span>
      </div>

      {stems.length > 0 && (
        <>
          <table className="channel-table">
            <thead>
              <tr>
                <th>File</th>
                <th style={{ width: 120 }}>Channel</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {stems.map((stem, i) => (
                <tr key={i}>
                  <td>
                    <span className="mono" style={{ fontSize: 12, color: '#ccc' }}>
                      {stem.filename}
                    </span>
                  </td>
                  <td>
                    <select
                      value={stem.channel}
                      onChange={e => handleChannelChange(i, e.target.value)}
                    >
                      <option value="">— assign —</option>
                      {CHANNELS.map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button
                      onClick={() => handleRemove(i)}
                      style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 16 }}
                      title="Remove"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Validation feedback */}
          {duplicates.length > 0 && (
            <div className="alert alert-error" style={{ marginTop: 10, fontSize: 12 }}>
              ✕ Duplicate channel assignments: {duplicates.join(', ')}. Each channel must be assigned once.
            </div>
          )}
          {stems.length === 6 && missingChannels.length > 0 && (
            <div className="alert alert-error" style={{ marginTop: 10, fontSize: 12 }}>
              ✕ Missing channels: {missingChannels.join(', ')}
            </div>
          )}
          {stems.length === 6 && missingChannels.length === 0 && duplicates.length === 0 && (
            <div className="alert alert-ok" style={{ marginTop: 10, fontSize: 12 }}>
              ✓ All 6 channels assigned: {CHANNELS.join(', ')}
            </div>
          )}
          {stems.length === 2 && missingChannels.length === 4 &&
            assignedChannels.includes('L') && assignedChannels.includes('R') && (
            <div className="alert alert-ok" style={{ marginTop: 10, fontSize: 12 }}>
              ✓ Stereo delivery (L + R)
            </div>
          )}
        </>
      )}
    </div>
  );
}
