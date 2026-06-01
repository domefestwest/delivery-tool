const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Dependency check
  checkDependencies:   () => ipcRenderer.invoke('dep:check'),
  recheckDependencies: () => ipcRenderer.invoke('dep:recheck'),

  // Config
  loadDefaultConfig: () => ipcRenderer.invoke('config:load-default'),
  loadConfigFile:    () => ipcRenderer.invoke('config:load-file'),

  // Dialogs
  openFolder: (opts) => ipcRenderer.invoke('dialog:open-folder', opts),
  openFile:   (opts) => ipcRenderer.invoke('dialog:open-file', opts),
  openFiles:  (opts) => ipcRenderer.invoke('dialog:open-files', opts),
  saveFolder: (opts) => ipcRenderer.invoke('dialog:save-folder', opts),

  // Shell
  openPath:        (p) => ipcRenderer.invoke('shell:open-path', p),
  showInFolder:    (p) => ipcRenderer.invoke('shell:show-in-folder', p),

  // Scanning / probing
  scanPngSequence: (folderPath) => ipcRenderer.invoke('scan:png-sequence', folderPath),
  probeVideo:      (filePath)   => ipcRenderer.invoke('probe:video', filePath),
  probeAudio:      (filePath)   => ipcRenderer.invoke('probe:audio', filePath),

  // Source auto-detection (for drop zone)
  detectSource:    (path)       => ipcRenderer.invoke('source:detect', path),

  // Preview thumbnail
  generatePreview: (opts)       => ipcRenderer.invoke('preview:generate', opts),

  // Pre-flight
  checkDiskSpace:  (opts) => ipcRenderer.invoke('preflight:disk-space', opts),

  // Post-encode validation
  verifyOutput:    (opts) => ipcRenderer.invoke('verify:output', opts),
  analyzeLoudness: (opts) => ipcRenderer.invoke('analyze:loudness', opts),

  // Delivery extras
  zipDelivery:     (deliveryFolder) => ipcRenderer.invoke('zip:delivery', deliveryFolder),

  // Settings store
  readSettings:    ()       => ipcRenderer.invoke('settings:read'),
  updateSettings:  (partial) => ipcRenderer.invoke('settings:update', partial),
  addRecentEncode: (entry)   => ipcRenderer.invoke('settings:recent-add', entry),

  // Notifications
  notify:          (opts) => ipcRenderer.invoke('notify:encode-complete', opts),

  // Debug log export
  saveDebugLog:    (opts) => ipcRenderer.invoke('debug:save-log', opts),

  // Project save/load
  saveProject:     (state) => ipcRenderer.invoke('project:save', state),
  openProject:     ()      => ipcRenderer.invoke('project:open'),

  // Encode
  startEncode:    (params) => ipcRenderer.invoke('encode:start', params),
  cancelEncode:   ()       => ipcRenderer.invoke('encode:cancel'),
  testEncode:     (params) => ipcRenderer.invoke('encode:test', params),

  // Encode events
  onEncodeProgress: (cb) => {
    const listener = (_, data) => cb(data);
    ipcRenderer.on('encode:progress', listener);
    return () => ipcRenderer.removeListener('encode:progress', listener);
  },
  onEncodeLog: (cb) => {
    const listener = (_, data) => cb(data);
    ipcRenderer.on('encode:log', listener);
    return () => ipcRenderer.removeListener('encode:log', listener);
  },
  onEncodeEncoder: (cb) => {
    const listener = (_, data) => cb(data);
    ipcRenderer.on('encode:encoder', listener);
    return () => ipcRenderer.removeListener('encode:encoder', listener);
  },

  // Drag-and-drop helper: get the absolute path of a dropped File object.
  // webUtils.getPathForFile() is the supported way in Electron 28+
  // (File.path was deprecated in 32).
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch (_) { return null; }
  },
});
