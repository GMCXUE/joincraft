// Explicit deployment verification: creates disposable guest sessions and closes its test room.
// Uses synthetic protocol/audio only; no game or microphone is opened.
import assert from 'node:assert/strict';
import net from 'node:net';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import {startBridge} from '../bridge/client.mjs';
import {status,packet,varint} from '../bridge/minecraft.mjs';
import {Room,RoomEvent,AudioSource,AudioFrame,AudioStream,LocalAudioTrack,TrackPublishOptions,TrackSource,dispose} from '@livekit/rtc-node';
const origin=process.argv[2];
if(process.argv[3]!=='--allow-remote'||!origin?.startsWith('https://'))throw new Error('Usage: node scripts/deployment-smoke.mjs https://deployment --allow-remote');
const timeout=async(p,ms=15000)=>{let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Deployment check timed out')),ms);})]);}finally{clearTimeout(timer);}};
const call=async(path,body,token)=>{const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});const data=await response.json();assert.ok(response.ok,`${path}: ${response.status} ${data.error||''}`);return data;};
const waitFor=async check=>{for(let n=0;n<40;n++){const value=await check();if(value)return value;await delay(150);}throw new Error('Deployment state did not settle');};
const bridges=[],clients=[],sockets=new Set(),tokens=[];let room,source,track,reader;
const mc=net.createServer(socket=>{sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));let echo=false;socket.on('data',data=>{if(echo||data[0]===0x7e){echo=true;socket.write(data);return;}const text=Buffer.from(JSON.stringify({version:{name:'Joincraft deployment fixture',protocol:767},players:{max:4,online:0},description:{text:'Synthetic check'}}));socket.end(packet(Buffer.concat([varint(0),varint(text.length),text])));});});
mc.listen(0,'127.0.0.1');await once(mc,'listening');
try{
 assert.equal((await call('/healthz')).ok,true);
 for(const name of ['部署检查房主','部署检查成员'])tokens.push((await call('/api/session',{name})).id);
 const [host,guest]=tokens;room=await call('/api/rooms',{name:'部署自检（结束后关闭）',capacity:4},host);const base=`/api/rooms/${room.id}`;
 await call('/api/join',{code:room.code},guest);
 await call(base+'/messages',{content:'部署消息验证',clientId:randomUUID()},host);
 assert.equal((await call(base+'/messages',undefined,guest)).messages.at(-1).content,'部署消息验证');
 console.log('HTTPS, guest sessions, create/join room and chat: passed');
 const ticket=await call(base+'/play/start',{port:mc.address().port},host);bridges.push(await startBridge({server:origin,ticket:ticket.ticket}));
 await waitFor(async()=>(await call('/api/state',undefined,host)).rooms.find(r=>r.id===room.id)?.connection.status==='online');
 const guestTicket=await call(base+'/play/connect',{},guest),bridge=await startBridge({server:origin,ticket:guestTicket.ticket});bridges.push(bridge);
 await waitFor(async()=>(await call('/api/state',undefined,guest)).rooms.find(r=>r.id===room.id)?.connection.local?.status==='ready');
 const port=Number(bridge.address.split(':')[1]);assert.equal((await status(port,10000)).version,'Joincraft deployment fixture');
 const payload=Buffer.alloc(65536,0x7e);
 const returned=await timeout(new Promise((resolve,reject)=>{const chunks=[];let size=0;const socket=net.createConnection({host:'127.0.0.1',port});sockets.add(socket);socket.on('error',reject);socket.on('close',()=>sockets.delete(socket));socket.on('connect',()=>socket.write(payload));socket.on('data',data=>{chunks.push(data);size+=data.length;if(size===payload.length){socket.end();resolve(Buffer.concat(chunks));}});}));assert.deepEqual(returned,payload);
 await call(base+'/play/stop',{},host);console.log('Public WSS MC relay: Java status and 64 KiB round trip passed');
 const group=room.community.groups[0].id;
 for(const token of tokens){const lease=await call(`${base}/groups/${group}/join`,{},token);const client=new Room();clients.push(client);console.log('Voice lease issued; connecting peer',clients.length);await timeout(client.connect(lease.url,lease.token,{autoSubscribe:true,dynacast:false}),20000);console.log('Voice peer connected',clients.length);}
 const subscribed=new Promise(resolve=>clients[1].once(RoomEvent.TrackSubscribed,(...args)=>resolve(args)));
 source=new AudioSource(48000,1);track=LocalAudioTrack.createAudioTrack('deployment-synthetic-audio',source);const options=new TrackPublishOptions();options.source=TrackSource.SOURCE_MICROPHONE;
 await clients[0].localParticipant.publishTrack(track,options);const [remote]=await timeout(subscribed);reader=new AudioStream(remote,{sampleRate:48000,numChannels:1}).getReader();
 const audio=timeout((async()=>{let energy=0;for(let n=0;n<100;n++){const next=await reader.read();if(next.done)break;for(const sample of next.value.data)energy+=sample*sample;if(energy>100000000)return energy;}throw new Error('No decoded non-silent audio');})());
 for(let n=0;n<80;n++){const pcm=new Int16Array(480);for(let i=0;i<480;i++)pcm[i]=Math.round(Math.sin((n*480+i)*2*Math.PI*440/48000)*6000);await source.captureFrame(new AudioFrame(pcm,48000,1,480));}
 await source.waitForPlayout();await audio;console.log('Public WebRTC voice: synthetic PCM encoded, sent and decoded successfully');
}finally{
 await reader?.cancel().catch(()=>{});await Promise.all(clients.map(client=>client.disconnect().catch(()=>{})));await track?.close();await source?.close();
 for(const bridge of bridges)bridge.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>mc.close(resolve));
 if(room)await call(`/api/rooms/${room.id}/close`,{},tokens[0]).catch(()=>{});
 for(const token of tokens)await call('/api/auth/logout',{},token).catch(()=>{});
 await dispose();console.log('Deployment test room closed; test sessions logged out');
}
