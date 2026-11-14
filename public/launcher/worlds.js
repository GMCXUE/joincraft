import {clientIcon,revealClientPanel} from './experience.js';
export const canUseWorld=world=>Boolean(world?.readable&&!world.snapshot&&Number.isInteger(world.dataVersion)&&world.dataVersion<=3465);
export function createWorldSelection({read,onChange=()=>{},onError=()=>{}}){
 let state={id:null,worlds:[],selected:null,loading:false,locked:false},sequence=0;
 const choices=new Map();
 const notify=()=>onChange(state);
 function select(id){if(state.loading||state.locked||!state.worlds.some(world=>world.id===id&&canUseWorld(world)))return false;state.selected=id;choices.set(state.id,id);notify();return true;}
 async function load(instance,{force=false}={}){
  const id=instance?.id||null;if(!force&&id===state.id)return;
  const same=id===state.id,request=++sequence;
  state={...state,id,worlds:same?state.worlds:[],selected:same?state.selected:null,loading:!!id&&!!read};notify();
  if(!id||!read)return;
  try{
   const result=await read({id});if(request!==sequence)return;
   const worlds=result.worlds||[],preferred=choices.get(id)||state.selected;
   state.worlds=worlds;state.selected=worlds.find(world=>world.id===preferred&&canUseWorld(world))?.id||worlds.find(canUseWorld)?.id||null;
   if(state.selected)choices.set(id,state.selected);
   if(result.truncated)onError('存档较多，当前显示前 128 个');
  }catch(error){if(request===sequence)onError(error);}
  finally{if(request===sequence){state.loading=false;notify();}}
 }
 return {load,select,setLocked(value){if(state.locked!==value){state.locked=value;notify();}},get state(){return state;}};
}
export function mountWorlds({api,onChange=()=>{},onError=()=>{}}){
 const $=s=>document.querySelector(s);let tab='settings',listId=null;
 const mode=world=>world.hardcore?'极限模式':['生存','创造','冒险','旁观'][world.gameMode]||'未知模式';
 const model=createWorldSelection({read:api?input=>api.worlds(input):null,onChange:render,onError});
 function setTab(value){if(tab===value)return;const direction=value==='worlds'?1:-1;tab=value;$('#launch-settings').hidden=value!=='settings';$('#worlds-panel').hidden=value!=='worlds';for(const name of ['settings','worlds'])$('#'+name+'-tab').setAttribute('aria-pressed',String(name===value));revealClientPanel($('#instance-content'),{direction});onChange();}
 function render(state){
  const {worlds,loading,locked,selected}=state;
  $('#world-count').textContent=worlds.length?String(worlds.length):'';
  const refresh=$('#refresh-worlds');refresh.disabled=loading||!api||locked;refresh.setAttribute('aria-busy',String(loading));
  $('#worlds-state').hidden=worlds.length>0;$('#worlds-state').textContent=loading?'正在读取存档…':'还没有存档。在游戏中创建世界后刷新。';
  const list=$('#world-list'),existing=new Map([...list.children].map(button=>[button.dataset.worldId,button])),keep=new Set();
  list.setAttribute('aria-busy',String(loading));
  worlds.forEach((world,index)=>{
   let button=existing.get(world.id);
   const metadata=JSON.stringify([world.name,world.version,world.gameMode,world.hardcore,world.warning,world.icon,world.lastPlayed,canUseWorld(world)]);
   if(!button){button=document.createElement('button');button.type='button';button.className='world-row';button.dataset.worldId=world.id;}
   if(button.dataset.metadata!==metadata){
    const icon=document.createElement(world.icon?'img':'span');icon.className='world-icon';if(world.icon){icon.src=world.icon;icon.alt='';}else{icon.innerHTML=clientIcon('cube');icon.setAttribute('aria-hidden','true');}
    const content=document.createElement('span');content.className='world-copy';const title=document.createElement('strong');title.textContent=world.name;const meta=document.createElement('small');meta.textContent=[world.version||'未知版本',mode(world),world.warning||(!canUseWorld(world)?'需从游戏菜单检查':'')].filter(Boolean).join(' · ');content.append(title,meta);
    const time=document.createElement('span');time.className='world-last-played';time.textContent=Number.isFinite(world.lastPlayed)&&world.lastPlayed>0?new Intl.DateTimeFormat('zh-CN',{dateStyle:'medium',timeStyle:'short'}).format(new Date(world.lastPlayed)):'未记录游玩时间';
    const check=document.createElement('span');check.className='world-selected';check.innerHTML=clientIcon('check');check.setAttribute('aria-hidden','true');button.replaceChildren(icon,content,time,check);button.dataset.metadata=metadata;
   }
   button.setAttribute('aria-pressed',String(world.id===selected));button.disabled=!canUseWorld(world)||loading||locked;button.onclick=()=>model.select(world.id);
   if(list.children[index]!==button)list.insertBefore(button,list.children[index]||null);keep.add(button);
  });
  for(const button of [...list.children])if(!keep.has(button))button.remove();
  if(listId!==state.id&&!loading&&worlds.length){listId=state.id;revealClientPanel(list);}
  onChange();
 }
 $('#settings-tab').onclick=()=>setTab('settings');$('#worlds-tab').onclick=()=>setTab('worlds');$('#refresh-worlds').onclick=()=>model.load({id:model.state.id},{force:true});
 return {load:model.load,setTab,setLocked:model.setLocked,get tab(){return tab;},get selected(){return model.state.selected;},get selectedWorld(){return model.state.worlds.find(world=>world.id===model.state.selected);},get loading(){return model.state.loading;}};
}
