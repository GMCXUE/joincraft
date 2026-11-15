import {avatarHTML} from './avatars.js';
import {voiceLevel} from './voice-levels.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const percent=value=>Math.round(voiceLevel(value)*100);
const closeIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>';

// Only live participants in the local user's current channel can be controlled.
export function voicePeerFor(state,snapshot,userId,roomId){
 if(!roomId||snapshot.roomId!==roomId||!snapshot.groupId)return null;
 const room=state.rooms?.find(room=>room.id===roomId&&!room.closed);
 const group=room?.community?.groups?.find(group=>group.id===snapshot.groupId);
 const peer=snapshot.participants?.find(peer=>peer.userId===userId);
 if(!group||!peer)return null;
 const member=room.members?.find(member=>member.id===userId);
 if(!member)return null;
 return {room,group,peer,member,self:userId===state.profile?.id};
}
export function placeVoicePanel(anchor,size,viewport,vertical=false){
 const gap=8,edge=8,width=Math.min(size.width,viewport.width-edge*2),height=Math.min(size.height,viewport.height-edge*2);
 let left=vertical?anchor.left+anchor.width/2-width/2:anchor.left;
 let top=vertical?anchor.top-height-gap:anchor.bottom+gap;
 if(vertical&&top<edge)top=anchor.bottom+gap;
 if(!vertical&&top+height>viewport.height-edge)top=anchor.top-height-gap;
 left=Math.max(edge,Math.min(left,viewport.width-width-edge));
 top=Math.max(edge,Math.min(top,viewport.height-height-edge));
 return {left,top};
}
export function voiceProfileHTML(profile={},member={}){
 const person={...member,...profile};
 return `<div class="voice-user-identity">${avatarHTML(person)}<div><h3 id="voice-user-name">${escape(person.name||'成员')}</h3><p>${person.username?'@'+escape(person.username):'访客玩家'}${member.host?' · 房主':''}</p></div></div><p class="voice-user-bio">${escape(person.bio||'这个玩家还没写简介。')}</p>`;
}

