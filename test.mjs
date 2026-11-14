import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from './server.mjs';
async function fixture(run){
 const app=await createApp({port:0,dbPath:':memory:'});
 const call=async(path,body,id)=>{const r=await fetch(app.url+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(id?{'X-Session':id}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,data:await r.json()};};
 try{const host=(await call('/api/session',{name:'房主'})).data.id,guest=(await call('/api/session',{name:'朋友'})).data.id,stranger=(await call('/api/session',{name:'路人'})).data.id;await run({app,call,host,guest,stranger});}finally{await app.close();}
}
test('rooms join directly, support multiple rooms, capacity, leave and owner authorization',()=>fixture(async({call,host,guest,stranger})=>{
 const result=await call('/api/rooms',{name:'WZ',capacity:2},host);assert.equal(result.status,201);const room=result.data;assert.match(room.code,/^\d{6}$/);assert.equal(room.port,null);
 const joined=await call('/api/join',{code:room.code},guest);assert.equal(joined.status,200);assert.equal(joined.data.status,'joined');assert.equal(joined.data.members.length,2);assert.equal('requests' in joined.data,false);assert.equal(JSON.stringify(joined.data).includes(host),false);assert.equal(JSON.stringify(joined.data).includes(guest),false);assert.equal(joined.data.members.filter(m=>m.self).length,1);
 assert.equal((await call('/api/join',{code:room.code},guest)).data.members.length,2);
 assert.equal((await call('/api/state',undefined,stranger)).data.rooms.length,0);
 assert.equal((await call('/api/join',{code:room.code},stranger)).status,400);
 for(const action of ['settings','game','close'])assert.equal((await call(`/api/rooms/${room.id}/${action}`,{name:'changed'},guest)).status,403);
 assert.equal((await call(`/api/rooms/${room.id}/approve`,{},host)).status,404);
 const second=(await call('/api/rooms',{name:'第二个房间'},host)).data;
 assert.equal((await call('/api/state',undefined,host)).data.rooms.length,2);
 assert.equal((await call('/api/join',{code:second.code},guest)).status,200);
 assert.equal((await call('/api/state',undefined,guest)).data.rooms.length,2);
 assert.equal((await call(`/api/rooms/${room.id}/leave`,{},guest)).status,200);
 assert.equal((await call('/api/state',undefined,guest)).data.rooms.length,1);
 assert.equal((await call('/api/join',{code:room.code},stranger)).status,200);
 assert.equal((await call(`/api/rooms/${room.id}/close`,{},host)).status,200);
 assert.equal((await call('/api/join',{code:room.code},guest)).status,404);
 assert.equal((await call('/api/state',undefined,stranger)).data.rooms[0].closed,true);
}));
test('optional password is verified and can be changed or removed without exposing secrets',()=>fixture(async({call,host,guest,stranger})=>{
 const password='local-test-secret';const room=(await call('/api/rooms',{name:'密码房间',password,capacity:4},host)).data;
 assert.equal(room.hasPassword,true);assert.equal(JSON.stringify(room).includes(password),false);assert.equal('password' in room,false);assert.equal('hash' in room,false);
 assert.equal((await call('/api/join',{code:room.code},guest)).status,403);
 assert.equal((await call('/api/join',{code:room.code,password:'wrong'},guest)).status,403);
 assert.equal((await call('/api/join',{code:room.code,password},guest)).status,200);
 const update={name:'密码房间',capacity:4,passwordMode:'set',password:'new-local-password'};
 assert.equal((await call(`/api/rooms/${room.id}/settings`,update,host)).status,200);
 assert.equal((await call('/api/state',undefined,guest)).data.rooms[0].status,'joined');
 assert.equal((await call('/api/join',{code:room.code,password},stranger)).status,403);
 assert.equal((await call('/api/join',{code:room.code,password:update.password},stranger)).status,200);
 assert.equal((await call(`/api/rooms/${room.id}/settings`,{...update,capacity:2},host)).status,400);
 await call(`/api/rooms/${room.id}/leave`,{},guest);
 const removed=await call(`/api/rooms/${room.id}/settings`,{name:room.name,capacity:4,passwordMode:'remove'},host);assert.equal(removed.data.hasPassword,false);
 assert.equal((await call('/api/join',{code:room.code},guest)).status,200);
}));
test('validates game, image and browser request boundaries',()=>fixture(async({app,call,host})=>{
 for(const port of [0,1023,65536,1.5])assert.equal((await call('/api/rooms',{name:'bad',port},host)).status,400);
 for(const image of ['https://example.com/image.png','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,YmFk'])assert.equal((await call('/api/rooms',{name:'bad',image},host)).status,400);
 const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6rN0AAAAASUVORK5CYII=';
 const room=(await call('/api/rooms',{name:'image',image},host)).data;assert.equal(room.image,image);
 assert.equal((await call(`/api/rooms/${room.id}/game`,{version:'1.21.1',loader:'Fabric',port:51234},host)).data.port,51234);
 assert.equal((await call('/api/state')).status,401);
 const cross=await fetch(app.url+'/api/session',{method:'POST',headers:{Origin:'https://elsewhere.example','Content-Type':'application/json'},body:'{}'});assert.equal(cross.status,403);
 const type=await fetch(app.url+'/api/session',{method:'POST',body:'{}'});assert.equal(type.status,415);
 const page=await fetch(app.url);assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
}));

test('instance configs validate input and survive malformed local storage',async()=>{
 const {validateInstance,parseInstances}=await import('./public/instances.js');
 assert.deepEqual(validateInstance({name:'  模组世界  ',version:'1.21.1',loader:'Fabric',port:''}),{name:'模组世界',version:'1.21.1',loader:'Fabric',port:''});
 for(const port of [0,1023,65536,2.5,'invalid'])assert.throws(()=>validateInstance({name:'test',version:'1',loader:'原版',port}));
 assert.throws(()=>validateInstance({name:'',version:'1',loader:'原版'}));
 assert.throws(()=>validateInstance({name:'test',version:'1',loader:'Invalid'}));
 assert.deepEqual(parseInstances('not-json'),[]);
 assert.deepEqual(parseInstances('{}'),[]);
 const config={id:'sample',name:'生存',version:'1.21.1',loader:'Forge',port:51234};
 assert.deepEqual(parseInstances(JSON.stringify([null,config,config,{id:'bad'}])),[config]);
});

test('SQLite restart preserves identity, room, password, members, settings and events',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {DatabaseSync}=await import('node:sqlite');
 const dir=await mkdtemp(join(tmpdir(),'blockroom-test-')),dbPath=join(dir,'rooms.sqlite');
 let app=await createApp({port:0,dbPath});
 const call=async(path,body,token)=>{const r=await fetch(app.url+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,data:await r.json()};};
 try{
  const host=(await call('/api/session',{name:'持久房主'})).data.id;
  const guest=(await call('/api/session',{name:'持久成员'})).data.id;
  const room=(await call('/api/rooms',{name:'重启测试',password:'persist-secret',capacity:4},host)).data;
  await call('/api/join',{code:room.code,password:'persist-secret'},guest);
  await call(`/api/rooms/${room.id}/game`,{version:'1.21.1',loader:'Fabric',port:51234},host);
  await call('/api/profile',{name:'已改昵称'},guest);
  const {execFileSync}=await import('node:child_process');
  const backupPath=join(dir,'backup.sqlite');
  execFileSync(process.execPath,['scripts/backup.mjs',backupPath],{env:{...process.env,DATABASE_PATH:dbPath}});
  const saved=new DatabaseSync(backupPath,{readOnly:true});
  assert.equal(saved.prepare('SELECT code FROM rooms').get().code,room.code);saved.close();
  assert.throws(()=>execFileSync(process.execPath,['scripts/backup.mjs',backupPath],{env:{...process.env,DATABASE_PATH:dbPath},stdio:'pipe'}));
  await app.close();app=null;
  const db=new DatabaseSync(dbPath);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,7);
  assert.equal(db.prepare('SELECT count(*) AS n FROM sessions WHERE token_hash=?').get(host).n,0);
  assert.notEqual(db.prepare('SELECT password FROM rooms').get().password,'persist-secret');
  db.close();
  app=await createApp({port:0,dbPath});
  const restored=await call('/api/state',undefined,host);assert.equal(restored.status,200);
  assert.equal(restored.data.capabilities.persistence,true);
  assert.equal(restored.data.rooms[0].code,room.code);
  assert.equal(restored.data.rooms[0].port,51234);
  assert.equal(restored.data.rooms[0].members.length,2);
  assert.equal(restored.data.rooms[0].members.find(m=>!m.host).name,'已改昵称');
  assert.equal(restored.data.rooms[0].events.length,3);
  const next=(await call('/api/session',{name:'新成员'})).data.id;
  assert.equal((await call('/api/join',{code:room.code,password:'wrong'},next)).status,403);
  assert.equal((await call('/api/join',{code:room.code,password:'persist-secret'},next)).status,200);
 }finally{if(app)await app.close();await rm(dir,{recursive:true,force:true});}
});

