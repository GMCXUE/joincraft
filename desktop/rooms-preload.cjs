const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('blockroomDesktop', { openLibrary: () => ipcRenderer.invoke('rooms:library') });
