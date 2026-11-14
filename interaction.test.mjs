import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {normalizeRoomCode,validateForm,bindForm,createScrollAnchor} from './public/interaction.js';

class Control extends EventTarget{
 constructor(name,value='',extra={}){super();Object.assign(this,{name,value,disabled:false,isConnected:true,willValidate:false,validity:{valid:true},dataset:{},labels:[{textContent:name}],attrs:new Map()},extra);}
 setAttribute(key,value){this.attrs.set(key,value);}removeAttribute(key){this.attrs.delete(key);}getAttribute(key){return this.attrs.get(key)||null;}focus(){this.focused=true;}
 set innerHTML(value){this.label=value;}get innerHTML(){return this.label;}set textContent(value){this.label=value;}get textContent(){return this.label;}
}
class Form extends Control{
 constructor(controls,button,close){super('form');this.elements=controls;this.button=button;this.close=close;}
 querySelector(){return this.button;}querySelectorAll(){return this.elements;}closest(){return {querySelectorAll:()=>[this.close]};}
}
function formFixture(){
 const name=new Control('name','山顶建造师'),avatar=new Control('avatarId','skeleton'),button=new Control('', '',{textContent:'保存资料'}),close=new Control('close'),form=new Form([name,avatar,button],button,close),error={id:'error',hidden:true,textContent:''};
 const original=globalThis.FormData;
 globalThis.FormData=class{constructor(form){this.entries=form.elements.filter(c=>c.name&&!c.disabled).map(c=>[c.name,c.value]);}*[Symbol.iterator](){yield* this.entries;}};
 return {name,avatar,button,close,form,error,restore:()=>{globalThis.FormData=original;}};
}

test('room codes accept copied invitations, full-width digits and readable formatting',()=>{
 assert.equal(normalizeRoomCode('１２３ ４５６'),'123456');assert.equal(normalizeRoomCode('房间号：123-456'),'123456');
 assert.equal(normalizeRoomCode('http://127.0.0.1:4223/app/?guest=1&code=987654#friends'),'987654');assert.equal(normalizeRoomCode('12'),'12');
});

test('invalid forms explain the field and focus it before any request',()=>{
 const field=new Control('code','',{willValidate:true,labels:[{textContent:'房间号'}],validity:{valid:false,valueMissing:true}}),form={elements:[field]},error={id:'room-error'};
 assert.equal(validateForm(form,error),false);assert.equal(error.textContent,'请填写房间号');assert.equal(field.focused,true);assert.equal(field.getAttribute('aria-invalid'),'true');assert.equal(field.getAttribute('aria-describedby'),'room-error');
 field.validity={valid:false,patternMismatch:true};field.dataset.validation='房间号需要 6 位数字';assert.equal(validateForm(form,error),false);assert.equal(error.textContent,'房间号需要 6 位数字');
});

test('a pending form submits the original values once and restores controls after completion',async()=>{
 const f=formFixture();try{
  let release,started,calls=0,received;const held=new Promise(resolve=>{release=resolve;}),began=new Promise(resolve=>{started=resolve;});f.avatar.disabled=true;
  bindForm(f.form,f.error,async body=>{calls++;received=body;started();await held;});
  const complete=once(f.form,'form:complete');f.form.dispatchEvent(new Event('submit',{cancelable:true}));await began;
  assert.deepEqual(received,{name:'山顶建造师'});assert.equal(f.name.disabled,true);assert.equal(f.close.disabled,true);assert.equal(f.button.textContent,'正在保存…');assert.equal(f.form.getAttribute('aria-busy'),'true');assert.equal(f.button.getAttribute('aria-busy'),'true');
  f.form.dispatchEvent(new Event('submit',{cancelable:true}));assert.equal(calls,1);release();await complete;
  assert.equal(f.name.disabled,false);assert.equal(f.avatar.disabled,true);assert.equal(f.close.disabled,false);assert.equal(f.button.textContent,'保存资料');assert.equal(f.form.getAttribute('aria-busy'),null);assert.equal(f.button.getAttribute('aria-busy'),null);
 }finally{f.restore();}
});