export function createVoicePopovers({voice,getState,getVersion,api}){
 const mic=document.createElement('section'),card=document.createElement('section');
 let opened=null,target=null,trigger=null,closeTimer=null,request=0,dragging=false,keyboardMic=false;
 const supportsPopover=typeof mic.showPopover==='function';
 for(const panel of [mic,card]){
  panel.className='voice-popover';panel.hidden=true;panel.tabIndex=-1;panel.setAttribute('role','dialog');
  if(supportsPopover)panel.setAttribute('popover','manual');
  document.body.append(panel);
 }
 mic.id='voice-mic-popover';mic.classList.add('voice-mic-popover');mic.setAttribute('aria-labelledby','voice-mic-heading');
 mic.innerHTML='<h3 id="voice-mic-heading" class="sr-only">麦克风输入音量</h3><div class="voice-vertical-range"><input type="range" min="0" max="100" step="1" value="100" aria-label="麦克风输入音量" aria-orientation="vertical"></div>';
 card.id='voice-user-popover';card.classList.add('voice-user-popover');card.setAttribute('aria-labelledby','voice-user-name');
 const help=document.createElement('span');help.id='voice-microphone-help';help.className='sr-only';help.textContent='鼠标悬停或按向上键调整麦克风输入音量。';document.body.append(help);
 const input=mic.querySelector('input');
 function viewport(){return {width:window.innerWidth,height:window.innerHeight};}
 function position(panel,anchor,vertical=false){const rect=panel.getBoundingClientRect(),point=placeVoicePanel(anchor,rect,viewport(),vertical);panel.style.left=point.left+'px';panel.style.top=point.top+'px';}
 function show(panel){panel.hidden=false;if(supportsPopover&&!panel.matches(':popover-open'))panel.showPopover();opened=panel;}
 function close({focus=false}={}){
  clearTimeout(closeTimer);request++;dragging=false;keyboardMic=false;
  const old=opened,previous=target;opened=null;target=null;
  if(old){if(supportsPopover&&old.matches(':popover-open'))old.hidePopover();old.hidden=true;}
  document.querySelector('[data-action="community-mic"]')?.setAttribute('aria-expanded','false');
  if(focus){const row=previous&&[...document.querySelectorAll('[data-voice-user]')].find(row=>row.dataset.voiceUser===previous.userId&&row.dataset.voiceRoom===previous.roomId);const replacement=trigger?.isConnected?trigger:row||document.querySelector('[data-action="community-mic"]');replacement?.focus({preventScroll:true});}
 }
 function postponeClose(){clearTimeout(closeTimer);closeTimer=setTimeout(()=>{if(opened===mic&&!dragging&&(!keyboardMic||!mic.contains(document.activeElement)))close();},220);}
 function openMic(button,focus=false){
  if(!voice.snapshot().roomId||button.disabled)return;
  if(opened!==mic){close();trigger=button;show(mic);}clearTimeout(closeTimer);sync();
  if(focus){keyboardMic=true;input.focus({preventScroll:true});}
 }
 function updateLevel(panel,value){const range=panel.querySelector('input[type=range]'),p=percent(value);if(range.value!==String(p))range.value=String(p);range.setAttribute('aria-valuetext',p+'%');const output=panel.querySelector('output'),reset=panel.querySelector('.voice-level-reset');if(output)output.textContent=p+'%';if(reset)reset.disabled=p===100;}
 function sync(){
  const snapshot=voice.snapshot(),button=document.querySelector('[data-action="community-mic"]');
  if(button){button.removeAttribute('title');button.setAttribute('aria-describedby',help.id);button.setAttribute('aria-controls',mic.id);button.setAttribute('aria-expanded',String(opened===mic));}
  if(!opened)return;
  if(!snapshot.roomId){close();return;}
  if(opened===mic){
   if(!button){close();return;}updateLevel(mic,snapshot.micGain);
   input.setAttribute('aria-description',snapshot.blocked?'房主已静音':snapshot.mic?'调整麦克风输入音量':'当前已关麦，调整不会自动开麦');
   position(mic,button.getBoundingClientRect(),true);return;
  }
  const info=voicePeerFor(getState(),snapshot,target.userId,target.roomId);
  if(!info||info.peer.identity!==target.identity||target.owner!==getVersion()){close();return;}
  updateLevel(card,info.self?snapshot.micGain:info.peer.volume);
  card.querySelector('.voice-level-note').textContent=info.self?'调整不会自动打开麦克风。':snapshot.deaf?'你已关闭收听，恢复后生效。':'只影响你听到的音量。';
 }
 async function loadProfile(expected){
  const serial=++request;const slot=card.querySelector('.voice-user-profile-state');slot.textContent='正在读取个人资料…';
  try{
   const profile=await api('/api/profiles/'+encodeURIComponent(expected.userId));
   if(serial!==request||opened!==card||target!==expected||expected.owner!==getVersion())return;
   const info=voicePeerFor(getState(),voice.snapshot(),expected.userId,expected.roomId);if(!info){close();return;}
   card.querySelector('.voice-user-profile').innerHTML=voiceProfileHTML(profile,info.member);slot.textContent='';
  }catch{
   if(serial!==request||opened!==card||target!==expected||expected.owner!==getVersion())return;
   slot.innerHTML='个人资料暂不可用。<button type="button" class="voice-profile-retry">重试</button>';
  }
  if(opened===card)position(card,expected.anchor);
 }
 function openUser(userId,roomId,anchor,element){
  const info=voicePeerFor(getState(),voice.snapshot(),userId,roomId);if(!info)return false;
  close();trigger=element||document.activeElement;target={userId,roomId,identity:info.peer.identity,owner:getVersion(),anchor};
  card.innerHTML=`<button type="button" class="voice-popover-close" aria-label="关闭语音成员资料">${closeIcon}</button><div class="voice-user-profile">${voiceProfileHTML(info.member,info.member)}</div><p class="voice-user-profile-state" role="status"></p><div class="voice-user-level"><div class="voice-level-label"><label for="voice-user-level">${info.self?'麦克风输入音量':'收听音量'}</label><output for="voice-user-level">100%</output></div><input id="voice-user-level" type="range" min="0" max="100" step="1" value="100" aria-label="${info.self?'麦克风输入音量':'收听'+escape(info.member.name)+'的音量'}"><div class="voice-level-caption"><p class="voice-level-note"></p><button type="button" class="voice-level-reset">恢复 100%</button></div></div><footer><a href="#profile/${encodeURIComponent(userId)}">个人主页</a>${!info.self&&getState().social?.friends?.some(friend=>friend.id===userId)?`<a href="#chat/${encodeURIComponent(userId)}">发消息</a>`:''}${info.room.isHost&&!info.self?`<button type="button" data-action="community-moderate" data-user="${escape(userId)}" data-room="${escape(roomId)}">语音管理</button>`:''}</footer>`;
  show(card);sync();position(card,anchor);card.focus({preventScroll:true});void loadProfile(target);return true;
 }
 function rowInfo(element){const row=element?.closest?.('[data-voice-user]');return row&&voicePeerFor(getState(),voice.snapshot(),row.dataset.voiceUser,row.dataset.voiceRoom)?row:null;}
 document.addEventListener('contextmenu',event=>{const row=rowInfo(event.target);if(!row)return;event.preventDefault();openUser(row.dataset.voiceUser,row.dataset.voiceRoom,{left:event.clientX,top:event.clientY,bottom:event.clientY,width:0},row);});
 document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&opened){event.preventDefault();event.stopPropagation();close({focus:true});return;}
  if(opened===mic&&mic.contains(event.target))keyboardMic=true;
  const button=event.target.closest?.('[data-action="community-mic"]');
  if(button&&event.key==='ArrowUp'){event.preventDefault();openMic(button,true);return;}
  if(event.key==='ContextMenu'||event.key==='F10'&&event.shiftKey){const row=rowInfo(event.target);if(row){event.preventDefault();openUser(row.dataset.voiceUser,row.dataset.voiceRoom,row.getBoundingClientRect(),row);}}
 },true);
 document.addEventListener('pointerover',event=>{if(event.pointerType!=='mouse')return;const button=event.target.closest?.('[data-action="community-mic"]');if(button)openMic(button);});
 document.addEventListener('pointerout',event=>{if(event.target.closest?.('[data-action="community-mic"]')&&!mic.contains(event.relatedTarget))postponeClose();});
 mic.addEventListener('pointerenter',()=>clearTimeout(closeTimer));mic.addEventListener('pointerleave',postponeClose);
 mic.addEventListener('focusout',()=>{if(!mic.matches(':hover'))postponeClose();});
 for(const panel of [mic,card]){
  panel.addEventListener('pointerdown',event=>{if(event.target.matches('input[type=range]'))dragging=true;});
  panel.addEventListener('input',event=>{if(!event.target.matches('input[type=range]'))return;const value=Number(event.target.value)/100;if(panel===mic||target?.userId===getState().profile?.id)voice.microphoneGain(value);else if(target)voice.volume(target.identity,value);sync();});
  panel.addEventListener('click',event=>{
   if(event.target.closest('.voice-popover-close'))close({focus:true});
   if(event.target.closest('.voice-profile-retry')&&target)void loadProfile(target);
   if(event.target.closest('.voice-level-reset')){if(panel===mic||target?.userId===getState().profile?.id)voice.microphoneGain(1);else if(target)voice.volume(target.identity,1);sync();}
   if(event.target.closest('a,[data-action="community-moderate"]'))close();
  });
 }
 document.addEventListener('pointerup',()=>{dragging=false;if(opened===mic&&!mic.matches(':hover')&&!document.querySelector('[data-action="community-mic"]')?.matches(':hover'))postponeClose();});
 document.addEventListener('pointercancel',()=>{dragging=false;postponeClose();});
 document.addEventListener('pointerdown',event=>{if(opened&&!opened.contains(event.target)&&!event.target.closest?.('[data-action="community-mic"]'))close();},true);
 window.addEventListener('hashchange',()=>close());window.addEventListener('blur',()=>close());
 window.addEventListener('resize',()=>{if(opened===mic)sync();else if(opened===card)position(card,target.anchor);});
 document.addEventListener('scroll',event=>{if(opened&&!opened.contains(event.target))close();},true);
 return {sync,openUser,close};
}
