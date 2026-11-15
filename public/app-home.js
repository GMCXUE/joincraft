import {avatarHTML} from './avatars.js';
export const COMMUNITY_QQ='319301567';
export const isAppHome=hash=>!hash||hash==='#'||hash.replace(/^#/,'').split('/')[0]==='home';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function rankHomeRooms(rooms=[],visits={}){
 return rooms.filter(room=>!room.closed).slice().sort((a,b)=>(visits[b.id]||0)-(visits[a.id]||0)||(b.events?.at(-1)?.at||b.createdAt||0)-(a.events?.at(-1)?.at||a.createdAt||0));
}
const shortName=name=>Array.from(String(name||'房间').trim()).slice(0,2).join('');
const stamp=at=>Number.isSafeInteger(at)&&at>0?new Date(at).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}):'';
export function homeRoomList({rooms=[],icon,expanded=false}){
 if(!rooms.length)return `<div class="home-empty">${icon('people')}<div><h4>还没有加入房间</h4><p>创建一个房间，或输入朋友分享的房间号，一起集合。</p></div><button class="text-button" data-action="add">输入房间号 ${icon('chevron')}</button></div>`;
 return `<div class="home-room-list">${rooms.slice(0,expanded?100:3).map(room=>{
  const state=room.connection?.status||'offline',labels={offline:'尚未开房',waiting:'正在准备',online:'可以加入游戏',error:'连接已断开'};
  const online=Array.isArray(room.community?.online)?room.community.online.length:null,members=room.members||[];
  return `<a class="home-room-row" href="#room/${encodeURIComponent(room.id)}/overview" data-home-key="room-${escape(room.id)}"><span class="home-room-picture">${room.image?.startsWith('data:image/')?`<img src="${escape(room.image)}" alt="" width="44" height="44">`:escape(shortName(room.name))}</span><div class="home-room-copy"><div><strong title="${escape(room.name)}">${escape(room.name)}</strong>${room.community?.unread?`<span class="home-room-unread">${Math.min(99,room.community.unread)}${room.community.unread>99?'+':''} 条新消息</span>`:''}</div><p>${escape(room.pack?.name||(room.version?['Minecraft '+room.version,room.loader].filter(Boolean).join(' · '):'尚未设置游戏环境'))}</p><small>${members.length} 位成员${online===null?'':` · ${online} 位房间在线`}</small></div><div class="home-room-presence"><span class="home-room-status" data-state="${escape(state)}">${labels[state]||labels.offline}</span><div class="home-member-stack" aria-hidden="true">${members.slice(0,3).map(person=>avatarHTML(person)).join('')}</div></div><span class="home-room-enter">进入房间 ${icon('chevron')}</span></a>`;
 }).join('')}</div>`;
}
export function homeGameList({desktop,summary,recent,loading=false,recentLoading=false,error='',icon,pending}){
 if(!desktop)return `<div class="home-web-games">${icon('monitor')}<div><h4>用客户端继续你的冒险</h4><p>安装和启动整合包、查看本地存档，以及进入朋友的世界。</p></div><a class="button primary small" href="/downloads/client/windows">下载客户端</a></div>`;
 if(loading&&!summary)return '<p class="home-loading" role="status">正在读取本机游戏库…</p>';
 if(error&&!summary)return `<div class="home-empty"><div><h4>暂时无法读取游戏库</h4><p>${escape(error)}</p></div><button class="button small" data-action="home-retry">重新读取</button></div>`;
 const instances=recent?.instances||summary?.instances?.slice(0,3)||[],locked=!!pending||summary?.busy;
 if(!instances.length)return `<div class="home-empty">${icon('cube')}<div><h4>先安装一个整合包</h4><p>支持 .mrpack 和 .zip，安装后会保存在本机游戏库。</p></div><button class="button small" data-action="home-settings">前往安装 ${icon('chevron')}</button></div>`;
 return `<div class="home-game-grid">${instances.map(item=>{
  const selected=item.id===summary?.selectedId;
  const worldLabel=item.worldsUnavailable?'暂时无法读取存档':item.lastWorld?escape(item.lastWorld.name):recent?'暂无最近存档':recentLoading?'正在读取存档…':'在版本设置中查看存档';
  return `<article class="home-game-card${selected?' is-selected':''}"><div class="home-game-heading"><span class="home-pack-picture" aria-hidden="true">${escape(shortName(item.name))}</span><div><h4 title="${escape(item.name)}">${escape(item.name)}</h4><p>${escape([item.loader,item.minecraft&&'Minecraft '+item.minecraft].filter(Boolean).join(' · '))}</p></div></div><div class="home-game-world">${icon('cube')}<span>${worldLabel}</span></div><p class="home-game-time">${item.lastLaunchAt?`上次启动 ${stamp(item.lastLaunchAt)}`:item.lastWorld?`存档游玩于 ${stamp(item.lastWorld.lastPlayed)}`:recent&&!item.worldsUnavailable?'尚无游玩记录':''}${item.error?' · 环境需要检查':''}</p><div class="home-game-actions"><button class="button small${selected?' home-game-selected':''}" data-action="home-select" data-id="${escape(item.id)}" data-home-key="select-${escape(item.id)}" ${locked||selected?'disabled':''}>${icon(selected?'check':'gamepad')}${selected?'当前选择':'选择游玩'}</button><button class="text-button" data-action="home-configure" data-id="${escape(item.id)}" data-home-key="configure-${escape(item.id)}" ${locked?'disabled':''}>版本设置 ${icon('chevron')}</button></div></article>`;
 }).join('')}</div>`;
}
export function homeGuide({desktop,summary,rooms=[],profile,icon}){
 const installed=!!summary?.instances.length,identity=!!summary?.account?.ready,joined=rooms.length>0;
 const steps=desktop?[
  {title:'安装整合包',copy:installed?'本机游戏库已准备好':'将整合包导入 Joincraft',done:installed,action:'home-settings'},
  {title:'设置游戏身份',copy:identity?'游戏身份已就绪':'在左侧填写离线玩家名',done:identity,action:'home-identity'},
  {title:'在房间集合',copy:joined?'进入房间，准备一起开玩':'分享房间号，邀请朋友加入',done:joined,action:'add'}
 ]:[{title:'登录 joincraft',copy:profile?.username?'账号已登录':'保存好友、聊天和房间',done:!!profile?.username,action:'auth-login'},{title:'加入房间',copy:joined?'聊天与语音已经准备好':'输入房间号，和朋友集合',done:joined,action:'add'}];
 return `<h3>准备一次联机</h3><ol class="home-guide-steps">${steps.map((step,i)=>`<li${step.done?' class="is-complete"':''}><span class="home-step-mark" aria-hidden="true">${step.done?icon('check'):i+1}</span><div><strong>${step.title}</strong><p>${step.copy}</p>${!step.done?`<button class="text-button" data-action="${step.action}">${step.action==='home-identity'?'填写玩家名':'去完成'} ${icon('chevron')}</button>`:''}</div></li>`).join('')}</ol><button class="home-help-link text-button" data-action="help">${icon('help')}查看使用帮助 ${icon('chevron')}</button>`;
}
export function appHomeContent({desktop,icon}){
 return `<div class="app-home"><header class="app-home-welcome"><div><h2 class="app-home-title">一起上线，一起造。</h2><p>${desktop?'继续你的冒险，或者去房间找朋友。':'看看最近的房间，和朋友聊聊接下来的冒险。'}</p></div><div class="app-home-room-actions"><button class="button small" data-action="create">${icon('plus')}创建房间</button><button class="button small" data-action="add">${icon('link')}加入房间</button></div></header><div class="home-dashboard"><section class="home-rooms-section" aria-labelledby="home-rooms-title"><header class="home-section-heading"><h3 id="home-rooms-title">最近房间</h3><button class="text-button" id="home-room-more" data-action="home-room-more" aria-controls="home-rooms" aria-expanded="false" hidden>查看全部</button></header><div id="home-rooms"></div></section><section class="home-games-section" aria-labelledby="home-games-title"><header class="home-section-heading"><h3 id="home-games-title">${desktop?'最近游玩':'游戏与联机'}</h3>${desktop?`<button class="text-button" data-action="home-settings">管理游戏库 ${icon('chevron')}</button>`:''}</header><div id="home-games"></div></section><aside class="home-guide" id="home-guide" aria-label="联机准备"></aside></div><footer class="app-home-community"><div class="home-community-copy">${icon('chat')}<div><strong>joincraft 交流群</strong><p>找队友、聊玩法，也欢迎反馈问题。</p></div></div><div class="app-home-group"><span>QQ 群</span><strong>${COMMUNITY_QQ}</strong><button class="button small app-home-copy-group" data-action="copy-community" aria-label="复制 QQ 群号 ${COMMUNITY_QQ}">${icon('copy')}复制群号</button></div></footer></div>`;
}

