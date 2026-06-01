import React, { useState, useEffect, useCallback, useRef } from 'react';
import OnboardingScreen from './components/OnboardingScreen';
import FestivalHeader from './components/FestivalHeader';
import FilmInfo from './components/FilmInfo';
import SourceInput from './components/SourceInput/SourceInput';
import EncodingSettings from './components/EncodingSettings';
import EncodePanel from './components/EncodePanel';
import './App.css';

export default function App() {
  const [depStatus, setDepStatus] = useState(null);
  const [config, setConfig] = useState(null);
  const [settings, setSettings] = useState(null);  // persisted user settings

  const [filmTitle, setFilmTitle]   = useState('');
  const [artistName, setArtistName] = useState('');

  const [sourceType, setSourceType] = useState('png');
  const [pngData, setPngData]       = useState(null);
  const [pngFolder, setPngFolder]   = useState(null);
  const [pngFrameRate, setPngFrameRate] = useState(null);
  const [videoData, setVideoData]   = useState(null);
  const [videoPath, setVideoPath]   = useState(null);
  const [videoFrameRate, setVideoFrameRate] = useState(null);
  const [frameRateWarning, setFrameRateWarning] = useState(null);

  const [resolution, setResolution] = useState(null);
  const [outputDir, setOutputDir]   = useState(null);
  const [useGPU, setUseGPU]         = useState(true);

  const [audioMode, setAudioMode]   = useState('none');
  const [audioStems, setAudioStems] = useState([]);
  const [audioInterleaved, setAudioInterleaved] = useState(null);
  const [muxAudio, setMuxAudio]     = useState(false);

  // Settings toggles
  const [autoZip, setAutoZip] = useState(false);
  const [notifyOnComplete, setNotifyOnComplete] = useState(true);
  const [autoOpenFolder, setAutoOpenFolder]     = useState(true);
  const [preventSleep, setPreventSleep]         = useState(true);

  // Settled flag — only persist AFTER initial settings load
  const settingsHydrated = useRef(false);

  // Initial bootstrap
  useEffect(() => {
    (async () => {
      const [dep, cfg, sett] = await Promise.all([
        window.api.checkDependencies(),
        window.api.loadDefaultConfig(),
        window.api.readSettings(),
      ]);
      setDepStatus(dep);
      setConfig(cfg);
      setSettings(sett);

      // Hydrate from persisted settings
      if (sett) {
        if (sett.artistName) setArtistName(sett.artistName);
        if (sett.lastOutputDir) setOutputDir(sett.lastOutputDir);
        if (typeof sett.preferGPU === 'boolean') setUseGPU(sett.preferGPU);
        if (typeof sett.autoZip === 'boolean') setAutoZip(sett.autoZip);
        if (typeof sett.notifyOnComplete === 'boolean') setNotifyOnComplete(sett.notifyOnComplete);
        if (typeof sett.autoOpenFolderOnComplete === 'boolean') setAutoOpenFolder(sett.autoOpenFolderOnComplete);
        if (typeof sett.preventSleepDuringEncode === 'boolean') setPreventSleep(sett.preventSleepDuringEncode);
      }

      if (cfg?.video?.allowed_resolutions?.length) {
        setResolution(cfg.video.allowed_resolutions[0]);
      }
      settingsHydrated.current = true;
    })();
  }, []);

  // Persist settings whenever they change (debounced via microtask)
  useEffect(() => {
    if (!settingsHydrated.current) return;
    window.api.updateSettings({
      artistName,
      lastOutputDir: outputDir || '',
      preferGPU: useGPU,
      autoZip, notifyOnComplete,
      autoOpenFolderOnComplete: autoOpenFolder,
      preventSleepDuringEncode: preventSleep,
    });
  }, [artistName, outputDir, useGPU, autoZip, notifyOnComplete, autoOpenFolder, preventSleep]);

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

  // Recent-encode replay
  const handleReplayRecent = useCallback((entry) => {
    if (!entry) return;
    setFilmTitle(entry.filmTitle || '');
    if (entry.artistName) setArtistName(entry.artistName);
    if (config?.video?.allowed_resolutions) {
      const r = config.video.allowed_resolutions.find(x => x.label === entry.resolution);
      if (r) setResolution(r);
    }
  }, [config]);

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
          recentEncodes={settings?.recentEncodes || []}
          onReplayRecent={handleReplayRecent}
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
          autoZip={autoZip}
          onAutoZipChange={setAutoZip}
          notifyOnComplete={notifyOnComplete}
          onNotifyOnCompleteChange={setNotifyOnComplete}
          autoOpenFolder={autoOpenFolder}
          onAutoOpenFolderChange={setAutoOpenFolder}
          preventSleep={preventSleep}
          onPreventSleepChange={setPreventSleep}
        />
      </div>
    </div>
  );
}
