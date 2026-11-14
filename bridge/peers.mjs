/** Select one path for a guest session. An interrupted game stream is never replayed. */
export class PeerConnections {
 constructor({role,createPeer,send,onStream,onRoute=()=>{},timeout=4500}){
  Object.assign(this,{role,createPeer,send,onStream,onRoute,timeout});this.entries=new Map();this.closed=false;this.choice=role==='guest'?'checking':null;
  this.decision=new Promise(resolve=>this.decided=resolve);
 }
 start(){this.send({type:'p2p-enable',version:1});if(this.role==='guest'){this.onRoute({transport:'checking',latency:null});this.timer=setTimeout(()=>this.relay('直连未就绪，已使用服务器中继'),this.timeout).unref();}}
 handle(message){
  if(!message.type?.startsWith('p2p-'))return false;
  if(this.closed)return true;
  if(message.type==='p2p-peer'&&/^[a-f0-9-]{36}$/i.test(message.peerId)&&message.initiator===(this.role==='guest'))this.add(message.peerId,message.initiator);
  else if(message.type==='p2p-signal'){
   const entry=this.entries.get(message.peerId);if(entry&&message.signal?.type==='close'){this.drop(entry,'直连已断开，重新加入将使用服务器中继',false);return true;}if(entry)entry.signals=entry.signals.then(async()=>{const peer=await entry.creating;if(!entry.closed)await peer.signal(message.signal);}).catch(()=>this.drop(entry,'直连协商失败，已使用服务器中继'));
  }else if(message.type==='p2p-left'){const entry=this.entries.get(message.peerId);if(entry)this.drop(entry,'对端已断开');}
  return true;
 }
 add(id,initiator){
  if(this.entries.has(id)||this.entries.size>=64||this.role==='guest'&&this.choice==='relay')return;
  const entry={id,peer:null,ready:false,closed:false,signals:Promise.resolve()};this.entries.set(id,entry);
  entry.creating=Promise.resolve().then(()=>this.createPeer({id,initiator,
   onSignal:signal=>{if(!entry.closed&&!this.closed)this.send({type:'p2p-signal',peerId:id,signal});},
   onStream:stream=>{if(entry.closed||this.closed)stream.destroy();else this.onStream(stream);},
   onState:state=>{
    if(entry.closed||this.closed)return;
    if(state.status==='ready'){entry.ready=true;clearTimeout(entry.timer);if(this.role==='guest'&&this.choice==='checking'){clearTimeout(this.timer);this.choice='p2p';this.decided();this.onRoute({transport:'p2p',latency:null});if(entry.peer)this.poll(entry);}}
    else if(state.status==='closed')this.drop(entry,'直连已断开，重新加入将使用服务器中继');
   },
  })).then(peer=>{entry.peer=peer;if(entry.closed||this.closed)peer.close();else if(this.role==='guest'&&entry.ready)this.poll(entry);return peer;}).catch(()=>{this.drop(entry,'直连不可用，已使用服务器中继');return null;});
  entry.timer=setTimeout(()=>this.drop(entry,'直连超时，已使用服务器中继'),this.timeout).unref();
 }
 poll(entry){
  if(entry.stats)return;
  const measure=async()=>{if(entry.closed||this.choice!=='p2p'||!entry.peer)return;try{const result=await entry.peer.stats();if(!entry.closed&&this.choice==='p2p')this.onRoute({transport:'p2p',latency:result.latency});}catch{/* Missing stats never invalidate a live game stream. */}};
  void measure();entry.stats=setInterval(measure,10000).unref();
 }
 drop(entry,reason,inform=true){
  if(entry.closed)return;entry.closed=true;if(inform&&!this.closed)this.send({type:'p2p-signal',peerId:entry.id,signal:{type:'close'}});clearTimeout(entry.timer);clearInterval(entry.stats);this.entries.delete(entry.id);entry.peer?.close();
  if(this.role==='guest'&&!this.closed)this.relay(reason);
 }
 relay(reason){
  if(this.closed)return;const changed=this.choice!=='relay';this.choice='relay';clearTimeout(this.timer);this.decided();
  for(const entry of [...this.entries.values()])this.drop(entry,reason);
  if(changed)this.onRoute({transport:'relay',latency:null,reason});
 }
 async openStream(){
  if(this.choice==='checking')await this.decision;
  if(this.closed||this.choice!=='p2p')return null;
  const entry=[...this.entries.values()].find(item=>item.ready&&!item.closed);
  try{const peer=entry&&await entry.creating;if(!peer)throw Error();return await peer.openStream();}
  catch{this.relay('直连通道不可用，已使用服务器中继');return null;}
 }
 close(){if(this.closed)return;this.closed=true;clearTimeout(this.timer);this.decided();for(const entry of [...this.entries.values()])this.drop(entry);}
}
