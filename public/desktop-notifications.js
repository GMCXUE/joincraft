export function mountDesktopNotifications(){
 const api=window.joincraftNotifications;if(!api)return;
 const host=document.querySelector('.title-tools')||document.querySelector('.titlebar');if(!host)return;
 const bell=document.createElement('button');bell.className='desktop-notification-bell';bell.type='button';bell.setAttribute('aria-label','通知');bell.title='通知';
 bell.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span class="desktop-notification-dot" hidden></span>';host.append(bell);
 const notice=document.createElement('aside');notice.className='desktop-update-notice';notice.hidden=true;notice.setAttribute('aria-label','客户端更新通知');
 notice.innerHTML='<div class="desktop-notice-copy" role="status" aria-live="polite"><small>客户端更新</small><strong></strong></div><div class="desktop-notice-actions"><button type="button" class="desktop-notice-later">稍后</button><button type="button" class="desktop-notice-view">查看更新</button></div>';document.body.append(notice);
 let claiming=false;
 async function open(){try{await api.open();notice.hidden=true;}catch{notice.hidden=false;notice.querySelector('strong').textContent='打开通知失败，请重试';}}
 bell.onclick=open;notice.querySelector('.desktop-notice-view').onclick=open;notice.querySelector('.desktop-notice-later').onclick=()=>{notice.hidden=true;};
 async function refresh(){
  try{const state=await api.state();bell.querySelector('span').hidden=!state.version||['idle','checking','unsupported'].includes(state.phase);
   if(!['available','downloaded'].includes(state.phase))notice.hidden=true;
   if(claiming||document.visibilityState==='hidden')return;claiming=true;
   try{const announcement=await api.claim();if(announcement){notice.querySelector('strong').textContent=`joincraft ${announcement.version} 可更新`;notice.hidden=false;}}finally{claiming=false;}
  }catch{/* Updates never interrupt rooms or game controls. */}
 }
 api.onEvent(()=>void refresh());window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);void refresh();
}
