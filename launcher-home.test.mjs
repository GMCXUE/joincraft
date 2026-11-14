import test from 'node:test';
import assert from 'node:assert/strict';
import {LauncherHome} from './desktop/home.mjs';
function fixture(){
 const calls=[],library=new Map([['one',{id:'one',managed:true,name:'香草纪元',minecraft:'1.20.1',loader:'Forge',root:'PRIVATE',javaPath:'JAVA'}],['external',{id:'external',root:'OUTSIDE'}]]),prefs={managedLaunchInputs:{one:{accountMode:'offline',name:'Builder',memoryMode:'auto',memoryMB:4096,worldId:'SECRET'}}};
 let selected=null,run=[],gate=null;
 const launcher={javaPath:null,states:()=>run,start:async input=>{calls.push(['start',input]);if(gate)await gate;}};
 const gamePlay={active:false,context:null,clear(){calls.push(['clear']);this.context=null;}};
 const home=new LauncherHome({library,prefs,launcher,gamePlay,account:{summary:()=>({configured:true,profile:null,identity:{accessToken:'SECRET'}})},getSelected:()=>selected,setSelected:id=>selected=id,save:async()=>{},packBusy:()=>false,assertCanLaunch:()=>{},changed:()=>{},openSettings:async input=>calls.push(['settings',input])});
 return {home,prefs,library,launcher,gamePlay,calls,setRun:value=>run=value,setGate:value=>gate=value};
}
test('home exposes only owned instances and a path/credential free account summary',()=>{
 const {home}=fixture(),state=home.state();assert.equal(state.selectedId,'one');assert.equal(state.instances.length,1);assert.equal(state.account.name,'Builder');assert.equal(state.account.ready,true);assert(!/PRIVATE|JAVA|SECRET|OUTSIDE|accessToken|worldId/.test(JSON.stringify(state)));
});
test('unknown IDs and remote supplied paths cannot select, launch or configure local files',async()=>{
 const {home,calls}=fixture();for(const id of ['external','../../one',null])for(const action of ['select','start'])await assert.rejects(home[action]({id}),/Joincraft/);await assert.rejects(home.configure({id:'external'}));await assert.rejects(home.configure({accountMode:'other'}));assert.equal(calls.length,0);
});
test('home starts the selected installed pack at the game menu and serializes duplicate clicks',async()=>{
 const f=fixture();let finish;f.setGate(new Promise(resolve=>finish=resolve));f.gamePlay.context={role:'host'};
 const launch=f.home.start({id:'one',worldId:'injected',name:'injected'});await assert.rejects(f.home.start({id:'one'}),/任务/);assert.equal(f.home.state().busy,true);finish();assert.deepEqual(await launch,{started:true});assert.equal(f.launcher.javaPath,'JAVA');assert.equal(f.calls[0][0],'clear');assert.equal(f.calls[1][1].name,'Builder');assert.equal(f.calls[1][1].id,'one');assert.equal(f.calls[1][1].worldId,undefined);
 // Stored inputs are normalized by remember; hosted inputs never become launch arguments.
 assert.equal(f.calls[1][1].name,'Builder');assert.equal(f.home.state().busy,false);
});
test('missing game identity opens existing settings without launching or creating a second window',async()=>{
 const f=fixture();delete f.prefs.managedLaunchInputs.one;assert.deepEqual(await f.home.start({id:'one'}),{needsSetup:true});assert.deepEqual(f.calls,[['settings',{id:'one',accountMode:undefined}]]);
 f.setRun([{id:'one',state:'running'}]);await assert.rejects(f.home.select({id:'one'}),/任务/);await assert.rejects(f.home.start({id:'one'}),/任务/);
});
test('settings return saves a bounded launch input and rolls back persistence failures',async()=>{
 const f=fixture();await f.home.remember({id:'one',accountMode:'offline',name:'NewName',memoryMode:'auto',worldId:'ignored',root:'ignored',accessToken:'ignored'});assert.equal(f.home.state().account.name,'NewName');assert(!/ignored|worldId|root|accessToken/.test(JSON.stringify(f.prefs)));
 const previous=JSON.stringify(f.prefs);f.home.save=async()=>{throw Error('disk full');};await assert.rejects(f.home.remember({id:'one',accountMode:'offline',name:'Changed',memoryMode:'custom',memoryMB:2048}),/disk full/);assert.equal(JSON.stringify(f.prefs),previous);await assert.rejects(f.home.remember({id:'one',accountMode:'offline',name:'X',memoryMode:'custom',memoryMB:-1}),/无效/);
});

test('failed launches release the click lock and keep a recoverable failure',async()=>{const f=fixture();let count=0;f.launcher.start=async()=>{count++;throw Error('missing files');};await assert.rejects(f.home.start({id:'one'}),/missing files/);assert.equal(f.home.state().busy,false);await assert.rejects(f.home.start({id:'one'}),/missing files/);assert.equal(count,2);});

test('return navigation shows home before saving and never traps invalid or failed settings',async()=>{
 const {returnToHome}=await import('./desktop/home.mjs');const calls=[];let finish;
 const returnResult=returnToHome({showHome:()=>calls.push('home'),remember:async()=>{calls.push('save');await new Promise(resolve=>finish=resolve);throw Error('invalid configuration');},onSaveError:()=>calls.push('notice')},{id:'one'});
 assert.deepEqual(calls,['home','save']);finish();assert.deepEqual(await returnResult,{returned:true,settingsSaved:false});assert.deepEqual(calls,['home','save','notice']);
 const {createLibraryReturn}=await import('./public/launcher/navigation.js');let returned=0;
 await createLibraryReturn({api:{returnHome:async input=>{assert.equal(input,undefined);returned++;}},read:()=>{throw Error('incomplete form');}})();assert.equal(returned,1);
 let release;const back=createLibraryReturn({api:{returnHome:async()=>{returned++;await new Promise(resolve=>release=resolve);}},read:()=>({})});const pending=back();await back();assert.equal(returned,2);release();await pending;
});


test('home honors each instance Java selection without exposing paths to the hosted page',async()=>{
 const f=fixture();f.launcher.javaPath='CUSTOM_JAVA';await f.home.remember({id:'one',accountMode:'offline',name:'Builder',memoryMode:'auto'});assert.equal(f.prefs.managedJavaPaths.one,'CUSTOM_JAVA');f.launcher.javaPath='OTHER_JAVA';await f.home.start({id:'one'});assert.equal(f.launcher.javaPath,'CUSTOM_JAVA');assert(!JSON.stringify(f.home.state()).includes('CUSTOM_JAVA'));
 const previous=JSON.stringify(f.prefs);f.launcher.javaPath='CHANGED_JAVA';f.home.save=async()=>{throw Error('disk full');};await assert.rejects(f.home.remember({id:'one',accountMode:'offline',name:'Builder',memoryMode:'auto'}));assert.equal(JSON.stringify(f.prefs),previous);
});
