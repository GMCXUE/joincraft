import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createApp } from './server.mjs';
import { startBridge } from './bridge/client.mjs';
import { status, packet, varint } from './bridge/minecraft.mjs';

async function waitFor(check){for(let i=0;i<100;i++){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,20));}throw Error('State did not settle');}
async function fixture(run){
 const app=await createApp({port:0,dbPath:':memory:'});const bridges=[],sockets=new Set();
 const mc=net.createServer(socket=>{sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));let echo=false;socket.on('data',data=>{
  if(echo||data[0]===0x7e){echo=true;socket.write(data);return;}
  const text=Buffer.from(JSON.stringify({version:{name:'Java test fixture',protocol:767},players:{max:8,online:0},description:{text:'Protocol fixture'}}));
  socket.end(packet(Buffer.concat([varint(0),varint(text.length),text])));
 });});
 mc.listen(0,'127.0.0.1');await once(mc,'listening');const port=mc.address().port;
 const call=async(path,body,token)=>{const response=await fetch(app.url+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,data:await response.json()};};
 try{
  const host=(await call('/api/session',{name:'Host'})).data.id,guest=(await call('/api/session',{name:'Guest'})).data.id,other=(await call('/api/session',{name:'Other'})).data.id;
  const room=(await call('/api/rooms',{name:'Relay test',capacity:4},host)).data;
  await call('/api/join',{code:room.code},guest);
  const start=async()=>{const r=await call(`/api/rooms/${room.id}/play/start`,{port},host);assert.equal(r.status,200);const bridge=await startBridge({server:app.url,ticket:r.data.ticket});bridges.push(bridge);await waitFor(async()=>(await call('/api/state',undefined,host)).data.rooms[0].connection.status==='online');return r.data;};
  const join=async()=>{const r=await call(`/api/rooms/${room.id}/play/connect`,{},guest);assert.equal(r.status,200);const bridge=await startBridge({server:app.url,ticket:r.data.ticket});bridges.push(bridge);await waitFor(async()=>(await call('/api/state',undefined,guest)).data.rooms[0].connection.local?.status==='ready');return bridge;};
  await run({app,call,port,host,guest,other,room,start,join,bridges});
 }finally{for(const b of bridges)b.close();for(const s of sockets)s.destroy();await new Promise(r=>mc.close(r));await app.close();}
}

test('real TCP bridge carries Java status and backpressured binary traffic',()=>fixture(async({start,join,call,host,guest,room})=>{
 await start();const bridge=await join(),port=Number(bridge.address.split(':')[1]);
 assert.equal((await status(port)).version,'Java test fixture');
 const source=Buffer.alloc(2*1024*1024,0x7e);source[100]=0;source[source.length-1]=255;
 const received=await new Promise((resolve,reject)=>{
  const chunks=[];let size=0;const socket=net.createConnection({host:'127.0.0.1',port});socket.setTimeout(10000,()=>socket.destroy(Error('Transfer timeout')));socket.on('error',reject);socket.on('connect',()=>socket.write(source));socket.on('data',chunk=>{chunks.push(chunk);size+=chunk.length;if(size===source.length){socket.end();resolve(Buffer.concat(chunks));}});
 });
 assert.deepEqual(received,source);
 const owner=(await call('/api/state',undefined,host)).data.rooms[0].connection;
 assert.equal(owner.status,'online');assert.equal(owner.local.address,'');
 assert.equal(JSON.stringify(owner).includes(bridge.address),false,'guest loopback address stays private');
 await call(`/api/rooms/${room.id}/play/stop`,{},host);
 await waitFor(async()=>(await call('/api/state',undefined,guest)).data.rooms[0].connection.status==='offline');
 await assert.rejects(status(port,300));
}));

test('relay enforces host/member authority, one-use tickets and revocation on leave',()=>fixture(async({app,call,host,guest,other,room,port,start,join})=>{
 assert.equal((await call(`/api/rooms/${room.id}/play/start`,{port},guest)).status,403);
 assert.equal((await call(`/api/rooms/${room.id}/play/connect`,{},other)).status,404);
 assert.equal((await call(`/api/rooms/${room.id}/play/connect`,{},guest)).status,409);
 const issued=await start();
 await assert.rejects(startBridge({server:app.url,ticket:issued.ticket}));
 const bridge=await join();
 assert.equal((await call(`/api/rooms/${room.id}/play/stop`,{},guest)).status,403);
 await call(`/api/rooms/${room.id}/leave`,{},guest);
 await waitFor(async()=>{try{await status(Number(bridge.address.split(':')[1]),100);return false;}catch{return true;}});
 assert.equal((await call('/api/state',undefined,host)).data.rooms[0].connection.status,'online');
 await call(`/api/rooms/${room.id}/close`,{},host);
 assert.equal((await call('/api/state',undefined,host)).data.rooms[0].connection.status,'offline');
}));

