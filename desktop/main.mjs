import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { PublicClientApplication } from '@azure/msal-node';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { scanLibrary } from '../launcher/library.mjs';
import { MicrosoftAccount } from '../launcher/auth.mjs';
import { GameLauncher, probeJava } from '../launcher/launch.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
app.setName('joincraft');
// Keep the existing desktop profile so renaming does not lose login cookies or settings.
app.setPath('userData', process.env.BLOCKROOM_DESKTOP_DATA_DIR ? path.resolve(process.env.BLOCKROOM_DESKTOP_DATA_DIR) : path.join(app.getPath('appData'), 'Blockroom'));
const libraryURL = pathToFileURL(path.join(here, '../public/launcher/index.html')).href;
let window, roomWindow, launcher, account;
const library = new Map();
let prefs = {};
let saving = Promise.resolve();
const prefsPath = () => path.join(app.getPath('userData'), 'launcher.json');
const save = () => { const content = JSON.stringify(prefs); saving = saving.catch(() => {}).then(() => writeFile(prefsPath(), content, { mode: 0o600 })); return saving; };
const emit = event => { if (window && !window.isDestroyed()) window.webContents.send('launcher:event', event); };
function guard(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== libraryURL) throw new Error('无权访问本机启动器');
}
function handle(name, fn) {
  ipcMain.handle(`launcher:${name}`, async (event, input) => {
    try { guard(event); return { ok: true, value: await fn(input) }; }
    catch (e) { return { ok: false, error: e.message || '操作失败' }; }
  });
}
async function scan(root) {
  const result = await scanLibrary(root);
  library.clear();
  for (const item of result.instances) library.set(item.id, item);
  prefs.root = result.root;
  await save();
  return result;
}
function protect(win, allowedURL) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (url.split('#')[0] !== allowedURL.split('#')[0]) event.preventDefault(); });
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  win.webContents.session.setPermissionCheckHandler(() => false);
}
function openRooms() {
  const target = new URL(process.env.BLOCKROOM_SERVER_URL || 'http://127.0.0.1:4180/');
  if (target.protocol !== 'https:' && !(target.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname))) throw new Error('房间服务地址须使用 HTTPS，或本机 HTTP');
  if (roomWindow && !roomWindow.isDestroyed()) { roomWindow.focus(); return; }
  roomWindow = new BrowserWindow({ width: 1280, height: 840, minWidth: 850, minHeight: 600, backgroundColor: '#17181a', webPreferences: { preload: path.join(here, 'rooms-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  protect(roomWindow, target.href);
  roomWindow.loadURL(target.href).catch(() => {});
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus(); });
  app.whenReady().then(async () => {
  prefs = await readFile(prefsPath(), 'utf8').then(JSON.parse).catch(() => ({}));
  const clientId = process.env.BLOCKROOM_MICROSOFT_CLIENT_ID || '';
  const client = clientId ? new PublicClientApplication({ auth: { clientId, authority: 'https://login.microsoftonline.com/consumers' }, system: { loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => {} } } }) : null;
  account = new MicrosoftAccount({ clientId, client, notify: emit });
  launcher = new GameLauncher({ library, account, cacheDir: app.getPath('userData'), notify: emit });
  launcher.javaPath = prefs.javaPath || null;
  handle('state', async () => ({ root: prefs.root || null, instances: [...library.values()], javaPath: launcher.javaPath, account: account.summary(), runs: launcher.states(), roomURL: process.env.BLOCKROOM_SERVER_URL || 'http://127.0.0.1:4180/' }));
  handle('pick-directory', async () => {
    if (launcher.states().some(r => ['checking', 'starting', 'running'].includes(r.state))) throw new Error('请先退出当前游戏，再切换目录');
    const result = await dialog.showOpenDialog(window, { title: '选择 PCL 整合包目录或 .minecraft', properties: ['openDirectory'] });
    return result.canceled ? null : scan(result.filePaths[0]);
  });
  handle('pick-java', async () => {
    const result = await dialog.showOpenDialog(window, { title: '选择 Java 的 bin/java.exe（macOS 为 bin/java）', properties: ['openFile'], ...(process.platform === 'win32' ? { filters: [{ name: 'Java', extensions: ['exe'] }] } : {}) });
    if (result.canceled) return null;
    const java = await probeJava(result.filePaths[0]);
    launcher.javaPath = java.path; prefs.javaPath = java.path; await save();
    return java;
  });
  handle('check', input => launcher.check(input));
  handle('start', input => launcher.start(input));
  handle('login', () => account.login());
  handle('logout', () => account.logout());
  handle('microsoft-page', () => shell.openExternal('https://www.microsoft.com/devicelogin'));
  handle('rooms', openRooms);
  ipcMain.handle('rooms:library', event => {
    if (!roomWindow || event.sender !== roomWindow.webContents || event.senderFrame !== roomWindow.webContents.mainFrame) return;
    const target = new URL(process.env.BLOCKROOM_SERVER_URL || 'http://127.0.0.1:4180/');
    if (new URL(event.senderFrame.url).origin !== target.origin) return;
    window.show(); window.focus();
  });
  window = new BrowserWindow({ title: 'joincraft · 本机游戏库', width: 1120, height: 790, minWidth: 850, minHeight: 650, backgroundColor: '#17181a', webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  window.setMenuBarVisibility(false);
  protect(window, libraryURL);
  window.on('close', event => {
    if (launcher.states().some(r => ['checking', 'starting', 'running'].includes(r.state))) { event.preventDefault(); void dialog.showMessageBox(window, { message: '游戏仍在运行，请先退出游戏再关闭joincraft。', buttons: ['知道了'] }); }
  });
  if (prefs.root) await scan(prefs.root).catch(() => {});
  await window.loadURL(libraryURL);
  app.on('window-all-closed', () => app.quit());
  }).catch(error => { console.error('Desktop initialization failed:', error.message); app.quit(); });
}
