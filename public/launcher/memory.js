const gb=value=>`${(value/1024).toFixed(1)} GB`;
const active=run=>run&&['checking','starting','running'].includes(run.state);
export function createMemoryControls({api,locked,getRun,onChange,onRefresh}){
 const $=id=>document.querySelector(id),auto=$('#memory-auto'),custom=$('#memory-custom'),slider=$('#memory');
 let stats=null,mode='auto',manualMB=4096,pending=false,timer=null;
 const set=(id,value)=>{$(id).textContent=value;};
 function bar(used,budget,total){
  const system=Math.min(1,Math.max(0,used/total)),game=Math.min(1-system,Math.max(0,budget/total)),overflow=used+budget>total;
  const overview=$('#memory-overview');overview.style.setProperty('--memory-used',`${system*100}%`);overview.classList.toggle('budget-overflow',overflow);
  $('#memory-system-segment').style.transform=`scaleX(${system})`;
  $('#memory-game-segment').style.transform=`translateX(${system*100}%) scaleX(${game})`;
  const description=`内存分配预览：已使用 ${gb(used)}，物理内存 ${gb(total)}，游戏分配上限 ${gb(budget)}。${overflow?'浅色段按剩余空间显示。':''}运行中的游戏占用已计入已使用内存，分配上限不代表实时占用。`;
  $('#memory-bar').setAttribute('aria-label',description);$('#memory-bar').title=description;
 }
 function render(){
  const run=getRun(),running=active(run),fixed=running&&Number.isInteger(run.memoryMB)?run.memoryMB:null;
  const budget=running?fixed:mode==='auto'?stats?.recommendedMB:manualMB;
  auto.checked=mode==='auto';custom.checked=mode==='custom';auto.disabled=custom.disabled=locked();
  slider.min='512';slider.max=String(stats?.maxMB||32768);slider.value=String(manualMB);slider.disabled=locked()||mode!=='custom'||!stats;
  slider.setAttribute('aria-valuetext',gb(manualMB));
  set('#memory-auto-value',stats?gb(mode==='auto'&&fixed?fixed:stats.recommendedMB):'—');
  set('#memory-system-label',stats?.approximate?'已使用内存（估算）':'已使用内存');
  set('#memory-custom-value',gb(manualMB));
  set('#memory-system-value',stats?`${gb(stats.usedMB)} / ${gb(stats.totalMB)}`:'正在读取…');
  set('#memory-game-value',Number.isFinite(budget)?gb(budget):'—');
  set('#memory-live-state',running?(fixed?'本次分配已固定':'正在确定分配'):'');
  $('#memory-overview').classList.toggle('unavailable',!stats);
  bar(stats?.usedMB||0,budget||0,stats?.totalMB||32768);
  const warning=!stats?'暂时无法读取系统内存':!running&&mode==='auto'&&stats.lowMemory?'当前可用内存不足，建议关闭部分程序。':!running&&mode==='custom'&&manualMB>stats.availableMB-stats.reserveMB?'分配接近或超过当前可用内存，可能影响其他程序。':'';
  set('#memory-warning',warning);$('#memory-warning').hidden=!warning;
 }
 function accept(value){
  if(!value||!Number.isFinite(value.totalMB)||value.totalMB<=0||!Number.isFinite(value.usedMB)||!Number.isFinite(value.maxMB)||!Number.isFinite(value.recommendedMB))throw Error('Invalid system memory snapshot');
  stats=value;manualMB=Math.max(512,Math.min(manualMB,stats.maxMB));render();onRefresh?.();
 }
 async function refresh(){
  if(!api?.memory||pending||document.hidden||document.body.inert)return;
  pending=true;try{accept(await api.memory());}catch{stats=null;render();onRefresh?.();}finally{pending=false;}
 }
 for(const radio of [auto,custom])radio.addEventListener('change',()=>{if(locked())return;mode=custom.checked?'custom':'auto';render();onChange();onRefresh?.();});
 slider.addEventListener('input',()=>{manualMB=Number(slider.value);render();onChange();});
 const visibility=()=>{if(!document.hidden)void refresh();};
 return {
  restore(saved){mode=['auto','custom'].includes(saved?.memoryMode)?saved.memoryMode:saved?.memory!==undefined?'custom':'auto';const memory=Number(saved?.memory);manualMB=Number.isInteger(memory)&&memory>=512&&memory<=32768?memory:4096;if(stats)manualMB=Math.min(manualMB,stats.maxMB);render();},
  request:()=>({memoryMode:mode,memoryMB:mode==='auto'?stats?.recommendedMB:manualMB}),
  preferences:()=>({memory:manualMB,memoryMode:mode}),
  canLaunch:()=>Boolean(stats&&(mode!=='auto'||!stats.lowMemory)),
  update:accept,sync:render,refresh,
  start(){if(timer)return;void refresh();timer=setInterval(()=>void refresh(),2000);document.addEventListener('visibilitychange',visibility);},
  dispose(){clearInterval(timer);timer=null;document.removeEventListener('visibilitychange',visibility);}
 };
}
