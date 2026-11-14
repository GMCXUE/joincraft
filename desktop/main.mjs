import { app, BrowserWindow, WebContentsView, dialog, ipcMain, shell, systemPreferences } from 'electron';
import electronUpdater from 'electron-updater';
import {ClientUpdater} from './updater.mjs';
import {BundleUpdater,acknowledgeBundle,previousBundleResult} from './bundle-updater.mjs';
import {UpdateNotifications} from './update-notifications.mjs';
import {DesktopSurfaces,alive,trustedFrame,trustedRoomFrame} from './surfaces.mjs';
import { PublicClientApplication } from '@azure/msal-node';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import releaseConfig from './config.json' with {type:'json'};
import {roomPageURL} from './room-url.mjs';
import {repositoryLinkHandler} from './external-links.mjs';
import {BrowserLogin,sessionAcceptor,verifyDesktopSession} from './browser-login.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import {managedPreferences} from '../launcher/managed-preferences.mjs';
import {discoverJava} from '../launcher/java-discovery.mjs';
import { MicrosoftAccount } from '../launcher/auth.mjs';
import { GameLauncher, probeJava } from '../launcher/launch.mjs';
import {windowChromeOptions,TITLEBAR_COLOR} from './window-chrome.mjs';
import {PackTransfer} from './pack-transfer.mjs';
import {ManagedPacks} from '../launcher/pack-installer.mjs';
import {createDownloadFetch} from '../launcher/download-gateway.mjs';
import {inspectMrpack,packSummary,MAX_PACK_BYTES,LEGACY_PACK_BYTES} from '../shared/pack-format.mjs';
import {createHash} from 'node:crypto';
import {stat} from 'node:fs/promises';
import {ManagedWorlds} from '../launcher/worlds.mjs';
import {HostHelper} from '../launcher/host-helper.mjs';
import {GamePlay} from './game-play.mjs';
import {ElectronP2P} from './p2p-runtime.mjs';
import {createPlayAPI} from './play-api.mjs';
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
let worlds, gamePlay, p2pRuntime, playToken=null;
let managedPacks, packTransfer, managedSelection=null,lastPackInput=null;
async function reloadLibrary(){library.clear();for(const item of await managedPacks.list())library.set(item.id,item);emit({type:'library',instances:[...library.values()],root:managedPacks.root,managedRoot:managedPacks.root});}
const anyPackBusy=()=>!!(managedPacks?.busy||packTransfer?.busy);
const packState=()=>{if(managedPacks.busy)return managedPacks.state();if((packTransfer?.progress.started||0)>(managedPacks.progress.started||0))return packTransfer.state();return managedPacks.state();};
const anyGameBusy=()=>launcher.states().some(run=>['checking','starting','running'].includes(run.state));
async function pickMrpack(){const result=await dialog.showOpenDialog(roomWindow,{title:'导入整合包',properties:['openFile'],filters:[{name:'整合包文件（Modrinth）',extensions:['mrpack','zip']}]});if(result.canceled)return null;const file=result.filePaths[0];if((await stat(file)).size>MAX_PACK_BYTES)throw Error('整合包文件最大支持 600 MB');return file;}
async function installPack(buffer,hash){clientUpdater.assertCanLaunch();if(anyGameBusy())throw Error('请先退出游戏，再安装整合包');if(packTransfer?.busy)throw Error('请先完成当前传输');lastPackInput={buffer,sha512:hash||null};let instance;try{instance=await managedPacks.install(buffer,hash);lastPackInput.sha512=instance.pack.sha512;}catch(error){lastPackInput.sha512 ||= managedPacks.progress.sha512;throw error;}managedSelection=instance.id;launcher.javaPath=instance.javaPath;prefs.javaPath=instance.javaPath;await save();await reloadLibrary();emit({type:'pack-selected',id:instance.id});return instance;}
async function choosePack(input){if(managedPacks.busy)throw Error('请先完成安装任务');let file;if(input?.id){const instance=(await managedPacks.list()).find(i=>i.id===input.id);if(!instance)throw Error('未找到本地整合包');file=path.join(path.dirname(instance.root),'pack.mrpack');}else file=await pickMrpack();return file?packTransfer.inspect(file):null;}

