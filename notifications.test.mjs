import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import yazl from 'yazl';
import {createApp} from './dist/app.js';import {Store} from './dist/database.js';import {Notifications} from './dist/notifications.js';
async function fixture(run){
 const dir=await mkdtemp(path.join(tmpdir(),'joincraft-inbox-'));const dbPath=path.join(dir,'test.sqlite');let now=Date.now(),app=await createApp({port:0,dbPath,now:()=>now});
 const call=async(url,body,token)=>{const response=await fetch(app.url+url,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{'X-Session':token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')};};
 const register=async username=>{const result=await call('/api/auth/register',{username,name:username,password:'LocalInboxTest_2026'});assert.equal(result.status,201);const token=result.cookie.split(';')[0].split('=')[1];return {token,...(await call('/api/state',undefined,token)).data.profile};};
 const inbox=async user=>(await call('/api/notifications',undefined,user.token)).data;
 try{const a=await register('inbox_alice'),b=await register('inbox_bob'),c=await register('inbox_other');await run({a,b,c,call,inbox,tick:()=>now++,restart:async()=>{await app.close();app=await createApp({port:0,dbPath,now:()=>now});}});}finally{await app.close();await rm(dir,{recursive:true,force:true});}
}
const friends=async({a,b,call})=>{assert.equal((await call('/api/friends/request',{username:b.username},a.token)).status,200);assert.equal((await call(`/api/friends/${a.id}/accept`,{},b.token)).status,200);};
test('friend requests, cancellation and acceptance persist with user-scoped read receipts',()=>fixture(async({a,b,c,call,inbox,restart})=>{
 await call('/api/friends/request',{username:b.username},a.token);let value=await inbox(b);assert.equal(value.unread,1);assert.equal(value.items[0].pending,true);assert.equal((await inbox(c)).unread,0);
 assert.equal((await call('/api/friends/request',{username:b.username},a.token)).status,409);assert.equal((await inbox(b)).items.length,1);
 await restart();assert.equal((await inbox(b)).unread,1);await call(`/api/friends/${b.id}/cancel`,{},a.token);value=await inbox(b);assert.equal(value.unread,0);assert.equal(value.items[0].pending,false);
 await call('/api/friends/request',{username:b.username},a.token);await call(`/api/friends/${a.id}/accept`,{},b.token);
 assert.equal((await inbox(b)).unread,0);value=await inbox(a);assert.equal(value.items[0].kind,'friend.accepted');assert.equal(value.unread,1);
}));
test('private message notifications aggregate and share chat cursors; snapshot read leaves later messages unread',()=>fixture(async(f)=>{
 const {a,b,call,inbox}=f;await friends(f);const send=content=>call(`/api/chats/${b.id}/messages`,{content,clientId:randomUUID()},a.token);
 const first=await send('第一条'),snapshot=await inbox(b);assert.equal(snapshot.items.filter(item=>item.kind==='chat.message').length,1);assert.equal(snapshot.chatReads[0].uptoId,first.data.id);
 await send('第二条');assert.equal((await inbox(b)).friend,2);
 assert.equal((await call('/api/notifications/read',{throughId:snapshot.throughId,chats:snapshot.chatReads},b.token)).status,200);
 let value=await inbox(b);assert.equal(value.unread,1);assert.equal((await call('/api/state',undefined,b.token)).data.social.unread,1);
 await call(`/api/chats/${a.id}/read`,{uptoId:value.chatReads[0].uptoId},b.token);assert.equal((await inbox(b)).unread,0);
}));
test('inbox rejects unauthorized, foreign and malformed receipts atomically',()=>fixture(async f=>{
 const {a,b,c,call,inbox}=f;await call('/api/friends/request',{username:b.username},a.token);const own=(await inbox(b)).items[0].id.split(':')[1];
 assert.equal((await call('/api/notifications')).status,401);assert.equal((await call('/api/notifications/read',{ids:[Number(own)]},c.token)).status,404);assert.equal((await inbox(b)).unread,1);
 for(const body of [{ids:['1']},{ids:[0]},{ids:[Number(own),Number(own)]},{throughId:-1},{chats:[{peerId:a.id,uptoId:1}]}])assert.equal((await call('/api/notifications/read',body,b.token)).status>=400,true);
 await friends({...f,a:c});const other=(await inbox(b)).items.find(item=>item.kind==='friend.request'&&item.peerId===c.id);assert(other);
 assert.equal((await call('/api/notifications/read',{ids:[Number(own)],chats:[{peerId:'foreign',uptoId:9999}]},b.token)).status,404);assert.equal((await inbox(b)).items.find(item=>item.id==='notice:'+own).unread,1);
}));
test('system notices only reach affected room members and survive closing the room',()=>fixture(async({a,b,c,call,inbox})=>{
 const room=(await call('/api/rooms',{name:'系统通知测试'},a.token)).data;await call('/api/join',{code:room.code},b.token);
 assert.equal((await call(`/api/rooms/${room.id}/game`,{version:'1.20.1',loader:'Forge',port:25565},c.token)).status,404);assert.equal((await inbox(b)).unread,0);
 await call(`/api/rooms/${room.id}/game`,{version:'1.20.1',loader:'Forge',port:25565},a.token);let value=await inbox(b);assert.equal(value.system,1);assert.equal(value.items[0].kind,'room.game');assert.equal((await inbox(a)).system,0);assert.equal((await inbox(c)).system,0);
 await call(`/api/rooms/${room.id}/close`,{},a.token);value=await inbox(b);assert.equal(value.system,2);assert(value.items.some(item=>item.kind==='room.closed'));
 assert(!/tokenHash|password_hash|archive|file_hash/.test(JSON.stringify(value)));
 await call('/api/notifications/read',{throughId:value.throughId},b.token);assert.equal((await inbox(b)).system,0);
}));
test('pack publication creates one real version notice, including no notice on a stale publish',()=>fixture(async({a,b,call,inbox})=>{
 const room=(await call('/api/rooms',{name:'版本通知'},a.token)).data;await call('/api/join',{code:room.code},b.token);
 const zip=new yazl.ZipFile();zip.addBuffer(Buffer.from(JSON.stringify({formatVersion:1,game:'minecraft',name:'测试包',versionId:'1.0',dependencies:{minecraft:'1.20.1','fabric-loader':'0.16.14'},files:[]})),'modrinth.index.json');zip.end();const chunks=[];for await(const chunk of zip.outputStream)chunks.push(chunk);
 const body={archive:Buffer.concat(chunks).toString('base64'),expected:null};assert.equal((await call(`/api/rooms/${room.id}/pack`,body,a.token)).status,200);
 let value=await inbox(b);assert.equal(value.items[0].kind,'room.pack');assert.equal(value.system,1);assert.match(value.items[0].body,/测试包/);
 assert.equal((await call(`/api/rooms/${room.id}/pack`,body,a.token)).status,409);assert.equal((await inbox(b)).system,1);
}));
test('v7 migration preserves identities and notifications retain a bounded history',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'joincraft-inbox-migrate-')),file=path.join(dir,'old.sqlite');let store=new Store(file);
 try{store.run('INSERT INTO users VALUES (?,?,?)','existing','原有用户',123);store.run('INSERT INTO users VALUES (?,?,?)','peer','好友',123);for(const id of ['existing','peer'])store.run('INSERT INTO accounts VALUES (?,?,?,?)',id,id,'fixture-hash-never-authenticated',123);store.run('INSERT INTO friendships VALUES (?,?,?,?,?)','existing','peer','peer','pending',123);store.db.exec('DROP TABLE user_notifications;PRAGMA user_version=7;');store.close();store=new Store(file);assert.equal(store.get('PRAGMA user_version').user_version,8);assert.equal(store.get('SELECT name FROM users WHERE id=?','existing').name,'原有用户');assert.equal(store.get('SELECT count(*) AS n FROM user_notifications WHERE user_id=?','existing').n,1);
 const notices=new Notifications(store,()=>123);store.transaction(()=>{for(let i=0;i<220;i++)notices.add('existing','room.game','测试通知',String(i));});assert.equal(store.get('SELECT count(*) AS n FROM user_notifications').n,200);
 const value=notices.snapshot({id:'existing'},{conversations:[],requests:[]});assert.equal(value.items.length,100);assert.equal(value.hasMore,true);assert.equal(value.unread,200);
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
