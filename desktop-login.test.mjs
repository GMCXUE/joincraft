import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {createApp} from './server.mjs';
import {BrowserLogin,sessionAcceptor} from './desktop/browser-login.mjs';
const verifier=()=>randomBytes(32).toString('base64url');
const challenge=value=>createHash('sha256').update(value).digest('base64url');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(run){
 let time=Date.now();const app=await createApp({port:0,dbPath:':memory:',now:()=>time});
 const jar=()=>{
  const cookies=new Map();
  return async(path,body,extra={})=>{
   const response=await fetch(app.url+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
   for(const value of response.headers.getSetCookie()){const [pair]=value.split(';'),at=pair.indexOf('=');cookies.set(pair.slice(0,at),pair.slice(at+1));}
   return {status:response.status,data:await response.json(),headers:response.headers};
  };
 };
 const native=jar(),browser=jar();
 const start=async(mode='login')=>{const secret=verifier(),result=await native('/api/auth/desktop/start',{challenge:challenge(secret),mode});assert.equal(result.status,200);return {...result.data,verifier:secret};};
 const register=async(call=browser,name='builder')=>{const r=await call('/api/auth/register',{username:name,password:'LocalTest_2026'});assert.equal(r.status,201);return r;};
 try{await run({app,native,browser,jar,start,register,advance:ms=>{time+=ms;}});}finally{await app.close();}
}

test('browser login binds browser, requires explicit approval and native proof, and claims once',()=>fixture(async({native,browser,jar,start,register})=>{
 await register();const request=await start();const proof={id:request.id,verifier:request.verifier};
 assert.equal((await native('/api/state')).status,401);
 assert.equal((await native('/api/auth/desktop/authorize',{id:request.id})).status,401);
 assert.equal((await browser('/api/auth/desktop/authorize',{id:request.id})).status,403);
 const info=await browser('/api/auth/desktop/info',{id:request.id});assert.equal(info.status,200);assert.match(info.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);assert.equal(info.data.code,request.code);assert.equal(info.data.phase,'pending');
 assert.equal((await jar()('/api/auth/desktop/info',{id:request.id})).status,403);
 assert.equal((await native('/api/auth/desktop/claim',proof)).status,409);
 assert.equal((await native('/api/auth/desktop/claim',{...proof,verifier:verifier()})).status,403);
 assert.equal((await browser('/api/auth/desktop/authorize',{id:request.id})).status,200);
 const claimed=await native('/api/auth/desktop/claim',proof);assert.equal(claimed.status,200);assert.match(claimed.data.token,/^[A-Za-z0-9_-]{43}$/);
 assert.equal((await native('/api/auth/desktop/claim',proof)).status,409);
 const account=await native('/api/state',undefined,{Authorization:'Bearer '+claimed.data.token});assert.equal(account.status,200);assert.equal(account.data.profile.username,'builder');
 assert.equal((await browser('/api/auth/desktop/info',{id:request.id})).data.phase,'claimed');
 // Closing/denying the browser after success cannot log out a successful client.
 await browser('/api/auth/desktop/deny',{id:request.id});assert.equal((await native('/api/state',undefined,{Authorization:'Bearer '+claimed.data.token})).status,200);
 // Native cancellation racing session activation revokes only its issued session.
 await native('/api/auth/desktop/cancel',proof);assert.equal((await native('/api/state',undefined,{Authorization:'Bearer '+claimed.data.token})).status,401);assert.equal((await browser('/api/state')).status,200);
}));

test('cancelled, expired and logged-out browser authorizations cannot create a client session',()=>fixture(async({native,browser,start,register,advance})=>{
 await register();
 let req=await start();await browser('/api/auth/desktop/info',{id:req.id});await browser('/api/auth/desktop/deny',{id:req.id});assert.equal((await native('/api/auth/desktop/claim',req)).status,409);
 req=await start();await browser('/api/auth/desktop/info',{id:req.id});await browser('/api/auth/desktop/authorize',{id:req.id});await browser('/api/auth/logout',{});assert.equal((await native('/api/auth/desktop/claim',req)).status,401);
 req=await start();advance(300001);assert.equal((await native('/api/auth/desktop/poll',req)).status,410);assert.equal((await browser('/api/auth/desktop/info',{id:req.id})).status,410);
 assert.equal((await native('/api/auth/desktop/start',{challenge:'plain-secret',mode:'login'})).status,400);
 assert.equal((await native('/api/auth/desktop/start',{challenge:challenge(verifier()),mode:'redirect'})).status,400);
 assert.equal((await native('/api/auth/desktop/unknown',{})).status,401);
}));

test('guest identity and rooms remain intact through existing guest registration',()=>fixture(async({native,browser,start})=>{
 const guest=await native('/api/session',{name:'访客建造师'}),headers={Authorization:'Bearer '+guest.data.id};
 const room=await native('/api/rooms',{name:'原来的房间'},headers);assert.equal(room.status,201);
 const req=await start();await browser('/api/auth/desktop/info',{id:req.id});
 assert.equal((await native('/api/auth/desktop/authorize',{id:req.id},headers)).status,403);
 assert.equal((await native('/api/auth/register',{username:'guest_builder',password:'LocalTest_2026'},headers)).status,201);
 const state=await native('/api/state');assert.equal(state.status,200);assert.equal(state.data.rooms[0].id,room.data.id);assert.equal(state.data.profile.name,'访客建造师');
}));

test('native controller opens only its trusted website, keeps secrets in main, installs an independent session',()=>fixture(async({app,browser,register,native})=>{
 await register();let opened,accepted;const states=[];
 const login=new BrowserLogin({serverURL:app.url+'/app/',intervalMs:15,openBrowser:async url=>{
  opened=new URL(url);const id=opened.searchParams.get('desktop');await browser('/api/auth/desktop/info',{id});await browser('/api/auth/desktop/authorize',{id});
 },acceptSession:async session=>{accepted=session;}});
 login.on('change',state=>states.push(state));const success=once(login,'change').then(()=>{});await login.start();
 const deadline=Date.now()+5000;while(login.state().phase!=='success'&&Date.now()<deadline)await sleep(20);
 assert.equal(login.state().phase,'success');assert.equal(opened.origin,app.url);assert.equal(opened.pathname,'/login');assert.deepEqual([...opened.searchParams.keys()],['desktop']);
 assert.equal((await native('/api/state',undefined,{Authorization:'Bearer '+accepted.token})).data.profile.username,'builder');
 assert.equal(JSON.stringify(states).includes(accepted.token),false);assert.equal(JSON.stringify(states).includes('verifier'),false);
 assert.equal((await browser('/api/state')).status,200);await login.cancel();assert.equal(login.state().phase,'success');await success;login.acknowledge();assert.equal(login.state().phase,'idle');
}));

test('cancelling during native cookie activation revokes the claimed session and never emits success',()=>fixture(async({app,browser,register,native})=>{
 await register();let claimed,release,started;const activation=new Promise(resolve=>{started=resolve;}),hold=new Promise(resolve=>{release=resolve;});
 const login=new BrowserLogin({serverURL:app.url,intervalMs:15,openBrowser:async url=>{const id=new URL(url).searchParams.get('desktop');await browser('/api/auth/desktop/info',{id});await browser('/api/auth/desktop/authorize',{id});},acceptSession:async(session,current)=>{claimed=session;started();await hold;assert.equal(current(),false);}});
 await login.start();await activation;await login.cancel();release();await sleep(50);assert.equal(login.state().phase,'cancelled');assert.equal((await native('/api/state',undefined,{Authorization:'Bearer '+claimed.token})).status,401);
}));

test('failed native activation revokes its server session; browser confirmation remains separate',()=>fixture(async({app,browser,register,native})=>{
 await register();let token;
 const login=new BrowserLogin({serverURL:app.url,intervalMs:15,openBrowser:async url=>{const id=new URL(url).searchParams.get('desktop');await browser('/api/auth/desktop/info',{id});await browser('/api/auth/desktop/authorize',{id});},acceptSession:async session=>{token=session.token;throw new Error('disk full');}});
 await login.start();const deadline=Date.now()+5000;while(!['failed','success'].includes(login.state().phase)&&Date.now()<deadline)await sleep(20);
 await sleep(50);assert.equal(login.state().phase,'failed');assert.equal((await native('/api/state',undefined,{Authorization:'Bearer '+token})).status,401);assert.equal((await browser('/api/state')).status,200);
}));

test('native waiting handles browser failure, reopens the same request and expires cleanly',async()=>{
 let now=1000,openCalls=0,polls=0;const id='a'.repeat(32);const sent=[];
 const login=new BrowserLogin({serverURL:'https://www.joincraft.top/app/',now:()=>now,intervalMs:15,openBrowser:async()=>{if(++openCalls===1)throw new Error('no browser');},acceptSession:async()=>assert.fail(),fetcher:async(url,options)=>{
  const body=JSON.parse(options.body);sent.push({url,body});if(url.endsWith('/start'))return Response.json({id,code:'ABCD-EF12',expiresAt:now+300000});if(url.endsWith('/poll')){polls++;return Response.json({phase:'pending'});}return Response.json({phase:'cancelled'});
 }});
 await login.start();assert.match(login.state().message,/未能打开/);await login.reopen();assert.equal(openCalls,2);assert.equal(sent.filter(v=>v.url.endsWith('/start')).length,1);now+=300001;
 await sleep(40);assert.equal(login.state().phase,'expired');assert.equal(polls,0);
 assert.throws(()=>new BrowserLogin({serverURL:'http://evil.example',openBrowser(){}}),/HTTPS/);
 assert.throws(()=>new BrowserLogin({serverURL:'https://user:secret@example.com',openBrowser(){}}),/HTTPS/);
});

test('serialized native cookie activation sets host-only HttpOnly cookies and removes only cancelled credentials',async()=>{
 let rows=[],release,first=true;const hold=new Promise(resolve=>{release=resolve;});const settings=[];
 const cookies={set:async cookie=>{settings.push(cookie);rows=[cookie];if(first){first=false;await hold;}},flushStore:async()=>{},get:async()=>rows,remove:async()=>{rows=[];}};
 const accept=sessionAcceptor(cookies,'https://www.joincraft.top/app/');let current=true;
 const a=accept({token:'a'.repeat(43),expiresAt:Date.now()+100000},()=>current);await sleep(5);current=false;
 const b=accept({token:'b'.repeat(43),expiresAt:Date.now()+100000},()=>true);release();await Promise.all([a,b]);
 assert.equal(rows[0].value,'b'.repeat(43));assert.equal(settings[0].name,'__Host-blockroom_session');assert.equal(settings[0].httpOnly,true);assert.equal(settings[0].secure,true);assert.equal(settings[0].sameSite,'strict');assert.equal('domain' in settings[0],false);assert.equal(settings[0].path,'/');
});

test('state reads never replay an old cookie over a newly claimed account',()=>fixture(async({native,browser,start,register})=>{
 const old=await register(native,'previous_account');
 const oldCookie=old.headers.get('set-cookie').split(';')[0];
 await register();const request=await start();
 await browser('/api/auth/desktop/info',{id:request.id});await browser('/api/auth/desktop/authorize',{id:request.id});
 const pending=await native('/api/state',undefined,{Cookie:oldCookie});
 const claimed=await native('/api/auth/desktop/claim',request);
 assert.equal(claimed.status,200);assert.equal(typeof claimed.data.userId,'string');
 // Its response may arrive after Chromium has installed the claimed session.
 assert.equal(pending.data.profile.username,'previous_account');assert.equal(pending.headers.get('set-cookie'),null);
 const activated=await native('/api/state',undefined,{Cookie:'blockroom_session='+claimed.data.token});
 assert.equal(activated.data.profile.id,claimed.data.userId);assert.equal(activated.data.profile.username,'builder');
 assert.equal(activated.headers.get('set-cookie'),null);
}));

test('native cookie readback rejects a stale account and removes the unconfirmed credential',async()=>{
 const {verifyDesktopSession}=await import('./desktop/browser-login.mjs');let rows=[],options;
 const cookies={set:async cookie=>{rows=[cookie];},get:async()=>rows,flushStore:async()=>{},remove:async()=>{rows=[];}};
 const check=session=>verifyDesktopSession(async(url,init)=>{assert.equal(url,'https://www.joincraft.top/api/state');options=init;return Response.json({profile:{id:'old-user',kind:'account'}});},'https://www.joincraft.top/app/',session);
 await assert.rejects(sessionAcceptor(cookies,'https://www.joincraft.top/app/',check)({token:'a'.repeat(43),userId:'new-user',expiresAt:Date.now()+10000},()=>true),/会话未生效/);
 assert.equal(rows.length,0);assert.equal(options.credentials,'include');assert.equal(options.headers,undefined);
 await verifyDesktopSession(async()=>Response.json({profile:{id:'new-user',kind:'account'}}),'https://www.joincraft.top/app/',{userId:'new-user'});
 await assert.rejects(verifyDesktopSession(async()=>Response.json({profile:{id:'new-user',kind:'guest'}}),'https://www.joincraft.top/app/',{userId:'new-user'}),/会话未生效/);
});

test('visible account activation retries a transient failure and rejects guest or mismatched identities',async()=>{
 const {loadDesktopAccount}=await import('./public/desktop-login.js');let calls=0;const delays=[];
 const state={profile:{id:'expected',kind:'account'},rooms:[]};
 assert.equal(await loadDesktopAccount(async()=>{if(++calls<3)throw Object.assign(new Error('offline'),{status:503});return state;},'expected',{delay:async ms=>delays.push(ms)}),state);
 assert.equal(calls,3);assert.deepEqual(delays,[200,400]);
 for(const profile of [null,{id:'expected',kind:'guest'},{id:'another',kind:'account'}])await assert.rejects(loadDesktopAccount(async()=>({profile}),'expected',{delay:async()=>{}}),/会话未生效/);
});

async function dialogFixture(run){
 const {mountDesktopLogin}=await import('./public/desktop-login.js');
 const original={window:globalThis.window,document:globalThis.document};
 class Dialog extends EventTarget{open=false;showModal(){this.open=true;}close(){this.open=false;this.dispatchEvent(new Event('close'));}}
 const dialog=new Dialog(),body=new EventTarget();let receive,acknowledged=0,started=0;
 const bridge={beginLogin:async()=>{started++;return{phase:'waiting',mode:'login'};},loginState:async()=>({phase:'idle'}),onLoginState:fn=>{receive=fn;},acknowledgeLogin:async()=>{acknowledged++;},cancelLogin:async()=>{},reopenLogin:async()=>({phase:'waiting'})};
 globalThis.window={blockroomDesktop:bridge};globalThis.document={querySelector:selector=>selector==='#auth-dialog'?dialog:body};
 const click=action=>{const event=new Event('click',{cancelable:true});Object.defineProperty(event,'target',{value:{closest:()=>({dataset:{login:action}})}});body.dispatchEvent(event);};
 try{await run({mount:options=>mountDesktopLogin({escape:v=>v,...options}),dialog,body,receive:state=>receive(state),click,acknowledged:()=>acknowledged,started:()=>started});}
 finally{globalThis.window=original.window;globalThis.document=original.document;}
}

test('desktop login keeps its dialog open until the visible account is loaded; failed refresh can retry',()=>dialogFixture(async f=>{
 let attempts=0,complete=0,release;const held=new Promise(resolve=>{release=resolve;});
 const login=f.mount({onSuccess:async()=>{if(++attempts===1){await held;throw Error('network interrupted');}},onComplete:()=>complete++});
 await login.open('login');f.receive({phase:'success',profileId:'expected'});f.receive({phase:'success',profileId:'expected'});
 assert.equal(f.dialog.open,true);assert.equal(f.acknowledged(),0);assert.equal(attempts,1);
 const escape=new Event('cancel',{cancelable:true});f.dialog.dispatchEvent(escape);assert.equal(escape.defaultPrevented,true);
 release();await sleep(0);assert.equal(f.dialog.open,true);assert.equal(f.acknowledged(),0);assert.equal(complete,0);assert.match(f.body.innerHTML,/network interrupted/);assert.match(f.body.innerHTML,/retry-sync/);
 f.click('retry-sync');await sleep(0);assert.equal(f.dialog.open,false);assert.equal(f.acknowledged(),1);assert.equal(complete,1);assert.equal(f.started(),1);
 f.receive({phase:'success'});await sleep(0);assert.equal(complete,1);
}));

test('a missing client session requires a new login instead of silently closing the dialog',()=>dialogFixture(async f=>{
 const login=f.mount({onSuccess:async()=>{throw Object.assign(Error('client session missing'),{status:401});}});
 await login.open('login');f.receive({phase:'success'});await sleep(0);
 assert.equal(f.dialog.open,true);assert.equal(f.acknowledged(),0);assert.match(f.body.innerHTML,/data-login="retry"/);assert.doesNotMatch(f.body.innerHTML,/retry-sync/);
 f.click('retry');await sleep(0);assert.equal(f.started(),2);
}));
