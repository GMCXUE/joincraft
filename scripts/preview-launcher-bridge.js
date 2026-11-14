// Isolated UI fixture. No files are installed and no real game or room is opened.
(()=>{
 const listeners=[],emit=e=>listeners.forEach(fn=>fn(e)),root='D:\\Joincraft',id='managed-demo',now=Date.now();
 const scenario=new URLSearchParams(location.search).get('scenario')||'host';
 const instance={id,managed:true,root:root+'\\instances\\demo\\.minecraft',version:'forge-1.20.1',name:'香草纪元：食旅纪行',minecraft:'1.20.1',loader:'Forge',javaMajor:17,isolation:{mode:'shared'}};
 const instances=[instance,{...instance,id:'vanilla-demo',name:'原版生存',loader:'原版',root:root+'\\instances\\vanilla\\.minecraft'},{...instance,id:'creative-demo',name:'建筑工坊',loader:'Fabric',root:root+'\\instances\\creative\\.minecraft'}];
 const java={path:'C:\\Program Files\\Java\\jdk-17\\bin\\java.exe',major:17,version:'17.0.21',arch:'x64'};
 let play={context:['local','empty'].includes(scenario)?null:{roomId:'11111111-1111-4111-8111-111111111111',roomName:'周末建筑队',instanceId:id,role:scenario==='guest'?'guest':'host',port:25565},progress:{phase:'selected',message:'选择存档后开房'}},runs=[],generation=0;
 const delay=ms=>new Promise(r=>setTimeout(r,ms)),set=(phase,message)=>{play.progress={phase,message};emit({type:'game-play',...play});};
 const run=(id,state,message)=>{const value={id,state,memoryMB:8192,message};runs=[...runs.filter(r=>r.id!==id),value];emit({type:'run',...value});};
 const memory=()=>({totalMB:16384,availableMB:8192,usedMB:8192,recommendedMB:8192,maxMB:16384,lowMemory:false,sampledAt:Date.now()});
 window.blockroomLauncher={
  state:async()=>({root,managedRoot:root,selectedInstance:id,instances:scenario==='empty'?[]:instances,javaPath:java.path,javaInstallations:[java],arch:'x64',account:{configured:false},runs,memory:memory(),play}),
  memory:async()=>memory(),scanJava:async()=>{await delay(450);return [java];},selectJava:async()=>java,pickJava:async()=>java,installState:async()=>({state:'idle'}),
  worlds:async()=>{await delay(600);return {worlds:[{id:'world-one',name:'山谷里的新家',folder:'山谷里的新家',readable:true,version:'1.20.1',dataVersion:3465,gameMode:0,lastPlayed:now-3600000,icon:'/home/camp-v2.webp'},{id:'world-two',name:'周末建筑 · 创造',folder:'Building world',readable:true,version:'1.20.1',dataVersion:3465,gameMode:1,lastPlayed:now-86400000},{id:'world-old',name:'旧世界备份',readable:false,version:'1.20.1',dataVersion:3465,gameMode:0,warning:'主信息损坏，显示备份信息',lastPlayed:now-86400000*8}],truncated:false};},
  check:async()=>{await delay(1000);return {files:2468,accountReady:true,gamePath:instance.root};},
  start:async input=>{
   if(!/^[A-Za-z0-9_]{3,16}$/.test(input.name))throw Error('请输入玩家名');const current=++generation;
   if(play.context?.role==='guest'){set('connecting','模拟：正在连接房主');await delay(900);}
   if(play.context)set('launching','模拟：正在启动游戏');run(input.id,'checking','模拟：检查游戏文件');await delay(500);run(input.id,'starting','模拟：创建游戏进程');await delay(600);run(input.id,'running','模拟：游戏进程已创建');
   if(!play.context)return {started:true};
   if(play.context.role==='guest'){set('online','模拟：已连接房间，等待游戏进入');return {started:true};}
   set('world-loading','模拟：等待世界载入并开放端口');
   void (async()=>{await delay(1800);if(current!==generation)return;set('checking','模拟：正在确认世界端口');await delay(700);if(current!==generation)return;if(scenario==='failure'){set('failed','模拟：世界端口未就绪，请重试');return;}set('connecting','模拟：正在建立联机连接');await delay(1000);if(current!==generation)return;set('online','模拟：开房成功，未启动真实游戏');})();return {started:true};
  },
  stopPlay:async()=>{generation++;set('stopped','模拟：联机已停止，游戏保持运行');},clearPlay:async()=>{play={context:null,progress:{phase:'idle'}};emit({type:'game-play',...play});},rooms:async()=>{},onEvent:fn=>{listeners.push(fn);return()=>listeners.splice(listeners.indexOf(fn),1);},
  importPack:async()=>{throw Error('界面模拟不安装文件');},pickInstallRoot:async()=>root
 };
 window.joincraftNotifications={state:async()=>({phase:'idle'}),claim:async()=>null,onEvent:()=>()=>{}};
 document.addEventListener('DOMContentLoaded',()=>{const note=document.querySelector('#web-note');note.hidden=false;note.textContent='界面模拟 · 不启动游戏、不建立线上连接';});
})();
