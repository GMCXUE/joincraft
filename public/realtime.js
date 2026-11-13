// Server events only invalidate state; the authenticated REST endpoint remains authoritative.
export async function watchChanges({getHeaders, onChange, onUnauthorized, onStatus, signal}) {
  let delay = 1000;
  const pause = ms => new Promise(resolve => {
    if (signal.aborted) return resolve();
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, {once:true});
  });
  while (!signal.aborted) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, {once:true});
    let watchdog;
    const alive = () => { clearTimeout(watchdog); watchdog = setTimeout(abort, 35000); };
    try {
      alive();
      const response = await fetch('/api/events', {headers:getHeaders(),signal:controller.signal});
      if (response.status === 401) { await onUnauthorized(); return; }
      if (!response.ok || !response.body) throw new Error('Stream unavailable');
      onStatus(true); delay = 1000;
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = '';
      try {
        while (!signal.aborted) {
          const {value,done} = await reader.read();
          if (done) break;
          alive(); buffer += decoder.decode(value,{stream:true});
          let boundary;
          while ((boundary = buffer.indexOf('\n\n')) !== -1) {
            const event = buffer.slice(0,boundary); buffer = buffer.slice(boundary+2);
            if (event.startsWith('event: change\n')) await onChange();
          }
        }
      } finally { await reader.cancel().catch(()=>{}); }
    } catch { /* A fresh connection always requests a complete state snapshot. */ }
    finally { clearTimeout(watchdog); controller.abort(); signal.removeEventListener('abort',abort); }
    if (!signal.aborted) { onStatus(false); await pause(delay); delay = Math.min(delay*2,15000); }
  }
}

export function applyStatePatch(state,patch){
 if(Number(patch.revision)<Number(state.revision||0))return state;
 const next={...state,revision:patch.revision};
 if(patch.profile)next.profile=patch.profile;
 if(patch.social)next.social=patch.social;
 if(patch.rooms){
  const rooms=new Map(state.rooms.map(room=>[room.id,room]));
  for(const id of patch.rooms.remove)rooms.delete(id);
  for(const room of patch.rooms.upsert)rooms.set(room.id,room);
  next.rooms=patch.rooms.order.map(id=>rooms.get(id)).filter(Boolean);
 }
 return next;
}

// One authenticated business socket per page. The database remains authoritative.
export function createRealtime({getHeaders,onState,onEvent,onReady=()=>{},onUnauthorized,onStatus,signal,
 url=location.origin,fetcher=fetch,WebSocketClass=WebSocket,requestTimeout=20000,reconnectDelay=1000}){
 const controller=new AbortController(),pending=new Map();
 let socket=null,connected=false,stopped=false,unauthorized=false;
 const failPending=error=>{for(const request of pending.values()){clearTimeout(request.timer);request.reject(error);}pending.clear();};
 const status=value=>{connected=value;onStatus(value);};
 const ended=()=>{if(unauthorized)return;unauthorized=true;stopped=true;controller.abort();socket?.close();failPending(new Error('登录已失效，请重新登录'));onUnauthorized();};
 const flush=request=>{if(connected&&socket?.readyState===1)socket.send(JSON.stringify(request.frame));};
 const pause=delay=>new Promise(resolve=>{if(controller.signal.aborted)return resolve();const done=()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,delay);controller.signal.addEventListener('abort',done,{once:true});});
 async function connect(ticket){
  return new Promise(resolve=>{
   const address=new URL('/api/realtime',url);address.protocol=address.protocol==='https:'?'wss:':'ws:';
   const ws=new WebSocketClass(address.href);socket=ws;
   let sequence=0,ready=false,finished=false,watchdog;
   const alive=()=>{clearTimeout(watchdog);watchdog=setTimeout(()=>ws.close(),35000);};
   const abort=()=>{ws.close();finish();};
   const finish=()=>{if(finished)return;finished=true;clearTimeout(watchdog);controller.signal.removeEventListener('abort',abort);if(socket===ws){socket=null;status(false);}resolve(ready);};
   controller.signal.addEventListener('abort',abort,{once:true});alive();
   ws.addEventListener('open',()=>{if(controller.signal.aborted){abort();return;}ws.send(JSON.stringify({type:'auth',ticket}));});
   ws.addEventListener('error',()=>ws.close());
   ws.addEventListener('close',event=>{if(event.code===4401)ended();finish();});
   ws.addEventListener('message',event=>{
    if(stopped||finished||controller.signal.aborted)return;
    try{
     alive();const frame=JSON.parse(event.data);
     if(!Number.isSafeInteger(frame.sequence)||frame.sequence!==sequence+1)throw new Error('Sequence gap');
     sequence=frame.sequence;
     if(frame.type==='error'){if(frame.status===401)ended();else ws.close();return;}
     if(frame.type==='ready'){
      if(ready||frame.schema!==1||!frame.state?.profile)throw new Error('Unexpected handshake');
      ready=true;onState(frame.state,true);status(true);onReady();for(const request of pending.values())flush(request);return;
     }
     if(!ready)throw new Error('Authentication required');
     if(frame.type==='state.patch')onState(frame.patch,false);
     else if(frame.type==='event')onEvent(frame.event);
     else if(frame.type==='reply'){
      const request=pending.get(frame.requestId);if(!request)return;
      pending.delete(frame.requestId);clearTimeout(request.timer);
      if(frame.ok)request.resolve(frame.result);
      else{request.reject(Object.assign(new Error(frame.error||'操作失败，请重试'),{status:frame.status}));if(frame.status===401)ended();}
     }else if(frame.type!=='heartbeat')throw new Error('Unexpected event');
    }catch{ws.close(1002,'Resync required');}
   });
  });
 }
 async function run(){
  let delay=reconnectDelay;
  while(!stopped&&!controller.signal.aborted){
   try{
    const response=await fetcher(new URL('/api/realtime/ticket',url).href,{method:'POST',headers:{'Content-Type':'application/json',...getHeaders()},body:'{}',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12000)])});
    if(response.status===401){ended();break;}
    if(!response.ok)throw new Error('Realtime unavailable');
    const {ticket}=await response.json();if(typeof ticket!=='string')throw new Error('Invalid ticket');
    if(controller.signal.aborted)break;
    if(await connect(ticket))delay=reconnectDelay;
   }catch{if(stopped||controller.signal.aborted)break;status(false);}
   if(!stopped){await pause(delay+Math.floor(Math.random()*delay*.2));delay=Math.min(delay*2,15000);}
  }
 }
 const close=()=>{if(stopped&&!unauthorized)return;stopped=true;controller.abort();socket?.close();failPending(new Error('连接已关闭'));};
 if(signal?.aborted)close();else signal?.addEventListener('abort',close,{once:true});
 if(!stopped)void run();
 return {get connected(){return connected;},close,request(type,body){
  if(stopped)return Promise.reject(new Error('实时连接不可用，请重新连接'));
  if(pending.size>=50)return Promise.reject(new Error('待发送消息过多，请稍后重试'));
  return new Promise((resolve,reject)=>{
   const requestId=crypto.randomUUID(),frame={type,requestId,body};
   const timer=setTimeout(()=>{pending.delete(requestId);reject(new Error('发送确认超时，恢复连接后可重试'));},requestTimeout);
   const request={frame,resolve,reject,timer};pending.set(requestId,request);flush(request);
  });
 }};
}
