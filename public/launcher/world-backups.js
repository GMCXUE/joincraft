import {formatBytes} from '../pack-progress.js';
export function mountWorldBackups({api,onError=()=>{},onBusy=()=>{},onChanged=()=>{}}){
 const $=s=>document.querySelector(s),node=(tag,text,className)=>{const el=document.createElement(tag);el.textContent=text??'';if(className)el.className=className;return el;};
 let id=null,world=null,locked=false,pending=false,history=[],loading=false,sequence=0,progress={state:'idle'},revision=0,visible=50;
 const active=()=>pending||['working','cancelling'].includes(progress.state);
 function render(){
  const busy=active(),unavailable=locked||busy||!id||!api?.worldBackup;
  for(const key of ['#world-import-zip','#world-import-folder'])$(key).disabled=unavailable;
  $('#world-backup-panel').hidden=!world;$('#world-backup-create').disabled=unavailable||!world;$('#world-export').disabled=unavailable||!world;
  $('#world-backup-title').textContent=world?'“'+world.name+'”的备份':'存档备份';
  $('#world-backup-note').textContent=locked&&!busy?'退出游戏并结束当前任务后，可以备份或恢复。':'备份保存在当前实例内，独立于游戏存档；恢复前会自动保留当前世界。';
  $('#world-backup-empty').textContent=loading?'正在读取备份…':history.length?'':'还没有备份。建议在更新整合包或修改模组前备份世界。';
  const list=$('#world-backup-list');list.replaceChildren();
  for(const backup of history.slice(0,visible)){const row=node('div',null,'world-backup-row'),copy=node('div'),title=node('strong',backup.label||'存档备份'),meta=node('p',backup.unavailable?'不可恢复，请保留文件并检查磁盘':new Intl.DateTimeFormat('zh-CN',{dateStyle:'medium',timeStyle:'short'}).format(new Date(backup.at))+' · '+formatBytes(backup.bytes)+' · '+backup.fileCount+' 个文件'),button=node('button','恢复');copy.append(title,meta);button.disabled=unavailable||!!backup.unavailable;button.onclick=()=>confirmRestore(backup);row.append(copy,button);list.append(row);}
  $('#world-backup-more').hidden=history.length<=visible;$('#world-backup-more').disabled=loading;
  const global=$('#world-operation-progress');global.hidden=progress.state==='idle';global.dataset.state=progress.state;$('#world-operation-message').textContent=progress.message||'正在处理存档';$('#world-operation-file').textContent=['working','cancelling'].includes(progress.state)?progress.file||progress.worldName||'':'';
  const bar=$('#world-operation-bar');bar.hidden=!['working','cancelling'].includes(progress.state);if(Number.isFinite(progress.percent))bar.value=progress.percent;else bar.removeAttribute('value');$('#world-operation-cancel').hidden=!['working','cancelling'].includes(progress.state);$('#world-operation-cancel').disabled=progress.phase==='committing'||progress.state==='cancelling';
 }
 async function load(){const target=id,worldId=world?.id,request=++sequence;history=[];visible=50;loading=!!worldId;render();if(!worldId||!api?.worldBackups){loading=false;render();return;}try{const rows=await api.worldBackups({id:target,worldId});if(request===sequence&&target===id&&worldId===world?.id)history=rows;}catch(error){if(request===sequence)onError(error);}finally{if(request===sequence){loading=false;render();}}}
 async function run(action){if(active()||locked||!id)return;const target=id,worldId=world?.id;pending=true;onBusy(true);render();try{const result=await action({id:target,worldId});if(result){await onChanged(target,result);if(target===id)await load();}}catch(error){onError(error);}finally{pending=false;onBusy(active());render();}}
 function confirmRestore(backup){const chosenId=id,worldId=world?.id,dialog=$('#world-restore-dialog');$('#world-restore-description').textContent='将用“'+backup.label+'”替换“'+world.name+'”。当前世界会先自动备份，之后也可以恢复回来。';dialog.showModal();$('#world-restore-confirm').onclick=()=>{dialog.close();if(chosenId===id&&worldId===world?.id)void run(input=>api.worldRestore({...input,backupId:backup.id}));};}
 $('#world-backup-create').onclick=()=>run(input=>api.worldBackup(input));$('#world-export').onclick=()=>run(input=>api.worldExport(input));
 for(const kind of ['zip','folder'])$('#world-import-'+kind).onclick=()=>run(({id})=>api.worldImport({id,kind}));
 $('#world-restore-cancel').onclick=()=>$('#world-restore-dialog').close();$('#world-backup-more').onclick=()=>{visible+=50;render();};$('#world-operation-cancel').onclick=()=>api.worldCancel().catch(onError);
 api?.onEvent(event=>{if(event.type!=='world-backup')return;revision++;progress=event;onBusy(active());render();});
 const initial=revision;api?.worldBackupState?.().then(value=>{if(initial===revision){progress=value;onBusy(active());render();}}).catch(onError);
 render();return {sync(state){locked=state.locked||state.loading;const next=state.worlds.find(w=>w.id===world?.id&&state.id===id)||state.worlds.find(w=>w.id===state.selected)||state.worlds[0]||null;if(id!==state.id||next?.id!==world?.id){id=state.id;world=next;void load();}else{world=next;render();}},select(worldId,state){world=state.worlds.find(w=>w.id===worldId)||null;id=state.id;void load();}};
}