test('a failed form preserves typed values and can retry without losing the chosen avatar',async()=>{
 const f=formFixture();try{
  let attempts=0;bindForm(f.form,f.error,async body=>{assert.equal(body.avatarId,'skeleton');if(++attempts===1)throw new Error('连接超时，请重试');});
  let done=once(f.form,'form:complete');f.form.dispatchEvent(new Event('submit',{cancelable:true}));await done;
  assert.equal(f.error.hidden,false);assert.equal(f.error.textContent,'连接超时，请重试');assert.equal(f.name.value,'山顶建造师');assert.equal(f.avatar.value,'skeleton');assert.equal(f.button.disabled,false);
  done=once(f.form,'form:complete');f.form.dispatchEvent(new Event('submit',{cancelable:true}));await done;assert.equal(attempts,2);assert.equal(f.error.hidden,true);
 }finally{f.restore();}
});

test('chat history stays anchored across older pages and new messages, while latest view follows resizing',()=>{
 const original=globalThis.ResizeObserver;let observer;
 globalThis.ResizeObserver=class{constructor(callback){this.callback=callback;observer=this;}observe(){}disconnect(){this.disconnected=true;}};
 try{
  const list=new EventTarget();Object.assign(list,{scrollHeight:1000,clientHeight:200,top:150});Object.defineProperty(list,'scrollTop',{get(){return this.top;},set(value){this.top=Math.max(0,Math.min(value,this.scrollHeight-this.clientHeight));}});
  const button=new EventTarget();let read=0;const anchor=createScrollAnchor(list,button,()=>read++);assert.equal(button.hidden,false);
  let before=anchor.capture();list.scrollHeight=1400;anchor.restore(before,{older:true});assert.equal(list.scrollTop,550);
  before=anchor.capture();list.scrollHeight=1600;anchor.restore(before);assert.equal(list.scrollTop,550);assert.equal(button.hidden,false);
  button.dispatchEvent(new Event('click'));assert.equal(list.scrollTop,1400);assert.equal(button.hidden,true);assert.equal(read,1);
  before=anchor.capture();list.scrollHeight=1700;anchor.restore(before);assert.equal(list.scrollTop,1500);
  list.clientHeight=100;observer.callback();assert.equal(list.scrollTop,1600);
  list.scrollTop=50;list.dispatchEvent(new Event('scroll'));list.clientHeight=80;observer.callback();assert.equal(list.scrollTop,50);anchor.dispose();assert.equal(observer.disconnected,true);
 }finally{globalThis.ResizeObserver=original;}
});

test('older-page anchoring follows the visible message when a history button disappears',()=>{
 const original=globalThis.ResizeObserver;globalThis.ResizeObserver=class{observe(){}disconnect(){}};
 try{
  const list=new EventTarget();Object.assign(list,{scrollHeight:1000,clientHeight:200,scrollTop:100,getBoundingClientRect:()=>({top:100})});let messageY=120;
  const message={dataset:{messageId:'7'},getBoundingClientRect:()=>({top:100+messageY-list.scrollTop,bottom:140+messageY-list.scrollTop})};list.querySelectorAll=()=>[message];
  const button=new EventTarget(),anchor=createScrollAnchor(list,button),before=anchor.capture();
  list.scrollHeight=1300;messageY+=250;anchor.restore(before,{older:true});
  assert.equal(list.scrollTop,350);assert.equal(message.getBoundingClientRect().top-list.getBoundingClientRect().top,before.offset);anchor.dispose();
 }finally{globalThis.ResizeObserver=original;}
});

test('autofilled values enforce minimum length even when native tooShort remains false',()=>{
 const field=new Control('password','123',{type:'password',willValidate:true,minLength:10,maxLength:64,labels:[{textContent:'Password'}],validity:{valid:true,valueMissing:false}}),error={id:'password-error'};
 assert.equal(validateForm({elements:[field]},error),false);assert.equal(field.getAttribute('aria-invalid'),'true');assert.equal(field.focused,true);
 field.value='          ';assert.equal(validateForm({elements:[field]},error),true);
});

