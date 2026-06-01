const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Dependency check
  checkDependencies: () => ipcRenderer.invoke('dep:check'),
  recheckDependencies: () => ipcRenderer.invoke('dep:recheck'),

  // Config
  loadDefaultConfig: () => ipcRenderer.invoke('config:load-default'),
  loadConfigFile: () => ipcRenderer.invoke('config:load-file'),

  // Dialogs
  openFolder: (opts) => ipcRenderer.invoke('dialog:open-folder', opts),
  openFile: (opts) => ipcRenderer.invoke('dialog:open-file', opts),
  openFiles: (opts) => ipcRenderer.invoke('dialog:open-files', opts),
  saveFolder: (opts) => ipcRenderer.invoke('dialog:save-folder', opts),

  // Shell
  openPath: (p) => ipcRenderer.invoke('shell:open-path', p),

  // Scanning / probing
  scanPngSequence: (folderPath) => ipcRenderer.invoke('scan:png-sequence', folderPath),
  probeVideo: (filePath) => ipcRenderer.invoke('probe:video', filePath),
  probeAudio: (filePath) => ipcRenderer.invoke('probe:audio', filePath),

  // Encode
  startEncode: (params) => ipcRenderer.invoke('encode:start', params),
  cancelEncode: () => ipcRenderer.invoke('encode:cancel'),

  // Encode progress events
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
  }
});
