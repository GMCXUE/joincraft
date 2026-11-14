import '../focus.js';
import {animateLayoutChange} from '../motion.js';
import {validateForm} from '../interaction.js';
import {appDestination} from './session.js';
const $=selector=>document.querySelector(selector);
const params=new URLSearchParams(location.search),destination=appDestination(params.get('next'),location.origin);
const desktop=params.has('desktop'),id=params.get('desktop');
const form=$('#account-form'),fields=$('#account-fields'),error=$('#form-error'),submit=$('#submit'),switchMode=$('#switch-mode');
form.noValidate=true;$('#username').dataset.validation='账号需要 3–24 位字母、数字或下划线';
let registering=false,busy=false,attempt=0,ready=!desktop,timer,view='form',approved=false,browserHasAccount=false;
function submitLabel(){return registering?(desktop?'创建账号并登录客户端':'创建账号并登录'):(desktop?'登录并返回客户端':'登录');}
function setMode(register){
 registering=register;
 $('#account-title').textContent=register?'创建账号':desktop?'登录客户端':'登录 joincraft';
 document.title=(register?'创建账号':'登录')+' · joincraft';submit.textContent=submitLabel();
 $('#confirm-field').hidden=!register;$('#confirm').disabled=!register;$('#confirm').required=register;
 $('#password').autocomplete=register?'new-password':'current-password';$('#password').minLength=register?10:1;
 $('#password-hint').hidden=!register;
 $('#switch-caption').textContent=register?'已有账号？':'还没有账号？';switchMode.textContent=register?'去登录':'创建账号';error.textContent='';
 for(const input of form.querySelectorAll('input'))input.removeAttribute('aria-invalid');$('#confirm').value='';
 const page=new URL(location.href);page.searchParams.delete('mode');if(register)page.searchParams.set('mode','register');history.replaceState(null,'',page.pathname+page.search);
}
function lock(value){busy=value;fields.disabled=value||!ready;switchMode.disabled=value||!ready;$('#desktop-confirm').disabled=value;$('#desktop-switch').disabled=value;$('#desktop-cancel').disabled=value;form.setAttribute('aria-busy',String(value));submit.setAttribute('aria-busy',String(value));$('#desktop-confirm').setAttribute('aria-busy',String(value));}
function show(next){
 view=next;form.hidden=next!=='form';$('.account-switch').hidden=next!=='form';$('#desktop-account').hidden=next!=='account';$('#desktop-result').hidden=!['waiting','success','cancelled','expired','failed'].includes(next);
 $('#desktop-cancel').hidden=!desktop||['success','cancelled','expired','failed'].includes(next);$('#desktop-error').hidden=true;
 if(next==='account')$('#account-title').textContent='确认登录客户端';
 if(['waiting','success','cancelled','expired','failed'].includes(next)){
  const labels={waiting:['正在连接客户端','请保持客户端开启，登录会自动完成。'],success:['网页授权已完成','请回到 joincraft 查看登录结果。'],cancelled:['登录已取消','如需登录，请从客户端重新发起。'],expired:['登录已过期','请回到客户端，重新发起登录。'],failed:['暂时无法登录','请回到客户端，重新发起登录。']};
  $('#account-title').textContent=next==='waiting'?'即将进入 joincraft':'joincraft';
  $('#desktop-result-title').textContent=labels[next][0];$('#desktop-result-note').textContent=labels[next][1];$('#desktop-result').dataset.state=next;
  const mark=next==='success'?'<path d="m5 12 4 4L19 6"/>':next==='waiting'||next==='expired'?'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>':'<path d="m6 6 12 12M6 18 18 6"/>';
  $('#desktop-mark').innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+mark+'</svg>';
 }
}
async function request(path,body){
 const response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
 const result=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error(result.error||'暂时无法连接服务器，请稍后重试'),{status:response.status});return result;
}
function announce(){
 try{localStorage.removeItem('blockroom-device-session-v1');localStorage.setItem('blockroom-auth-change',String(Date.now()));}catch{}
 try{sessionStorage.removeItem('blockroom-device-session-v1');}catch{}
 $('#password').value='';$('#confirm').value='';
}
function finish(){announce();location.replace(destination);}
function flowError(err){
 if([400,403,409,410].includes(err.status)){ready=false;show(err.status===410?'expired':'failed');$('#desktop-result-note').textContent=err.message;clearTimeout(timer);return;}
 $('#desktop-error').textContent=err.name==='TimeoutError'?'连接超时，请重试':err instanceof TypeError?'无法连接服务器，请检查网络后重试':err.message;$('#desktop-error').hidden=false;
}
function schedule(){clearTimeout(timer);timer=setTimeout(()=>void refreshFlow(),2000);}
async function refreshFlow(){
 try{
  const info=await request('/api/auth/desktop/info',{id});
  $('#desktop-code').textContent=info.code;$('#desktop-context').hidden=false;
  if(info.phase==='claimed'){ready=false;show('success');clearTimeout(timer);return;}
  if(info.phase==='cancelled'){ready=false;show('cancelled');clearTimeout(timer);return;}
  if(info.phase==='approved'){approved=true;show('waiting');schedule();return;}
  if(approved){ready=false;show('failed');return;}
  ready=true;lock(busy);
 }catch(err){flowError(err);if(approved&&![400,403,409,410].includes(err.status))schedule();}
}
async function authorize(){
 await request('/api/auth/desktop/authorize',{id});announce();approved=true;show('waiting');schedule();
}
setMode(params.get('mode')==='register');
if(desktop){fields.disabled=true;switchMode.disabled=true;$('#desktop-cancel').hidden=false;}
switchMode.addEventListener('click',()=>{if(!busy){animateLayoutChange($('.account-content'),()=>setMode(!registering));$('#username').focus({preventScroll:true});}});
form.addEventListener('click',event=>{
 const button=event.target.closest('[data-password]');if(!button)return;
 const input=document.getElementById(button.dataset.password),show=input.type==='password';input.type=show?'text':'password';button.textContent=show?'隐藏':'显示';button.setAttribute('aria-pressed',String(show));button.setAttribute('aria-label',(show?'隐藏':'显示')+(input.id==='confirm'?'确认密码':'密码'));
});
form.addEventListener('input',event=>{event.target.removeAttribute('aria-invalid');error.textContent='';});
form.addEventListener('submit',async event=>{
 event.preventDefault();if(busy||!ready)return;if(!validateForm(form,error))return;
 const data=new FormData(form),password=String(data.get('password')||'');error.textContent='';
 if(registering&&password!==data.get('confirm')){error.textContent='两次输入的密码不一致';$('#confirm').setAttribute('aria-invalid','true');$('#confirm').focus();return;}
 attempt++;lock(true);let authorizing=false;submit.textContent=registering?'正在创建…':'正在登录…';
 try{
  if(desktop&&registering&&browserHasAccount){await request('/api/auth/logout',{});browserHasAccount=false;}
  await request('/api/auth/'+(registering?'register':'login'),{username:String(data.get('username')||'').trim(),password});
  if(desktop){authorizing=true;await authorize();}else finish();
 }catch(err){error.textContent=err.name==='TimeoutError'?'连接超时，请重试':err instanceof TypeError?'无法连接服务器，请检查网络后重试':err.message;if(err.status===401)$('#password').setAttribute('aria-invalid','true');if(authorizing&&[403,409,410].includes(err.status))flowError(err);}
 finally{lock(false);$('#confirm').disabled=!registering;submit.textContent=submitLabel();if($('#password').hasAttribute('aria-invalid'))$('#password').focus();}
});
$('#desktop-confirm').addEventListener('click',async()=>{if(busy||!ready)return;lock(true);try{await authorize();}catch(err){flowError(err);}finally{lock(false);}});
$('#desktop-switch').addEventListener('click',()=>{if(busy)return;attempt++;setMode(false);show('form');$('#username').focus();});
$('#desktop-cancel').addEventListener('click',async()=>{if(busy)return;lock(true);try{const result=await request('/api/auth/desktop/deny',{id});ready=false;clearTimeout(timer);show(result.phase==='claimed'?'success':'cancelled');}catch(err){flowError(err);}finally{lock(false);}});
async function restoreAccount(){
 try{
  const state=await request('/api/state');
  if(state.profile?.kind==='account')browserHasAccount=true;
  if(attempt===0&&state.profile?.kind==='account'){
   if(!desktop){finish();return;}
   if(view==='form'&&ready){$('#desktop-name').textContent=state.profile.name;$('#desktop-username').textContent='@'+state.profile.username;show('account');}
  }
 }catch{/* Credentials form remains usable if there is no session. */}
}
async function initialize(){
 if(desktop){
  if(!/^[A-Za-z0-9_-]{32}$/.test(id||'')){flowError(Object.assign(new Error('登录链接无效，请从客户端重新发起'),{status:400}));return;}
  await refreshFlow();if(!ready||approved)return;
 }
 await restoreAccount();
}
void initialize();
window.addEventListener('pagehide',()=>clearTimeout(timer));
window.addEventListener('pageshow',event=>{if(event.persisted)void initialize();});
