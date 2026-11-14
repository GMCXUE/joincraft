import {drawMiner,loadMinerArt} from './mining.js';

// One active task owns feedback; delayed results cannot complete a newer task.
export function createTaskState(notify,{setTimer=setTimeout,clearTimer=clearTimeout}={}){
 let current=null,serial=0;
 const clear=task=>{clearTimer(task?.showTimer);clearTimer(task?.hideTimer);};
 const publish=()=>notify(current?{...current}:{visible:false});
 function start(label,options={}){
  clear(current);current={id:++serial,label,options,phase:'pending',visible:false};const task=current;publish();
  const owns=()=>current===task;
  task.showTimer=setTimer(()=>{if(owns()&&task.phase==='pending'){task.visible=true;publish();}},options.delay??400);
  const hide=()=>{if(!owns())return;clear(task);current=null;publish();};
  return {
   done(){if(!owns()||task.phase!=='pending')return;clear(task);if(!task.visible){hide();return;}task.phase='success';task.label=options.success||'已完成';publish();if(!options.hold)task.hideTimer=setTimer(hide,1150);},
   fail(error){if(!owns()||task.phase!=='pending')return;clear(task);if(!task.visible){hide();return;}task.phase='error';task.label=options.error||'暂时未能完成';task.error=error?.message||String(error||'请重试');publish();},
   cancel:hide,
  };
 }
 return {start,dismiss(){clear(current);current=null;publish();}};
}

export function createMiningFeedback({document:doc=globalThis.document,window:win=globalThis.window}={}){
 let panel,canvas,title,detail,actions,snapshot={visible:false},frame=0,lastFrame=0,phaseStarted=0,lastPhase='',lastId=0,inView=true,visibility;
 const reduced=win.matchMedia('(prefers-reduced-motion: reduce)'),isReduced=()=>reduced.matches||doc.documentElement.classList.contains('motion-reduced');
 const stop=()=>{win.cancelAnimationFrame(frame);frame=0;};
 function hidden(){return doc.hidden||doc.body.inert||!inView||!panel?.isConnected||panel.hidden;}
 function draw(now){
  if(hidden()){stop();return;}
  if(now-lastFrame>=80||isReduced()){drawMiner(canvas,{phase:snapshot.phase,elapsed:now-phaseStarted,reduced:isReduced()});lastFrame=now;}
  if(snapshot.phase!=='error'&&!isReduced()&&(snapshot.phase==='pending'||now-phaseStarted<1200))frame=win.requestAnimationFrame(draw);else frame=0;
 }
 function animate(){stop();if(snapshot.visible&&!hidden())draw(win.performance.now());}
 function ensure(){
  if(panel)return;
  void loadMinerArt().then(()=>animate()).catch(()=>{});
  panel=doc.createElement('section');panel.className='mining-notice';panel.setAttribute('role','status');panel.setAttribute('aria-live','polite');panel.setAttribute('aria-atomic','true');
  canvas=doc.createElement('canvas');canvas.width=362;canvas.height=362;canvas.setAttribute('aria-hidden','true');
  const copy=doc.createElement('div');copy.className='mining-copy';title=doc.createElement('strong');detail=doc.createElement('span');actions=doc.createElement('div');actions.className='mining-actions';
  copy.append(title,detail,actions);panel.append(canvas,copy);
  visibility=new win.IntersectionObserver(entries=>{inView=entries.some(entry=>entry.isIntersecting);animate();});visibility.observe(panel);
 }
 function update(state){
  snapshot=state;
  if(!state.visible){stop();panel?.remove();return;}
  ensure();
  if(state.id!==lastId||state.phase!==lastPhase){phaseStarted=win.performance.now();lastId=state.id;lastPhase=state.phase;}
  const inline=state.phase==='pending'||state.phase==='error'||state.options.hold;
  const host=inline&&state.options.host?.isConnected?state.options.host:doc.body;
  if(panel.parentElement!==host)host.append(panel);
  panel.classList.toggle('mining-inline',host!==doc.body);panel.classList.toggle('mining-demo',Boolean(state.options.hold));panel.dataset.phase=state.phase;
  title.textContent=state.label;detail.textContent=state.error||'';detail.hidden=!state.error;actions.replaceChildren();
  if(state.phase==='error'&&state.options.retry){const retry=doc.createElement('button');retry.className='text-button';retry.type='button';retry.textContent='重试';retry.onclick=()=>state.options.retry();actions.append(retry);}
  if(state.phase==='error'&&!state.options.hold){const close=doc.createElement('button');close.className='text-button';close.type='button';close.textContent='收起';close.onclick=()=>model.dismiss();actions.append(close);}
  animate();
 }
 const model=createTaskState(update);
 doc.addEventListener('visibilitychange',animate);doc.addEventListener('joincraft:motion-preference',animate);reduced.addEventListener('change',animate);
 const observer=new win.MutationObserver(animate);observer.observe(doc.body,{attributes:true,attributeFilter:['inert']});
 return {...model,dispose(){model.dismiss();doc.removeEventListener('visibilitychange',animate);doc.removeEventListener('joincraft:motion-preference',animate);reduced.removeEventListener('change',animate);observer.disconnect();visibility?.disconnect();}};
}
let feedback;
export const miningFeedback={start:(...args)=>(feedback??=createMiningFeedback()).start(...args),dismiss:()=>feedback?.dismiss()};

