import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import yazl from 'yazl';
import {WebSocket} from 'ws';
import {inspectMrpack,inspectIndex,packPath,packURL,MAX_PACK_BYTES} from './shared/pack-format.mjs';
import {ManagedPacks} from './launcher/pack-installer.mjs';
import {registerInstance} from './launcher/instance-registration.mjs';
import {GameLauncher} from './launcher/launch.mjs';
import {InstallProgress} from './launcher/install-progress.mjs';
import {downloadFile,fetchChecked} from './launcher/pack-download.mjs';
import {Store} from './dist/database.js';
import {createApp} from './server.mjs';
const hash=(value,algorithm='sha512')=>createHash(algorithm).update(value).digest('hex');
export async function zip(entries){const out=new yazl.ZipFile();for(const [name,data] of entries)out.addBuffer(Buffer.from(data),name);out.end();const chunks=[];for await(const chunk of out.outputStream)chunks.push(chunk);return Buffer.concat(chunks);}
export async function sample({name='周末生存',versionId='1.0.0',files=true,overrides=true,indexPatch={}}={}){
  const mod=Buffer.from('synthetic mod, never executed'),server=Buffer.from('server only');
  const entry=(p,data,client='required')=>({path:p,fileSize:data.length,hashes:{sha512:hash(data),sha1:hash(data,'sha1')},downloads:['https://cdn.modrinth.com/data/test/'+path.basename(p)],env:{client,server:'required'}});
  const index={formatVersion:1,game:'minecraft',name,versionId,dependencies:{minecraft:'1.20.1','fabric-loader':'0.16.14'},files:files?[entry('mods/test.jar',mod),entry('mods/server.jar',server,'unsupported')]:[],...indexPatch};
  const archive=await zip([['modrinth.index.json',JSON.stringify(index)],...(overrides?[['overrides/config/test.cfg','setting=true'],['overrides/options.txt','personal defaults'],['overrides/config/client.cfg','default'],['client-overrides/config/client.cfg','client preferred']]:[])]);
  return {index,archive,mod,sha512:hash(archive)};
}
async function temporary(t){const temp=await mkdtemp(path.join(os.tmpdir(),'joincraft-packs-'));t.after(()=>rm(temp,{recursive:true,force:true}));return temp;}
async function put(file,value){await mkdir(path.dirname(file),{recursive:true});await writeFile(file,typeof value==='object'&&!Buffer.isBuffer(value)?JSON.stringify(value):value);}
const platform={name:'windows',arch:'x64',version:'10.0.22631'};
const java={path:'C:\\Java Test\\bin\\java.exe',major:17,arch:'x64'};
export async function fakeEnvironment(pack,root,context){
  const jar=Buffer.from('synthetic game jar, never executed'),index=JSON.stringify({objects:{}}),id=pack.minecraft;
  const metadata={id,mainClass:'net.minecraft.client.main.Main',type:'release',assets:id,assetIndex:{id,sha1:hash(index,'sha1')},downloads:{client:{sha1:hash(jar,'sha1')}},javaVersion:{majorVersion:17},libraries:[],arguments:{jvm:['-Djava.library.path=${natives_directory}','-cp','${classpath}'],game:['--username','${auth_player_name}','--uuid','${auth_uuid}','--accessToken','${auth_access_token}','--gameDir','${game_directory}']}};
  await put(path.join(root,'versions',id,id+'.json'),metadata);await put(path.join(root,'versions',id,id+'.jar'),jar);await put(path.join(root,'assets','indexes',id+'.json'),index);
  context.progress.phase('game','下载游戏资源与依赖',3);return {version:id,java};
}
function manager(root,extra={}){let calls=0;const result=new ManagedPacks({root,platform,engine:fakeEnvironment,fetchImpl:async()=>{calls++;return new Response('synthetic mod, never executed');},...extra});return {manager:result,calls:()=>calls};}

