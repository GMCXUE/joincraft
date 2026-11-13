import {avatarHTML} from './avatars.js';
import {createScrollAnchor} from './interaction.js';
export function createSocialUI({api,realtime,getState,getVersion,icon,escape,initials,setHTML,toast,openAuth,smallDialog,formHandler,refresh}) {
 const $=s=>document.querySelector(s),empty={friends:[],requests:[],conversations:[],unread:0};
 let mounted='',search='',currentPeer='',loadId=0,identity=-1,sending=false,reading=null;
 const cache=new Map(),drafts=new Map(),readIds=new Map(),attempts=new Map();
 const data=()=>getState().social||empty;
 const account=()=>Boolean(getState().profile?.username);
 const route=()=>{const parts=location.hash.slice(1).split('/');return{peer:parts[0]==='chat'?parts[1]:null,requests:parts[0]==='friends'&&parts[1]==='requests'};};
 const avatar=(p,link=false)=>avatarHTML(p,{link});
 const badge=n=>n?`<span class="unread-badge">${n>99?'99+':n}</span>`:'';
 const time=t=>new Date(t).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
 function renderShell(){
  const r=route(),s=data(),incoming=s.requests.filter(p=>p.incoming).length,peer=s.friends.find(p=>p.id===r.peer);
  $('.workspace').classList.add('social-mode');
  setHTML($('#room-heading'),`<div class="room-heading-line"><h2>好友与聊天</h2></div>`);
  setHTML($('#room-nav'),`<a class="channel ${!r.peer&&!r.requests?'active':''}" href="#friends" ${!r.peer&&!r.requests?'aria-current="page"':''}>${icon('people')}<span>全部好友</span><span class="channel-count">${s.friends.length}</span></a><a class="channel ${r.requests?'active':''}" href="#friends/requests" ${r.requests?'aria-current="page"':''}>${icon('clock')}<span>好友申请</span>${badge(incoming)}</a>`);
  const conversations=[...s.conversations];if(peer&&!conversations.some(p=>p.id===peer.id))conversations.unshift({...peer,preview:'',unread:0});
  setHTML($('#sidebar-info'),`<div class="sidebar-section-label">最近私聊 <span>${conversations.length}</span></div><div class="dm-list">${conversations.length?conversations.map(p=>`<a href="#chat/${p.id}" class="dm-row ${p.id===r.peer?'active':''} ${p.unread?'has-unread':''}" aria-label="与${escape(p.name)}聊天${p.unread?'，'+p.unread+'条未读':''}" ${p.id===r.peer?'aria-current="page"':''}>${avatar(p)}<span class="dm-copy"><span class="dm-title"><strong>${escape(p.name)}</strong>${p.at?`<time>${time(p.at)}</time>`:''}</span><span class="dm-preview"><small>${escape(p.preview||'开始聊天')}</small>${badge(p.unread)}</span></span></a>`).join(''):'<p class="dm-empty">暂无会话</p>'}</div>`);
  $('#view-title').textContent=r.peer?(peer?.name||'私聊'):r.requests?'好友申请':'好友列表';$('#view-icon').innerHTML=r.peer&&peer?avatar(peer,true):icon('people');
  setHTML($('#view-tools'),!account()?'':r.peer&&peer?`<span class="chat-peer-handle">@${escape(peer.username)}</span>`:`<wa-button class="ui-action" size="s" variant="brand" data-action="social-add">${icon('plus')}添加好友</wa-button>`);
  renderBadge();
 }
 function renderBadge(){
  const s=data(),n=s.unread+s.requests.filter(p=>p.incoming).length;
  $('.rail-home').removeAttribute('title');
  $('.rail-home').setAttribute('aria-label',`好友与聊天${n?'，'+n+'条提醒':''}`);
  $('#friends-entry-label').textContent=`好友与聊天${n?'，'+n+'条提醒':''}`;
  let indicator=$('#social-unread');if(!indicator){indicator=document.createElement('span');indicator.id='social-unread';indicator.className='rail-unread';$('.rail-home').append(indicator);}
  indicator.hidden=!n;indicator.textContent=n>99?'99+':String(n);
 }

 function gate(){return `<div class="welcome-empty"><div class="empty-room-symbol">${icon('people')}</div><h2>登录后查看好友</h2><div class="empty-actions"><button class="button primary" data-action="auth-login">登录账号</button><button class="button" data-action="auth-register">${getState().profile?'注册账号':'创建账号'}</button></div></div>`;}
 function render(){
  if(identity!==getVersion()){reading?.dispose();reading=null;identity=getVersion();mounted='';search='';currentPeer='';loadId++;cache.clear();drafts.clear();readIds.clear();attempts.clear();sending=false;}
  const r=route();$('#main').classList.toggle('chat-main',Boolean(r.peer)&&account());
  if(!account()){if(mounted!=='gate'){mounted='gate';$('#main').innerHTML=gate();}return;}
  if(r.peer){renderChat(r.peer);return;}
  reading?.dispose();reading=null;currentPeer='';loadId++;
  const kind=r.requests?'requests':'friends';
  if(mounted!==kind){mounted=kind;$('#main').innerHTML=`<div class="social-page"><div class="social-toolbar">${r.requests?'<h2 class="request-list-title">待处理申请</h2>':`<label class="friend-search">${icon('search')}<input id="friend-search" type="search" aria-label="搜索好友" placeholder="搜索昵称或用户名" value="${escape(search)}" autocomplete="off"></label>`}<span id="friend-count"></span></div><div id="friend-results"></div></div>`;
   $('#friend-search')?.addEventListener('input',e=>{search=e.target.value;drawFriends();});
  }
  if(r.requests)drawRequests();else drawFriends();
 }
 function drawFriends(){
  const all=data().friends,q=search.trim().toLowerCase(),friends=all.filter(p=>(p.name+' '+p.username).toLowerCase().includes(q));
  $('#friend-count').textContent=`${all.length} 位好友`;
  setHTML($('#friend-results'),friends.length?`<div class="friend-list">${friends.map(p=>`<div class="friend-row">${avatar(p,true)}<div class="friend-copy"><a class="profile-name-link" href="#profile/${p.id}"><strong>${escape(p.name)}</strong></a><small>@${escape(p.username)}</small></div><wa-button class="ui-action friend-message" size="s" appearance="plain" href="#chat/${p.id}" aria-label="给${escape(p.name)}发消息">${icon('chat')}<span>发消息</span></wa-button></div>`).join('')}</div>`:`<div class="social-empty">${icon('people')}<h3>${q?'没有匹配的好友':'还没有好友'}</h3>${q?'<p>换个昵称或用户名试试</p>':''}${q?'':'<button class="button" data-action="social-add">添加好友</button>'}</div>`);
 }
 function drawRequests(){
  const requests=data().requests;$('#friend-count').textContent=`${requests.length} 条申请`;
  setHTML($('#friend-results'),requests.length?`<div class="friend-list">${requests.map(p=>`<div class="friend-row">${avatar(p,true)}<div class="friend-copy"><a class="profile-name-link" href="#profile/${p.id}"><strong>${escape(p.name)}</strong></a><small>@${escape(p.username)} · ${p.incoming?'希望添加你为好友':'等待对方接受'}</small></div><div class="friend-actions">${p.incoming?`<wa-button class="ui-action" size="s" variant="brand" data-action="social-accept" data-peer="${p.id}">接受</wa-button><wa-button class="ui-action" size="s" appearance="plain" data-action="social-decline" data-peer="${p.id}">拒绝</wa-button>`:`<wa-button class="ui-action" size="s" appearance="plain" data-action="social-cancel" data-peer="${p.id}">取消申请</wa-button>`}</div></div>`).join('')}</div>`:`<div class="social-empty">${icon('people')}<h3>没有待处理的申请</h3></div>`);
 }
 function renderChat(peerId){
  const peer=data().friends.find(p=>p.id===peerId);
  if(!peer){mounted='missing';currentPeer='';$('#main').innerHTML='<div class="social-empty"><h3>暂时无法打开这段聊天</h3><p>请先添加对方为好友。</p><a class="button" href="#friends">返回好友列表</a></div>';return;}
  if(mounted!=='chat/'+peerId){
   reading?.dispose();
   mounted='chat/'+peerId;currentPeer=peerId;loadId++;
   $('#main').innerHTML=`<div class="chat-panel"><div class="chat-feed"><div id="message-list" class="message-list" role="log" tabindex="0" aria-label="聊天记录" aria-live="polite"><p class="chat-loading">正在加载聊天记录…</p></div><button class="text-button message-jump" type="button" hidden>回到最新消息 ${icon('down')}</button></div><form id="chat-form" class="chat-composer"><label class="sr-only" for="chat-input">发送给 ${escape(peer.name)} 的消息</label><textarea id="chat-input" aria-describedby="chat-shortcuts" rows="1" maxlength="2000" placeholder="发送消息给 ${escape(peer.name)}">${escape(drafts.get(peerId)||'')}</textarea><div class="composer-tools"><span id="chat-shortcuts" class="sr-only">Enter 发送，Shift + Enter 换行</span><button class="button small primary" type="submit">发送</button></div><p id="chat-error" class="form-error" role="alert" hidden></p></form></div>`;
   $('#chat-input').addEventListener('input',e=>{drafts.set(peerId,e.target.value);syncComposer();});
   syncComposer();
   $('#chat-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();$('#chat-form').requestSubmit();}});
   $('#chat-form').addEventListener('submit',e=>{e.preventDefault();send(peerId);});
   reading=createScrollAnchor($('#message-list'),$('.message-jump'),()=>void markRead(peerId));
   if(cache.has(peerId))drawMessages(peerId,true);
   void loadMessages(peerId);
  }else if(cache.has(peerId)){const position=reading.capture();drawMessages(peerId);reading.restore(position);}
 }
 function syncComposer(){const input=$('#chat-input'),button=$('#chat-form button[type=submit]');if(!input||!button)return;input.style.height='auto';input.style.height=Math.min(140,input.scrollHeight)+'px';button.disabled=sending||!input.value.trim();button.textContent=sending?'发送中…':'发送';button.setAttribute('aria-busy',String(sending));}
 const atBottom=()=>reading?.atBottom()||false;
 async function loadMessages(peerId,older=false){
  const id=++loadId,version=getVersion(),initial=cache.get(peerId),before=older&&initial?.messages[0]?.id;
  try{
   const result=await api(`/api/chats/${peerId}/messages${before?'?before='+before:''}`);
   if(id!==loadId||version!==getVersion()||currentPeer!==peerId)return;
   const error=$('#chat-error');if(error?.dataset.kind==='load')error.hidden=true;
   const old=cache.get(peerId),position=reading.capture(),stick=!old||position.bottom;
   const reset=!older&&old?.messages.length&&result.hasMore&&old.messages.at(-1).id<result.messages[0]?.id;
   const merged=new Map((reset?[]:old?.messages||[]).map(m=>[m.id,m]));for(const m of result.messages)merged.set(m.id,m);
   cache.set(peerId,{messages:[...merged.values()].sort((a,b)=>a.id-b.id),loaded:true,hasMore:older||reset?result.hasMore:old?.loaded?old.hasMore:result.hasMore});
   drawMessages(peerId,!older&&stick);
   reading.restore(position,{older,follow:!older&&stick});
   if(!older&&stick)markRead(peerId);
  }catch(error){if(id===loadId&&version===getVersion()&&currentPeer===peerId){
   if(!cache.has(peerId))setHTML($('#message-list'),`<div class="message-load-error"><p>${escape(error.message)}</p><button class="button small" type="button" data-action="social-retry">重新加载</button></div>`);
   else{const el=$('#chat-error');if(el){el.dataset.kind='load';el.innerHTML=`${escape(error.message)} <button class="text-button" type="button" data-action="social-retry">重试</button>`;el.hidden=false;}}
  }}
 }
 function drawMessages(peerId,stick=false){
  const peer=data().friends.find(p=>p.id===peerId),history=cache.get(peerId);if(!history||!peer)return;
  let lastDay='',previous=null;
  const today=new Date().toLocaleDateString('zh-CN');
  const messages=history.messages.map(m=>{
   const day=new Date(m.at).toLocaleDateString('zh-CN'),person=m.self?getState().profile:peer;
   const grouped=previous&&previous.self===m.self&&day===lastDay&&m.at-previous.at<300000;
   const separator=day!==lastDay?`<div class="chat-day"><span>${day===today?'今天':day}</span></div>`:'';
   lastDay=day;previous=m;
   return `${separator}<article data-message-id="${m.id}" class="chat-message ${m.self?'mine':''} ${grouped?'continuation':''}">${grouped?`<time class="continuation-time" aria-label="发送时间 ${time(m.at)}">${time(m.at)}</time>`:avatar(person,true)}<div class="message-content">${grouped?'':`<div class="message-byline"><strong>${escape(person.name)}</strong><time datetime="${new Date(m.at).toISOString()}">${time(m.at)}</time></div>`}<p>${escape(m.content)}</p></div></article>`;
  }).join('');
  setHTML($('#message-list'),`${history.hasMore?'<button class="text-button history-button" data-action="social-older">加载更早的消息</button>':''}${messages||`<div class="chat-beginning">${avatar(peer,true)}<h3>${escape(peer.name)}</h3><p>这是你们的私聊，说声你好吧。</p></div>`}`);
  if(stick)$('#message-list').scrollTop=$('#message-list').scrollHeight;reading?.update();
 }
 async function markRead(peerId){
  if(document.visibilityState!=='visible'||currentPeer!==peerId||!atBottom())return;
  const history=cache.get(peerId);if(!history)return;
  const id=history.messages.at(-1)?.id||0;if(readIds.has(peerId)&&readIds.get(peerId)>=id)return;
  const version=getVersion();readIds.set(peerId,id);
  try{await realtime('chat.read',{peerId,uptoId:id});}catch{if(version===getVersion())readIds.delete(peerId);}
 }
 async function send(peerId){
  if(sending)return;const input=$('#chat-input'),content=input.value.trim();if(!content)return;
  const old=attempts.get(peerId),request=old?.content===content?old:{content,clientId:crypto.randomUUID()};attempts.set(peerId,request);
  const version=getVersion(),button=$('#chat-form button[type=submit]');sending=true;syncComposer();$('#chat-error').hidden=true;
  try{
   const message=await realtime('chat.send',{peerId,...request});
   if(version!==getVersion())return;
   receive({type:'chat.message',peerId,message});
   attempts.delete(peerId);if(currentPeer===peerId&&input.value.trim()===content){input.value='';drafts.delete(peerId);syncComposer();}
   if(currentPeer===peerId){if($('#message-list')){$('#message-list').scrollTop=$('#message-list').scrollHeight;markRead(peerId);}input.focus();}
  }catch(error){if(version===getVersion()&&currentPeer===peerId){$('#chat-error').dataset.kind='send';$('#chat-error').textContent=error.message+'，可再次点击发送重试。';$('#chat-error').hidden=false;}}
  finally{if(version===getVersion()){sending=false;if(button.isConnected)button.disabled=false;syncComposer();}}
 }
 function receive(event){
  if(event.type!=='chat.message')return;
  const {peerId,message}=event;if(currentPeer!==peerId){cache.delete(peerId);return;}const history=cache.get(peerId);
  if(!history&&currentPeer!==peerId)return;
  if(history?.messages.some(item=>item.id===message.id))return;
  const position=currentPeer===peerId&&reading?reading.capture():null;
  const messages=new Map((history?.messages||[]).map(item=>[item.id,item]));messages.set(message.id,message);
  cache.set(peerId,{...history,messages:[...messages.values()].sort((a,b)=>a.id-b.id),loaded:history?.loaded||false,hasMore:history?.hasMore??true});
  if(position){drawMessages(peerId);reading.restore(position);if(position.bottom)void markRead(peerId);}
 }
 async function resync(){
  const peerId=currentPeer,history=cache.get(peerId);if(!peerId)return;
  if(!history?.loaded||!history.messages.length){await loadMessages(peerId);return;}
  const version=getVersion(),request=++loadId;let cursor=history.messages.at(-1).id;
  try{for(;;){
   const result=await api(`/api/chats/${peerId}/messages?after=${cursor}`);
   if(version!==getVersion()||request!==loadId||currentPeer!==peerId)return;
   const position=reading.capture(),latest=cache.get(peerId),messages=new Map(latest.messages.map(message=>[message.id,message]));
   for(const message of result.messages)messages.set(message.id,message);
   cache.set(peerId,{...latest,messages:[...messages.values()].sort((a,b)=>a.id-b.id)});drawMessages(peerId);reading.restore(position);
   if(!result.hasMore||!result.messages.length)break;cursor=result.messages.at(-1).id;
  }const error=$('#chat-error');if(error?.dataset.kind==='load')error.hidden=true;void markRead(peerId);
  }catch(error){if(version===getVersion()&&request===loadId&&currentPeer===peerId){const element=$('#chat-error');element.dataset.kind='load';element.innerHTML=`${escape(error.message)} <button class="text-button" data-action="social-retry">重试</button>`;element.hidden=false;}}
 }
 async function handle(action,target){
  if(action==='social-retry'){target.disabled=true;try{await resync();}finally{if(target.isConnected)target.disabled=false;}return;}
  if(action==='social-add'){
   if(!account()){openAuth(getState().profile?'register':'login');return;}
   smallDialog('添加好友',`<p class="dialog-description">输入对方的用户名。对方接受后，你们就可以聊天。</p><form id="friend-form"><div class="field"><label for="friend-username">对方的用户名</label><input id="friend-username" name="username" autocomplete="off" autocapitalize="none" spellcheck="false" pattern="[A-Za-z0-9_]{3,24}" maxlength="24" required placeholder="例如 alex_01"></div><p id="friend-error" class="form-error" role="alert" hidden></p><button class="button primary full" type="submit">发送好友申请</button></form>`);
   formHandler($('#friend-form'),'#friend-error',async body=>{await api('/api/friends/request',body);$('#small-dialog').close();await refresh();location.hash='friends/requests';toast('好友申请已发送');});$('#friend-username').focus();return;
  }
  if(action==='social-older'){target.disabled=true;await loadMessages(currentPeer,true);if(target.isConnected)target.disabled=false;return;}
  if(['social-accept','social-decline','social-cancel'].includes(action)){
   target.disabled=true;try{await api(`/api/friends/${target.dataset.peer}/${action.slice(7)}`,{});await refresh();toast(action==='social-accept'?'已添加好友':action==='social-cancel'?'已取消申请':'已拒绝申请');}catch(error){toast(error.message);}finally{target.disabled=false;}
  }
 }
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&currentPeer)void resync();});
 return {renderShell,render,renderBadge,handle,receive,resync,leave(){reading?.dispose();reading=null;mounted='';currentPeer='';loadId++;$('#main').classList.remove('chat-main');}};
}
