const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  import: {
    start: (filePath, config) => ipcRenderer.invoke('import:start', filePath, config),
    preview: (filePath) => ipcRenderer.invoke('import:preview', filePath)
  },
  query: {
    getRows: (table, limit, offset, filters) => ipcRenderer.invoke('query:getRows', table, limit, offset, filters),
    getAggregates: (table) => ipcRenderer.invoke('query:getAggregates', table),
    insertRows: (table, rows) => ipcRenderer.invoke('query:insertRows', table, rows)
  },
  sampling: {
    execute: (config) => ipcRenderer.invoke('sampling:execute', config)
  },
  export: {
    project: (path) => ipcRenderer.invoke('export:project', path),
    excel: (path) => ipcRenderer.invoke('export:excel', path)
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