test('mrpack parsing pins exact versions, filters server files and resolves client overrides',async()=>{
  const f=await sample(),pack=await inspectMrpack(f.archive,{overrides:true});assert.equal(pack.name,'周末生存');assert.equal(pack.loader,'Fabric');assert.equal(pack.loaderVersion,'0.16.14');assert.equal(pack.sha512,f.sha512);assert.equal(pack.files.length,1);assert.equal(pack.totalBytes,f.mod.length+pack.overrides.reduce((sum,file)=>sum+file.size,0));assert.equal(pack.overrides.find(e=>e.path==='config/client.cfg').data.toString(),'client preferred');
});
test('pack archives reject missing manifest, hashes, unsupported loaders and protected paths',async t=>{
  await assert.rejects(inspectMrpack(await zip([['manifest.json','{}']])),/无法识别整合包/);
  for(const value of ['../outside','mods/../outside','C:/outside','mods/a:stream','/absolute','mods/CON.jar','mods/name.','versions/attack.json','.joincraft/instance.json'])assert.throws(()=>packPath(value),/路径|运行环境/);
  for(const patch of [{dependencies:{minecraft:'1.20.1',unknown:'1'}},{formatVersion:2},{files:[{path:'mods/a.jar',hashes:{},fileSize:1,downloads:['https://cdn.modrinth.com/a']}]}])await assert.rejects(inspectMrpack((await sample({indexPatch:patch})).archive));
  const file=path.join(await temporary(t),'oversize.mrpack');await writeFile(file,Buffer.alloc(0));const {truncate}=await import('node:fs/promises');await truncate(file,MAX_PACK_BYTES+1);await assert.rejects(inspectMrpack(file),/600 MB/);
});
test('pack download allowlist rejects private targets, credentials and redirect escapes',async()=>{
  for(const url of ['http://cdn.modrinth.com/a','https://localhost/a','https://127.0.0.1/a','https://user:pass@cdn.modrinth.com/a','https://cdn.modrinth.com:123/a'])assert.throws(()=>packURL(url));
  let calls=0;await assert.rejects(fetchChecked('https://cdn.modrinth.com/a',{checkURL:packURL,fetchImpl:async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}});}}),/来源暂不支持/);assert.equal(calls,1);
});
test('install is durable, isolated, deduplicates re-install and leaves personal saves available',async t=>{
  const temp=await temporary(t),f=await sample(),{manager:m,calls}=manager(path.join(temp,'Joincraft 游戏'));const pcl=path.join(temp,'PCL','saves','world.dat');await put(pcl,'old save');
  const instance=await m.install(f.archive,f.sha512);assert.equal(instance.managed,true);assert.equal(await readFile(path.join(instance.root,'mods/test.jar'),'utf8'),f.mod.toString());assert.equal(await readFile(path.join(instance.root,'config/client.cfg'),'utf8'),'client preferred');assert.equal(await stat(path.join(instance.root,'mods/server.jar')).then(()=>true,()=>false),false);
  await put(path.join(instance.root,'saves','我的世界','level.dat'),'personal world');assert.equal((await m.matching(f.sha512)).status,'ready');
  const reopened=new ManagedPacks({root:m.root,platform,engine:fakeEnvironment});assert.equal((await reopened.list())[0].id,instance.id);assert.equal((await reopened.matching(f.sha512)).status,'ready');assert.equal((await m.install(f.archive)).id,instance.id);assert.equal(calls(),1);assert.equal(await readFile(pcl,'utf8'),'old save');
});
test('room compatibility detects changed and extra mods, then installs a separate copy preserving saves',async t=>{
  const temp=await temporary(t),f=await sample(),{manager:m,calls}=manager(temp),old=await m.install(f.archive);
  await put(path.join(old.root,'saves/world/level.dat'),'keep');await put(path.join(old.root,'mods/extra.jar'),'extra');assert.equal((await m.matching(f.sha512)).status,'changed');
  const newer=await m.install(f.archive);assert.notEqual(old.id,newer.id);assert.equal((await m.list()).length,2);assert.equal(calls(),1,'validated mod cache is reused');assert.equal(await readFile(path.join(old.root,'saves/world/level.dat'),'utf8'),'keep');assert.equal((await m.matching(f.sha512)).instance.id,newer.id);
  await put(path.join(newer.root,'mods/test.jar'),'modified');assert.equal((await m.matching(f.sha512)).status,'changed');
});
test('a managed instance can launch independently without any room or PCL process',async t=>{
  const temp=await temporary(t),f=await sample(),{manager:m}=manager(temp),instance=await m.install(f.archive);let child,spawned;
  const launcher=new GameLauncher({library:new Map([[instance.id,instance]]),account:{},cacheDir:path.join(temp,'client-cache'),platform,probe:async()=>java,spawnImpl:(file,args,options)=>{spawned={file,args,options};child=new EventEmitter();queueMicrotask(()=>child.emit('spawn'));return child;}});launcher.javaPath=java.path;
  const input={id:instance.id,accountMode:'offline',name:'Player_1',mode:'auto',memoryMB:1024};await launcher.check(input);await launcher.start(input);assert.equal(spawned.options.cwd,instance.root);assert.equal(spawned.options.shell,false);assert.equal(spawned.file,java.path);child.emit('exit',0,null);
});
test('install failure and cancellation never register a partial instance, then retry is possible',async t=>{
  const temp=await temporary(t),f=await sample();let fail=true;
  const {manager:m}=manager(temp,{fetchImpl:async()=>new Response(fail?'corrupt':f.mod)});
  await assert.rejects(m.install(f.archive),/校验失败|下载失败/);assert.equal((await m.list()).length,0);assert.deepEqual((await readdir(path.join(temp,'instances'))).filter(n=>n.startsWith('.staging')),[]);assert.equal(m.state().state,'failed');
  fail=false;assert.equal((await m.install(f.archive)).pack.sha512,f.sha512);
  let release;const waiting=new Promise(resolve=>{release=resolve;});const second=(await sample({versionId:'cancel-test'}));
  const {manager:c}=manager(path.join(temp,'cancel'),{engine:async(pack,game,context)=>{await waiting;context.signal.throwIfAborted();return fakeEnvironment(pack,game,context);}});
  const job=c.install(second.archive);await new Promise(resolve=>setTimeout(resolve,20));c.cancel();release();await assert.rejects(job,/取消/);assert.equal((await c.list()).length,0);assert.equal(c.state().state,'cancelled');
});
test('mismatched room archive and concurrent installation are refused',async t=>{
  const temp=await temporary(t),f=await sample(),{manager:m}=manager(temp);await assert.rejects(m.install(f.archive,'0'.repeat(128)),/不一致/);assert.equal((await m.list()).length,0);
  let resolve;const wait=new Promise(r=>resolve=r),{manager:slow}=manager(path.join(temp,'slow'),{engine:async(...args)=>{await wait;return fakeEnvironment(...args);}});const first=slow.install(f.archive);await assert.rejects(slow.install(f.archive),/正在安装/);resolve();await first;
});
test('download verification rejects corrupted responses and successful transfers populate cache',async t=>{
  const temp=await temporary(t),target=path.join(temp,'a.jar'),data=Buffer.from('test payload'),entry={path:'mods/a.jar',size:data.length,hashes:{sha512:hash(data)},downloads:['https://cdn.modrinth.com/a.jar']};let calls=0;
  await assert.rejects(downloadFile(entry,target,{checkURL:packURL,fetchImpl:async()=>{calls++;return new Response('bad payload!');}}),/大小|校验|不完整/);assert.equal(await stat(target).then(()=>true,()=>false),false);
  calls=0;const options={cacheDir:path.join(temp,'cache'),checkURL:packURL,fetchImpl:async()=>{calls++;return new Response(data);}};
  await downloadFile(entry,target,options);await downloadFile(entry,path.join(temp,'other.jar'),options);assert.equal(calls,1);assert.equal(await readFile(path.join(temp,'other.jar'),'utf8'),data.toString());
});
test('progress exposes current file, real bytes, speed and phase ETA without inventing processing estimates',()=>{
  let now=0;const events=[],p=new InstallProgress(e=>events.push(e),()=>now);p.begin('包');p.phase('mods','下载模组',5,[{path:'mods/a.jar',size:10000}]);p.update('mods/a.jar',1000,10000,{networkBytes:1000});now=2000;p.update('mods/a.jar',3000,10000,{networkBytes:2000});const state=p.state();assert.equal(state.file,'mods/a.jar');assert.equal(state.percent,30);assert.equal(state.speedBps,1500);assert.equal(state.etaSeconds,5);assert.equal(state.completedBytes,3000);
  p.phase('loader','安装 Forge',4);p.detail('processor.jar');assert.equal(p.state().etaSeconds,null);assert.equal(p.state().percent,null);p.end('failed','network failed');assert.equal(events.at(-1).message,'network failed');
});
test('schema 5 databases migrate without altering accounts, rooms or membership',async t=>{
  const temp=await temporary(t),db=path.join(temp,'existing.sqlite');let store=new Store(db);store.db.exec('DROP TABLE pack_uploads; DROP TABLE room_packs; DROP TABLE pack_files;PRAGMA user_version=5;');store.run('INSERT INTO users VALUES (?,?,?)','old','原来的用户',1);store.close();store=new Store(db);assert.equal(store.get('PRAGMA user_version').user_version,7);assert.equal(store.get('SELECT name FROM users WHERE id=?','old').name,'原来的用户');store.close();
});
async function serverFixture(t){const app=await createApp({port:0,dbPath:':memory:'});t.after(()=>app.close());const call=async(url,body,token)=>{const r=await fetch(app.url+url,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{'X-Session':token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json()};};const host=(await call('/api/session',{name:'房主'})).data.id,member=(await call('/api/session',{name:'成员'})).data.id,outsider=(await call('/api/session',{name:'路人'})).data.id,room=(await call('/api/rooms',{name:'整合包测试'},host)).data;await call('/api/join',{code:room.code},member);return {app,call,host,member,outsider,room};}
test('host publishes one exact pack, member downloads it, outsiders and non-host writes are rejected',async t=>{
  const {call,host,member,outsider,room}=await serverFixture(t),f=await sample(),body={archive:f.archive.toString('base64'),expected:null};
  assert.equal((await call('/api/rooms/'+room.id+'/pack',body,member)).status,403);assert.equal((await call('/api/rooms/'+room.id+'/pack',body,host)).status,200);
  const state=(await call('/api/state',undefined,member)).data;assert.equal(state.rooms[0].pack.sha512,f.sha512);assert.equal(state.rooms[0].version,'1.20.1');assert.equal('archive' in state.rooms[0].pack,false);
  const downloaded=await call('/api/rooms/'+room.id+'/pack?sha512='+f.sha512,undefined,member);assert.equal(hash(Buffer.from(downloaded.data.archive,'base64')),f.sha512);
  assert.equal((await call('/api/rooms/'+room.id+'/pack',undefined,outsider)).status,404);assert.equal((await call('/api/rooms/'+room.id+'/pack')).status,401);
  assert.equal((await call('/api/rooms/'+room.id+'/pack?sha512='+'0'.repeat(128),undefined,member)).status,409);
  assert.equal((await call('/api/rooms/'+room.id+'/pack',body,host)).status,409);
});
test('leaving a room revokes package download while the installed game remains independently usable',async t=>{
  const {call,host,member,room}=await serverFixture(t),temp=await temporary(t),f=await sample();await call('/api/rooms/'+room.id+'/pack',{archive:f.archive.toString('base64')},host);
  const response=await call('/api/rooms/'+room.id+'/pack',undefined,member),{manager:m}=manager(temp);const installed=await m.install(Buffer.from(response.data.archive,'base64'),response.data.pack.sha512);await call('/api/rooms/'+room.id+'/leave',{},member);
  assert.equal((await call('/api/rooms/'+room.id+'/pack',undefined,member)).status,404);assert.equal((await new ManagedPacks({root:temp}).list())[0].id,installed.id);assert.equal((await m.matching(f.sha512)).status,'ready');
});
test('malformed archives do not change room state and remove/close release stored packages',async t=>{
  const {call,host,member,room}=await serverFixture(t),f=await sample();assert.equal((await call('/api/rooms/'+room.id+'/pack',{archive:Buffer.from('not a zip').toString('base64')},host)).status,400);await call('/api/rooms/'+room.id+'/pack',{archive:f.archive.toString('base64')},host);
  assert.equal((await call('/api/rooms/'+room.id+'/pack/remove',{expected:f.sha512},member)).status,403);assert.equal((await call('/api/rooms/'+room.id+'/pack/remove',{expected:f.sha512},host)).status,200);assert.equal((await call('/api/state',undefined,host)).data.rooms[0].pack,null);
});
test('room pack changes reach members through the existing WebSocket state stream',async t=>{
  const {app,call,host,member,room}=await serverFixture(t),ticket=(await call('/api/realtime/ticket',{},member)).data;
  const ws=new WebSocket(app.url.replace('http:','ws:')+'/api/realtime',{origin:app.url});ws.on('error',()=>{});
  const frame=match=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{cleanup();reject(Error('Expected WS frame did not arrive'));},8000);const listener=raw=>{const value=JSON.parse(raw);if(match(value)){cleanup();resolve(value);}};function cleanup(){clearTimeout(timer);ws.off('message',listener);}ws.on('message',listener);});
  try{
    await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
    const ready=frame(value=>value.type==='ready');ws.send(JSON.stringify({type:'auth',ticket:ticket.ticket}));await ready;
    const f=await sample(),received=frame(value=>JSON.stringify(value).includes(f.sha512));
    await call('/api/rooms/'+room.id+'/pack',{archive:f.archive.toString('base64')},host);await received;
  }finally{ws.terminate();}
});

