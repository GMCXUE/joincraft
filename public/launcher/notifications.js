import '../focus.js';
import {createUpdatesUI} from './updates.js';
const api=window.joincraftUpdates;
if(api){
  createUpdatesUI(api);
  const panel=document.querySelector('#client-updates'),confirm=document.querySelector('#install-confirm');
  const finish=async accepted=>{confirm.close();await api.confirmInstall?.(accepted);};
  document.querySelector('#install-later').onclick=()=>void finish(false);
  document.querySelector('#install-accept').onclick=()=>void finish(true);
  confirm.addEventListener('cancel',event=>{event.preventDefault();void finish(false);});
  api.onEvent(event=>{
    if(event.type==='install-confirmation'){
      document.querySelector('#install-confirm-copy').textContent=`将更新至 joincraft ${event.version}，当前房间和语音连接会断开。`;
      if(!confirm.open)confirm.showModal();document.querySelector('#install-later').focus();
    }
    if(event.type==='surface-shown'){
      if(confirm.open)confirm.close();
      if(!matchMedia('(prefers-reduced-motion: reduce)').matches)panel.animate([{opacity:0,transform:'translateY(8px) scale(.98)'},{opacity:1,transform:'none'}],{duration:180,easing:'cubic-bezier(.23,1,.32,1)'});
      document.querySelector('#update-close').focus();
    }
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!confirm.open){event.preventDefault();void api.close?.();}
    if(event.key!=='Tab'||confirm.open)return;
    const focusable=[...panel.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled)')].filter(el=>el.getClientRects().length);
    const first=focusable[0],last=focusable.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  });
  document.body.addEventListener('click',event=>{if(event.target===document.body&&!confirm.open)void api.close?.();});
}
