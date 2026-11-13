import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,writeFile,truncate,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import yazl from 'yazl';
import {inspectMrpack,extractMrpackOverrides,archiveHash} from './shared/pack-format.mjs';
import {zipEntries} from './shared/zip-io.mjs';
import {hashFile,validDownload} from './launcher/pack-download.mjs';
import {ManagedPacks} from './launcher/pack-installer.mjs';
async function archive(){
 const zip=new yazl.ZipFile();zip.addBuffer(Buffer.from(JSON.stringify({formatVersion:1,game:'minecraft',name:'取消测试',versionId:'1',dependencies:{minecraft:'1.20.1'},files:[]})),'modrinth.index.json');
 zip.addBuffer(Buffer.alloc(0),'overrides/config/empty.cfg');zip.addBuffer(Buffer.alloc(512*1024,1),'overrides/kubejs/data/test.json');zip.addBuffer(Buffer.alloc(128*1024,2),'overrides/config/stored.bin',{compress:false});zip.end();const chunks=[];for await(const chunk of zip.outputStream)chunks.push(chunk);return Buffer.concat(chunks);
}
async function temporary(t){const dir=await mkdtemp(path.join(tmpdir(),'joincraft-cancel-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
test('aborting an inflated ZIP entry settles instead of waiting forever for a legacy close event',{timeout:3000},async()=>{
 const data=await archive(),controller=new AbortController();
 await assert.rejects(inspectMrpack(data,{signal:controller.signal,onProgress:value=>{if(value.file==='kubejs/data/test.json')controller.abort(Error('cancel ZIP read'));}}),/cancel ZIP read|aborted/);
 assert.equal((await inspectMrpack(data)).overrides.length,3);
});
test('aborting extraction closes the output and can immediately inspect the same archive again',{timeout:3000},async t=>{
 const dir=await temporary(t),data=await archive(),file=path.join(dir,'pack.zip');await writeFile(file,data);const pack=await inspectMrpack(file),controller=new AbortController();
 await assert.rejects(extractMrpackOverrides(file,pack.overrides,path.join(dir,'game'),{signal:controller.signal,onProgress:value=>{if(value.file==='kubejs/data/test.json')controller.abort(Error('cancel ZIP extraction'));}}),/cancel ZIP extraction|aborted/);
 assert.equal((await inspectMrpack(file)).sha512,pack.sha512);
});
test('ZIP entry enumeration responds to cancellation while awaiting the next entry',{timeout:1000},async()=>{
 const zip=new EventEmitter();zip.readEntry=()=>{};const controller=new AbortController(),iterator=zipEntries(zip,{signal:controller.signal}),waiting=iterator.next();controller.abort(Error('cancel entry wait'));await assert.rejects(waiting,/cancel entry wait/);
 for(const event of ['entry','end','error','close'])assert.equal(zip.listenerCount(event),0);
});
test('unexpected ZIP closure rejects rather than leaving a pending enumeration',{timeout:1000},async()=>{
 const zip=new EventEmitter();zip.readEntry=()=>{};const waiting=zipEntries(zip).next();zip.emit('close');await assert.rejects(waiting,/提前结束/);
});
test('file and archive hash validation honor cancellation and never return a false mismatch',{timeout:3000},async t=>{
 const dir=await temporary(t),file=path.join(dir,'large.bin');await writeFile(file,'');await truncate(file,32*1024*1024);
 for(const action of [signal=>hashFile(file,'sha512',{signal}),signal=>validDownload(file,{hash:'a'.repeat(128),signal}),signal=>archiveHash(file,{signal})]){
  const controller=new AbortController(),waiting=action(controller.signal);setImmediate(()=>controller.abort(Error('cancel hash')));await assert.rejects(waiting,/cancel hash|aborted/);
 }
});
test('cancelling an install during ZIP inspection releases the task and allows a retry',{timeout:3000},async t=>{
 const dir=await temporary(t),data=await archive();let manager,cancelOnce=true,clock=0,calls=0;
 manager=new ManagedPacks({root:dir,notify:value=>{if(cancelOnce&&value.file==='kubejs/data/test.json'&&value.state==='installing'){cancelOnce=false;manager.cancel();}},engine:async()=>{calls++;return {version:'1.20.1',java:{path:'not-executed',major:17}};}});
 manager.progress.now=()=>clock+=200;
 await assert.rejects(manager.install(data),/取消/);assert.equal(manager.busy,false);assert.equal(manager.state().state,'cancelled');assert.equal((await manager.list()).length,0);assert.equal(calls,0);
 assert.ok((await manager.install(data)).id);assert.equal(calls,1);assert.equal(manager.busy,false);
});
test('installed file matching propagates cancellation instead of reporting changed',{timeout:3000},async t=>{
 const dir=await temporary(t),file=path.join(dir,'mods/mod.jar');await mkdir(path.dirname(file));await writeFile(file,'');await truncate(file,32*1024*1024);const controller=new AbortController(),manager=new ManagedPacks({root:dir}),sha='a'.repeat(128);
 manager.list=async()=>[{root:dir,pack:{sha512:sha},lock:[{path:'mods/mod.jar',sha512:sha}]}];const waiting=manager.matching(sha,{signal:controller.signal});setImmediate(()=>controller.abort(Error('cancel matching')));await assert.rejects(waiting,/cancel matching|aborted/);
});
