export function mountWorlds({api,onChange=()=>{},onError=()=>{}}){
 const $=s=>document.querySelector(s);let id=null,sequence=0,worlds=[],selected=null,loading=false,locked=false,tab='settings';
 const mode=world=>world.hardcore?'极限模式':['生存','创造','冒险','旁观'][world.gameMode]||'未知模式';
 const supported=world=>world.readable&&!world.snapshot&&Number.isInteger(world.dataVersion)&&world.dataVersion<=3465;
 function setTab(value){tab=value;$('#launch-settings').hidden=value!=='settings';$('#worlds-panel').hidden=value!=='worlds';for(const name of ['settings','worlds'])$('#'+name+'-tab').setAttribute('aria-pressed',String(name===value));onChange();}
 function render(){
  $('#world-count').textContent=worlds.length?String(worlds.length):'';$('#refresh-worlds').disabled=loading||!api;$('#worlds-state').hidden=worlds.length>0&&!loading;
  $('#worlds-state').textContent=loading?'正在读取存档…':worlds.length?'':'还没有存档。在游戏中创建世界后刷新。';
  $('#world-list').replaceChildren(...worlds.map(world=>{const button=document.createElement('button');button.type='button';button.className='world-row';button.setAttribute('aria-pressed',String(world.id===selected));button.disabled=!supported(world)||loading||locked;
   const icon=document.createElement(world.icon?'img':'span');icon.className='world-icon';if(world.icon){icon.src=world.icon;icon.alt='';}else{icon.textContent='▦';icon.setAttribute('aria-hidden','true');}
   const content=document.createElement('span');content.className='world-copy';const title=document.createElement('strong');title.textContent=world.name;const meta=document.createElement('small');meta.textContent=[world.version||'未知版本',mode(world),world.warning||(!supported(world)?'需从游戏菜单检查':'')].filter(Boolean).join(' · ');content.append(title,meta);
   const time=document.createElement('span');time.className='world-last-played';time.textContent=world.lastPlayed?new Intl.DateTimeFormat('zh-CN',{dateStyle:'medium',timeStyle:'short'}).format(new Date(world.lastPlayed)):'未记录游玩时间';
   const check=document.createElement('span');check.className='world-selected';check.textContent=world.id===selected?'✓':'';check.setAttribute('aria-hidden','true');button.append(icon,content,time,check);button.onclick=()=>{selected=world.id;render();onChange();};return button;
  }));onChange();
 }
 async function load(instance,{force=false}={}){if(!force&&id===instance?.id)return;id=instance?.id;const request=++sequence;worlds=[];selected=null;loading=!!id;render();if(!id||!api)return;try{const result=await api.worlds({id});if(request!==sequence)return;worlds=result.worlds;selected=worlds.find(supported)?.id||null;if(result.truncated)onError('存档较多，当前显示前 128 个');}catch(error){if(request===sequence)onError(error);}finally{if(request===sequence){loading=false;render();}}}
 $('#settings-tab').onclick=()=>setTab('settings');$('#worlds-tab').onclick=()=>setTab('worlds');$('#refresh-worlds').onclick=()=>load({id},{force:true});
 return {load,setTab,setLocked:value=>{if(locked!==value){locked=value;render();}},get tab(){return tab;},get selected(){return selected;},get selectedWorld(){return worlds.find(world=>world.id===selected);},get loading(){return loading;}};
}