test('simultaneous password joins cannot exceed capacity',()=>fixture(async({call,host,guest,stranger})=>{
 const room=(await call('/api/rooms',{name:'最后一个名额',capacity:2,password:'concurrency'},host)).data;
 const results=await Promise.all([guest,stranger].map(id=>call('/api/join',{code:room.code,password:'concurrency'},id)));
 assert.deepEqual(results.map(x=>x.status).sort(),[200,400]);
 assert.equal((await call('/api/state',undefined,host)).data.rooms[0].members.length,2);
}));

test('SSE authenticates and pushes committed member changes',()=>fixture(async({app,call,host,guest})=>{
 const room=(await call('/api/rooms',{name:'实时房间'},host)).data;
 assert.equal((await fetch(app.url+'/api/events')).status,401);
 const controller=new AbortController();
 try{
  const response=await fetch(app.url+'/api/events',{headers:{Authorization:`Bearer ${host}`},signal:controller.signal});
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/event-stream/);
  const reader=response.body.getReader(),decoder=new TextDecoder();
  assert.match(decoder.decode((await reader.read()).value),/event: change/);
  await call('/api/join',{code:room.code},guest);
  const next=await Promise.race([reader.read(),new Promise((_,reject)=>{const t=setTimeout(()=>reject(new Error('SSE did not publish')),2000);t.unref();})]);
  assert.match(decoder.decode(next.value),/event: change/);
  assert.equal((await call('/api/state',undefined,host)).data.rooms[0].members.length,2);
  await reader.cancel();
 }finally{controller.abort();}
}));

