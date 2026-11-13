import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {loaderProgress} from './launcher/loader-progress.mjs';
import {InstallProgress} from './launcher/install-progress.mjs';
async function fixture(t){const root=await mkdtemp(path.join(tmpdir(),'joincraft-loader-progress-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
test('loader progress counts real files, bytes and speed without repeated parent totals',async t=>{
  const root=await fixture(t),a=path.join(root,'a.jar'),b=path.join(root,'b.jar');await writeFile(a,'1234');await writeFile(b,'123456');let clock=0;
  const progress=new InstallProgress(()=>{},()=>clock),observer=loaderProgress(progress);progress.begin('fixture');
  const task={options:[{destination:a},{destination:b}],progresses:[0,0],totals:[0,0]};observer.onStart(task);
  task.progresses=[2,0];task.totals=[4,6];observer.onUpdate(task,2);clock=2000;
  task.progresses=[4,3];observer.onUpdate(task,5);
  assert.equal(progress.state().completedBytes,7);assert.equal(progress.state().totalBytes,10);assert.equal(progress.state().percent,70);assert(progress.state().speedBps>0);assert(progress.state().etaSeconds>0);
  observer.onUpdate({name:'parent',progress:7,total:10},5);assert.equal(progress.state().completedBytes,7);
  task.onFinished(0);assert.equal(progress.state().completedFiles,1);task.progresses[1]=6;observer.onUpdate(task,3);task.onFinished(1);observer.onSucceed(task);
  assert.equal(progress.state().completedFiles,2);assert.equal(progress.state().totalFiles,2);assert.equal(progress.state().completedBytes,10);assert.equal(progress.state().percent,100);
});
test('already verified loader files count as reused without invented network traffic',async t=>{
  const root=await fixture(t),destination=path.join(root,'cached.jar');await writeFile(destination,'cached bytes');const progress=new InstallProgress(),observer=loaderProgress(progress),task={options:[{destination}],progresses:[0],totals:[0]};progress.begin('fixture');observer.onStart(task);task.onFinished(0);observer.onSucceed(task);
  assert.equal(progress.state().completedFiles,1);assert.equal(progress.state().reusedFiles,1);assert.equal(progress.state().reusedBytes,12);assert.equal(progress.state().speedBps,0);
});
test('same artifact basenames in different library coordinates remain separate files',async t=>{
  const root=await fixture(t),files=['com/example/a/tool/1/tool.jar','net/example/a/tool/1/tool.jar'];const options=[];
  for(const relative of files){const destination=path.join(root,'libraries',relative);await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,'bytes');options.push({destination});}
  const progress=new InstallProgress(),observer=loaderProgress(progress),task={options,progresses:[0,0],totals:[0,0]};progress.begin('fixture');observer.onStart(task);task.onFinished(0);task.onFinished(1);
  assert.equal(progress.state().totalFiles,2);assert.equal(progress.state().completedFiles,2);assert.equal(progress.state().completedBytes,10);
});
test('Java processor work is a separate non-download phase',()=>{
  const progress=new InstallProgress(),observer=loaderProgress(progress);progress.begin('fixture');observer.onStart({name:'postProcessing',total:3});observer.onUpdate({name:'postProcessing',progress:1,total:3},1);
  assert.equal(progress.state().phase,'loader-process');assert.equal(progress.state().file,'处理器 1 / 3');assert.equal(progress.state().totalFiles,0);assert.equal(progress.state().speedBps,0);
});
