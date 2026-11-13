import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {forgeFixture} from './scripts/fixtures/forge-fixture.mjs';
import {loaderInstallTask} from './launcher/installer-compat.mjs';
import {ManagedPacks} from './launcher/pack-installer.mjs';
function runner(f){const events=[],manager=new ManagedPacks({root:f.root,notify:event=>events.push(event)});manager.progress.begin('Forge fixture');manager.progress.phase('loader','安装加载器',4);const controller=new AbortController();return {manager,controller,events,context:{signal:controller.signal,progress:manager.progress}};}
function task(f){return loaderInstallTask(f.pack,f.root,{java:'fixture-java',spawn:()=>{throw Error('fixture must never execute Java');},mavenHost:f.origin,dispatcher:f.dispatcher});}
for(const loaderKey of ['forge','neoforge'])test(loaderKey+' transfers a valid installer over HTTP, extracts its actual profile and creates the version without the legacy instanceof error',async t=>{
  const f=await forgeFixture({loaderKey});t.after(f.close);const {manager,context,events}=runner(f),id=await manager.runTask(task(f),context);
  assert.equal(id,f.id);assert.equal(JSON.parse(await readFile(path.join(f.root,'versions',id,id+'.json'),'utf8')).inheritsFrom,f.pack.minecraft);assert.ok(events.some(event=>event.file?.includes('installer.jar')));assert.ok(f.requests.some(request=>request.method==='GET'));
});
test('Forge connection failure produces a retryable message instead of masking it with a JavaScript type error',async t=>{
  const f=await forgeFixture({mode:'reset'});t.after(f.close);const {manager,context}=runner(f);
  await assert.rejects(manager.runTask(task(f),context),error=>{assert.match(error.message,/连接中断/);assert.doesNotMatch(error.message,/instanceof/);assert.ok(error.cause);return true;});
});
test('Forge failed HTTP responses preserve status and never become installable ZIP files',async t=>{
  const f=await forgeFixture({mode:'http-error'});t.after(f.close);const {manager,context}=runner(f);
  await assert.rejects(manager.runTask(task(f),context),/HTTP 503/);
});
test('cancelling a real Forge HTTP transfer aborts the task without an uncaught exception',async t=>{
  const f=await forgeFixture({mode:'pending'});t.after(f.close);const {manager,controller,context}=runner(f),job=manager.runTask(task(f),context);
  const rejected=assert.rejects(job,/安装已取消/);await f.entered;controller.abort(Error('安装已取消'));await rejected;
});

test('Forge redirects reach the installer while failed final statuses remain guarded',async t=>{
  const f=await forgeFixture({mode:'redirect'});t.after(f.close);const {manager,context}=runner(f);assert.equal(await manager.runTask(task(f),context),f.id);assert.ok(f.requests.some(request=>request.path==='/artifact.jar'));
});