function motionClock(){
 let now=0,id=0;const tasks=new Map();return{setTimer(fn,delay){const key=++id;tasks.set(key,{at:now+delay,fn});return key;},clearTimer(key){tasks.delete(key);},advance(ms){const end=now+ms;for(;;){const next=[...tasks].filter(([,task])=>task.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;tasks.delete(next[0]);now=next[1].at;next[1].fn();}now=end;}};
}
test('fast operations never flash mining feedback and do not wait for an animation',async()=>{
 const {createTaskState}=await import('./public/motion.js'),clock=motionClock(),states=[];
 const task=createTaskState(state=>states.push(state),clock).start('join');clock.advance(399);task.done();clock.advance(2000);assert.equal(states.some(state=>state.visible),false);
});
test('a superseded task cannot finish or fail a new operation',async()=>{
 const {createTaskState}=await import('./public/motion.js'),clock=motionClock();let state;
 const model=createTaskState(next=>state=next,clock),old=model.start('first');clock.advance(500);const next=model.start('second',{success:'second ready'});old.fail(Error('old'));old.done();clock.advance(400);assert.equal(state.label,'second');assert.equal(state.phase,'pending');next.done();assert.equal(state.phase,'success');assert.equal(state.label,'second ready');clock.advance(1150);assert.equal(state.visible,false);
});
test('failed loading stays stopped for retry; cancellation prevents late success',async()=>{
 const {createTaskState}=await import('./public/motion.js'),clock=motionClock();let state;
 const task=createTaskState(next=>state=next,clock).start('scan');clock.advance(500);task.fail(Error('offline'));clock.advance(20000);assert.equal(state.phase,'error');assert.equal(state.error,'offline');task.done();assert.equal(state.phase,'error');task.cancel();task.done();assert.equal(state.visible,false);
});
test('the refined atlas loops only mining poses, ends with a collected diamond, and has a static reduced-motion state',async()=>{
 const {minerFrame}=await import('./public/mining.js');for(let t=0;t<5000;t+=31)assert(minerFrame({elapsed:t})<8);
 assert.equal(minerFrame({phase:'success',elapsed:3000}),11);assert.equal(minerFrame({phase:'error',elapsed:3000}),0);assert.equal(minerFrame({phase:'pending',elapsed:3000,reduced:true}),0);assert.equal(minerFrame({phase:'success',elapsed:0,reduced:true}),11);
});

test('copy confirmation restarts its duration and restores the original control only once',async()=>{
 const {showControlFeedback}=await import('./public/interaction.js'),clock=motionClock(),button=new Control('copy','',{innerHTML:'copy icon'});
 button.setAttribute('aria-label','复制房间号');
 showControlFeedback(button,{html:'check icon',label:'已复制',...clock});clock.advance(1500);
 showControlFeedback(button,{html:'check icon',label:'已复制',...clock});clock.advance(400);
 assert.equal(button.innerHTML,'check icon');assert.equal(button.dataset.feedback,'success');
 clock.advance(1400);assert.equal(button.innerHTML,'copy icon');assert.equal(button.getAttribute('aria-label'),'复制房间号');assert.equal(button.getAttribute('title'),null);assert.equal(button.dataset.feedback,undefined);
});
test('copy feedback never overwrites a replaced or removed control',async()=>{
 const {showControlFeedback}=await import('./public/interaction.js'),clock=motionClock(),button=new Control('copy','',{innerHTML:'copy'});
 showControlFeedback(button,{html:'check',label:'已复制',...clock});button.innerHTML='changed by another operation';clock.advance(2000);assert.equal(button.innerHTML,'changed by another operation');
 showControlFeedback(button,{html:'check',label:'已复制',...clock});button.isConnected=false;clock.advance(2000);assert.equal(button.innerHTML,'check');
});
test('layout switching commits immediately and cancels an interrupted transition before its next destination',async()=>{
 const {animateLayoutChange}=await import('./public/motion.js'),oldMatch=globalThis.matchMedia,oldDocument=globalThis.document;
 let top=100,cancelled=0,animation;
 const element={getBoundingClientRect:()=>({top,left:0}),getAnimations:()=>animation?[animation]:[],animate(frames,options){animation={frames,options,cancel(){cancelled++;}};return animation;}};
 try{
  globalThis.document={documentElement:{classList:{contains:()=>false}}};globalThis.matchMedia=()=>({matches:false});
  animateLayoutChange(element,()=>top=60);assert.equal(top,60);assert.equal(animation.frames[0].transform,'translate(0px,40px)');assert.equal(animation.options.duration,220);
  animateLayoutChange(element,()=>top=100);assert.equal(cancelled,1);assert.equal(animation.frames[0].transform,'translate(0px,-40px)');
  globalThis.matchMedia=()=>({matches:true});animateLayoutChange(element,()=>top=50);assert.equal(top,50);assert.equal(cancelled,2);
 }finally{globalThis.matchMedia=oldMatch;globalThis.document=oldDocument;}
});
