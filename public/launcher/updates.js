export function createUpdatesUI(api){
 const $=s=>document.querySelector(s);
 let state={phase:'unsupported',currentVersion:'—',message:'更新功能在桌面客户端中可用。'},pending=false;
 const labels={idle:'检查更新',checking:'正在检查…',available:'有新版本',downloading:'正在下载',cancelling:'正在取消…',downloaded:'更新已就绪',confirming:'等待重启确认',installing:'正在准备更新…',error:'更新未完成',unsupported:'客户端更新'};
 const bytes=n=>!Number.isFinite(n)||n<=0?'0 MB':`${(n/1024/1024).toFixed(1)} MB`;
 function render(){
  const phase=state.phase,download=phase==='downloading'||phase==='cancelling';
  $('#update-current').textContent=`当前版本 ${state.currentVersion}`;
  $('#update-status').textContent=phase==='idle'?(state.lastChecked?'已是最新版本':'检查客户端的新版本'):phase==='available'?`发现新版本 ${state.version}`:phase==='downloaded'?`${state.version} 已下载`:labels[phase];
  $('#update-detail').textContent=state.error||state.message||(phase==='downloaded'?(state.gameRunning?'游戏运行中，退出游戏后可更新。':'重启客户端后完成更新。'):phase==='downloading'?`${bytes(state.transferred)} / ${bytes(state.total)} · ${bytes(state.bytesPerSecond)}/s`:phase==='installing'?'正在校验和准备更新文件…':'');
  $('#update-detail').classList.toggle('update-error',Boolean(state.error));
  $('#update-progress-wrap').hidden=!download;$('#update-progress').value=state.percent||0;$('#update-percent').textContent=`${Math.floor(state.percent||0)}%`;
  $('#update-notes-wrap').hidden=!state.notes;$('#update-notes').textContent=state.notes||'';
  const check=$('#update-check'),fetch=$('#update-download'),install=$('#update-install'),cancel=$('#update-cancel');
  check.hidden=!['idle','checking','unsupported'].includes(phase)&&!(phase==='error'&&state.errorStage==='check');check.disabled=pending||['checking','unsupported'].includes(phase);
  check.textContent=phase==='checking'?'正在检查…':phase==='error'?'重试检查':'检查更新';
  fetch.hidden=!(phase==='available'||phase==='error'&&state.errorStage==='download');fetch.disabled=pending;fetch.textContent=phase==='error'?'重新下载':'下载更新';
  install.hidden=!['downloaded','confirming','installing'].includes(phase);install.disabled=pending||phase!=='downloaded'||!state.canInstall;install.textContent=phase==='installing'?'正在准备更新…':'重启更新';
  cancel.hidden=!download;cancel.disabled=phase==='cancelling';
 }
 async function act(name){if(pending&&name!=='cancel')return;const main=name!=='cancel';if(main)pending=true;render();try{state=await api.updates[name]();}catch(e){state={...state,error:e.message};}finally{if(main)pending=false;render();}}
 $('#update-close').onclick=()=>api?.close?api.close():window.close();
 for(const name of ['check','download','cancel','install'])$('#update-'+name).onclick=()=>void act(name);
 if(api?.updates){api.onEvent(event=>{if(event.type==='update'){state=event;render();}if(event.type==='run')api.updates.state().then(value=>{state=value;render();}).catch(()=>{});});api.updates.state().then(value=>{state=value;render();}).catch(()=>{});}
 render();
}
