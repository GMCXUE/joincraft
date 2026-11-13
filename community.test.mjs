import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from './dist/app.js';
import {TokenVerifier,TrackSource} from 'livekit-server-sdk';
const config={url:'ws://127.0.0.1:7880',key:'testkey',secret:'only-for-unit-tests-secret-32chars'};
class Media {
 rooms=new Map();removed=[];
 async createRoom({name}){if(!this.rooms.has(name))this.rooms.set(name,[]);return {name};}
 async listRooms(){return [...this.rooms.keys()].map(name=>({name}));}
 async listParticipants(name){return this.rooms.get(name)||[];}
 async removeParticipant(name,id,options){this.removed.push({name,id,options});this.rooms.set(name,(this.rooms.get(name)||[]).filter(p=>p.identity!==id));}
 async updateParticipant(name,id,{permission}){const p=this.rooms.get(name)?.find(p=>p.identity===id);if(p)p.permission=permission;return p;}
}
async function fixture(run){
 let now=Date.now();const media=new Media();const app=await createApp({port:0,dbPath:':memory:',voice:config,voiceGateway:media,now:()=>now});
 const call=async(path,body,token)=>{const r=await fetch(app.url+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{'X-Session':token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json()};};
 try{
  const host=(await call('/api/session',{name:'房主'})).data.id,guest=(await call('/api/session',{name:'朋友'})).data.id,outsider=(await call('/api/session',{name:'路人'})).data.id;
  const room=(await call('/api/rooms',{name:'语音测试',capacity:8},host)).data;
  await call('/api/join',{code:room.code},guest);
  const guestId=(await call('/api/state',undefined,guest)).data.profile.id;
  const base=`/api/rooms/${room.id}`;
  await run({app,call,host,guest,guestId,outsider,room,base,media,tick:n=>now+=n});
 }finally{await app.close();}
}
test('default 游戏 and host-only independent groups with rename/delete invariants',()=>fixture(async({call,host,guest,outsider,room,base})=>{
 assert.deepEqual(room.community.groups.map(g=>g.name),['游戏']);const initial=room.community.groups[0];assert.equal(initial.isDefault,true);
 assert.equal((await call(`${base}/groups`,{name:'建筑队'},guest)).status,403);
 assert.equal((await call(`${base}/groups`,{name:'建筑队'},outsider)).status,404);
 const created=await call(`${base}/groups`,{name:'建筑队'},host);assert.equal(created.status,200);
 assert.equal((await call(`${base}/groups`,{name:'建筑队'},host)).status,409);
 assert.equal((await call(`${base}/groups/${initial.id}/delete`,{},host)).status,400);
 assert.equal((await call(`${base}/groups/${created.data.id}/rename`,{name:'探险队'},host)).status,200);
 assert.equal((await call(`${base}/groups/${created.data.id}/delete`,{},host)).status,200);
 assert.equal((await call(`${base}/groups/${created.data.id}/join`,{},guest)).status,404);
 assert.equal((await call('/api/state',undefined,guest)).data.rooms[0].community.groups.length,1);
}));
test('room messages are member-only, persistent, idempotent, paginated with bounded read cursors',()=>fixture(async({call,host,guest,outsider,base})=>{
 assert.equal((await call(`${base}/messages`,undefined,outsider)).status,404);
 const body={content:'今晚一起挖矿\n<script>plain text</script>',clientId:'message-0001'};
 const first=await call(`${base}/messages`,body,host);assert.equal(first.status,200);
 assert.deepEqual((await call(`${base}/messages`,body,host)).data,first.data);
 assert.equal((await call(`${base}/messages`,{...body,content:'different'},host)).status,409);
 let state=(await call('/api/state',undefined,guest)).data;assert.equal(state.rooms[0].community.unread,1);
 const history=(await call(`${base}/messages`,undefined,guest)).data;assert.equal(history.messages.length,1);assert.equal(history.messages[0].content,body.content);assert.equal(history.messages[0].name,'房主');
 assert.equal((await call(`${base}/read`,{lastId:999},guest)).status,400);
 assert.equal((await call(`${base}/read`,{lastId:first.data.id},guest)).status,200);
 assert.equal((await call('/api/state',undefined,guest)).data.rooms[0].community.unread,0);
 for(let i=2;i<=52;i++)assert.equal((await call(`${base}/messages`,{content:String(i),clientId:`message-${String(i).padStart(4,'0')}`},host)).status,200);
 const latest=(await call(`${base}/messages`,undefined,guest)).data;assert.equal(latest.messages.length,50);assert.equal(latest.hasMore,true);
 const older=(await call(`${base}/messages?before=${latest.messages[0].id}`,undefined,guest)).data;assert.equal(older.messages.length,2);
 assert.equal((await call(`${base}/leave`,{},guest)).status,200);
 assert.equal((await call(`${base}/messages`,undefined,guest)).status,404);
}));
test('voice tokens isolate groups, forbid video/data and replace old leases',()=>fixture(async({call,host,guest,outsider,room,base,media})=>{
 const group=room.community.groups[0].id;
 assert.equal((await call(`${base}/groups/${group}/join`,{},outsider)).status,404);
 const a=(await call(`${base}/groups/${group}/join`,{},guest)).data;
 const decoded=await new TokenVerifier(config.key,config.secret).verify(a.token);
 assert.equal(decoded.video.room,`joincraft-${group}`);assert.deepEqual(decoded.video.canPublishSources,['microphone']);assert.equal(decoded.video.canPublishData,false);assert.equal(decoded.sub,a.identity);assert.ok(decoded.exp-decoded.nbf<=31);
 const g=(await call(`${base}/groups`,{name:'建筑队'},host)).data;
 const b=(await call(`${base}/groups/${g.id}/join`,{},guest)).data;assert.notEqual(a.identity,b.identity);
 assert.equal((await call(`/api/voice/${a.identity}/heartbeat`,{},guest)).status,403);
 assert.equal((await call(`/api/voice/${b.identity}/heartbeat`,{},host)).status,403);
 assert.equal((await call(`/api/voice/${b.identity}/heartbeat`,{},guest)).status,200);
 assert.ok(media.removed.some(x=>x.id===a.identity&&x.options.revokeTokenTs>0n));
 assert.equal((await new TokenVerifier(config.key,config.secret).verify(b.token)).video.room,`joincraft-${g.id}`);
}));
test('moderation survives reconnect, release is opt-in, removal has cooldown and lease expires',()=>fixture(async({call,host,guest,guestId,room,base,tick})=>{
 const join=()=>call(`${base}/groups/${room.community.groups[0].id}/join`,{},guest);
 assert.equal((await call(`${base}/voice/${guestId}/mute`,{},guest)).status,403);
 assert.equal((await call(`${base}/voice/${guestId}/mute`,{},host)).status,200);
 const muted=(await join()).data;assert.equal((await new TokenVerifier(config.key,config.secret).verify(muted.token)).video.canPublish,false);
 assert.equal((await call(`${base}/voice/${guestId}/allow`,{},host)).status,200);
 assert.equal((await call(`/api/voice/${muted.identity}/heartbeat`,{},guest)).data.muted,false);
 assert.equal((await call(`${base}/voice/${guestId}/remove`,{},host)).status,200);
 assert.equal((await join()).status,403);
 assert.equal((await call(`/api/voice/${muted.identity}/heartbeat`,{},guest)).status,403);
 tick(61000);const after=(await join()).data;tick(46000);assert.equal((await call(`/api/voice/${after.identity}/heartbeat`,{},guest)).status,403);
}));
test('leaving, deleting groups and closing rooms revoke live media participants',()=>fixture(async({call,host,guest,room,base,media})=>{
 const g=(await call(`${base}/groups`,{name:'建筑队'},host)).data;
 const a=(await call(`${base}/groups/${g.id}/join`,{},guest)).data;
 media.rooms.set(`joincraft-${g.id}`,[{identity:a.identity,tracks:[{source:TrackSource.MICROPHONE,muted:false}],permission:{canPublish:true}}]);
 await call(`${base}/groups/${g.id}/delete`,{},host);assert.equal(media.rooms.get(`joincraft-${g.id}`).length,0);
 assert.equal((await call(`/api/voice/${a.identity}/heartbeat`,{},guest)).status,403);
 const b=(await call(`${base}/groups/${room.community.groups[0].id}/join`,{},guest)).data;
 await call(`${base}/leave`,{},guest);assert.equal((await call(`/api/voice/${b.identity}/heartbeat`,{},guest)).status,403);
 const c=(await call(`${base}/groups/${room.community.groups[0].id}/join`,{},host)).data;
 await call(`${base}/close`,{},host);assert.equal((await call(`/api/voice/${c.identity}/heartbeat`,{},host)).status,403);
}));
test('voice unavailable returns actionable service error without pretending connected',async()=>{
 const app=await createApp({port:0,dbPath:':memory:'});try{
 const req=async(path,body,token)=>{const r=await fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{'X-Session':token}:{})},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 const token=(await req('/api/session',{name:'test'})).data.id;const room=(await req('/api/rooms',{name:'test'},token)).data;const result=await req(`/api/rooms/${room.id}/groups/${room.community.groups[0].id}/join`,{},token);assert.equal(result.status,503);assert.match(result.data.error,/尚未配置/);
 }finally{await app.close();}
});

test('logout revokes voice leases and validates both signalling paths without cookies',()=>fixture(async({call,guest,room,base,app})=>{
 const lease=(await call(`${base}/groups/${room.community.groups[0].id}/join`,{},guest)).data;
 for(const path of ['/voice/rtc/validate','/voice/rtc/v1/validate']){
  assert.equal((await fetch(app.url+path+'?access_token='+encodeURIComponent(lease.token))).status,200);
  assert.equal((await fetch(app.url+path+'?access_token=invalid')).status,401);
 }
 await call('/api/auth/logout',{},guest);
 assert.equal((await fetch(app.url+'/voice/rtc/validate?access_token='+encodeURIComponent(lease.token))).status,403);
}));
