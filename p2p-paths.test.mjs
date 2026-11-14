import test from 'node:test';
import assert from 'node:assert/strict';
import {PeerConnections} from './bridge/peers.mjs';
const id='11111111-1111-4111-8111-111111111111';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(createPeer,timeout=20){const routes=[],sent=[];const peers=new PeerConnections({role:'guest',createPeer,send:value=>sent.push(value),onStream:stream=>stream.destroy(),onRoute:value=>routes.push(value),timeout});return {peers,routes,sent};}
test('an unsuccessful direct attempt falls back within its deadline and releases a late peer',async()=>{
 let finish,closed=0;const f=fixture(()=>new Promise(resolve=>finish=resolve));f.peers.start();f.peers.handle({type:'p2p-peer',peerId:id,initiator:true});const path=f.peers.openStream();
 await new Promise(r=>setTimeout(r,40));assert.equal(await path,null);assert.equal(f.routes.at(-1).transport,'relay');
 finish({close:()=>closed++});await turn();assert.equal(closed,1);assert.equal(f.sent.filter(m=>m.type==='p2p-signal'&&m.signal.type==='close').length,1);f.peers.close();
});
test('direct loss uses relay only for new connections and never replays an old stream',async()=>{
 let callbacks,opened=0,closed=0;const directStream={marker:'one TCP stream'};
 const f=fixture(async value=>{callbacks=value;return {signal:async()=>{},stats:async()=>({latency:7}),openStream:async()=>{opened++;return directStream;},close:()=>closed++};},1000);
 f.peers.start();f.peers.handle({type:'p2p-peer',peerId:id,initiator:true});await turn();callbacks.onState({status:'ready'});await turn();
 assert.equal(await f.peers.openStream(),directStream);assert.equal(f.routes.at(-1).latency,7);
 callbacks.onState({status:'closed'});assert.equal(await f.peers.openStream(),null);assert.equal(opened,1);assert.equal(closed,1);assert.equal(f.routes.at(-1).transport,'relay');f.peers.close();
});
test('cancelling negotiation releases waiting connections and suppresses late signals',async()=>{
 let options,finish,closed=0;const f=fixture(value=>{options=value;return new Promise(resolve=>finish=resolve);});f.peers.start();f.peers.handle({type:'p2p-peer',peerId:id,initiator:true});await turn();
 const pending=f.peers.openStream();f.peers.close();assert.equal(await pending,null);const count=f.sent.length;options.onSignal({type:'offer',sdp:'late'});options.onState({status:'ready'});assert.equal(f.sent.length,count);
 finish({close:()=>closed++});await turn();assert.equal(closed,1);
});
test('peer creation failures preserve a working relay rather than failing the game session',async()=>{
 const f=fixture(async()=>{throw Error('WebRTC unavailable');});f.peers.start();f.peers.handle({type:'p2p-peer',peerId:id,initiator:true});await turn();assert.equal(await f.peers.openStream(),null);assert.equal(f.routes.at(-1).transport,'relay');f.peers.close();
});