test('production Fabric installer downloads and verifies the actual environment plan with an existing Java',async t=>{
  const temp=await temporary(t),f=await sample(),jar=Buffer.from('simulated Mojang client jar'),asset=Buffer.from('asset'),loader=Buffer.from('loader');
  const index=Buffer.from(JSON.stringify({objects:{'minecraft/sounds/test.ogg':{hash:hash(asset,'sha1'),size:asset.length}}}));
  const meta={id:'1.20.1',type:'release',mainClass:'net.minecraft.client.main.Main',assets:'test-assets',assetIndex:{id:'test-assets',url:'https://piston-meta.mojang.com/assets.json',sha1:hash(index,'sha1'),size:index.length},downloads:{client:{url:'https://piston-data.mojang.com/client.jar',sha1:hash(jar,'sha1'),size:jar.length}},javaVersion:{majorVersion:17,component:'java-runtime-gamma'},libraries:[],arguments:{jvm:['-cp','${classpath}'],game:['--username','${auth_player_name}']}};
  const metaBytes=Buffer.from(JSON.stringify(meta)),profile={id:'fabric',inheritsFrom:'1.20.1',mainClass:'net.fabricmc.loader.impl.launch.knot.KnotClient',libraries:[{name:'net.fabricmc:fabric-loader:0.16.14',downloads:{artifact:{path:'net/fabricmc/fabric-loader/0.16.14/loader.jar',url:'https://maven.fabricmc.net/loader.jar',sha1:hash(loader,'sha1'),size:loader.length}}}]};
  const mock=async url=>{
    if(url.includes('version_manifest_v2'))return Response.json({versions:[{id:'1.20.1',url:'https://piston-meta.mojang.com/metadata.json',sha1:hash(metaBytes,'sha1')}]});
    if(url.endsWith('metadata.json'))return new Response(metaBytes);if(url.endsWith('/client.jar'))return new Response(jar);if(url.endsWith('/assets.json'))return new Response(index);if(url.includes('resources.download.minecraft.net'))return new Response(asset);if(url.startsWith('https://meta.fabricmc.net'))return Response.json(profile);if(url.endsWith('/loader.jar'))return new Response(loader);if(url.startsWith('https://cdn.modrinth.com'))return new Response(f.mod);throw Error('Unexpected download '+url);
  };
  const m=new ManagedPacks({root:temp,platform,javaCandidates:async()=>[java],probe:async()=>java,fetchImpl:mock});
  const installed=await m.install(f.archive);assert.equal(installed.version,'1.20.1-fabric0.16.14');assert.equal(await readFile(path.join(installed.root,'libraries/net/fabricmc/fabric-loader/0.16.14/loader.jar'),'utf8'),loader.toString());assert.equal((await m.matching(f.sha512)).status,'ready');
});
test('missing Java is installed from the official runtime manifest and verified before use',async t=>{
  const temp=await temporary(t),executable=Buffer.from('synthetic Java runtime, never executed'),runtimeManifest=Buffer.from(JSON.stringify({files:{bin:{type:'directory'},'bin/java.exe':{type:'file',executable:true,downloads:{raw:{url:'https://piston-data.mojang.com/java.exe',sha1:hash(executable,'sha1'),size:executable.length}}}}}));
  const m=new ManagedPacks({root:temp,platform,probe:async file=>{assert.equal(await readFile(file,'utf8'),executable.toString());return {...java,path:file};},fetchImpl:async url=>{if(url.endsWith('all.json'))return Response.json({'windows-x64':{'java-runtime-gamma':[{manifest:{url:'https://piston-meta.mojang.com/java-manifest.json',sha1:hash(runtimeManifest,'sha1'),size:runtimeManifest.length}}]}});if(url.endsWith('java-manifest.json'))return new Response(runtimeManifest);if(url.endsWith('java.exe'))return new Response(executable);throw Error('Unexpected Java request');}});
  m.progress.begin('Java fixture');m.progress.phase('java','准备 Java',2);
  const context={signal:new AbortController().signal,progress:m.progress,fetchImpl:m.fetchImpl,cacheDir:path.join(temp,'cache')};
  const result=await m.runtime({javaVersion:{majorVersion:17,component:'java-runtime-gamma'}},context);assert.equal(result.major,17);assert.ok(result.path.startsWith(path.join(temp,'runtimes')));assert.equal((await m.runtime({javaVersion:{majorVersion:17,component:'java-runtime-gamma'}},context)).path,result.path);
});