test('expired devices are rejected and rate limits survive a service restart',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=await mkdtemp(join(tmpdir(),'blockroom-limit-'));let now=Date.now();const dbPath=join(dir,'test.sqlite');
 let app=await createApp({port:0,dbPath,now:()=>now});
 const call=async(path,body,token)=>{const r=await fetch(app.url+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,data:await r.json()};};
 try{
  const token=(await call('/api/session',{name:'限流设备'})).data.id;
  for(let i=0;i<12;i++)assert.equal((await call('/api/join',{code:'000000'},token)).status,404);
  assert.equal((await call('/api/join',{code:'000000'},token)).status,429);
  await app.close();app=null;app=await createApp({port:0,dbPath,now:()=>now});
  assert.equal((await call('/api/join',{code:'000000'},token)).status,429);
  now+=60001;assert.equal((await call('/api/join',{code:'000000'},token)).status,404);
  now+=31*86400000;assert.equal((await call('/api/state',undefined,token)).status,401);
 }finally{if(app)await app.close();await rm(dir,{recursive:true,force:true});}
});

function authClient(app, initialToken){
 let cookie='',token=initialToken;
 return {
  get cookie(){return cookie;}, clearBearer(){token=null;},
  async call(path,body,headers={}){
   const response=await fetch(app.url+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:`Bearer ${token}`}:{ }),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
   const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];
   return{status:response.status,data:await response.json(),headers:response.headers};
  }
 };
}
const accountSecret='a long local test passphrase';
test('guest registration preserves rooms, uses HttpOnly cookie, and revokes guest tokens',()=>fixture(async({app,call,host,guest})=>{
 const room=(await call('/api/rooms',{name:'账号绑定房间'},host)).data;
 await call('/api/join',{code:room.code},guest);
 const owner=authClient(app,host);
 const registered=await owner.call('/api/auth/register',{username:'RoomOwner',password:accountSecret,name:'正式房主'});
 assert.equal(registered.status,201);assert.equal('token' in registered.data,false);assert.equal('id' in registered.data,false);
 assert.match(registered.headers.get('set-cookie'),/HttpOnly/);assert.match(registered.headers.get('set-cookie'),/SameSite=Strict/);
 assert.equal((await call('/api/state',undefined,host)).status,401);
 owner.clearBearer();const restored=(await owner.call('/api/state')).data;
 assert.equal(restored.profile.username,'roomowner');assert.equal(restored.profile.kind,'account');
 assert.equal(restored.rooms[0].id,room.id);assert.equal(restored.rooms[0].isHost,true);assert.equal(restored.rooms[0].members.length,2);
 assert.equal((await call('/api/state',undefined,guest)).data.rooms[0].hostName,'正式房主');
 const second=authClient(app);
 assert.equal((await second.call('/api/auth/login',{username:'ROOMOWNER',password:accountSecret})).status,200);
 assert.equal((await second.call('/api/state')).data.rooms[0].id,room.id);
 const oldCookie=owner.cookie;
 assert.equal((await owner.call('/api/auth/logout',{})).status,200);
 assert.equal((await owner.call('/api/state')).status,401);
 assert.equal((await second.call('/api/state')).status,200);
 const replay=await fetch(app.url+'/api/state',{headers:{Cookie:oldCookie}});assert.equal(replay.status,401);
 const duplicate=authClient(app);assert.equal((await duplicate.call('/api/auth/register',{username:'RoomOwner',password:accountSecret})).status,409);
}));

