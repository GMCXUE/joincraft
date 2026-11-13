import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {forgeFixture} from './scripts/fixtures/forge-fixture.mjs';
import {loaderInstallTask,loaderErrorMessage,loaderErrorFile} from './launcher/installer-compat.mjs';
import {ManagedPacks} from './launcher/pack-installer.mjs';
function runner(f){const events=[],manager=new ManagedPacks({root:f.root,notify:event=>events.push(event)});manager.progress.begin('Forge fixture');manager.progress.phase('loader','安装加载器',4);const controller=new AbortController();return {manager,controller,events,context:{signal:controller.signal,progress:manager.progress}};}
function task(f,manager){return loaderInstallTask(f.pack,f.root,{java:'fixture-java',spawn:()=>{throw Error('fixture must never execute Java');},mavenHost:f.origin,dispatcher:f.dispatcher,onFile:file=>manager?.progress.detail(file)});}
for(const loaderKey of ['forge','neoforge'])test(loaderKey+' transfers a valid installer over HTTP, extracts its actual profile and creates the version without the legacy instanceof error',async t=>{
  const f=await forgeFixture({loaderKey});t.after(f.close);const {manager,context,events}=runner(f),id=await manager.runTask(task(f,manager),context);
  assert.equal(id,f.id);assert.equal(JSON.parse(await readFile(path.join(f.root,'versions',id,id+'.json'),'utf8')).inheritsFrom,f.pack.minecraft);assert.ok(events.some(event=>event.file?.includes('installer.jar')));assert.ok(f.requests.some(request=>request.method==='GET'));
});
test('Forge connection failure produces a retryable message instead of masking it with a JavaScript type error',async t=>{
  const f=await forgeFixture({mode:'reset'});t.after(f.close);const {manager,context}=runner(f);
  await assert.rejects(manager.runTask(task(f,manager),context),error=>{assert.match(error.message,/连接中断/);assert.doesNotMatch(error.message,/instanceof/);assert.ok(error.cause);return true;});
});
test('Forge failed HTTP responses preserve status and never become installable ZIP files',async t=>{
  const f=await forgeFixture({mode:'http-error'});t.after(f.close);const {manager,context}=runner(f);
  await assert.rejects(manager.runTask(task(f,manager),context),/HTTP 503/);
});
test('cancelling a real Forge HTTP transfer aborts the task without an uncaught exception',async t=>{
  const f=await forgeFixture({mode:'pending'});t.after(f.close);const {manager,controller,context}=runner(f),job=manager.runTask(task(f,manager),context);
  const rejected=assert.rejects(job,/安装已取消/);await f.entered;controller.abort(Error('安装已取消'));await rejected;
});

test('Forge redirects reach the installer while failed final statuses remain guarded',async t=>{
  const f=await forgeFixture({mode:'redirect'});t.after(f.close);const {manager,context}=runner(f);assert.equal(await manager.runTask(task(f,manager),context),f.id);assert.ok(f.requests.some(request=>request.path==='/artifact.jar'));
});


test('a Forge tool dependency retries two interrupted source connections before considering any fallback',async t=>{
  const f=await forgeFixture({mode:'flaky-library',library:true});t.after(f.close);const {manager,context,events}=runner(f);
  assert.equal(await manager.runTask(task(f,manager),context),f.id);
  assert.equal(f.requests.filter(request=>request.path===f.libraryPath).length,3);assert.deepEqual(f.blocked,[]);
  assert.ok(events.some(event=>event.file?.includes('ForgeAutoRenamingTool-0.1.22-all.jar')));
});

test('a failed dependency updates the current file and preserves its HTTP cause',async t=>{
  const f=await forgeFixture({mode:'library-503',library:true});t.after(f.close);const {manager,context}=runner(f);
  await assert.rejects(manager.runTask(task(f,manager),context),/ForgeAutoRenamingTool-0\.1\.22-all\.jar.*HTTP 503/);
  assert.equal(manager.progress.state().file,'ForgeAutoRenamingTool-0.1.22-all.jar');
});

test('a Maven Central 404 cannot hide the primary Forge connection failure or the actual file name',()=>{
  const destination='C:\\Joincraft\\libraries\\ForgeAutoRenamingTool-0.1.22-all.jar';
  const primary=Object.assign(Error('TLS connection reset'),{code:'ECONNRESET',url:'https://maven.minecraftforge.net/tool.jar',destination});
  const empty=Object.assign(Error('empty file'),{name:'ChecksumNotMatchError',destination});
  const fallback=Object.assign(Error('not found'),{statusCode:404,url:'https://repo1.maven.org/tool.jar',destination});
  const failure=new AggregateError([primary,empty,fallback,empty]);
  assert.match(loaderErrorMessage(failure),/连接中断/);assert.doesNotMatch(loaderErrorMessage(failure),/404/);assert.equal(loaderErrorFile(failure),'ForgeAutoRenamingTool-0.1.22-all.jar');
  assert.match(loaderErrorMessage(new AggregateError([fallback,primary])),/HTTP 404/);
});


test('Forge installer and pinned tool dependencies use the configured VPS gateway over real HTTP',async t=>{
  const f=await forgeFixture({library:true});t.after(f.close);const {manager,context}=runner(f);
  const install=loaderInstallTask(f.pack,f.root,{gatewayOrigin:f.origin,dispatcher:f.dispatcher,java:'fixture-java',spawn:()=>{throw Error('fixture must never execute Java');}});
  assert.equal(await manager.runTask(install,context),f.id);
  assert.ok(f.requests.some(r=>r.path.startsWith('/game-downloads/forge/')&&r.path.endsWith('installer.jar')));
  assert.ok(f.requests.some(r=>r.path==='/game-downloads/forge'+f.libraryPath));
  assert.deepEqual(f.blocked,[],'a working cache never contacts an external origin');
});


test('real Forge dependency progress marks completed files and does not count parent byte events twice',async t=>{
  const f=await forgeFixture({library:true});t.after(f.close);const {manager,context,events}=runner(f);
  assert.equal(await manager.runTask(task(f,manager),context),f.id);
  const finished=events.findLast(event=>event.phase==='loader-download'&&event.completedFiles===1&&event.file.includes('ForgeAutoRenamingTool'));
  assert.ok(finished);assert.equal(finished.totalFiles,1);assert.equal(finished.completedBytes,finished.totalBytes);assert.equal(finished.percent,100);
  assert.ok(events.filter(event=>event.phase==='loader-download'&&event.totalFiles===1).every(event=>event.completedBytes<=event.totalBytes||event.totalBytes===null));
});
