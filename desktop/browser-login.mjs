import {EventEmitter} from 'node:events';
import {createHash,randomBytes} from 'node:crypto';

function trustedOrigin(value){
 const url=new URL(value);
 if(url.username||url.password||(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))))throw new Error('登录服务须使用 HTTPS');
 return url.origin;
}
// Serialize cookie activation so an older cancelled request cannot replace a newer login.
export function sessionAcceptor(cookies,serverURL,verify=async()=>{}){
 const origin=trustedOrigin(serverURL),secure=origin.startsWith('https:'),name=secure?'__Host-blockroom_session':'blockroom_session';
 let queue=Promise.resolve();
 return (session,isCurrent)=>{
  const work=async()=>{
   if(!isCurrent())return;
   try{
    await cookies.set({url:origin+'/',name,value:session.token,path:'/',secure,httpOnly:true,sameSite:'strict',expirationDate:session.expiresAt/1000});
    await cookies.flushStore();
    if(isCurrent())await verify(session);
    if(isCurrent())return;
   }catch(error){await removeOwn().catch(()=>{});throw error;}
   await removeOwn();
   async function removeOwn(){const rows=await cookies.get({url:origin+'/',name});if(rows.some(row=>row.value===session.token))await cookies.remove(origin+'/',name);}
  };
  const result=queue.then(work,work);queue=result.catch(()=>{});return result;
 };
}

