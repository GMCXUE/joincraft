import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {downloadFile,downloadMany,localResourceFiles} from './launcher/pack-download.mjs';
import {InstallProgress} from './launcher/install-progress.mjs';
const sha=data=>createHash('sha1').update(data).digest('hex');
const body=Buffer.from('verified local resource');
const entry=(name,size=body.length)=>({path:'assets/objects/ab/'+name,size,hashes:{sha1:sha(body)},downloads:['https://resources.download.minecraft.net/ab/'+name]});
async function temporary(t){const root=await mkdtemp(path.join(os.tmpdir(),'joincraft-download-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
async function put(root,relative,data){const file=path.join(root,relative);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,data);return file;}

test('default batch downloads 16 files concurrently with a bounded queue and exact aggregate progress',async t=>{
  const root=await temporary(t),entries=Array.from({length:41},(_,i)=>entry(String(i))),p=new InstallProgress();p.begin('parallel');p.phase('game','下载游戏资源',3,entries);
  let started=0,inFlight=0,peak=0,release,full;const gate=new Promise(r=>release=r),filled=new Promise(r=>full=r);
  const job=downloadMany(entries,root,{progress:p,fetchImpl:async()=>{inFlight++;peak=Math.max(peak,inFlight);started++;if(started===16)full();await gate;inFlight--;return new Response(body);}});
  await filled;assert.equal(started,16);assert.equal(inFlight,16);release();await job;
  assert.equal(peak,16);assert.equal(started,entries.length);assert.equal(p.state().completedFiles,entries.length);assert.equal(p.state().completedBytes,entries.length*body.length);assert.equal(p.state().percent,100);
  for(const item of entries)assert.deepEqual(await readFile(path.join(root,item.path)),body);
});

test('local PCL assets, libraries and isolated mods are copied only after content verification, then cached',async t=>{
  const root=await temporary(t),pcl=root+'/PCL/.minecraft',isolated=pcl+'/versions/pack',target=root+'/new',cache=root+'/cache';
  const files=[entry('local'),{...entry('library'),path:'libraries/test/a.jar'},{...entry('mod'),path:'mods/a.jar'}];
  for(const item of files)await put(item.path.startsWith('mods/')?isolated:pcl,item.path,body);
  const localFiles=localResourceFiles([pcl,isolated,pcl]),progress=new InstallProgress();progress.begin('local');progress.phase('game','复用',3,files);
  let calls=0;const fetchImpl=async()=>{calls++;return new Response(body);};
  await downloadMany(files,target,{localFiles,cacheDir:cache,progress,fetchImpl});assert.equal(calls,0);assert.equal(progress.state().reusedFiles,3);assert.equal(progress.state().reusedBytes,body.length*3);
  // Copying does not link or modify PCL content.
  await writeFile(path.join(target,files[0].path),'changed');assert.deepEqual(await readFile(path.join(pcl,files[0].path)),body);
  await rm(pcl,{recursive:true});await downloadMany(files,root+'/other',{cacheDir:cache,fetchImpl});assert.equal(calls,0);
});

test('corrupt local files and cache are rejected even when their sizes match, without trusting unhashed PCL files',async t=>{
  const root=await temporary(t),file=entry('corrupt'),bad=Buffer.alloc(body.length,1),cache=root+'/cache';await put(root+'/pcl',file.path,bad);await put(cache,'sha1/'+sha(body),bad);
  let calls=0;const options={cacheDir:cache,localFiles:localResourceFiles([root+'/pcl']),fetchImpl:async()=>{calls++;return new Response(body);}};
  await downloadFile(file,root+'/new/a',options);assert.equal(calls,1);assert.deepEqual(await readFile(root+'/new/a'),body);assert.deepEqual(await readFile(cache+'/sha1/'+sha(body)),body);
  await put(root+'/pcl',file.path,body);await downloadFile({...file,hashes:{}},root+'/new/b',options);assert.equal(calls,2);
  assert.equal((await readdir(root+'/new')).some(name=>name.endsWith('.part')),false);
});

test('failure or cancellation aborts in-flight work and never starts the rest of the queue',async t=>{
  const root=await temporary(t),controller=new AbortController();let started=0,filled;const full=new Promise(r=>filled=r);
  const job=downloadMany(Array.from({length:40},(_,i)=>entry(String(i))),root,{signal:controller.signal,fetchImpl:async(_url,{signal})=>{started++;if(started===16)filled();return new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});}});
  await full;controller.abort(Error('test cancellation'));await assert.rejects(job,/test cancellation/);assert.equal(started,16);
  assert.equal((await readdir(root,{recursive:true})).some(name=>name.endsWith('.part')),false);
  await assert.rejects(downloadMany([entry('../escape')],root,{fetchImpl:async()=>{throw Error('must not fetch');}}),/路径/);
});

test('alternative URLs are tried before repeating a stalled or broken source',async t=>{
  const root=await temporary(t),calls=[],file={...entry('fallback'),downloads:['https://resources.download.minecraft.net/bad','https://libraries.minecraft.net/good']};
  await downloadFile(file,root+'/a',{fetchImpl:async url=>{calls.push(url);if(url.endsWith('/bad'))throw Error('unavailable');return new Response(body);}});
  assert.equal(calls.length,2);assert.ok(calls[1].endsWith('/good'));
});

test('incremental progress handles retries, unknown sizes, interleaving and repeated completion without double counts',()=>{
  let now=0;const p=new InstallProgress(()=>{},()=>now);p.begin('counters');p.phase('game','download',3,[{path:'a',size:10},{path:'b'}]);
  p.update('a',5,10,{networkBytes:5});p.update('b',3,20,{networkBytes:3});assert.equal(p.state().totalBytes,30);assert.equal(p.state().completedBytes,8);
  p.update('a',0,10);assert.equal(p.state().completedBytes,3);now=2000;p.update('b',20,20,{done:true,reused:true});p.update('a',10,10,{done:true});p.update('a',10,10,{done:true});
  assert.equal(p.state().completedFiles,2);assert.equal(p.state().completedBytes,30);assert.equal(p.state().reusedFiles,1);assert.equal(p.state().reusedBytes,20);assert.equal(p.state().percent,100);
  p.phase('mods','next',5,[]);assert.equal(p.state().reusedFiles,0);p.update('dynamic',4,4,{done:true});assert.equal(p.state().completedFiles,1);assert.equal(p.state().totalBytes,4);
});

test('a PCL merged-version client JAR can be reused by digest despite its different file name',async t=>{
  const root=await temporary(t),pcl=root+'/PCL/.minecraft/versions/DeceasedCraft',file={...entry('client'),path:'versions/1.20.1/1.20.1.jar'};await put(pcl,'DeceasedCraft.jar',body);
  let calls=0;await downloadFile(file,root+'/new/client.jar',{localFiles:localResourceFiles([pcl]),fetchImpl:async()=>{calls++;return new Response(body);}});
  assert.equal(calls,0);assert.deepEqual(await readFile(root+'/new/client.jar'),body);
});
