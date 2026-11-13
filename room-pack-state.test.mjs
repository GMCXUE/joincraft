import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=(await readFile(new URL('./public/room-packs.js',import.meta.url),'utf8')).replace("import {renderInstallProgress,formatBytes} from './pack-progress.js';","const renderInstallProgress=(_container,state)=>globalThis.__packRender?.(state);const formatBytes=String;");
const {createRoomPacksUI}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t){
 const old={window:globalThis.window,document:globalThis.document,render:globalThis.__packRender},requests=[],initial=deferred(),frames=[],toasts=[];let callback,refreshes=0;
 const room={id:'room-a',pack:{sha512:'a'.repeat(128),name:'测试整合包',minecraft:'1.20.1',loader:'Forge',versionId:'1'}};
 globalThis.window={joincraftPacks:{progress:()=>initial.promise,onEvent:fn=>callback=fn,status:()=>{const value=deferred();requests.push(value);return value.promise;}}};
 globalThis.document={querySelector:()=>null,querySelectorAll:()=>[]};globalThis.__packRender=state=>frames.push({...state});
 t.after(()=>{globalThis.window=old.window;globalThis.document=old.document;globalThis.__packRender=old.render;});
 const ui=createRoomPacksUI({api:()=>{},escape:String,icon:()=>'',smallDialog:()=>{},refresh:async()=>{refreshes++;},toast:message=>toasts.push(message),getRoom:()=>room});
 return {ui,room,requests,initial,frames,toasts,emit:value=>callback(value),refreshes:()=>refreshes};
}
test('a stale pre-install check cannot replace the new completed instance status',async t=>{
 const f=fixture(t),old=f.ui.sync(f.room);assert.equal(f.requests.length,1);
 f.emit({state:'done',operation:'install'});assert.equal(f.requests.length,2);f.requests[1].resolve({status:'ready'});await tick();
 assert.match(f.ui.panel(f.room),/已安装 · 保存在本机游戏库/);f.requests[0].resolve({status:'changed',reason:'pack-file'});await old;
 assert.match(f.ui.panel(f.room),/已安装 · 保存在本机游戏库/);assert.doesNotMatch(f.ui.panel(f.room),/模组或脚本与房间版本不同/);
});
test('download completion does not invalidate an already checked local installation',async t=>{
 const f=fixture(t),pending=f.ui.sync(f.room);f.requests[0].resolve({status:'ready'});await pending;
 f.emit({state:'done',operation:'download'});assert.equal(f.requests.length,1);assert.match(f.ui.panel(f.room),/已安装/);
});
test('a late initial progress read cannot overwrite a newer cancellation event',async t=>{
 const f=fixture(t);f.emit({state:'cancelling',operation:'install',phase:'inspect'});f.initial.resolve({state:'installing',phase:'inspect'});await tick();assert.equal(f.frames.at(-1).state,'cancelling');assert.equal(f.requests.length,0);
});
test('a failed local check can retry without being mislabeled as an uninstalled pack',async t=>{
 const f=fixture(t),pending=f.ui.sync(f.room);f.requests[0].reject(Error('temporary read failure'));await pending;
 assert.match(f.ui.panel(f.room),/本地检查失败，请重试/);assert.match(f.ui.panel(f.room),/data-action="pack-check"/);assert.doesNotMatch(f.ui.panel(f.room),/尚未安装到本机/);
 const retry=f.ui.handle('pack-check',null,f.room);assert.equal(f.requests.length,2);f.requests[1].resolve({status:'ready'});await retry;assert.match(f.ui.panel(f.room),/已安装/);
});
test('room status explains a damaged runtime separately from modified code',async t=>{
 const f=fixture(t),pending=f.ui.sync(f.room);f.requests[0].resolve({status:'changed',reason:'runtime'});await pending;assert.match(f.ui.panel(f.room),/游戏文件缺失或损坏/);assert.doesNotMatch(f.ui.panel(f.room),/模组或脚本与房间版本不同/);
});
