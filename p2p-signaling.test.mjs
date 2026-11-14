import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {createApp} from './server.mjs';

const wait=async fn=>{for(let n=0;n<100;n++){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out waiting for P2P signalling');};
async function fixture(t){
 const app=await createApp({port:0,dbPath:':memory:'}),sockets=[];
 t.after(async()=>{for(const ws of sockets)ws.terminate();await app.close();});
 const call=async(route,body,token)=>{const response=await fetch(app.url+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();assert.ok(response.ok,data.error);return data;};
 const host=(await call('/api/session',{name:'Host'})).id,guest=(await call('/api/session',{name:'Guest'})).id,room=await call('/api/rooms',{name:'P2P protocol fixture'},host);
 await call('/api/join',{code:room.code},guest);
 async function connect(token,action,id=room.id){
  const issued=await call(`/api/rooms/${id}/play/${action}`,{port:25565},token),ws=new WebSocket(app.url.replace('http','ws')+'/bridge/control',{headers:{Authorization:'Bearer '+issued.ticket}}),messages=[];
  sockets.push(ws);ws.on('error',()=>{});ws.on('message',raw=>messages.push(JSON.parse(raw.toString())));await once(ws,'open');const welcome=await wait(()=>messages.find(m=>m.type==='welcome'));
  const send=value=>ws.send(JSON.stringify(value));send(action==='start'?{type:'ready',version:'Protocol simulation'}:{type:'ready',port:30001});
  await wait(async()=>(await call('/api/state',undefined,token)).rooms.find(r=>r.id===id)?.connection.local?.status==='ready');
  return {ws,messages,welcome,send,next:type=>wait(()=>{const i=messages.findIndex(m=>m.type===type);return i>=0&&messages.splice(i,1)[0];})};
 }
 const owner=await connect(host,'start'),member=await connect(guest,'connect');
 return {app,call,host,guest,room,owner,member,connect};
}
test('P2P negotiation uses live agent IDs, binds host and guest, and keeps network candidates private',async t=>{
 const f=await fixture(t);f.member.send({type:'p2p-enable',version:1});f.owner.send({type:'p2p-enable',version:1});
 const [hostPeer,guestPeer]=await Promise.all([f.owner.next('p2p-peer'),f.member.next('p2p-peer')]);
 assert.equal(hostPeer.initiator,false);assert.equal(guestPeer.initiator,true);assert.equal(hostPeer.peerId,f.member.welcome.peerId);assert.equal(guestPeer.peerId,f.owner.welcome.peerId);
 f.member.send({type:'p2p-signal',peerId:guestPeer.peerId,signal:{type:'offer',sdp:'synthetic private SDP',untrusted:'removed'}});
 assert.deepEqual(await f.owner.next('p2p-signal'),{type:'p2p-signal',peerId:hostPeer.peerId,signal:{type:'offer',sdp:'synthetic private SDP'}});
 f.owner.send({type:'p2p-signal',peerId:hostPeer.peerId,signal:{type:'answer',sdp:'synthetic answer'}});assert.equal((await f.member.next('p2p-signal')).signal.type,'answer');
 f.member.send({type:'p2p-route',transport:'p2p',latency:12.6});
 const state=await wait(async()=>{const value=await f.call('/api/state',undefined,f.guest);return value.rooms[0].connection.local.transport==='p2p'&&value;});
 assert.equal(state.rooms[0].connection.local.latency,13);assert.equal(state.rooms[0].connection.routes.direct,1);assert.doesNotMatch(JSON.stringify(state),/synthetic private|sdp|candidate|peerId/);
});
test('old clients receive no P2P events and still have the existing relay interface',async t=>{
 const f=await fixture(t);f.member.send({type:'p2p-enable',version:1});
 await new Promise(r=>setTimeout(r,30));assert.equal(f.owner.messages.some(m=>m.type.startsWith('p2p-')),false);
 await wait(async()=>(await f.call('/api/state',undefined,f.guest)).rooms[0].connection.local.transport==='checking');
 f.member.send({type:'p2p-route',transport:'relay',latency:null});
 const state=await wait(async()=>{const value=await f.call('/api/state',undefined,f.guest);return value.rooms[0].connection.local.transport==='relay'&&value;});assert.equal(state.rooms[0].connection.local.transport,'relay');assert.equal(state.rooms[0].connection.routes.relay,1);
});
test('cross-room signalling and wrong-role offers are rejected',async t=>{
 const f=await fixture(t);f.owner.send({type:'p2p-enable',version:1});f.member.send({type:'p2p-enable',version:1});await f.owner.next('p2p-peer');
 const outsider=(await f.call('/api/session',{name:'Other host'})).id,other=await f.call('/api/rooms',{name:'Other room'},outsider),otherHost=await f.connect(outsider,'start',other.id);
 otherHost.send({type:'p2p-enable',version:1});
 const closed=once(f.member.ws,'close');f.member.send({type:'p2p-signal',peerId:otherHost.welcome.peerId,signal:{type:'offer',sdp:'must not arrive'}});assert.equal((await closed)[0],1008);assert.equal(otherHost.messages.some(m=>m.type==='p2p-signal'),false);
 const denied=once(f.owner.ws,'close');f.owner.send({type:'p2p-signal',peerId:otherHost.welcome.peerId,signal:{type:'offer',sdp:'wrong role'}});assert.equal((await denied)[0],1008);
});
test('leaving the room revokes the direct peer and sends a teardown to the host',async t=>{
 const f=await fixture(t);f.owner.send({type:'p2p-enable',version:1});f.member.send({type:'p2p-enable',version:1});await f.owner.next('p2p-peer');await f.member.next('p2p-peer');
 await f.call(`/api/rooms/${f.room.id}/leave`,{},f.guest);assert.deepEqual(await f.owner.next('p2p-left'),{type:'p2p-left',peerId:f.member.welcome.peerId});
 assert.equal((await f.call('/api/state',undefined,f.host)).rooms[0].connection.routes.direct,0);
});
test('a host cannot send an offer even to its correctly paired guest',async t=>{
 const f=await fixture(t);f.owner.send({type:'p2p-enable',version:1});f.member.send({type:'p2p-enable',version:1});const peer=await f.owner.next('p2p-peer');
 const closed=once(f.owner.ws,'close');f.owner.send({type:'p2p-signal',peerId:peer.peerId,signal:{type:'offer',sdp:'wrong direction'}});assert.equal((await closed)[0],1008);
});
test('oversized candidates are rejected before forwarding',async t=>{
 const f=await fixture(t);f.owner.send({type:'p2p-enable',version:1});f.member.send({type:'p2p-enable',version:1});const peer=await f.member.next('p2p-peer');
 const closed=once(f.member.ws,'close');f.member.send({type:'p2p-signal',peerId:peer.peerId,signal:{type:'candidate',candidate:{candidate:'x'.repeat(2049),sdpMid:'0',sdpMLineIndex:0}}});assert.equal((await closed)[0],1008);assert.equal(f.owner.messages.some(m=>m.type==='p2p-signal'),false);
});
