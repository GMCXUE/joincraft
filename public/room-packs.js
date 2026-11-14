import {renderInstallProgress,formatBytes} from './pack-progress.js';
export function createRoomPacksUI({api,escape,icon,smallDialog,refresh,toast,getRoom,getSession=()=>null}){
  const native=window.joincraftPacks,integratedPlay=window.joincraftPlay?.version===1,statuses=new Map();let progress={state:'idle'},busy=false,loadingKey=null,pendingPublish=null,statusRevision=0,progressRevision=0,pendingExport=null,pendingInstall=null;
  const key=room=>room.id+'/'+room.pack?.sha512;
  function panel(room){
    if(!native)return '';
    const pack=room.pack,local=pack?statuses.get(key(room)):null,status=local?.status;
    const changed=local?.reason==='runtime'?'游戏文件缺失或损坏':local?.reason==='extra-mod'?'检测到额外模组':local?.reason==='pack-file'?'模组或脚本与房间版本不同':'本地文件与房间版本不同';
    return '<section class="room-pack-panel"><div class="room-pack-heading"><span class="room-pack-mark" aria-hidden="true">'+icon('cube')+'</span><div><span class="room-pack-caption">房间整合包'+(integratedPlay&&status==='ready'?' · <span role="status">已安装</span>':'')+'</span><h3>'+(pack?escape(pack.name):'选择一起玩的整合包')+'</h3><p>'+(pack?escape(pack.versionId)+' · Minecraft '+escape(pack.minecraft)+' · '+escape(pack.loader)+(pack.loaderVersion?' '+escape(pack.loaderVersion):''):'由房主选择，成员安装相同版本')+'</p></div>'+(room.isHost?'<button class="button small" data-action="pack-choose">'+(pack?'更换整合包':'选择整合包')+'</button>':'')+'</div>'+(pack&&!(integratedPlay&&status==='ready')?'<div class="room-pack-bottom"><span class="room-pack-local" role="status">'+(status==='ready'?'已安装 · 保存在本机游戏库':status==='changed'?changed:status==='error'?'本地检查失败，请重试':status==='missing'?'尚未安装到本机':'正在检查本地游戏库…')+'</span><button class="button primary" data-action="'+(status==='error'?'pack-check':'pack-start')+'" '+(!status||busy?'disabled':'')+'>'+(status==='ready'?'启动游戏':status==='error'?'重新检查':status==='changed'?'安装房间版本':'安装整合包')+'</button></div>':'')+'<div id="room-pack-progress" hidden></div></section>';
  }
  function syncControls(){const active=busy||['installing','cancelling'].includes(progress.state);const current=getRoom(),known=current?.pack&&statuses.has(key(current));for(const button of document.querySelectorAll('[data-action="pack-start"],[data-action="pack-check"],[data-action="pack-choose"]'))button.disabled=active||(button.dataset.action==='pack-start'&&!known);}
  async function sync(room){
    if(!native||!room)return;syncControls();
    renderInstallProgress(document.querySelector('#room-pack-progress'),progress,{cancel:()=>native.cancel().catch(error=>toast(error.message)),retry:()=>handle('pack-retry',null,room)});
    if(!room.pack)return;
    const current=key(room);if(statuses.has(current)||loadingKey===current)return;loadingKey=current;
    const revision=statusRevision;
    try{const result=await native.status({sha512:room.pack.sha512});if(revision===statusRevision)statuses.set(current,result);}
    catch(error){if(revision===statusRevision){statuses.set(current,{status:'error'});if(getRoom()?.id===room.id)toast(error.message);}}
    finally{if(revision===statusRevision&&loadingKey===current){loadingKey=null;if(getRoom()?.id===room.id&&key(getRoom())===current)await refresh(true);}}
  }
  async function choose(room){
    const local=await native.list();
    smallDialog('设置房间整合包','<p class="dialog-description">选择已安装的整合包，或导入 .mrpack / .zip 文件。</p><div id="room-pack-modal-progress" hidden></div><div class="room-pack-options">'+local.map(item=>'<button class="button room-pack-option" data-action="pack-publish" data-pack-id="'+escape(item.id)+'"><strong>'+escape(item.pack.name)+'</strong><span>'+escape(item.pack.versionId)+' · '+escape(item.pack.loader)+(item.editable?' · 编辑副本':'')+'</span></button>').join('')+'</div><button class="button primary full" data-action="pack-publish">'+icon('plus')+'选择整合包文件</button><p class="dialog-footnote">'+(native.transferVersion===2?'支持含 Modrinth 清单的 ZIP，最大 600 MB；模组由客户端下载。':'更新客户端后可支持最大 600 MB 的整合包。')+'</p>'+(room.pack?'<button class="text-button danger-text" data-action="pack-remove">解除房间绑定</button>':''));
  }
  async function handle(action,target,room){
    if(!native||!room||busy)return;busy=true;if(target)target.disabled=true;
    try{
      if(action==='pack-choose'){await choose(room);return;}
      if(action==='pack-check'){statusRevision++;statuses.delete(key(room));loadingKey=null;await sync(room);return;}
      if(action==='pack-export-confirm'){
        if(!pendingExport||pendingExport.roomId!==room.id)throw Error('请重新选择编辑副本');
        const chosen=await native.export({snapshotId:pendingExport.snapshotId,versionId:document.querySelector('#pack-revision-name').value,include:[...document.querySelectorAll('[data-pack-config]:checked')].map(e=>e.value)});
        pendingPublish={roomId:room.id,draftId:chosen.draftId,expected:pendingExport.expected};document.querySelector('#small-dialog')?.close();await native.publish({...pendingPublish,token:getSession()});statuses.clear();await refresh(true);toast('房间新版本已发布');return;
      }
      if(action==='pack-sync-confirm'){
        if(!pendingInstall||pendingInstall.roomId!==room.id||pendingInstall.sha512!==room.pack?.sha512)throw Error('房间版本已变化，请重新查看差异');document.querySelector('#small-dialog')?.close();await native.installFromRoom({...pendingInstall,token:getSession()});statuses.delete(key(room));pendingInstall=null;await refresh(true);toast('整合包已同步，旧实例及存档保留');return;
      }
      if(action==='pack-publish'){
        const chosen=await native.choose(target?.dataset.packId?{id:target.dataset.packId}:{});if(!chosen)return;
        if(chosen.revision&&native.revisionVersion===1){
          const revision=chosen.revision;pendingExport={roomId:room.id,snapshotId:revision.snapshotId,expected:room.pack?.sha512??null};
          const changes=Object.entries(revision.diff).flatMap(([kind,files])=>files.map(f=>'<li>'+({added:'新增',removed:'移除',changed:'更新'})[kind]+' · '+escape(f.path)+'</li>')).join('');
          smallDialog('发布整合包新版本','<label for="pack-revision-name">版本名称</label><input id="pack-revision-name" maxlength="100" value="'+escape(revision.versionId)+'"><ul class="pack-revision-files">'+(changes||'<li>模组与原版本一致</li>')+'</ul>'+(revision.candidates.length?'<details><summary>新增配置与脚本（'+revision.candidates.length+'）</summary>'+revision.candidates.map(p=>'<label class="pack-config-choice"><input type="checkbox" data-pack-config value="'+escape(p)+'">'+escape(p)+'</label>').join('')+'</details>':'')+'<p class="dialog-description">发布后成员可同步此版本，存档和账号数据不会上传。</p><button class="button primary full" data-action="pack-export-confirm">确认发布新版本</button>');return;
        }
        if(native.transferVersion===2){pendingPublish={roomId:room.id,draftId:chosen.draftId,expected:room.pack?.sha512??null};document.querySelector('#small-dialog')?.close();await native.publish({...pendingPublish,token:getSession()});}else await api('/api/rooms/'+room.id+'/pack',{archive:chosen.archive,expected:room.pack?.sha512??null});
        document.querySelector('#small-dialog')?.close();await refresh(true);toast('房间整合包已设置');return;
      }
      if(action==='pack-remove'){await api('/api/rooms/'+room.id+'/pack/remove',{expected:room.pack?.sha512??null});document.querySelector('#small-dialog')?.close();await refresh(true);return;}
      if(action==='pack-retry'&&native.transferVersion===2&&progress.operation==='upload'){if(!pendingPublish||pendingPublish.roomId!==room.id)throw Error('请重新选择整合包');await native.publish({...pendingPublish,token:getSession()});await refresh(true);return;}
      if(!room.pack)return;
      if(action==='pack-start'){
        const revision=statusRevision,status=await native.status({sha512:room.pack.sha512});if(revision!==statusRevision){await sync(room);return;}statuses.set(key(room),status);
        if(status.status==='ready'){if(integratedPlay){await refresh(true);return;}const opened=await native.open({sha512:room.pack.sha512});if(opened.started)toast('游戏已启动');return;}
        if(native.revisionVersion===1){const diff=await native.difference({roomId:room.id,sha512:room.pack.sha512,token:getSession()});pendingInstall={roomId:room.id,sha512:room.pack.sha512};const rows=Object.entries({added:diff.added,removed:diff.removed,changed:diff.changed}).flatMap(([kind,files])=>files.map(f=>'<li>'+({added:'新增',removed:'移除',changed:'更新'})[kind]+' · '+escape(f.path)+'</li>')).join('');smallDialog('同步房间整合包','<p class="dialog-description">'+escape(diff.pack.versionId)+(diff.previous?' · 当前本地版本 '+escape(diff.previous):'')+'</p><ul class="pack-revision-files">'+(rows||'<li>环境文件一致，将检查并修复游戏运行文件</li>')+'</ul><p class="dialog-description">安装为独立实例，旧实例与存档保留。</p><button class="button primary full" data-action="pack-sync-confirm">确认安装房间版本</button>');return;}
        toast('正在获取整合包清单');
        if(native.transferVersion===2)await native.installFromRoom({roomId:room.id,sha512:room.pack.sha512,token:getSession()});else{const data=await api('/api/rooms/'+room.id+'/pack?sha512='+room.pack.sha512);await native.install({archive:data.archive,sha512:room.pack.sha512});}statuses.delete(key(room));if(!integratedPlay)await native.open({sha512:room.pack.sha512});await refresh(true);if(integratedPlay)toast('整合包已安装');
      }
      if(action==='pack-retry'){if(native.transferVersion===2)await native.installFromRoom({roomId:room.id,sha512:room.pack.sha512,token:getSession()});else await native.retry({sha512:room.pack.sha512});statuses.delete(key(room));await refresh(true);}
    }catch(error){toast(error.message);}finally{busy=false;if(target)target.disabled=false;syncControls();}
  }
  if(native){const initialRevision=progressRevision;native.progress().then(value=>{if(initialRevision!==progressRevision)return;progress=value;void sync(getRoom());}).catch(()=>{});native.onEvent(event=>{progressRevision++;progress=event;syncControls();renderInstallProgress(document.querySelector('#room-pack-progress'),progress,{cancel:()=>native.cancel().catch(error=>toast(error.message)),retry:()=>handle('pack-retry',null,getRoom())});renderInstallProgress(document.querySelector('#room-pack-modal-progress'),progress,{cancel:()=>native.cancel().catch(error=>toast(error.message))});if(event.state==='done'&&(!event.operation||event.operation==='install')){statusRevision++;statuses.clear();loadingKey=null;void sync(getRoom());}});}
  return {panel,sync,handle};
}
