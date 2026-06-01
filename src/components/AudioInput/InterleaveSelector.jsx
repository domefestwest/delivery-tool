import React, { useState } from 'react';

export default function InterleaveSelector({ filePath, onFilePathChange }) {
  const [probeData, setProbeData] = useState(null);
  const [probing, setProbing] = useState(false);

  const handleSelectFile = async () => {
    const file = await window.api.openFile({
      title: 'Select Interleaved Audio File',
      filters: [{ name: 'WAV Audio', extensions: ['wav'] }]
    });
    if (!file) return;
    onFilePathChange(file);
    setProbeData(null);
    setProbing(true);
    const result = await window.api.probeAudio(file);
    setProbing(false);
    setProbeData(result);
  };

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <label className="label">Interleaved Audio File (WAV)</label>
        <div className="path-picker">
          <div className={`path-display ${filePath ? 'has-value' : ''}`}>
            {filePath ? filePath.split('/').pop().split('\\').pop() : 'No file selected'}
          </div>
          <button className="btn btn-secondary" onClick={handleSelectFile}>Browse…</button>
        </div>
      </div>

      {probing && (
        <div className="alert alert-info" style={{ fontSize: 13 }}>🔍 Analyzing audio file…</div>
      )}

      {probeData?.error && (
        <div className="alert alert-error" style={{ fontSize: 13 }}>✕ {probeData.error}</div>
      )}

      {probeData && !probeData.error && (
        <>
          {probeData.isAmbisonic ? (
            <div className="alert alert-error" style={{ fontSize: 13 }}>
              ✕ Ambisonic audio is not supported by Fiske's playback system. Please provide a 5.1 or stereo mix instead.
            </div>
          ) : probeData.channels === 6 ? (
            <div className="alert alert-ok" style={{ fontSize: 13 }}>
              ✓ 6-channel 5.1 detected ({probeData.sampleRate / 1000}kHz) — will be split into individual stems for delivery.
            </div>
          ) : probeData.channels === 2 ? (
            <div className="alert alert-ok" style={{ fontSize: 13 }}>
              ✓ Stereo detected ({probeData.sampleRate / 1000}kHz) — accepted as stereo delivery.
            </div>
          ) : (
            <div className="alert alert-warn" style={{ fontSize: 13 }}>
              ⚠ {probeData.channels}-channel audio detected. DFW accepts 5.1 (6 channels) or stereo (2 channels).
            </div>
          )}
        </>
      )}
    </div>
  );
}