test('accounts persist across restart; invalid credentials and cross-origin writes fail',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {DatabaseSync}=await import('node:sqlite');
 const dir=await mkdtemp(join(tmpdir(),'blockroom-account-')),dbPath=join(dir,'auth.sqlite');let app=await createApp({port:0,dbPath});
 try{
  const client=authClient(app);
  assert.equal((await client.call('/api/auth/register',{username:'bad',password:'short'})).status,400);
  assert.equal((await client.call('/api/auth/register',{username:'bad name',password:accountSecret})).status,400);
  assert.equal((await client.call('/api/auth/register',{username:'persistent',password:accountSecret,name:'持久账号'})).status,201);
  const room=(await client.call('/api/rooms',{name:'持久账号房间'})).data;
  const foreign=authClient(app);assert.equal((await foreign.call('/api/auth/login',{username:'persistent',password:accountSecret},{Origin:'https://attacker.invalid'})).status,403);
  const wrong=await foreign.call('/api/auth/login',{username:'persistent',password:'wrong'});
  const unknown=await foreign.call('/api/auth/login',{username:'unknown',password:'wrong'});
  assert.equal(wrong.status,401);assert.deepEqual(wrong.data,unknown.data);
  await app.close();app=null;
  const db=new DatabaseSync(dbPath,{readOnly:true});const stored=db.prepare('SELECT password_hash FROM accounts').get().password_hash;
  assert.match(stored,/^scrypt\$32768\$8\$3\$/);assert.equal(stored.includes(accountSecret),false);db.close();
  app=await createApp({port:0,dbPath});const after=authClient(app);
  assert.equal((await after.call('/api/auth/login',{username:'persistent',password:accountSecret})).status,200);
  assert.equal((await after.call('/api/state')).data.rooms[0].id,room.id);
 }finally{if(app)await app.close();await rm(dir,{recursive:true,force:true});}
});

