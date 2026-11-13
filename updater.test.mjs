import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {ClientUpdater} from './desktop/updater.mjs';
const offer={version:'0.10.0',releaseNotes:'房间语音与客户端更新'};
class FakeUpdater extends EventEmitter{
 checks=0;downloads=0;installs=0;info=offer;
 async checkForUpdates(){this.checks++;this.emit('update-available',this.info);return {updateInfo:this.info};}
 async downloadUpdate(token){this.downloads++;this.emit('download-progress',{percent:67,total:1000,transferred:670,bytesPerSecond:200});this.emit('update-downloaded',this.info);return ['/fake/verified-update.exe'];}
 quitAndInstall(){this.installs++;}
}
function fixture(options={}){const updater=new FakeUpdater(),events=[];const client=new ClientUpdater({updater,currentVersion:'0.9.0',packaged:true,platform:'win32',notify:e=>events.push(e),confirmInstall:async()=>true,...options});return {updater,events,client};}
test('updates require explicit download/install, carry progress, and never auto-install on quit',async()=>{
 const {updater,events,client}=fixture();assert.equal(updater.autoDownload,false);assert.equal(updater.autoInstallOnAppQuit,false);assert.equal(updater.allowDowngrade,false);assert.equal(updater.allowPrerelease,false);
 await client.check();assert.equal(client.state().phase,'available');assert.equal(updater.downloads,0);
 await client.download();assert.ok(events.some(e=>e.percent===67));assert.equal(client.state().phase,'downloaded');assert.equal(client.state().canInstall,true);assert.equal(updater.installs,0);
 await client.check();assert.equal(updater.checks,1);await client.install();assert.equal(updater.installs,1);assert.equal(client.state().phase,'installing');assert.throws(()=>client.assertCanLaunch(),/更新/);client.dispose();
});
test('development and unsupported platforms cannot fetch or download',async()=>{
 for(const options of [{packaged:false},{platform:'linux'}]){const {updater,client}=fixture(options);await client.check();assert.equal(updater.checks,0);await assert.rejects(()=>client.download());assert.equal(updater.downloads,0);assert.equal(client.state().phase,'unsupported');client.dispose();}
});
test('one check/download at a time, cancellation never marks partial files ready and retry succeeds',async()=>{
 const {client,updater}=fixture();let finish;
 updater.checkForUpdates=()=>new Promise(resolve=>{updater.checks++;finish=()=>{updater.emit('update-available',offer);resolve({updateInfo:offer});};});
 const a=client.check();await client.check();assert.equal(updater.checks,1);finish();await a;
 updater.downloadUpdate=token=>new Promise((resolve,reject)=>{updater.downloads++;token.onCancel(()=>reject(new Error('cancelled')));});
 const d=client.download();await client.download();assert.equal(updater.downloads,1);client.cancel();await d;assert.equal(client.state().phase,'available');await assert.rejects(()=>client.install());
 updater.downloadUpdate=FakeUpdater.prototype.downloadUpdate;await client.download();assert.equal(client.state().canInstall,true);client.dispose();
});
test('network and checksum errors retain retry paths without exposing signed URLs or installing',async()=>{
 const {client,updater}=fixture();updater.checkForUpdates=async()=>{throw new Error('ETIMEDOUT https://private.example/?token=secret');};await client.check();assert.equal(client.state().errorStage,'check');assert.ok(!JSON.stringify(client.state()).includes('secret'));
 updater.checkForUpdates=FakeUpdater.prototype.checkForUpdates;await client.check();updater.downloadUpdate=async()=>{const e=Object.assign(new Error('sha512 checksum mismatch'),{code:'ERR_CHECKSUM_MISMATCH'});updater.emit('error',e);throw e;};
 await client.download();assert.equal(client.state().phase,'error');assert.equal(client.state().errorStage,'download');assert.match(client.state().error,/校验/);assert.equal(updater.installs,0);await assert.rejects(()=>client.install());client.dispose();
});
test('running game blocks install, confirmation cancellation preserves downloaded update',async()=>{
 let busy=true,confirm=0;const {client,updater}=fixture({gameBusy:()=>busy,confirmInstall:async()=>{confirm++;return false;}});await client.check();await client.download();assert.equal(client.state().canInstall,false);await assert.rejects(()=>client.install(),/游戏/);assert.equal(confirm,0);busy=false;await client.install();assert.equal(confirm,1);assert.equal(client.state().phase,'downloaded');assert.equal(updater.installs,0);client.assertCanLaunch();client.dispose();
});
test('install lock closes launch race and saves preferences before restart; install errors unlock UI',async()=>{
 let confirm,busy=false,saved=false;const {client,updater}=fixture({gameBusy:()=>busy,confirmInstall:()=>new Promise(r=>confirm=r),beforeInstall:async()=>{saved=true;}});
 await client.check();await client.download();const installing=client.install();assert.equal(client.state().phase,'confirming');assert.throws(()=>client.assertCanLaunch());busy=true;confirm(true);await installing;assert.equal(saved,true);assert.equal(updater.installs,0);assert.equal(client.state().phase,'downloaded');busy=false;
 client.confirmInstall=async()=>true;await client.install();assert.equal(updater.installs,1);updater.emit('error',new Error('native installation failed'));assert.equal(client.state().phase,'downloaded');assert.equal(client.state().errorStage,'install');client.assertCanLaunch();client.dispose();
});
test('stable releases only; same-version and older offers are not accepted',async()=>{
 for(const version of ['0.8.0','0.9.0','0.10.0-beta.1','broken']){const {client,updater}=fixture();updater.info={version};await client.check();assert.equal(client.state().phase,'error');assert.equal(updater.downloads,0);client.dispose();}
});
test('a download needs verified matching version, and no-update checks clear old offers',async()=>{
 const {client,updater}=fixture();await client.check();updater.downloadUpdate=async()=>{updater.emit('update-downloaded',{version:'9.9.9'});return [];};await client.download();assert.equal(client.state().phase,'error');assert.equal(client.state().canInstall,false);
 updater.checkForUpdates=async()=>{updater.emit('update-not-available',{version:'0.9.0'});return {updateInfo:{version:'0.9.0'}};};await client.check();assert.equal(client.state().phase,'idle');assert.equal(client.state().version,null);client.dispose();
});

