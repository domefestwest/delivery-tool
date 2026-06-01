import React from 'react';
import AudioInput from './AudioInput/AudioInput';

export default function EncodingSettings({
  config, resolution, onResolutionChange,
  outputDir, onOutputDirChange,
  audioMode, onAudioModeChange,
  audioStems, onAudioStemsChange,
  audioInterleaved, onAudioInterleavedChange,
  muxAudio, onMuxAudioChange
}) {
  const resolutions = config?.video?.allowed_resolutions || [];
  const is8k60Warn = resolution?.label === '8K';

  const handleOutputDir = async () => {
    const dir = await window.api.saveFolder({ title: 'Choose Output Folder' });
    if (dir) onOutputDirChange(dir);
  };

  return (
    <div className="card">
      <div className="card-title">Encoding Settings</div>

      <div className="form-row" style={{ marginBottom: 20 }}>
        {/* Resolution */}
        <div className="form-group">
          <label className="label">Target Resolution</label>
          <div className="segment-control">
            {resolutions.map(res => (
              <button
                key={res.label}
                className={`segment-btn ${resolution?.label === res.label ? 'active' : ''}`}
                onClick={() => onResolutionChange(res)}
              >
                {res.label}
                <span style={{ fontWeight: 400, fontSize: 11, opacity: 0.7, marginLeft: 4 }}>
                  {res.width}px
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Encoding params — read-only from config */}
        <div className="form-group">
          <label className="label">Encoding Parameters <span style={{ color: '#666', fontWeight: 400 }}>(from config)</span></label>
          <div style={{
            background: '#1e1e1e',
            border: '1px solid #383838',
            borderRadius: 6,
            padding: '8px 12px',
            fontSize: 12,
            fontFamily: 'monospace',
            color: '#888',
            lineHeight: 1.8
          }}>
            <span style={{ color: '#ED8B1E' }}>libx265</span>
            {' '}· CRF <span style={{ color: '#F2C200' }}>{config?.video?.crf ?? 18}</span>
            {' '}· <span style={{ color: '#4caf6e' }}>10-bit</span> yuv420p10le
            {' '}· preset <span style={{ color: '#4a9ede' }}>{config?.video?.preset ?? 'slow'}</span>
          </div>
        </div>
      </div>

      {/* 8K warning */}
      {is8k60Warn && (
        <div className="alert alert-warn" style={{ marginBottom: 16, fontSize: 12 }}>
          ⚠ <strong>8K encodes</strong> may produce files of 50–100GB and will take several hours on most hardware. This is normal for dome delivery masters.
        </div>
      )}

      {/* Output folder */}
      <div style={{ marginBottom: 20 }}>
        <label className="label">Output Folder <span style={{ color: '#ED8B1E' }}>*</span></label>
        <div className="path-picker">
          <div className={`path-display ${outputDir ? 'has-value' : ''}`}>
            {outputDir || 'No folder selected — delivery package will be created here'}
          </div>
          <button className="btn btn-secondary" onClick={handleOutputDir}>
            Browse…
          </button>
        </div>
        {outputDir && (
          <div style={{ color: '#666', fontSize: 11, marginTop: 5 }}>
            Delivery package will be created at: <code style={{ color: '#888' }}>{outputDir}/&lt;FilmTitle&gt;_DFW{config?.version}/</code>
          </div>
        )}
      </div>

      <hr className="divider" />

      <AudioInput
        config={config}
        audioMode={audioMode}
        onAudioModeChange={onAudioModeChange}
        audioStems={audioStems}
        onAudioStemsChange={onAudioStemsChange}
        audioInterleaved={audioInterleaved}
        onAudioInterleavedChange={onAudioInterleavedChange}
        muxAudio={muxAudio}
        onMuxAudioChange={onMuxAudioChange}
      />
    </div>
  );
}
