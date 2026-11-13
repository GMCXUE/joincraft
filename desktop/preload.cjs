const { contextBridge, ipcRenderer } = require('electron');
const call = name => async input => {
  const response = await ipcRenderer.invoke(`launcher:${name}`, input);
  if (!response.ok) throw new Error(response.error);
  return response.value;
};
contextBridge.exposeInMainWorld('blockroomLauncher', {
  state: call('state'), memory:call('memory'), pickDirectory: call('pick-directory'), pickJava: call('pick-java'),
  scanJava:call('scan-java'), selectJava:call('select-java'),
  check: call('check'), start: call('start'), login: call('login'), logout: call('logout'),
  microsoftPage: call('microsoft-page'), rooms: call('rooms'),
  onEvent: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('launcher:event', listener); return () => ipcRenderer.removeListener('launcher:event', listener); }
});

const notificationCall=name=>async()=>{const response=await ipcRenderer.invoke('notifications:'+name);if(!response.ok)throw new Error(response.error);return response.value;};
contextBridge.exposeInMainWorld('joincraftNotifications',Object.freeze({state:notificationCall('state'),claim:notificationCall('claim'),open:notificationCall('open'),onEvent:callback=>{const listener=()=>callback();ipcRenderer.on('notifications:changed',listener);return()=>ipcRenderer.removeListener('notifications:changed',listener);}}));

let surfaceCovered=false;
function syncSurfaceCoverage(){if(document.body){document.body.inert=surfaceCovered;document.body.setAttribute('aria-hidden',String(surfaceCovered));}}
ipcRenderer.on('shell:covered',(_event,covered)=>{surfaceCovered=covered===true;syncSurfaceCoverage();});
window.addEventListener('DOMContentLoaded',syncSurfaceCoverage);