test('real updater downloads and SHA-512 verifies a local fixture; corruption cannot become installable',{timeout:20000},async()=>{
 const {createServer,request}=await import('node:http');
 const {mkdtemp,writeFile,readFile,rm,mkdir}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const path=await import('node:path');const {createHash}=await import('node:crypto');
 const {default:electronUpdater}=await import('electron-updater');const {HttpExecutor,configureRequestUrl,configureRequestOptions}=await import('builder-util-runtime');
 // Test-only Node transport; production uses Electron net. The fixture is plain text, never executed.
 class LocalExecutor extends HttpExecutor{
  createRequest(options,callback){assert.equal(options.hostname,'127.0.0.1');return request(options,callback);}
  download(url,destination,options){return options.cancellationToken.createPromise((resolve,reject,onCancel)=>{const req={};configureRequestUrl(url,req);configureRequestOptions(req);this.doDownload(req,{destination,options,onCancel,callback:e=>e?reject(e):resolve(destination),responseHandler:null},0);});}
 }
 const root=await mkdtemp(path.join(tmpdir(),'joincraft-update-test-'));const payload=Buffer.from('Synthetic update fixture. NOT AN EXECUTABLE.\n'.repeat(4096));
 let corrupt=false,downloads=0;
 const hash=createHash('sha512').update(payload).digest('base64');
 const server=createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname.endsWith('.yml')){res.end(`version: 0.10.0\nfiles:\n  - url: fixture.exe\n    sha512: ${hash}\n    size: ${payload.length}\npath: fixture.exe\nsha512: ${hash}\nreleaseDate: 2026-11-12T00:00:00.000Z\n`);}else if(pathname==='/fixture.exe'){downloads++;const body=corrupt?Buffer.from('corrupt content'):payload;res.writeHead(200,{'Content-Length':body.length});res.end(body);}else res.writeHead(404).end();});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{for(const broken of [false,true]){
  corrupt=broken;const dir=path.join(root,broken?'bad':'good');await mkdir(dir);const url=`http://127.0.0.1:${server.address().port}`;
  const config=path.join(dir,'app-update.yml');await writeFile(config,`provider: generic\nurl: ${url}\nupdaterCacheDirName: fixture-cache\n`);
  const adapter={version:'0.9.0',name:'joincraft-fixture',isPackaged:true,appUpdateConfigPath:config,userDataPath:dir,baseCachePath:dir,whenReady:async()=>{},onQuit:()=>{},quit:()=>assert.fail('must not quit'),relaunch:()=>assert.fail('must not launch')};
  const updater=new electronUpdater.NsisUpdater(null,adapter);updater.httpExecutor=new LocalExecutor();updater.logger=null;updater.disableDifferentialDownload=true;updater.disableWebInstaller=true;updater.quitAndInstall=()=>assert.fail('must not install test fixture');
  const client=new ClientUpdater({updater,currentVersion:'0.9.0',packaged:true,platform:'win32'});await client.check();assert.equal(client.state().phase,'available');assert.equal(downloads,broken?1:0);
  await client.download();assert.equal(client.state().phase,broken?'error':'downloaded');assert.equal(client.state().canInstall,!broken);
  if(broken)assert.match(client.state().error,/校验/);else{const file=updater.downloadedUpdateHelper.file;assert.deepEqual(await readFile(file),payload);}
  client.dispose();
 }}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});


