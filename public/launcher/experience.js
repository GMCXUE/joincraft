const paths={download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',alert:'<path d="m12 3 10 18H2L12 3Zm0 6v5m0 3h.01"/>',play:'<path d="m9 5 10 7-10 7V5Z"/>',cube:'<path d="m12 3 9 5v8l-9 5-9-5V8Zm0 9v9M3 8l9 4 9-4"/>',check:'<path d="m5 12 4 4L19 6"/>',refresh:'<path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2"/>',plus:'<path d="M12 5v14M5 12h14"/>',folder:'<path d="M3 6h6l2 3h10v11H3V6Z"/>',arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>'};
export const clientIcon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.cube}</svg>`;
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches||document.documentElement.classList.contains('motion-reduced');
export function revealClientPanel(element,{direction=1}={}){
 if(!element?.animate)return;
 element.getAnimations().filter(a=>a.id==='client-panel').forEach(a=>a.cancel());
 const quiet=reduced(),animation=element.animate(quiet?[{opacity:.8},{opacity:1}]:[{opacity:.7,transform:`translateX(${direction*8}px)`},{opacity:1,transform:'none'}],{duration:quiet?80:200,easing:'cubic-bezier(.16,1,.3,1)'});animation.id='client-panel';
}
// Progress follows reported events, never an artificial percentage or a timer.
export function launchPresentation({selectedId,run,play,operation=null,error=null}={}){
 const context=play?.context&&play.context.instanceId===selectedId?play.context:null;
 const phase=context?play.progress?.phase:null;
 const failed=!!error||phase==='failed'||run?.state==='failed';
 const active=['launching','world-loading','checking','connecting'].includes(phase);
 let steps=[],current=-1,complete=false;
 if(context&&['launching','world-loading','checking','connecting','online'].includes(phase)){
  steps=context.role==='guest'?['连接房主','启动游戏']:['启动游戏','载入世界','确认端口','建立联机'];
  current=context.role==='guest'?({connecting:0,launching:1,online:2}[phase]??0):({launching:0,'world-loading':1,checking:2,connecting:3,online:4}[phase]??0);
  complete=phase==='online';
 }else if(!context&&['checking','starting','running'].includes(run?.state)){
  steps=['检查文件','创建游戏进程'];current={checking:0,starting:1,running:2}[run.state];complete=run.state==='running';
 }
 const busy=active||operation==='launch'||['checking','starting'].includes(run?.state);
 const label=phase==='world-loading'?'正在载入世界…':phase==='checking'?'正在确认端口…':phase==='connecting'?'正在连接…':busy?'正在启动…':run?.state==='running'?'游戏运行中':context?.role==='host'?'启动世界并开房':context?.role==='guest'?'加入游戏':null;
 const badge=error?'需要修复':failed?'启动失败':active||run?.state==='starting'?'启动中':run?.state==='checking'?'检查中':run?.state==='running'?'运行中':'已安装';
 return {steps:failed?[]:steps,current,complete,busy,label,badge,tone:failed?'error':phase==='online'?'online':busy?'working':run?.state==='running'?'running':'idle'};
}
export function mountLibraryExperience(){
 const $=s=>document.querySelector(s);let previous='',stepsKey='';
 document.querySelectorAll('[data-client-icon]').forEach(el=>el.innerHTML=clientIcon(el.dataset.clientIcon));
 return {
  transition(direction=1){revealClientPanel($('#instance-content'),{direction});},
  update(view){
   const root=$('#details');root.dataset.launchState=view.tone;
   const badge=$('#pack-status');badge.textContent=view.badge;badge.dataset.tone=view.tone;
   $('#launch').setAttribute('aria-busy',String(view.busy));
   const list=$('#launch-phases'),key=view.steps.join('|');list.hidden=!key;
   if(key!==stepsKey){stepsKey=key;list.replaceChildren(...view.steps.map(label=>{const li=document.createElement('li'),dot=document.createElement('span'),copy=document.createElement('span');dot.className='launch-step-dot';dot.setAttribute('aria-hidden','true');dot.innerHTML=clientIcon('check');copy.textContent=label;li.append(dot,copy);return li;}));}
   [...list.children].forEach((li,index)=>{li.dataset.state=view.complete||index<view.current?'complete':index===view.current?'current':'pending';if(index===view.current&&!view.complete)li.setAttribute('aria-current','step');else li.removeAttribute('aria-current');});
   const next=[view.tone,view.current,key].join(':');
   if(previous&&previous!==next&&view.complete&&!reduced())badge.animate([{opacity:.5},{opacity:1}],{duration:220});
   previous=next;
  }
 };
}
