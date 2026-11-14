// Browser-only fixture. Every game action below is simulated.
(()=>{
 const listeners=[],emit=e=>listeners.forEach(fn=>fn(e)),root='D:\\Joincraft',id='managed-demo';
 const instance={id,managed:true,root:root+'\\instances\\demo\\.minecraft',version:'forge-1.20.1',name:'香草纪元：食旅纪行',minecraft:'1.20.1',loader:'Forge',javaMajor:17,isolation:{mode:'shared'}};
 const java={path:'C:\\Program Files\\Java\\jdk-17\\bin\\java.exe',major:17,version:'17.0.21',arch:'x64'};
 let play={context:{roomId:'11111111-1111-4111-8111-111111111111',roomName:'周末建筑队',instanceId:id,role:'host',port:25565},progress:{phase:'selected',message:'选择存档后开房'}},runs=[],generation=0;
 const delay=ms=>new Promise(r=>setTimeout(r,ms));const set=(phase,message)=>{play.progress={phase,message};emit({type:'game-play',...play});};
 const memory=()=>({totalMB:16384,availableMB:8192,usedMB:8192,recommendedMB:8192,maxMB:16384,lowMemory:false,sampledAt:Date.now()});
 window.blockroomLauncher={
  state:async()=>({root,managedRoot:root,selectedInstance:id,instances:[instance],javaPath:java.path,javaInstallations:[java],arch:'x64',account:{configured:false},runs,memory:memory(),play}),
  memory:async()=>memory(),scanJava:async()=>[java],selectJava:async()=>java,pickJava:async()=>java,installState:async()=>({state:'idle'}),
  worlds:async()=>{await delay(250);return {worlds:[{id:'world-one',name:'山谷里的新家',folder:'山谷里的新家',readable:true,version:'1.20.1',dataVersion:3465,gameMode:0,lastPlayed:Date.now()-3600000,icon:'/home/world-v1.webp'},{id:'world-two',name:'周末建筑 · 创造',folder:'Building world',readable:true,version:'1.20.1',dataVersion:3465,gameMode:1,lastPlayed:Date.now()-86400000},{id:'world-old',name:'旧世界备份',readable:false,version:'1.20.1',dataVersion:3465,gameMode:0,warning:'主信息损坏，显示备份信息',lastPlayed:Date.now()-86400000*8}],truncated:false};},
  check:async()=>({files:2468,accountReady:true,gamePath:instance.root}),
  start:async input=>{if(!/^[A-Za-z0-9_]{3,16}$/.test(input.name))throw Error('请输入玩家名');const current=++generation;runs=[{id,state:'running',memoryMB:8192,message:'模拟：游戏已启动'}];emit({type:'run',...runs[0]});set('world-loading','模拟：等待世界载入并开放端口');void (async()=>{await delay(1800);if(current!==generation)return;set('connecting','模拟：正在建立联机连接');await delay(1200);if(current!==generation)return;set('online','模拟：开房成功，未启动真实游戏');})();return {started:true};},
  stopPlay:async()=>{generation++;set('stopped','模拟：联机已停止，游戏保持运行');},clearPlay:async()=>{play={context:null,progress:{phase:'idle'}};emit({type:'game-play',...play});},rooms:async()=>{},onEvent:fn=>listeners.push(fn),
  importPack:async()=>{throw Error('界面模拟不安装文件');},pickInstallRoot:async()=>root
 };
 window.joincraftNotifications={state:async()=>({phase:'idle'}),claim:async()=>null,onEvent:()=>()=>{}};
 document.addEventListener('DOMContentLoaded',()=>{const note=document.querySelector('#web-note');note.hidden=false;note.textContent='界面模拟 · 不启动游戏、不建立线上连接';});
})();