export function homeSidebar({desktop,summary,loading,error,pending,icon,identitySupport=false,draftMode,draftName,identityError=''}){
 if(!desktop)return {heading:`<div class="home-web-identity">${icon('gamepad')}<h2>你的下一次冒险</h2><p>和朋友在房间集合，<br>用客户端一起进入世界。</p></div>`,nav:`<a class="button primary home-download" href="/downloads/client/windows">${icon('monitor')}下载客户端<small>Windows · x64</small></a><p class="home-web-caption">网页版支持好友、聊天和房间语音</p>`,info:''};
 const modern=!!summary,selected=summary?.instances.find(item=>item.id===summary.selectedId),account=summary?.account,locked=!!pending||summary?.busy||loading;
 const mode=draftMode||account?.mode||'offline',name=draftName??account?.offlineName??account?.name??'';
 const label=loading?'正在读取…':pending==='home-start'?'正在启动…':summary?.run?.state==='running'?'游戏运行中':summary?.busy&&!account?.busy?'任务进行中':modern?(selected?'启动游戏':'导入整合包'):'打开游戏库';
 const online=mode==='microsoft',accountPanel=identitySupport?(online?`<div class="home-microsoft"><strong>${escape(account?.profile?.name||'微软正版')}</strong><p>${account?.profile?'Java 版已授权':account?.busy?'在浏览器中完成授权':account?.configured?'登录拥有 Java 版的微软账号':'此版本暂未启用微软登录'}</p>${account?.deviceCode?`<output class="home-device-code">${escape(account.deviceCode)}</output><button class="button small" data-action="home-microsoft-page">打开微软授权页</button>`:account?.profile?`<button class="button small" data-action="${account.mode==='microsoft'?'home-logout':'home-use-microsoft'}" ${locked?'disabled':''}>${account.mode==='microsoft'?'退出微软账号':'使用此账号'}</button>`:`<button class="button small" data-action="home-login" ${locked||!account?.configured?'disabled':''}>${account?.busy?'等待授权…':'登录微软账号'}</button>${!account?.configured?'<button class="text-button" data-action="home-account" data-mode="offline">使用离线玩家</button>':''}`}</div>`:`<form id="home-identity-form" class="home-identity-form"><label for="home-player-name">离线玩家名</label><input id="home-player-name" aria-describedby="home-identity-note" value="${escape(name)}" autocomplete="off" maxlength="16" placeholder="3–16 位字母、数字或下划线" ${locked?'disabled':''}><button type="submit" class="button small" ${locked?'disabled':''}>保存玩家名</button><p id="home-identity-note" class="home-identity-note">这是游戏内的名字，与 joincraft 昵称独立。</p></form>`):`<strong>${escape(account?.name||(modern?'设置游戏身份':'本机游戏库'))}</strong><button class="text-button" data-action="home-account" data-mode="${account?.mode||'offline'}" ${locked?'disabled':''}>管理游戏身份 ${icon('chevron')}</button>`;
 return {heading:`<div class="home-account-tabs" role="group" aria-label="游戏账号"><button data-action="home-account" data-mode="offline" aria-pressed="${!online}" ${locked?'disabled':''}>离线玩家</button><button data-action="home-account" data-mode="microsoft" aria-pressed="${online}" ${locked?'disabled':''}>微软正版</button></div><div class="home-game-identity"><img src="/avatars/creeper-v1.svg" width="64" height="64" alt="默认游戏头像">${accountPanel}<p class="home-identity-error" role="alert" ${identityError?'':'hidden'}>${escape(identityError)}</p></div>`,nav:`<p class="home-launch-error" role="alert" ${error?'':'hidden'}>${escape(error)}</p><button class="button primary home-launch" data-action="${error&&!modern?'home-retry':modern&&selected?'home-start':'home-settings'}" ${locked?'disabled':''} aria-busy="${!!pending||loading}"><span>${icon('gamepad')}<strong>${error&&!modern?'重新读取':label}</strong></span><small title="${escape(selected?.name||'')}">${escape(selected?.name||(modern?'还没有已安装的整合包':'选择已安装的整合包'))}</small></button><div class="home-version-actions"><button class="button" data-action="home-versions" ${locked?'disabled':''}>版本选择${icon('down')}</button><button class="button" data-action="home-settings" ${pending||loading?'disabled':''}>${icon('settings')}版本设置</button></div>`,info:selected?`<p class="home-version-meta">${escape(selected.minecraft)} · ${escape(selected.loader)}</p>`:''};
}

