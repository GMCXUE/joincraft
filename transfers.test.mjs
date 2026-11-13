import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir,stat,open} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomBytes} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {createWriteStream} from 'node:fs';
import yazl from 'yazl';
import {createApp} from './server.mjs';
import {Store} from './dist/database.js';
import {RoomService} from './dist/service.js';
import {PackTransfer} from './desktop/pack-transfer.mjs';
import {ManagedPacks} from './launcher/pack-installer.mjs';
import {inspectMrpack,packSummary,MAX_PACK_BYTES,UPLOAD_CHUNK_BYTES} from './shared/pack-format.mjs';
const sha=(data,algo='sha512')=>createHash(algo).update(data).digest('hex');
async function temporary(t){const dir=await mkdtemp(path.join(os.tmpdir(),'joincraft-transfer-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
async function fixtureFile(dir,{size=1024*1024,version='1',name='大包测试'}={}){
  const file=path.join(dir,'pack-'+version+'.mrpack'),zip=new yazl.ZipFile(),index={formatVersion:1,game:'minecraft',name,versionId:version,dependencies:{minecraft:'1.20.1'},files:[]};
  zip.addBuffer(Buffer.from(JSON.stringify(index)),'modrinth.index.json');zip.addBuffer(randomBytes(size),'overrides/config/data.bin',{compress:false});zip.end();await pipeline(zip.outputStream,createWriteStream(file));const pack=packSummary(await inspectMrpack(file));return {file,pack};
}
async function server(t,{dbPath,packDir}={}){
  const app=await createApp({port:0,dbPath:dbPath||':memory:',packDir});t.after(()=>app.close());
  const request=async(url,{body,method,token,headers={}}={})=>{const response=await fetch(app.url+url,{signal:AbortSignal.timeout(10000),method:method||(body===undefined?'GET':'POST'),headers:{...(token?{'X-Session':token}:{}),...(Buffer.isBuffer(body)?{'Content-Type':'application/octet-stream'}:body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:Buffer.isBuffer(body)?body:JSON.stringify(body)})});return response;};
  const json=async(url,body,token)=>{const response=await request(url,{body,token});return {status:response.status,value:await response.json()};};
  const host=(await json('/api/session',{name:'房主'})).value.id,member=(await json('/api/session',{name:'成员'})).value.id,other=(await json('/api/session',{name:'其他人'})).value.id;
  const room=(await json('/api/rooms',{name:'600 MB 联机房间'},host)).value;await json('/api/join',{code:room.code},member);
  return {app,request,json,host,member,other,room,route:'/api/rooms/'+room.id+'/pack'};
}
async function upload(s,f){
  const started=await s.json(s.route+'/uploads',{sha512:f.pack.sha512,size:f.pack.archiveSize,expected:null},s.host);assert.equal(started.status,200);const id=started.value.uploadId,handle=await open(f.file,'r');let offset=started.value.offset;
  try{while(offset<f.pack.archiveSize){const length=Math.min(UPLOAD_CHUNK_BYTES,f.pack.archiveSize-offset),chunk=Buffer.alloc(length);await handle.read(chunk,0,length,offset);const result=await s.request(s.route+'/uploads/'+id+'/chunk?offset='+offset,{method:'PUT',body:chunk,token:s.host,headers:{'X-Chunk-Sha256':sha(chunk,'sha256')}});assert.equal(result.status,200,await result.clone().text());offset=(await result.json()).offset;}}
  finally{await handle.close();}
  assert.equal((await s.json(s.route+'/uploads/'+id+'/commit',{},s.host)).status,200);
  for(let i=0;i<300;i++){const state=(await s.json(s.route+'/uploads/'+id,undefined,s.host)).value;if(state.state==='ready')return {id,state};if(state.state==='failed')throw Error(state.error);await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Commit did not settle');
}
test('600 MB limit is inclusive without allocating the declared archive in memory',async t=>{
  const s=await server(t),hash='1'.repeat(128);
  assert.equal((await s.json(s.route+'/uploads',{sha512:hash,size:MAX_PACK_BYTES+1},s.host)).status,400);
  const exact=await s.json(s.route+'/uploads',{sha512:hash,size:MAX_PACK_BYTES},s.host);assert.equal(exact.status,200);assert.equal(exact.value.offset,0);assert.equal(exact.value.chunkSize,4*1024*1024);
  assert.equal((await s.json(s.route+'/uploads/'+exact.value.uploadId+'/cancel',{},s.host)).status,200);
});
test('chunked upload stores an archive above 16 MB on disk and streams it only to room members',async t=>{
  const dir=await temporary(t),f=await fixtureFile(dir,{size:17*1024*1024}),s=await server(t,{dbPath:path.join(dir,'app.sqlite')});
  await upload(s,f);const state=(await s.json('/api/state',undefined,s.member)).value;assert.equal(state.rooms[0].pack.sha512,f.pack.sha512);
  const db=new Store(path.join(dir,'app.sqlite'));const record=db.get('SELECT length(archive) AS size,file_hash FROM room_packs');assert.equal(record.size,0);assert.equal(record.file_hash,f.pack.sha512);db.close();
  const stored=path.join(dir,'packs','files',f.pack.sha512+'.mrpack');assert.equal((await stat(stored)).size,f.pack.archiveSize);
  assert.equal((await s.request(s.route+'/archive',{token:s.other})).status,404);assert.equal((await s.request(s.route+'/archive')).status,401);
  assert.equal((await s.json(s.route,undefined,s.member)).status,426,'old clients are told to update instead of materializing base64');
  const range=await s.request(s.route+'/archive?sha512='+f.pack.sha512,{token:s.member,headers:{Range:'bytes=5-99'}});assert.equal(range.status,206);assert.equal(range.headers.get('content-range'),'bytes 5-99/'+f.pack.archiveSize);assert.deepEqual(Buffer.from(await range.arrayBuffer()),(await readFile(f.file)).subarray(5,100));
  assert.equal((await s.request(s.route+'/archive',{token:s.member,headers:{Range:'bytes='+f.pack.archiveSize+'-'}})).status,416);
});
test('chunk offsets and per-chunk hashes are checked before appending',async t=>{
  const dir=await temporary(t),f=await fixtureFile(dir,{size:5*1024*1024}),s=await server(t),started=(await s.json(s.route+'/uploads',{sha512:f.pack.sha512,size:f.pack.archiveSize},s.host)).value;
  const route=s.route+'/uploads/'+started.uploadId,chunk=(await readFile(f.file)).subarray(0,UPLOAD_CHUNK_BYTES);
  assert.equal((await s.request(route+'/chunk?offset=0',{method:'PUT',body:chunk,token:s.member,headers:{'X-Chunk-Sha256':sha(chunk,'sha256')}})).status,403);
  assert.equal((await s.request(route+'/chunk?offset=0',{method:'PUT',body:chunk,token:s.host,headers:{'X-Chunk-Sha256':'0'.repeat(64)}})).status,400);
  assert.equal((await s.json(route,undefined,s.host)).value.offset,0);
  assert.equal((await s.request(route+'/chunk?offset=0',{method:'PUT',body:chunk,token:s.host,headers:{'X-Chunk-Sha256':sha(chunk,'sha256')}})).status,200);
  assert.equal((await s.request(route+'/chunk?offset=0',{method:'PUT',body:chunk,token:s.host,headers:{'X-Chunk-Sha256':sha(chunk,'sha256')}})).status,409);
  const resume=(await s.json(s.route+'/uploads',{sha512:f.pack.sha512,size:f.pack.archiveSize},s.host)).value;assert.equal(resume.uploadId,started.uploadId);assert.equal(resume.offset,UPLOAD_CHUNK_BYTES);
});
test('native transfer resumes a lost chunk acknowledgement and a broken download',async t=>{
  const dir=await temporary(t),f=await fixtureFile(dir,{size:5*1024*1024}),s=await server(t);let loseAck=true,breakDownload=true,sawRange=false;
  const realFetch=fetch,events=[];
  const host=new PackTransfer({serverURL:s.app.url,getDirectory:()=>dir+'/host',getHeaders:async()=>({'X-Session':s.host}),notify:e=>events.push(e),fetchImpl:async(url,options)=>{const response=await realFetch(url,options);if(options.method==='PUT'&&loseAck&&response.ok){loseAck=false;await response.body.cancel();throw TypeError('simulated lost chunk ACK');}return response;}});
  const chosen=await host.inspect(f.file);assert.equal('archive' in chosen,false);assert.equal(typeof host.drafts.get(chosen.draftId).file,'string');
  const published=await host.publish({roomId:s.room.id,draftId:chosen.draftId});assert.equal(published.sha512,f.pack.sha512);assert.ok(events.some(event=>event.operation==='upload'&&event.fileCompleted>0));
  const member=new PackTransfer({serverURL:s.app.url,getDirectory:()=>dir+'/member',getHeaders:async()=>({'X-Session':s.member}),fetchImpl:async(url,options)=>{if(url.includes('/archive')){if(options.headers.Range)sawRange=true;const response=await realFetch(url,options);if(breakDownload){breakDownload=false;const reader=response.body.getReader();let sent=false;return new Response(new ReadableStream({async pull(controller){if(sent){await reader.cancel();controller.error(TypeError('simulated interrupted response'));return;}const value=await reader.read();controller.enqueue(value.value);sent=true;}}),{status:response.status,headers:response.headers});}return response;}return realFetch(url,options);}});
  const result=await member.download({roomId:s.room.id,sha512:f.pack.sha512});assert.equal(sawRange,true);assert.equal(sha(await readFile(result.file)),f.pack.sha512);
});
test('stale room versions cannot be overwritten by a completed upload',async t=>{
  const dir=await temporary(t),f=await fixtureFile(dir),second=await fixtureFile(dir,{version:'2',size:128}),s=await server(t);
  const value=(await s.json(s.route+'/uploads',{sha512:f.pack.sha512,size:f.pack.archiveSize},s.host)).value,chunk=await readFile(f.file),route=s.route+'/uploads/'+value.uploadId;
  assert.equal((await s.request(route+'/chunk?offset=0',{method:'PUT',body:chunk,token:s.host,headers:{'X-Chunk-Sha256':sha(chunk,'sha256')}})).status,200);
  assert.equal((await s.json(s.route,{archive:(await readFile(second.file)).toString('base64')},s.host)).status,200);
  await s.json(route+'/commit',{},s.host);for(let i=0;i<100;i++){const current=(await s.json(route,undefined,s.host)).value;if(current.state==='failed')break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal((await s.json('/api/state',undefined,s.host)).value.rooms[0].pack.sha512,second.pack.sha512);
});
test('existing schema 6 SQLite archives migrate without changing room metadata or access',async t=>{
  const dir=await temporary(t),file=path.join(dir,'old.sqlite'),f=await fixtureFile(dir,{size:1024}),store=new Store(file),service=new RoomService(store),session=service.createSession({name:'旧房主'},'127.0.0.1'),actor=service.authenticate(session.id),room=await service.createRoom(actor,{name:'旧房间'});
  store.run('INSERT INTO room_packs(room_id,summary,archive,updated_at) VALUES (?,?,?,?)',room.id,JSON.stringify(f.pack),await readFile(f.file),1);
  store.db.exec("ALTER TABLE room_packs RENAME TO room_packs_new;CREATE TABLE room_packs(room_id TEXT PRIMARY KEY REFERENCES rooms(id),summary TEXT NOT NULL,archive BLOB NOT NULL CHECK(length(archive)<=16777216),updated_at INTEGER NOT NULL) STRICT;INSERT INTO room_packs SELECT room_id,summary,archive,updated_at FROM room_packs_new;DROP TABLE room_packs_new;DROP TABLE pack_uploads;DROP TABLE pack_files;PRAGMA user_version=6;");store.close();
  const app=await createApp({port:0,dbPath:file});t.after(()=>app.close());const response=await fetch(app.url+'/api/state',{headers:{'X-Session':session.id}}),state=await response.json();assert.equal(state.rooms[0].pack.sha512,f.pack.sha512);assert.equal(state.rooms[0].name,'旧房间');
  assert.equal(sha(await readFile(path.join(dir,'packs','files',f.pack.sha512+'.mrpack'))),f.pack.sha512);
  const migrated=new Store(file);assert.equal(migrated.get('SELECT length(archive) AS n FROM room_packs').n,0);assert.equal(migrated.get('PRAGMA user_version').user_version,7);migrated.close();
});

test('database backups include file-backed packs and can restore a room without the original storage',async t=>{
 const dir=await temporary(t),s=await server(t,{dbPath:dir+'/source/app.sqlite'}),f=await fixtureFile(dir,{size:1024});await upload(s,f);
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');const target=dir+'/backup.sqlite';
 await promisify(execFile)(process.execPath,['scripts/backup.mjs',target],{cwd:new URL('.',import.meta.url),env:{...process.env,DATABASE_PATH:dir+'/source/app.sqlite'}});
 assert.equal(sha(await readFile(target+'.packs/files/'+f.pack.sha512+'.mrpack')),f.pack.sha512);
 const restored=await createApp({port:0,dbPath:target,packDir:target+'.packs'});t.after(()=>restored.close());
 const response=await fetch(restored.url+s.route+'/archive',{headers:{'X-Session':s.member}});assert.equal(response.status,200);assert.equal(sha(Buffer.from(await response.arrayBuffer())),f.pack.sha512);
});

test('retrying a failed upload still enforces one active upload per host',async t=>{
 const dir=await temporary(t),dbPath=dir+'/app.sqlite',s=await server(t,{dbPath}),f=await fixtureFile(dir,{size:128});
 const first=(await s.json(s.route+'/uploads',{sha512:f.pack.sha512,size:f.pack.archiveSize},s.host)).value;
 const store=new Store(dbPath);store.run("UPDATE pack_uploads SET state='failed' WHERE id=?",first.uploadId);store.close();
 const active=await s.json(s.route+'/uploads',{sha512:'9'.repeat(128),size:1024},s.host);assert.equal(active.status,200);
 assert.equal((await s.json(s.route+'/uploads',{sha512:f.pack.sha512,size:f.pack.archiveSize},s.host)).status,409);
});

test('host installs its retained upload without downloading the archive again, including after restart',async t=>{
  const dir=await temporary(t),f=await fixtureFile(dir,{size:1024}),s=await server(t);let archives=0;
  const options={serverURL:s.app.url,getDirectory:()=>dir+'/host',getHeaders:async()=>({'X-Session':s.host}),fetchImpl:async(url,init)=>{if(new URL(url).pathname.endsWith('/archive'))archives++;return fetch(url,init);}};
  const host=new PackTransfer(options),chosen=await host.inspect(f.file);
  await host.publish({roomId:s.room.id,draftId:chosen.draftId});
  await rm(f.file);
  const reopened=new PackTransfer(options),local=await reopened.download({roomId:s.room.id,sha512:f.pack.sha512});
  assert.equal(sha(await readFile(local.file)),f.pack.sha512);assert.equal(archives,0);
  assert.equal(local.pack.sha512,f.pack.sha512);
  // A damaged retained copy is never accepted merely because its name and size match.
  const bytes=await readFile(local.file);bytes[bytes.length-1]^=1;await writeFile(local.file,bytes);
  await reopened.download({roomId:s.room.id,sha512:f.pack.sha512});assert.equal(archives,1);
  // Local caches do not bypass current room membership or pinned-version checks.
  assert.equal((await s.json('/api/rooms/'+s.room.id+'/close',{},s.host)).status,200);
  await assert.rejects(reopened.download({roomId:s.room.id,sha512:f.pack.sha512}));
});

test('host rejects a changed source before publishing and removes an incomplete retained copy',async t=>{
  const dir=await temporary(t),f=await fixtureFile(dir,{size:1024}),s=await server(t);
  const host=new PackTransfer({serverURL:s.app.url,getDirectory:()=>dir+'/host',getHeaders:async()=>({'X-Session':s.host})}),chosen=await host.inspect(f.file);
  const draft=host.drafts.get(chosen.draftId),bytes=await readFile(f.file);bytes[bytes.length-1]^=1;await writeFile(f.file,bytes);
  draft.mtime=(await stat(f.file)).mtimeMs;
  await assert.rejects(host.publish({roomId:s.room.id,draftId:chosen.draftId}),/已变化/);
  assert.deepEqual(await readdir(dir+'/host/downloads'),[]);
  assert.equal((await s.json('/api/state',undefined,s.host)).value.rooms[0].pack,null);
});
