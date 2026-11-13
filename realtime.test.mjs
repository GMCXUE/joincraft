import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {createApp} from './dist/app.js';
import {createRealtime,applyStatePatch} from './public/realtime.js';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,timeout=4000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await delay(15);}throw Error('Condition did not settle');}
class Client{
 constructor(ws){this.ws=ws;this.frames=[];this.queue=[];this.waiters=[];this.closed=new Promise(resolve=>ws.on('close',(code,reason)=>resolve({code,reason:reason.toString()})));ws.on('error',()=>{});ws.on('message',data=>{const value=JSON.parse(data.toString());if(value.type==='ready')this.state=value.state;else if(value.type==='state.patch')this.state=applyStatePatch(this.state,value.patch);this.frames.push(value);const index=this.waiters.findIndex(waiter=>waiter.match(value));if(index>=0){const waiter=this.waiters.splice(index,1)[0];clearTimeout(waiter.timer);waiter.resolve(value);}else this.queue.push(value);});}
 wait(match,timeout=4000){const index=this.queue.findIndex(match);if(index>=0)return Promise.resolve(this.queue.splice(index,1)[0]);return new Promise((resolve,reject)=>{const waiter={match,resolve,timer:setTimeout(()=>{this.waiters=this.waiters.filter(item=>item!==waiter);reject(Error('Expected frame did not arrive'));},timeout)};this.waiters.push(waiter);});}
 async request(type,body){const requestId=randomUUID();this.ws.send(JSON.stringify({type,body,requestId}));return this.wait(frame=>frame.type==='reply'&&frame.requestId===requestId);}
 stop(){this.ws.terminate();for(const waiter of this.waiters)clearTimeout(waiter.timer);}
}
async function fixture(run){
 let now=Date.now();const app=await createApp({port:0,dbPath:':memory:',now:()=>now}),clients=[];
 const call=async(path,body,token,extra={})=>{const response=await fetch(app.url+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{'X-Session':token}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')};};
 const register=async(username)=>{const result=await call('/api/auth/register',{username,password:'LocalWs_2026_test',name:username});assert.equal(result.status,201);const token=result.cookie.split(';')[0].split('=')[1];return {token,...(await call('/api/state',undefined,token)).data.profile};};
 const raw=async(options={})=>{const ws=new WebSocket(app.url.replace('http:','ws:')+'/api/realtime',{headers:{Origin:app.url},...options}),client=new Client(ws);clients.push(client);await once(ws,'open');return client;};
 const ticket=async token=>{const result=await call('/api/realtime/ticket',{},token);assert.equal(result.status,200);return result.data.ticket;};
 const connect=async(token,options)=>{const client=await raw(options);client.ws.send(JSON.stringify({type:'auth',ticket:await ticket(token)}));const ready=await client.wait(frame=>frame.type==='ready');return client;};
 try{
  const alice=await register('ws_alice'),bob=await register('ws_bob'),other=await register('ws_other');
  await run({app,call,alice,bob,other,raw,ticket,connect,tick:ms=>now+=ms});
 }finally{for(const client of clients)client.stop();await app.close();}
}
async function befriend(call,alice,bob){assert.equal((await call('/api/friends/request',{username:bob.username},alice.token)).status,200);assert.equal((await call(`/api/friends/${alice.id}/accept`,{},bob.token)).status,200);}

test('WS handshake needs a single-use, unexpired REST-authenticated ticket and same-origin upgrade',()=>fixture(async({app,call,alice,raw,ticket,tick})=>{
 assert.equal((await call('/api/realtime/ticket',{})).status,401);
 assert.equal((await call('/api/realtime/ticket',{},alice.token,{Origin:'https://evil.invalid'})).status,403);
 const bad=new WebSocket(app.url.replace('http:','ws:')+'/api/realtime',{headers:{Origin:'https://evil.invalid'}});bad.on('error',()=>{});
 const [,response]=await once(bad,'unexpected-response');assert.equal(response.statusCode,403);response.resume();bad.terminate();
 const value=await ticket(alice.token),a=await raw();a.ws.send(JSON.stringify({type:'auth',ticket:value}));assert.equal((await a.wait(frame=>frame.type==='ready')).state.profile.id,alice.id);
 const b=await raw();b.ws.send(JSON.stringify({type:'auth',ticket:value}));assert.equal((await b.wait(frame=>frame.type==='error')).status,401);assert.equal((await b.closed).code,4401);
 const expired=await ticket(alice.token);tick(30001);const c=await raw();c.ws.send(JSON.stringify({type:'auth',ticket:expired}));assert.equal((await c.wait(frame=>frame.type==='error')).status,401);
 const d=await raw();d.ws.send(JSON.stringify({type:'chat.send',body:{content:'unauthenticated'}}));assert.equal((await d.wait(frame=>frame.type==='error')).status,401);assert.equal(d.frames.some(frame=>frame.type==='ready'),false);
}));

test('private WS sends persist before ACK, broadcast to both devices, exclude outsiders and deduplicate retries',()=>fixture(async({call,alice,bob,other,connect})=>{
 await befriend(call,alice,bob);
 const a=await connect(alice.token),second=await connect(alice.token),b=await connect(bob.token),outsider=await connect(other.token);
 const body={peerId:bob.id,content:'WS private message',clientId:randomUUID()};
 const ack=await a.request('chat.send',body);assert.equal(ack.ok,true);assert.equal(ack.result.self,true);
 const event=(await b.wait(frame=>frame.type==='event'&&frame.event.type==='chat.message')).event;assert.equal(event.peerId,alice.id);assert.equal(event.message.self,false);assert.equal(event.message.content,body.content);
 assert.equal((await second.wait(frame=>frame.type==='event')).event.message.id,ack.result.id);
 assert.equal((await call(`/api/chats/${alice.id}/messages`,undefined,bob.token)).data.messages[0].id,ack.result.id);
 assert.equal((await a.request('chat.send',body)).result.id,ack.result.id);
 assert.equal((await call(`/api/chats/${bob.id}/messages`,body,alice.token)).data.id,ack.result.id);
 assert.equal((await a.request('chat.send',{...body,content:'conflict'})).status,409);
 assert.equal((await outsider.request('chat.send',{...body,peerId:alice.id})).status,403);
 assert.equal((await a.request('chat.read',{peerId:bob.id,uptoId:ack.result.id})).ok,true);
 await until(()=>b.state.social.unread===1);assert.equal((await b.request('chat.read',{peerId:alice.id,uptoId:ack.result.id})).ok,true);await until(()=>b.state.social.unread===0);
 await delay(50);assert.equal(outsider.frames.some(frame=>frame.type==='event'),false);
 const states=a.frames.filter(frame=>frame.type==='state.patch');assert(states.some(frame=>frame.patch.social));assert(states.every(frame=>!frame.patch.rooms));
 for(const client of [a,b,second])assert.deepEqual(client.frames.map(frame=>frame.sequence),client.frames.map((_,i)=>i+1));
}));

test('room WS events and state patches follow membership; leaving stops messages and rejects commands',()=>fixture(async({call,alice,bob,other,connect})=>{
 const room=(await call('/api/rooms',{name:'WS room'},alice.token)).data;await call('/api/join',{code:room.code},bob.token);
 const a=await connect(alice.token),b=await connect(bob.token),c=await connect(other.token);
 const body={roomId:room.id,content:'room message',clientId:randomUUID()},ack=await a.request('room.send',body);assert.equal(ack.ok,true);assert.equal(ack.result.userId,alice.id);
 assert.equal((await b.wait(frame=>frame.type==='event')).event.message.content,body.content);assert.equal((await b.request('room.read',{roomId:room.id,lastId:ack.result.id})).ok,true);
 assert.equal((await c.request('room.send',body)).status,404);assert.equal((await a.request('room.send',body)).result.id,ack.result.id);
 await call(`/api/rooms/${room.id}/leave`,{},bob.token);await until(()=>b.state.rooms.length===0);
 const received=b.frames.filter(frame=>frame.type==='event').length;
 await a.request('room.send',{...body,clientId:randomUUID(),content:'after leaving'});await delay(50);
 assert.equal(b.frames.filter(frame=>frame.type==='event').length,received);assert.equal((await b.request('room.read',{roomId:room.id,lastId:ack.result.id})).status,404);
 await call(`/api/rooms/${room.id}/close`,{},alice.token);await until(()=>a.state.rooms[0].closed===true);
 assert.equal((await a.request('room.send',{...body,clientId:randomUUID()})).status,400);
 assert.equal(c.frames.some(frame=>frame.type==='event'),false);
}));

test('friend requests, acceptance, room changes and multi-device online presence arrive without state polling',()=>fixture(async({call,alice,bob,connect})=>{
 const a=await connect(alice.token),b=await connect(bob.token),second=await connect(bob.token);
 await call('/api/friends/request',{username:bob.username},alice.token);await until(()=>b.state.social.requests.length===1);
 await call(`/api/friends/${alice.id}/accept`,{},bob.token);await until(()=>a.state.social.friends[0]?.online===true);
 b.ws.close();await b.closed;await delay(30);assert.equal(a.state.social.friends[0].online,true);
 second.ws.close();await second.closed;await until(()=>a.state.social.friends[0].online===false);
 const room=(await call('/api/rooms',{name:'created live'},alice.token)).data;await until(()=>a.state.rooms.some(value=>value.id===room.id));
 await call(`/api/rooms/${room.id}/game`,{version:'1.21.1',loader:'Fabric',port:51234},alice.token);await until(()=>a.state.rooms[0].version==='1.21.1');
}));

test('revoking a session closes its sockets and unused tickets immediately',()=>fixture(async({call,alice,raw,ticket,connect})=>{
 const a=await connect(alice.token),b=await connect(alice.token),value=await ticket(alice.token);
 await call('/api/auth/logout',{},alice.token);assert.equal((await a.closed).code,4401);assert.equal((await b.closed).code,4401);
 const c=await raw();c.ws.send(JSON.stringify({type:'auth',ticket:value}));assert.equal((await c.wait(frame=>frame.type==='error')).status,401);
}));

test('WS frame bounds, operation validation and six-device connection limit are enforced',()=>fixture(async({alice,raw,connect,ticket})=>{
 const a=await connect(alice.token);assert.equal((await a.request('unknown.operation',{})).status,400);
 a.ws.send('{bad JSON');assert.equal((await a.wait(frame=>frame.type==='error')).status,400);
 for(let i=0;i<5;i++)await connect(alice.token);
 const extra=await raw();extra.ws.send(JSON.stringify({type:'auth',ticket:await ticket(alice.token)}));assert.equal((await extra.wait(frame=>frame.type==='error')).status,429);assert.equal((await extra.closed).code,4429);
 // Creating the seventh authenticated connection must not reveal an initial snapshot.
 const first=a.frames.find(frame=>frame.type==='ready');assert.equal(first.schema,1);
 a.ws.send('x'.repeat(17000));assert.equal((await a.closed).code,1009);
 extra.stop();
}));

test('after cursors recover more than one history page, preserve order and remain access-controlled',()=>fixture(async({call,alice,bob,other,tick})=>{
 await befriend(call,alice,bob);const room=(await call('/api/rooms',{name:'catchup'},alice.token)).data;await call('/api/join',{code:room.code},bob.token);
 let firstPrivate,firstRoom;
 for(let i=0;i<125;i++){
  if(i%30===0)tick(60001);
  const direct=await call(`/api/chats/${bob.id}/messages`,{content:'direct '+i,clientId:randomUUID()},alice.token);assert.equal(direct.status,200);firstPrivate??=direct.data.id;
  const group=await call(`/api/rooms/${room.id}/messages`,{content:'group '+i,clientId:randomUUID()},alice.token);assert.equal(group.status,200);firstRoom??=group.data.id;
 }
 for(const [path,first,token] of [[`/api/chats/${alice.id}/messages`,firstPrivate,bob.token],[`/api/rooms/${room.id}/messages`,firstRoom,bob.token]]){
  const page=(await call(path+'?after='+first,undefined,token)).data;assert.equal(page.messages.length,100);assert.equal(page.hasMore,true);
  const next=(await call(path+'?after='+page.messages.at(-1).id,undefined,token)).data;assert.equal(next.messages.length,24);assert.equal(next.hasMore,false);
  assert.equal(new Set([...page.messages,...next.messages].map(message=>message.id)).size,124);
  assert.equal((await call(path+'?after=0&before=2',undefined,token)).status,400);
  assert([403,404].includes((await call(path+'?after=0',undefined,other.token)).status));
 }
}));

test('actual browser transport retries a lost ACK with the original message identifier',()=>fixture(async({app,call,alice,bob})=>{
 await befriend(call,alice,bob);let dropped=false,ready=0,transport;
 class DropFirstReply extends WebSocket{
  addEventListener(type,listener,...rest){
   if(type!=='message')return super.addEventListener(type,listener,...rest);
   return super.addEventListener(type,event=>{const frame=JSON.parse(event.data);if(frame.type==='reply'&&!dropped){dropped=true;this.terminate();return;}listener(event);},...rest);
  }
 }
 try{
  transport=createRealtime({url:app.url,WebSocketClass:DropFirstReply,getHeaders:()=>({'X-Session':alice.token}),onState:()=>{},onEvent:()=>{},onReady:()=>ready++,onUnauthorized:()=>assert.fail('Unexpected logout'),onStatus:()=>{},reconnectDelay:10});
  await until(()=>transport.connected);const message=await transport.request('chat.send',{peerId:bob.id,content:'retry once',clientId:randomUUID()});
  assert.equal(message.content,'retry once');assert.equal(dropped,true);assert(ready>=2);assert.equal((await call(`/api/chats/${bob.id}/messages`,undefined,alice.token)).data.messages.length,1);
 }finally{transport?.close();}
}));

test('state patch ordering preserves newer HTTP state and removes departed rooms',()=>{
 const state={revision:10,profile:{id:'self'},rooms:[{id:'a'},{id:'b'}],social:{unread:2}};
 assert.equal(applyStatePatch(state,{revision:9,social:{unread:0}}),state);
 const result=applyStatePatch(state,{revision:11,rooms:{remove:['a'],upsert:[{id:'c'}],order:['c','b']},social:{unread:0}});
 assert.deepEqual(result.rooms,[{id:'c'},{id:'b'}]);assert.equal(result.social.unread,0);assert.equal(state.social.unread,2);
});


test('unauthenticated sockets time out and expired sessions cannot send',()=>fixture(async({alice,raw,connect,tick})=>{
 const authenticated=await connect(alice.token);tick(31*86400000);assert.equal((await authenticated.request('chat.read',{peerId:'none',uptoId:0})).status,401);assert.equal((await authenticated.closed).code,4401);
 const anonymous=await raw();assert.equal((await anonymous.closed).code,4401);assert.equal(anonymous.frames.length,0);
}));

test('heartbeat closes peers that do not answer ping frames',{timeout:40000},()=>fixture(async({alice,connect})=>{
 const client=await connect(alice.token,{autoPong:false});await client.wait(frame=>frame.type==='heartbeat',18000);let timer;try{const end=await Promise.race([client.closed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Stale peer remained connected')),18000);})]);assert.equal(end.code,1006);}finally{clearTimeout(timer);}
}));


test('malformed-frame bursts are bounded before JSON parsing',()=>fixture(async({alice,connect})=>{
 const client=await connect(alice.token);for(let i=0;i<130;i++)client.ws.send('{malformed');assert.equal((await client.closed).code,1006);
}));