test('room game edits retain pinned pack versions and accept port changes',async t=>{
 const {call,host,room}=await serverFixture(t),f=await sample();await call('/api/rooms/'+room.id+'/pack',{archive:f.archive.toString('base64')},host);
 assert.equal((await call('/api/rooms/'+room.id+'/game',{version:'1.21.1',loader:'Fabric'},host)).status,400);
 assert.equal((await call('/api/rooms/'+room.id+'/game',{version:'1.20.1',loader:'Fabric',port:51234},host)).status,200);
 assert.equal((await call('/api/state',undefined,host)).data.rooms[0].pack.sha512,f.sha512);
});
test('pack upload accepts manifests above the normal JSON body limit',async t=>{
 const {call,host,room}=await serverFixture(t),f=await sample({files:false,overrides:false});const {randomBytes}=await import('node:crypto');
 const archive=await zip([['modrinth.index.json',JSON.stringify(f.index)],['overrides/config/large.bin',randomBytes(512*1024)]]);assert.ok(archive.length>400000);
 const response=await call('/api/rooms/'+room.id+'/pack',{archive:archive.toString('base64')},host);assert.equal(response.status,200);assert.equal(response.data.pack.sha512,hash(archive));
});

test('Modrinth ZIP imports download pinned mods, preserve game overrides and ignore PCL launcher settings',async t=>{
 const temp=await temporary(t),f=await sample({overrides:false}),data=Buffer.from('synthetic ZIP mod, never executed');
 f.index.dependencies={minecraft:'1.20.1',forge:'47.3.33'};
 f.index.files=[{path:'mods/zip-test.jar',fileSize:data.length,hashes:{sha512:hash(data),sha1:hash(data,'sha1')},downloads:['https://edge.forgecdn.net/files/1/2/test.jar','https://mediafilez.forgecdn.net/files/1/2/test.jar']}];
 const archive=await zip([['modrinth.index.json',JSON.stringify(f.index)],['overrides/config/zip.cfg','keep=true'],['overrides/PCL/Setup.ini','launcher-only'],['client-overrides/pcl/config.json','{}'],['overrides/mods/mcef-libraries/windows_amd64/jcef_helper.exe','fixture, never executed']]),file=path.join(temp,'PCL 导出的整合包.zip');await writeFile(file,archive);
 const parsed=await inspectMrpack(file);assert.equal(parsed.loader,'Forge');assert.equal(parsed.loaderVersion,'47.3.33');assert.equal(parsed.files.length,1);assert.equal(parsed.overrides.length,2);assert.equal(parsed.overrides.some(x=>x.path.toLowerCase().startsWith('pcl/')),false);
 const urls=[],events=[],m=new ManagedPacks({root:temp+'/Joincraft',platform,engine:fakeEnvironment,notify:event=>events.push(event),fetchImpl:async url=>{urls.push(url);return new Response(url.includes('edge.forgecdn.net')?'corrupt':data);}}),instance=await m.install(file);
 assert.ok(urls.some(u=>u.includes('mediafilez.forgecdn.net')));assert.equal((await readFile(instance.root+'/mods/zip-test.jar')).toString(),data.toString());assert.equal(await readFile(instance.root+'/config/zip.cfg','utf8'),'keep=true');assert.equal(await stat(instance.root+'/PCL').then(()=>true,()=>false),false);assert.equal((await m.matching(parsed.sha512)).status,'ready');assert.equal(hash(await readFile(path.join(instance.root,'..','pack.mrpack'))),parsed.sha512);assert.ok(events.some(e=>e.phase==='mods'&&e.totalBytes===data.length));
});
test('ZIP content validation still rejects ordinary archives and protected runtime overrides',async()=>{
 await assert.rejects(inspectMrpack(await zip([['mods/alone.jar','not an import manifest']])),/无法识别整合包/);
 const f=await sample({files:false,overrides:false});
 for(const entry of ['overrides/versions/replace.json','overrides/libraries/replace.jar','client-overrides/.joincraft/instance.json'])await assert.rejects(inspectMrpack(await zip([['modrinth.index.json',JSON.stringify(f.index)],[entry,'{}']])),/不能覆盖启动器/);
 assert.throws(()=>packPath('PCL/Setup.ini'),/不能覆盖启动器/,'metadata skipping must not allow manifest downloads into launcher directories');
});
test('CurseForge mirror redirects stay on the explicit CDN allowlist',async()=>{
 for(const host of ['edge.forgecdn.net','mediafilez.forgecdn.net','mediafiles.forgecdn.net'])assert.equal(new URL(packURL('https://'+host+'/files/1/2/mod.jar')).hostname,host);
 for(const url of ['https://edge.forgecdn.net.evil.example/mod.jar','https://evil.forgecdn.net/mod.jar','http://edge.forgecdn.net/mod.jar','https://user:pass@edge.forgecdn.net/mod.jar'])assert.throws(()=>packURL(url));
 const calls=[];const response=await fetchChecked('https://edge.forgecdn.net/a.jar',{checkURL:packURL,fetchImpl:async url=>{calls.push(url);return calls.length===1?new Response(null,{status:302,headers:{location:'https://mediafilez.forgecdn.net/a.jar'}}):new Response('verified later');}});assert.equal(await response.text(),'verified later');assert.equal(calls.length,2);
 await assert.rejects(fetchChecked('https://edge.forgecdn.net/a.jar',{checkURL:packURL,fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}})}),/来源暂不支持/);
});

