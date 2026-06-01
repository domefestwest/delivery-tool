import React from 'react';
import PNGSequenceTab from './PNGSequenceTab';
import VideoFileTab from './VideoFileTab';

export default function SourceInput({
  config,
  sourceType, onSourceTypeChange,
  pngFolder, pngData, pngFrameRate,
  onPngFolderChange, onPngDataChange, onPngFrameRateChange,
  videoPath, videoData, videoFrameRate,
  onVideoPathChange, onVideoDataChange, onVideoFrameRateChange,
  onFrameRateWarning, frameRateWarning
}) {
  return (
    <div className="card">
      <div className="card-title">Source Input</div>

      <div className="tabs">
        <button
          className={`tab ${sourceType === 'png' ? 'active' : ''}`}
          onClick={() => onSourceTypeChange('png')}
        >
          PNG Sequence
        </button>
        <button
          className={`tab ${sourceType === 'video' ? 'active' : ''}`}
          onClick={() => onSourceTypeChange('video')}
        >
          Video File (.mp4 / .mov)
        </button>
      </div>

      {sourceType === 'png' ? (
        <PNGSequenceTab
          config={config}
          folder={pngFolder}
          data={pngData}
          frameRate={pngFrameRate}
          onFolderChange={onPngFolderChange}
          onDataChange={onPngDataChange}
          onFrameRateChange={onPngFrameRateChange}
        />
      ) : (
        <VideoFileTab
          config={config}
          filePath={videoPath}
          data={videoData}
          frameRate={videoFrameRate}
          frameRateWarning={frameRateWarning}
          onFilePathChange={onVideoPathChange}
          onDataChange={onVideoDataChange}
          onFrameRateChange={onVideoFrameRateChange}
          onFrameRateWarning={onFrameRateWarning}
        />
      )}
    </div>
  );
}
