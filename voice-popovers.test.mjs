import test from 'node:test';import assert from 'node:assert/strict';
import {voicePeerFor,placeVoicePanel,voiceProfileHTML} from './public/voice-popovers.js';
import {createApp} from './dist/app.js';
const member={id:'peer',name:'测试朋友',host:true},room={id:'room',members:[member],community:{groups:[{id:'game',name:'游戏'}]}};
const state={profile:{id:'self'},rooms:[room]},snapshot={roomId:'room',groupId:'game',participants:[{userId:'peer',identity:'lease',volume:.4}]};
test('voice profiles and controls require actual membership in the current live channel',()=>{
 assert.equal(voicePeerFor(state,snapshot,'peer','room').peer.volume,.4);
 for(const [s,v,id,r] of [[state,snapshot,'stranger','room'],[state,snapshot,'peer','other'],[state,{...snapshot,participants:[]},'peer','room'],[{...state,rooms:[{...room,closed:true}]},snapshot,'peer','room'],[state,{...snapshot,groupId:'deleted'},'peer','room'],[{...state,rooms:[{...room,members:[]}]},snapshot,'peer','room']])assert.equal(voicePeerFor(s,v,id,r),null);
 assert.equal(voicePeerFor({...state,profile:{id:'peer'}},snapshot,'peer','room').self,true);
});
test('floating panels stay inside narrow viewports and flip away from lower/right edges',()=>{
 assert.deepEqual(placeVoicePanel({left:90,top:500,bottom:540,width:40},{width:112,height:260},{width:1280,height:720},true),{left:54,top:232});
 assert.deepEqual(placeVoicePanel({left:375,top:800,bottom:800,width:0},{width:320,height:350},{width:390,height:844}),{left:62,top:442});
 assert.deepEqual(placeVoicePanel({left:0,top:0,bottom:30,width:20},{width:112,height:260},{width:390,height:844},true),{left:8,top:38});
 const point=placeVoicePanel({left:500,top:100,bottom:130,width:30},{width:320,height:400},{width:280,height:240});assert.equal(point.left,8);assert.equal(point.top,8);
});
test('profile cards escape names, usernames and bios and provide honest guest/empty states',()=>{
 const html=voiceProfileHTML({name:'<script>x</script>',username:'\" onmouseover=\"bad',bio:'<img src=x onerror=bad>'},member);
 assert(!html.includes('<script>'));assert(!html.includes('<img src=x'));assert(html.includes('&lt;script&gt;'));assert(html.includes('&quot;'));assert(html.includes('房主'));
 const guest=voiceProfileHTML({},member);assert(guest.includes('访客玩家'));assert(guest.includes('还没写简介'));
});
test('both voice popover assets are served with the application and the stylesheet is loaded',async()=>{
 const app=await createApp({port:0,dbPath:':memory:'});try{for(const [path,mime] of [['/voice-popovers.js','javascript'],['/voice-popovers.css','css']]){const response=await fetch(app.url+path);assert.equal(response.status,200);assert(response.headers.get('content-type').includes(mime));}assert((await (await fetch(app.url+'/app')).text()).includes('/voice-popovers.css'));}finally{await app.close();}
});
