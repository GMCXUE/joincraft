// Shared task feedback for hosted app forms; no browser alert/confirm windows.
export function normalizeRoomCode(value){
 const text=String(value).normalize('NFKC').trim();
 const invitation=text.match(/[?&]code=(\d{6})(?:[&#]|$)/);
 return invitation?invitation[1]:text.replace(/\D/g,'').slice(0,6);
}
export function validateForm(form,error){
 const tooShort=field=>field.minLength>0&&String(field.value).length>0&&String(field.value).length<field.minLength;
 const tooLong=field=>field.maxLength>0&&String(field.value).length>field.maxLength;
 const missing=field=>field.validity.valueMissing||(field.required&&field.type!=='password'&&!String(field.value).trim());
 const invalid=field=>{
  const label=field.labels?.[0]?.textContent.replace(/可选/g,'').trim()||'此项';
  if(missing(field))return '请填写'+label;
  if(field.dataset.validation)return field.dataset.validation;
  if(field.validity.rangeUnderflow||field.validity.rangeOverflow)return `${label}需要在 ${field.min}–${field.max} 之间`;
  if(field.validity.tooShort||tooShort(field))return `${label}至少需要 ${field.minLength} 个字符`;
  if(tooLong(field))return `${label}最多可填 ${field.maxLength} 个字符`;
  return '请检查'+label+'的格式';
 };
  const field=[...form.elements].find(item=>item.willValidate&&(!item.validity.valid||tooShort(item)||tooLong(item)||missing(item)));
  if(field){field.setAttribute('aria-invalid','true');const described=new Set((field.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean));described.add(error.id);field.setAttribute('aria-describedby',[...described].join(' '));error.textContent=invalid(field);error.hidden=false;field.focus();return false;}
 return true;
}
export function bindForm(form,error,callback){
 if(!form||!error)return;
 let pending=false;form.noValidate=true;
 form.addEventListener('input',event=>{
  if(event.target.validity?.valid){event.target.removeAttribute('aria-invalid');error.hidden=true;}
 });
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(pending||event.submitter?.disabled)return;
  if(!validateForm(form,error))return;
  const values=Object.fromEntries(new FormData(form)),button=form.querySelector('[type="submit"]');
  const controls=[...form.querySelectorAll('input,select,textarea,button'),...form.closest('dialog')?.querySelectorAll('.dialog-close,.dialog-tabs button')||[]];
  const disabled=new Map(controls.map(item=>[item,item.disabled])),label=button?.innerHTML;
  pending=true;form.setAttribute('aria-busy','true');button?.setAttribute('aria-busy','true');error.hidden=true;
  controls.forEach(item=>item.disabled=true);
  if(button){const text=button.textContent;button.textContent=button.dataset.pendingLabel||(/保存/.test(text)?'正在保存…':/加入/.test(text)?'正在加入…':/创建/.test(text)?'正在创建…':/发送/.test(text)?'正在发送…':/登录/.test(text)?'正在登录…':'正在提交…');}
  try{await callback(values);}
  catch(reason){if(form.isConnected){error.textContent=reason.message||'操作失败，请重试';error.hidden=false;}}
  finally{pending=false;form.removeAttribute('aria-busy');button?.removeAttribute('aria-busy');for(const [item,value] of disabled)if(item.isConnected)item.disabled=value;if(button?.isConnected)button.innerHTML=label;form.dispatchEvent(new Event('form:complete'));}
 });
}
export function mountDialogs(root=document){
 const outside=new WeakMap(),openers=new WeakMap();
 const busy=dialog=>Boolean(dialog.querySelector('form[aria-busy="true"]'));
 const isOutside=(event,dialog)=>{const r=dialog.getBoundingClientRect();return event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom;};
 root.querySelectorAll('dialog').forEach(dialog=>{
  dialog.addEventListener('beforetoggle',event=>{if(event.newState==='open')openers.set(dialog,document.activeElement);});
  dialog.addEventListener('cancel',event=>{if(busy(dialog))event.preventDefault();});
  dialog.addEventListener('pointerdown',event=>outside.set(dialog,event.target===dialog&&isOutside(event,dialog)));
  dialog.addEventListener('pointerup',event=>{if(outside.get(dialog)&&event.target===dialog&&isOutside(event,dialog)&&!busy(dialog))dialog.close();outside.delete(dialog);});
  dialog.addEventListener('pointercancel',()=>outside.delete(dialog));
  dialog.addEventListener('close',()=>queueMicrotask(()=>{if(root.querySelector('dialog[open]'))return;const opener=openers.get(dialog);if(opener?.isConnected&&opener!==document.body)opener.focus({preventScroll:true});}));
 });
}
export function createScrollAnchor(list,button,onBottom){
 const controller=new AbortController();
 const atBottom=()=>list.scrollHeight-list.scrollTop-list.clientHeight<70;
 let following=atBottom();
 const update=()=>{following=atBottom();button.hidden=following||list.scrollHeight<=list.clientHeight+70;};
 list.addEventListener('scroll',()=>{update();if(atBottom())onBottom?.();},{signal:controller.signal,passive:true});
 button.addEventListener('click',()=>{list.scrollTop=list.scrollHeight;update();onBottom?.();},{signal:controller.signal});
 const observer=new ResizeObserver(()=>{if(following)list.scrollTop=list.scrollHeight;update();});observer.observe(list);update();
 const capture=()=>{
  const position={top:list.scrollTop,height:list.scrollHeight,bottom:atBottom()},edge=list.getBoundingClientRect?.().top;
  if(edge!==undefined)for(const message of list.querySelectorAll('[data-message-id]')){const rect=message.getBoundingClientRect();if(rect.bottom>edge+2){position.id=message.dataset.messageId;position.offset=rect.top-edge;break;}}
  return position;
 };
 return {atBottom,capture,restore(before,{older=false,follow=false}={}){
  const anchor=older&&before.id?[...list.querySelectorAll('[data-message-id]')].find(message=>message.dataset.messageId===before.id):null;
  if(anchor)list.scrollTop+=anchor.getBoundingClientRect().top-list.getBoundingClientRect().top-before.offset;
  else list.scrollTop=older?before.top+list.scrollHeight-before.height:follow||before.bottom?list.scrollHeight:before.top;
  update();
 },update,dispose(){controller.abort();observer.disconnect();}};
}

// Repeated confirmations share the original label; an old timeout cannot reset a new one.
const controlFeedback=new WeakMap();
export function showControlFeedback(button,{html,label,duration=1800,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 if(!button?.isConnected)return;
 const previous=controlFeedback.get(button);
 if(previous)previous.clearTimer(previous.timer);
 const original=previous?.original||{html:button.innerHTML,label:button.getAttribute('aria-label'),title:button.getAttribute('title')};
 const state={original,clearTimer};controlFeedback.set(button,state);
 button.innerHTML=html;state.html=button.innerHTML;button.setAttribute('aria-label',label);button.setAttribute('title',label);button.dataset.feedback='success';
 state.timer=setTimer(()=>{
  if(controlFeedback.get(button)!==state)return;
  controlFeedback.delete(button);
  if(!button.isConnected||button.innerHTML!==state.html)return;
  button.innerHTML=original.html;
  for(const [key,value] of [['aria-label',original.label],['title',original.title]])if(value===null)button.removeAttribute(key);else button.setAttribute(key,value);
  delete button.dataset.feedback;
 },duration);
}
