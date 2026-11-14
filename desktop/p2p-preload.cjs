const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('joincraftTransport',Object.freeze({
 onRequest:callback=>ipcRenderer.on('p2p:request',(_event,value)=>callback(value)),
 reply:value=>ipcRenderer.send('p2p:reply',value),
 event:value=>ipcRenderer.send('p2p:event',value),
}));
