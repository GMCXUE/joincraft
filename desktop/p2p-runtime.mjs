import {EventEmitter} from 'node:events';
import {Duplex} from 'node:stream';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
export const P2P_PAGE=pathToFileURL(path.join(here,'../public/launcher/p2p.html')).href;
export const DEFAULT_ICE_SERVERS=[{urls:'stun:stun.cloudflare.com:3478'}];
const FRAME_BYTES=16384,WINDOW_BYTES=524288;

export function trustedTransportEvent(event,view){return !!view&&!view.webContents.isDestroyed()&&event.sender===view.webContents&&event.senderFrame===view.webContents.mainFrame&&event.senderFrame.url===P2P_PAGE;}

/** One non-visible, packaged renderer uses Chromium WebRTC; it never loads remote code. */
export class ElectronP2P {
 constructor({createView,ipcMain,iceServers=DEFAULT_ICE_SERVERS}){
  Object.assign(this,{createView,ipcMain,iceServers});this.peers=new Map();this.pending=new Map();this.next=0;this.view=null;this.loading=null;
  this.reply=(event,result)=>{if(!trustedTransportEvent(event,this.view))return;const task=this.pending.get(result?.id);if(!task)return;this.pending.delete(result.id);clearTimeout(task.timer);result.ok?task.resolve(result.value):task.reject(Error(result.error||'直连操作失败'));};
  this.event=(event,value)=>{if(trustedTransportEvent(event,this.view))this.peers.get(value?.peerId)?.receive(value);};
  ipcMain.on('p2p:reply',this.reply);ipcMain.on('p2p:event',this.event);
 }
 async ensure(){
  if(this.disposed)throw Error('直连组件已关闭');
  if(!this.loading){
   this.view=this.createView({webPreferences:{preload:path.join(here,'p2p-preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false,partition:'joincraft-p2p'}});this.view.setVisible(false);
   const contents=this.view.webContents;contents.setWindowOpenHandler(()=>({action:'deny'}));contents.on('will-navigate',event=>event.preventDefault());
   contents.session.setPermissionRequestHandler((_wc,_permission,done)=>done(false));contents.session.setPermissionCheckHandler(()=>false);
   contents.on('render-process-gone',()=>this.fail(Error('直连组件已退出')));
   this.loading=contents.loadURL(P2P_PAGE).catch(error=>{this.fail(error);throw error;});
  }
  await this.loading;
 }
 fail(error){for(const peer of [...this.peers.values()])peer.close(error.message);for(const task of this.pending.values()){clearTimeout(task.timer);task.reject(error);}this.pending.clear();}
 async request(op,peerId,value={}){
  await this.ensure();if(this.pending.size>=256||this.view.webContents.isDestroyed())throw Error('直连组件繁忙');
  return new Promise((resolve,reject)=>{const id=++this.next,timer=setTimeout(()=>{this.pending.delete(id);reject(Error('直连组件响应超时'));},12000).unref();this.pending.set(id,{resolve,reject,timer});this.view.webContents.send('p2p:request',{id,op,peerId,...value});});
 }
 async create({id,initiator,onSignal,onStream,onState}){
  await this.ensure();if(this.peers.has(id))throw Error('重复的直连会话');const peer=new RtcPeer(this,id,{onSignal,onStream,onState});this.peers.set(id,peer);
  try{await this.request('create',id,{initiator,iceServers:this.iceServers});return peer;}catch(error){peer.close(error.message);throw error;}
 }
 dispose(){this.disposed=true;this.fail(Error('直连组件已关闭'));this.ipcMain.removeListener('p2p:reply',this.reply);this.ipcMain.removeListener('p2p:event',this.event);if(this.view&&!this.view.webContents.isDestroyed())this.view.webContents.close();this.loading=null;this.view=null;}
}

class RtcPeer extends EventEmitter {
 constructor(runtime,id,callbacks){super();Object.assign(this,{runtime,id,...callbacks});this.streams=new Map();this.closed=false;this.ready=false;}
 signal(signal){return this.runtime.request('signal',this.id,{signal});}
 stats(){return this.runtime.request('stats',this.id);}
 receive(event){
  if(this.closed)return;
  if(event.kind==='signal'){this.onSignal(event.signal);return;}
  if(event.kind==='ready'){this.ready=true;this.onState({status:'ready'});return;}
  if(event.kind==='failed'){this.close(event.message);return;}
  if(event.kind==='incoming'){
   if(this.streams.size>=8){this.close('游戏连接数达到上限');return;}
   const stream=new RtcStream(this,event.channelId);this.streams.set(event.channelId,stream);this.onStream(stream);return;
  }
  this.streams.get(event.channelId)?.receive(event);
 }
 async openStream(){
  if(!this.ready||this.closed)throw Error('直连尚未就绪');if(this.streams.size>=8)throw Error('游戏连接数达到上限');
  const id=randomUUID(),stream=new RtcStream(this,id);this.streams.set(id,stream);
  try{await this.runtime.request('open',this.id,{channelId:id});await stream.opened;return stream;}catch(error){stream.destroy(error);throw error;}
 }
 close(message='直连已关闭'){
  if(this.closed)return;this.closed=true;this.runtime.peers.delete(this.id);for(const stream of this.streams.values())stream.destroy(Error(message));
  if(this.runtime.view&&!this.runtime.view.webContents.isDestroyed())void this.runtime.request('close',this.id).catch(()=>{});
  this.onState({status:'closed',message});
 }
}

export class RtcStream extends Duplex {
 constructor(peer,id){
  super({highWaterMark:65536,allowHalfOpen:true});this.peer=peer;this.id=id;this.inFlight=0;this.pendingRead=0;this.waitCredit=null;
  this.opened=new Promise((resolve,reject)=>{this.didOpen=resolve;this.openFailed=reject;});this.opened.catch(()=>{});
  this.openTimer=setTimeout(()=>this.destroy(Error('直连游戏通道打开超时')),5000).unref();this.on('error',()=>{});
 }
 request(op,value){return this.peer.runtime.request(op,this.peer.id,{channelId:this.id,...value});}
 _read(){this.consume();}
 consume(){if(!this.pendingRead||this.destroyed)return;const size=this.pendingRead;this.pendingRead=0;void this.request('consume',{size}).catch(error=>this.destroy(error));}
 receive(event){
  if(this.destroyed)return;
  if(event.kind==='open'){clearTimeout(this.openTimer);this.didOpen();}
  else if(event.kind==='data'){const bytes=Buffer.from(event.bytes);this.pendingRead+=bytes.length;if(this.push(bytes))this.consume();}
  else if(event.kind==='credit'){
   if(!Number.isInteger(event.size)||event.size<=0||event.size>this.inFlight){this.destroy(Error('直连流量确认无效'));return;}
   this.inFlight-=event.size;if(this.inFlight<WINDOW_BYTES){this.waitCredit?.resolve();this.waitCredit=null;}
  }else if(event.kind==='end')this.push(null);
  else if(event.kind==='closed')this.destroy();
 }
 _write(chunk,_encoding,callback){
  void (async()=>{await this.opened;for(let offset=0;offset<chunk.length;offset+=FRAME_BYTES){
   if(this.destroyed)throw Error('直连已关闭');
   while(this.inFlight>=WINDOW_BYTES)await new Promise((resolve,reject)=>{this.waitCredit={resolve,reject};});
   const bytes=chunk.subarray(offset,offset+FRAME_BYTES);this.inFlight+=bytes.length;await this.request('send',{bytes:new Uint8Array(bytes)});
  }})().then(()=>callback(),callback);
 }
 _final(callback){void (async()=>{while(this.inFlight>0){if(this.destroyed)throw Error('直连已关闭');await new Promise((resolve,reject)=>{this.waitCredit={resolve,reject};});}await this.request('finish');})().then(()=>callback(),callback);}
 _destroy(error,callback){
  clearTimeout(this.openTimer);this.openFailed(error||Error('直连已关闭'));this.waitCredit?.reject(error||Error('直连已关闭'));this.waitCredit=null;this.peer.streams.delete(this.id);
  if(!this.peer.closed)void this.request('drop').catch(()=>{});callback(error);
 }
}
