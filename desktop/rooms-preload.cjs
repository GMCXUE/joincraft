const { contextBridge, ipcRenderer } = require('electron');
const authCall=name=>async value=>{const result=await ipcRenderer.invoke('auth:'+name,value);if(!result.ok)throw new Error(result.error);return result.value;};
contextBridge.exposeInMainWorld('blockroomDesktop', { openLibrary: () => ipcRenderer.invoke('rooms:library'), retryRooms: () => ipcRenderer.invoke('rooms:retry'), beginLogin:authCall('start'), loginState:authCall('state'), reopenLogin:authCall('reopen'), cancelLogin:authCall('cancel'), acknowledgeLogin:authCall('acknowledge'), onLoginState:callback=>{const listener=(_event,state)=>callback(state);ipcRenderer.on('auth:changed',listener);return()=>ipcRenderer.removeListener('auth:changed',listener);} });

const notificationCall=name=>async()=>{const response=await ipcRenderer.invoke('notifications:'+name);if(!response.ok)throw new Error(response.error);return response.value;};
contextBridge.exposeInMainWorld('joincraftNotifications',Object.freeze({state:notificationCall('state'),claim:notificationCall('claim'),open:notificationCall('open'),onEvent:callback=>{const listener=()=>callback();ipcRenderer.on('notifications:changed',listener);return()=>ipcRenderer.removeListener('notifications:changed',listener);}}));

let surfaceCovered=false;
function syncSurfaceCoverage(){if(document.body){document.body.inert=surfaceCovered;document.body.setAttribute('aria-hidden',String(surfaceCovered));}}
ipcRenderer.on('shell:covered',(_event,covered)=>{surfaceCovered=covered===true;syncSurfaceCoverage();});
window.addEventListener('DOMContentLoaded',syncSurfaceCoverage);

const packCall=name=>async input=>{const result=await ipcRenderer.invoke('packs:'+name,input);if(!result.ok)throw new Error(result.error);return result.value;};
contextBridge.exposeInMainWorld('joincraftPacks',Object.freeze({transferVersion:2,publish:packCall('publish'),installFromRoom:packCall('install-from-room'),list:packCall('list'),retry:packCall('retry'),choose:packCall('choose'),status:packCall('status'),install:packCall('install'),open:packCall('open'),cancel:packCall('cancel'),progress:packCall('progress'),onEvent:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('packs:event',listener);return()=>ipcRenderer.removeListener('packs:event',listener);}}));