test('managed installation reuses hashed mods from an added PCL version without modifying it',async t=>{
  const root=await temporary(t),f=await sample(),pcl=root+'/PCL/.minecraft/versions/pack';await put(pcl+'/mods/test.jar',f.mod);await put(pcl+'/saves/world/level.dat','keep original world');
  const events=[],{manager:m,calls}=manager(root+'/Joincraft',{resourceRoots:async()=>[pcl],notify:e=>events.push(e)});
  const installed=await m.install(f.archive);assert.equal(calls(),0);assert.deepEqual(await readFile(installed.root+'/mods/test.jar'),f.mod);assert.equal(await readFile(pcl+'/saves/world/level.dat','utf8'),'keep original world');assert.ok(events.some(e=>e.phase==='mods'&&e.reusedFiles===1));
});


test('installation keeps its game directory stable and publishes only a finished instance',async t=>{
  const root=await temporary(t),f=await sample();let installedAt,release,entered;
  const started=new Promise(r=>entered=r),wait=new Promise(r=>release=r);
  const {manager:m}=manager(root,{engine:async(pack,game,context)=>{installedAt=game;entered();await wait;return fakeEnvironment(pack,game,context);}});
  const pending=m.install(f.archive);await started;
  assert.equal((await m.list()).length,0,'an unfinished final directory is never launchable');
  assert.match(path.basename(path.dirname(installedAt)),/^[a-f0-9-]{36}$/);
  assert(!installedAt.includes('.staging-'));release();
  const result=await pending;assert.equal(result.root,installedAt,'Java and all generated files keep their original directory');
  assert.equal((await m.list()).length,1);
});

