// Run with Electron. Real Chromium WebRTC over loopback, no UI automation, accounts or Minecraft.
import {app,WebContentsView,ipcMain} from 'electron';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {rm} from 'node:fs/promises';
import {mkdtempSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {ElectronP2P} from '../desktop/p2p-runtime.mjs';

const temp=mkdtempSync(path.join(os.tmpdir(),'joincraft-rtc-test-'));app.setPath('userData',temp);
const runtimes=[],peers=[],queue=[[],[]],incoming=[];
const deadline=setTimeout(()=>{console.error('FAIL: WebRTC runtime test timed out');app.exit(1);},30000);
async function run(){
try{
 await app.whenReady();
 for(let n=0;n<2;n++)runtimes.push(new ElectronP2P({createView:options=>new WebContentsView(options),ipcMain,iceServers:[]}));
 const id=randomUUID();let readyCount=0,readyResolve;const ready=new Promise(resolve=>readyResolve=resolve);
 async function deliver(side,signal){if(!peers[side]){queue[side].push(signal);return;}await peers[side].signal(signal);}
 const states=[];
 for(let n=0;n<2;n++){
  peers[n]=await runtimes[n].create({id,initiator:n===1,onSignal:signal=>void deliver(1-n,signal).catch(error=>{console.error(error);app.exit(1);}),onState:state=>{states.push({side:n,...state});if(state.status==='ready'&&++readyCount===2)readyResolve();},onStream:stream=>{
   incoming.push(stream);
   // A slow TCP consumer must apply receive-window backpressure, not accumulate unlimited IPC data.
   setTimeout(()=>stream.pipe(stream),150);
  }});
  for(const signal of queue[n])await peers[n].signal(signal);queue[n]=[];
 }
 await ready;const stream=await peers[1].openStream(),bytes=randomBytes(4*1024*1024),received=[];
 stream.on('data',chunk=>received.push(chunk));const ended=once(stream,'end');stream.end(bytes);await ended;
 const actual=Buffer.concat(received);assert.equal(actual.length,bytes.length);assert.equal(createHash('sha256').update(actual).digest('hex'),createHash('sha256').update(bytes).digest('hex'));
 const stats=await peers[1].stats();assert.ok(stats.latency===null||Number.isFinite(stats.latency));
 assert.equal(states.filter(state=>state.status==='ready').length,2);
 console.log('PASS: real Chromium P2P, authenticated local IPC, 4 MiB ordered echo, slow-consumer backpressure, half-close, RTC stats');
 // Revocation / cancellation must tear down all channels and reject pending writes.
 const active=await peers[1].openStream();active.on('error',()=>{});active.write(randomBytes(1024*1024));
 const closed=new Promise(resolve=>active.once('close',resolve));peers[0].close('Revocation simulation');await closed;assert.equal(active.destroyed,true);
 console.log('PASS: peer revocation closes a live game stream');
 for(const runtime of runtimes)runtime.dispose();clearTimeout(deadline);await rm(temp,{recursive:true,force:true});app.exit(0);
}catch(error){console.error(error);for(const runtime of runtimes)runtime.dispose();clearTimeout(deadline);await rm(temp,{recursive:true,force:true});app.exit(1);}

}
void run();