test('logout immediately terminates authenticated SSE and expired account sessions can log in again',async()=>{
 let now=Date.now();const app=await createApp({port:0,dbPath:':memory:',now:()=>now});const controller=new AbortController();
 try{
  const client=authClient(app);await client.call('/api/auth/register',{username:'stream_user',password:accountSecret});
  const stream=await fetch(app.url+'/api/events',{headers:{Cookie:client.cookie},signal:controller.signal});const reader=stream.body.getReader();await reader.read();
  await client.call('/api/auth/logout',{});
  const end=await Promise.race([reader.read(),new Promise((_,reject)=>{setTimeout(()=>reject(new Error('revoked SSE remained open')),1000).unref();})]);assert.equal(end.done,true);
  await client.call('/api/auth/login',{username:'stream_user',password:accountSecret});now+=31*86400000;
  assert.equal((await client.call('/api/state')).status,401);
  assert.equal((await client.call('/api/auth/login',{username:'stream_user',password:accountSecret})).status,200);
  assert.equal((await client.call('/api/state')).data.profile.username,'stream_user');
 }finally{controller.abort();await app.close();}
});

test('account password guessing is rate limited and HTTPS cookies are Secure',async()=>{
 const app=await createApp({port:0,dbPath:':memory:',publicOrigin:'https://mc.example.test'});
 try{
  const {request}=await import('node:http');
  const post=(path,body)=>new Promise((resolve,reject)=>{
   const req=request(app.url+path,{method:'POST',headers:{Host:'mc.example.test',Origin:'https://mc.example.test','Content-Type':'application/json'}},res=>{
    let raw='';res.on('data',chunk=>raw+=chunk);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(raw),cookie:res.headers['set-cookie']?.[0]}));
   });req.on('error',reject);req.end(JSON.stringify(body));
  });
  const created=await post('/api/auth/register',{username:'secure_user',password:accountSecret});
  assert.equal(created.status,201);assert.match(created.cookie,/^__Host-blockroom_session=/);assert.match(created.cookie,/; Secure/);
  for(let i=0;i<15;i++)assert.equal((await post('/api/auth/login',{username:'secure_user',password:'wrong'})).status,401);
  assert.equal((await post('/api/auth/login',{username:'secure_user',password:'wrong'})).status,429);
 }finally{await app.close();}
});

async function socialFixture(run){
 const app=await createApp({port:0,dbPath:':memory:'});
 try{
  const alice=authClient(app),bob=authClient(app),eve=authClient(app);
  for(const [client,username] of [[alice,'alice'],[bob,'bob'],[eve,'eve']])assert.equal((await client.call('/api/auth/register',{username,password:accountSecret,name:username.toUpperCase()})).status,201);
  await run({app,alice,bob,eve});
 }finally{await app.close();}
}
test('friend requests need consent; only recipient can accept and guests cannot use social APIs',()=>socialFixture(async({app,alice,bob,eve})=>{
 assert.equal((await alice.call('/api/friends/request',{username:'alice'})).status,400);
 assert.equal((await alice.call('/api/friends/request',{username:'missing'})).status,404);
 assert.equal((await alice.call('/api/friends/request',{username:'BOB'})).status,200);
 let a=(await alice.call('/api/state')).data.social,b=(await bob.call('/api/state')).data.social;
 const aliceId=b.requests[0].id,bobId=a.requests[0].id;
 assert.equal(a.requests[0].incoming,false);assert.equal(b.requests[0].incoming,true);
 assert.equal((await alice.call('/api/friends/request',{username:'bob'})).status,409);
 assert.equal((await alice.call(`/api/friends/${bobId}/accept`,{})).status,403);
 assert.equal((await eve.call(`/api/friends/${aliceId}/accept`,{})).status,404);
 assert.equal((await alice.call(`/api/chats/${bobId}/messages`,{content:'premature',clientId:'pending-message'})).status,403);
 assert.equal((await bob.call(`/api/friends/${aliceId}/accept`,{})).status,200);
 assert.equal((await alice.call('/api/state')).data.social.friends[0].username,'bob');
 assert.equal((await bob.call('/api/state')).data.social.requests.length,0);
 const guest=authClient(app);const token=(await guest.call('/api/session',{name:'guest'})).data.id;
 assert.equal((await guest.call('/api/friends/request',{username:'alice'},{Authorization:`Bearer ${token}`})).status,403);
 await eve.call('/api/friends/request',{username:'alice'});a=(await alice.call('/api/state')).data.social;
 const eveId=a.requests[0].id;
 assert.equal((await alice.call(`/api/friends/${eveId}/decline`,{})).status,200);
 assert.equal((await eve.call('/api/state')).data.social.requests.length,0);
 await eve.call('/api/friends/request',{username:'bob'});const bobFromEve=(await eve.call('/api/state')).data.social.requests[0].id;
 assert.equal((await eve.call(`/api/friends/${bobFromEve}/cancel`,{})).status,200);
}));

