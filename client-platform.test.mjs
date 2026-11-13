import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlayUI,isDesktopClient} from './public/play.js';
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