let javaInstallations=[], javaScan=null;
let saving = Promise.resolve();
const prefsPath = () => path.join(app.getPath('userData'), 'launcher.json');
const save = () => { const content = JSON.stringify(prefs); saving = saving.catch(() => {}).then(async () => {await mkdir(path.dirname(prefsPath()),{recursive:true});await writeFile(prefsPath(), content, { mode: 0o600 });}); return saving; };
const emit = event => {
  for(const view of [surfaces?.library,surfaces?.notifications])if(alive(view))view.webContents.send('launcher:event',event);
  if(event.type==='pack-install'&&alive(roomWindow))roomWindow.webContents.send('packs:event',event);
  if(event.type==='game-play'&&alive(roomWindow))roomWindow.webContents.send('play:event',event);
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
function protect(win, allowedURL) {
  win.webContents.setWindowOpenHandler(repositoryLinkHandler({webContents:win.webContents,pageURL:allowedURL,openExternal:url=>shell.openExternal(url),onError:error=>console.warn('Unable to open GitHub repository:',error.message)}));
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
  roomWindow=new BrowserWindow({...windowChromeOptions(),title:'joincraft',icon:path.join(here,'../public/brand/app-512.png'),width:1180,height:800,minWidth:850,minHeight:600,backgroundColor:TITLEBAR_COLOR,webPreferences:{preload:path.join(here,'rooms-preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}});
  roomWindow.setMenuBarVisibility(false);protect(roomWindow,target.href);
  surfaces=new DesktopSurfaces({main:roomWindow,urls:{library:libraryURL,notifications:notificationsURL},prepare:protect,onModalClosed:cancelInstallation,createView:name=>{
    const view=new WebContentsView({webPreferences:{preload:path.join(here,name==='library'?'preload.cjs':'notifications-preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}});
    view.setBackgroundColor(name==='notifications'?'#00000000':TITLEBAR_COLOR);return view;
  }});
  roomWindow.on('close',event=>{
    if(anyGameBusy()||anyPackBusy()){
      event.preventDefault();surfaces.closeNotifications();void openLibrary().then(()=>emit({type:'close-blocked',message:anyPackBusy()?'整合包仍在传输或安装，请完成或取消后再关闭。':'游戏仍在运行，请先退出游戏再关闭 joincraft。'}));
    }
  });
  target.hash='friends';void loadRooms(roomWindow,target.href);
}
async function openLibrary(){await surfaces.showLibrary();}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance',()=>{if(!launcher)return;if(surfaces?.modal)surfaces.focus(surfaces.notifications);else openRooms();});
  app.whenReady().then(async () => {
  prefs = managedPreferences(await readFile(prefsPath(), 'utf8').then(JSON.parse).catch(() => ({})));
  await save();
  updateNotifications=new UpdateNotifications({lastVersion:prefs.updateNotifiedVersion,saveVersion:async version=>{const previous=prefs.updateNotifiedVersion;prefs.updateNotifiedVersion=version;try{await save();}catch(error){prefs.updateNotifiedVersion=previous;throw error;}}});
  const clientId = process.env.BLOCKROOM_MICROSOFT_CLIENT_ID || '';
  const client = clientId ? new PublicClientApplication({ auth: { clientId, authority: 'https://login.microsoftonline.com/consumers' }, system: { loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => {} } } }) : null;
  account = new MicrosoftAccount({ clientId, client, notify: emit });
  launcher = new GameLauncher({ library, account, cacheDir: app.getPath('userData'), notify: emit });
  launcher.javaPath = prefs.javaPath || null;
  managedPacks=new ManagedPacks({gatewayOrigin:new URL(serverURL()).origin,fetchImpl:createDownloadFetch({origin:new URL(serverURL()).origin}),root:prefs.managedRoot||path.join(app.getPath('documents'),'Joincraft'),roots:prefs.managedRoots||[],notify:emit,javaCandidates:async()=>{const candidates=await discoverJava({root:managedPacks.root,savedPath:launcher.javaPath,externalRuntimes:false});if(launcher.javaPath&&!candidates.some(java=>java.path===launcher.javaPath))try{candidates.unshift(await probeJava(launcher.javaPath));}catch{}return candidates;}});
  packTransfer=new PackTransfer({serverURL:serverURL(),getDirectory:()=>managedPacks.root,notify:emit,getHeaders:async token=>{
    if(token!==undefined&&token!==null&&(typeof token!=='string'||token.length>200))throw Error('登录会话无效');
    const cookies=await roomWindow.webContents.session.cookies.get({url:serverURL()});const allowed=cookies.filter(cookie=>['blockroom_session','__Host-blockroom_session'].includes(cookie.name));
    return {...(allowed.length?{Cookie:allowed.map(cookie=>cookie.name+'='+cookie.value).join('; ')}:{}),...(token?{Authorization:'Bearer '+token}:{})};
  }});
  worlds=new ManagedWorlds({getInstance:id=>library.get(id)});
  p2pRuntime=new ElectronP2P({createView:options=>new WebContentsView(options),ipcMain});
  gamePlay=new GamePlay({server:new URL(serverURL()).origin,api:createPlayAPI({serverURL:serverURL(),getHeaders:()=>packTransfer.getHeaders(playToken)}),worlds,
    helper:new HostHelper({resources:app.isPackaged?path.join(process.resourcesPath,'host-helper'):path.join(here,'../build-resources/generated/host-helper')}),
    launcher,peerFactory:options=>p2pRuntime.create(options),matching:(...args)=>managedPacks.matching(...args),getInstance:id=>library.get(id),notify:emit,
    assertCanLaunch:()=>{clientUpdater.assertCanLaunch();if(anyPackBusy())throw Error('请等待整合包任务完成');}
  });
  app.once('before-quit',()=>{void gamePlay.stop();p2pRuntime.dispose();});
  const {autoUpdater}=electronUpdater;
  // Keep signed update URLs and release contents out of renderer logs.
  autoUpdater.logger=null;
  const updateEngine=process.platform==='win32'?new BundleUpdater({app,currentVersion:app.getVersion()}):autoUpdater;
  clientUpdater=new ClientUpdater({updater:updateEngine,currentVersion:app.getVersion(),packaged:app.isPackaged,
    notify:emit,gameBusy:()=>anyGameBusy()||anyPackBusy(),
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
  handle('import-pack',async()=>{const buffer=await pickMrpack();return buffer?installPack(buffer):null;});
  handle('install-state',()=>packState());
  handle('cancel-pack',()=>packTransfer.busy?packTransfer.cancel():managedPacks.cancel());
  handle('retry-pack',()=>{if(!lastPackInput)throw Error('请重新导入整合包');return installPack(lastPackInput.buffer,lastPackInput.sha512);});
  handle('pick-install-root',async()=>{if(anyGameBusy()||anyPackBusy())throw Error('请先结束游戏或整合包任务');const selected=await dialog.showOpenDialog(roomWindow,{title:'选择 Joincraft 安装目录',properties:['openDirectory','createDirectory']});if(selected.canceled)return null;managedPacks.root=selected.filePaths[0];managedPacks.roots=[...new Set([...managedPacks.roots,managedPacks.root])];prefs.managedRoot=managedPacks.root;prefs.managedRoots=managedPacks.roots;await save();await reloadLibrary();return managedPacks.root;});
  handle('memory',()=>readSystemMemory());
  handle('worlds',input=>worlds.list(input?.id));
  handle('play-stop',()=>gamePlay.stop());
  handle('play-clear',()=>gamePlay.clear());
  handle('state', async () => ({ memory:await readSystemMemory(), play:gamePlay.state(), root: managedPacks.root, managedRoot:managedPacks.root,install:packState(),selectedInstance:managedSelection, instances: [...library.values()], javaPath: launcher.javaPath, account: account.summary(), runs: launcher.states(), roomURL: serverURL(), javaInstallations, arch:process.arch }));
  const assertIdle=()=>{if(launcher.states().some(r=>['checking','starting','running'].includes(r.state)))throw new Error('请先退出当前游戏，再切换 Java');};
  handle('scan-java',()=>{
    if(!javaScan)javaScan=discoverJava({root:managedPacks.root,savedPath:launcher.javaPath,externalRuntimes:false}).then(found=>{javaInstallations=found;return found;}).finally(()=>{javaScan=null;});
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
  handle('start', async input => {clientUpdater.assertCanLaunch();if(anyPackBusy())throw Error('请等待当前整合包任务完成');const result=gamePlay.context||input.worldId?await gamePlay.launch(input,{worldId:input.worldId,port:input.port}):await launcher.start(input);if(library.get(input.id)?.managed){prefs.managedLaunchInputs||={};prefs.managedLaunchInputs[input.id]={accountMode:input.accountMode,name:input.name,memoryMode:input.memoryMode,memoryMB:input.memoryMB,mode:'auto',connectionMode:input.connectionMode||'auto'};await save();}return result;});
  handle('login', () => account.login());
  handle('logout', () => account.logout());
  handle('microsoft-page', () => shell.openExternal('https://www.microsoft.com/devicelogin'));
  handle('rooms', openRooms);
  for(const action of ['list','choose','status','install','open','cancel','progress','retry','publish','install-from-room'])ipcMain.handle('packs:'+action,async(event,input)=>{
    try{
      if(!trustedRoomFrame(event,roomWindow,serverURL()))throw Error('无权访问本地整合包');
      if(action==='publish'){if(managedPacks.busy)throw Error('请先完成安装任务');return {ok:true,value:await packTransfer.publish(input||{})};}
      if(action==='install-from-room'){if(anyGameBusy()||anyPackBusy())throw Error('请先结束游戏或当前整合包任务');clientUpdater.assertCanLaunch();const result=await packTransfer.download(input||{});const instance=await installPack(result.file,result.pack.sha512);return {ok:true,value:{id:instance.id,pack:instance.pack}};}
      if(action==='list')return {ok:true,value:(await managedPacks.list()).map(i=>({id:i.id,name:i.name,pack:i.pack}))};
      if(action==='choose')return {ok:true,value:await choosePack(input)};
      if(action==='status'){const match=await managedPacks.matching(input?.sha512);return {ok:true,value:{status:match.status,id:match.instance?.id,reason:match.reason,file:match.file}};}
      if(action==='retry'){if(!lastPackInput||input?.sha512!==lastPackInput.sha512)throw Error('请重新获取房间整合包');const result=await installPack(lastPackInput.buffer,lastPackInput.sha512);return {ok:true,value:{id:result.id}};}
      if(action==='progress')return {ok:true,value:packState()};
      if(action==='cancel'){if(packTransfer.busy)await packTransfer.cancel();else managedPacks.cancel();return {ok:true,value:null};}
      if(action==='install'){
        if(typeof input?.archive!=='string'||input.archive.length>Math.ceil(LEGACY_PACK_BYTES/3)*4||!/^[a-f0-9]{128}$/.test(input.sha512||''))throw Error('整合包文件无效');
        const instance=await installPack(Buffer.from(input.archive,'base64'),input.sha512);return {ok:true,value:{id:instance.id,pack:instance.pack}};
      }
      if(action==='open'){
        if(gamePlay.active)throw Error('请先停止当前联机');if(gamePlay.context)gamePlay.clear();
        const match=await managedPacks.matching(input?.sha512);if(match.status!=='ready')throw Error(match.status==='changed'?'本地模组、脚本或游戏文件不匹配，请安装房间版本后启动':'请先安装房间整合包');
        managedSelection=match.instance.id;if(match.instance.javaPath){launcher.javaPath=match.instance.javaPath;prefs.javaPath=launcher.javaPath;await save();}
        const configured=prefs.managedLaunchInputs?.[managedSelection];
        if(launcher.states().some(run=>run.id===managedSelection&&run.state==='running'))return {ok:true,value:{id:managedSelection,started:true}};
        if(configured){try{clientUpdater.assertCanLaunch();if(anyPackBusy())throw Error('请等待当前整合包任务完成');await launcher.start({...configured,id:managedSelection,mode:'auto'});return {ok:true,value:{id:managedSelection,started:true}};}catch(error){await openLibrary();emit({type:'pack-selected',id:managedSelection});throw error;}}
        await openLibrary();emit({type:'pack-selected',id:managedSelection});return {ok:true,value:{id:managedSelection,needsSetup:true}};
      }
    }catch(error){return {ok:false,error:error.message||'整合包操作失败'};}
  });
  for(const action of ['select','stop','state'])ipcMain.handle('play:'+action,async(event,input)=>{
    try{
      if(!trustedRoomFrame(event,roomWindow,serverURL()))throw Error('无权操作本机联机');
      if(action==='state')return {ok:true,value:gamePlay.state()};
      if(action==='stop'){if(input?.roomId===gamePlay.context?.roomId)await gamePlay.stop();return {ok:true,value:gamePlay.state()};}
      if(gamePlay.active||anyGameBusy()||anyPackBusy())throw Error('请先退出当前游戏或结束当前任务');
      if(input?.token!==undefined&&input.token!==null&&(typeof input.token!=='string'||input.token.length>200))throw Error('登录会话无效');
      playToken=input?.token||null;const result=await gamePlay.select(input?.roomId);managedSelection=result.context.instanceId;
      const instance=library.get(managedSelection);if(instance?.javaPath){launcher.javaPath=instance.javaPath;prefs.javaPath=launcher.javaPath;await save();}
      const configured=prefs.managedLaunchInputs?.[managedSelection];
      if(result.context.role==='guest'&&configured){
        try{await gamePlay.launch({...configured,id:managedSelection,mode:'auto'});return {ok:true,value:{...gamePlay.state(),started:true}};}
        catch(error){await openLibrary();emit({type:'pack-selected',id:managedSelection});throw error;}
      }
      await openLibrary();emit({type:'pack-selected',id:managedSelection});emit({type:'game-play',...result});return {ok:true,value:result};
    }catch(error){return {ok:false,error:error.message||'联机操作失败'};}
  });
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
  await reloadLibrary();
  if(app.isPackaged){
    const initialCheck=setTimeout(()=>void clientUpdater.check(),3000);initialCheck.unref();
    const periodicCheck=setInterval(()=>void clientUpdater.check(),6*60*60*1000);periodicCheck.unref();
    app.once('will-quit',()=>{clearTimeout(initialCheck);clearInterval(periodicCheck);clientUpdater.dispose();});
  }
  app.on('window-all-closed', () => app.quit());
  }).catch(error => { console.error('Desktop initialization failed:', error.message); app.quit(); });
}
