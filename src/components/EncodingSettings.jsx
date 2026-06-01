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

        {/* Encoding params — read-only from config, with hover help */}
        <div className="form-group">
          <label className="label">Encoding Parameters <span style={{ color: '#666', fontWeight: 400 }}>(from config — hover for help)</span></label>
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
            <span style={{ color: '#ED8B1E', cursor: 'help' }}
              title="libx265 is the H.265 / HEVC encoder. The festival requires HEVC for SkySkan playback compatibility.">
              libx265
            </span>
            {' '}· CRF{' '}
            <span style={{ color: '#F2C200', cursor: 'help' }}
              title={'CRF (Constant Rate Factor) controls quality vs file size. Lower CRF = better quality, larger file. CRF 18 is visually lossless for most content. Range: 0 (lossless) to 51 (worst). DFW spec is CRF ' + (config?.video?.crf ?? 18) + '.'}>
              {config?.video?.crf ?? 18}
            </span>
            {' '}·{' '}
            <span style={{ color: '#4caf6e', cursor: 'help' }}
              title="10-bit color depth means 1024 brightness levels per channel instead of 256 (8-bit). Essential for dome projection where banding on smooth gradients (sky, space) is highly visible on 15m+ screens.">
              10-bit
            </span>{' '}
            <span style={{ cursor: 'help' }}
              title="yuv420p10le is the pixel format: YUV 4:2:0 chroma subsampling, 10 bits per channel, little-endian. The 4:2:0 chroma subsampling is what SkySkan can decode efficiently.">
              yuv420p10le
            </span>
            {' '}· preset{' '}
            <span style={{ color: '#4a9ede', cursor: 'help' }}
              title="Encoder preset controls how hard libx265 works on compression. 'slow' gives ~20% better compression than 'medium' for the same quality. Encode time is worth it for a delivery master.">
              {config?.video?.preset ?? 'slow'}
            </span>
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