test('private chat enforces membership, supports idempotent send, unread cursors and pagination',()=>socialFixture(async({alice,bob,eve})=>{
 await alice.call('/api/friends/request',{username:'bob'});
 const bobId=(await alice.call('/api/state')).data.social.requests[0].id,aliceId=(await bob.call('/api/state')).data.social.requests[0].id;
 await bob.call(`/api/friends/${aliceId}/accept`,{});
 const content='<script>not executable</script>\nhello';
 const sent=await alice.call(`/api/chats/${bobId}/messages`,{content,clientId:'unique-chat-message'});
 assert.equal(sent.status,200);assert.equal(sent.data.self,true);
 const duplicate=await alice.call(`/api/chats/${bobId}/messages`,{content,clientId:'unique-chat-message'});assert.equal(duplicate.data.id,sent.data.id);
 assert.equal((await alice.call(`/api/chats/${bobId}/messages`,{content:'different',clientId:'unique-chat-message'})).status,409);
 assert.equal((await bob.call('/api/state')).data.social.unread,1);
 assert.equal((await eve.call(`/api/chats/${aliceId}/messages`)).status,403);
 assert.equal((await eve.call(`/api/chats/${bobId}/messages`,{content:'intrude',clientId:'unauthorized-message'})).status,403);
 const received=(await bob.call(`/api/chats/${aliceId}/messages`)).data.messages[0];assert.equal(received.content,content);assert.equal(received.self,false);
 assert.equal((await bob.call(`/api/chats/${aliceId}/read`,{uptoId:999999})).status,404);
 assert.equal((await bob.call(`/api/chats/${aliceId}/read`,{uptoId:sent.data.id})).status,200);
 assert.equal((await bob.call('/api/state')).data.social.unread,0);
 await bob.call(`/api/chats/${aliceId}/read`,{uptoId:0});assert.equal((await bob.call('/api/state')).data.social.unread,0);
 assert.equal((await alice.call(`/api/chats/${bobId}/messages`,{content:' ',clientId:'empty-message'})).status,400);
 assert.equal((await alice.call(`/api/chats/${bobId}/messages`,{content:'x'.repeat(2001),clientId:'long-message'})).status,400);
 for(let i=0;i<51;i++)assert.equal((await alice.call(`/api/chats/${bobId}/messages`,{content:'消息 '+i,clientId:'page-message-'+i})).status,200);
 const latest=(await bob.call(`/api/chats/${aliceId}/messages`)).data;
 assert.equal(latest.messages.length,50);assert.equal(latest.hasMore,true);
 const older=(await bob.call(`/api/chats/${aliceId}/messages?before=${latest.messages[0].id}`)).data;
 assert.equal(older.messages.length,2);assert.equal(older.hasMore,false);
 assert.equal((await bob.call('/api/state')).data.social.unread,51);
}));

