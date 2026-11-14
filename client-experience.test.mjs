import test from 'node:test';
import assert from 'node:assert/strict';
import {launchPresentation} from './public/launcher/experience.js';
const host=phase=>launchPresentation({selectedId:'a',run:{state:'running'},play:{context:{instanceId:'a',role:'host'},progress:{phase}}});
test('host launch progress waits for the actual world and relay events before marking completion',()=>{
 for(const [phase,index] of [['launching',0],['world-loading',1],['checking',2],['connecting',3]]){const view=host(phase);assert.equal(view.current,index);assert.equal(view.complete,false);assert.equal(view.busy,true);assert.equal(view.steps.length,4);}
 const ready=host('online');assert.equal(ready.complete,true);assert.equal(ready.busy,false);assert.equal(ready.tone,'online');
});
test('guest progress connects before launching and a different instance ignores stale room progress',()=>{
 const play={context:{instanceId:'a',role:'guest'},progress:{phase:'connecting'}};
 const guest=launchPresentation({selectedId:'a',play});assert.deepEqual(guest.steps,['连接房主','启动游戏']);assert.equal(guest.current,0);
 play.progress.phase='launching';assert.equal(launchPresentation({selectedId:'a',play}).current,1);
 const unrelated=launchPresentation({selectedId:'b',play});assert.equal(unrelated.busy,false);assert.deepEqual(unrelated.steps,[]);assert.equal(unrelated.label,null);
});
test('local launch reports process creation without claiming the game world is ready',()=>{
 const pending=launchPresentation({operation:'launch'});assert.equal(pending.busy,true);assert.equal(pending.complete,false);
 const running=launchPresentation({run:{state:'running'}});assert.deepEqual(running.steps,['检查文件','创建游戏进程']);assert.equal(running.label,'游戏运行中');assert.equal(running.complete,true);
 const failed=host('failed');assert.deepEqual(failed.steps,[]);assert.equal(failed.tone,'error');assert.equal(failed.badge,'启动失败');
 const stopped=host('stopped');assert.equal(stopped.tone,'running');assert.equal(stopped.busy,false);assert.equal(stopped.complete,false);
});

import {createWorldSelection} from './public/launcher/worlds.js';
const world=(id,extra={})=>({id,readable:true,dataVersion:3465,...extra});
test('refresh keeps the chosen world visible and reuses it after new metadata arrives',async()=>{
 let release,delayed=false;const model=createWorldSelection({read:async()=>{if(delayed)await new Promise(resolve=>release=resolve);return {worlds:[world('a'),world('b')]};}});
 await model.load({id:'pack'});assert.equal(model.select('b'),true);delayed=true;const pending=model.load({id:'pack'},{force:true});
 assert.equal(model.state.loading,true);assert.equal(model.state.selected,'b');assert.equal(model.state.worlds.length,2);assert.equal(model.select('a'),false);
 release();await pending;assert.equal(model.state.selected,'b');assert.equal(model.state.loading,false);
});
test('out-of-order world scans cannot replace the currently selected instance',async()=>{
 let release;const model=createWorldSelection({read:async({id})=>id==='old'?new Promise(resolve=>release=resolve):{worlds:[world('current')]}});
 const pending=model.load({id:'old'});await model.load({id:'new'});release({worlds:[world('stale')]});await pending;
 assert.equal(model.state.id,'new');assert.equal(model.state.selected,'current');assert.deepEqual(model.state.worlds.map(w=>w.id),['current']);
});
test('failed refresh retains known worlds; removed or unsupported choices fall back to a usable save',async()=>{
 let result={worlds:[world('a'),world('b')]},failure=false,errors=0;
 const model=createWorldSelection({read:async()=>{if(failure)throw Error('offline');return result;},onError:()=>errors++});
 await model.load({id:'pack'});model.select('b');failure=true;await model.load({id:'pack'},{force:true});assert.equal(errors,1);assert.equal(model.state.selected,'b');assert.equal(model.state.worlds.length,2);
 failure=false;result={worlds:[world('b',{readable:false}),world('future',{dataVersion:9999}),world('a')]};await model.load({id:'pack'},{force:true});assert.equal(model.state.selected,'a');assert.equal(model.select('b'),false);assert.equal(model.select('future'),false);
 model.setLocked(true);assert.equal(model.select('a'),false);
});
test('each instance restores its last usable world when the player returns',async()=>{
 const model=createWorldSelection({read:async()=>({worlds:[world('a'),world('b')]})});await model.load({id:'first'});model.select('b');await model.load({id:'second'});assert.equal(model.state.selected,'a');await model.load({id:'first'});assert.equal(model.state.selected,'b');
});
