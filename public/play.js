export function connectionLabel(local){if(local?.transport==='p2p')return 'P2P 直连'+(typeof local.latency==='number'&&Number.isFinite(local.latency)&&local.latency>=0&&local.latency<=60000?' · '+Math.round(local.latency)+' ms':'');return local?.transport==='relay'?'服务器中继':local?.transport==='checking'?'正在尝试直连…':'';}
export function isDesktopClient(bridge=globalThis.blockroomDesktop){return typeof bridge?.openLibrary==='function';}
export function createPlayUI({api,escape,icon,smallDialog,formHandler,refresh,toast,getVersion,desktop=isDesktopClient,getSession=()=>null,native=globalThis.joincraftPlay,download=()=>location.assign('/downloads/client/windows')}) {
 const $=s=>document.querySelector(s);
 let pending=null,expiryTimer;
 const labels={offline:'尚未开房',waiting:'等待房主连接',online:'可以加入游戏',error:'连接已断开'};
 function requiredPanel(){return `<section class="play-panel client-required" aria-label="客户端联机"><div class="play-heading"><h3>${icon('gamepad')}在客户端中联机</h3><p>游戏库与 MC 联机请使用 joincraft 客户端。</p></div><div class="client-required-actions"><a class="button primary small" href="/downloads/client/windows">下载客户端</a><span>Windows x64</span></div></section>`;}
 function panel(room){
  if(!desktop())return requiredPanel();
  const c=room.connection||{status:'offline'},local=c.local;

  return `<section class="play-panel" aria-label="游戏联机"><div class="play-heading"><div><h3>${icon('gamepad')}游戏联机</h3></div><span class="play-status ${c.status==='online'?'ready':''}"><span></span>${labels[c.status]||labels.offline}</span></div>${c.error?`<p class="play-error" role="alert">${escape(c.error)}</p>`:''}<div class="play-controls">${room.isHost?`${['online','waiting'].includes(c.status)?'<button class="button" data-action="play-stop">停止联机</button>':`<button class="button primary" data-action="play-start">${icon('gamepad')}${c.status==='error'?'重新开房':native?.version===1?'选择存档并开房':'开始联机'}</button>`}${c.status==='online'?`<span class="play-detail">${escape(c.version||'Java 版')} · ${c.routes?c.routes.direct+c.routes.relay>0?'直连 '+c.routes.direct+' · 中继 '+c.routes.relay:'等待成员加入':c.connections+' 条游戏连接'}</span>`:''}`:local?.status==='ready'&&native?.version===1?`<span class="play-detail play-route" data-transport="${['p2p','relay','checking'].includes(local.transport)?local.transport:'relay'}">${connectionLabel(local)||'游戏连接已就绪'}</span><button class="text-button" data-action="play-disconnect">断开连接</button>`:local?.status==='ready'?`<div class="play-address"><small>本机连接地址</small><code>${escape(local.address)}</code><button class="icon-button" data-action="play-copy-address" aria-label="复制游戏地址">${icon('copy')}</button></div><button class="text-button" data-action="play-disconnect">断开连接</button>`:local?'<span class="play-detail">等待本地连接程序…</span><button class="text-button" data-action="play-connect">重新生成指令</button>':`<button class="button primary" data-action="play-connect" ${c.status!=='online'?'disabled':''}>${icon('link')}${native?.version===1?'加入游戏':'连接游戏'}</button>`}</div></section>`;
 }
 function sync(room){
  const c=room.connection||{status:'offline'};
  const status=$('.connection-state');if(status)status.hidden=!desktop();
  if(status){status.classList.toggle('connected',c.status==='online');status.querySelector('strong').textContent=c.status==='online'?(!room.isHost&&connectionLabel(c.local)||'Java 联机已开启'):labels[c.status]||'尚未开房';}
  if(!pending||pending.roomId!==room.id||pending.version!==getVersion())return;
  const message=$('#play-command-status');if(!message)return;
  if(pending.role==='host'&&c.status==='online'||pending.role==='guest'&&c.local?.status==='ready'){
   message.className='play-command-status ready';message.textContent=pending.role==='host'?'开房成功，朋友现在可以连接游戏。':`连接成功。在 MC 中输入：${c.local.address}`;
   $('#play-command')?.setAttribute('hidden','');$('#play-copy-command')?.setAttribute('hidden','');clearTimeout(expiryTimer);
  }else if(c.status==='error'){message.className='play-command-status error';message.textContent=c.error||'连接失败，请关闭此窗口后重试。';}
 }
 function showCommand(result,room){
  const encoded=btoa(JSON.stringify({server:location.origin,ticket:result.ticket})).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  pending={roomId:room.id,role:result.role,command:`node joincraft-bridge.cjs --connect ${encoded}`,expiresAt:result.expiresAt,version:getVersion()};
  smallDialog(result.role==='host'?'启动房主连接':'连接到房主的世界',`<p class="dialog-description">在这台运行 MC 的电脑上启动连接程序。首次需要 Node.js 22.13 或更高版本。</p><ol class="bridge-steps"><li><strong>下载连接程序</strong><a class="button small" href="/downloads/joincraft-bridge.cjs" download>下载连接程序</a></li><li><strong>在下载文件所在文件夹打开终端</strong><p>复制下面的指令并运行，保持窗口打开。</p></li></ol><textarea id="play-command" class="bridge-command" aria-label="连接程序运行指令" readonly rows="3">${escape(pending.command)}</textarea><button id="play-copy-command" class="button primary full" data-action="play-copy-command">复制运行指令</button><p id="play-command-status" class="play-command-status" role="status">等待连接程序…指令 5 分钟内有效，仅可启动一次，请勿分享。</p><p class="dialog-footnote">${result.role==='host'?'朋友需要在自己的房间页面点击「连接游戏」。':'启动成功后，本机游戏地址会显示在房间概览中。'}</p>`);
  clearTimeout(expiryTimer);expiryTimer=setTimeout(()=>{if($('#play-command-status')&&pending){$('#play-command-status').textContent='指令已过期。关闭此窗口，重新生成连接指令。';$('#play-copy-command').disabled=true;}},Math.max(0,result.expiresAt-Date.now()));
 }
 async function handle(action,target,room){
  if(!desktop()){download();return;}
  if(action==='play-copy-command'){
   if(pending&&pending.version===getVersion()&&pending.expiresAt>Date.now())try{await navigator.clipboard.writeText(pending.command);toast('指令已复制');}catch{toast('请选中指令手动复制');}return;
  }
  if(!room||room.closed)return;
  if(native?.version===1&&['play-start','play-connect','play-stop','play-disconnect'].includes(action)){
   target.disabled=true;try{if(action==='play-start'||action==='play-connect')await native.select({roomId:room.id,token:getSession()});else{await native.stop({roomId:room.id});await api(`/api/rooms/${room.id}/play/${action==='play-stop'?'stop':'disconnect'}`,{});await refresh();}}catch(error){toast(error.message);}finally{target.disabled=false;}return;
  }
  if(action==='play-start'){
   smallDialog('开始联机',`<ol class="bridge-steps"><li><strong>打开你的 MC 世界</strong><p>按 Esc → 对局域网开放 → 创建一个局域网世界。</p></li><li><strong>填写游戏聊天栏显示的端口</strong><p>每次开放局域网的端口可能不同。</p></li></ol><form id="play-start-form"><div class="field"><label for="play-port">MC 局域网端口</label><input id="play-port" name="port" type="number" min="1024" max="65535" required placeholder="例如 51234" value="${room.connection?.port||room.port||''}"></div><p id="play-start-error" class="form-error" role="alert" hidden></p><button class="button primary full" type="submit">下一步：启动连接程序</button></form>`);
   formHandler($('#play-start-form'),'#play-start-error',async body=>{const version=getVersion(),result=await api(`/api/rooms/${room.id}/play/start`,body);if(version!==getVersion())return;showCommand(result,room);await refresh();});$('#play-port').focus();return;
  }
  if(action==='play-copy-address'){
   try{await navigator.clipboard.writeText(room.connection.local.address);toast('游戏地址已复制');}catch{toast('请选中地址手动复制');}return;
  }
  target.disabled=true;const version=getVersion();
  try{
   if(action==='play-connect'){const result=await api(`/api/rooms/${room.id}/play/connect`,{});if(version===getVersion())showCommand(result,room);}
   else if(action==='play-stop'||action==='play-disconnect'){await api(`/api/rooms/${room.id}/play/${action==='play-stop'?'stop':'disconnect'}`,{});pending=null;clearTimeout(expiryTimer);toast(action==='play-stop'?'已停止联机':'已断开连接');}
   await refresh();
  }catch(error){toast(error.message);}finally{target.disabled=false;}
 }
 return {panel,sync,handle,requiredPanel};
}