test('friendships and chat history survive restart',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=await mkdtemp(join(tmpdir(),'blockroom-chat-')),dbPath=join(dir,'social.sqlite');let app=await createApp({port:0,dbPath});
 try{
  let alice=authClient(app),bob=authClient(app);
  await alice.call('/api/auth/register',{username:'alice',password:accountSecret});await bob.call('/api/auth/register',{username:'bob',password:accountSecret});
  await alice.call('/api/friends/request',{username:'bob'});
  const bobId=(await alice.call('/api/state')).data.social.requests[0].id,aliceId=(await bob.call('/api/state')).data.social.requests[0].id;
  await bob.call(`/api/friends/${aliceId}/accept`,{});
  await alice.call(`/api/chats/${bobId}/messages`,{content:'重启后还能看到',clientId:'persistent-message'});
  await app.close();app=null;app=await createApp({port:0,dbPath});bob=authClient(app);
  await bob.call('/api/auth/login',{username:'bob',password:accountSecret});
  const restored=(await bob.call('/api/state')).data.social;assert.equal(restored.friends[0].id,aliceId);assert.equal(restored.unread,1);
  assert.equal((await bob.call(`/api/chats/${aliceId}/messages`)).data.messages[0].content,'重启后还能看到');
 }finally{if(app)await app.close();await rm(dir,{recursive:true,force:true});}
});


test('registration accepts 10–64 character passwords and rejects either side of the boundary',()=>fixture(async({app})=>{
 const client=authClient(app);
 const short=await client.call('/api/auth/register',{username:'short_pw',password:'123456789'});
 assert.equal(short.status,400);assert.match(short.data.error,/10–64/);
 assert.equal((await client.call('/api/auth/register',{username:'long_pw',password:'a'.repeat(65)})).status,400);
 assert.equal((await client.call('/api/auth/register',{username:'ten_chars',password:'0123456789'})).status,201);
 await client.call('/api/auth/logout',{});
 assert.equal((await client.call('/api/auth/login',{username:'ten_chars',password:'0123456789'})).status,200);
 const other=authClient(app);
 assert.equal((await other.call('/api/auth/register',{username:'max_chars',password:'a'.repeat(64)})).status,201);
}));

test('official homepage and app have separate entries while old desktop root stays compatible',async()=>{
 const app=await createApp({port:0,dbPath:':memory:'});
 try{
  const home=await fetch(app.url+'/');const html=await home.text();assert.equal(home.status,200);assert.match(html,/一起上线，/);assert.match(html,/href="\/login"/);assert.match(html,/href="\/downloads\/client\/windows"/);assert.ok(!html.includes('src="/app.js"'));assert.equal(home.headers.get('set-cookie'),null);
  for(const path of ['/app','/app/']){const response=await fetch(app.url+path);assert.equal(response.status,200);assert.match(await response.text(),/src="\/app.js"/);}
  const download=await fetch(app.url+'/downloads/client/windows',{redirect:'manual'});assert.equal(download.status,302);assert.equal(download.headers.get('location'),'https://www.joincraft.top/updates/joincraft-setup.exe');
  const old=await fetch(app.url+'/',{headers:{'User-Agent':'Mozilla/5.0 joincraft/0.9.7 Chrome/146.0 Electron/45.3.1 Safari/537.36'}});assert.match(await old.text(),/src="\/app.js"/);
  const other=await fetch(app.url+'/',{headers:{'User-Agent':'Mozilla/5.0 Codex/1.0 Electron/45.3.1'}});assert.match(await other.text(),/hero-title/);
  const libraryModule=await fetch(app.url+'/launcher/memory.js');assert.equal(libraryModule.status,200);assert.match(await libraryModule.text(),/createMemoryControls/);
  const picture=await fetch(app.url+'/home/world-v1.webp');assert.equal(picture.status,200);assert.equal(picture.headers.get('content-type'),'image/webp');assert.match(picture.headers.get('cache-control'),/immutable/);const bytes=new Uint8Array(await picture.arrayBuffer());assert.equal(Buffer.from(bytes.slice(0,4)).toString(),'RIFF');
  const night=await fetch(app.url+'/home/camp-v2.webp');assert.equal(night.status,200);assert.equal(night.headers.get('content-type'),'image/webp');assert.match(night.headers.get('cache-control'),/immutable/);assert.notDeepEqual(Buffer.from(await night.arrayBuffer()),Buffer.from(bytes));
  const font=await fetch(app.url+'/home/display-900-v1.woff2');assert.equal(font.status,200);assert.equal(font.headers.get('content-type'),'font/woff2');assert.equal(Buffer.from(await font.arrayBuffer()).toString('ascii',0,4),'wOF2');
  assert.equal((await fetch(app.url+'/api/state')).status,401);
 }finally{await app.close();}
});


