import test from 'node:test';
import assert from 'node:assert/strict';
import {rankHomeRooms,homeRoomList,homeGameList,homeGuide,appHomeContent,createAppHome} from './public/app-home.js';
const icon=name=>`<svg aria-hidden="true" data-test-icon="${name}"></svg>`;
test('recent rooms prioritize a real local visit, fall back to room activity and omit closed rooms',()=>{
 const rooms=[{id:'old',createdAt:10},{id:'visited',createdAt:2},{id:'active',events:[{at:20}]},{id:'closed',closed:true,createdAt:99}];
 assert.deepEqual(rankHomeRooms(rooms,{visited:30}).map(r=>r.id),['visited','active','old']);assert.equal(rooms[0].id,'old');
});
test('room summaries distinguish membership, app presence and game readiness without invented player counts',()=>{
 const rooms=[{id:'one',name:'<script>room</script>',version:'1.20.1',loader:'Forge',members:[{id:'u',name:'Builder',avatarId:'wolf'}],community:{online:['u'],unread:2},connection:{status:'online',connections:99}}];
 const html=homeRoomList({rooms,icon});assert.match(html,/可以加入游戏/);assert.match(html,/1 位成员 · 1 位房间在线/);assert.match(html,/2 条新消息/);assert(!html.includes('99'));assert(!html.includes('<script>'));assert(html.includes('&lt;script&gt;'));assert.match(html,/#room\/one\/overview/);
 const unset=homeRoomList({rooms:[{id:'two',name:'未开房',loader:'原版'}],icon});assert.match(unset,/尚未开房/);assert.match(unset,/尚未设置游戏环境/);assert.match(homeRoomList({icon}),/还没有加入房间/);
});
test('game summaries expose only explicit selection/settings and the web offers the client download',()=>{
 const summary={instances:[{id:'one'}],selectedId:'one',account:{ready:true}};
 const recent={instances:[{id:'one',name:'<Pack>',minecraft:'1.20.1',loader:'Forge',lastWorld:{name:'<World>',lastPlayed:1700000000000}}]};
 const html=homeGameList({desktop:true,summary,recent,icon});assert.match(html,/&lt;Pack&gt;/);assert.match(html,/&lt;World&gt;/);assert.match(html,/当前选择/);assert(!html.includes('data-action="home-start"'));assert.match(html,/data-action="home-configure" data-id="one"/);
 const web=homeGameList({desktop:false,summary,recent,icon});assert.match(web,/downloads\/client\/windows/);assert(!web.includes('<World>'));assert(!web.includes('home-select'));assert(!web.includes('home-configure'));
 const pending=homeGameList({desktop:true,summary,icon,recentLoading:true});assert.match(pending,/正在读取存档/);assert(!pending.includes('暂无最近存档'));
 const legacy=homeGameList({desktop:true,summary,icon});assert.match(legacy,/在版本设置中查看存档/);assert(!legacy.includes('尚无游玩记录'));
 const empty=homeGameList({desktop:true,summary:{instances:[]},icon});assert.match(empty,/先安装一个整合包/);assert(!empty.includes('上次启动'));
});
test('onboarding reflects genuine readiness and the home has no hero image',()=>{
 const ready=homeGuide({desktop:true,summary:{instances:[{}],account:{ready:true}},rooms:[{}],icon});assert.equal((ready.match(/class="is-complete"/g)||[]).length,3);assert(!ready.includes('去完成'));
 const empty=homeGuide({desktop:true,icon});assert.match(empty,/填写玩家名/);assert.match(appHomeContent({desktop:true,icon}),/319301567/);assert(!appHomeContent({desktop:true,icon}).includes('camp-v2.webp'));
});
test('a game card selects or configures its own instance without starting a game',async()=>{
 const previous=Object.fromEntries(['window','location','document'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));const calls=[];
 try{
  globalThis.location={hash:'#home'};globalThis.document={body:{},activeElement:null,querySelector:()=>null};
  globalThis.window={joincraftHome:{onEvent(){},select:async input=>{calls.push(['select',input]);return {instances:[],selectedId:input.id};},configure:async input=>calls.push(['configure',input]),start:()=>assert.fail('card selection must not launch')}};
  const ui=createAppHome({desktop:true,icon,setHTML(){},smallDialog(){},toast(){},renderShell(){}});
  await ui.action('home-select',{dataset:{id:'second'}});await ui.action('home-configure',{dataset:{id:'third'}});
  assert.deepEqual(calls,[['select',{id:'second'}],['configure',{id:'third',accountMode:undefined}]]);
 }finally{for(const [k,value]of Object.entries(previous))if(value)Object.defineProperty(globalThis,k,value);else delete globalThis[k];}
});

test('card selection confirms the change and returns keyboard focus to the existing launch control',async()=>{
 const previous=Object.fromEntries(['window','location','document'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));let focused=false,notice='';const body={};
 try{
  globalThis.location={hash:'#home'};globalThis.document={body,activeElement:body,querySelector:s=>s==='[data-action="home-start"]'?{focus(){focused=true;}}:null};
  globalThis.window={joincraftHome:{onEvent(){},select:async()=>({instances:[{id:'two'}],selectedId:'two'})}};
  const ui=createAppHome({desktop:true,icon,setHTML(){},smallDialog(){},toast:value=>notice=value,renderShell(){}});
  await ui.action('home-select',{dataset:{id:'two'},closest:()=>({})});assert(focused);assert.match(notice,/已切换整合包/);
 }finally{for(const [k,value]of Object.entries(previous))if(value)Object.defineProperty(globalThis,k,value);else delete globalThis[k];}
});

test('a failed library read releases the home loading state and offers a retry',async()=>{
 const previous=Object.fromEntries(['window','location','document'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));const nodes=new Map();
 const node=s=>{if(!nodes.has(s))nodes.set(s,{html:'',contains:()=>false,setAttribute(k,v){this[k]=v;}});return nodes.get(s);};
 try{
  globalThis.location={hash:'#home'};globalThis.document={body:{},activeElement:null,querySelector:node};
  globalThis.window={joincraftHome:{onEvent(){},state:async()=>{throw Error('本机游戏库不可用');},recent:async()=>assert.fail('no scan after state failure')}};
  const ui=createAppHome({desktop:true,icon,setHTML:(n,h)=>n.html=h,smallDialog(){},toast(){},renderShell(){}});
  ui.show();await new Promise(resolve=>setImmediate(resolve));assert.equal(node('#home-games')['aria-busy'],'false');assert.match(node('#home-games').html,/重新读取/);
 }finally{for(const [k,value]of Object.entries(previous))if(value)Object.defineProperty(globalThis,k,value);else delete globalThis[k];}
});
