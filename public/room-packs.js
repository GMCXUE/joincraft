import {renderInstallProgress,formatBytes} from './pack-progress.js';
export function createRoomPacksUI({api,escape,icon,smallDialog,refresh,toast,getRoom}){
  const native=window.joincraftPacks,statuses=new Map();let progress={state:'idle'},busy=false,loadingKey=null;
  const key=room=>room.id+'/'+room.pack?.sha512;
  function panel(room){
    if(!native)return '';
    const pack=room.pack,status=pack?statuses.get(key(room))?.status:null;
    return '<section class="room-pack-panel"><div class="room-pack-heading"><span class="room-pack-mark" aria-hidden="true">'+icon('cube')+'</span><div><span class="room-pack-caption">房间整合包</span><h3>'+(pack?escape(pack.name):'选择一起玩的整合包')+'</h3><p>'+(pack?escape(pack.versionId)+' · Minecraft '+escape(pack.minecraft)+' · '+escape(pack.loader)+(pack.loaderVersion?' '+escape(pack.loaderVersion):''):'由房主选择，成员安装相同版本')+'</p></div>'+(room.isHost?'<button class="button small" data-action="pack-choose">'+(pack?'更换整合包':'选择整合包')+'</button>':'')+'</div>'+(pack?'<div class="room-pack-bottom"><span class="room-pack-local" role="status">'+(status==='ready'?'已安装 · 保存在本机游戏库':status==='changed'?'本地文件有变化，将安装新的独立副本':status==='missing'?'尚未安装到本机':'正在检查本地游戏库…')+'</span><button class="button primary" data-action="pack-start" '+(!status||busy?'disabled':'')+'>'+(status==='ready'?'启动游戏':status==='changed'?'安装房间版本':'安装整合包')+'</button></div>':'')+'<div id="room-pack-progress" hidden></div></section>';
  }
  function syncControls(){const active=busy||['installing','cancelling'].includes(progress.state);const current=getRoom(),known=current?.pack&&statuses.has(key(current));for(const button of document.querySelectorAll('[data-action="pack-start"],[data-action="pack-choose"]'))button.disabled=active||(button.dataset.action==='pack-start'&&!known);}
  async function sync(room){
    if(!native||!room)return;syncControls();
    renderInstallProgress(document.querySelector('#room-pack-progress'),progress,{cancel:()=>native.cancel().catch(error=>toast(error.message)),retry:()=>handle('pack-retry',null,room)});
    if(!room.pack)return;
    const current=key(room);if(statuses.has(current)||loadingKey===current)return;loadingKey=current;
    try{statuses.set(current,await native.status({sha512:room.pack.sha512}));}catch(error){statuses.set(current,{status:'missing'});toast(error.message);}finally{loadingKey=null;if(getRoom()?.id===room.id)await refresh(true);}
  }
  async function choose(room){
    const local=await native.list();
    smallDialog('设置房间整合包','<p class="dialog-description">选择已安装的整合包，或导入 .mrpack 文件。</p><div class="room-pack-options">'+local.map(item=>'<button class="button room-pack-option" data-action="pack-publish" data-pack-id="'+escape(item.id)+'"><strong>'+escape(item.pack.name)+'</strong><span>'+escape(item.pack.versionId)+' · '+escape(item.pack.loader)+'</span></button>').join('')+'</div><button class="button primary full" data-action="pack-publish">'+icon('plus')+'选择 .mrpack 文件</button><p class="dialog-footnote">首版支持 16 MB 以内的清单包，模组由各自客户端下载。</p>'+(room.pack?'<button class="text-button danger-text" data-action="pack-remove">解除房间绑定</button>':''));
  }
  async function handle(action,target,room){
    if(!native||!room||busy)return;busy=true;if(target)target.disabled=true;
    try{
      if(action==='pack-choose'){await choose(room);return;}
      if(action==='pack-publish'){
        const chosen=await native.choose(target?.dataset.packId?{id:target.dataset.packId}:{});if(!chosen)return;
        await api('/api/rooms/'+room.id+'/pack',{archive:chosen.archive,expected:room.pack?.sha512??null});
        document.querySelector('#small-dialog')?.close();await refresh(true);toast('房间整合包已设置');return;
      }
      if(action==='pack-remove'){await api('/api/rooms/'+room.id+'/pack/remove',{expected:room.pack?.sha512??null});document.querySelector('#small-dialog')?.close();await refresh(true);return;}
      if(!room.pack)return;
      if(action==='pack-start'){
        const status=await native.status({sha512:room.pack.sha512});statuses.set(key(room),status);
        if(status.status==='ready'){const opened=await native.open({sha512:room.pack.sha512});if(opened.started)toast('游戏已启动');return;}
        toast('正在获取整合包清单');
        const data=await api('/api/rooms/'+room.id+'/pack?sha512='+room.pack.sha512);
        await native.install({archive:data.archive,sha512:room.pack.sha512});statuses.delete(key(room));await native.open({sha512:room.pack.sha512});await refresh(true);
      }
      if(action==='pack-retry'){await native.retry({sha512:room.pack.sha512});statuses.delete(key(room));await refresh(true);}
    }catch(error){toast(error.message);}finally{busy=false;if(target)target.disabled=false;syncControls();}
  }
  if(native){native.progress().then(value=>{progress=value;void sync(getRoom());}).catch(()=>{});native.onEvent(event=>{progress=event;syncControls();renderInstallProgress(document.querySelector('#room-pack-progress'),progress,{cancel:()=>native.cancel().catch(error=>toast(error.message)),retry:()=>handle('pack-retry',null,getRoom())});if(event.state==='done'){statuses.clear();void sync(getRoom());}});}
  return {panel,sync,handle};
}
