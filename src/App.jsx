import React, { useState, useEffect, useCallback, useRef } from 'react';
import OnboardingScreen from './components/OnboardingScreen';
import FestivalHeader from './components/FestivalHeader';
import SourcePreview from './components/SourcePreview';
import SettingsPanel from './components/SettingsPanel';
import EncodeAction from './components/EncodeAction';
import VerifyDeliveryPanel from './components/VerifyDeliveryPanel';
import './App.css';

export default function App() {
  const [depStatus, setDepStatus] = useState(null);
  const [config, setConfig]       = useState(null);
  const [settings, setSettings]   = useState(null);

  const [filmTitle, setFilmTitle]     = useState('');
  const [artistName, setArtistName]   = useState('');

  const [sourceType, setSourceType] = useState('png');
  const [pngData, setPngData]       = useState(null);
  const [pngFolder, setPngFolder]   = useState(null);
  const [pngFrameRate, setPngFrameRate] = useState(null);
  const [videoData, setVideoData]   = useState(null);
  const [videoPath, setVideoPath]   = useState(null);
  const [videoFrameRate, setVideoFrameRate] = useState(null);
  const [frameRateWarning, setFrameRateWarning] = useState(null);

  // Multi-resolution support: artists can select 1 or more of 4K/6K/8K.
  // Each selected resolution is encoded into its own delivery folder in sequence.
  const [selectedResolutions, setSelectedResolutions] = useState([]);
  const [outputDir, setOutputDir]   = useState(null);
  const [useGPU, setUseGPU]         = useState(true);

  // Mode: 'master' (default) or 'screener' (experimental — for jury review files)
  const [mode, setMode] = useState('master');

  // Screener watermark state
  const [watermarkType, setWatermarkType]     = useState('none'); // 'none' | 'text' | 'image'
  const [watermarkText, setWatermarkText]     = useState('SCREENER · NOT FOR DISTRIBUTION');
  const [watermarkImage, setWatermarkImage]   = useState(null);
  const [watermarkMoving, setWatermarkMoving] = useState(false);
  const [watermarkPosition, setWatermarkPosition] = useState('center');

  const [audioMode, setAudioMode]   = useState('none');
  const [audioStems, setAudioStems] = useState([]);
  const [audioInterleaved, setAudioInterleaved] = useState(null);
  const [muxAudio, setMuxAudio]     = useState(false);

  const [autoZip, setAutoZip]                   = useState(false);
  const [notifyOnComplete, setNotifyOnComplete] = useState(true);
  const [autoOpenFolder, setAutoOpenFolder]     = useState(true);
  const [preventSleep, setPreventSleep]         = useState(true);

  // Festival Verify Mode — toggled from the View menu (View → Festival Tools).
  // Hidden expert feature for festival coordinators; filmmakers never enable it.
  const [verifyMode, setVerifyMode] = useState(false);

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

      if (sett) {
        if (sett.artistName) setArtistName(sett.artistName);
        if (sett.lastOutputDir) setOutputDir(sett.lastOutputDir);
        if (typeof sett.preferGPU === 'boolean') setUseGPU(sett.preferGPU);
        if (typeof sett.autoZip === 'boolean') setAutoZip(sett.autoZip);
        if (typeof sett.notifyOnComplete === 'boolean') setNotifyOnComplete(sett.notifyOnComplete);
        if (typeof sett.autoOpenFolderOnComplete === 'boolean') setAutoOpenFolder(sett.autoOpenFolderOnComplete);
        if (typeof sett.preventSleepDuringEncode === 'boolean') setPreventSleep(sett.preventSleepDuringEncode);
        if (typeof sett.festivalVerifyEnabled === 'boolean') setVerifyMode(sett.festivalVerifyEnabled);
      }

      if (cfg?.video?.allowed_resolutions?.length) {
        setSelectedResolutions([cfg.video.allowed_resolutions[0]]);
      }
      settingsHydrated.current = true;
    })();
  }, []);

  // Persist settings whenever toggles change
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

  // Listen for menu-driven toggles of Festival Verify Mode
  useEffect(() => {
    if (!window.api?.onVerifyModeChanged) return;
    const off = window.api.onVerifyModeChanged(({ enabled }) => setVerifyMode(!!enabled));
    return off;
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
      setSelectedResolutions([cfg.video.allowed_resolutions[0]]);
    }
    return cfg;
  }, []);

  // Switching to a bundled preset — same state-reset as loading a custom file
  const handlePresetChange = useCallback((cfg) => {
    if (cfg && !cfg.error) {
      setConfig(cfg);
      setSelectedResolutions([cfg.video.allowed_resolutions[0]]);
    }
  }, []);

  const handleReplayRecent = useCallback((entry) => {
    if (!entry) return;
    setFilmTitle(entry.filmTitle || '');
    if (entry.artistName) setArtistName(entry.artistName);
    if (config?.video?.allowed_resolutions) {
      const r = config.video.allowed_resolutions.find(x => x.label === entry.resolution);
      if (r) setSelectedResolutions([r]);
    }
  }, [config]);

  // ─── Project save / load ───────────────────────────────────────────────────
  const handleSaveProject = useCallback(async () => {
    const r = await window.api.saveProject({
      filmTitle, artistName, sourceType,
      pngFolder, pngFrameRate,
      videoPath, videoFrameRate,
      selectedResolutions, outputDir,
      useGPU,
      audioMode, audioStems, audioInterleaved, muxAudio,
    });
    if (r?.error) {
      alert('Could not save project: ' + r.error);
    }
    return r;
  }, [filmTitle, artistName, sourceType, pngFolder, pngFrameRate,
      videoPath, videoFrameRate, selectedResolutions, outputDir,
      useGPU, audioMode, audioStems, audioInterleaved, muxAudio]);

  const handleOpenProject = useCallback(async () => {
    const r = await window.api.openProject();
    if (r?.canceled) return;
    if (r?.error) {
      alert('Could not load project: ' + r.error);
      return;
    }
    if (!r.state) return;
    const s = r.state;

    setFilmTitle(s.filmTitle || '');
    setArtistName(s.artistName || '');

    if (s.source?.type === 'video') {
      setSourceType('video');
      setVideoPath(s.source.path || null);
      setVideoFrameRate(s.source.frameRate || null);
      // Re-probe to populate videoData
      if (s.source.path) {
        const probe = await window.api.probeVideo(s.source.path);
        if (!probe.error) setVideoData(probe);
      }
    } else if (s.source?.type === 'png') {
      setSourceType('png');
      setPngFolder(s.source.path || null);
      setPngFrameRate(s.source.frameRate || null);
      if (s.source.path) {
        const scan = await window.api.scanPngSequence(s.source.path);
        if (!scan.error) setPngData(scan);
      }
    }

    if (s.encode?.outputDir) setOutputDir(s.encode.outputDir);
    if (typeof s.encode?.useGPU === 'boolean') setUseGPU(s.encode.useGPU);
    if (s.encode?.resolutions && config?.video?.allowed_resolutions) {
      const resolved = s.encode.resolutions
        .map(label => config.video.allowed_resolutions.find(r => r.label === label))
        .filter(Boolean);
      if (resolved.length) setSelectedResolutions(resolved);
    }

    if (s.audio?.mode) setAudioMode(s.audio.mode);
    if (s.audio?.stems) setAudioStems(s.audio.stems);
    if (s.audio?.interleavedPath) setAudioInterleaved(s.audio.interleavedPath);
    if (typeof s.audio?.muxAudio === 'boolean') setMuxAudio(s.audio.muxAudio);

    if (r.missingPaths?.length) {
      alert(`Project loaded with ${r.missingPaths.length} missing file(s). Re-pick them before encoding:\n\n` +
        r.missingPaths.map(p => `• ${p.field}: ${p.path}`).join('\n'));
    }
  }, [config]);

  // ─── Keyboard shortcuts ────────────────────────────────────────────────────
  // ⌘S / Ctrl+S → Save project · ⌘O / Ctrl+O → Open project
  // (⌘E / ⌘T are handled inside EncodeAction where it owns the encode state)
  // Declared AFTER handleSaveProject/handleOpenProject to avoid TDZ.
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const tag = (e.target.tagName || '').toLowerCase();
      const inEditable = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
      if (inEditable) return;
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); handleSaveProject(); }
      else if (k === 'o') { e.preventDefault(); handleOpenProject(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handleSaveProject, handleOpenProject]);

  const effectiveFps = sourceType === 'png' ? pngFrameRate : videoFrameRate;
  const effectiveSource = sourceType === 'png' ? pngData : videoData;

  // Source dimensions — used for resolution governance (no upscaling allowed)
  const sourceWidth  = sourceType === 'png' ? pngData?.width  : videoData?.width;
  const sourceHeight = sourceType === 'png' ? pngData?.height : videoData?.height;

  // Filter user's selected resolutions to drop any that would now require upscaling.
  // This auto-corrects when the source changes (e.g., they swap in a smaller file).
  useEffect(() => {
    if (!sourceWidth || !sourceHeight || !selectedResolutions.length) return;
    const filtered = selectedResolutions.filter(r =>
      r.width <= sourceWidth && r.height <= sourceHeight
    );
    if (filtered.length !== selectedResolutions.length) {
      // If all were filtered out, fall back to the largest allowed resolution that fits
      if (filtered.length === 0 && config?.video?.allowed_resolutions) {
        const compatible = config.video.allowed_resolutions
          .filter(r => r.width <= sourceWidth && r.height <= sourceHeight);
        setSelectedResolutions(compatible.length ? [compatible[compatible.length - 1]] : []);
      } else {
        setSelectedResolutions(filtered);
      }
    }
  // Intentional: re-filter when source dimensions change or festival config changes.
  // selectedResolutions intentionally NOT in deps to prevent infinite loop.
  }, [sourceWidth, sourceHeight, config]);

  const encodeReady = !!(
    filmTitle.trim() && effectiveSource &&
    selectedResolutions.length > 0 &&
    effectiveFps && outputDir && depStatus?.has10BitX265
  );

  if (depStatus === null) {
    return (
      <div className="boot-loader">
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
        onPresetChange={handlePresetChange}
        verifyMode={verifyMode}
      />

      {verifyMode ? (
        <div className="app-scroll">
          <VerifyDeliveryPanel />
        </div>
      ) : (
      <div className="app-scroll">
        {/* Two-column main area */}
        <div className="two-col">
          <SourcePreview
            config={config}
            sourceType={sourceType}
            onSourceTypeChange={setSourceType}
            pngFolder={pngFolder} pngData={pngData} pngFrameRate={pngFrameRate}
            onPngFolderChange={setPngFolder}
            onPngDataChange={setPngData}
            onPngFrameRateChange={setPngFrameRate}
            videoPath={videoPath} videoData={videoData} videoFrameRate={videoFrameRate}
            onVideoPathChange={setVideoPath}
            onVideoDataChange={setVideoData}
            onVideoFrameRateChange={setVideoFrameRate}
            onFrameRateWarning={setFrameRateWarning}
            frameRateWarning={frameRateWarning}
            onOpenProject={handleOpenProject}
          />

          <SettingsPanel
            config={config}
            filmTitle={filmTitle} artistName={artistName}
            onTitleChange={setFilmTitle} onArtistChange={setArtistName}
            recentEncodes={settings?.recentEncodes || []}
            onReplayRecent={handleReplayRecent}
            onSaveProject={handleSaveProject}
            onOpenProject={handleOpenProject}
            mode={mode} onModeChange={setMode}
            watermarkType={watermarkType} onWatermarkTypeChange={setWatermarkType}
            watermarkText={watermarkText} onWatermarkTextChange={setWatermarkText}
            watermarkImage={watermarkImage} onWatermarkImageChange={setWatermarkImage}
            watermarkMoving={watermarkMoving} onWatermarkMovingChange={setWatermarkMoving}
            watermarkPosition={watermarkPosition} onWatermarkPositionChange={setWatermarkPosition}
            selectedResolutions={selectedResolutions}
            onSelectedResolutionsChange={setSelectedResolutions}
            sourceWidth={sourceWidth} sourceHeight={sourceHeight}
            outputDir={outputDir} onOutputDirChange={setOutputDir}
            audioMode={audioMode} onAudioModeChange={setAudioMode}
            audioStems={audioStems} onAudioStemsChange={setAudioStems}
            audioInterleaved={audioInterleaved}
            onAudioInterleavedChange={setAudioInterleaved}
            muxAudio={muxAudio} onMuxAudioChange={setMuxAudio}
            depStatus={depStatus}
            useGPU={useGPU} onUseGPUChange={setUseGPU}
            autoZip={autoZip} onAutoZipChange={setAutoZip}
            notifyOnComplete={notifyOnComplete}
            onNotifyOnCompleteChange={setNotifyOnComplete}
            autoOpenFolder={autoOpenFolder}
            onAutoOpenFolderChange={setAutoOpenFolder}
            preventSleep={preventSleep}
            onPreventSleepChange={setPreventSleep}
          />
        </div>

        {/* Bottom action area (full width) */}
        <EncodeAction
          config={config}
          filmTitle={filmTitle} artistName={artistName}
          sourceType={sourceType}
          pngData={pngData} pngFolder={pngFolder} pngFrameRate={pngFrameRate}
          videoPath={videoPath} videoData={videoData} videoFrameRate={videoFrameRate}
          mode={mode}
          watermark={{
            type: watermarkType,
            text: watermarkText,
            imagePath: watermarkImage,
            moving: watermarkMoving,
            position: watermarkPosition,
            opacity: 0.3,
          }}
          selectedResolutions={selectedResolutions} outputDir={outputDir}
          audioMode={audioMode} audioStems={audioStems}
          audioInterleaved={audioInterleaved} muxAudio={muxAudio}
          frameRateWarning={frameRateWarning}
          encodeReady={encodeReady}
          depStatus={depStatus} useGPU={useGPU}
          autoZip={autoZip} notifyOnComplete={notifyOnComplete}
          autoOpenFolder={autoOpenFolder} preventSleep={preventSleep}
        />
      </div>
      )}
    </div>
  );
}
