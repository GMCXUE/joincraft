export function createPlayUI({api,escape,icon,smallDialog,formHandler,refresh,toast,getVersion}) {
 const $=s=>document.querySelector(s);
 let pending=null,expiryTimer;
 const labels={offline:'尚未开房',waiting:'等待房主连接',online:'可以加入游戏',error:'连接已断开'};
 function panel(room){
  const c=room.connection||{status:'offline'},local=c.local;
  const hint=room.isHost?(c.status==='online'?'保持 MC 世界和连接程序运行，朋友就能加入。':'在 MC 中开放局域网，然后开始联机。'):c.status==='online'?'连接后，在 MC 多人游戏中输入下方的本机地址。':'等房主开始联机后，就可以连接游戏。';
  return `<section class="play-panel" aria-label="游戏联机"><div class="play-heading"><div><h3>${icon('gamepad')}Java 版联机</h3><p>${hint}</p></div><span class="play-status ${c.status==='online'?'ready':''}"><span></span>${labels[c.status]||labels.offline}</span></div>${c.error?`<p class="play-error" role="alert">${escape(c.error)}</p>`:''}<div class="play-controls">${room.isHost?`${['online','waiting'].includes(c.status)?'<button class="button" data-action="play-stop">停止联机</button>':`<button class="button primary" data-action="play-start">${icon('gamepad')}${c.status==='error'?'重新开房':'开始联机'}</button>`}${c.status==='online'?`<span class="play-detail">${escape(c.version||'Java 版')} · ${c.connections} 条游戏连接</span>`:''}`:local?.status==='ready'?`<div class="play-address"><small>本机连接地址</small><code>${escape(local.address)}</code><button class="icon-button" data-action="play-copy-address" aria-label="复制游戏地址">${icon('copy')}</button></div><button class="text-button" data-action="play-disconnect">断开连接</button>`:local?'<span class="play-detail">等待本地连接程序…</span><button class="text-button" data-action="play-connect">重新生成指令</button>':`<button class="button primary" data-action="play-connect" ${c.status!=='online'?'disabled':''}>${icon('link')}连接游戏</button>`}</div><p class="play-footnote">${room.isHost?'世界运行在房主电脑上。关闭世界或停止联机后，朋友会断开。':'此地址仅供运行连接程序的那台电脑使用。版本与模组需和房主一致。'}</p></section>`;
 }
 function sync(room){
  const c=room.connection||{status:'offline'};
  const status=$('.connection-state');
  if(status){status.classList.toggle('connected',c.status==='online');status.querySelector('strong').textContent=c.status==='online'?'Java 联机已开启':labels[c.status]||'尚未开房';}
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
  if(action==='play-copy-command'){
   if(pending&&pending.version===getVersion()&&pending.expiresAt>Date.now())try{await navigator.clipboard.writeText(pending.command);toast('指令已复制');}catch{toast('请选中指令手动复制');}return;
  }
  if(!room||room.closed)return;
  if(action==='play-start'){
   smallDialog('开始 Java 版联机',`<ol class="bridge-steps"><li><strong>打开你的 MC 世界</strong><p>按 Esc → 对局域网开放 → 创建一个局域网世界。</p></li><li><strong>填写游戏聊天栏显示的端口</strong><p>世界关闭后，下次开放的端口可能不同。</p></li></ol><form id="play-start-form"><div class="field"><label for="play-port">MC 局域网端口</label><input id="play-port" name="port" type="number" min="1024" max="65535" required placeholder="例如 51234" value="${room.connection?.port||room.port||''}"></div><p id="play-start-error" class="form-error" role="alert" hidden></p><button class="button primary full" type="submit">下一步：启动连接程序</button></form>`);
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
 return {panel,sync,handle};
}
