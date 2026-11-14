import '../focus.js';
import {createLibraryReturn} from './navigation.js';
import {mountLibraryExperience,launchPresentation} from './experience.js';
const experience=mountLibraryExperience();
import {mountWorlds} from './worlds.js';
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
const state = { instances: [], selected: null, javaPath: null, accountMode: 'offline', account: {}, runs: [], busy: false, operation:null, javaInstallations:[], javaScanning:false, installBusy:false,arch:'x64' };
const text = (selector, value) => { const el=$(selector),next=String(value??'');if(el.textContent!==next)el.textContent=next; };
function message(error) { $('#message').hidden = !error; text('#message', error?.message || error || ''); }
function item() { return state.instances.find(i => i.id === state.selected); }
const playerRoot=()=>item()?.root||state.root;
const prefKey = selected => `${selected.root}/${selected.version}`;
let worldUI=null,homeOpen=null,initialized=false;
const memoryUI=createMemoryControls({api,locked:()=>state.busy||state.runs.some(r=>['checking','starting','running'].includes(r.state)),getRun:()=>state.runs.find(r=>r.id===state.selected),onChange:()=>remember(),onRefresh:()=>controls()});
window.addEventListener('beforeunload',()=>memoryUI.dispose());
function remember() {
  const selected = item();
  if (!selected) return;
  preferences.selected = prefKey(selected);

  preferences.accountMode = state.accountMode;
  preferences.connectionMode=$('#connection-mode').value;
  preferences.instances ||= {};
  preferences.instances[prefKey(selected)] = { ...memoryUI.preferences(),jvmArgs:$('#jvm-args').value,gameArgs:$('#game-args').value,windowMode:$('#window-mode').value, mode: $('#directory-mode').value };
  try { localStorage.setItem('blockroom-launcher-preferences', JSON.stringify(preferences)); } catch {}
}
function input() { return {...((worldUI?.tab==='worlds'||state.play?.context?.role==='host')&&worldUI?.selected?{worldId:worldUI.selected}:{}),...(state.play?.context?.role==='host'?{port:Number($('#host-port').value)}:{}), connectionMode:$('#connection-mode').value,id: state.selected,jvmArgs:$('#jvm-args').value,gameArgs:$('#game-args').value,windowMode:$('#window-mode').value,name:state.gameIdentity?.name||'', accountMode: state.accountMode, ...memoryUI.request(), mode: $('#directory-mode').value }; }
function pathLabel() {
  const selected = item(); if (!selected) return;
  const mode = $('#directory-mode').value === 'auto' ? selected.isolation?.mode : $('#directory-mode').value;
  const sep = selected.root.includes('\\') ? '\\' : '/';
  text('#game-path', mode === 'isolated' ? `${selected.root}${sep}versions${sep}${selected.version}` : mode === 'shared' ? selected.root : '启动前需确认目录，避免读取错误的存档位置');
}
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
  text('#scan-java',state.javaScanning?'扫描中…':'重新扫描');$('#scan-java').setAttribute('aria-busy',String(state.javaScanning));
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
  $('#launch').disabled = $('#check').disabled || state.accountMode==='offline'&&!/^[A-Za-z0-9_]{3,16}$/.test(state.gameIdentity?.name||'') || !memoryUI.canLaunch() || (state.accountMode === 'microsoft' && !state.account.profile);
  for (const id of ['#directory-mode','#jvm-args','#game-args','#window-mode','#save-launch-settings']) $(id).disabled = state.busy || running;
  $('#directory-mode').disabled ||= !!selected?.managed;
  worldUI?.setLocked(running||state.busy);
  memoryUI.sync();
  const blocked=!selected||!api||running||state.busy?'':selected.error?'请先修复实例配置':!state.javaPath?'选择 Java 运行环境后即可启动':state.accountMode==='microsoft'&&!state.account.profile?'回首页登录微软账号后即可启动':!memoryUI.canLaunch()?'请检查内存分配提示':state.accountMode==='offline'&&!/^[A-Za-z0-9_]{3,16}$/.test(state.gameIdentity?.name||'')?'回首页设置离线玩家名':'';
  text('#launch-hint',blocked);
  const context=state.play?.context,phase=state.play?.progress?.phase,active=['launching','world-loading','checking','connecting','online'].includes(phase);
  $('#play-context').hidden=!context;$('#connection-mode-field').hidden=!context;$('#connection-mode').disabled=active||running||state.busy;$('#host-port-field').hidden=context?.role!=='host';
  if(context){text('#play-role',context.role==='host'?'房主':'成员');text('#play-room-name',context.roomName);text('#play-progress',state.play.progress?.message||'');}
  const network=state.play?.network,route=$('#network-route');route.hidden=!context||!network;route.dataset.transport=network?.transport||'';route.title=network?.reason||'';text('#network-route',network?.transport==='p2p'?`P2P 直连${Number.isFinite(network.latency)?' · '+Math.round(network.latency)+' ms':''}`:network?.transport==='relay'?'服务器中继':network?'正在尝试直连…':'');
  $('#clear-play').disabled=active||state.busy;$('#stop-play').hidden=!active;$('#stop-play').disabled=state.busy;$('#host-port').disabled=active||running||state.busy;
  if(context?.instanceId&&context.instanceId!==state.selected)$('#launch').disabled=true;
  if((worldUI?.tab==='worlds'&&context?.role!=='guest'||context?.role==='host')&&(!worldUI?.selected||worldUI.loading))$('#launch').disabled=true;
  const run = state.runs.find(r => r.id === state.selected);
  const view=launchPresentation({selectedId:state.selected,run,play:state.play,operation:state.operation,error:selected?.error});
  text('#launch-label',view.label||(worldUI?.tab==='worlds'?'进入世界':'启动游戏'));
  text('#launch-target',worldUI?.tab==='worlds'||context?.role==='host'?worldUI?.selectedWorld?.name||'选择一个世界':selected?.minecraft?'Minecraft '+selected.minecraft:'');
  $('#launch-configure').hidden=!blocked||worldUI?.tab!=='worlds';
  $('#check').setAttribute('aria-busy',String(state.operation==='check'));text('#check',state.operation==='check'?'正在检查…':'检查文件');
  experience.update(view);
  for(const button of $('#instances').children)button.dataset.runState=state.runs.find(r=>r.id===button.dataset.instanceId)?.state||'idle';
}
function renderAccount(){controls();}
function render() {
  text('#instance-count', state.instances.length);
  text('#managed-root',state.managedRoot||'');$('#managed-root').title=state.managedRoot||'';
  const list=$('#instances'),existing=new Map([...list.children].map(button=>[button.dataset.instanceId,button])),keep=new Set();
  state.instances.forEach((instance,index)=>{
    let button=existing.get(instance.id);
    if(!button){button=document.createElement('button');button.className='instance';button.dataset.instanceId=instance.id;button.innerHTML='<span class="instance-avatar"></span><span class="instance-text"><strong></strong><small></small></span>';}
    button.setAttribute('aria-current',String(instance.id===state.selected));
    const title=button.querySelector('strong'),meta=button.querySelector('small'),avatar=button.querySelector('.instance-avatar');
    const titleText=instance.name,metaText=instance.error?'配置需要修复':`${instance.loader} · Java ${instance.javaMajor}`;
    if(title.textContent!==titleText)title.textContent=titleText;if(meta.textContent!==metaText)meta.textContent=metaText;avatar.textContent=instance.name.slice(0,2).toUpperCase();
    button.onclick=()=>{if(state.busy||state.selected===instance.id)return;const direction=index-state.instances.findIndex(i=>i.id===state.selected);remember();state.selected=instance.id;message(null);render();remember();experience.transition(Math.sign(direction));};
    if(list.children[index]!==button)list.insertBefore(button,list.children[index]||null);keep.add(button);
  });
  for(const button of [...list.children])if(!keep.has(button))button.remove();
  const selected = item(); $('#empty').hidden = !!selected; $('#details').hidden = !selected;
  if (selected) {
    text('#pack-name', selected.name); text('#pack-icon', selected.name.slice(0, 2).toUpperCase());
    text('#pack-meta', selected.error ? '已安装实例' : `${selected.loader} / ${selected.minecraft}`);
    text('#isolation-hint', selected.isolation?.mode === 'unknown' ? '请选择游戏目录' : '');
    const native=state.launchInputs?.[selected.id],saved=preferences.instances?.[prefKey(selected)]||native&&{...native,memory:native.memoryMB};
    for(const [selector,value]of [['#jvm-args',saved?.jvmArgs||''],['#game-args',saved?.gameArgs||''],['#window-mode',saved?.windowMode||'default']])$(selector).value=value;
    $('#directory-mode').options[0].textContent=selected.managed?'独立实例目录':'跟随识别结果';
    $('#directory-mode').value=selected.managed?'auto':['auto','shared','isolated'].includes(saved?.mode)?saved.mode:'auto';
    memoryUI.restore(saved);
    pathLabel(); text('#check-result', '');
    if (selected.error) message(selected.error);
  }
  renderJava();renderAccount();void worldUI?.load(selected);
}
worldUI=mountWorlds({api,onChange:controls,onError:message});
$('#stop-play').onclick=()=>action(()=>api.stopPlay());
$('#clear-play').onclick=()=>action(async()=>{await api.clearPlay();});
function syncPlay(value,force=false){const previous=state.play?.context,changed=previous?.roomId!==value.context?.roomId||previous?.instanceId!==value.context?.instanceId;state.play=value;if(value.context?.instanceId&&(changed||force)){state.selected=value.context.instanceId;$('#host-port').value=value.context.port||25565;worldUI.setTab(value.context.role==='host'?'worlds':'settings');}controls();}
function applyHomeOpen(event){if(event.gameIdentity){state.gameIdentity=event.gameIdentity;state.accountMode=event.gameIdentity.accountMode;}if(event.settings){state.launchInputs||={};state.launchInputs[event.id]=event.settings;}if(event.javaPath)state.javaPath=event.javaPath;if(event.id)state.selected=event.id;if(event.accountMode)state.accountMode=event.accountMode;render();worldUI.setTab('settings');remember();$('#java-select').focus({preventScroll:true});$('#instance-content').scrollTop=0;}
async function action(fn,operation='change') { if(state.busy)return;message(null); state.busy = true;state.operation=operation; controls(); try { await fn(); } catch (e) { libraryScanMotion?.fail(e);libraryScanMotion=null;message(e); } finally { state.busy = false;state.operation=null; controls(); } }
$('#pick-java').onclick = () => action(async () => { const java = await api.pickJava(); if(java)setJava(java); });
$('#scan-java').onclick=scanJava;
$('#java-select').onchange=()=>action(async()=>{const selected=$('#java-select').value;if(!selected){renderJava();return;}try{setJava(await api.selectJava(selected));}catch(error){renderJava();throw error;}});
$('#connection-mode').onchange=async()=>{const previous=state.connectionMode||'auto',value=$('#connection-mode').value;$('#connection-mode').disabled=true;try{if(typeof api?.setConnectionMode!=='function')throw Error('请更新客户端后使用联机设置');await api.setConnectionMode(value);state.connectionMode=value;remember();message(null);}catch(error){$('#connection-mode').value=previous;message(error);}finally{controls();}};
for(const selector of ['#jvm-args','#game-args','#window-mode'])$(selector).addEventListener('input',()=>{remember();text('#launch-settings-result','');});
$('#save-launch-settings').onclick=()=>action(async()=>{await api.saveLaunchSettings(input());remember();text('#launch-settings-result','已保存');},'save');
$('#directory-mode').onchange = () => { pathLabel(); remember(); };
$('#check').onclick = () => action(async () => { const result = await api.check(input()); text('#check-result', `${result.files} 个文件校验通过${result.accountReady ? '，可以启动' : '，还需登录微软账号'}`); text('#game-path', result.gamePath); },'check');
$('#launch').onclick = () => action(async () => { await api.start(input()); text('#check-result', '已创建游戏进程，等待游戏窗口打开'); },'launch');
$('#launch-configure').onclick=()=>{if(!state.gameIdentity?.name||state.accountMode==='microsoft'&&!state.account.profile){$('#rooms').click();return;}worldUI.setTab('settings');$('#java-select').focus({preventScroll:true});$('#java-select').scrollIntoView({block:'center',behavior:'smooth'});};
$('#rooms').onclick=api?createLibraryReturn({api,remember,read:()=>item()?input():undefined,onError:message,onBusy:value=>{$('#rooms').disabled=value;}}):()=>location.assign('/app/#home');
$('.brand').onclick = event => { event.preventDefault(); $('#rooms').click(); };
if (!api) { $('#web-note').hidden = false; text('#surface-label', '网页预览'); render(); }
else {
  api.onEvent(event => {
    if(event.type==='surface-shown')void memoryUI.refresh();
    if(event.type==='surface-shown')animatePage(document.querySelector('.workspace'));
    if(event.type==='close-blocked'){message(event.message);document.querySelector('#message').scrollIntoView({block:'nearest'});}
    if(event.type==='library-scanning'){libraryScanMotion?.cancel();libraryScanMotion=miningFeedback.start('正在识别整合包',{success:'游戏库已更新'});}
    if(event.type==='library'){libraryScanMotion?.done();libraryScanMotion=null;const key=item()&&prefKey(item());Object.assign(state,event);state.selected=state.instances.find(i=>prefKey(i)===key)?.id||state.instances[0]?.id;render();}
    if(event.type==='game-play'){const previous=state.selected;syncPlay(event);if(previous!==state.selected)render();}
    if(event.type==='game-identity'){state.gameIdentity=event.identity;state.accountMode=event.identity.accountMode;controls();}
    if(event.type==='home-open'){if(initialized)applyHomeOpen(event);else homeOpen=event;}
    if(event.type==='pack-selected'){state.selected=event.id;render();remember();}
    if (event.type === 'account') { state.account = event; renderAccount(); }
    if (event.type === 'run') { state.runs = [...state.runs.filter(r => r.id !== event.id), event]; controls(); if (event.id === state.selected) text('#check-result', event.message); if (event.state === 'failed') message(event.message); }
  });
  api.state().then(result => { Object.assign(state, result);$('#connection-mode').value=result.connectionMode==='relay'?'relay':'auto';if(result.memory)memoryUI.update(result.memory);memoryUI.start(); state.selected = result.selectedInstance || state.instances.find(i => prefKey(i) === preferences.selected)?.id || state.instances[0]?.id; state.accountMode=result.gameIdentity?.accountMode||'offline';initialized=true;render();if(result.play)syncPlay(result.play,true);if(homeOpen){applyHomeOpen(homeOpen);homeOpen=null;}void scanJava(); }).catch(message);
}

if(api){
  mountPackInstaller({api,onBusy:value=>{state.installBusy=value;document.body.classList.toggle('installing-pack',value);controls();},onError:message,onInstalled:async instance=>{const result=await api.state();Object.assign(state,result);state.selected=instance.id;state.javaInstallations=await api.scanJava();render();remember();},});
  $('#pick-install-root').onclick=()=>action(async()=>{const value=await api.pickInstallRoot();if(value){state.managedRoot=value;render();}});
}
