import './focus.js';
import {mountNavigationMotion,miningFeedback} from './motion.js';
import {bindForm,mountDialogs,normalizeRoomCode} from './interaction.js';
mountDialogs();
import {loginPagePath,useLoginPage} from './auth/session.js';
import {mountDesktopLogin,loadDesktopAccount} from './desktop-login.js';
import {mountDesktopNotifications} from './desktop-notifications.js';
import './ui.js';
import {parseInstances} from './instances.js';
import {createRealtime,applyStatePatch} from './realtime.js';
import {createSocialUI} from './social.js';
import {createProfileUI} from './profile.js';
import {avatarHTML} from './avatars.js';
import {createCommunityUI} from './community.js';
import {createPlayUI,isDesktopClient} from './play.js';
mountDesktopNotifications();
const desktop=isDesktopClient();
document.documentElement.dataset.client=desktop?'desktop':'web';
document.querySelector('[data-action="game-library"]').hidden=!desktop;
document.getElementById('web-client-download').hidden=desktop;
document.querySelector('.connection-state').hidden=!desktop;
if(desktop)document.querySelector('.preview-label').textContent='桌面版';
const $=s=>document.querySelector(s),escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shapes={volume:'<path d="M11 4 6 8H3v8h3l5 4V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',mic:'<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/>',micOff:'<path d="m3 3 18 18M9 9v3a3 3 0 0 0 5 2M9 5a3 3 0 0 1 6 0v4M5 10v2a7 7 0 0 0 12 5m2-5v-2m-7 9v3m-4 0h8"/>',headphones:'<path d="M3 14v-3a9 9 0 0 1 18 0v3"/><rect x="3" y="12" width="4" height="9" rx="2"/><rect x="17" y="12" width="4" height="9" rx="2"/>',headphonesOff:'<path d="m3 3 18 18M3 14v-3a9 9 0 0 1 1-4m4-4a9 9 0 0 1 13 8v3"/><rect x="3" y="12" width="4" height="9" rx="2"/><path d="M17 17v2a2 2 0 0 0 4 0"/>',hangup:'<path d="M5 3H3v3c0 8.3 6.7 15 15 15h3v-5l-5-2-2 3a13 13 0 0 1-7-7l3-2-2-5H5Z"/><path d="m16 3 5 5m0-5-5 5"/>',send:'<path d="m3 3 18 9-18 9 4-9-4-9Zm4 9h14"/>',hash:'<path d="m10 3-4 18m12-18-4 18M4 9h17M2 15h17"/>',chat:'<path d="M4 4h16v12H9l-5 4V4Z"/><path d="M8 8h8M8 12h5"/>',search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',plus:'<path d="M12 5v14M5 12h14"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',help:'<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 4h.01"/>',settings:'<path d="m9 3-1 3-3 1v4l2 1v2l-2 1v3l3 1 1 2h5l1-2 3-1v-3l-2-1v-2l2-1V7l-3-1-1-3Z"/><circle cx="11.5" cy="12" r="3"/>',gamepad:'<path d="M7 6h10c3 0 5 10 3 12-1 1-4-2-5-3H9c-1 1-4 4-5 3-2-2 0-12 3-12ZM7 9v5m-2.5-2.5h5M16 10h.01M18 13h.01"/>',home:'<path d="m3 10 9-7 9 7v10H3Zm6 10v-7h6v7"/>',people:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a4 4 0 0 1 3 4v2"/>',cube:'<path d="m12 3 9 5v8l-9 5-9-5V8Zm0 9v9M3 8l9 4 9-4"/>',link:'<path d="m9 15 6-6m-5-3 2-2a5 5 0 0 1 7 7l-2 2m-3 5-2 2a5 5 0 0 1-7-7l2-2"/>',copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/>',lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',unlock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7-2m-3 9v3"/>',door:'<path d="M13 4H4v16h9m2-13 5 5-5 5m-5-5h10"/>',chevron:'<path d="m9 5 7 7-7 7"/>',down:'<path d="m6 9 6 6 6-6"/>',image:'<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',check:'<path d="m5 12 4 4L19 6"/>',monitor:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>'};
const icon=name=>`<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name]||shapes.cube}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
const params=new URLSearchParams(location.search),isGuest=params.get('guest')==='1';
const sessionStore=isGuest?sessionStorage:localStorage,sessionKey='blockroom-device-session-v1';
let state={profile:null,rooms:[]},session=sessionStore.getItem(sessionKey),timer,lastRender='',refreshing=null,dialogMode='join',dialogImage='',settingsImage='',busy=false;
let authVersion=0,authBusy=false,pendingAction=null,realtime=null;
function saveSession(value){session=value;if(value)sessionStore.setItem(sessionKey,value);else sessionStore.removeItem(sessionKey);}
const activeRooms=()=>state.rooms.filter(r=>!r.closed);
const route=()=>{const parts=location.hash.slice(1).split('/');return{room:parts[0]==='room'?state.rooms.find(r=>r.id===parts[1]):null,tab:parts[2]||'chat'};};
const initials=name=>{const clean=String(name||'房间').trim();return /^[\x00-\x7F]+$/.test(clean)?clean.replace(/\s+/g,'').slice(0,2).toUpperCase():Array.from(clean).slice(0,2).join('');};
const picture=(room,cls='')=>`<span class="room-picture ${cls}">${room.image?`<img src="${escape(room.image)}" alt="" draggable="false">`:escape(initials(room.name))}</span>`;
const formatTime=t=>new Date(t).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
const errorBox=id=>`<p class="form-error" id="${id}" role="alert" hidden></p>`;
const loaders=['原版','Fabric','Forge','NeoForge'];
function setHTML(el,html){if(el.innerHTML!==html)el.innerHTML=html;}
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(timer);timer=setTimeout(()=>$('#toast').hidden=true,3400);}
async function api(path,body,token=session){
 try{const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});const result=await response.json().catch(()=>null);if(!response.ok)throw Object.assign(new Error(result?.error||'服务暂时不可用，请稍后重试'),{status:response.status});if(result===null)throw new Error('服务器返回异常，请稍后重试');return result;}
 catch(error){if(error.name==='TimeoutError')throw new Error('连接超时，请重试');if(error instanceof TypeError)throw new Error('无法连接服务器，请检查网络后重试');throw error;}
}
const realtimeRequest=(type,body)=>realtime?realtime.request(type,body):Promise.reject(new Error('实时连接正在建立，请稍后重试'));
const socialUI=createSocialUI({api,realtime:realtimeRequest,getState:()=>state,getVersion:()=>authVersion,icon,escape,initials,setHTML,toast,openAuth,smallDialog,formHandler,refresh});
const playUI=createPlayUI({api,escape,icon,smallDialog,formHandler,refresh,toast,getVersion:()=>authVersion});
const communityUI=createCommunityUI({api,realtime:realtimeRequest,getState:()=>state,getVersion:()=>authVersion,escape,initials,icon,setHTML,toast,smallDialog,formHandler,refresh});
const profileUI=createProfileUI({api,getState:()=>state,getVersion:()=>authVersion,icon,escape,setHTML,toast,openAuth,formHandler,refresh});
const navigationMotion=mountNavigationMotion({rail:$('.room-rail'),sidebar:$('.room-sidebar'),content:$('#main')});
function renderShell(){navigationMotion.sync();const {room,tab}=route(),selected=room&&!room.closed?room:null;
 setHTML($('#room-icons'),activeRooms().map(r=>`<a class="room-icon ${r.id===selected?.id?'selected':''}" href="#room/${r.id}/chat" title="${escape(r.name)}" aria-label="房间：${escape(r.name)}" ${r.id===selected?.id?'aria-current="page"':''}>${picture(r)}${r.community?.unread?`<span class="room-unread">${r.community.unread>99?'99+':r.community.unread}</span>`:''}</a>`).join(''));
 $('.rail-home').classList.toggle('selected',!selected&&!profileUI.active());$('.rail-home').setAttribute('aria-current',!selected&&!profileUI.active()?'page':'false');socialUI.renderBadge();
 setHTML($('#account-entry'),state.profile?avatarHTML(state.profile):'登录');$('#account-entry').setAttribute('aria-current',profileUI.active()&&profileUI.own()?'page':'false');$('#account-entry').title=state.profile?state.profile.name+' · '+(state.profile.username?'@'+state.profile.username:'访客'):'登录 / 注册';$('#account-entry').setAttribute('aria-label',state.profile?'个人主页':'登录账号');
 if(profileUI.active()){socialUI.leave();profileUI.shell();return;}
 if(!selected){socialUI.renderShell();return;}
 socialUI.leave();$('.workspace').classList.remove('social-mode');playUI.sync(selected);
 setHTML($('#room-heading'),`<div class="room-heading-line"><h2 title="${escape(selected.name)}">${escape(selected.name)}</h2>${selected.hasPassword?icon('lock'):icon('down')}</div><span class="room-number">房间号 ${selected.code}</span>`);
 const nav=[['chat','hash','房间聊天'],['overview','home','房间概览'],['members','people','成员列表'],...(desktop?[['game','gamepad','游戏环境']]:[]),...(selected.isHost?[['settings','settings','房间设置']]:[])];
 setHTML($('#room-nav'),nav.map(([key,symbol,name])=>`<a href="#room/${selected.id}/${key}" class="channel ${tab===key?'active':''}" ${tab===key?'aria-current="page"':''}>${icon(symbol)}<span>${name}</span>${key==='members'?`<span class="channel-count">${selected.members.length}</span>`:''}</a>`).join(''));
 communityUI.sidebar(selected);
 const titles={chat:'房间聊天',overview:'房间概览',members:'成员列表',game:'游戏环境',settings:'房间设置'};
 $('#view-title').textContent=titles[tab]||titles.overview;$('#view-icon').innerHTML=icon({chat:'hash',members:'people',game:'gamepad',settings:'settings'}[tab]||'home');
 setHTML($('#view-tools'),`${tab==='chat'?'<button class="icon-button room-members-toggle" data-action="community-members" aria-label="显示成员列表" aria-expanded="false">'+icon('people')+'</button>':''}<button class="button small" data-action="invite">${icon('people')}邀请朋友</button>`);
}
function overview(r){return `<div class="room-overview"><div class="room-identity">${picture(r,'large')}<div><div class="identity-title"><h2>${escape(r.name)}</h2></div>${r.description?`<p>${escape(r.description)}</p>`:''}<div class="identity-meta"><span>${icon('people')}${r.members.length} / ${r.capacity} 位成员</span><span>${icon(r.hasPassword?'lock':'unlock')}${r.hasPassword?'密码房间':'无需密码'}</span></div></div></div>
${playUI.panel(r)}<section class="room-invitation"><div><h3>房间号</h3></div><div class="code-actions"><strong class="room-code">${r.code}</strong><button class="icon-button" data-action="copy-code" aria-label="复制房间号" title="复制房间号">${icon('copy')}</button></div></section>
<div class="overview-columns"><section class="game-summary"><div class="section-title"><h3>游戏环境</h3>${desktop?`<a class="text-link" href="#room/${r.id}/game">${r.isHost?'配置环境':'查看详情'} ${icon('chevron')}</a>`:''}</div><dl class="summary-fields"><div><dt>游戏版本</dt><dd>${r.version?'Java '+escape(r.version):'未设置'}</dd></div><div><dt>模组环境</dt><dd>${escape(r.loader)}</dd></div>${desktop&&(r.connection?.port||r.port)?`<div><dt>局域网端口</dt><dd>${r.connection?.port||r.port}</dd></div>`:''}</dl></section><section class="activity"><div class="section-title"><h3>房间动态</h3></div><div class="event-list">${r.events.slice(-5).reverse().map(e=>`<div class="event"><span class="event-dot"></span><p>${escape(e.message)}</p><time>${formatTime(e.at)}</time></div>`).join('')}</div></section></div>
<div class="overview-bottom"><span>${icon('monitor')}房主：${escape(r.hostName)}</span><button class="text-button ${r.isHost?'danger-text':''}" data-action="${r.isHost?'close-room':'leave-room'}">${icon('door')}${r.isHost?'关闭房间':'退出房间'}</button></div></div>`;}
function members(r){return `<div class="page-body"><div class="member-table"><div class="member-table-head"><span>成员</span><span>角色</span><span>房间状态</span></div>${r.members.map(m=>`<div class="member-row"><div>${avatarHTML(m,{link:true})}<a class="profile-name-link" href="#profile/${m.id}"><strong>${escape(m.name)}</strong></a>${m.self?'<small>我</small>':''}</div><span>${m.host?'房主':'成员'}</span><span class="joined-label">已加入</span></div>`).join('')}</div></div>`;}
function game(r){if(!desktop)return `<div class="page-body client-required-page">${playUI.requiredPanel()}</div>`;const configs=parseInstances(localStorage.getItem('blockroom-instances'));return `<div class="page-body">${r.isHost?'':'<p class="readonly-caption">由房主设置</p>'}${r.isHost?`<form id="game-form" class="settings-form">${configs.length?`<div class="field"><label for="saved-instance">使用已保存的实例配置</label><select id="saved-instance"><option value="">手动填写</option>${configs.map(c=>`<option value="${escape(c.id)}">${escape(c.name)} / ${escape(c.version)}</option>`).join('')}</select></div>`:''}<div class="field-grid"><div class="field"><label for="game-version">Minecraft 版本</label><input id="game-version" name="version" maxlength="30" value="${escape(r.version)}" placeholder="例如 1.21.1"></div><div class="field"><label for="game-loader">模组环境</label><select id="game-loader" name="loader">${loaders.map(l=>`<option ${l===r.loader?'selected':''}>${l}</option>`).join('')}</select></div></div><div class="field"><label for="game-port">局域网端口</label><input id="game-port" name="port" type="number" min="1024" max="65535" value="${r.port||''}" placeholder="例如 51234"><small>在 MC 中「对局域网开放」后查看端口。</small></div>${errorBox('game-error')}<button class="button primary" type="submit">保存游戏环境</button></form>`:`<dl class="readonly-fields"><div><dt>Minecraft 版本</dt><dd>${r.version?escape(r.version):'尚未填写'}</dd></div><div><dt>模组环境</dt><dd>${escape(r.loader)}</dd></div><div><dt>局域网端口</dt><dd>${r.connection?.port||r.port||'尚未填写'}</dd></div></dl>`}</div>`;}
function avatarField(room,prefix){return `<div class="avatar-field"><label class="image-picker" for="${prefix}-image"><span class="image-preview" id="${prefix}-preview">${room.image?`<img src="${escape(room.image)}" alt="房间图片">`:escape(initials(room.name))}</span><span class="image-overlay">${icon('image')}</span></label><input type="file" id="${prefix}-image" class="file-input" accept="image/png,image/jpeg,image/webp" aria-label="上传房间图片"><div><strong>房间图片</strong><div class="image-actions"><label for="${prefix}-image" class="text-link" tabindex="0">上传图片</label><button type="button" class="text-button" data-action="remove-image" data-prefix="${prefix}">移除图片</button></div></div></div>`;}
function settings(r){if(!r.isHost)return `<div class="page-body"><h2>只有房主可以修改房间设置</h2></div>`;settingsImage=r.image;return `<div class="page-body"><form id="settings-form" class="settings-form">${avatarField(r,'settings')}<div class="field"><label for="settings-name">房间名称</label><input id="settings-name" name="name" value="${escape(r.name)}" required maxlength="40"></div><div class="field"><label for="room-description">房间介绍</label><textarea id="room-description" name="description" maxlength="240" rows="3" placeholder="写下房间介绍或联机约定">${escape(r.description)}</textarea></div><div class="field-grid"><div class="field"><label for="room-capacity">成员上限</label><input id="room-capacity" name="capacity" type="number" min="2" max="32" value="${r.capacity}" required></div><div class="field"><label for="password-mode">房间密码</label><select id="password-mode" name="passwordMode"><option value="keep">${r.hasPassword?'保持当前密码':'保持无密码'}</option><option value="set">设置 / 更换密码</option><option value="remove">取消密码</option></select></div></div><div class="field" id="new-password-field" hidden><label for="new-password">新密码</label><input id="new-password" name="password" type="password" maxlength="64" autocomplete="new-password"><small>密码仅对之后加入的成员生效，不会移出现有成员。</small></div>${errorBox('settings-error')}<button class="button primary" type="submit">保存修改</button></form><div class="danger-zone"><div><h3>关闭房间</h3><p>关闭后，房间号失效，所有成员将无法继续使用这个房间。</p></div><button class="button danger" data-action="close-room">关闭房间</button></div></div>`;}
function render(force=false){communityUI.sync();renderShell();if(profileUI.active()){communityUI.leave();socialUI.leave();$('#main').classList.remove('room-chat-main');lastRender='';profileUI.render(force);return;}profileUI.leave();const chatRoute=route();$('#main').classList.toggle('room-chat-main',!!chatRoute.room&&!chatRoute.room.closed&&chatRoute.tab==='chat');if(chatRoute.tab!=='chat'||!chatRoute.room||chatRoute.room.closed)communityUI.leave();const {room,tab}=route();if(!room||room.closed){lastRender='';socialUI.render(force);return;}if(tab==='chat'){lastRender='';communityUI.render(room);return;}const key=JSON.stringify({route:location.hash,room,profile:state.profile});if(!force&&key===lastRender)return;if(!force&&['game','settings'].includes(tab)&&room&&!room.closed)return;lastRender=key;
 $('#main').innerHTML=tab==='members'?members(room):tab==='game'?game(room):tab==='settings'?settings(room):overview(room);bindMainForms();
}
let refreshAgain=false,refreshForce=false;
async function refresh(force=false){
 refreshAgain=true;refreshForce ||= force;
 if(refreshing)return refreshing;
 refreshing=(async()=>{while(refreshAgain){
  refreshAgain=false;const forceRender=refreshForce;refreshForce=false;
  const version=authVersion;
  try{const result=await api('/api/state');if(version!==authVersion)continue;if(Number(result.revision)>=Number(state.revision||0))state=result;if(!realtime||realtime.connected)$('#offline').hidden=true;render(forceRender);}
  catch(e){if(version!==authVersion)continue;$('#offline').hidden=false;if(e.status===401&&!authBusy){clearIdentity();toast('登录已失效，请重新登录');}}
 }})();
 try{await refreshing;}finally{refreshing=null;}
}
function formHandler(form,errorId,callback){
 const labels={'join-form':['正在加入房间','已加入房间'],'create-form':['正在创建房间','房间已创建']};
 return bindForm(form,$(errorId),async values=>{
  const labelsForForm=labels[form.id];if(!labelsForForm)return callback(values);
  const task=miningFeedback.start(labelsForForm[0],{success:labelsForForm[1],host:form});
  try{const result=await callback(values);task.done();return result;}catch(error){task.fail(error);throw error;}
 });
}
function bindMainForms(){const room=route().room;formHandler($('#game-form'),'#game-error',async b=>{await api(`/api/rooms/${room.id}/game`,b);await refresh(true);toast('游戏环境已保存');});formHandler($('#settings-form'),'#settings-error',async b=>{await api(`/api/rooms/${room.id}/settings`,{...b,image:settingsImage});await refresh(true);toast('房间设置已保存');});
 $('#password-mode')?.addEventListener('change',e=>{$('#new-password-field').hidden=e.target.value!=='set';$('#new-password').required=e.target.value==='set';});
 $('#saved-instance')?.addEventListener('change',e=>{const item=parseInstances(localStorage.getItem('blockroom-instances')).find(i=>i.id===e.target.value);if(item){$('#game-version').value=item.version;$('#game-loader').value=item.loader;$('#game-port').value=item.port;}});
 bindImage('settings');$('#settings-name')?.addEventListener('input',()=>updateImagePreview('settings'));
}
function updateImagePreview(prefix){const data=prefix==='create'?dialogImage:settingsImage,name=$(`#${prefix}-name`)?.value||'房间';const target=$(`#${prefix}-preview`);if(target)target.innerHTML=data?`<img src="${escape(data)}" alt="房间图片">`:escape(initials(name));}
async function readImage(file){if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('请选择 PNG、JPEG 或 WebP 图片');if(file.size>8*1024*1024)throw new Error('请选择小于 8MB 的图片');const image=await createImageBitmap(file);try{if(image.width<1||image.height<1)throw new Error('图片无法读取');const canvas=document.createElement('canvas');canvas.width=192;canvas.height=192;const context=canvas.getContext('2d'),side=Math.min(image.width,image.height);context.drawImage(image,(image.width-side)/2,(image.height-side)/2,side,side,0,0,192,192);return canvas.toDataURL('image/png');}finally{image.close();}}
function bindImage(prefix){$(`#${prefix}-image`)?.addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;const form=e.target.closest('form'),submit=form.querySelector('[type="submit"]');submit.disabled=true;try{const data=await readImage(file);if(prefix==='create')dialogImage=data;else settingsImage=data;updateImagePreview(prefix);}catch(err){toast(err.message);}finally{submit.disabled=false;e.target.value='';}});}
function openRoomDialog(mode='join'){if(!state.profile){pendingAction=mode;openAuth('login');return;}dialogMode=mode;dialogImage='';const join=mode==='join';$('#join-tab').setAttribute('aria-selected',String(join));$('#create-tab').setAttribute('aria-selected',String(!join));$('#join-tab').tabIndex=join?0:-1;$('#create-tab').tabIndex=join?-1:0;
 $('#room-dialog-body').innerHTML=join?`<h2 id="dialog-title">加入房间</h2><p class="dialog-description">向朋友获取房间号，进入同一个房间。</p><form id="join-form"><div class="field"><label for="join-code">房间号</label><input id="join-code" name="code" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" data-validation="房间号需要 6 位数字" placeholder="输入 6 位房间号" value="${escape(params.get('code')||'')}" required autocomplete="off"></div><div class="field"><label for="join-password">房间密码 <span>可选</span></label><input id="join-password" name="password" type="password" maxlength="64" placeholder="无密码房间可留空" autocomplete="off"></div>${errorBox('join-error')}<button class="button primary full" type="submit">加入房间</button></form>`:`<h2 id="dialog-title">创建房间</h2><p class="dialog-description">创建后，将房间号分享给朋友。</p><form id="create-form">${avatarField({name:'房间',image:''},'create')}<div class="field"><label for="create-name">房间名称</label><input id="create-name" name="name" placeholder="例如 WZ 或周末生存" maxlength="40" required></div><div class="field-grid"><div class="field"><label for="create-password">加入密码 <span>可选</span></label><input id="create-password" name="password" type="password" maxlength="64" placeholder="留空则无需密码" autocomplete="new-password"></div><div class="field"><label for="create-capacity">成员上限</label><select id="create-capacity" name="capacity"><option value="8">8 人</option><option value="4">4 人</option><option value="16">16 人</option><option value="32">32 人</option></select></div></div>${errorBox('create-error')}<button class="button primary full" type="submit">创建房间</button></form>`;
 formHandler($('#join-form'),'#join-error',async b=>{const room=await api('/api/join',b);$('#room-dialog').close();await refresh();location.hash=`room/${room.id}/chat`;toast('已加入房间');});
 formHandler($('#create-form'),'#create-error',async b=>{const room=await api('/api/rooms',{...b,image:dialogImage});$('#room-dialog').close();await refresh();location.hash=`room/${room.id}/chat`;toast('房间已创建');});
 const code=$('#join-code');if(code){code.addEventListener('input',()=>{const value=normalizeRoomCode(code.value);if(code.value!==value)code.value=value;});code.addEventListener('paste',event=>{const value=normalizeRoomCode(event.clipboardData.getData('text'));if(value.length===6){event.preventDefault();code.value=value;code.dispatchEvent(new Event('input',{bubbles:true}));}});}
 bindImage('create');$('#create-name')?.addEventListener('input',()=>updateImagePreview('create'));if(!$('#room-dialog').open)$('#room-dialog').showModal();$(join?'#join-code':'#create-name').focus();
}
function smallDialog(title,content){$('#small-dialog-body').innerHTML=`<h2 id="small-title">${title}</h2>${content}`;$('#small-dialog').showModal();}
async function copyCode(room){try{await navigator.clipboard.writeText(room.code);toast('房间号已复制');}catch{toast('无法访问剪贴板，请选中房间号手动复制');}}
document.addEventListener('click',async e=>{const target=e.target.closest('[data-action]');if(!target)return;const action=target.dataset.action,room=route().room;
 if(action.startsWith('community-')){await communityUI.handle(action,target);return;}
 if(action==='game-library'){if(desktop)await window.blockroomDesktop.openLibrary();else location.assign('/downloads/client/windows');return;}
 if(action.startsWith('play-')){await playUI.handle(action,target,room);return;}
 if(action.startsWith('profile-')){await profileUI.handle(action,target);return;}
 if(action.startsWith('social-')){await socialUI.handle(action,target);return;}
 if(action==='add'||action==='dialog-join')return openRoomDialog('join');if(action==='create'||action==='dialog-create')return openRoomDialog('create');if(action==='dismiss')return target.closest('dialog').close();
 if(action==='remove-image'){const prefix=target.dataset.prefix;if(prefix==='create')dialogImage='';else settingsImage='';updateImagePreview(prefix);return;}
 if(action==='auth-login'||action==='auth-register'){openAuth(action==='auth-login'?'login':'register');return;}
 if(action==='toggle-password'){const input=document.getElementById(target.dataset.target),show=input.type==='password';input.type=show?'text':'password';target.textContent=show?'隐藏':'显示';target.setAttribute('aria-pressed',String(show));return;}
 if(action==='guest-start'){try{streamController?.abort();const result=await api('/api/session',{name:'访客玩家'},null);saveSession(result.id);state=await api('/api/state');render(true);startRealtime();}catch(err){toast(err.message);}return;}
 if(action==='logout'){
  if(authBusy)return;authBusy=true;target.disabled=true;streamController?.abort();
  try{await api('/api/auth/logout',{});clearIdentity();$('#small-dialog').close();location.hash='home';announceAuth();if(useLoginPage({desktop:window.blockroomDesktop,guest:isGuest,profile:state.profile})){location.replace('/login');return;}toast('已退出登录');}
  catch(err){toast(err.message);startRealtime();}finally{authBusy=false;target.disabled=false;}return;
 }
 if(action==='profile'){if(!state.profile){openAuth('login');return;}location.hash='profile/'+state.profile.id;return;}
 if(action==='help'&&!desktop){smallDialog('使用帮助',`<ol class="help-steps"><li><strong>加入房间</strong><p>点击左侧「＋」，输入房间号和密码，或创建自己的房间。</p></li><li><strong>聊天与语音</strong><p>在好友页私聊，或在房间里发送消息、加入语音分组。</p></li><li><strong>MC 联机</strong><p>游戏库与 MC 联机请使用客户端。</p><a class="button primary small" href="/downloads/client/windows">下载客户端</a></li></ol>`);return;}
 if(action==='help'){smallDialog('使用帮助',`<ol class="help-steps"><li><strong>加入房间</strong><p>点击左侧「＋」，输入房间号和密码，或创建自己的房间。</p></li><li><strong>开始联机</strong><p>房主在 MC 中「对局域网开放」，填写端口后启动连接程序。成员连接后，将本机地址填入 MC 多人游戏。</p></li><li><strong>保持游戏运行</strong><p>关闭房主世界或连接程序会断开联机。成员的游戏版本与模组需和房主一致。</p></li><li><strong>好友与账号</strong><p>注册后可添加好友、私聊并在其他设备登录。joincraft 账号与微软游戏账号独立。</p></li></ol>`);return;}
 if(!room||room.closed)return;if(action==='copy-code')return copyCode(room);
 if(action==='invite'){smallDialog('邀请朋友',`<p class="dialog-description">让朋友点击左侧「＋」，输入下面的房间号。</p><div class="share-code"><span>${room.code}</span><button class="icon-button" data-action="copy-code" aria-label="复制房间号">${icon('copy')}</button></div><p class="share-security">${icon(room.hasPassword?'lock':'unlock')}${room.hasPassword?'此房间设有密码，请另行告知朋友。':'此房间无需密码，知道房间号即可加入。'}</p><a class="button full" href="/app/?guest=1&code=${room.code}" target="_blank" rel="noopener">以访客身份打开 ${icon('chevron')}</a>`);return;}
 if(action==='close-room'||action==='leave-room'){const close=action==='close-room';smallDialog(close?'关闭这个房间？':'退出这个房间？',`<p class="dialog-description">${close?'所有成员将无法继续使用这个房间，房间号立即失效。此操作不会删除游戏存档。':'房间将从左侧列表移除。之后可以使用房间号和密码重新加入。'}</p><div class="confirm-actions"><button class="button" data-action="dismiss">取消</button><button class="button ${close?'danger':'primary'}" data-action="confirm-${close?'close':'leave'}">${close?'关闭房间':'退出房间'}</button></div>`);return;}
 if(action==='confirm-close'||action==='confirm-leave'){if(busy)return;busy=true;target.disabled=true;try{await api(`/api/rooms/${room.id}/${action==='confirm-close'?'close':'leave'}`,{});$('#small-dialog').close();await refresh();location.hash='home';toast(action==='confirm-close'?'房间已关闭':'已退出房间');}catch(err){toast(err.message);}finally{busy=false;target.disabled=false;}}
});
$('.dialog-tabs').addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();openRoomDialog(dialogMode==='join'?'create':'join');$(dialogMode==='join'?'#join-tab':'#create-tab').focus();}});
document.addEventListener('keydown',e=>{if(e.target.matches('label[tabindex]')&&(e.key==='Enter'||e.key===' ')){e.preventDefault();document.getElementById(e.target.htmlFor)?.click();}});
window.addEventListener('hashchange',()=>{render(true);$('#main').scrollTop=0;$('#main').focus({preventScroll:true});navigationMotion.transition();});
function clearIdentity(){
 void communityUI.disconnect();
 authVersion++;streamController?.abort();saveSession(null);state={profile:null,rooms:[]};lastRender='';
 $('#room-dialog').close();$('#offline').hidden=true;render(true);
}
async function init(){
 const version=authVersion;
 try{
  let result=null;
  if(!isGuest){try{result=await api('/api/state',undefined,null);if(version===authVersion)saveSession(null);}catch(e){if(e.status!==401)throw e;}}
  if(!result&&session){try{result=await api('/api/state');}catch(e){if(e.status!==401)throw e;if(version===authVersion)saveSession(null);}}
  if(!result&&isGuest&&version===authVersion){const guest=await api('/api/session',{name:'访客玩家'},null);saveSession(guest.id);result=await api('/api/state');}
  if(version!==authVersion)return;
  if(!result&&useLoginPage({desktop:window.blockroomDesktop,guest:isGuest,profile:state.profile})){location.replace(loginPagePath('login',location.pathname+location.search+location.hash,location.origin));return;}
  state=result||{profile:null,rooms:[]};$('#offline').hidden=true;render(true);
 }catch{if(version===authVersion){$('#offline').hidden=false;render(true);}}
}
let streamController;
function startRealtime(){
 streamController?.abort();if(!state.profile)return;streamController=new AbortController();
 const version=authVersion;
 realtime=createRealtime({getHeaders:()=>session?{Authorization:`Bearer ${session}`}:{},
  onState:(value,full)=>{if(version!==authVersion)return;if(full){if(Number(value.revision)>=Number(state.revision||0))state=value;}else state=applyStatePatch(state,value);render();},
  onEvent:event=>{if(version!==authVersion)return;socialUI.receive(event);communityUI.receive(event);},
  onReady:()=>{if(version===authVersion){socialUI.resync();communityUI.resync();}},
  onUnauthorized:()=>{if(version===authVersion&&!authBusy){clearIdentity();toast('登录已失效，请重新登录');}},
  onStatus:connected=>{if(version===authVersion&&state.profile&&!authBusy)$('#offline').hidden=connected;},signal:streamController.signal});
}
function announceAuth(){if(!isGuest)localStorage.setItem('blockroom-auth-change',String(Date.now()));}
function passwordInput(id,label,autocomplete){return `<div class="field"><label for="${id}">${label}</label><div class="password-control"><input id="${id}" name="${id==='auth-confirm'?'confirm':'password'}" type="password" maxlength="64" ${autocomplete==='new-password'?'minlength="10"':''} autocomplete="${autocomplete}" required><button type="button" class="text-button" data-action="toggle-password" data-target="${id}" aria-label="${label}显示或隐藏" aria-pressed="false">显示</button></div></div>`;}
const desktopLogin=mountDesktopLogin({escape,onBusy:value=>{authBusy=value;},onSuccess:async({profileId})=>{
 void communityUI.disconnect();streamController?.abort();const version=++authVersion;saveSession(null);
 const result=await loadDesktopAccount(()=>api('/api/state',undefined,null),profileId);
 if(version!==authVersion)throw Object.assign(new Error('登录状态已变化，请重新登录'),{status:409});
 state=result;lastRender='';$('#offline').hidden=true;render(true);announceAuth();startRealtime();
},onComplete:()=>{
 if(isGuest){location.assign('/app/#friends');return;}
 if(pendingAction){const action=pendingAction;pendingAction=null;openRoomDialog(action);}else location.hash='friends';
 toast('登录成功');
}});
function openAuth(mode='login'){
 if(authBusy)return;
 // Registering an existing guest still binds that guest's rooms to the new account.
 if(desktopLogin&&!(mode==='register'&&state.profile?.kind==='guest')){$('#small-dialog').close();$('#room-dialog').close();void desktopLogin.open(mode);return;}
 if(useLoginPage({desktop:window.blockroomDesktop,guest:isGuest,profile:state.profile})){location.assign(loginPagePath(mode,location.pathname+location.search+location.hash,location.origin));return;}
const register=mode==='register';$('#small-dialog').close();$('#room-dialog').close();
 $('#auth-body').innerHTML=`<h2 id="auth-title">${register?'创建账号':'登录joincraft'}</h2><p class="dialog-description">${register&&state.profile?'当前访客的房间和成员身份会绑定到新账号。':register?'用一个账号，保存你的房间。':'登录后，房间会跟随你的账号。'}</p>${!register&&state.profile?.kind==='guest'&&activeRooms().length?'<p class="auth-note">登录已有账号不会合并当前访客房间。如需保留，请先注册账号。</p>':''}<form id="auth-form"><div class="field"><label for="auth-username">用户名</label><input id="auth-username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" pattern="[A-Za-z0-9_]{3,24}" minlength="3" maxlength="24" required placeholder="3–24 位字母、数字或下划线"></div>${register?`<div class="field"><label for="auth-name">玩家昵称</label><input id="auth-name" name="name" maxlength="24" value="${escape(state.profile?.name||'')}" autocomplete="nickname" placeholder="房间中显示的名字，可稍后修改"></div>`:''}${passwordInput('auth-password','密码',register?'new-password':'current-password')}${register?`<p class="password-hint">10–64 个字符。</p>${passwordInput('auth-confirm','确认密码','new-password')}`:''}${errorBox('auth-error')}<button class="button primary full" type="submit">${register?'创建账号并登录':'登录'}</button></form><div class="auth-switch">${register?'已有账号？':'还没有账号？'}<button class="text-link" data-action="auth-${register?'login':'register'}">${register?'去登录':'创建账号'}</button></div>${register?'<p class="dialog-footnote">暂未提供密码找回，请妥善保存密码。这是joincraft账号，无需输入微软账号密码。</p>':''}`;
 formHandler($('#auth-form'),'#auth-error',async body=>{
  if(register&&body.password!==body.confirm)throw new Error('两次输入的密码不一致');
  authBusy=true;void communityUI.disconnect();streamController?.abort();
  try{
   await api('/api/auth/'+(register?'register':'login'),body);
   authVersion++;saveSession(null);$('#auth-dialog').close();
   if(isGuest){location.assign('/app/#home');return;}
   await init();announceAuth();startRealtime();
   if(pendingAction){const action=pendingAction;pendingAction=null;openRoomDialog(action);}
   else location.hash='friends';
   toast(register?'账号已创建':'登录成功');
  }finally{authBusy=false;startRealtime();}
 });
 if(!$('#auth-dialog').open)$('#auth-dialog').showModal();$('#auth-username').focus();
}
window.addEventListener('pagehide',()=>streamController?.abort());
window.addEventListener('pageshow',e=>{if(e.persisted){init().then(startRealtime);}});
window.addEventListener('storage',e=>{if(!isGuest&&(e.key===sessionKey||e.key==='blockroom-auth-change')){void communityUI.disconnect();authVersion++;session=sessionStore.getItem(sessionKey);init().then(startRealtime);}});
await init();if(params.get('code'))openRoomDialog('join');startRealtime();