test('MC detection rejects non-game ports and remote plaintext; bridge download is standalone',()=>fixture(async({app,call,host,room,bridges})=>{
 assert.throws(()=>startBridge({server:'http://example.com',ticket:'x'.repeat(43)}),/HTTPS/);
 const notMC=net.createServer(s=>{s.resume();s.end('HTTP/1.1 200 OK\r\n\r\nHello');});notMC.listen(0,'127.0.0.1');await once(notMC,'listening');
 try{await assert.rejects(status(notMC.address().port));}finally{await new Promise(r=>notMC.close(r));}
 const issued=await call(`/api/rooms/${room.id}/play/start`,{port:1},host);assert.equal(issued.status,400);
 const legacy=await fetch(app.url+'/downloads/blockroom-bridge.cjs');assert.equal(legacy.status,200);assert.match(legacy.headers.get('content-disposition'),/filename=blockroom-bridge.cjs/);const file=await fetch(app.url+'/downloads/joincraft-bridge.cjs');assert.equal(file.status,200);assert.match(file.headers.get('content-disposition'),/attachment/);const folder=await mkdtemp(join(tmpdir(),'blockroom-download-'));try{const path=join(folder,'bridge.cjs');await writeFile(path,await file.text());const output=await promisify(execFile)(process.execPath,[path]);assert.match(output.stdout,/joincraft Java 联机连接程序/);}finally{await rm(folder,{recursive:true,force:true});}
}));

test('logout shuts down host and guest transports',()=>fixture(async({app,call,host,guest,room,start,join})=>{
 await start();const bridge=await join();
 await call('/api/auth/logout',{},host);
 await waitFor(async()=>(await call('/api/state',undefined,guest)).data.rooms[0].connection.status==='error');
 await assert.rejects(status(Number(bridge.address.split(':')[1]),300));
}));


test('expired, cross-origin and unclaimed relay credentials cannot establish transports',async()=>{
 let now=Date.now();const app=await createApp({port:0,dbPath:':memory:',now:()=>now});
 const call=async(path,body,token)=>{const r=await fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});return r.json();};
 const denied=(path,token,origin)=>new Promise((resolve,reject)=>{const ws=new WebSocket(app.url.replace('http','ws')+path,{headers:{Authorization:`Bearer ${token}`,...(origin?{Origin:origin}:{})}});ws.on('unexpected-response',(_,r)=>{r.resume();ws.terminate();resolve(r.statusCode);});ws.on('error',()=>{});ws.on('open',()=>{ws.close();reject(Error('unauthorized transport accepted'));});});
 try{const host=(await call('/api/session',{name:'Host'})).id;const room=await call('/api/rooms',{name:'Expiry'},host);const t=await call(`/api/rooms/${room.id}/play/start`,{port:25565},host);
  assert.equal(await denied('/bridge/control',t.ticket,'https://untrusted.example'),403);
  assert.equal(await denied('/bridge/data/new',t.ticket),409);
  assert.equal(await denied('/bridge/control','invalid'),401);
  now+=300001;assert.equal(await denied('/bridge/control',t.ticket),401);
 }finally{await app.close();}
});

test('host process loss closes a live guest socket; a new start restores service',()=>fixture(async({call,host,guest,room,start,join,bridges})=>{
 await start();const member=await join();
 const socket=net.createConnection({host:'127.0.0.1',port:Number(member.address.split(':')[1])});socket.on('error',()=>{});await once(socket,'connect');socket.write(Buffer.from([0x7e,1,2,3]));await once(socket,'data');
 const closed=once(socket,'close');bridges[0].close();await closed;
 await waitFor(async()=>(await call('/api/state',undefined,guest)).data.rooms[0].connection.status==='error');
 await start();const replacement=await join();assert.equal((await status(Number(replacement.address.split(':')[1]))).version,'Java test fixture');
 assert.equal((await call('/api/state',undefined,host)).data.rooms[0].connection.local.status,'ready');
}));

test('guest disconnect leaves host online and back-to-back room starts invalidate old tickets',()=>fixture(async({app,call,host,guest,room,port,start,join})=>{
 const old=await call(`/api/rooms/${room.id}/play/start`,{port},host);
 await start();await assert.rejects(startBridge({server:app.url,ticket:old.data.ticket}));
 const member=await join();await call(`/api/rooms/${room.id}/play/disconnect`,{},guest);
 await waitFor(async()=>(await call('/api/state',undefined,guest)).data.rooms[0].connection.local===null);
 assert.equal((await call('/api/state',undefined,host)).data.rooms[0].connection.status,'online');
 await assert.rejects(status(Number(member.address.split(':')[1]),300));
}));

test('non-MC host error is surfaced and blocks member connection',()=>fixture(async({app,call,host,guest,room,port})=>{
 const plain=net.createServer(s=>{s.resume();s.end('HTTP/1.1 200 OK\r\n\r\nNot Minecraft');});plain.listen(0,'127.0.0.1');await once(plain,'listening');
 try{
  const issued=await call(`/api/rooms/${room.id}/play/start`,{port:plain.address().port},host);
  await assert.rejects(startBridge({server:app.url,ticket:issued.data.ticket}));
  const connection=await waitFor(async()=>{const c=(await call('/api/state',undefined,host)).data.rooms[0].connection;return c.status==='error'&&c;});
  assert.ok(connection.error);assert.equal((await call(`/api/rooms/${room.id}/play/connect`,{},guest)).status,409);
 }finally{await new Promise(r=>plain.close(r));}
}));
