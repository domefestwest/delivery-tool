import React, { useState, useEffect, useCallback } from 'react';
import OnboardingScreen from './components/OnboardingScreen';
import FestivalHeader from './components/FestivalHeader';
import FilmInfo from './components/FilmInfo';
import SourceInput from './components/SourceInput/SourceInput';
import EncodingSettings from './components/EncodingSettings';
import EncodePanel from './components/EncodePanel';
import './App.css';

export default function App() {
  const [depStatus, setDepStatus] = useState(null); // null = checking
  const [config, setConfig] = useState(null);

  // Film state
  const [filmTitle, setFilmTitle] = useState('');
  const [artistName, setArtistName] = useState('');

  // Source state
  const [sourceType, setSourceType] = useState('png'); // 'png' | 'video'
  const [pngData, setPngData] = useState(null);       // result of scanPngSequence
  const [pngFolder, setPngFolder] = useState(null);
  const [pngFrameRate, setPngFrameRate] = useState(null);
  const [videoData, setVideoData] = useState(null);   // result of probeVideo
  const [videoPath, setVideoPath] = useState(null);
  const [videoFrameRate, setVideoFrameRate] = useState(null);
  const [frameRateWarning, setFrameRateWarning] = useState(null);

  // Encoding settings
  const [resolution, setResolution] = useState(null);
  const [outputDir, setOutputDir] = useState(null);
  const [useGPU, setUseGPU] = useState(true); // default: prefer GPU if available

  // Audio state
  const [audioMode, setAudioMode] = useState('none'); // 'stems' | 'interleaved' | 'none'
  const [audioStems, setAudioStems] = useState([]);
  const [audioInterleaved, setAudioInterleaved] = useState(null);
  const [muxAudio, setMuxAudio] = useState(false);

  // Run dep check + load config on mount
  useEffect(() => {
    (async () => {
      const [dep, cfg] = await Promise.all([
        window.api.checkDependencies(),
        window.api.loadDefaultConfig()
      ]);
      setDepStatus(dep);
      setConfig(cfg);
      if (cfg?.video?.allowed_resolutions?.length) {
        setResolution(cfg.video.allowed_resolutions[0]);
      }
    })();
  }, []);

  const handleRecheck = useCallback(async () => {
    setDepStatus(null);
    const dep = await window.api.recheckDependencies();
    setDepStatus(dep);
  }, []);

  const handleLoadConfig = useCallback(async () => {
    const cfg = await window.api.loadConfigFile();
    if (cfg && !cfg.error) {
      setConfig(cfg);
      setResolution(cfg.video.allowed_resolutions[0]);
    }
    return cfg;
  }, []);

  // Determine if encode is ready
  const effectiveFps = sourceType === 'png' ? pngFrameRate : videoFrameRate;
  const effectiveSource = sourceType === 'png' ? pngData : videoData;
  const encodeReady = !!(
    filmTitle.trim() &&
    effectiveSource &&
    resolution &&
    effectiveFps &&
    outputDir &&
    depStatus?.has10BitX265
  );

  // Loading screen
  if (depStatus === null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#1a1a1a' }}>
        <div style={{ textAlign: 'center', color: '#888' }}>
          <div style={{ fontSize: 28, marginBottom: 12 }}>🎬</div>
          <div>Checking dependencies…</div>
        </div>
      </div>
    );
  }

  // Onboarding screen if FFmpeg not available
  if (!depStatus.found || !depStatus.has10BitX265) {
    return <OnboardingScreen depStatus={depStatus} onRecheck={handleRecheck} />;
  }

  return (
    <div className="app-container">
      <FestivalHeader
        config={config}
        depStatus={depStatus}
        onLoadConfig={handleLoadConfig}
      />

      <div className="app-scroll">
        <FilmInfo
          filmTitle={filmTitle}
          artistName={artistName}
          onTitleChange={setFilmTitle}
          onArtistChange={setArtistName}
        />

        <SourceInput
          config={config}
          sourceType={sourceType}
          onSourceTypeChange={setSourceType}
          pngFolder={pngFolder}
          pngData={pngData}
          pngFrameRate={pngFrameRate}
          onPngFolderChange={setPngFolder}
          onPngDataChange={setPngData}
          onPngFrameRateChange={setPngFrameRate}
          videoPath={videoPath}
          videoData={videoData}
          videoFrameRate={videoFrameRate}
          onVideoPathChange={setVideoPath}
          onVideoDataChange={setVideoData}
          onVideoFrameRateChange={setVideoFrameRate}
          onFrameRateWarning={setFrameRateWarning}
          frameRateWarning={frameRateWarning}
        />

        <EncodingSettings
          config={config}
          resolution={resolution}
          onResolutionChange={setResolution}
          outputDir={outputDir}
          onOutputDirChange={setOutputDir}
          audioMode={audioMode}
          onAudioModeChange={setAudioMode}
          audioStems={audioStems}
          onAudioStemsChange={setAudioStems}
          audioInterleaved={audioInterleaved}
          onAudioInterleavedChange={setAudioInterleaved}
          muxAudio={muxAudio}
          onMuxAudioChange={setMuxAudio}
        />

        <EncodePanel
          config={config}
          filmTitle={filmTitle}
          artistName={artistName}
          sourceType={sourceType}
          pngData={pngData}
          pngFolder={pngFolder}
          pngFrameRate={pngFrameRate}
          videoPath={videoPath}
          videoData={videoData}
          videoFrameRate={videoFrameRate}
          resolution={resolution}
          outputDir={outputDir}
          audioMode={audioMode}
          audioStems={audioStems}
          audioInterleaved={audioInterleaved}
          muxAudio={muxAudio}
          frameRateWarning={frameRateWarning}
          encodeReady={encodeReady}
          depStatus={depStatus}
          useGPU={useGPU}
          onUseGPUChange={setUseGPU}
        />
      </div>
    </div>
  );
}
