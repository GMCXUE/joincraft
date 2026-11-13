import { app, BrowserWindow, WebContentsView, dialog, ipcMain, shell, systemPreferences } from 'electron';
import electronUpdater from 'electron-updater';
import {ClientUpdater} from './updater.mjs';
import {BundleUpdater,acknowledgeBundle,previousBundleResult} from './bundle-updater.mjs';
import {UpdateNotifications} from './update-notifications.mjs';
import {DesktopSurfaces,alive,trustedFrame} from './surfaces.mjs';
import { PublicClientApplication } from '@azure/msal-node';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import releaseConfig from './config.json' with {type:'json'};
import {roomPageURL} from './room-url.mjs';
import {BrowserLogin,sessionAcceptor,verifyDesktopSession} from './browser-login.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { scanLibrary } from '../launcher/library.mjs';
import {readPclProfile} from '../launcher/pcl-profile.mjs';
import {discoverJava} from '../launcher/java-discovery.mjs';
import { MicrosoftAccount } from '../launcher/auth.mjs';
import { GameLauncher, probeJava } from '../launcher/launch.mjs';
import {readSystemMemory} from '../launcher/memory.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
app.setName('joincraft');
// Keep the existing desktop profile so renaming does not lose login cookies or settings.
app.setPath('userData', process.env.BLOCKROOM_DESKTOP_DATA_DIR ? path.resolve(process.env.BLOCKROOM_DESKTOP_DATA_DIR) : path.join(app.getPath('appData'), 'Blockroom'));
const libraryURL = pathToFileURL(path.join(here, '../public/launcher/index.html')).href;
const serverURL=()=>roomPageURL(process.env.BLOCKROOM_SERVER_URL||(app.isPackaged?releaseConfig.serverURL:'http://127.0.0.1:4180/'));
const unavailableURL=pathToFileURL(path.join(here,'../public/launcher/room-unavailable.html')).href;
const notificationsURL=pathToFileURL(path.join(here,'../public/launcher/notifications.html')).href;
let roomWindow, surfaces, launcher, account, clientUpdater, updateNotifications, browserLogin;
let installationConfirmation=null;
const cancelInstallation=()=>{installationConfirmation?.(false);installationConfirmation=null;};
const library = new Map();
let prefs = {};
let pclProfile=null, javaInstallations=[], javaScan=null;
let saving = Promise.resolve();
const prefsPath = () => path.join(app.getPath('userData'), 'launcher.json');
const save = () => { const content = JSON.stringify(prefs); saving = saving.catch(() => {}).then(() => writeFile(prefsPath(), content, { mode: 0o600 })); return saving; };
const emit = event => {
  for(const view of [surfaces?.library,surfaces?.notifications])if(alive(view))view.webContents.send('launcher:event',event);
  if(event.type==='update')surfaces?.notifyFocus();
};
function shellSender(event){
  const view=[surfaces?.library,roomWindow].find(view=>alive(view)&&event.sender===view.webContents&&event.senderFrame===view.webContents.mainFrame);
  if(!view)throw new Error('无权访问客户端通知');
  const expected=view===surfaces?.library?libraryURL:new URL(serverURL()).href;
  if(event.senderFrame.url!==unavailableURL&&event.senderFrame.url.split('#')[0]!==expected.split('#')[0])throw new Error('无权访问客户端通知');
  return view;
}
function notificationSender(event){
  if(!trustedFrame(event,surfaces?.notifications,notificationsURL))throw new Error('无权操作客户端更新');
}
async function openNotifications(){
  await surfaces.showNotifications();
  if(surfaces.modal)await updateNotifications.claim(clientUpdater.state()).catch(()=>{});
}
function guard(event){
  if(!trustedFrame(event,surfaces?.library,libraryURL))throw new Error('无权访问本机启动器');
}
function handle(name, fn) {
  ipcMain.handle(`launcher:${name}`, async (event, input) => {
    try { guard(event); return { ok: true, value: await fn(input) }; }
    catch (e) { return { ok: false, error: e.message || '操作失败' }; }
  });
}
async function scan(selected) {
  emit({type:'library-scanning'});
  const result = await scanLibrary(selected);
  library.clear();
  for (const item of result.instances) library.set(item.id, item);
  pclProfile=await readPclProfile({selected,root:result.root});
  prefs.root = result.root;prefs.selectedRoot=selected;
  javaInstallations=[];
  await save();
  const discovered={...result,pclProfile};emit({type:'library',...discovered});
  return discovered;
}
function protect(win, allowedURL) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (url.split('#')[0] !== allowedURL.split('#')[0]) event.preventDefault(); });
  // The launcher and room window share a session. Only the trusted room page may capture audio.
  const roomOrigin = () => new URL(serverURL()).origin;
  const trusted = (wc, origin) => {
    try { return roomWindow && !roomWindow.isDestroyed() && wc === roomWindow.webContents && new URL(origin).origin === roomOrigin() && new URL(wc.getURL()).origin === roomOrigin(); }
    catch { return false; }
  };
  win.webContents.session.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    const allowed = permission === 'media' && trusted(wc, details.requestingUrl) && details.mediaTypes?.length > 0 && details.mediaTypes.every(type => type === 'audio');
    if (!allowed) { callback(false); return; }
    if (process.platform === 'darwin') { try { callback(await systemPreferences.askForMediaAccess('microphone')); } catch { callback(false); } }
    else callback(true);
  });
  win.webContents.session.setPermissionCheckHandler((wc, permission, origin, details) => permission === 'media' && trusted(wc, origin) && details.mediaType === 'audio');
}
async function loadRooms(win,target){
  try{await win.loadURL(target);}catch{if(!win.isDestroyed())await win.loadURL(unavailableURL);}
}
function openRooms() {
  const target=new URL(serverURL());
  if(target.protocol!=='https:'&&!(target.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(target.hostname)))throw new Error('房间服务地址须使用 HTTPS，或本机 HTTP');
  if(alive(roomWindow)){surfaces.showRooms();return;}
  roomWindow=new BrowserWindow({title:'joincraft',icon:path.join(here,'../public/brand/app-512.png'),width:1180,height:800,minWidth:850,minHeight:600,backgroundColor:'#17181a',webPreferences:{preload:path.join(here,'rooms-preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}});
  roomWindow.setMenuBarVisibility(false);protect(roomWindow,target.href);
  surfaces=new DesktopSurfaces({main:roomWindow,urls:{library:libraryURL,notifications:notificationsURL},prepare:protect,onModalClosed:cancelInstallation,createView:name=>{
    const view=new WebContentsView({webPreferences:{preload:path.join(here,name==='library'?'preload.cjs':'notifications-preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}});
    view.setBackgroundColor(name==='notifications'?'#00000000':'#17181a');return view;
  }});
  roomWindow.on('close',event=>{
    if(launcher.states().some(run=>['checking','starting','running'].includes(run.state))){
      event.preventDefault();surfaces.closeNotifications();void openLibrary().then(()=>emit({type:'close-blocked',message:'游戏仍在运行，请先退出游戏再关闭 joincraft。'}));
    }
  });
  target.hash='friends';void loadRooms(roomWindow,target.href);
}
async function openLibrary(){await surfaces.showLibrary();}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance',()=>{if(!launcher)return;if(surfaces?.modal)surfaces.focus(surfaces.notifications);else openRooms();});
  app.whenReady().then(async () => {
  prefs = await readFile(prefsPath(), 'utf8').then(JSON.parse).catch(() => ({}));
  updateNotifications=new UpdateNotifications({lastVersion:prefs.updateNotifiedVersion,saveVersion:async version=>{const previous=prefs.updateNotifiedVersion;prefs.updateNotifiedVersion=version;try{await save();}catch(error){prefs.updateNotifiedVersion=previous;throw error;}}});
  const clientId = process.env.BLOCKROOM_MICROSOFT_CLIENT_ID || '';
  const client = clientId ? new PublicClientApplication({ auth: { clientId, authority: 'https://login.microsoftonline.com/consumers' }, system: { loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => {} } } }) : null;
  account = new MicrosoftAccount({ clientId, client, notify: emit });
  launcher = new GameLauncher({ library, account, cacheDir: app.getPath('userData'), notify: emit });
  launcher.javaPath = prefs.javaPath || null;
  const {autoUpdater}=electronUpdater;
  // Keep signed update URLs and release contents out of renderer logs.
  autoUpdater.logger=null;
  const updateEngine=process.platform==='win32'?new BundleUpdater({app,currentVersion:app.getVersion()}):autoUpdater;
  clientUpdater=new ClientUpdater({updater:updateEngine,currentVersion:app.getVersion(),packaged:app.isPackaged,
    notify:emit,gameBusy:()=>launcher.states().some(r=>['checking','starting','running'].includes(r.state)),
    beforeInstall:()=>saving,
    confirmInstall:version=>new Promise(resolve=>{
      if(!surfaces?.modal||!alive(surfaces.notifications)){resolve(false);return;}
      installationConfirmation=resolve;surfaces.notifications.webContents.send('launcher:event',{type:'install-confirmation',version});
    })
  });
  for(const action of ['state','check','download','cancel','install'])ipcMain.handle('updates:'+action,async event=>{
    try{
      notificationSender(event);
      return {ok:true,value:await clientUpdater[action]()};
    }catch(error){return {ok:false,error:error.message||'操作失败'};}
  });
  ipcMain.handle('updates:close',async event=>{try{notificationSender(event);surfaces.closeNotifications();return {ok:true};}catch(error){return {ok:false,error:error.message};}});
  ipcMain.handle('updates:confirm-install',async(event,accepted)=>{try{notificationSender(event);const decide=installationConfirmation;installationConfirmation=null;decide?.(accepted===true&&surfaces.modal);return {ok:true};}catch(error){return {ok:false,error:error.message};}});
  for(const action of ['state','claim','open'])ipcMain.handle('notifications:'+action,async event=>{
    try{const win=shellSender(event);const state=clientUpdater.state();
      if(action==='state')return {ok:true,value:{phase:state.phase,version:state.version}};
      if(action==='claim')return {ok:true,value:await updateNotifications.claim(state,()=>surfaces.canNotify(win))};
      await openNotifications();return {ok:true,value:null};
    }catch(error){return {ok:false,error:error.message||'操作失败'};}
  });
  handle('memory',()=>readSystemMemory());
  handle('state', async () => ({ memory:await readSystemMemory(), root: prefs.root || null, instances: [...library.values()], javaPath: launcher.javaPath, account: account.summary(), runs: launcher.states(), roomURL: serverURL(), pclProfile, javaInstallations, arch:process.arch }));
  handle('pick-directory', async () => {
    if (launcher.states().some(r => ['checking', 'starting', 'running'].includes(r.state))) throw new Error('请先退出当前游戏，再切换目录');
    const result = await dialog.showOpenDialog(roomWindow, { title: '选择 PCL 整合包目录或 .minecraft', properties: ['openDirectory'] });
    return result.canceled ? null : scan(result.filePaths[0]);
  });
  const assertIdle=()=>{if(launcher.states().some(r=>['checking','starting','running'].includes(r.state)))throw new Error('请先退出当前游戏，再切换 Java');};
  handle('scan-java',()=>{
    if(!javaScan)javaScan=discoverJava({root:prefs.root,selected:prefs.selectedRoot,savedPath:launcher.javaPath}).then(found=>{javaInstallations=found;return found;}).finally(()=>{javaScan=null;});
    return javaScan;
  });
  const selectJava=async selected=>{assertIdle();const java=await probeJava(selected);launcher.javaPath=java.path;prefs.javaPath=java.path;await save();return java;};
  handle('select-java',async selected=>{
    if(typeof selected!=='string'||!javaInstallations.some(java=>java.path===selected))throw new Error('请从已扫描的 Java 中选择');
    return selectJava(selected);
  });
  handle('pick-java', async () => {
    assertIdle();
    const result = await dialog.showOpenDialog(roomWindow, { title: '选择 Java 的 bin/java.exe（macOS 为 bin/java）', properties: ['openFile'], ...(process.platform === 'win32' ? { filters: [{ name: 'Java', extensions: ['exe'] }] } : {}) });
    if (result.canceled) return null;
    const java=await selectJava(result.filePaths[0]);
    javaInstallations=[java,...javaInstallations.filter(item=>item.path!==java.path)];return java;
  });
  handle('check', input => launcher.check(input));
  handle('start', input => {clientUpdater.assertCanLaunch();return launcher.start(input);});
  handle('login', () => account.login());
  handle('logout', () => account.logout());
  handle('microsoft-page', () => shell.openExternal('https://www.microsoft.com/devicelogin'));
  handle('rooms', openRooms);
  ipcMain.handle('rooms:library', async event => {
    if (!roomWindow || event.sender !== roomWindow.webContents || event.senderFrame !== roomWindow.webContents.mainFrame) return;
    const target = new URL(serverURL());
    if (event.senderFrame.url!==unavailableURL&&new URL(event.senderFrame.url).origin !== target.origin) return;
    await openLibrary();
  });
  ipcMain.handle('rooms:retry',async event=>{
    if(!roomWindow||roomWindow.isDestroyed()||event.sender!==roomWindow.webContents||event.senderFrame!==roomWindow.webContents.mainFrame||event.senderFrame.url!==unavailableURL)return;
    await loadRooms(roomWindow,serverURL());
  });
  openRooms();
  browserLogin=new BrowserLogin({serverURL:serverURL(),openBrowser:url=>shell.openExternal(url),acceptSession:sessionAcceptor(roomWindow.webContents.session.cookies,serverURL(),session=>verifyDesktopSession((...args)=>roomWindow.webContents.session.fetch(...args),serverURL(),session))});
  browserLogin.on('change',state=>{
    if(alive(roomWindow))roomWindow.webContents.send('auth:changed',state);
    if(state.phase==='success'&&alive(roomWindow)){surfaces.showRooms();roomWindow.show();roomWindow.focus();}
  });
  for(const action of ['start','state','reopen','cancel','acknowledge'])ipcMain.handle('auth:'+action,async(event,mode)=>{
    try{
      if(!trustedFrame(event,roomWindow,event.senderFrame?.url)||event.senderFrame.url.split('#')[0]!==new URL(serverURL()).href.split('#')[0])throw new Error('无权操作客户端登录');
      return {ok:true,value:await browserLogin[action](mode)};
    }catch(error){return {ok:false,error:error.message||'登录操作失败'};}
  });
  app.once('before-quit',()=>{void browserLogin.cancel();});
  if(process.platform==='win32'){
    roomWindow.webContents.once('did-finish-load',()=>void acknowledgeBundle(app,app.getVersion()));
    const message=await previousBundleResult(app);if(message)clientUpdater.set({message});
  }
  if(prefs.root)await scan(prefs.selectedRoot||prefs.root).catch(()=>{});
  if(app.isPackaged){
    const initialCheck=setTimeout(()=>void clientUpdater.check(),3000);initialCheck.unref();
    const periodicCheck=setInterval(()=>void clientUpdater.check(),6*60*60*1000);periodicCheck.unref();
    app.once('will-quit',()=>{clearTimeout(initialCheck);clearInterval(periodicCheck);clientUpdater.dispose();});
  }
  app.on('window-all-closed', () => app.quit());
  }).catch(error => { console.error('Desktop initialization failed:', error.message); app.quit(); });
}
