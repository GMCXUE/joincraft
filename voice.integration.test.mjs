// Local SFU smoke test. Synthetic PCM only: never opens a microphone or game process.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {Room,RoomEvent,AudioSource,AudioFrame,AudioStream,LocalAudioTrack,TrackPublishOptions,TrackSource,dispose} from '@livekit/rtc-node';
import {createApp} from './dist/app.js';
import {RoomServiceClient} from 'livekit-server-sdk';
const timeout=async(p,ms=12000)=>{let t;try{return await Promise.race([p,new Promise((_,reject)=>{t=setTimeout(()=>reject(new Error('Timed out waiting for audio event')),ms);})]);}finally{clearTimeout(t);}};
const event=(room,name)=>new Promise(resolve=>room.once(name,(...args)=>resolve(args)));
test('real LiveKit transports synthetic audio, isolates groups, mutes and revokes participants',{timeout:60000},async()=>{
 const config={url:process.env.LIVEKIT_URL||'ws://127.0.0.1:7880',key:process.env.LIVEKIT_API_KEY||'devkey',secret:process.env.LIVEKIT_API_SECRET||'secret'};
 // Explicit loopback safeguard: this test must not connect to a production SFU.
 assert.ok(['localhost','127.0.0.1'].includes(new URL(config.url).hostname));
 const app=await createApp({port:0,dbPath:':memory:',voice:config});const clients=[];let source,track,reader;
 const call=async(path,body,token)=>{const r=await fetch(app.url+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{'X-Session':token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();assert.equal(r.ok,true,JSON.stringify(data));return data;};
 try{
 const tokens=await Promise.all(['声源','收听者','其他组'].map(async name=>(await call('/api/session',{name})).id));
 const [host,guest,other]=tokens;const room=await call('/api/rooms',{name:'Synthetic audio test'},host),base=`/api/rooms/${room.id}`,game=room.community.groups[0].id;
 await call('/api/join',{code:room.code},guest);await call('/api/join',{code:room.code},other);
 const group=await call(`${base}/groups`,{name:'独立组'},host);
 const leases=[];
 for(const [i,token]of tokens.entries()){
  const lease=await call(`${base}/groups/${i===2?group.id:game}/join`,{},token);leases.push(lease);
  const client=new Room();clients.push(client);await timeout(client.connect(lease.url,lease.token,{autoSubscribe:true,dynacast:false}));
 }
 const [sender,receiver,isolated]=clients;let isolatedTracks=0;isolated.on(RoomEvent.TrackSubscribed,()=>isolatedTracks++);
 const subscription=event(receiver,RoomEvent.TrackSubscribed);
 source=new AudioSource(48000,1);track=LocalAudioTrack.createAudioTrack('synthetic-test',source);
 const options=new TrackPublishOptions();options.source=TrackSource.SOURCE_MICROPHONE;
 await sender.localParticipant.publishTrack(track,options);
 const [remote]=await timeout(subscription);reader=new AudioStream(remote,{sampleRate:48000,numChannels:1}).getReader();
 const nonSilent=(async()=>{let frames=0,energy=0;while(frames<100){const item=await reader.read();if(item.done)break;for(const sample of item.value.data)energy+=sample*sample;frames++;if(energy>100000000)return {frames,energy};}throw new Error('No non-silent decoded PCM');})();
 for(let n=0;n<80;n++){const data=new Int16Array(480);for(let i=0;i<480;i++)data[i]=Math.round(Math.sin((n*480+i)*2*Math.PI*440/48000)*6000);await source.captureFrame(new AudioFrame(data,48000,1,480));}
 await source.waitForPlayout();const audio=await timeout(nonSilent);assert.ok(audio.energy>100000000);assert.equal(isolatedTracks,0);assert.equal(isolated.remoteParticipants.size,0);
 const hostId=(await call('/api/state',undefined,host)).profile.id,guestId=(await call('/api/state',undefined,guest)).profile.id;
 // The host can revoke a member's voice permission; their next lease stays muted.
 await call(`${base}/voice/${guestId}/mute`,{},host);
 const muted=await call(`/api/voice/${leases[1].identity}/heartbeat`,{},guest);assert.equal(muted.muted,true);
 const admin=new RoomServiceClient(config.url.replace(/^ws/,'http'),config.key,config.secret);
 assert.equal((await admin.getParticipant(`joincraft-${game}`,leases[1].identity)).permission.canPublish,false);
 // Reconnect with the old (publish-capable) JWT: gateway must replace grants using current rules.
 await receiver.disconnect();const mutedReconnect=new Room();clients.push(mutedReconnect);
 await timeout(mutedReconnect.connect(leases[1].url,leases[1].token,{autoSubscribe:true}));
 assert.equal((await admin.getParticipant(`joincraft-${game}`,leases[1].identity)).permission.canPublish,false);
 await call(`${base}/voice/${guestId}/allow`,{},host);
 const allowed=await admin.getParticipant(`joincraft-${game}`,leases[1].identity);
 assert.equal(allowed.permission.canPublish,true);assert.equal(allowed.tracks.length,0);
 const disconnected=event(mutedReconnect,RoomEvent.Disconnected);
 await call(`${base}/voice/${guestId}/remove`,{},host);await timeout(disconnected);
 const replay=new Room();clients.push(replay);await assert.rejects(()=>timeout(replay.connect(leases[1].url,leases[1].token),5000));
 await call(`${base}/close`,{},host);
 console.log(`Decoded synthetic PCM: ${audio.frames} frames; isolation, mute, removal and token replay checks passed. Host ${hostId.slice(0,8)}.`);
 }finally{await reader?.cancel().catch(()=>{});await Promise.all(clients.map(r=>r.disconnect().catch(()=>{})));await track?.close();await source?.close();await app.close();await dispose();}
});
