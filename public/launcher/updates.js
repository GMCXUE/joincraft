import {clientIcon,revealClientPanel} from './experience.js';
import {formatETA} from '../pack-progress.js';
export function updateErrorState(state,action,error){return {...state,phase:'error',errorStage:action==='check'?'check':['download','cancel'].includes(action)?'download':'install',error:error?.message||'操作未完成，请重试'};}
export function updateETA(state){return state.phase==='downloading'&&Number.isFinite(state.total)&&Number.isFinite(state.transferred)&&state.total>state.transferred&&state.bytesPerSecond>0&&Number.isFinite(state.bytesPerSecond)?formatETA((state.total-state.transferred)/state.bytesPerSecond):'';}
export function createUpdatesUI(api){
 const $=s=>document.querySelector(s);let state={phase:'unsupported',currentVersion:'—',message:'更新功能在桌面客户端中可用。'},pending=false,pendingAction='',lastPhase='';
 const labels={idle:'检查更新',checking:'正在检查…',available:'有新版本',downloading:'正在下载',cancelling:'正在取消…',downloaded:'更新已就绪',confirming:'等待重启确认',installing:'正在准备更新…',error:'更新未完成',unsupported:'客户端更新'};
 const bytes=n=>!Number.isFinite(n)||n<=0?'0 MB':`${(n/1024/1024).toFixed(1)} MB`;
 const set=(selector,value)=>{const el=$(selector);if(el.textContent!==value)el.textContent=value;};
 function render(){
  const phase=state.phase,download=['downloading','cancelling'].includes(phase),panel=$('#client-updates');panel.dataset.phase=phase;
  set('#update-current',`当前版本 ${state.currentVersion}`);
  set('#update-status',phase==='idle'?(state.lastChecked?'已是最新版本':'检查客户端的新版本'):phase==='available'?`发现新版本 ${state.version}`:phase==='downloaded'?`${state.version} 已下载`:labels[phase]||'客户端更新');
  const eta=updateETA(state);
  set('#update-detail',state.error||state.message||(phase==='downloaded'?(state.gameRunning?'游戏运行中，退出游戏后可更新。':'重启客户端后完成更新。'):download?`${bytes(state.transferred)} / ${bytes(state.total)} · ${bytes(state.bytesPerSecond)}/s${eta?' · 剩余'+eta:''}`:phase==='installing'?'正在校验和准备更新文件…':''));
  $('#update-detail').classList.toggle('update-error',Boolean(state.error));
  $('#update-progress-wrap').hidden=!download;const percent=Math.max(0,Math.min(100,Number(state.percent)||0));$('#update-progress').value=percent;set('#update-percent',`${Math.floor(percent)}%`);
  $('#update-notes-wrap').hidden=!state.notes;set('#update-notes',state.notes||'');
  const check=$('#update-check'),fetch=$('#update-download'),install=$('#update-install'),cancel=$('#update-cancel');
  check.hidden=!['idle','checking','unsupported'].includes(phase)&&!(phase==='error'&&state.errorStage==='check');check.disabled=pending||['checking','unsupported'].includes(phase);check.setAttribute('aria-busy',String(phase==='checking'||pendingAction==='check'));
  check.textContent=phase==='checking'||pendingAction==='check'?'正在检查…':phase==='error'?'重试检查':'检查更新';
  fetch.hidden=!(phase==='available'||phase==='error'&&state.errorStage==='download');fetch.disabled=pending;fetch.textContent=pendingAction==='download'?'准备下载…':phase==='error'?'重新下载':'下载更新';fetch.setAttribute('aria-busy',String(pendingAction==='download'));
  install.hidden=!['downloaded','confirming','installing'].includes(phase)&&!(phase==='error'&&state.errorStage==='install');install.disabled=pending||!['downloaded','error'].includes(phase)||!state.canInstall;install.textContent=phase==='installing'?'正在准备更新…':phase==='error'?'重试更新':'重启更新';install.setAttribute('aria-busy',String(phase==='installing'));
  cancel.hidden=!download;cancel.disabled=phase==='cancelling';cancel.textContent=phase==='cancelling'?'正在取消…':'取消下载';cancel.setAttribute('aria-busy',String(phase==='cancelling'));
  if(lastPhase!==phase){const mark=$('#update-status-mark');mark.innerHTML=clientIcon(phase==='error'?'alert':phase==='downloaded'?'check':['checking','confirming','installing'].includes(phase)?'refresh':['available','downloading','cancelling'].includes(phase)?'download':'cube');if(lastPhase)revealClientPanel(mark);lastPhase=phase;}
 }
 async function act(name){if(pending&&name!=='cancel')return;const main=name!=='cancel';if(main){pending=true;pendingAction=name;}render();try{state=await api.updates[name]();}catch(error){const fresh=await api.updates.state().catch(()=>state);state=updateErrorState(fresh,name,error);}finally{if(main){pending=false;pendingAction='';}render();}}
 $('#update-close').onclick=()=>api?.close?api.close():window.close();
 for(const name of ['check','download','cancel','install'])$('#update-'+name).onclick=()=>void act(name);
 if(api?.updates){api.onEvent(event=>{if(event.type==='update'){state=event;render();}if(event.type==='run')api.updates.state().then(value=>{state=value;render();}).catch(()=>{});});api.updates.state().then(value=>{state=value;render();}).catch(()=>{});}
 render();
}
