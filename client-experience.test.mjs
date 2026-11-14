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
