import {avatarHTML} from './avatars.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const inboxBellIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>';
const glyph=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${name==='check'?'<path d="m5 12 4 4L19 6"/>':name==='close'?'<path d="m6 6 12 12M6 18 18 6"/>':name==='people'?'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a4 4 0 0 1 3 4v2"/>':'<path d="m12 3 9 5v8l-9 5-9-5V8Zm0 9v9M3 8l9 4 9-4"/>'}</svg>`;
export function inboxTarget(item,state={}){
 if(item.kind==='room.closed')return '';
 if(item.roomId)return state.rooms?.some(room=>room.id===item.roomId&&!room.closed)?`#room/${encodeURIComponent(item.roomId)}/overview`:'';
 if(item.kind==='friend.request'&&item.pending)return '#friends/requests';
 if(item.peerId&&state.social?.friends?.some(peer=>peer.id===item.peerId))return '#chat/'+encodeURIComponent(item.peerId);
 return item.category==='friend'?'#friends/requests':'';
}
export function inboxReadBody(snapshot,item){
 if(!item)return {throughId:snapshot.throughId||0,chats:snapshot.chatReads||[]};
 if(item.kind==='chat.message')return {chats:[{peerId:item.peerId,uptoId:Number(item.id.split(':').at(-1))}]};
 return {ids:[Number(item.id.split(':')[1])]};
}
export function newInboxItems(previous,next){
 if(!previous)return [];
 const known=new Map(previous.items.map(item=>[item.id,item]));
 const oldChats=new Map(previous.items.filter(item=>item.kind==='chat.message').map(item=>[item.peerId,item.unread]));
 return next.items.filter(item=>item.unread>0&&(item.kind==='chat.message'?item.unread>(oldChats.get(item.peerId)||0):!known.has(item.id)));
}
export function inboxRows(items,state){
 return items.map(item=>{
  const peer=state.social?.friends?.find(peer=>peer.id===item.peerId)||state.social?.requests?.find(peer=>peer.id===item.peerId);
  const portrait=peer||item.avatarId?avatarHTML(peer||{id:item.peerId,avatarId:item.avatarId}):`<span class="inbox-kind">${glyph(item.category==='friend'?'people':'cube')}</span>`;
  const target=inboxTarget(item,state),date=new Date(item.at),time=Number.isFinite(date.getTime())?date.toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}):'';
  const title=item.kind==='friend.request'&&!item.pending?'好友申请已处理':item.title;
  const copy=`${portrait}<span class="inbox-row-copy"><span class="inbox-row-heading"><strong>${escape(title)}</strong><time datetime="${Number.isFinite(date.getTime())?date.toISOString():''}">${escape(time)}</time></span><span class="inbox-row-body">${escape(item.body)}</span><span class="inbox-row-meta">${escape(item.kind==='chat.message'?'私聊':item.category==='friend'?'好友通知':'系统消息')}${item.unread?`<span class="inbox-unread-label">${item.unread>1?item.unread+' 条未读':'未读'}</span>`:''}${target?`<span class="inbox-row-action">${item.kind==='chat.message'?'打开聊天':item.pending?'处理申请':item.roomId?'查看房间':'查看'}</span>`:''}</span></span>`;
  return `<li class="inbox-row ${item.unread?'is-unread':''}">${target?`<a class="inbox-open" href="${escape(target)}" data-inbox-open="${escape(item.id)}">${copy}</a>`:`<div class="inbox-open">${copy}</div>`}${item.unread?`<button type="button" class="inbox-read-one" data-inbox-read="${escape(item.id)}" aria-label="将${escape(title)}标为已读" title="标为已读">${glyph('check')}</button>`:''}</li>`;
 }).join('');
}
export function createInboxUI({getState,api,refresh,toast}){
 const host=document.querySelector('.title-tools');if(!host)return {update(){},close(){}};
 const bell=document.createElement('button');bell.type='button';bell.className='inbox-bell';bell.setAttribute('aria-label','通知');bell.setAttribute('aria-expanded','false');bell.setAttribute('aria-controls','app-inbox');bell.title='通知';bell.innerHTML=inboxBellIcon+'<span class="inbox-badge" hidden></span>';host.append(bell);
 const panel=document.createElement('section');panel.id='app-inbox';panel.className='inbox-panel';panel.setAttribute('role','region');panel.setAttribute('aria-label','通知中心');panel.setAttribute('popover','auto');panel.hidden=true;
 panel.innerHTML=`<header class="inbox-heading"><div><h2>通知</h2><p class="inbox-summary"></p></div><button type="button" class="inbox-close" aria-label="关闭通知">${glyph('close')}</button></header><div class="inbox-toolbar"><div class="inbox-tabs" role="tablist" aria-label="通知分类">${[['all','全部'],['friend','好友消息'],['system','系统消息']].map(([id,label])=>`<button type="button" id="inbox-tab-${id}" role="tab" aria-controls="inbox-results" data-inbox-filter="${id}">${label}<span></span></button>`).join('')}</div><button type="button" class="inbox-read-all">全部已读</button></div><p class="inbox-error" role="alert" hidden></p><div id="inbox-results" role="tabpanel"></div><footer class="inbox-footer"><span>新消息会自动同步</span><button type="button" class="inbox-refresh">刷新</button></footer>`;
 document.body.append(panel);
 let filter='all',busy=false,identity='',previous=null,rendered='',published=-1;
 const nativePopover=typeof panel.showPopover==='function';
 const isOpen=()=>nativePopover?panel.matches(':popover-open'):!panel.hidden;
 function close({focus=false}={}){if(nativePopover&&isOpen())panel.hidePopover();panel.hidden=true;panel.classList.remove('is-fallback-open');bell.setAttribute('aria-expanded','false');if(focus)bell.focus();}
 const error=message=>{const el=panel.querySelector('.inbox-error');el.textContent=message;el.hidden=!message;};
 function render(force=false){
  const state=getState(),snapshot=state.notifications,key=JSON.stringify([snapshot,filter,busy,state.profile?.id]);if(!force&&key===rendered)return;rendered=key;
  const total=Number(snapshot?.unread)||0;panel.querySelector('.inbox-summary').textContent=total?`${total} 条未读`:'消息与房间动态';
  for(const tab of panel.querySelectorAll('[data-inbox-filter]')){const selected=tab.dataset.inboxFilter===filter;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;const count=tab.dataset.inboxFilter==='all'?total:Number(snapshot?.[tab.dataset.inboxFilter])||0;tab.querySelector('span').textContent=count?String(Math.min(count,99))+(count>99?'+':''):'';}
  const mark=panel.querySelector('.inbox-read-all');mark.disabled=busy||!total;mark.textContent=busy?'正在标记…':'全部已读';
  const result=panel.querySelector('#inbox-results');result.setAttribute('aria-labelledby','inbox-tab-'+filter);result.setAttribute('aria-busy',String(busy));
  const items=(snapshot?.items||[]).filter(item=>filter==='all'||item.category===filter);
  const active=document.activeElement,focusKey=active?.dataset?.inboxRead||active?.dataset?.inboxOpen;
  result.innerHTML=items.length?`<ul class="inbox-list">${inboxRows(items,state)}</ul>${snapshot.hasMore?'<p class="inbox-history-note">显示最近 100 项，聊天记录可在会话中查看。</p>':''}`:`<div class="inbox-empty">${inboxBellIcon}<h3>${!state.profile?'登录后查看通知':!snapshot?'暂时无法读取通知':filter==='friend'?'还没有好友消息':filter==='system'?'还没有系统消息':'暂时没有通知'}</h3><p>${!state.profile?'好友私聊和房间动态会集中显示在这里。':!snapshot?'请检查连接后点击刷新。':'新的消息会出现在这里，已读记录也会保留。'}</p></div>`;
  if(focusKey){const replacement=[...result.querySelectorAll('[data-inbox-read],[data-inbox-open]')].find(el=>el.dataset.inboxRead===focusKey||el.dataset.inboxOpen===focusKey);(replacement||panel.querySelector('.inbox-tabs [aria-selected=true]')).focus({preventScroll:true});}
 }
 async function mark(item){
  const state=getState(),snapshot=state.notifications;if(busy||!snapshot)return false;
  const owner=state.profile?.id,fromAll=document.activeElement===panel.querySelector('.inbox-read-all'),body=inboxReadBody(snapshot,item);busy=true;error('');render();
  try{await api('/api/notifications/read',body);if(getState().profile?.id!==owner)return false;await refresh();return true;}
  catch(e){if(getState().profile?.id===owner)error(e.message||'标记失败，请重试');return false;}
  finally{busy=false;render();if(fromAll&&isOpen())panel.querySelector('.inbox-tabs [aria-selected=true]').focus();}
 }
 function open(){panel.hidden=false;if(!nativePopover)panel.classList.add('is-fallback-open');if(nativePopover&&!isOpen())panel.showPopover();bell.setAttribute('aria-expanded','true');render(true);panel.querySelector(`[data-inbox-filter="${filter}"]`).focus();}
 bell.onclick=()=>isOpen()?close({focus:true}):open();
 panel.querySelector('.inbox-close').onclick=()=>close({focus:true});panel.querySelector('.inbox-read-all').onclick=()=>void mark();
 panel.querySelector('.inbox-refresh').onclick=async event=>{const button=event.currentTarget;button.disabled=true;error('');try{await refresh();if(!getState().notifications)error('通知服务暂时不可用，请稍后重试');}finally{button.disabled=false;render(true);}};
 panel.addEventListener('click',async event=>{
  const tab=event.target.closest('[data-inbox-filter]');if(tab){filter=tab.dataset.inboxFilter;render(true);return;}
  const trigger=event.target.closest('[data-inbox-read],[data-inbox-open]');if(!trigger)return;
  const item=getState().notifications?.items.find(item=>item.id===(trigger.dataset.inboxRead||trigger.dataset.inboxOpen));if(!item)return;
  if(trigger.dataset.inboxRead){await mark(item);return;}
  event.preventDefault();const target=inboxTarget(item,getState());if(item.unread)await mark(item);close();if(target)location.hash=target;
 });
 panel.querySelector('.inbox-tabs').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const tabs=[...panel.querySelectorAll('[data-inbox-filter]')],index=tabs.findIndex(tab=>tab.dataset.inboxFilter===filter),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;filter=tabs[next].dataset.inboxFilter;render(true);tabs[next].focus();});
 panel.addEventListener('toggle',()=>bell.setAttribute('aria-expanded',String(isOpen())));
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&isOpen()){event.preventDefault();close({focus:true});}});
 document.addEventListener('click',event=>{if(!nativePopover&&isOpen()&&!panel.contains(event.target)&&!bell.contains(event.target))close();});
 window.addEventListener('hashchange',()=>close());window.joincraftInbox?.onOpen(open);
 return {close,update(state){
  const nextIdentity=state.profile?.id||'',snapshot=state.notifications;
  if(identity!==nextIdentity){identity=nextIdentity;previous=null;close();error('');}
  if(snapshot){const arrivals=newInboxItems(previous,snapshot).filter(item=>item.kind!=='chat.message'||location.hash!=='#chat/'+item.peerId);if(arrivals.length)toast(arrivals.length>1?`收到 ${arrivals.length} 条新通知`:`${arrivals[0].title}：${arrivals[0].body}`);previous=snapshot;}
  const unread=Number(snapshot?.unread)||0;bell.querySelector('.inbox-badge').hidden=!unread;bell.querySelector('.inbox-badge').textContent=unread>99?'99+':String(unread);bell.setAttribute('aria-label',unread?`通知，${unread}条未读`:'通知');
  if(unread!==published){published=unread;void window.joincraftInbox?.publish(unread).catch(()=>{});}
  if(isOpen())render();
 }};
}
export function mountInboxShortcut(){
 const api=window.blockroomLauncher,host=document.querySelector('.titlebar');if(!api?.openInbox||!host)return;
 const button=document.createElement('button');button.type='button';button.className='inbox-bell';button.title='通知';button.setAttribute('aria-label','查看好友与系统通知');button.innerHTML=inboxBellIcon+'<span class="inbox-badge" hidden></span>';host.append(button);
 function render({unread=0}={}){button.querySelector('.inbox-badge').hidden=!unread;button.querySelector('.inbox-badge').textContent=unread>99?'99+':String(unread);button.setAttribute('aria-label',unread?`通知，${unread}条未读`:'通知');}
 button.onclick=()=>{void api.openInbox().catch(()=>{button.title='打开通知失败，请重试';});};api.onEvent(event=>{if(event.type==='inbox')render(event);});void api.inboxState().then(render).catch(()=>{});
}