export function createAppHome({desktop,icon,setHTML,smallDialog,toast,renderShell,getState=()=>({rooms:[]})}){
 const bridge=globalThis.window?.joincraftHome;let summary=null,recent=null,recentError='',recentLoading=desktop&&typeof bridge?.recent==='function',loading=desktop&&!!bridge,pending=null,error='',loadFailed=false,draftMode=null,draftName=null,identityError='',entered=false,refreshing=false,dirty=false,expanded=false,lastVisit=null;
 const visitsKey='joincraft-home-room-visits-v1';let visits={};
 try{const saved=JSON.parse(globalThis.localStorage?.getItem(visitsKey)||'{}');if(saved&&typeof saved==='object')visits=Object.fromEntries(Object.entries(saved).filter(([id,at])=>id.length<=80&&Number.isSafeInteger(at)&&at>0).slice(0,100));}catch{}
 const identitySupport=bridge?.version>=2;
 function content(selector,html){
  const node=document.querySelector(selector);if(!node)return;
  const active=document.activeElement,key=node.contains?.(active)?active?.dataset?.homeKey:null;
  setHTML(node,html);
  if(key&&!active.isConnected)[...node.querySelectorAll('[data-home-key]')].find(item=>item.dataset.homeKey===key)?.focus({preventScroll:true});
 }
 function renderDashboard(){
  if(!document.querySelector('#main .app-home'))return;
  const state=getState(),rooms=rankHomeRooms(state.rooms,visits);
  content('#home-rooms',homeRoomList({rooms,icon,expanded}));
  content('#home-games',homeGameList({desktop,summary,recent,loading,recentLoading,error,icon,pending})+(recentError?`<p class="home-data-note" role="status">${escape(recentError)}</p>`:''));
  content('#home-guide',homeGuide({desktop,summary,rooms,profile:state.profile,icon}));
  const more=document.querySelector('#home-room-more');if(more){more.hidden=rooms.length<=3;more.textContent=expanded?'收起房间':`查看全部 ${rooms.length} 个房间`;more.setAttribute('aria-expanded',String(expanded));}
  const title=document.querySelector('#home-games-title');if(title&&desktop)title.textContent=(recent?.instances||[]).some(item=>item.lastLaunchAt||item.lastWorld?.lastPlayed)?'最近游玩':'已安装整合包';
  const games=document.querySelector('#home-games');if(games)games.setAttribute?.('aria-busy',String(loading||recentLoading));
 }
 const paint=()=>{if(isAppHome(location.hash)){renderShell();if(entered)renderDashboard();}};
 async function refresh(){
  if(!bridge)return;dirty=true;if(refreshing)return;refreshing=true;
  try{while(dirty){dirty=false;try{summary=await bridge.state();if(loadFailed){error='';loadFailed=false;}}catch(reason){error=reason.message||'无法读取游戏库';loadFailed=true;}loading=false;recentLoading=!!summary&&!recent&&typeof bridge.recent==='function';paint();
    if(summary&&typeof bridge.recent==='function'){try{recent=await bridge.recent();recentError='';}catch{recentError='最近存档暂时无法读取，可在版本设置中刷新。';}recentLoading=false;paint();}
  }}
  finally{refreshing=false;}
 }
 bridge?.onEvent(()=>{if(entered)void refresh();});
 globalThis.document?.addEventListener?.('input',event=>{if(event.target.id==='home-player-name')draftName=event.target.value;});
 globalThis.document?.addEventListener?.('submit',event=>{if(event.target.id==='home-identity-form'){event.preventDefault();void controller.action('home-save-identity',event.target);}});
 globalThis.window?.addEventListener?.('joincraft-home-notice',event=>toast(event.detail));
 const controller={
  shell:()=>homeSidebar({desktop,summary,loading,error,pending,icon,identitySupport,draftMode,draftName,identityError}),
  visit(id){if(id===lastVisit)return;lastVisit=id||null;if(!id)return;visits=Object.fromEntries(Object.entries({...visits,[id]:Date.now()}).sort((a,b)=>b[1]-a[1]).slice(0,100));try{globalThis.localStorage?.setItem(visitsKey,JSON.stringify(visits));}catch{}},
  renderHeading(container,html){const field=document.querySelector('#home-player-name'),focused=field&&document.activeElement===field,start=field?.selectionStart,end=field?.selectionEnd;setHTML(container,html);const next=document.querySelector('#home-player-name');if(focused&&next&&next!==field){next.focus({preventScroll:true});next.setSelectionRange(start,end);}},
  show(){if(!document.querySelector('#main .app-home'))setHTML(document.querySelector('#main'),appHomeContent({desktop,icon}));renderDashboard();if(!entered){entered=true;void refresh();}},
  leave(){entered=false;},
  async action(action,target){
   if(!action?.startsWith('home-'))return false;
   if(action==='home-room-more'){expanded=!expanded;renderDashboard();return true;}
   if(action==='home-identity'&&identitySupport){await controller.action('home-account',{dataset:{mode:'offline'}});document.querySelector('#home-player-name')?.focus();return true;}
   if(action==='home-microsoft-page'&&identitySupport){try{await bridge.microsoftPage();}catch(reason){toast(reason.message);}return true;}
   if(pending)return true;
   if(action==='home-account'&&identitySupport){draftMode=target.dataset.mode;identityError='';paint();const name=draftName??summary?.account.offlineName??'';if(draftMode==='offline'&&/^[A-Za-z0-9_]{3,16}$/.test(name))return controller.action('home-use-offline',target);if(draftMode==='microsoft'&&summary?.account.profile)return controller.action('home-use-microsoft',target);return true;}
   if(action==='home-retry'){error='';loading=true;paint();await refresh();return true;}
   if(action==='home-versions'&&bridge){
    smallDialog('版本选择',`<div class="home-version-list">${summary?.instances.length?summary.instances.map(item=>`<button class="home-version-choice" data-action="home-select" data-id="${escape(item.id)}" aria-pressed="${item.id===summary.selectedId}">${icon('cube')}<span><strong>${escape(item.name)}</strong><small>${escape(item.minecraft)} · ${escape(item.loader)}</small></span>${item.id===summary.selectedId?icon('check'):''}</button>`).join(''):'<p class="dialog-description">还没有已安装的整合包。</p>'}</div><button class="button home-manage-versions" data-action="home-settings">${icon('plus')}导入与管理整合包</button>`);return true;
   }
   if(action==='home-save-identity')draftName=document.querySelector('#home-player-name')?.value.trim()||'';
   const cardSelection=action==='home-select'&&!!target.closest?.('.home-game-card');
   pending=action;error='';identityError='';loadFailed=false;paint();
   try{
    if(!bridge){await window.blockroomDesktop?.openLibrary();return true;}
    if(action==='home-select'){summary=await bridge.select({id:target.dataset.id});document.querySelector('#small-dialog')?.close();if(cardSelection)toast('已切换整合包，可从左侧启动游戏');}
    else if(action==='home-start'){const result=await bridge.start({id:summary?.selectedId});if(result.needsIdentity){draftMode=summary?.account.mode||'offline';identityError=draftMode==='offline'?'先设置离线玩家名，再启动游戏。':'先登录微软账号，再启动游戏。';}}
    else if(action==='home-save-identity'){summary=await bridge.identity({mode:'offline',name:draftName});draftMode='offline';draftName=summary.account.offlineName;toast('玩家名已保存');}
    else if(action==='home-use-offline'){summary=await bridge.identity({mode:'offline',name:draftName??summary?.account.offlineName??''});}
    else if(action==='home-use-microsoft'){summary=await bridge.identity({mode:'microsoft',name:summary?.account.offlineName||''});draftMode='microsoft';}
    else if(action==='home-login'){summary=await bridge.login();draftMode='microsoft';}
    else if(action==='home-logout')summary=await bridge.logout();
    else if(action==='home-settings'||action==='home-configure'||action==='home-account'||action==='home-identity'){document.querySelector('#small-dialog')?.close();await bridge.configure({id:action==='home-configure'?target.dataset.id:summary?.selectedId,accountMode:action==='home-identity'?'offline':action==='home-account'?target.dataset.mode:undefined});}
   }catch(reason){if(['home-save-identity','home-use-offline','home-use-microsoft','home-login','home-logout'].includes(action))identityError=reason.message||'账号操作失败';else error=reason.message||'操作失败，请重试';if(!isAppHome(location.hash))toast(identityError||error);}
   finally{pending=null;paint();if(isAppHome(location.hash)&&document.activeElement===document.body)document.querySelector('[data-action="'+(cardSelection?'home-start':action==='home-select'?'home-versions':action)+'"]')?.focus({preventScroll:true});}
   return true;
  }
 };return controller;
}

export async function copyCommunity({control,clipboard=globalThis.navigator?.clipboard,feedback,fallback}){
 if(control.disabled)return;control.disabled=true;
 try{await clipboard.writeText(COMMUNITY_QQ);if(control.isConnected)feedback(control,'已复制群号');}
 catch{if(control.isConnected)fallback(COMMUNITY_QQ);}
 finally{if(control.isConnected)control.disabled=false;}
}
