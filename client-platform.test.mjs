import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlayUI,isDesktopClient,connectionLabel} from './public/play.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function ui(desktop,overrides={}){return createPlayUI({desktop:()=>desktop,escape,icon:name=>`<svg data-icon="${name}"></svg>`,api:()=>assert.fail('Unexpected game request'),smallDialog:()=>assert.fail('Unexpected native setup dialog'),formHandler:()=>{},refresh:()=>{},toast:()=>{},getVersion:()=>0,...overrides});}

test('native game tools require the exposed desktop bridge capability',()=>{
 assert.equal(isDesktopClient(),false);assert.equal(isDesktopClient({}),false);assert.equal(isDesktopClient({openLibrary:true}),false);assert.equal(isDesktopClient({openLibrary(){}}),true);
});
test('web room guidance does not expose native game actions or local connection addresses',()=>{
 const play=ui(false),html=play.panel({id:'room',isHost:true,connection:{status:'online',port:51234,local:{status:'ready',address:'127.0.0.1:45678'}}});
 assert.match(html,/href="\/downloads\/client\/windows"/);assert.match(html,/Windows x64/);
 assert.doesNotMatch(html,/data-action="play-|127\.0\.0\.1|51234|joincraft-bridge|Node\.js/);
 assert.equal(html,play.requiredPanel());
});
test('web stale or direct play actions lead to download without issuing game requests',async()=>{
 let downloads=0;const play=ui(false,{download:()=>downloads++});
 for(const action of ['play-start','play-connect','play-stop','play-disconnect','play-copy-command'])await play.handle(action,{}, {id:'room',isHost:true});
 assert.equal(downloads,5);
});
test('native hosts retain start/stop and native members retain their local game address',()=>{
 const play=ui(true);
 assert.match(play.panel({isHost:true,connection:{status:'offline'}}),/data-action="play-start"/);
 assert.match(play.panel({isHost:true,connection:{status:'online'}}),/data-action="play-stop"/);
 const member=play.panel({isHost:false,connection:{status:'online',local:{status:'ready',address:'127.0.0.1:45678'}}});
 assert.match(member,/127\.0\.0\.1:45678/);assert.match(member,/data-action="play-disconnect"/);assert.doesNotMatch(member,/client-required|downloads\/client/);
});

test('new native flow selects the room without commands, dialogs or browser game tickets',async()=>{
 const selected=[];const play=ui(true,{native:{version:1,select:async value=>selected.push(value)},getSession:()=> 'simulation-session'});const target={disabled:false},room={id:'owned-room',isHost:true};
 await play.handle('play-start',target,room);await play.handle('play-connect',target,room);assert.deepEqual(selected,[{roomId:room.id,token:'simulation-session'},{roomId:room.id,token:'simulation-session'}]);assert.equal(target.disabled,false);assert.match(play.panel({...room,connection:{status:'offline'}}),/选择存档并开房/);
 const member=play.panel({isHost:false,connection:{status:'online',local:{status:'ready',address:'127.0.0.1:45678'}}});assert.match(member,/游戏连接已就绪/);assert.doesNotMatch(member,/127\.0\.0\.1|本机连接地址|Node\.js/);
});
test('native stop is scoped to the selected room before revoking its server transport',async()=>{
 const calls=[];const play=ui(true,{native:{version:1,stop:async value=>calls.push(value)},api:async route=>calls.push(route)});await play.handle('play-stop',{disabled:false},{id:'room-a',isHost:true});assert.deepEqual(calls,[{roomId:'room-a'},'/api/rooms/room-a/play/stop']);
});

test('native room panels identify real direct/relay routes and omit invented latency',()=>{
 const play=ui(true,{native:{version:1}}),direct=play.panel({isHost:false,connection:{status:'online',local:{status:'ready',transport:'p2p',latency:25}}});
 assert.match(direct,/P2P 直连 · 25 ms/);assert.doesNotMatch(direct,/127\.0\.0\.1/);
 assert.equal(connectionLabel({transport:'checking'}),'正在尝试直连…');
 assert.equal(connectionLabel({transport:'relay',latency:25}),'服务器中继');assert.equal(connectionLabel({transport:'p2p',latency:null}),'P2P 直连');assert.equal(connectionLabel({transport:'p2p',latency:Infinity}),'P2P 直连');
 assert.match(play.panel({isHost:true,connection:{status:'online',routes:{direct:2,relay:1}}}),/直连 2 · 中继 1/);
 assert.doesNotMatch(ui(false).panel({connection:{local:{transport:'p2p',latency:25}}}),/P2P|25 ms/);
});