export function animatePage(element){
 if(!element||!element.animate)return;
 element.getAnimations().filter(animation=>animation.id==='joincraft-page').forEach(animation=>animation.cancel());
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches||document.documentElement.classList.contains('motion-reduced');
 const animation=element.animate(reduced?[{opacity:.75},{opacity:1}]:[{opacity:.58,transform:'translateY(5px)',clipPath:'inset(0 0 0 3px)'},{opacity:1,transform:'none',clipPath:'inset(0)'}],{duration:reduced?90:180,easing:'cubic-bezier(.16,1,.3,1)'});animation.id='joincraft-page';
}

export function mountNavigationMotion({rail,sidebar,content}={}){
 let scheduled=0;const frames=new Map(),reduced=matchMedia('(prefers-reduced-motion: reduce)');
 document.body.classList.add('motion-ready');
 function track(root,selector,kind){
  if(!root)return;const selected=root.querySelector(selector),record=frames.get(kind);
  if(!selected){if(record)record.element.hidden=true;return;}
  let entry=record;if(!entry){const element=document.createElement('span');element.className='nav-motion-frame nav-motion-'+kind;element.setAttribute('aria-hidden','true');root.append(element);entry={element,key:''};frames.set(kind,entry);}
  const marker=entry.element,bounds=root.getBoundingClientRect(),target=selected.getBoundingClientRect(),pad=kind==='rail'?2:0;
  if(!target.width||!target.height){marker.hidden=true;return;}
  const x=target.left-bounds.left+root.scrollLeft-pad,y=target.top-bounds.top+root.scrollTop-pad,width=target.width+pad*2,height=target.height+pad*2;
  const key=[x,y,width,height].join(':');if(key===entry.key){marker.hidden=false;return;}
  const before=marker.hidden||!entry.key?null:marker.getBoundingClientRect();marker.getAnimations().forEach(animation=>animation.cancel());marker.hidden=false;
  marker.style.width=width+'px';marker.style.height=height+'px';marker.style.transform=`translate(${x}px,${y}px)`;
  if(before&&!reduced.matches&&!document.documentElement.classList.contains('motion-reduced')){const animation=marker.animate([{transform:`translate(${before.left-bounds.left+root.scrollLeft}px,${before.top-bounds.top+root.scrollTop}px) scale(${before.width/width},${before.height/height})`},{transform:`translate(${x}px,${y}px) scale(1,1)`}],{duration:180,easing:'cubic-bezier(.16,1,.3,1)'});animation.id='joincraft-nav';}
  entry.key=key;
 }
 function sync(){cancelAnimationFrame(scheduled);scheduled=requestAnimationFrame(()=>{track(rail,'[aria-current="page"]','rail');track(sidebar,'#room-nav [aria-current="page"],#room-nav .active','sidebar');});}
 const resize=new ResizeObserver(sync);for(const root of [rail,sidebar])if(root)resize.observe(root);
 window.addEventListener('resize',sync);sync();
 return {sync,transition:()=>{sync();animatePage(content);},dispose(){cancelAnimationFrame(scheduled);resize.disconnect();window.removeEventListener('resize',sync);frames.forEach(entry=>entry.element.remove());document.body.classList.remove('motion-ready');}};
}

// Keep the current position while a form changes size; repeated switches interrupt cleanly.
export function animateLayoutChange(element,update){
 if(!element?.animate){update();return;}
 const before=element.getBoundingClientRect();
 element.getAnimations().filter(animation=>animation.id==='joincraft-layout').forEach(animation=>animation.cancel());
 update();
 const after=element.getBoundingClientRect();
 if(matchMedia('(prefers-reduced-motion: reduce)').matches||document.documentElement.classList.contains('motion-reduced'))return;
 const x=before.left-after.left,y=before.top-after.top;
 if(Math.abs(x)+Math.abs(y)<1)return;
 const animation=element.animate([{transform:`translate(${x}px,${y}px)`},{transform:'none'}],{duration:220,easing:'cubic-bezier(.16,1,.3,1)'});
 animation.id='joincraft-layout';
}

export function animateMessageArrival(messages){
 if(document.hidden||document.documentElement.classList.contains('motion-reduced')||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 // A burst is one arrival, never a long sequence that delays reading.
 for(const message of messages.slice(-3))message.animate?.([{opacity:.55,transform:'translateY(4px)'},{opacity:1,transform:'none'}],{duration:160,easing:'cubic-bezier(.16,1,.3,1)'});
}
