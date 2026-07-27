const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  utils: {
    getPathForFile: (file) => webUtils ? webUtils.getPathForFile(file) : file.path
  },
  import: {
    start: (filePath, config) => ipcRenderer.invoke('import:start', filePath, config),
    preview: (filePath) => ipcRenderer.invoke('import:preview', filePath),
    project: (filePath) => ipcRenderer.invoke('import:project', filePath),
    detectXlsxProject: (filePath) => ipcRenderer.invoke('import:detect-xlsx-project', filePath)
  },
  query: {
    getRows: (table, limit, offset, filters) => ipcRenderer.invoke('query:getRows', table, limit, offset, filters),
    getAggregates: (table) => ipcRenderer.invoke('query:getAggregates', table),
    insertRows: (table, rows) => ipcRenderer.invoke('query:insertRows', table, rows)
  },
  sampling: {
    execute: (config) => ipcRenderer.invoke('sampling:execute', config),
    previewRisk: (config) => ipcRenderer.invoke('sampling:previewRisk', config)
  },
  export: {
    project: (state) => ipcRenderer.invoke('export:project', state)
  },
  license: {
    loadFromDisk: () => ipcRenderer.invoke('license:loadFromDisk')
  },
  on: (channel, callback) => {
    // Whitelist channels to prevent security leaks
    const validChannels = ['import:progress', 'export:progress', 'sampling:progress'];
    if (validChannels.includes(channel)) {
      const subscription = (event, ...args) => callback(...args);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    }
  }
});
