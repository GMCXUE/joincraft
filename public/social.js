export function createSocialUI({api,getState,getVersion,icon,escape,initials,setHTML,toast,openAuth,smallDialog,formHandler,refresh}) {
 const $=s=>document.querySelector(s),empty={friends:[],requests:[],conversations:[],unread:0};
 let mounted='',search='',currentPeer='',loadId=0,identity=-1,sending=false;
 const cache=new Map(),drafts=new Map(),readIds=new Map(),attempts=new Map();
 const data=()=>getState().social||empty;
 const account=()=>Boolean(getState().profile?.username);
 const route=()=>{const parts=location.hash.slice(1).split('/');return{peer:parts[0]==='chat'?parts[1]:null,requests:parts[0]==='friends'&&parts[1]==='requests'};};
 const avatar=p=>`<wa-avatar class="member-avatar" shape="rounded" initials="${escape(initials(p.name))}" label="${escape(p.name)}" aria-hidden="true"></wa-avatar>`;
 const badge=n=>n?`<wa-badge class="unread-badge" variant="brand" appearance="accent">${n>99?'99+':n}</wa-badge>`:'';
 const time=t=>new Date(t).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
 function renderShell(){
  const r=route(),s=data(),incoming=s.requests.filter(p=>p.incoming).length,peer=s.friends.find(p=>p.id===r.peer);
  $('.workspace').classList.add('social-mode');
  setHTML($('#room-heading'),`<div class="room-heading-line"><h2>好友与聊天</h2></div>`);
  setHTML($('#room-nav'),`<a class="channel ${!r.peer&&!r.requests?'active':''}" href="#friends" ${!r.peer&&!r.requests?'aria-current="page"':''}>${icon('people')}<span>全部好友</span><span class="channel-count">${s.friends.length}</span></a><a class="channel ${r.requests?'active':''}" href="#friends/requests" ${r.requests?'aria-current="page"':''}>${icon('clock')}<span>好友申请</span>${badge(incoming)}</a>`);
  const conversations=[...s.conversations];if(peer&&!conversations.some(p=>p.id===peer.id))conversations.unshift({...peer,preview:'',unread:0});
  setHTML($('#sidebar-info'),`<div class="sidebar-section-label">最近私聊 <span>${conversations.length}</span></div><div class="dm-list">${conversations.length?conversations.map(p=>`<a href="#chat/${p.id}" class="dm-row ${p.id===r.peer?'active':''} ${p.unread?'has-unread':''}" aria-label="与${escape(p.name)}聊天${p.unread?'，'+p.unread+'条未读':''}" ${p.id===r.peer?'aria-current="page"':''}>${avatar(p)}<span class="dm-copy"><span class="dm-title"><strong>${escape(p.name)}</strong>${p.at?`<time>${time(p.at)}</time>`:''}</span><span class="dm-preview"><small>${escape(p.preview||'开始聊天')}</small>${badge(p.unread)}</span></span></a>`).join(''):'<p class="dm-empty">暂无会话</p>'}</div>`);
  $('#view-title').textContent=r.peer?(peer?.name||'私聊'):r.requests?'好友申请':'好友列表';$('#view-icon').innerHTML=r.peer&&peer?avatar(peer):icon('people');
  setHTML($('#view-tools'),r.peer&&peer?`<span class="chat-peer-handle">@${escape(peer.username)}</span>`:`<wa-button class="ui-action" size="s" variant="brand" data-action="social-add">${icon('plus')}添加好友</wa-button>`);
  renderBadge();
 }
 function renderBadge(){
  const s=data(),n=s.unread+s.requests.filter(p=>p.incoming).length;
  $('.rail-home').removeAttribute('title');
  $('.rail-home').setAttribute('aria-label',`好友与聊天${n?'，'+n+'条提醒':''}`);
  $('#friends-entry-label').textContent=`好友与聊天${n?'，'+n+'条提醒':''}`;
  let indicator=$('#social-unread');if(!indicator){indicator=document.createElement('wa-badge');indicator.id='social-unread';indicator.className='rail-unread';indicator.setAttribute('variant','brand');$('.rail-home').append(indicator);}
  indicator.hidden=!n;indicator.textContent=String(Math.min(99,n));
 }

 function gate(){return `<div class="welcome-empty"><div class="empty-room-symbol">${icon('people')}</div><h2>登录后查看好友</h2><p>${getState().profile?'注册账号后，就可以添加好友、收发消息。':'添加朋友，或继续上次的聊天。'}</p><div class="empty-actions"><button class="button primary" data-action="auth-login">登录账号</button><button class="button" data-action="auth-register">${getState().profile?'注册账号':'创建账号'}</button></div></div>`;}
 function render(){
  if(identity!==getVersion()){identity=getVersion();mounted='';search='';currentPeer='';loadId++;cache.clear();drafts.clear();readIds.clear();attempts.clear();sending=false;}
  const r=route();$('#main').classList.toggle('chat-main',Boolean(r.peer)&&account());
  if(!account()){if(mounted!=='gate'){mounted='gate';$('#main').innerHTML=gate();}return;}
  if(r.peer){renderChat(r.peer);return;}
  currentPeer='';loadId++;
  const kind=r.requests?'requests':'friends';
  if(mounted!==kind){mounted=kind;$('#main').innerHTML=`<div class="social-page"><div class="social-toolbar">${r.requests?'<h2 class="request-list-title">待处理申请</h2>':`<label class="friend-search">${icon('search')}<input id="friend-search" type="search" aria-label="搜索好友" placeholder="搜索昵称或用户名" value="${escape(search)}" autocomplete="off"></label>`}<span id="friend-count"></span></div><div id="friend-results"></div></div>`;
   $('#friend-search')?.addEventListener('input',e=>{search=e.target.value;drawFriends();});
  }
  if(r.requests)drawRequests();else drawFriends();
 }
 function drawFriends(){
  const all=data().friends,q=search.trim().toLowerCase(),friends=all.filter(p=>(p.name+' '+p.username).toLowerCase().includes(q));
  $('#friend-count').textContent=`${all.length} 位好友`;
  setHTML($('#friend-results'),friends.length?`<div class="friend-list">${friends.map(p=>`<div class="friend-row">${avatar(p)}<div class="friend-copy"><strong>${escape(p.name)}</strong><small>@${escape(p.username)}</small></div><wa-button class="ui-action friend-message" size="s" appearance="plain" href="#chat/${p.id}" aria-label="给${escape(p.name)}发消息">${icon('chat')}<span>发消息</span></wa-button></div>`).join('')}</div>`:`<div class="social-empty">${icon('people')}<h3>${q?'没有匹配的好友':'还没有好友'}</h3><p>${q?'换一个昵称或用户名试试。':'通过用户名添加朋友，同意后就可以聊天。'}</p>${q?'':'<button class="button" data-action="social-add">添加好友</button>'}</div>`);
 }
 function drawRequests(){
  const requests=data().requests;$('#friend-count').textContent=`${requests.length} 条申请`;
  setHTML($('#friend-results'),requests.length?`<div class="friend-list">${requests.map(p=>`<div class="friend-row">${avatar(p)}<div class="friend-copy"><strong>${escape(p.name)}</strong><small>@${escape(p.username)} · ${p.incoming?'希望添加你为好友':'等待对方接受'}</small></div><div class="friend-actions">${p.incoming?`<wa-button class="ui-action" size="s" variant="brand" data-action="social-accept" data-peer="${p.id}">接受</wa-button><wa-button class="ui-action" size="s" appearance="plain" data-action="social-decline" data-peer="${p.id}">拒绝</wa-button>`:`<wa-button class="ui-action" size="s" appearance="plain" data-action="social-cancel" data-peer="${p.id}">取消申请</wa-button>`}</div></div>`).join('')}</div>`:`<div class="social-empty">${icon('people')}<h3>没有待处理的申请</h3><p>收到或发出的好友申请会显示在这里。</p></div>`);
 }
 function renderChat(peerId){
  const peer=data().friends.find(p=>p.id===peerId);
  if(!peer){mounted='missing';currentPeer='';$('#main').innerHTML='<div class="social-empty"><h3>暂时无法打开这段聊天</h3><p>请先添加对方为好友。</p><a class="button" href="#friends">返回好友列表</a></div>';return;}
  if(mounted!=='chat/'+peerId){
   mounted='chat/'+peerId;currentPeer=peerId;loadId++;
   $('#main').innerHTML=`<div class="chat-panel"><div id="message-list" class="message-list" role="log" aria-label="聊天记录" aria-live="polite"><p class="chat-loading">正在加载聊天记录…</p></div><form id="chat-form" class="chat-composer"><label class="sr-only" for="chat-input">发送给 ${escape(peer.name)} 的消息</label><textarea id="chat-input" rows="1" maxlength="2000" placeholder="发送消息给 ${escape(peer.name)}">${escape(drafts.get(peerId)||'')}</textarea><div class="composer-tools"><span>Enter 发送 · Shift + Enter 换行</span><button class="button small primary" type="submit">发送</button></div><p id="chat-error" class="form-error" role="alert" hidden></p></form></div>`;
   $('#chat-input').addEventListener('input',e=>{drafts.set(peerId,e.target.value);syncComposer();});
   syncComposer();
   $('#chat-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('#chat-form').requestSubmit();}});
   $('#chat-form').addEventListener('submit',e=>{e.preventDefault();send(peerId);});
   $('#message-list').addEventListener('scroll',()=>{if(atBottom())markRead(peerId);});
   if(cache.has(peerId))drawMessages(peerId,true);
  }
  loadMessages(peerId);
 }
 function syncComposer(){const input=$('#chat-input'),button=$('#chat-form button[type=submit]');if(!input||!button)return;input.style.height='auto';input.style.height=Math.min(120,input.scrollHeight)+'px';button.disabled=sending||!input.value.trim();}
 const atBottom=()=>{const el=$('#message-list');return el&&el.scrollHeight-el.scrollTop-el.clientHeight<60;};
 async function loadMessages(peerId,older=false){
  const id=++loadId,version=getVersion(),old=cache.get(peerId),before=older&&old?.messages[0]?.id;
  try{
   const result=await api(`/api/chats/${peerId}/messages${before?'?before='+before:''}`);
   if(id!==loadId||version!==getVersion()||currentPeer!==peerId)return;
   const error=$('#chat-error');if(error?.dataset.kind==='load')error.hidden=true;
   const el=$('#message-list'),height=el.scrollHeight,top=el.scrollTop,stick=!old||atBottom();
   const reset=!older&&old?.messages.length&&result.hasMore&&old.messages.at(-1).id<result.messages[0]?.id;
   const merged=new Map((reset?[]:old?.messages||[]).map(m=>[m.id,m]));for(const m of result.messages)merged.set(m.id,m);
   cache.set(peerId,{messages:[...merged.values()].sort((a,b)=>a.id-b.id),hasMore:older||reset?result.hasMore:old?.messages.length?old.hasMore:result.hasMore});
   drawMessages(peerId,!older&&stick);
   if(older)el.scrollTop=top+el.scrollHeight-height;
   else if(stick)markRead(peerId);
  }catch(error){if(version===getVersion()&&currentPeer===peerId){const el=$('#chat-error');if(el){el.dataset.kind='load';el.textContent=error.message;el.hidden=false;}}}
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
   return `${separator}<article class="chat-message ${m.self?'mine':''} ${grouped?'continuation':''}">${grouped?`<time class="continuation-time" aria-label="发送时间 ${time(m.at)}">${time(m.at)}</time>`:avatar(person)}<div class="message-content">${grouped?'':`<div class="message-byline"><strong>${escape(person.name)}</strong><time datetime="${new Date(m.at).toISOString()}">${time(m.at)}</time></div>`}<p>${escape(m.content)}</p></div></article>`;
  }).join('');
  setHTML($('#message-list'),`${history.hasMore?'<button class="text-button history-button" data-action="social-older">加载更早的消息</button>':''}${messages||`<div class="chat-beginning">${avatar(peer)}<h3>${escape(peer.name)}</h3><p>这是你们的私聊，说声你好吧。</p></div>`}`);
  if(stick)$('#message-list').scrollTop=$('#message-list').scrollHeight;
 }
 async function markRead(peerId){
  if(document.visibilityState!=='visible'||currentPeer!==peerId||!atBottom())return;
  const history=cache.get(peerId);if(!history)return;
  const id=history.messages.at(-1)?.id||0;if(readIds.has(peerId)&&readIds.get(peerId)>=id)return;
  const version=getVersion();readIds.set(peerId,id);
  try{await api(`/api/chats/${peerId}/read`,{uptoId:id});}catch{if(version===getVersion())readIds.delete(peerId);}
 }
 async function send(peerId){
  if(sending)return;const input=$('#chat-input'),content=input.value.trim();if(!content)return;
  const old=attempts.get(peerId),request=old?.content===content?old:{content,clientId:crypto.randomUUID()};attempts.set(peerId,request);
  const version=getVersion(),button=$('#chat-form button[type=submit]');sending=true;button.disabled=true;$('#chat-error').hidden=true;
  try{
   await api(`/api/chats/${peerId}/messages`,request);
   if(version!==getVersion())return;
   attempts.delete(peerId);if(currentPeer===peerId&&input.value.trim()===content){input.value='';drafts.delete(peerId);syncComposer();}
   if(currentPeer===peerId){await loadMessages(peerId);if($('#message-list')){$('#message-list').scrollTop=$('#message-list').scrollHeight;markRead(peerId);}input.focus();}
  }catch(error){if(version===getVersion()&&currentPeer===peerId){$('#chat-error').dataset.kind='send';$('#chat-error').textContent=error.message+'，可再次点击发送重试。';$('#chat-error').hidden=false;}}
  finally{sending=false;button.disabled=false;syncComposer();}
 }
 async function handle(action,target){
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
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&currentPeer)loadMessages(currentPeer);});
 return {renderShell,render,renderBadge,handle,leave(){mounted='';currentPeer='';loadId++;$('#main').classList.remove('chat-main');}};
}
