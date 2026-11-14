export const COMMUNITY_QQ='319301567';
export const isAppHome=hash=>!hash||hash==='#'||hash.replace(/^#/,'').split('/')[0]==='home';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function appHomeContent({desktop,icon}){
 return `<div class="app-home"><header class="app-home-welcome"><div><h2 class="app-home-title">一起上线，一起造。</h2><p>Minecraft 好友联机 · 整合包 · 房间语音</p></div><div class="app-home-room-actions"><button class="button small" data-action="create">${icon('plus')}创建房间</button><button class="button small" data-action="add">${icon('link')}加入房间</button></div></header><figure class="app-home-landscape"><img src="/home/camp-v2.webp" width="1672" height="941" alt="夜晚，朋友们在 Minecraft 木屋前集合，准备进入世界" decoding="async"></figure><footer class="app-home-community"><div class="home-community-copy">${icon('chat')}<div><strong>joincraft 交流群</strong><p>找队友、聊玩法，也欢迎反馈问题。</p></div></div><div class="app-home-group"><span>QQ 群</span><strong>${COMMUNITY_QQ}</strong><button class="button small app-home-copy-group" data-action="copy-community" aria-label="复制 QQ 群号 ${COMMUNITY_QQ}">${icon('copy')}复制群号</button></div></footer>${!desktop?'<a class="button primary home-mobile-download" href="/downloads/client/windows">下载 Windows 客户端</a>':''}</div>`;
}

export function homeSidebar({desktop,summary,loading,error,pending,icon,identitySupport=false,draftMode,draftName,identityError=''}){
 if(!desktop)return {heading:`<div class="home-web-identity">${icon('gamepad')}<h2>你的下一次冒险</h2><p>和朋友在房间集合，<br>用客户端一起进入世界。</p></div>`,nav:`<a class="button primary home-download" href="/downloads/client/windows">${icon('monitor')}下载客户端<small>Windows · x64</small></a><p class="home-web-caption">网页版支持好友、聊天和房间语音</p>`,info:''};
 const modern=!!summary,selected=summary?.instances.find(item=>item.id===summary.selectedId),account=summary?.account,locked=!!pending||summary?.busy||loading;
 const mode=draftMode||account?.mode||'offline',name=draftName??account?.offlineName??account?.name??'';
 const label=loading?'正在读取…':pending==='home-start'?'正在启动…':summary?.run?.state==='running'?'游戏运行中':summary?.busy&&!account?.busy?'任务进行中':modern?(selected?'启动游戏':'导入整合包'):'打开游戏库';
 const online=mode==='microsoft',accountPanel=identitySupport?(online?`<div class="home-microsoft"><strong>${escape(account?.profile?.name||'微软正版')}</strong><p>${account?.profile?'Java 版已授权':account?.busy?'在浏览器中完成授权':account?.configured?'登录拥有 Java 版的微软账号':'此版本暂未启用微软登录'}</p>${account?.deviceCode?`<output class="home-device-code">${escape(account.deviceCode)}</output><button class="button small" data-action="home-microsoft-page">打开微软授权页</button>`:account?.profile?`<button class="button small" data-action="${account.mode==='microsoft'?'home-logout':'home-use-microsoft'}" ${locked?'disabled':''}>${account.mode==='microsoft'?'退出微软账号':'使用此账号'}</button>`:`<button class="button small" data-action="home-login" ${locked||!account?.configured?'disabled':''}>${account?.busy?'等待授权…':'登录微软账号'}</button>`}</div>`:`<form id="home-identity-form" class="home-identity-form"><label for="home-player-name">离线玩家名</label><input id="home-player-name" value="${escape(name)}" autocomplete="off" maxlength="16" placeholder="3–16 位字母、数字或下划线" ${locked?'disabled':''}><button type="submit" class="button small" ${locked?'disabled':''}>保存玩家名</button></form>`):`<strong>${escape(account?.name||(modern?'设置游戏身份':'本机游戏库'))}</strong><button class="text-button" data-action="home-account" data-mode="${account?.mode||'offline'}" ${locked?'disabled':''}>管理游戏身份 ${icon('chevron')}</button>`;
 return {heading:`<div class="home-account-tabs" role="group" aria-label="游戏账号"><button data-action="home-account" data-mode="offline" aria-pressed="${!online}" ${locked?'disabled':''}>离线玩家</button><button data-action="home-account" data-mode="microsoft" aria-pressed="${online}" ${locked?'disabled':''}>微软正版</button></div><div class="home-game-identity"><img src="/avatars/creeper-v1.svg" width="64" height="64" alt="默认游戏头像">${accountPanel}<p class="home-identity-error" role="alert" ${identityError?'':'hidden'}>${escape(identityError)}</p></div>`,nav:`<p class="home-launch-error" role="alert" ${error?'':'hidden'}>${escape(error)}</p><button class="button primary home-launch" data-action="${error&&!modern?'home-retry':modern&&selected?'home-start':'home-settings'}" ${locked?'disabled':''} aria-busy="${!!pending||loading}"><span>${icon('gamepad')}<strong>${error&&!modern?'重新读取':label}</strong></span><small title="${escape(selected?.name||'')}">${escape(selected?.name||(modern?'还没有已安装的整合包':'选择已安装的整合包'))}</small></button><div class="home-version-actions"><button class="button" data-action="home-versions" ${locked?'disabled':''}>版本选择${icon('down')}</button><button class="button" data-action="home-settings" ${pending||loading?'disabled':''}>${icon('settings')}版本设置</button></div>`,info:selected?`<p class="home-version-meta">${escape(selected.minecraft)} · ${escape(selected.loader)}</p>`:''};
}

