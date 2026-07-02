const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Electron 33+ 에서 드롭/선택된 File의 실제 경로를 얻는다.
  getPathForFile: (file) => webUtils.getPathForFile(file),
  backendStart: () => ipcRenderer.invoke('backend-start'),
  backendHealth: () => ipcRenderer.invoke('backend-health'),
  pickFile: () => ipcRenderer.invoke('pick-file'),
  probe: (p) => ipcRenderer.invoke('probe', p),
  separate: (opts) => ipcRenderer.invoke('separate', opts),
  saveAs: (src, name) => ipcRenderer.invoke('save-as', src, name),
  reveal: (p) => ipcRenderer.invoke('reveal', p),
  toFileUrl: (p) => ipcRenderer.invoke('to-file-url', p),
  notifyDone: (payload) => ipcRenderer.invoke('notify-done', payload),

  onBackendLog: (cb) => ipcRenderer.on('backend-log', (_e, m) => cb(m)),
  onJobProgress: (cb) => ipcRenderer.on('job-progress', (_e, m) => cb(m)),
});