export class BrowserLogin extends EventEmitter {
 #attempt=null;#opening=null;#state={phase:'idle'};
 constructor({serverURL,openBrowser,acceptSession,fetcher=fetch,now=Date.now,intervalMs=2000}){
  super();this.origin=trustedOrigin(serverURL);this.openBrowser=openBrowser;this.acceptSession=acceptSession;this.fetcher=fetcher;this.now=now;this.intervalMs=intervalMs;
 }
 state(){return {...this.#state};}
 #set(value){this.#state=value;this.emit('change',this.state());return this.state();}
 #current(attempt){return this.#attempt===attempt&&!attempt.controller.signal.aborted;}
 async #request(action,body,signal){
  const response=await this.fetcher(this.origin+'/api/auth/desktop/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(result.error||'登录服务暂时不可用'),{status:response.status});
  return result;
 }
 start(mode='login'){
  if(!['login','register'].includes(mode))return Promise.reject(new Error('登录方式无效'));
  if(this.#opening)return this.#opening;
  if(this.#attempt&&this.#state.mode===mode)return Promise.resolve(this.state());
  const work=this.#start(mode);this.#opening=work;void work.finally(()=>{if(this.#opening===work)this.#opening=null;}).catch(()=>{});return work;
 }
 async #start(mode){
  await this.cancel();
  const attempt={mode,failures:0,controller:new AbortController(),verifier:randomBytes(32).toString('base64url')};this.#attempt=attempt;
  this.#set({phase:'opening',mode});
  try{
   const challenge=createHash('sha256').update(attempt.verifier).digest('base64url');
   const result=await this.#request('start',{challenge,mode},attempt.controller.signal);
   if(!/^[A-Za-z0-9_-]{32}$/.test(result.id)||!Number.isFinite(result.expiresAt)||result.expiresAt<=this.now()||result.expiresAt>this.now()+310000||! /^[A-F0-9]{4}-[A-F0-9]{4}$/.test(result.code))throw new Error('登录服务返回了无效请求');
   attempt.id=result.id;attempt.expiresAt=result.expiresAt;attempt.code=result.code;
   if(!this.#current(attempt)){await this.#revoke(attempt);return this.state();}
   const url=new URL('/login',this.origin);url.searchParams.set('desktop',result.id);if(mode==='register')url.searchParams.set('mode','register');attempt.url=url.href;
   this.#set({phase:'waiting',mode,code:attempt.code,expiresAt:attempt.expiresAt,url:attempt.url});
   try{await this.openBrowser(attempt.url);}catch{if(this.#current(attempt))this.#set({...this.state(),message:'未能打开浏览器，请点击重新打开。'});}
   if(this.#current(attempt))this.#schedule(attempt,this.intervalMs);
   return this.state();
  }catch(error){if(this.#current(attempt))await this.#fail(attempt,error);return this.state();}
 }
 #schedule(attempt,delay){attempt.timer=setTimeout(()=>void this.#poll(attempt),delay);attempt.timer.unref?.();}
 async #poll(attempt){
  if(!this.#current(attempt))return;
  if(this.now()>=attempt.expiresAt){await this.#fail(attempt,Object.assign(new Error('登录已过期，请重新发起'),{status:410}));return;}
  const proof={id:attempt.id,verifier:attempt.verifier};
  try{
   const result=await this.#request('poll',proof,attempt.controller.signal);
   if(!this.#current(attempt))return;
   if(result.phase==='cancelled'){await this.cancel();return;}
   if(result.phase==='approved'){
    this.#set({phase:'completing',mode:attempt.mode,code:attempt.code,expiresAt:attempt.expiresAt});
    const session=await this.#request('claim',proof,attempt.controller.signal);
    if(!/^[A-Za-z0-9_-]{43}$/.test(session.token)||!Number.isFinite(session.expiresAt)||session.expiresAt<=this.now()||session.expiresAt>this.now()+31*86400000)throw new Error('登录服务返回了无效会话');
    if(!this.#current(attempt)){await this.#revoke(attempt);return;}
    await this.acceptSession(session,()=>this.#current(attempt));
    if(!this.#current(attempt)){await this.#revoke(attempt);return;}
    this.#attempt=null;attempt.verifier='';attempt.controller.abort();
    this.#set({phase:'success',mode:attempt.mode,profileId:session.userId});return;
   }
   if(result.phase!=='pending')throw Object.assign(new Error('此登录请求已被使用，请重新发起'),{status:409});
   attempt.failures=0;this.#schedule(attempt,this.intervalMs);
  }catch(error){
   if(!this.#current(attempt))return;
   if(this.#state.phase==='completing'||[400,401,403,404,409,410].includes(error.status)||++attempt.failures>5)await this.#fail(attempt,error);
   else this.#schedule(attempt,error.status===429?5000:Math.max(this.intervalMs,3000));
  }
 }
 async #revoke(attempt){if(attempt.id&&attempt.verifier)await this.#request('cancel',{id:attempt.id,verifier:attempt.verifier}).catch(()=>{});}
 async #fail(attempt,error){
  this.#attempt=null;clearTimeout(attempt.timer);attempt.controller.abort();
  this.#set({phase:error.status===410?'expired':'failed',mode:attempt.mode,message:[400,401,403,404,409,410].includes(error.status)?error.message:'连接失败，请检查网络后重新发起登录。'});
  await this.#revoke(attempt);attempt.verifier='';
 }
 acknowledge(){if(this.#state.phase==='success')return this.#set({phase:'idle'});return this.state();}
 async reopen(){const attempt=this.#attempt;if(!attempt?.url||!this.#current(attempt))return this.state();try{await this.openBrowser(attempt.url);if(this.#current(attempt))this.#set({...this.state(),message:undefined});}catch{if(this.#current(attempt))this.#set({...this.state(),message:'未能打开系统浏览器，请检查默认浏览器设置。'});}return this.state();}
 async cancel(){
  const attempt=this.#attempt;
  if(!attempt)return this.state();
  this.#attempt=null;clearTimeout(attempt.timer);attempt.controller.abort();
  this.#set({phase:'cancelled',mode:attempt.mode});await this.#revoke(attempt);attempt.verifier='';return this.state();
 }
}

// Validate the actual Chromium session, without supplying a bearer token.
export async function verifyDesktopSession(fetcher,serverURL,session){
 const origin=trustedOrigin(serverURL);
 const response=await fetcher(origin+'/api/state',{credentials:'include',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
 const state=await response.json().catch(()=>null);
 if(!response.ok||state?.profile?.kind!=='account'||!state.profile.id||(session.userId&&state.profile.id!==session.userId))throw new Error('客户端会话未生效，请重新登录');
}
