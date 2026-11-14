// Isolated UI fixture. No files are installed and no real game or room is opened.
(()=>{
 const listeners=[],emit=e=>listeners.forEach(fn=>fn(e)),root='D:\\Joincraft',id='managed-demo',now=Date.now();
 const scenario=new URLSearchParams(location.search).get('scenario')||'host';
 const instance={id,managed:true,root:root+'\\instances\\demo\\.minecraft',version:'forge-1.20.1',name:'香草纪元：食旅纪行',minecraft:'1.20.1',loader:'Forge',javaMajor:17,isolation:{mode:'shared'}};
 const instances=[instance,{...instance,id:'vanilla-demo',name:'原版生存',loader:'原版',root:root+'\\instances\\vanilla\\.minecraft'},{...instance,id:'creative-demo',name:'建筑工坊',loader:'Fabric',root:root+'\\instances\\creative\\.minecraft'}];
 const java={path:'C:\\Program Files\\Java\\jdk-17\\bin\\java.exe',major:17,version:'17.0.21',arch:'x64'};
 let play={context:['local','empty'].includes(scenario)?null:{roomId:'11111111-1111-4111-8111-111111111111',roomName:'周末建筑队',instanceId:id,role:scenario==='guest'?'guest':'host',port:25565},progress:{phase:'selected',message:scenario==='guest'?'确认启动设置后加入':'选择存档后开房'}},runs=[],generation=0;
 const delay=ms=>new Promise(r=>setTimeout(r,ms)),set=(phase,message)=>{play.progress={phase,message};emit({type:'game-play',...play});};
 const run=(id,state,message)=>{const value={id,state,memoryMB:8192,message};runs=[...runs.filter(r=>r.id!==id),value];emit({type:'run',...value});};
 const memory=()=>({totalMB:16384,availableMB:8192,usedMB:8192,recommendedMB:8192,maxMB:16384,lowMemory:false,sampledAt:Date.now()});
 window.blockroomLauncher={
  setConnectionMode:async value=>value,
  state:async()=>({root,managedRoot:root,selectedInstance:id,instances:scenario==='empty'?[]:instances,javaPath:java.path,javaInstallations:[java],arch:'x64',account:{configured:false},runs,memory:memory(),play}),
  memory:async()=>memory(),scanJava:async()=>{await delay(450);return [java];},selectJava:async()=>java,pickJava:async()=>java,installState:async()=>({state:'idle'}),
  worlds:async()=>{await delay(600);return {worlds:[{id:'world-one',name:'山谷里的新家',folder:'山谷里的新家',readable:true,version:'1.20.1',dataVersion:3465,gameMode:0,lastPlayed:now-3600000,icon:'/home/camp-v2.webp'},{id:'world-two',name:'周末建筑 · 创造',folder:'Building world',readable:true,version:'1.20.1',dataVersion:3465,gameMode:1,lastPlayed:now-86400000},{id:'world-old',name:'旧世界备份',readable:false,version:'1.20.1',dataVersion:3465,gameMode:0,warning:'主信息损坏，显示备份信息',lastPlayed:now-86400000*8}],truncated:false};},
  check:async()=>{await delay(1000);return {files:2468,accountReady:true,gamePath:instance.root};},
  start:async input=>{
   if(!/^[A-Za-z0-9_]{3,16}$/.test(input.name))throw Error('请输入玩家名');const current=++generation;
   if(play.context?.role==='guest'){set('connecting','模拟：正在连接房主');await delay(900);}
   if(play.context)set('launching','模拟：正在启动游戏');run(input.id,'checking','模拟：检查游戏文件');await delay(500);run(input.id,'starting','模拟：创建游戏进程');await delay(600);run(input.id,'running','模拟：游戏进程已创建');
   if(!play.context)return {started:true};
   if(play.context.role==='guest'){play.network={transport:input.connectionMode==='relay'?'relay':'p2p',latency:input.connectionMode==='relay'?null:24};set('online','模拟：已连接房间，等待游戏进入');return {started:true};}
   set('world-loading','模拟：等待世界载入并开放端口');
   void (async()=>{await delay(1800);if(current!==generation)return;set('checking','模拟：正在确认世界端口');await delay(700);if(current!==generation)return;if(scenario==='failure'){set('failed','模拟：世界端口未就绪，请重试');return;}set('connecting','模拟：正在建立联机连接');await delay(1000);if(current!==generation)return;set('online','模拟：开房成功，未启动真实游戏');})();return {started:true};
  },
  stopPlay:async()=>{generation++;set('stopped','模拟：联机已停止，游戏保持运行');},clearPlay:async()=>{play={context:null,progress:{phase:'idle'}};emit({type:'game-play',...play});},rooms:async()=>{},onEvent:fn=>{listeners.push(fn);return()=>listeners.splice(listeners.indexOf(fn),1);},
  importPack:async()=>{throw Error('界面模拟不安装文件');},pickInstallRoot:async()=>root
 };
 let packState={state:'idle'},packGeneration=0;
 const packEmit=value=>{packState=value;emit({type:'pack-install',...value});};
 async function install(){
  const current=++packGeneration,files=['modrinth.index.json','Java 17/runtime','assets/objects/7d/7d-preview','forge-1.20.1-47.3.33.jar','mods/corpse.jar','config/client.toml'];
  for(let stage=1;stage<=6;stage++)for(let step=0;step<=2;step++){
   if(current!==packGeneration)return null;
   packEmit({state:'installing',operation:'install',stage,stages:6,phase:['prepare','java','resources','loader','mods','verify'][stage-1],name:'模拟安装 · 香草纪元',label:['读取整合包','准备 Java','下载游戏资源','安装 Forge','安装模组','校验文件'][stage-1],file:files[stage-1],percent:step*50,totalFiles:100,completedFiles:Math.floor(((stage-1)*3+step)/18*100),totalBytes:100*1024*1024,completedBytes:(stage-1)*16*1024*1024,fileTotal:1024*1024,fileCompleted:step*512*1024,speedBps:4*1024*1024,etaSeconds:2,message:'界面模拟，不会下载或写入文件'});await delay(220);
  }
  packEmit({...packState,state:'done',percent:100,message:'模拟安装完成，未写入游戏目录'});return instance;
 }
 window.blockroomLauncher.importPack=install;window.blockroomLauncher.retryPack=install;window.blockroomLauncher.installState=async()=>packState;
 window.blockroomLauncher.cancelPack=async()=>{packGeneration++;packEmit({...packState,state:'cancelling',message:'正在取消模拟安装'});await delay(250);packEmit({...packState,state:'cancelled',message:'模拟安装已取消'});};
 let update={phase:'available',currentVersion:'0.9.27',version:'0.9.28（模拟）',canInstall:true,notes:'客户端交互预览，不下载更新、不重启应用。'},updateGeneration=0,confirmation=null,overlay=null,opener=null;
 const updateEmit=value=>{update=value;emit({type:'update',...value});};
 window.joincraftUpdates={
  close:async()=>{if(parent!==window)parent.postMessage({type:'joincraft-preview-close-updates'},location.origin);},
  confirmInstall:async accepted=>{confirmation?.(accepted);confirmation=null;},
  onEvent:fn=>{listeners.push(fn);return()=>listeners.splice(listeners.indexOf(fn),1);},
  updates:{state:async()=>update,check:async()=>{updateEmit({...update,phase:'checking'});await delay(650);updateEmit({...update,phase:'available'});return update;},download:async()=>{
   const current=++updateGeneration;
   for(let percent=0;percent<=100;percent+=10){if(current!==updateGeneration)return update;updateEmit({...update,phase:'downloading',percent,total:100*1024*1024,transferred:percent*1024*1024,bytesPerSecond:5*1024*1024});await delay(240);}
   updateEmit({...update,phase:'downloaded'});return update;
  },cancel:async()=>{updateGeneration++;updateEmit({...update,phase:'cancelling'});await delay(250);updateEmit({...update,phase:'available',percent:0});return update;},install:async()=>{
   const accepted=await new Promise(resolve=>{confirmation=resolve;emit({type:'install-confirmation',version:update.version});});
   if(accepted){updateEmit({...update,phase:'installing'});await delay(700);updateEmit({...update,phase:'downloaded',message:'模拟完成，未重启客户端'});}return update;
  }}
 };
 window.joincraftNotifications={state:async()=>update,claim:async()=>null,onEvent:()=>()=>{},open:async()=>{
  if(overlay)return;opener=document.activeElement;overlay=document.createElement('iframe');overlay.className='preview-updates';overlay.title='客户端更新 · 模拟';overlay.src='/launcher/notifications.html';
  for(const child of document.body.children)child.inert=true;document.body.append(overlay);
 }};
 addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==overlay?.contentWindow||event.data?.type!=='joincraft-preview-close-updates')return;overlay.remove();overlay=null;for(const child of document.body.children)child.inert=false;opener?.focus();});

 document.addEventListener('DOMContentLoaded',()=>{const note=document.querySelector('#web-note');if(!note){emit({type:'surface-shown'});return;}note.hidden=false;note.textContent='界面模拟 · 不启动游戏、不建立线上连接';});
})();
