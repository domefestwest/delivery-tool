import React from 'react';
import StemSelector from './StemSelector';
import InterleaveSelector from './InterleaveSelector';

export default function AudioInput({
  config, audioMode, onAudioModeChange,
  audioStems, onAudioStemsChange,
  audioInterleaved, onAudioInterleavedChange,
  muxAudio, onMuxAudioChange
}) {
  const muxAvailable = config?.audio?.mux_option_available !== false;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>Audio</div>
        <div style={{ fontSize: 12, color: '#666' }}>
          5.1 surround preferred · 44.1 kHz · separate stems required
        </div>
      </div>

      {/* Mode selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[
          { id: 'stems', label: '6 Individual Stems' },
          { id: 'interleaved', label: 'Single 5.1 WAV' },
          { id: 'none', label: 'No Audio' }
        ].map(m => (
          <button
            key={m.id}
            onClick={() => onAudioModeChange(m.id)}
            style={{
              background: audioMode === m.id ? 'rgba(237,139,30,0.15)' : '#242424',
              border: `1px solid ${audioMode === m.id ? '#ED8B1E' : '#404040'}`,
              borderRadius: 6,
              color: audioMode === m.id ? '#ED8B1E' : '#888',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              padding: '8px 16px',
              transition: 'all 0.15s'
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Mode content */}
      {audioMode === 'stems' && (
        <StemSelector stems={audioStems} onStemsChange={onAudioStemsChange} />
      )}

      {audioMode === 'interleaved' && (
        <InterleaveSelector
          filePath={audioInterleaved}
          onFilePathChange={onAudioInterleavedChange}
        />
      )}

      {audioMode === 'none' && (
        <div className="alert alert-info" style={{ fontSize: 13 }}>
          No audio will be included in the delivery package. A README will be placed in the audio/ folder.
        </div>
      )}

      {/* MUX option */}
      {muxAvailable && audioMode !== 'none' && (
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{
            display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: '#999'
          }}>
            <input
              type="checkbox"
              checked={muxAudio}
              onChange={e => onMuxAudioChange(e.target.checked)}
              style={{ accentColor: '#ED8B1E', width: 15, height: 15 }}
            />
            <span>
              Also embed audio in video file{' '}
              <span style={{ color: '#666', fontSize: 12 }}>
                (optional — creates a self-contained reference copy alongside stems)
              </span>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}
