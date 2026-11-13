const {contextBridge,ipcRenderer}=require('electron');
const call=name=>async input=>{const response=await ipcRenderer.invoke('updates:'+name,input);if(!response.ok)throw new Error(response.error);return response.value;};
contextBridge.exposeInMainWorld('joincraftUpdates',Object.freeze({close:call('close'),confirmInstall:call('confirm-install'),updates:Object.freeze({state:call('state'),check:call('check'),download:call('download'),cancel:call('cancel'),install:call('install')}),onEvent:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('launcher:event',listener);return()=>ipcRenderer.removeListener('launcher:event',listener);}}));

let surfaceCovered=false;
function syncSurfaceCoverage(){if(document.body){document.body.inert=surfaceCovered;document.body.setAttribute('aria-hidden',String(surfaceCovered));}}
ipcRenderer.on('shell:covered',(_event,covered)=>{surfaceCovered=covered===true;syncSurfaceCoverage();});
window.addEventListener('DOMContentLoaded',syncSurfaceCoverage);
