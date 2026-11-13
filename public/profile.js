import {AVATARS,avatarURL,avatarName,avatarHTML} from './avatars.js';
export function createProfileUI({api,getState,getVersion,icon,escape,setHTML,toast,openAuth,formHandler,refresh}){
 const $=s=>document.querySelector(s);
 let mounted='',rendered='',loading='',serial=0,person=null,draft=null,identity=getVersion();
 const syncIdentity=()=>{if(identity!==getVersion()){identity=getVersion();draft=null;}};
 const parts=()=>location.hash.slice(1).split('/');
 const active=()=>parts()[0]==='profile';
 const id=()=>parts()[1]||getState().profile?.id||'';
 const editing=()=>parts()[2]==='edit'&&id()===getState().profile?.id;
 const own=()=>id()===getState().profile?.id;
 const date=t=>new Date(t).toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric'});
 function shell(){
  const self=own(),edit=editing();$('.workspace').classList.add('profile-mode');$('.workspace').classList.remove('social-mode');
  setHTML($('#room-heading'),`<div class="room-heading-line"><h2>${self?'个人中心':'玩家资料'}</h2></div>`);
  setHTML($('#room-nav'),`<a class="channel ${!edit?'active':''}" href="#profile/${encodeURIComponent(id())}" ${!edit?'aria-current="page"':''}>${icon('people')}<span>个人主页</span></a>${self?`<a class="channel ${edit?'active':''}" href="#profile/${encodeURIComponent(id())}/edit" ${edit?'aria-current="page"':''}>${icon('settings')}<span>编辑资料</span></a>`:''}<a class="channel" href="#friends">${icon('chat')}<span>好友与聊天</span></a>`);
  setHTML($('#sidebar-info'),'');setHTML($('#view-tools'),'');$('#view-title').textContent=edit?'编辑资料':'个人主页';$('#view-icon').innerHTML=icon(edit?'settings':'people');
 }
 function leave(){syncIdentity();if(mounted||loading){serial++;mounted='';rendered='';loading='';person=null;}$('.workspace').classList.remove('profile-mode');}
 function render(){
  syncIdentity();if(!active())return;
  shell();const state=getState(),route=location.hash+'@'+getVersion();
  if(!state.profile){$('#main').innerHTML=`<div class="welcome-empty"><h2>登录后查看个人主页</h2><button class="button primary" data-action="auth-login">登录账号</button></div>`;return;}
  if(editing()&&mounted===route)return; // Preserve unsaved choices during SSE refreshes.
  const key=route+':'+JSON.stringify(own()?state.profile:state.revision);
  if(rendered===key||loading===key)return;
  if(own()){
   serial++;loading='';person={...state.profile,self:true,rooms:state.rooms.filter(r=>!r.closed)};draw(route,key);return;
  }
  const request=++serial,version=getVersion(),target=id();loading=key;
  if(mounted!==route)$('#main').innerHTML='<div class="profile-loading" role="status" aria-label="正在加载个人资料"><span></span><span></span><span></span></div>';
  api('/api/profiles/'+encodeURIComponent(target)).then(value=>{
   if(request!==serial||version!==getVersion()||!active()||id()!==target)return;
   person=value;draw(route,key);
  }).catch(error=>{
   if(request!==serial||version!==getVersion()||!active()||id()!==target)return;
   mounted=route;$('#main').innerHTML=`<div class="social-empty"><h2>暂时无法查看个人主页</h2><p>${escape(error.message)}</p><div class="empty-actions"><button class="button" data-action="profile-retry">重试</button><a class="button" href="#friends">返回好友列表</a></div></div>`;
  }).finally(()=>{if(request===serial)loading='';});
 }
 function draw(route,key){
  mounted=route;rendered=key;$('#main').innerHTML=editing()?editor(person):home(person);
  if(editing())bindEditor();
 }
 function home(p){
  const self=p.self,rooms=p.rooms||[];
  const action=self?`<a class="button" href="#profile/${p.id}/edit">${icon('settings')}编辑资料</a>`:p.friendship==='accepted'?`<a class="button primary" href="#chat/${p.id}">${icon('chat')}发消息</a>`:p.friendship==='pending'?p.requestIncoming?`<button class="button primary" data-action="social-accept" data-peer="${p.id}">接受好友申请</button>`:'<button class="button" disabled>已发送好友申请</button>':p.username&&getState().profile?.username?'<button class="button primary" data-action="profile-add-friend">添加好友</button>':'';
  return `<article class="profile-page"><header class="profile-identity">${avatarHTML(p,{className:'profile-portrait'})}<div class="profile-identity-copy"><h2>${escape(p.name)}</h2><p>${p.username?'@'+escape(p.username):'访客玩家'}</p></div><div class="profile-primary-action">${action}</div></header><dl class="profile-facts"><div><dt>加入 joincraft</dt><dd><time datetime="${new Date(p.createdAt).toISOString()}">${date(p.createdAt)}</time></dd></div><div><dt>账号类型</dt><dd>${p.username?'joincraft 账号':'访客'}</dd></div></dl><section class="profile-about"><h3>${self?'关于我':'个人简介'}</h3>${p.bio?`<p class="profile-bio">${escape(p.bio)}</p>`:`<p class="profile-bio empty-bio">${self?'写点什么，让朋友更了解你。':'这个玩家还没写简介。'}</p>`}</section><section class="profile-rooms"><div class="profile-section-heading"><h3>${self?'我的房间':'共同房间'}</h3><span>${rooms.length}</span></div>${rooms.length?`<ul>${rooms.map(r=>`<li><a href="#room/${r.id}/chat"><span class="profile-room-picture">${r.image?`<img src="${escape(r.image)}" alt="">`:icon('cube')}</span><strong>${escape(r.name)}</strong>${icon('chevron')}</a></li>`).join('')}</ul>`:`<p class="profile-room-empty">${self?'还没有加入房间。':'你们还没有共同房间。'}</p>`}${self&&!rooms.length?'<button class="text-button" data-action="add">加入或创建房间</button>':''}</section>${self?`<footer class="profile-account-actions">${p.username?'<button class="text-button danger-text" data-action="logout">退出登录</button>':'<button class="button primary" data-action="auth-register">注册并保留资料</button><button class="text-button" data-action="auth-login">登录已有账号</button><button class="text-button danger-text" data-action="logout">结束访客会话</button>'}</footer>`:''}<p id="profile-action-error" class="form-error" role="alert" hidden></p></article>`;
 }
 function editor(p){
  const values=draft?.id===p.id?{...p,...draft.values}:p;
  return `<div class="profile-page profile-edit-page"><form id="profile-form"><div class="profile-avatar-preview">${avatarHTML(values,{className:'profile-portrait'})}<div><h2>选一个你的头像</h2><p id="profile-avatar-name">${avatarName(values.avatarId)}</p></div></div><fieldset class="profile-avatar-picker"><legend>默认头像</legend><div class="profile-avatar-grid">${AVATARS.map(a=>`<label class="profile-avatar-option"><input type="radio" name="avatarId" value="${a.id}" ${a.id===values.avatarId?'checked':''} required><span><img src="${avatarURL(a.id)}" alt="" width="48" height="48" draggable="false"><span>${a.name}</span></span></label>`).join('')}</div></fieldset><div class="profile-edit-fields"><div class="field"><label for="profile-nickname">昵称</label><input id="profile-nickname" name="name" value="${escape(values.name)}" maxlength="24" required autocomplete="nickname"><small>房间和聊天中显示的名字</small></div><div class="field"><label for="profile-bio">个人简介 <span>可选</span></label><textarea id="profile-bio" name="bio" maxlength="240" rows="3" placeholder="喜欢玩的整合包、你的建筑计划…" aria-describedby="profile-bio-count">${escape(values.bio)}</textarea><div class="profile-bio-count" id="profile-bio-count">${values.bio.length} / 240</div></div><div class="profile-readonly"><span>用户名</span><strong>${p.username?'@'+escape(p.username):'访客尚未绑定账号'}</strong></div><p id="profile-error" class="form-error" role="alert" hidden></p><div class="profile-save-actions"><p id="profile-draft-status" role="status"></p><div><button class="button" type="button" data-action="profile-cancel">取消</button><button class="button primary" type="submit" disabled>保存资料</button></div></div></div></form></div>`;
 }
 function bindEditor(){
  const form=$('#profile-form'),status=$('#profile-draft-status');
  function track(){
   if(!form.isConnected)return;
   const values=Object.fromEntries(new FormData(form)),saved=getState().profile;
   if(!saved)return;
   const changed=['name','bio','avatarId'].some(key=>values[key]!==saved[key]);
   draft=changed?{id:saved.id,values}:null;
   form.querySelector('[type="submit"]').disabled=!changed||form.getAttribute('aria-busy')==='true';
   status.textContent=changed?'有未保存的修改':'';
   $('#profile-bio-count').textContent=values.bio.length+' / 240';
   $('#profile-bio-count').classList.toggle('near-limit',values.bio.length>=220);
  }
  form.addEventListener('input',track);form.addEventListener('change',track);form.addEventListener('form:complete',track);
  form.addEventListener('change',e=>{if(e.target.name==='avatarId'){const avatar=e.target.value;$('.profile-avatar-preview img').src=avatarURL(avatar);$('#profile-avatar-name').textContent=avatarName(avatar);}});
  formHandler(form,'#profile-error',async body=>{const version=getVersion(),route=location.hash;await api('/api/profile',body);if(version!==getVersion())return;draft=null;await refresh();if(version!==getVersion())return;if(location.hash===route)location.hash='profile/'+getState().profile.id;toast('个人资料已保存');});
  track();
 }
 async function handle(action,target){
  if(action==='profile-cancel'){draft=null;location.hash='profile/'+getState().profile.id;return;}
  if(action==='profile-retry'){rendered='';mounted='';render();return;}
  if(action==='profile-add-friend'&&person?.username){const version=getVersion();target.disabled=true;try{await api('/api/friends/request',{username:person.username});if(version!==getVersion())return;await refresh();toast('好友申请已发送');}catch(error){const el=$('#profile-action-error');if(el){el.textContent=error.message;el.hidden=false;}}finally{if(target.isConnected)target.disabled=false;}}
 }
 return {active,own,shell,render,leave,handle};
}