export function createAppHome({desktop,icon,setHTML,smallDialog,toast,renderShell}){
 const bridge=globalThis.window?.joincraftHome;let summary=null,loading=desktop&&!!bridge,pending=null,error='',loadFailed=false,draftMode=null,draftName=null,identityError='',entered=false,refreshing=false,dirty=false;
 const identitySupport=bridge?.version>=2;
 const paint=()=>{if(isAppHome(location.hash))renderShell();};
 async function refresh(){
  if(!bridge)return;dirty=true;if(refreshing)return;refreshing=true;
  try{while(dirty){dirty=false;try{summary=await bridge.state();if(loadFailed){error='';loadFailed=false;}}catch(reason){error=reason.message||'无法读取游戏库';loadFailed=true;}loading=false;paint();}}
  finally{refreshing=false;}
 }
 bridge?.onEvent(()=>{if(entered)void refresh();});
 globalThis.document?.addEventListener?.('input',event=>{if(event.target.id==='home-player-name')draftName=event.target.value;});
 globalThis.document?.addEventListener?.('submit',event=>{if(event.target.id==='home-identity-form'){event.preventDefault();void controller.action('home-save-identity',event.target);}});
 globalThis.window?.addEventListener?.('joincraft-home-notice',event=>toast(event.detail));
 const controller={
  shell:()=>homeSidebar({desktop,summary,loading,error,pending,icon,identitySupport,draftMode,draftName,identityError}),
  renderHeading(container,html){const field=document.querySelector('#home-player-name'),focused=field&&document.activeElement===field,start=field?.selectionStart,end=field?.selectionEnd;setHTML(container,html);const next=document.querySelector('#home-player-name');if(focused&&next&&next!==field){next.focus({preventScroll:true});next.setSelectionRange(start,end);}},
  show(){if(!document.querySelector('#main .app-home'))setHTML(document.querySelector('#main'),appHomeContent({desktop,icon}));if(!entered){entered=true;void refresh();}},
  leave(){entered=false;},
  async action(action,target){
   if(!action?.startsWith('home-'))return false;
   if(action==='home-microsoft-page'&&identitySupport){try{await bridge.microsoftPage();}catch(reason){toast(reason.message);}return true;}
   if(pending)return true;
   if(action==='home-account'&&identitySupport){draftMode=target.dataset.mode;identityError='';paint();const name=draftName??summary?.account.offlineName??'';if(draftMode==='offline'&&/^[A-Za-z0-9_]{3,16}$/.test(name))return controller.action('home-use-offline',target);if(draftMode==='microsoft'&&summary?.account.profile)return controller.action('home-use-microsoft',target);return true;}
   if(action==='home-retry'){error='';loading=true;paint();await refresh();return true;}
   if(action==='home-versions'&&bridge){
    smallDialog('版本选择',`<div class="home-version-list">${summary?.instances.length?summary.instances.map(item=>`<button class="home-version-choice" data-action="home-select" data-id="${escape(item.id)}" aria-pressed="${item.id===summary.selectedId}">${icon('cube')}<span><strong>${escape(item.name)}</strong><small>${escape(item.minecraft)} · ${escape(item.loader)}</small></span>${item.id===summary.selectedId?icon('check'):''}</button>`).join(''):'<p class="dialog-description">还没有已安装的整合包。</p>'}</div><button class="button home-manage-versions" data-action="home-settings">${icon('plus')}导入与管理整合包</button>`);return true;
   }
   if(action==='home-save-identity')draftName=document.querySelector('#home-player-name')?.value.trim()||'';
   pending=action;error='';identityError='';loadFailed=false;paint();
   try{
    if(!bridge){await window.blockroomDesktop?.openLibrary();return true;}
    if(action==='home-select'){summary=await bridge.select({id:target.dataset.id});document.querySelector('#small-dialog')?.close();}
    else if(action==='home-start'){const result=await bridge.start({id:summary?.selectedId});if(result.needsIdentity){draftMode=summary?.account.mode||'offline';identityError=draftMode==='offline'?'先设置离线玩家名，再启动游戏。':'先登录微软账号，再启动游戏。';}}
    else if(action==='home-save-identity'){summary=await bridge.identity({mode:'offline',name:draftName});draftMode='offline';draftName=summary.account.offlineName;toast('玩家名已保存');}
    else if(action==='home-use-offline'){summary=await bridge.identity({mode:'offline',name:draftName??summary?.account.offlineName??''});}
    else if(action==='home-use-microsoft'){summary=await bridge.identity({mode:'microsoft',name:summary?.account.offlineName||''});draftMode='microsoft';}
    else if(action==='home-login'){summary=await bridge.login();draftMode='microsoft';}
    else if(action==='home-logout')summary=await bridge.logout();
    else if(action==='home-settings'||action==='home-account'){document.querySelector('#small-dialog')?.close();await bridge.configure({id:summary?.selectedId,accountMode:action==='home-account'?target.dataset.mode:undefined});}
   }catch(reason){if(['home-save-identity','home-use-offline','home-use-microsoft','home-login','home-logout'].includes(action))identityError=reason.message||'账号操作失败';else error=reason.message||'操作失败，请重试';if(!isAppHome(location.hash))toast(identityError||error);}
   finally{pending=null;paint();if(isAppHome(location.hash)&&document.activeElement===document.body)document.querySelector('[data-action="'+(action==='home-select'?'home-versions':action)+'"]')?.focus({preventScroll:true});}
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
