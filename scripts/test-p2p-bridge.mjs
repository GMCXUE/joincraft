// Real backend, TCP and Chromium DataChannels. Minecraft is a protocol fixture, not a game process.
import {app,WebContentsView,ipcMain} from 'electron';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import net from 'node:net';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtempSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ElectronP2P} from '../desktop/p2p-runtime.mjs';
import {startBridge} from '../bridge/client.mjs';
import {packet,varint,status} from '../bridge/minecraft.mjs';
import {createApp} from '../server.mjs';

const temp=mkdtempSync(path.join(os.tmpdir(),'joincraft-p2p-flow-'));app.setPath('userData',temp);
const runtimes=[],bridges=[],sockets=new Set();let backend,mc;
const wait=async fn=>{for(let n=0;n<300;n++){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,20));}throw Error('P2P state did not settle');};
async function cleanup(){for(const bridge of bridges)bridge.close();for(const runtime of runtimes)runtime.dispose();for(const socket of sockets)socket.destroy();if(mc)await new Promise(resolve=>mc.close(resolve));await backend?.close();await rm(temp,{recursive:true,force:true});}
async function run(){
 const deadline=setTimeout(()=>{console.error('FAIL: P2P bridge test timed out');app.exit(1);},45000);
 try{
  await app.whenReady();backend=await createApp({port:0,dbPath:':memory:',packDir:path.join(temp,'packs')});
  mc=net.createServer({allowHalfOpen:true},socket=>{sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));let echo=false;socket.on('data',bytes=>{
   if(echo||bytes[0]===0x7e){echo=true;socket.write(bytes);return;}
   const json=Buffer.from(JSON.stringify({version:{name:'P2P MC simulation',protocol:763}}));socket.end(packet(Buffer.concat([varint(0),varint(json.length),json])));
  });socket.on('end',()=>socket.end());});mc.listen(0,'127.0.0.1');await once(mc,'listening');
  const call=async(route,body,token)=>{const response=await fetch(backend.url+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});const value=await response.json();assert.ok(response.ok,value.error);return value;};
  const host=(await call('/api/session',{name:'Host'})).id,guests=[];for(let i=0;i<3;i++)guests.push((await call('/api/session',{name:'Guest '+i})).id);
  const room=await call('/api/rooms',{name:'Real P2P bridge fixture',capacity:4},host);for(const token of guests)await call('/api/join',{code:room.code},token);
  const routes=[[],[],[],[]];
  async function client(token,index,{mode='auto',factory=true}={}){
   const runtime=new ElectronP2P({createView:options=>new WebContentsView(options),ipcMain,iceServers:[]});runtimes.push(runtime);
   const issued=await call(`/api/rooms/${room.id}/play/${index===0?'start':'connect'}`,{port:mc.address().port},token);
   const bridge=await startBridge({server:backend.url,ticket:issued.ticket,peerFactory:typeof factory==='function'?factory:factory?options=>runtime.create(options):undefined,connectionMode:mode,peerTimeout:2000,onState:event=>{if(event.status==='route')routes[index].push(event);}});bridges.push(bridge);return {bridge,runtime};
  }
  const owner=await client(host,0);const a=await client(guests[0],1),b=await client(guests[1],2),c=await client(guests[2],3,{mode:'relay'});
  await wait(()=>routes[1].some(r=>r.transport==='p2p')&&routes[2].some(r=>r.transport==='p2p'));
  for(const member of [a,b,c])assert.equal((await status(Number(member.bridge.address.split(':')[1]))).version,'P2P MC simulation');
  const echo=async member=>{const bytes=randomBytes(2*1024*1024);bytes[0]=0x7e;return new Promise((resolve,reject)=>{const received=[];let total=0;const socket=net.createConnection({host:'127.0.0.1',port:Number(member.bridge.address.split(':')[1])});socket.on('error',reject);socket.setTimeout(15000,()=>socket.destroy(Error('Echo timeout')));socket.once('connect',()=>socket.write(bytes));socket.on('data',chunk=>{received.push(chunk);total+=chunk.length;if(total>=bytes.length){assert.equal(createHash('sha256').update(Buffer.concat(received)).digest('hex'),createHash('sha256').update(bytes).digest('hex'));resolve(socket);}});});};
  const live=await Promise.all([echo(a),echo(b),echo(c)]);
  const snapshot=await wait(async()=>{const value=await call('/api/state',undefined,host);return value.rooms[0].connection.connections===1&&value;});assert.deepEqual(snapshot.rooms[0].connection.routes,{direct:2,relay:1});assert.equal(routes[3].at(-1).transport,'relay');for(const socket of live)socket.end();
  console.log('PASS: one host, two real P2P guests and one forced-relay guest; MC status and 6 MiB concurrent TCP echo; per-member routes');
  const stalled=await client(guests[2],3,{factory:async()=>({signal:async()=>{},close(){},stats:async()=>({latency:null})})});
  assert.equal((await status(Number(stalled.bridge.address.split(':')[1]),6000)).version,'P2P MC simulation');assert.equal(routes[3].at(-1).transport,'relay');
  console.log('PASS: deliberately stalled ICE negotiation falls back to the existing WSS relay');
  // Direct loss ends its TCP streams. A fresh MC connection reuses the same local listener via WSS.
  owner.runtime.dispose();await wait(()=>routes[1].at(-1)?.transport==='relay'&&routes[2].at(-1)?.transport==='relay');
  assert.equal((await status(Number(a.bridge.address.split(':')[1]))).version,'P2P MC simulation');
  console.log('PASS: P2P interruption falls back for new game connections without replaying old game bytes');
  await call(`/api/rooms/${room.id}/leave`,{},guests[0]);await wait(async()=>{try{await status(Number(a.bridge.address.split(':')[1]),100);return false;}catch{return true;}});
  console.log('PASS: room revocation closes direct/relay capability and loopback listener');
  await cleanup();clearTimeout(deadline);app.exit(0);
 }catch(error){console.error(error);await cleanup();clearTimeout(deadline);app.exit(1);}
}
void run();
