import {avatarHTML} from './avatars.js';
import {createVoice} from './voice.js';
import {createScrollAnchor,renderMessageList} from './interaction.js';
import {animateMessageArrival} from './motion.js';
export function createCommunityUI({api,realtime,getState,getVersion,escape,initials,icon,setHTML,toast,smallDialog,formHandler,refresh}){
 const $=s=>document.querySelector(s),drafts=new Map(),cache=new Map(),reads=new Map(),attempts=new Map();
 let currentId='',identity=-1,load=0,sending=false,showMembers=false,reading=null;
 const selected=()=>{const p=location.hash.slice(1).split('/');return p[0]==='room'?getState().rooms.find(r=>r.id===p[1]&&!r.closed):null;};
 const voice=createVoice({api,getState,toast,changed:()=>{drawVoice();const room=selected();if(room){sidebar(room);drawMembers(room);}}});
 const avatar=m=>avatarHTML(m,{link:true});
 const vi=(name)=>icon(name);
 const button=(action,label,symbol,extra='')=>`<button class="icon-button" data-action="community-${action}" aria-label="${escape(label)}" title="${escape(label)}" ${extra}>${vi(symbol)}</button>`;
 function sync(){
  if(identity!==getVersion()){identity=getVersion();void voice.leave();currentId='';load++;cache.clear();drafts.clear();reads.clear();attempts.clear();sending=false;}
  voice.sync();drawVoice();
 }
 function sidebar(room){
  const c=room.community||{},v=voice.snapshot();
  setHTML($('#sidebar-info'),`<div class="sidebar-section-label"><span>语音分组</span>${room.isHost?button('create-group','创建语音分组','plus'):''}</div><div class="voice-groups">${(c.groups||[]).map(g=>{
   const people=(v.roomId===room.id&&v.groupId===g.id?v.participants:c.participants?.filter(p=>p.groupId===g.id))||[];
   return `<div class="voice-group"><div class="voice-group-heading"><button class="channel voice-channel ${v.roomId===room.id&&v.groupId===g.id?'active':''}" data-action="community-join" data-group="${g.id}" ${v.busy?'disabled':''} aria-label="加入${escape(g.name)}语音">${vi('volume')}<span>${escape(g.name)}</span><small>${people.length||''}</small></button>${room.isHost?button('edit-group',`管理${g.name}分组`,'more',`data-group="${g.id}"`):''}</div>${people.map(p=>{const m=room.members.find(m=>m.id===p.userId)||{id:p.userId,name:p.name||'成员'};return `<div class="voice-person ${p.speaking?'speaking':''}">${avatar(m)}<span>${escape(m.name)}</span>${p.muted?vi('micOff'):''}</div>`;}).join('')}</div>`;
  }).join('')}</div>`);
 }
 function drawVoice(){
  let bar=$('#voice-bar');if(!bar){bar=document.createElement('div');bar.id='voice-bar';bar.className='voice-bar';$('.sidebar-bottom').prepend(bar);}
  const v=voice.snapshot(),room=getState().rooms.find(r=>r.id===v.roomId),group=room?.community?.groups.find(g=>g.id===v.groupId);
  bar.hidden=!v.roomId&&!v.busy&&!v.error;$('.sidebar-bottom').classList.toggle('has-voice',!bar.hidden);
  bar.dataset.connection=v.status==='语音已连接'?'connected':v.busy?'connecting':v.error&&!v.roomId?'error':'idle';
  const mutedLabel=v.blocked?'房主已静音':v.mic?'关闭麦克风':'打开麦克风';
  setHTML(bar,`<div class="voice-status"><span class="status-dot ${v.status==='语音已连接'?'connected':''}"></span><div><strong>${escape(v.status||'语音未连接')}</strong>${room?`<a href="#room/${room.id}/chat">${escape(group?.name||'语音')} / ${escape(room.name)}</a>`:''}</div></div>${v.roomId?`<div class="voice-controls">${button('mic',mutedLabel,v.mic?'mic':'micOff',`aria-pressed="${v.mic}" ${v.blocked||v.micBusy||v.busy?'disabled':''} data-state="${v.mic?'on':'off'}"`)}${button('deaf',v.deaf?'恢复收听':'关闭收听',v.deaf?'headphonesOff':'headphones',`aria-pressed="${v.deaf}" data-state="${v.deaf?'off':'on'}"`)}${button('devices','语音设置','settings')}${button('leave','断开语音','hangup')}</div>`:''}${v.playbackBlocked?'<button class="text-link" data-action="community-resume">点击恢复声音</button>':''}${v.error?`<p class="voice-error" role="alert">${escape(v.error)}</p>`:''}`);
 }
 function drawMembers(room){
  const el=$('#room-chat-members');if(!el||currentId!==room.id)return;
  const c=room.community||{},v=voice.snapshot(),online=new Set(c.online||[]),peers=new Map((c.participants||[]).map(p=>[p.userId,p]));
  if(v.roomId===room.id)for(const p of v.participants)peers.set(p.userId,{...p,groupId:v.groupId});
  const members=[...room.members].sort((a,b)=>Number(online.has(b.id))-Number(online.has(a.id)));
  setHTML(el,`<div class="room-members-heading"><span>成员 · ${members.length}</span><small>在线 ${online.size}</small></div>${members.map(m=>{const peer=peers.get(m.id),group=c.groups?.find(g=>g.id===peer?.groupId);return `<div class="room-chat-member ${peer?.speaking?'speaking':''}"><div class="presence-avatar ${online.has(m.id)||peer?'online':''}">${avatar(m)}</div><div class="room-member-name"><strong>${escape(m.name)}${m.self?' <small>我</small>':''}</strong><small>${peer?escape(group?.name||'语音')+(peer.muted?' · 静音':''):m.host?'房主':online.has(m.id)?'在线':'离线'}</small></div>${room.isHost&&!m.self?button('moderate',`管理${m.name}的语音`,'more',`data-user="${m.id}"`):''}</div>`;}).join('')}`);
 }
 const atBottom=()=>reading?.atBottom()||false;
 function error(message,kind='send'){const el=$('#room-chat-error');if(el){el.dataset.kind=kind;el.innerHTML=escape(message)+(message&&kind==='load'?' <button class="text-button" type="button" data-action="community-retry">重试</button>':'');el.hidden=!message;}}
 function render(room){
  if(currentId!==room.id||!$('#room-chat-form')){
   reading?.dispose();currentId=room.id;load++;
   $('#main').innerHTML=`<div class="room-chat-layout ${showMembers?'show-members':''}"><div class="room-chat-panel"><div class="chat-feed"><div id="room-message-list" role="log" tabindex="0" aria-label="房间聊天记录" aria-live="polite"><p class="chat-loading">正在加载消息…</p></div><button class="text-button message-jump" type="button" hidden>回到最新消息 ${vi('down')}</button></div><form id="room-chat-form" class="room-chat-composer"><label class="sr-only" for="room-chat-input">发送房间消息</label><textarea id="room-chat-input" maxlength="2000" rows="1" placeholder="发送消息到房间">${escape(drafts.get(room.id)||'')}</textarea><button class="icon-button send-room-message" type="submit" aria-label="发送消息">${vi('send')}</button></form><p id="room-chat-error" class="form-error" role="alert" hidden></p></div><aside id="room-chat-members" aria-label="房间成员"></aside></div>`;
   $('#room-chat-input').addEventListener('input',e=>{drafts.set(room.id,e.target.value);composer();});
   $('#room-chat-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();$('#room-chat-form').requestSubmit();}});
   $('#room-chat-form').addEventListener('submit',e=>{e.preventDefault();void send(room.id);});
   reading=createScrollAnchor($('#room-message-list'),$('.message-jump'),()=>void read(room.id));composer();void fetchMessages(room.id);
  }
  drawMembers(room);if(cache.has(room.id)){const position=reading.capture();drawMessages(room.id);reading.restore(position);}
 }
 function composer(){const input=$('#room-chat-input');if(!input)return;input.style.height='auto';input.style.height=Math.min(140,input.scrollHeight)+'px';$('#room-chat-form button').disabled=sending||!input.value.trim();$('#room-chat-form button').setAttribute('aria-busy',String(sending));}
 async function fetchMessages(id,older=false){
  const request=++load,version=getVersion(),initial=cache.get(id),before=older&&initial?.messages[0]?.id;
  try{
   const result=await api(`/api/rooms/${id}/messages${before?'?before='+before:''}`);
   if(request!==load||version!==getVersion()||currentId!==id||!$('#room-message-list'))return;
   if($('#room-chat-error')?.dataset.kind==='load')error('');
   const old=cache.get(id),position=reading.capture(),stick=!old||position.bottom;
   const gap=!older&&old?.messages.length&&result.hasMore&&old.messages.at(-1).id<result.messages[0]?.id;
   const merged=new Map((gap?[]:old?.messages||[]).map(m=>[m.id,m]));for(const m of result.messages)merged.set(m.id,m);
   cache.set(id,{messages:[...merged.values()].sort((a,b)=>a.id-b.id),loaded:true,hasMore:older||gap?result.hasMore:old?.loaded?old.hasMore:result.hasMore});
   drawMessages(id);reading.restore(position,{older,follow:!older&&stick});if(!older&&stick)void read(id);
  }catch(e){if(request===load&&version===getVersion()&&currentId===id){if(!cache.has(id))setHTML($('#room-message-list'),`<div class="message-load-error"><p>${escape(e.message)}</p><button class="button small" type="button" data-action="community-retry">重新加载</button></div>`);else error(e.message,'load');}}
 }
 function drawMessages(id,arrive=false){const data=cache.get(id);if(!data)return;let day='';
  const html=data.messages.map(m=>{const member=selected()?.members.find(member=>member.id===m.userId);if(member)m={...m,name:member.name,avatarId:member.avatarId};const date=new Date(m.at),stamp=date.toLocaleDateString('zh-CN'),divider=stamp!==day?`<div class="room-day" data-message-day="${escape(stamp)}"><span>${escape(stamp)}</span></div>`:'';day=stamp;return `${divider}<article data-message-id="${m.id}" class="room-message">${avatar(m)}<div><div class="room-message-meta"><strong>${escape(m.name)}</strong><time datetime="${date.toISOString()}">${date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</time></div><p>${escape(m.content)}</p></div></article>`;}).join('');
  const added=renderMessageList($('#room-message-list'),`${data.hasMore?'<button class="text-button older-messages" data-action="community-older">查看更早消息</button>':''}${html||'<div class="room-chat-empty"><span>#</span><h2>房间聊天</h2><p>约个时间，一起开玩。</p></div>'}`);
  if(arrive)animateMessageArrival(added);
 }
 async function read(id){if(document.hidden||currentId!==id||!$('#room-chat-form')||!atBottom())return;const last=cache.get(id)?.messages.at(-1)?.id;if(!last||last<=(reads.get(id)||0))return;const version=getVersion();reads.set(id,last);try{await realtime('room.read',{roomId:id,lastId:last});}catch{if(version===getVersion())reads.delete(id);}}
 async function send(id){if(sending)return;const input=$('#room-chat-input'),content=input.value.trim();if(!content)return;const version=getVersion();let attempt=attempts.get(id);if(!attempt||attempt.content!==content){attempt={content,clientId:crypto.randomUUID()};attempts.set(id,attempt);}sending=true;composer();error('');try{
  const message=await realtime('room.send',{roomId:id,...attempt});if(version!==getVersion())return;receive({type:'room.message',roomId:id,message});attempts.delete(id);if((drafts.get(id)||'').trim()===content){drafts.delete(id);if(currentId===id&&$('#room-chat-input'))$('#room-chat-input').value='';}if(currentId===id&&$('#room-message-list')){$('#room-message-list').scrollTop=$('#room-message-list').scrollHeight;reading?.update();$('#room-chat-input')?.focus();}
 }catch(e){if(version===getVersion()&&currentId===id)error(e.message);}finally{if(version===getVersion()){sending=false;composer();}}}
 function receive(event){
  if(event.type!=='room.message')return;
  const {roomId:id,message}=event;if(currentId!==id){cache.delete(id);return;}const history=cache.get(id);if(!history&&currentId!==id)return;
  if(history?.messages.some(item=>item.id===message.id))return;
  const position=currentId===id&&reading?reading.capture():null,messages=new Map((history?.messages||[]).map(item=>[item.id,item]));messages.set(message.id,message);
  cache.set(id,{...history,messages:[...messages.values()].sort((a,b)=>a.id-b.id),loaded:history?.loaded||false,hasMore:history?.hasMore??true});
  if(position){drawMessages(id,position.bottom);reading.restore(position,{newMessages:message.userId===getState().profile?.id?0:1});if(position.bottom)void read(id);}
 }
 async function resync(){
  const id=currentId,history=cache.get(id);if(!id)return;
  if(!history?.loaded||!history.messages.length){await fetchMessages(id);return;}
  const version=getVersion(),request=++load;let cursor=history.messages.at(-1).id;
  try{for(;;){
   const result=await api(`/api/rooms/${id}/messages?after=${cursor}`);
   if(version!==getVersion()||request!==load||currentId!==id)return;
   const position=reading.capture(),latest=cache.get(id),messages=new Map(latest.messages.map(message=>[message.id,message])),newMessages=result.messages.filter(message=>message.userId!==getState().profile?.id&&!messages.has(message.id)).length;for(const message of result.messages)messages.set(message.id,message);
   cache.set(id,{...latest,messages:[...messages.values()].sort((a,b)=>a.id-b.id)});drawMessages(id);reading.restore(position,{newMessages});
   if(!result.hasMore||!result.messages.length)break;cursor=result.messages.at(-1).id;
  }if($('#room-chat-error')?.dataset.kind==='load')error('');void read(id);
  }catch(reason){if(version===getVersion()&&request===load&&currentId===id)error(reason.message,'load');}
 }
 async function handle(action,target){const room=selected(),v=voice.snapshot();try{
  if(action==='community-retry'||action==='community-older'){target.disabled=true;try{if(action==='community-older')await fetchMessages(room.id,true);else await resync();}finally{if(target.isConnected)target.disabled=false;}return;}
  if(action==='community-join'){await voice.join(room.id,target.dataset.group);return;}
  if(action==='community-leave'){await voice.leave();return;}
  if(action==='community-mic'){await voice.microphone();return;}
  if(action==='community-deaf'){await voice.deafen();return;}
  if(action==='community-resume'){await voice.resume();return;}
  if(action==='community-members'){showMembers=!showMembers;$('.room-chat-layout')?.classList.toggle('show-members',showMembers);target.setAttribute('aria-expanded',String(showMembers));return;}
  if(action==='community-create-group'||action==='community-edit-group'){
   const group=room.community.groups.find(g=>g.id===target.dataset.group);
   smallDialog(group?'管理语音分组':'创建语音分组',`<form id="voice-group-form"><div class="field"><label for="voice-group-name">分组名称</label><input id="voice-group-name" name="name" maxlength="20" required value="${escape(group?.name||'')}" placeholder="例如 建筑队"></div><p class="form-error" id="voice-group-error" hidden role="alert"></p><div class="voice-dialog-actions">${group&&!group.isDefault?`<button type="button" class="text-button danger-text" data-action="community-delete-group" data-group="${group.id}">删除分组</button>`:''}<button class="button primary" type="submit">${group?'保存':'创建'}</button></div></form>`);
   formHandler($('#voice-group-form'),'#voice-group-error',async body=>{await api(`/api/rooms/${room.id}/groups${group?'/'+group.id+'/rename':''}`,body);$('#small-dialog').close();await refresh(true);});$('#voice-group-name').focus();return;
  }
  if(action==='community-delete-group'){
   const id=target.dataset.group;smallDialog('删除语音分组',`<p class="dialog-description">分组内的成员会断开语音，房间聊天不受影响。</p><div class="confirm-actions"><button class="button" data-action="dismiss">取消</button><button class="button danger" data-action="community-confirm-delete" data-group="${id}">删除分组</button></div>`);return;
  }
  if(action==='community-confirm-delete'){target.disabled=true;await api(`/api/rooms/${room.id}/groups/${target.dataset.group}/delete`,{});$('#small-dialog').close();await refresh(true);return;}
  if(action==='community-moderate'){
   const m=room.members.find(m=>m.id===target.dataset.user),muted=room.community.muted.includes(m.id);
   smallDialog(`${m.name} · 语音管理`,`<div class="voice-moderation"><button class="button" data-action="community-rule" data-user="${m.id}" data-rule="${muted?'allow':'mute'}">${muted?'允许使用麦克风':'限制麦克风'}</button><button class="button danger" data-action="community-rule" data-user="${m.id}" data-rule="remove">移出语音 · 60 秒内不可重进</button></div>`);return;
  }
  if(action==='community-rule'){target.disabled=true;await api(`/api/rooms/${room.id}/voice/${target.dataset.user}/${target.dataset.rule}`,{});$('#small-dialog').close();await refresh();return;}
  if(action==='community-devices'){
   const d=await voice.devices();
   const options=(items,current)=>items.filter(d=>d.deviceId!=='default').map((device,i)=>`<option value="${escape(device.deviceId)}" ${device.deviceId===current?'selected':''}>${escape(device.label||'设备 '+(i+1))}</option>`).join('');
   smallDialog('语音设置',`<form id="voice-devices-form"><div class="field"><label for="voice-input">麦克风</label><select id="voice-input" name="input"><option value="">系统默认</option>${options(d.inputs,d.micDevice)}</select></div>${d.outputSupported?`<div class="field"><label for="voice-output">扬声器</label><select id="voice-output" name="output"><option value="">系统默认</option>${options(d.outputs,d.outputDevice)}</select></div>`:'<p class="dialog-description">扬声器使用系统当前输出设备。</p>'}${!d.inputs.some(d=>d.label)?'<p class="dialog-description">打开麦克风并授权后，可查看设备名称。</p>':''}<p id="voice-devices-error" class="form-error" role="alert" hidden></p><button class="button primary" type="submit">保存</button></form>${v.participants.filter(p=>p.userId!==getState().profile?.id).map(p=>`<label class="voice-volume"><span>${escape(p.name)}</span><input type="range" min="0" max="100" value="${Math.round(p.volume*100)}" data-peer="${p.identity}" aria-label="${escape(p.name)}的音量"></label>`).join('')}`);
   formHandler($('#voice-devices-form'),'#voice-devices-error',async body=>{await voice.selectDevices(body.input,body.output);$('#small-dialog').close();});document.querySelectorAll('.voice-volume input').forEach(el=>el.addEventListener('input',()=>voice.volume(el.dataset.peer,Number(el.value)/100)));return;
  }
 }catch(e){target.disabled=false;toast(e.message);}}
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&currentId)void resync();});
 return {sync,sidebar,render,handle,receive,resync,leave:()=>{reading?.dispose();reading=null;currentId='';load++;},disconnect:()=>voice.leave()};
}
