import test from 'node:test';import assert from 'node:assert/strict';import {generateKeyPairSync,createHash,sign} from 'node:crypto';import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {EventEmitter} from 'node:events';import {CancellationToken} from 'builder-util-runtime';import {BundleUpdater,verifyManifest} from './desktop/bundle-updater.mjs';import {ClientUpdater} from './desktop/updater.mjs';
const {privateKey,publicKey:key}=generateKeyPairSync('ed25519');const publicKey=key.export({format:'pem',type:'spki'});
const payload=Buffer.from('Synthetic ZIP transport fixture; never executed.');
const info={schema:1,version:'0.9.5',platform:'win32',arch:'x64',file:'joincraft-0.9.5-win-x64.zip',size:payload.length,sha512:createHash('sha512').update(payload).digest('hex'),notes:'内部更新'};
const signed=value=>{const body=Buffer.from(JSON.stringify(value));return {payload:body.toString('base64'),signature:sign(null,body,privateKey).toString('base64')};};
async function fixture(t,options={}){
 const folder=await mkdtemp(path.join(os.tmpdir(),'jc-bundle-test-'));t.after(()=>rm(folder,{recursive:true,force:true}));const root=path.join(folder,'app'),data=path.join(folder,'profile'),resources=path.join(folder,'resources');await mkdir(root);await mkdir(data);await mkdir(path.join(resources,'updater'),{recursive:true});await writeFile(path.join(resources,'updater','joincraft-update.exe'),'non-executable fixture');await writeFile(path.join(root,'joincraft-release.json'),JSON.stringify({distribution:'bundle',version:'0.9.4'}));
 let quits=0,downloads=0,spawned=0,mode='ready';const app={getPath:name=>name==='exe'?path.join(root,'joincraft.exe'):data,quit:()=>quits++};
 const fetcher=async url=>{assert.ok(url.startsWith('https://www.joincraft.top/updates/'));if(url.endsWith('.json'))return Response.json(signed(info));downloads++;return new Response(payload);};
 const spawnHelper=(exe,args,opts)=>{spawned++;assert.equal(opts.windowsHide,true);assert.equal(opts.cwd,args[0]);assert.equal(path.dirname(exe),args[0]);const emitter=new EventEmitter();emitter.unref=()=>{};setImmediate(async()=>{emitter.emit('spawn');await writeFile(path.join(args[0],'status.json'),JSON.stringify({phase:mode,code:'test failure'}));});return emitter;};
 const updater=new BundleUpdater({app,currentVersion:'0.9.4',arch:'x64',publicKey,resourcesPath:resources,fetcher,spawnHelper,prepareTimeout:3000,...options});
 return {updater,app,root,data,get quits(){return quits;},get downloads(){return downloads;},get spawned(){return spawned;},set mode(value){mode=value;}};
}
test('signed manifest binds version, platform, architecture and artifact; tampering/replay rejected',()=>{
 assert.equal(verifyManifest(signed(info),{publicKey,currentVersion:'0.9.4'}).version,'0.9.5');
 for(const patch of [{version:'0.9.3'},{version:'0.9.5-beta.1'},{file:'https://evil.example/a.zip'},{arch:'arm64'},{size:0},{sha512:'bad'}])assert.throws(()=>verifyManifest(signed({...info,...patch}),{publicKey,currentVersion:'0.9.4'}));
 const changed=signed(info);changed.payload=Buffer.from(JSON.stringify({...info,size:999})).toString('base64');assert.throws(()=>verifyManifest(changed,{publicKey}),/signature/);
});
test('explicit download verifies complete bytes and helper readiness before quitting; no installer',async t=>{
 const f=await fixture(t);const client=new ClientUpdater({updater:f.updater,packaged:true,platform:'win32',currentVersion:'0.9.4',confirmInstall:async()=>true});t.after(()=>client.dispose());await client.check();assert.equal(f.downloads,0);await client.download();assert.equal(client.state().phase,'downloaded');assert.equal(f.spawned,0);assert.equal(f.quits,0);await client.install();assert.equal(f.spawned,1);assert.equal(f.quits,1);assert.equal(client.state().phase,'installing');const job=JSON.parse(await readFile(path.join(f.data,'bundle-updates',JSON.parse(await readFile(path.join(f.data,'bundle-updates/last-job.json'),'utf8')).token,'job.json'),'utf8'));assert.equal(job.root,f.root);assert.equal(job.parentPid,process.pid);
});
test('checksum, short/extra bytes and failed download never become installable',async t=>{
 for(const data of [Buffer.from('corrupt'),Buffer.concat([payload,Buffer.from('extra')]),Buffer.alloc(payload.length,'x')]){
 const f=await fixture(t,{fetcher:async url=>url.endsWith('.json')?Response.json(signed(info)):new Response(data)});await f.updater.checkForUpdates();await assert.rejects(()=>f.updater.downloadUpdate(new CancellationToken()));assert.equal(f.updater.downloaded,undefined);assert.equal(f.quits,0);
 }
});
test('cancelled download removes partial files and leaves original app untouched',async t=>{
 const f=await fixture(t,{fetcher:async url=>url.endsWith('.json')?Response.json(signed(info)):new Response(payload)});await f.updater.checkForUpdates();const token=new CancellationToken();token.cancel();await assert.rejects(()=>f.updater.downloadUpdate(token));assert.equal(f.updater.downloaded,undefined);assert.equal(f.quits,0);
});
test('helper failure does not exit app and propagates to a retryable update state',async t=>{
 const f=await fixture(t);f.mode='failed';const client=new ClientUpdater({updater:f.updater,currentVersion:'0.9.4',packaged:true,platform:'win32',confirmInstall:async()=>true});t.after(()=>client.dispose());await client.check();await client.download();await client.install();assert.equal(f.quits,0);assert.equal(client.state().phase,'downloaded');assert.equal(client.state().errorStage,'install');
});
test('unsigned or foreign feed cannot trigger download, spawn or quit',async t=>{
 const f=await fixture(t,{fetcher:async()=>Response.json({payload:Buffer.from(JSON.stringify(info)).toString('base64'),signature:'invalid'})});await assert.rejects(()=>f.updater.checkForUpdates());assert.equal(f.spawned,0);assert.equal(f.downloads,0);assert.equal(f.quits,0);
});
test('authenticated same/older release means no update and cannot trigger download',async t=>{
 const f=await fixture(t,{fetcher:async()=>Response.json(signed({...info,version:'0.9.4',file:'joincraft-0.9.4-win-x64.zip'}))});const client=new ClientUpdater({updater:f.updater,currentVersion:'0.9.4',packaged:true,platform:'win32'});t.after(()=>client.dispose());await client.check();assert.equal(client.state().phase,'idle');await assert.rejects(()=>client.download());assert.equal(f.downloads,0);
});
test('legacy/unmarked app must use portable migration; original installation never modified',async t=>{
 const f=await fixture(t);await rm(path.join(f.root,'joincraft-release.json'));await f.updater.checkForUpdates();await assert.rejects(()=>f.updater.downloadUpdate(new CancellationToken()));assert.equal(f.downloads,0);assert.equal(f.quits,0);
});
test('preparation timeout leaves app running, cancels late replacement and retries with a fresh job',async t=>{
 const f=await fixture(t);f.mode='pending';f.updater.prepareTimeout=25;await f.updater.checkForUpdates();await f.updater.downloadUpdate(new CancellationToken());await assert.rejects(()=>f.updater.quitAndInstall(),/timed out/);assert.equal(f.quits,0);
 const cache=path.join(f.data,'bundle-updates'),first=JSON.parse(await readFile(path.join(cache,'last-job.json'),'utf8')).token;assert.equal(await readFile(path.join(cache,first,'abort'),'utf8'),'cancelled');
 f.mode='ready';f.updater.prepareTimeout=3000;await f.updater.quitAndInstall();const second=JSON.parse(await readFile(path.join(cache,'last-job.json'),'utf8')).token;assert.notEqual(first,second);assert.equal(f.quits,1);
});
