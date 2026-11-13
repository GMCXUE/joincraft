import '../focus.js';
import {mountPackInstaller} from './packs.js';
import {miningFeedback,animatePage} from '../motion.js';
let libraryScanMotion=null;
import {createMemoryControls} from './memory.js';
import {mountDesktopNotifications} from '../desktop-notifications.js';
const $ = selector => document.querySelector(selector);
const api = window.blockroomLauncher;
mountDesktopNotifications();
let preferences = {};
try { preferences = JSON.parse(localStorage.getItem('blockroom-launcher-preferences') || '{}'); if (!preferences || typeof preferences !== 'object') preferences = {}; } catch {}
const state = { instances: [], selected: null, javaPath: null, accountMode: 'offline', account: {}, runs: [], busy: false, javaInstallations:[], javaScanning:false, installBusy:false,arch:'x64' };
const text = (selector, value) => { $(selector).textContent = value; };
function message(error) { $('#message').hidden = !error; text('#message', error?.message || error || ''); }
function item() { return state.instances.find(i => i.id === state.selected); }
const playerRoot=()=>item()?.root||state.root;
const prefKey = selected => `${selected.root}/${selected.version}`;
const memoryUI=createMemoryControls({api,locked:()=>state.busy||state.runs.some(r=>['checking','starting','running'].includes(r.state)),getRun:()=>state.runs.find(r=>r.id===state.selected),onChange:()=>remember(),onRefresh:()=>controls()});
window.addEventListener('beforeunload',()=>memoryUI.dispose());
function remember() {
  const selected = item();
  if (!selected) return;
  preferences.selected = prefKey(selected);

  preferences.accountMode = state.accountMode;
  preferences.instances ||= {};
  preferences.instances[prefKey(selected)] = { ...memoryUI.preferences(), mode: $('#directory-mode').value };
  try { localStorage.setItem('blockroom-launcher-preferences', JSON.stringify(preferences)); } catch {}
}
function input() { return { id: state.selected, name: $('#player-name').value.trim(), accountMode: state.accountMode, ...memoryUI.request(), mode: $('#directory-mode').value }; }
function pathLabel() {
  const selected = item(); if (!selected) return;
  const mode = $('#directory-mode').value === 'auto' ? selected.isolation?.mode : $('#directory-mode').value;
  const sep = selected.root.includes('\\') ? '\\' : '/';
  text('#game-path', mode === 'isolated' ? `${selected.root}${sep}versions${sep}${selected.version}` : mode === 'shared' ? selected.root : '启动前需确认目录，避免读取错误的存档位置');
}
function renderPlayer(){const custom=preferences.playerNames?.[playerRoot()];$('#player-name').value=typeof custom==='string'?custom:'';}
function renderJava(){
  const selected=item(),compatible=java=>java.major===selected?.javaMajor&&java.arch===state.arch;
  const entries=[...state.javaInstallations].sort((a,b)=>Number(compatible(b))-Number(compatible(a)));
  const placeholder=document.createElement('option');placeholder.value='';
  placeholder.textContent=state.javaScanning?'正在扫描 Java…':entries.length?'请选择 Java 运行环境':'未找到 Java，可手动选择';
  const options=entries.map(java=>{const option=document.createElement('option');option.value=java.path;option.textContent=`Java ${java.version||java.major} · ${java.arch||'未知架构'}${compatible(java)?' · 匹配当前整合包':''} — ${java.path}`;return option;});
  if(state.javaPath&&!entries.some(java=>java.path===state.javaPath)){const option=document.createElement('option');option.value=state.javaPath;option.textContent='上次选择 · '+state.javaPath;options.push(option);}
  $('#java-select').replaceChildren(placeholder,...options);$('#java-select').value=state.javaPath||'';
  text('#java-path',state.javaPath||'');
  const java=entries.find(java=>java.path===state.javaPath);
  text('#java-hint',state.javaScanning?'正在检查本机运行环境':java&&selected&&!compatible(java)?`当前选择不匹配：需要 Java ${selected.javaMajor} · ${state.arch}`:selected?`需要 Java ${selected.javaMajor} · ${state.arch}`:'');
  text('#scan-java',state.javaScanning?'扫描中…':'重新扫描');
}
async function scanJava(){
  if(!api||state.javaScanning)return;state.javaScanning=true;renderJava();controls();
  const task=miningFeedback.start('正在扫描 Java',{success:'Java 扫描完成'});
  try{state.javaInstallations=await api.scanJava();task.done();}catch(error){task.fail(error);message(error);}
  finally{state.javaScanning=false;renderJava();controls();}
}
function setJava(java){
  state.javaPath=java.path;state.javaInstallations=[java,...state.javaInstallations.filter(item=>item.path!==java.path)];renderJava();
}
function controls() {
  const selected = item();
  const running = state.installBusy || state.runs.some(r => ['checking', 'starting', 'running'].includes(r.state));
  for (const id of ['#import-pack','#empty-install','#pick-install-root', '#pick-java', '#scan-java', '#java-select']) $(id).disabled = !api || state.busy || running;
  $('#scan-java').disabled ||= state.javaScanning;$('#java-select').disabled ||= state.javaScanning;$('#pick-java').disabled ||= state.javaScanning;
  $('#check').disabled = !api || !selected || !!selected.error || !state.javaPath || state.busy || running;
  $('#launch').disabled = $('#check').disabled || !memoryUI.canLaunch() || (state.accountMode === 'microsoft' && !state.account.profile);
  for (const id of ['#directory-mode', '#player-name', '#offline-tab', '#microsoft-tab']) $(id).disabled = state.busy || running;
  $('#directory-mode').disabled ||= !!selected?.managed;
  $('#login').disabled = !api || !state.account.configured || state.account.busy || state.busy || running;
  $('#logout').disabled = state.account.busy || state.busy || running;
  memoryUI.sync();
  const blocked=!selected||!api||running||state.busy?'':selected.error?'请先修复实例配置':!state.javaPath?'选择 Java 运行环境后即可启动':state.accountMode==='microsoft'&&!state.account.profile?'登录微软账号后即可启动':!memoryUI.canLaunch()?'请检查内存分配提示':'';
  text('#launch-hint',blocked);
  const run = state.runs.find(r => r.id === state.selected);
  text('#pack-status', run?.message || (selected?.error ? '需要修复' : ''));
  text('#launch', run?.state === 'running' ? '游戏运行中' : state.busy ? '请稍候…' : '启动游戏');
}
function renderAccount() {
  const online = state.accountMode === 'microsoft';
  $('#offline-panel').hidden = online; $('#microsoft-panel').hidden = !online;
  $('#offline-tab').setAttribute('aria-pressed', String(!online)); $('#microsoft-tab').setAttribute('aria-pressed', String(online));
  text('#microsoft-name', state.account.profile?.name || '尚未登录');
  text('#microsoft-hint', !state.account.configured ? '微软登录未配置' : state.account.profile ? 'Java 版已授权' : '需要拥有 Java 版');
  $('#login').hidden = !!state.account.profile; $('#logout').hidden = !state.account.profile;
  controls();
}
function render() {
  text('#instance-count', state.instances.length);
  text('#managed-root',state.managedRoot||'');$('#managed-root').title=state.managedRoot||'';
  $('#instances').replaceChildren(...state.instances.map(instance => {
    const button = document.createElement('button'); button.className = 'instance'; button.setAttribute('aria-current', String(instance.id === state.selected));
    const avatar = document.createElement('span'); avatar.className = 'instance-avatar'; avatar.textContent = instance.name.slice(0, 2).toUpperCase();
    const copy = document.createElement('span'); copy.className = 'instance-text'; const title = document.createElement('strong'); title.textContent = instance.name; const meta = document.createElement('small'); meta.textContent = instance.error ? '配置需要修复' : `${instance.loader} · Java ${instance.javaMajor}`; copy.append(title, meta); button.append(avatar, copy);
    button.onclick = () => { if (state.busy) return; remember(); state.selected = instance.id; message(null); render(); remember(); }; return button;
  }));
  const selected = item(); $('#empty').hidden = !!selected; $('#details').hidden = !selected;
  if (selected) {
    text('#pack-name', selected.name); text('#pack-icon', selected.name.slice(0, 2).toUpperCase());
    text('#pack-meta', selected.error ? '已安装实例' : `${selected.loader} / ${selected.minecraft}`);
    text('#isolation-hint', selected.isolation?.mode === 'unknown' ? '请选择游戏目录' : '');
    const saved = preferences.instances?.[prefKey(selected)];
    $('#directory-mode').options[0].textContent=selected.managed?'独立实例目录':'跟随识别结果';
    $('#directory-mode').value=selected.managed?'auto':['auto','shared','isolated'].includes(saved?.mode)?saved.mode:'auto';
    memoryUI.restore(saved);
    pathLabel(); text('#check-result', '');
    if (selected.error) message(selected.error);
  }
  renderPlayer();renderJava();renderAccount();
}
async function action(fn) { message(null); state.busy = true; controls(); try { await fn(); } catch (e) { libraryScanMotion?.fail(e);libraryScanMotion=null;message(e); } finally { state.busy = false; controls(); } }
$('#pick-java').onclick = () => action(async () => { const java = await api.pickJava(); if(java)setJava(java); });
$('#scan-java').onclick=scanJava;
$('#java-select').onchange=()=>action(async()=>{const selected=$('#java-select').value;if(!selected){renderJava();return;}try{setJava(await api.selectJava(selected));}catch(error){renderJava();throw error;}});
$('#directory-mode').onchange = () => { pathLabel(); remember(); };
$('#player-name').oninput=()=>{preferences.playerNames||={};preferences.playerNames[playerRoot()]=$('#player-name').value;remember();};
$('#offline-tab').onclick = () => { state.accountMode = 'offline'; remember(); renderAccount(); };
$('#microsoft-tab').onclick = () => { state.accountMode = 'microsoft'; remember(); renderAccount(); };
$('#login').onclick = () => action(async () => { try { state.account = await api.login(); renderAccount(); } finally { $('#device-code').hidden = true; } });
$('#logout').onclick = () => action(async () => { state.account = await api.logout(); renderAccount(); });
$('#open-microsoft').onclick = () => api.microsoftPage().catch(message);
$('#check').onclick = () => action(async () => { const result = await api.check(input()); text('#check-result', `${result.files} 个文件校验通过${result.accountReady ? '，可以启动' : '，还需登录微软账号'}`); text('#game-path', result.gamePath); });
$('#launch').onclick = () => action(async () => { await api.start(input()); text('#check-result', '已创建游戏进程，等待游戏窗口打开'); });
$('#rooms').onclick = () => api ? api.rooms().catch(message) : location.assign('/app/#friends');
$('.brand').onclick = event => { event.preventDefault(); $('#rooms').click(); };
if (!api) { $('#web-note').hidden = false; text('#surface-label', '网页预览'); render(); }
else {
  api.onEvent(event => {
    if(event.type==='surface-shown')void memoryUI.refresh();
    if(event.type==='surface-shown')animatePage(document.querySelector('.workspace'));
    if(event.type==='close-blocked'){message(event.message);document.querySelector('#message').scrollIntoView({block:'nearest'});}
    if(event.type==='library-scanning'){libraryScanMotion?.cancel();libraryScanMotion=miningFeedback.start('正在识别整合包',{success:'游戏库已更新'});}
    if(event.type==='library'){libraryScanMotion?.done();libraryScanMotion=null;const key=item()&&prefKey(item());Object.assign(state,event);state.selected=state.instances.find(i=>prefKey(i)===key)?.id||state.instances[0]?.id;render();}
    if(event.type==='pack-selected'){state.selected=event.id;render();remember();}
    if (event.type === 'device-code') { text('#code', event.code); $('#device-code').hidden = false; }
    if (event.type === 'account') { state.account = event; renderAccount(); }
    if (event.type === 'run') { state.runs = [...state.runs.filter(r => r.id !== event.id), event]; controls(); if (event.id === state.selected) text('#check-result', event.message); if (event.state === 'failed') message(event.message); }
  });
  api.state().then(result => { Object.assign(state, result);if(result.memory)memoryUI.update(result.memory);memoryUI.start(); state.selected = result.selectedInstance || state.instances.find(i => prefKey(i) === preferences.selected)?.id || state.instances[0]?.id; state.accountMode = preferences.accountMode === 'microsoft' ? 'microsoft' : 'offline'; if(state.root&&typeof preferences.name==='string'&&preferences.name!=='Player'){preferences.playerNames||={};preferences.playerNames[playerRoot()]??=preferences.name.slice(0,16);delete preferences.name;}render();void scanJava(); }).catch(message);
}

if(api){
  mountPackInstaller({api,onBusy:value=>{state.installBusy=value;controls();},onError:message,onInstalled:async instance=>{const result=await api.state();Object.assign(state,result);state.selected=instance.id;state.javaInstallations=await api.scanJava();render();remember();},});
  $('#pick-install-root').onclick=()=>action(async()=>{const value=await api.pickInstallRoot();if(value){state.managedRoot=value;render();}});
}
