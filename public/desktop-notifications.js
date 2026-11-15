// This bridge controls client updates only. Social/system notices live in the app inbox.
const icon=(name)=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${name==='restart'?'<path d="M20 7v5h-5M20 12a8 8 0 1 0-2 6"/>':name==='alert'?'<path d="m12 3 10 18H2L12 3Z M12 9v4M12 17h.01"/>':'<path d="M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6"/>'}</svg>`;
export function updateEntryState(state={}){
 const phase=state.phase||'idle',percent=Math.floor(Math.max(0,Math.min(100,Number(state.percent)||0)));
 const busy=['downloading','cancelling','confirming','installing'].includes(phase);
 const label=phase==='downloading'?`正在下载更新 ${percent}%`:
  phase==='cancelling'?'正在取消更新下载':phase==='downloaded'?`更新已下载，重启至 ${state.version}`:
  ['confirming','installing'].includes(phase)?'正在准备重启更新':phase==='available'?`下载客户端更新 ${state.version}`:
  phase==='error'?'更新失败，点击重试':'检查客户端更新';
 const visible=Boolean(state.version)&&!['idle','unsupported'].includes(phase);
 return {phase,percent,label,busy,visible,active:!['idle','checking','unsupported'].includes(phase),icon:phase==='downloaded'?'restart':phase==='error'?'alert':'download'};
}
export function mountDesktopUpdates(){
 const api=window.joincraftClientUpdates||window.joincraftNotifications;if(!api)return;
 const rail=document.querySelector('.rail-bottom');
 const host=rail||document.querySelector('.library-return')||document.querySelector('.retry-actions');
 if(!host||host.querySelector('.client-update-entry'))return;
 const button=document.createElement('button');button.type='button';button.hidden=true;button.className='client-update-entry';
 if(rail)host.classList.add('has-client-update');else button.classList.add('client-update-inline');
 button.innerHTML=`${icon('download')}<span class="client-update-label">客户端更新</span><span class="client-update-progress" hidden></span>`;
 if(rail)host.insertBefore(button,host.querySelector('#account-entry'));else host.prepend(button);
 const status=document.createElement('span');status.className='client-update-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');host.append(status);
 let phase='',refreshing=false;
 function render(state){
  const view=updateEntryState(state);button.dataset.phase=view.phase;button.hidden=!view.visible;button.classList.toggle('has-update',view.active);
  button.setAttribute('aria-label',view.label);button.title=view.label;
  button.querySelector('svg').outerHTML=icon(view.icon);
  const progress=button.querySelector('.client-update-progress');progress.hidden=!['downloading','cancelling'].includes(view.phase);progress.textContent=String(view.percent);
  button.querySelector('.client-update-label').textContent=view.active?view.label:'客户端更新';
  if(phase!==view.phase){if(view.active)status.textContent=view.label;phase=view.phase;}
 }
 button.onclick=async()=>{button.disabled=true;try{await api.open();}catch{status.textContent='打开更新失败，请重试';button.title=status.textContent;}finally{button.disabled=false;}};
 async function refresh(){if(refreshing)return;refreshing=true;try{render(await api.state());}catch{/* An unavailable updater never interrupts rooms. */}finally{refreshing=false;}}
 api.onEvent(()=>void refresh());window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);void refresh();
}
