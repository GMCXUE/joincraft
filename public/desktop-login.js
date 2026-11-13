// A native success event means a cookie was installed; the visible app must still verify it.
export async function loadDesktopAccount(load,profileId,{delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 let error;
 for(let attempt=0;attempt<3;attempt++){
  try{
   const state=await load();
   if(state?.profile?.kind!=='account'||!state.profile.id||(profileId&&state.profile.id!==profileId))throw Object.assign(new Error('客户端会话未生效，请重新登录'),{status:401});
   return state;
  }catch(reason){error=reason;if(reason.status&&![401,408,429,502,503,504].includes(reason.status))throw reason;}
  if(attempt<2)await delay(200*(attempt+1));
 }
 throw error;
}
export function mountDesktopLogin({escape,onSuccess,onComplete=()=>{},onBusy=()=>{}}){
 const bridge=window.blockroomDesktop,dialog=document.querySelector('#auth-dialog'),body=document.querySelector('#auth-body');
 if(!bridge?.beginLogin)return null;
 let active=false,mode='login',phase='idle',successful=false,syncing=false,generation=0,completion=null;
 const complete=async state=>{
  if(successful||syncing)return;
  const version=++generation;completion=state;active=true;syncing=true;
  paint({phase:'completing'});if(!dialog.open)dialog.showModal();
  try{
   await onSuccess(state);
   if(version!==generation||!active)return;
   successful=true;active=false;dialog.close();
   void bridge.acknowledgeLogin?.().catch(()=>{});
   onComplete();
  }catch(error){
   if(version===generation&&active)paint({phase:'failed',message:error.message||'账号连接失败，请重试',syncFailed:![401,403,409].includes(error.status)});
  }finally{if(version===generation){syncing=false;onBusy(false);}}
 };
 const paint=state=>{
  phase=state.phase;
  if(phase==='success'){void complete(state);return;}
  if(!active)return;
  if(phase==='cancelled'||phase==='idle'){active=false;onBusy(false);dialog.close();return;}
  onBusy(phase==='completing');
  const ended=['failed','expired'].includes(phase),opening=phase==='opening',completing=phase==='completing';
  body.innerHTML=`<div class="browser-login"><h2 id="auth-title">${ended?'登录未完成':completing?'正在完成登录':'在浏览器中登录'}</h2><p class="dialog-description" role="status">${escape(ended?state.message:opening?'正在打开系统浏览器…':completing?'正在连接你的账号…':'在打开的网页中登录，完成后会自动返回这里。')}</p>${state.code?`<div class="login-pair"><span>登录编号</span><strong>${escape(state.code)}</strong></div><p class="login-pair-note">请核对网页上的编号。请求在 5 分钟后失效。</p>`:''}${!ended&&state.message?`<p class="form-error" role="alert">${escape(state.message)}</p>`:''}<div class="browser-login-actions">${state.url&&!ended&&!opening&&!completing?`<a class="button primary" href="${escape(state.url)}" data-login="reopen">重新打开浏览器</a>`:`<button class="button primary" type="button" data-login="${ended?(state.syncFailed?'retry-sync':'retry'):'reopen'}" ${opening||completing?'disabled':''}>${ended?(state.syncFailed?'重试连接':'重新发起登录'):'重新打开浏览器'}</button>`}<button class="button secondary" type="button" data-login="cancel" ${completing?'disabled':''}>取消</button></div></div>`;
 };
 const open=async nextMode=>{
  generation++;active=true;successful=false;syncing=false;completion=null;mode=nextMode;paint({phase:'opening'});
  if(!dialog.open)dialog.showModal();
  try{paint(await bridge.beginLogin(mode));}catch(error){paint({phase:'failed',message:error.message});}
 };
 body.addEventListener('click',async event=>{
  const action=event.target.closest('[data-login]')?.dataset.login;if(!action)return;event.preventDefault();
  if(syncing)return;
  if(action==='cancel'){dialog.close();return;}
  if(action==='retry-sync'){void complete(completion);return;}
  if(action==='retry'){await bridge.cancelLogin().catch(()=>{});void open(mode);return;}
  event.target.disabled=true;try{paint(await bridge.reopenLogin());}catch(error){paint({phase:'failed',message:error.message});}
 });
 dialog.addEventListener('cancel',event=>{if(syncing)event.preventDefault();});
 dialog.addEventListener('close',()=>{if(active&&!dialog.open){generation++;active=false;onBusy(false);void bridge.cancelLogin().catch(()=>{});}});
 bridge.onLoginState(paint);
 void bridge.loginState().then(state=>{if(['opening','waiting','completing'].includes(state.phase)){active=true;mode=state.mode||'login';paint(state);if(!dialog.open)dialog.showModal();}else if(state.phase==='success')paint(state);}).catch(()=>{});
 return {open};
}
