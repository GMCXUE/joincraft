(() => {
  const listeners = [];
  const root = 'D:\\Minecraft\\PCL\\.minecraft';
  const instances = [
    { id: 'mock-fabric', name: '周末生存', version: '周末生存', root, minecraft: '1.20.1', loader: 'Fabric', javaMajor: 17, isolation: { mode: 'isolated', source: 'PCL 版本隔离设置' } },
    { id: 'mock-forge', name: '机械动力', version: '机械动力', root, minecraft: '1.20.1', loader: 'Forge', javaMajor: 17, isolation: { mode: 'isolated', source: '实例目录已有模组或存档' } },
    { id: 'mock-old', name: '旧版冒险', version: '旧版冒险', root, minecraft: '1.12.2', loader: 'Forge', javaMajor: 8, error: '模拟：缺少继承版本配置，请先在 PCL 中修复该实例' }
  ];
  const javaInstallations=[{path:'C:\\Program Files\\Java\\jdk-17\\bin\\java.exe',major:17,version:'17.0.12',arch:'x64'},{path:'C:\\Program Files\\Java\\jdk-21\\bin\\java.exe',major:21,version:'21.0.4',arch:'x64'},{path:'D:\\Minecraft\\runtime\\jre8\\bin\\java.exe',major:8,version:'1.8.0_422',arch:'x64'}];
  const pclProfile={name:'Zhuanz',names:['Zhuanz','Builder_2'],source:'PCL 最近离线启动'};
  let account = { configured: true, profile: null, busy: false };
  const emit = event => listeners.forEach(fn => fn(event));
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  let runs=[];
  const memory=()=>{const totalMB=15462,availableMB=[7168,6656,7680,8192,7680,6656][Math.floor(Date.now()/4000)%6],reserveMB=1536;return {totalMB,availableMB,usedMB:totalMB-availableMB,reserveMB,maxMB:13824,recommendedMB:availableMB,lowMemory:false,sampledAt:Date.now()};};
  let confirmUpdate=null;
  let update={phase:'idle',currentVersion:'0.9.0',lastChecked:null,version:null,notes:'',canInstall:false},cancelled=false;
  const updateEvent=patch=>{update={...update,...patch};emit({type:'update',...update});return {...update};};
  window.blockroomLauncher = {
    updates:{
      state:async()=>({...update}),
      check:async()=>{updateEvent({phase:'checking'});await delay(400);return updateEvent({phase:'available',version:'0.10.0',notes:'新增房间语音分组\n优化客户端更新与下载体验',lastChecked:Date.now()});},
      download:async()=>{cancelled=false;updateEvent({phase:'downloading',percent:0,transferred:0,total:200*1024*1024,bytesPerSecond:0});for(let percent=10;percent<=100;percent+=10){await delay(500);if(cancelled)return updateEvent({phase:'available',percent:0});updateEvent({percent,transferred:percent*2*1024*1024,total:200*1024*1024,bytesPerSecond:20*1024*1024});}return updateEvent({phase:'downloaded',canInstall:true});},
      cancel:async()=>{cancelled=true;return updateEvent({phase:'cancelling'});},
      install:async()=>{updateEvent({phase:'confirming',canInstall:false});const accepted=await new Promise(resolve=>{confirmUpdate=resolve;emit({type:'install-confirmation',version:update.version});});return updateEvent({phase:'downloaded',error:accepted?'模拟完成：未运行安装程序。':'',canInstall:true});}
    },
    state: async () => ({ root, instances, javaPath: 'C:\\Program Files\\Java\\jdk-17\\bin\\java.exe', account, runs,memory:memory(),pclProfile,javaInstallations,arch:'x64' }),
    memory:async()=>memory(),
    pickDirectory: async () => ({ root, instances,pclProfile }),
    scanJava:async()=>{await delay(1400);return javaInstallations;},
    selectJava:async selected=>javaInstallations.find(java=>java.path===selected),
    pickJava: async () => ({ path: 'C:\\Program Files\\Java\\jdk-17\\bin\\java.exe', major: 17 }),
    check: async input => { await delay(200); if (!/^[A-Za-z0-9_]{3,16}$/.test(input.name)) throw new Error('模拟：玩家名格式不正确'); return { files: 1426, gamePath: `${root}\\versions\\${instances.find(i => i.id === input.id).version}`, accountReady: input.accountMode === 'offline' || !!account.profile }; },
    start: async input => { if(runs.some(r=>r.state==='running'))throw Error('模拟：游戏正在运行');emit({ type: 'run', id: input.id, state: 'checking', message: '模拟：正在检查文件' });await delay(400);const memoryMB=input.memoryMode==='auto'?memory().recommendedMB:Number(input.memoryMB),run={type:'run',id:input.id,state:'running',memoryMB,message:'模拟：游戏进程已启动'};runs=[run];emit(run);setTimeout(()=>{runs=[{...run,state:'exited',message:'模拟完成，未运行真实游戏'}];emit(runs[0]);},12000);return {started:true}; },
    login: async () => { account.busy = true; emit({ type: 'device-code', code: 'DEMO-ONLY' }); await delay(2000); account = { configured: true, busy: false, profile: { name: 'DemoPlayer' } }; emit({ type: 'account', ...account }); return account; },
    logout: async () => (account = { configured: true, busy: false, profile: null }),
    microsoftPage: async () => { throw new Error('这是模拟测试，不会打开真实登录页面。'); },
    rooms: async () => { location.assign('http://127.0.0.1:4180/'); },
    onEvent: fn => listeners.push(fn)
  };
  window.joincraftUpdates={...window.blockroomLauncher,confirmInstall:async accepted=>{confirmUpdate?.(accepted);confirmUpdate=null;},close:()=>location.assign('/')};
  window.joincraftNotifications={
    state:async()=>({...update}),
    claim:async()=>{if(update.phase!=='available'||localStorage.getItem('joincraft-preview-notified')===update.version)return null;localStorage.setItem('joincraft-preview-notified',update.version);return {version:update.version};},
    open:async()=>{location.assign('/notifications.html');},
    onEvent:fn=>listeners.push(event=>{if(event.type==='update')fn();})
  };
  setTimeout(()=>window.blockroomLauncher.updates.check(),1000);
  document.addEventListener('DOMContentLoaded',()=>{
    if(document.querySelector('.notifications-page')){const note=document.createElement('p');note.className='web-note';note.textContent='客户端模拟 · 不下载文件或安装';document.body.prepend(note);return;}
    const note=document.querySelector('#web-note');note.hidden=false;note.textContent='客户端模拟 · 不会启动游戏或安装更新';document.querySelector('#surface-label').textContent='游戏库 · 模拟预览';
  });
})();