test('instance registration tolerates temporary Windows sharing violations without moving the game folder',async t=>{
  const root=await temporary(t),record={schema:1,id:'synthetic'},fs=await import('node:fs/promises');let attempts=0;
  await registerInstance(root,record,{wait:async()=>{},renameImpl:async(from,to)=>{assert.equal(path.dirname(from),root);assert.equal(to,path.join(root,'instance.json'));if(++attempts<3)throw Object.assign(Error('temporarily locked'),{code:'EPERM'});await fs.rename(from,to);}});
  assert.equal(attempts,3);assert.deepEqual(JSON.parse(await readFile(path.join(root,'instance.json'),'utf8')),record);
  assert.deepEqual(await readdir(root),['instance.json']);
});

test('cancelled or persistently blocked registration leaves no partial instance record',async t=>{
  const root=await temporary(t);let attempts=0;
  await assert.rejects(registerInstance(root,{schema:1},{wait:async()=>{},renameImpl:async()=>{attempts++;throw Object.assign(Error('locked'),{code:'EPERM'});}}),/locked/);
  assert.equal(attempts,7);assert.deepEqual(await readdir(root),[]);
  const controller=new AbortController();
  await assert.rejects(registerInstance(root,{schema:1},{signal:controller.signal,wait:async()=>{controller.abort(Error('cancelled registration'));},renameImpl:async()=>{throw Object.assign(Error('locked'),{code:'EBUSY'});}}),/cancelled registration/);
  assert.deepEqual(await readdir(root),[]);
});
