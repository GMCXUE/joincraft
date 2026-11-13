import {randomBytes} from 'node:crypto';
import type {Server,IncomingMessage} from 'node:http';
import type {Duplex} from 'node:stream';
import {WebSocket,WebSocketServer,type RawData} from 'ws';
import type {Principal,RealtimeChange} from './service.js';
import {ApiError,fail,object,text} from './validation.js';

type Snapshot={revision:number;profile:{id:string};rooms:{id:string}[];social:unknown;[key:string]:unknown};
type Peer={ws:WebSocket;actor?:Principal;state?:Snapshot;sequence:number;alive:boolean;rawWindow:number;rawCount:number;authTimer:ReturnType<typeof setTimeout>};
type Options={
 server:Server;origins:()=>string[];now:()=>number;valid:(hash:string)=>boolean;
 countLegacy:(user?:string)=>number;consume:(key:string,max:number,window:number)=>void;
 snapshot:(actor:Principal)=>Snapshot;presence:(user:string)=>void;
 command:(actor:Principal,type:string,body:Record<string,unknown>)=>unknown;
 event:(actor:Principal,change:RealtimeChange)=>unknown;
};
const MAX_BUFFER=4*1024*1024;

// Tickets are single-use, short-lived, and sent in the first frame rather than URLs.
export class Realtime {
 private wss=new WebSocketServer({noServer:true,maxPayload:16384,perMessageDeflate:false});
 private peers=new Set<Peer>();
 private tickets=new Map<string,{actor:Principal;expires:number}>();
 private timer:ReturnType<typeof setInterval>;
 private stopped=false;
 constructor(private options:Options){
  options.server.on('upgrade',this.upgrade);
  this.timer=setInterval(()=>this.heartbeat(),15000).unref();
 }
 count(user?:string){return [...this.peers].filter(peer=>!user||peer.actor?.id===user).length;}
 online(user:string){return [...this.peers].some(p=>p.actor?.id===user&&p.ws.readyState===WebSocket.OPEN&&this.options.valid(p.actor.tokenHash));}
 ticket(actor:Principal){
  this.options.consume('realtime-ticket:'+actor.id,30,60000);
  this.pruneTickets();
  if(this.tickets.size>=400)fail('实时连接繁忙，请稍后重试',429);
  const ticket=randomBytes(32).toString('base64url'),expiresAt=this.options.now()+30000;
  this.tickets.set(ticket,{actor,expires:expiresAt});return {ticket,expiresAt};
 }
 private pruneTickets(){for(const [ticket,value] of this.tickets)if(value.expires<=this.options.now()||!this.options.valid(value.actor.tokenHash))this.tickets.delete(ticket);}
 private upgrade=(req:IncomingMessage,socket:Duplex,head:Buffer)=>{
  if(req.url?.split('?')[0]!=='/api/realtime')return;
  socket.on('error',()=>{});
  try{
   if(this.stopped)fail('Unavailable',503);
   if(req.url!=='/api/realtime'||!this.options.origins().some(o=>new URL(o).host===req.headers.host)||req.headers.origin&&!this.options.origins().includes(req.headers.origin))fail('Forbidden',403);
   this.options.consume('realtime-upgrade:'+req.socket.remoteAddress,600,60000);
   if(this.peers.size+this.options.countLegacy()>=200)fail('实时连接数量已满',429);
   this.wss.handleUpgrade(req,socket,head,ws=>{
    const peer:Peer={ws,sequence:0,alive:true,rawWindow:this.options.now(),rawCount:0,authTimer:setTimeout(()=>ws.close(4401,'Authentication required'),5000).unref()};
    this.peers.add(peer);
    ws.on('error',()=>{});
    ws.on('pong',()=>peer.alive=true);
    ws.on('message',(data,binary)=>this.receive(peer,data,binary));
    ws.on('close',()=>{clearTimeout(peer.authTimer);this.peers.delete(peer);if(peer.actor&&!this.stopped)this.options.presence(peer.actor.id);});
   });
  }catch(error){const status=error instanceof ApiError?error.statusCode:400;socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);}
 };
 private send(peer:Peer,value:Record<string,unknown>){
  if(peer.ws.readyState!==WebSocket.OPEN)return false;
  const data=JSON.stringify({...value,sequence:++peer.sequence});
  if(peer.ws.bufferedAmount+Buffer.byteLength(data)>MAX_BUFFER){peer.ws.close(1013,'Resync required');return false;}
  peer.ws.send(data,error=>{if(error)peer.ws.terminate();});return true;
 }
 private receive(peer:Peer,data:RawData,binary:boolean){
  let requestId:string|undefined;
  if(peer.ws.readyState!==WebSocket.OPEN)return;
  if(this.options.now()-peer.rawWindow>=1000){peer.rawWindow=this.options.now();peer.rawCount=0;}
  if(++peer.rawCount>120){peer.ws.terminate();return;}
  try{
   if(binary){peer.ws.close(1003,'Text frames required');return;}
   const frame=object(JSON.parse(data.toString()));
   if(!peer.actor){
    if(frame.type!=='auth')fail('请重新登录',401);
    const ticket=text(frame.ticket,'连接凭据',100),lease=this.tickets.get(ticket);this.tickets.delete(ticket);
    if(!lease||lease.expires<=this.options.now()||!this.options.valid(lease.actor.tokenHash))fail('连接凭据已过期',401);
    if([...this.peers].filter(p=>p.actor?.id===lease.actor.id).length+this.options.countLegacy(lease.actor.id)>=6)fail('实时连接数量已满，请关闭多余页面',429);
    clearTimeout(peer.authTimer);peer.actor=lease.actor;peer.state=this.options.snapshot(lease.actor);
    this.send(peer,{type:'ready',schema:1,state:peer.state});this.options.presence(lease.actor.id);return;
   }
   if(typeof frame.requestId==='string'&&/^[A-Za-z0-9_-]{8,64}$/.test(frame.requestId))requestId=frame.requestId;
   if(!this.options.valid(peer.actor.tokenHash))fail('登录已失效，请重新登录',401);
   this.options.consume('realtime-command:'+peer.actor.id,240,60000);
   requestId=text(frame.requestId,'请求标识',64);
   if(!/^[A-Za-z0-9_-]{8,64}$/.test(requestId))fail('请求标识格式无效');
   const type=text(frame.type,'操作',40),body=object(frame.body);
   const result=this.options.command(peer.actor,type,body);
   this.send(peer,{type:'reply',requestId,ok:true,result});
  }catch(error){
   const status=error instanceof ApiError?error.statusCode:400;
   this.send(peer,{type:requestId?'reply':'error',requestId,ok:false,status,error:error instanceof ApiError?error.message:'消息格式无效'});
   if(!peer.actor||status===401)peer.ws.close(status===429?4429:4401,'Authentication failed');
  }
 }
 publish(users:string[],change?:RealtimeChange){
  const recipients=new Set(users),snapshots=new Map<string,Snapshot>();
  for(const peer of this.peers){
   const actor=peer.actor;if(!actor||!recipients.has(actor.id)||!this.options.valid(actor.tokenHash))continue;
   try{
    let state=snapshots.get(actor.id);if(!state){state=this.options.snapshot(actor);snapshots.set(actor.id,state);}
    const previous=peer.state;peer.state=state;
    if(previous){
     const patch:Record<string,unknown>={revision:state.revision};
     if(JSON.stringify(previous.profile)!==JSON.stringify(state.profile))patch.profile=state.profile;
     if(JSON.stringify(previous.social)!==JSON.stringify(state.social))patch.social=state.social;
     const old=new Map(previous.rooms.map(room=>[room.id,JSON.stringify(room)]));
     const ids=new Set(state.rooms.map(room=>room.id));
     const upsert=state.rooms.filter(room=>old.get(room.id)!==JSON.stringify(room)),remove=previous.rooms.filter(room=>!ids.has(room.id)).map(room=>room.id);
     if(upsert.length||remove.length)patch.rooms={upsert,remove,order:state.rooms.map(room=>room.id)};
     if(Object.keys(patch).length>1)this.send(peer,{type:'state.patch',patch});
    }
    if(change){const event=this.options.event(actor,change);if(event)this.send(peer,{type:'event',event});}
   }catch{peer.ws.close(1011,'Resync required');}
  }
 }
 revoke(hashes:string[]){
  const revoked=new Set(hashes);
  for(const peer of this.peers)if(peer.actor&&revoked.has(peer.actor.tokenHash))peer.ws.close(4401,'Session ended');
  for(const [ticket,lease] of this.tickets)if(revoked.has(lease.actor.tokenHash))this.tickets.delete(ticket);
 }
 private heartbeat(){
  this.pruneTickets();
  for(const peer of this.peers){
   if(peer.actor&&!this.options.valid(peer.actor.tokenHash)){peer.ws.close(4401,'Session ended');continue;}
   if(!peer.alive){peer.ws.terminate();continue;}
   peer.alive=false;peer.ws.ping();
   if(peer.actor)this.send(peer,{type:'heartbeat'});
  }
 }
 close(){if(this.stopped)return;this.stopped=true;clearInterval(this.timer);this.options.server.removeListener('upgrade',this.upgrade);for(const peer of this.peers){clearTimeout(peer.authTimer);peer.ws.terminate();}this.peers.clear();this.tickets.clear();this.wss.close();}
}
