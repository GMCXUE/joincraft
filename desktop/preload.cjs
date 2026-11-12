const { contextBridge, ipcRenderer } = require('electron');
const call = name => async input => {
  const response = await ipcRenderer.invoke(`launcher:${name}`, input);
  if (!response.ok) throw new Error(response.error);
  return response.value;
};
contextBridge.exposeInMainWorld('blockroomLauncher', {
  state: call('state'), pickDirectory: call('pick-directory'), pickJava: call('pick-java'),
  check: call('check'), start: call('start'), login: call('login'), logout: call('logout'),
  microsoftPage: call('microsoft-page'), rooms: call('rooms'),
  onEvent: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('launcher:event', listener); return () => ipcRenderer.removeListener('launcher:event', listener); }
});
