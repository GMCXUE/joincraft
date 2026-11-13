export const formatBytes=value=>!Number.isFinite(value)?'—':value<1024?Math.round(value)+' B':value<1024**2?(value/1024).toFixed(1)+' KB':value<1024**3?(value/1024**2).toFixed(1)+' MB':(value/1024**3).toFixed(2)+' GB';
export function formatETA(seconds){if(!Number.isFinite(seconds))return '正在估算';if(seconds<5)return '即将完成';if(seconds<60)return '约 '+Math.ceil(seconds)+' 秒';if(seconds<3600)return '约 '+Math.ceil(seconds/60)+' 分钟';return '约 '+(seconds/3600).toFixed(1)+' 小时';}
export function renderInstallProgress(container,state,{cancel,retry}={}){
  if(!container)return;container.hidden=!state||state.state==='idle';if(container.hidden)return;
  if(!container.dataset.mounted){container.dataset.mounted='true';container.classList.add('pack-progress');container.innerHTML='<div class="pack-progress-heading"><div><span class="pack-progress-name"></span><h3 class="pack-progress-title" role="status" aria-live="polite"></h3></div><span class="pack-progress-percent"></span></div><ol class="pack-progress-stages" aria-label="安装步骤"><li>准备</li><li>Java</li><li>游戏资源</li><li>加载器</li><li>模组</li><li>校验</li></ol><div class="pack-progress-current"><span>当前文件</span><code></code></div><div class="pack-progress-file-size"></div><progress max="100" aria-label="当前安装阶段进度"></progress><div class="pack-progress-stats"><span class="pack-progress-count"></span><span class="pack-progress-speed"></span><span class="pack-progress-eta"></span></div><div class="pack-progress-end"><p role="status"></p><button class="pack-progress-cancel" type="button">取消安装</button><button class="pack-progress-retry" type="button">重试</button></div>';}
  const $=s=>container.querySelector(s),active=['installing','cancelling'].includes(state.state);
  container.dataset.state=state.state;container.dataset.operation=state.operation||'install';$('.pack-progress-name').textContent=state.name||'整合包';
  $('.pack-progress-title').textContent=active?state.label||'准备安装':state.state==='done'?(state.operation==='upload'?'上传完成':state.operation==='download'?'下载完成':state.operation==='inspect'?'校验完成':'安装完成'):state.state==='cancelled'?'操作已取消':'操作失败';
  const percent=Number.isFinite(state.percent)?Math.floor(state.percent):null;
  $('.pack-progress-percent').textContent=percent!==null?percent+'%':'步骤 '+(state.stage||1)+' / '+(state.stages||6);
  container.querySelectorAll('.pack-progress-stages li').forEach((li,index)=>{li.classList.toggle('complete',state.state==='done'||index+1<(state.stage||1));li.classList.toggle('current',active&&index+1===(state.stage||1));});
  const progress=$('progress');if(percent!==null)progress.value=percent;else progress.removeAttribute('value');
  $('.pack-progress-current code').textContent=state.file||'正在准备文件清单';$('.pack-progress-current code').title=state.file||'';
  $('.pack-progress-file-size').textContent=state.fileTotal?formatBytes(state.fileCompleted||0)+' / '+formatBytes(state.fileTotal):'';
  $('.pack-progress-count').textContent=state.totalFiles?(state.completedFiles||0)+' / '+state.totalFiles+' 个文件'+(state.totalBytes?' · '+formatBytes(state.completedBytes||0)+' / '+formatBytes(state.totalBytes):'')+(state.reusedFiles?' · 已复用 '+state.reusedFiles+' 个':''):'';
  $('.pack-progress-speed').textContent=active&&state.speedBps?formatBytes(state.speedBps)+'/s':'';
  $('.pack-progress-eta').textContent=!active?'':state.phase==='loader'||state.phase==='loader-process'||state.phase==='verify'||state.phase==='inspect'?'处理中':state.etaSeconds!==null&&state.etaSeconds!==undefined?'本阶段剩余 '+formatETA(state.etaSeconds):'预计时间：正在估算';
  $('.pack-progress-end p').textContent=state.message||'';
  const cancelButton=$('.pack-progress-cancel'),retryButton=$('.pack-progress-retry');cancelButton.hidden=!active||!cancel;cancelButton.disabled=state.state==='cancelling';cancelButton.textContent=state.state==='cancelling'?'正在取消…':state.operation==='upload'?'取消上传':state.operation==='download'?'取消下载':'取消安装';cancelButton.onclick=()=>void cancel?.();
  retryButton.hidden=!['failed','cancelled'].includes(state.state)||!retry;retryButton.onclick=()=>void retry?.();
}
