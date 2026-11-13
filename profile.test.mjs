import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from './dist/app.js';
import {Store} from './dist/database.js';
import {AVATARS,avatarHTML,avatarURL} from './public/avatars.js';
async function fixture(run){
 const folder=await mkdtemp(join(tmpdir(),'joincraft-profile-test-'));const dbPath=join(folder,'test.sqlite');let app=await createApp({port:0,dbPath});
 const call=async(path,body,token)=>{const response=await fetch(app.url+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{'X-Session':token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json()};};
 const session=async name=>(await call('/api/session',{name})).data.id;
 try{await run({call,session,get app(){return app;},dbPath,restart:async()=>{await app.close();app=await createApp({port:0,dbPath});}});}finally{await app.close();await rm(folder,{recursive:true,force:true});}
}
test('legacy database migrates without changing identity; old profile updates preserve avatar and bio',()=>fixture(async({call,session,dbPath,restart})=>{
 const token=await session('原有玩家');const before=(await call('/api/state',undefined,token)).data.profile;
 assert(AVATARS.some(a=>a.id===before.avatarId));assert.equal(before.bio,'');assert.equal(typeof before.createdAt,'number');
 assert.equal((await call('/api/profile',{avatarId:'skeleton',bio:'建筑与红石\n周末在线'},token)).status,200);
 assert.equal((await call('/api/profile',{name:'换个昵称'},token)).status,200);
 await restart();const after=(await call('/api/state',undefined,token)).data.profile;
 assert.equal(after.id,before.id);assert.equal(after.createdAt,before.createdAt);assert.equal(after.name,'换个昵称');assert.equal(after.avatarId,'skeleton');assert.equal(after.bio,'建筑与红石\n周末在线');
 const db=new DatabaseSync(dbPath,{readOnly:true});assert.equal(db.prepare('PRAGMA user_version').get().user_version,7);db.close();
}));
test('additive migration preserves a real v4 database and its existing records',()=>{
 const store=new Store(':memory:');store.run('INSERT INTO users VALUES (?,?,?)','old-user','旧账号',1234);
 store.db.exec('DROP TABLE pack_uploads; DROP TABLE room_packs; DROP TABLE pack_files; DROP TABLE user_profiles; PRAGMA user_version=4;');
 // Migrate a disk copy through the actual Store constructor.
 return (async()=>{const folder=await mkdtemp(join(tmpdir(),'joincraft-v4-profile-')),file=join(folder,'old.sqlite');
 try{store.db.exec(`VACUUM INTO '${file}'`);store.close();const migrated=new Store(file);assert.equal(migrated.get('SELECT name FROM users WHERE id=?','old-user').name,'旧账号');assert.equal(migrated.get('PRAGMA user_version').user_version,7);migrated.close();}finally{await rm(folder,{recursive:true,force:true});}
 })();
});
test('profile validation is atomic and only permits local catalog avatars',()=>fixture(async({call,session})=>{
 const token=await session('原昵称');
 for(const patch of [{avatarId:'https://evil.example/avatar.svg'},{avatarId:'../secret'},{avatarId:null},{bio:'x'.repeat(241)},{bio:{}},{name:''}]){
  assert.equal((await call('/api/profile',{name:'不应保存',...patch},token)).status,400);
  assert.equal((await call('/api/state',undefined,token)).data.profile.name,'原昵称');
 }
 assert.equal((await call('/api/profile',{name:'新昵称',avatarId:'zombie',bio:'<script>plain text</script>'},token)).status,200);
 assert.equal((await call('/api/state',undefined,token)).data.profile.bio,'<script>plain text</script>');
 assert.equal((await call('/api/profile',{name:'攻击'},undefined)).status,401);
}));
test('profiles are visible to self, friend relationships and current room peers, without leaking other rooms or credentials',()=>fixture(async({call,session})=>{
 const host=await session('房主'),guest=await session('朋友'),other=await session('陌生人');
 const id=(await call('/api/state',undefined,host)).data.profile.id;
 assert.equal((await call('/api/profiles/'+id,undefined,other)).status,404);
 assert.equal((await call('/api/profiles/'+id,undefined)).status,401);
 const secret=(await call('/api/rooms',{name:'只属于房主'},host)).data;
 const shared=(await call('/api/rooms',{name:'共同世界'},host)).data;
 await call('/api/join',{code:shared.code},guest);const profile=(await call('/api/profiles/'+id,undefined,guest)).data;
 assert.deepEqual(profile.rooms.map(r=>r.id),[shared.id]);assert(!JSON.stringify(profile).includes(secret.id));
 assert.equal(profile.self,false);for(const key of ['password','password_hash','tokenHash','expiresAt','email','sessions'])assert.equal(key in profile,false);
 assert.equal((await call('/api/profiles/'+id,undefined,host)).data.rooms.length,2);
 await call('/api/rooms/'+shared.id+'/leave',{},guest);assert.equal((await call('/api/profiles/'+id,undefined,guest)).status,404);

}));
test('avatar changes propagate through friends, room members and message history',()=>fixture(async({app,call,session})=>{
 const register=async(username)=>{const response=await fetch(app.url+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'ProfileTest2026'})});assert.equal(response.status,201);return response.headers.get('set-cookie').split(';')[0].split('=').slice(1).join('=');};
 const a=await register('avatar_host'),b=await register('avatar_peer');const pa=(await call('/api/state',undefined,a)).data.profile,pb=(await call('/api/state',undefined,b)).data.profile;
 await call('/api/friends/request',{username:'avatar_peer'},a);assert.equal((await call('/api/profiles/'+pa.id,undefined,b)).status,200);
 await call('/api/friends/'+pa.id+'/accept',{},b);
 const room=(await call('/api/rooms',{name:'测试房间'},a)).data;await call('/api/join',{code:room.code},b);
 await call('/api/rooms/'+room.id+'/messages',{content:'头像测试',clientId:'profile-message-1'},a);
 await call('/api/profile',{avatarId:'fox',name:'狐狸玩家',bio:'一起造'},a);
 const state=(await call('/api/state',undefined,b)).data;
 assert.equal(state.social.friends.find(p=>p.id===pa.id).avatarId,'fox');assert.equal(state.rooms[0].members.find(p=>p.id===pa.id).avatarId,'fox');
 const message=(await call('/api/rooms/'+room.id+'/messages',undefined,b)).data.messages[0];assert.equal(message.avatarId,'fox');assert.equal(message.name,'狐狸玩家');
 assert.match(avatarHTML(message,{link:true}),new RegExp('#profile/'+pa.id));assert.doesNotMatch(avatarHTML(message,{link:true}),/#profile\/1"/);
 assert.equal((await call('/api/profiles/'+pa.id,undefined,b)).data.friendship,'accepted');
}));
test('all default portraits are served locally and markup cannot inject remote images or names',()=>fixture(async({app})=>{
 for(const avatar of AVATARS){const response=await fetch(app.url+avatarURL(avatar.id));assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/image\/svg\+xml/);assert.match(await response.text(),/viewBox="0 0 16 16"/);}
 assert.equal((await fetch(app.url+'/avatars/not-in-catalog-v1.svg')).status,404);
 assert.equal(avatarURL('https://tracking.example/pixel'),'/avatars/creeper-v1.svg');
 const markup=avatarHTML({id:'x" onclick="evil',name:'<img onerror=evil>',avatarId:'https://evil.example/a'},{link:true});assert(!markup.includes('src="https:'));assert(!markup.includes('name="<img'));assert(markup.includes('&lt;img'));
}));