test('notification reminder is persisted once per version across client restarts',async()=>{
 const {UpdateNotifications}=await import('./desktop/update-notifications.mjs');
 let stored=null,writes=0;const saveVersion=async version=>{stored=version;writes++;};
 const state={phase:'available',version:'0.10.0'};
 const first=new UpdateNotifications({saveVersion});
 assert.deepEqual(await first.claim(state),{version:'0.10.0'});
 assert.equal(await first.claim({...state,phase:'downloaded'}),null);
 const restarted=new UpdateNotifications({lastVersion:stored,saveVersion});
 assert.equal(await restarted.claim(state),null);
 assert.deepEqual(await restarted.claim({...state,version:'0.11.0'}),{version:'0.11.0'});
 assert.equal(writes,2);
});
test('concurrent room and library reminder claims show exactly once',async()=>{
 const {UpdateNotifications}=await import('./desktop/update-notifications.mjs');
 let release;const saving=new Promise(resolve=>{release=resolve;});
 const reminders=new UpdateNotifications({saveVersion:()=>saving});
 const state={phase:'available',version:'0.10.0'};
 const one=reminders.claim(state),two=reminders.claim(state);release();
 assert.deepEqual(await Promise.all([one,two]),[{version:'0.10.0'},null]);
});
test('hidden windows and unsuccessful checks do not consume a reminder',async()=>{
 const {UpdateNotifications}=await import('./desktop/update-notifications.mjs');
 let writes=0;const reminders=new UpdateNotifications({saveVersion:async()=>{writes++;}});
 for(const phase of ['idle','checking','unsupported','error','downloading'])assert.equal(await reminders.claim({phase,version:'0.10.0'}),null);
 const state={phase:'available',version:'0.10.0'};
 assert.equal(await reminders.claim(state,()=>false),null);assert.equal(writes,0);
 assert.deepEqual(await reminders.claim(state,()=>true),{version:'0.10.0'});
});
test('failed reminder persistence remains retryable',async()=>{
 const {UpdateNotifications}=await import('./desktop/update-notifications.mjs');let fail=true;
 const reminders=new UpdateNotifications({saveVersion:async()=>{if(fail)throw new Error('disk full');}});
 const state={phase:'available',version:'0.10.0'};
 await assert.rejects(reminders.claim(state),/disk full/);fail=false;
 assert.deepEqual(await reminders.claim(state),{version:'0.10.0'});
});