test('login return destinations stay inside the account app and preserve room links',async()=>{
 const {appDestination,loginPagePath,useLoginPage}=await import('./public/auth/session.js');
 const origin='https://www.joincraft.top';
 for(const value of [null,'','https://evil.example/app/','//evil.example/app/','/\\evil.example/app/','javascript:alert(1)','/downloads/client/windows','/login','/app/../login','/app/%2e%2e/login'])assert.equal(appDestination(value,origin),'/app/#friends');
 assert.equal(appDestination('/app/?code=123456#room/demo',origin),'/app/?code=123456#room/demo');
 assert.equal(appDestination('/app?guest=1&code=123456#home',origin),'/app/?code=123456#home');
 assert.equal(loginPagePath('register','/app/#friends',origin),'/login?mode=register');
 assert.equal(new URL('https://www.joincraft.top'+loginPagePath('login','/app/?code=123456#room/demo',origin)).searchParams.get('next'),'/app/?code=123456#room/demo');
 assert.equal(useLoginPage({desktop:true,guest:false,profile:null}),false);
 assert.equal(useLoginPage({desktop:false,guest:true,profile:null}),false);
 assert.equal(useLoginPage({desktop:false,guest:false,profile:{kind:'guest'}}),false);
 assert.equal(useLoginPage({desktop:false,guest:false,profile:null}),true);
});

test('standalone password login is public and its cookie authenticates the app',async()=>{
 const app=await createApp({port:0,dbPath:':memory:'});
 try{
  for(const path of ['/login','/login/']){
   const response=await fetch(app.url+path);assert.equal(response.status,200);assert.equal(response.headers.get('set-cookie'),null);
   const html=await response.text();assert.match(html,/id="account-form" method="post" action="\/api\/auth\/login"/);assert.match(html,/autocomplete="current-password"/);assert.match(html,/src="\/auth\/mine-v2.webp"/);assert.doesNotMatch(html,/扫码|短信|QQ|微信/);
   assert.match(response.headers.get('content-security-policy'),/form-action 'self'/);
  }
  for(const [path,type] of [['/auth/login.js','text/javascript'],['/auth/session.js','text/javascript'],['/auth/style.css','text/css'],['/auth/world-v1.webp','image/webp'],['/auth/mine-v2.webp','image/webp']]){
   const response=await fetch(app.url+path);assert.equal(response.status,200);assert.ok(response.headers.get('content-type').startsWith(type));
   if(type==='image/webp'){assert.match(response.headers.get('cache-control'),/immutable/);assert.equal(Buffer.from(await response.arrayBuffer()).toString('ascii',0,4),'RIFF');}
  }
  const first=authClient(app),returning=authClient(app);
  assert.equal((await returning.call('/api/state')).status,401);
  assert.equal((await first.call('/api/auth/register',{username:'LoginPreview',password:accountSecret})).status,201);
  assert.equal((await returning.call('/api/auth/login',{username:'LoginPreview',password:'incorrect-password'})).status,401);
  assert.equal((await returning.call('/api/auth/login',{username:'LoginPreview',password:accountSecret})).status,200);
  const state=await returning.call('/api/state');assert.equal(state.data.profile.kind,'account');assert.equal(state.data.profile.username,'loginpreview');
  assert.equal((await returning.call('/api/auth/logout',{})).status,200);
  assert.equal((await returning.call('/api/state')).status,401);
 }finally{await app.close();}
});


test('legacy web game-library pages lead to the official homepage without serving native UI',async()=>{
 const app=await createApp({port:0,dbPath:':memory:'});try{
  for(const path of ['/launcher','/launcher/','/launcher/index.html']){
   const response=await fetch(app.url+path,{redirect:'manual',headers:{'User-Agent':'joincraft/0.9.15 Electron/45.3.1'}});
   assert.equal(response.status,302);assert.equal(response.headers.get('location'),'/');
  }
 }finally{await app.close();}
});