test('guest profile survives registration and synchronizes across account logins',()=>fixture(async({app,call,session})=>{
 const guest=await session('旅行者');await call('/api/profile',{avatarId:'pig',bio:'周末一起造房子'},guest);
 const before=(await call('/api/state',undefined,guest)).data.profile;
 const issue=async(path,body,token)=>{const response=await fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{'X-Session':token}:{})},body:JSON.stringify(body)});assert.equal(response.status,path.endsWith('register')?201:200);return response.headers.get('set-cookie').split(';')[0].split('=').slice(1).join('=');};
 const account={username:'profile_upgrade',password:'UpgradeTest2026'};
 const first=await issue('/api/auth/register',account,guest),second=await issue('/api/auth/login',account);
 assert.equal((await call('/api/state',undefined,guest)).status,401);
 for(const token of [first,second]){const p=(await call('/api/state',undefined,token)).data.profile;assert.equal(p.id,before.id);assert.equal(p.createdAt,before.createdAt);assert.equal(p.name,'旅行者');assert.equal(p.username,account.username);assert.equal(p.avatarId,'pig');assert.equal(p.bio,'周末一起造房子');}
 await call('/api/profile',{avatarId:'wolf',name:'另一台设备'},second);
 const synced=(await call('/api/state',undefined,first)).data.profile;assert.equal(synced.avatarId,'wolf');assert.equal(synced.name,'另一台设备');assert.equal(synced.bio,before.bio);
}));
