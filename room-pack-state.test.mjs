import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=(await readFile(new URL('./public/room-packs.js',import.meta.url),'utf8')).replace("import {renderInstallProgress,formatBytes} from './pack-progress.js';","const renderInstallProgress=(_container,state)=>globalThis.__packRender?.(state);const formatBytes=String;");
const {createRoomPacksUI}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t,{integratedPlay=false}={}){
 const old={window:globalThis.window,document:globalThis.document,render:globalThis.__packRender},requests=[],initial=deferred(),frames=[],toasts=[];let callback,refreshes=0;
 const room={id:'room-a',pack:{sha512:'a'.repeat(128),name:'测试整合包',minecraft:'1.20.1',loader:'Forge',versionId:'1'}};
 globalThis.window={...(integratedPlay?{joincraftPlay:{version:1}}:{}),joincraftPacks:{progress:()=>initial.promise,onEvent:fn=>callback=fn,status:()=>{const value=deferred();requests.push(value);return value.promise;}}};
 globalThis.document={querySelector:()=>null,querySelectorAll:()=>[]};globalThis.__packRender=state=>frames.push({...state});
 t.after(()=>{globalThis.window=old.window;globalThis.document=old.document;globalThis.__packRender=old.render;});
 const ui=createRoomPacksUI({api:()=>{},escape:String,icon:()=>'',smallDialog:()=>{},refresh:async()=>{refreshes++;},toast:message=>toasts.push(message),getRoom:()=>room});
 return {ui,room,native:globalThis.window.joincraftPacks,requests,initial,frames,toasts,emit:value=>callback(value),refreshes:()=>refreshes};
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

test('integrated room flow shows installed status inline and gives game entry one primary action',async t=>{
 const f=fixture(t,{integratedPlay:true}),pending=f.ui.sync(f.room);f.requests[0].resolve({status:'ready'});await pending;
 const html=f.ui.panel(f.room);assert.match(html,/房间整合包 · <span role="status">已安装<\/span>/);assert.match(html,/测试整合包/);assert.doesNotMatch(html,/room-pack-bottom|保存在本机游戏库|启动游戏|data-action="pack-start"/);
});
test('integrated room flow installs without launching an unhosted game',async t=>{
 const f=fixture(t,{integratedPlay:true}),calls=[];f.native.transferVersion=2;f.native.installFromRoom=async input=>{calls.push(['install',input.roomId]);};f.native.open=async()=>{calls.push(['open']);return {started:true};};
 const pending=f.ui.handle('pack-start',null,f.room);f.requests[0].resolve({status:'missing'});await pending;
 assert.deepEqual(calls,[['install',f.room.id]]);assert(f.toasts.includes('整合包已安装'));assert.equal(f.refreshes(),1);
});
test('a stale integrated install button refreshes a ready pack without starting it',async t=>{
 const f=fixture(t,{integratedPlay:true});let opened=0;f.native.open=async()=>{opened++;return {started:true};};const pending=f.ui.handle('pack-start',null,f.room);f.requests[0].resolve({status:'ready'});await pending;
 assert.equal(opened,0);assert.equal(f.refreshes(),1);
});
test('integrated room flow keeps install and repair actions for missing and changed packs',async t=>{
 const f=fixture(t,{integratedPlay:true}),pending=f.ui.sync(f.room);f.requests[0].resolve({status:'changed',reason:'extra-mod'});await pending;const html=f.ui.panel(f.room);assert.match(html,/检测到额外模组/);assert.match(html,/安装房间版本/);assert.match(html,/data-action="pack-start"/);
});
test('legacy clients keep their standalone game entry',async t=>{
 const f=fixture(t);let opened=0;f.native.open=async()=>{opened++;return {started:true};};const pending=f.ui.handle('pack-start',null,f.room);f.requests[0].resolve({status:'ready'});await pending;assert.equal(opened,1);assert.match(f.ui.panel(f.room),/启动游戏/);
});
