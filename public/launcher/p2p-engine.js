// Runs only in the packaged, sandboxed transport renderer. No game, account or filesystem API.
export const FRAME_BYTES=16384,WINDOW_BYTES=524288;
const idPattern=/^[a-f0-9-]{36}$/i;
export class RtcEngine {
 constructor({emit,PeerConnection=globalThis.RTCPeerConnection}){this.emit=emit;this.PeerConnection=PeerConnection;this.peers=new Map();}
 async command({op,peerId,...value}){
  if(!idPattern.test(peerId))throw Error('直连标识无效');
  if(op==='create')return this.create(peerId,value);
  const peer=this.peers.get(peerId);if(!peer)throw Error('直连已关闭');
  if(op==='signal'){peer.signals=peer.signals.then(()=>this.signal(peer,value.signal));return peer.signals;}
  if(op==='close'){this.close(peer);return;}
  if(op==='stats')return this.stats(peer);
  if(op==='open'){
   if(!peer.initiator||!peer.ready||!idPattern.test(value.channelId)||peer.channels.size>=8)throw Error('无法创建游戏通道');
   const channel=peer.pc.createDataChannel('game:'+value.channelId,{ordered:true,protocol:'joincraft-tcp-v1'});this.attach(peer,channel,value.channelId);return;
  }
  const item=peer.channels.get(value.channelId);if(!item)throw Error('游戏通道已关闭');
  if(op==='drop'){item.channel.close();return;}
  if(op==='send'){
   const bytes=new Uint8Array(value.bytes);if(!bytes.length||bytes.length>FRAME_BYTES||item.localEnd)throw Error('游戏数据无效');
   await this.send(item,0,bytes);return;
  }
  if(op==='consume'){
   if(!Number.isInteger(value.size)||value.size<=0||value.size>item.pending)throw Error('游戏流量确认无效');
   item.pending-=value.size;const bytes=new Uint8Array(4);new DataView(bytes.buffer).setUint32(0,value.size);await this.send(item,1,bytes);return;
  }
  if(op==='finish'){if(!item.localEnd){item.localEnd=true;await this.send(item,2);}return;}
  throw Error('未知直连操作');
 }
 async create(id,{initiator,iceServers}){
  if(this.peers.has(id)||this.peers.size>=64)throw Error('直连数量达到上限');
  const pc=new this.PeerConnection({iceServers,bundlePolicy:'max-bundle'}),peer={id,pc,initiator:initiator===true,channels:new Map(),candidates:[],signals:Promise.resolve(),ready:false,closed:false};this.peers.set(id,peer);
  pc.onicecandidate=event=>{if(event.candidate&&!peer.closed)this.emit({kind:'signal',peerId:id,signal:{type:'candidate',candidate:event.candidate.toJSON()}});};
  pc.onconnectionstatechange=()=>{
   if(pc.connectionState==='failed')this.close(peer,'直连网络不可用');
   if(pc.connectionState==='disconnected'&&!peer.disconnectTimer)peer.disconnectTimer=setTimeout(()=>{peer.disconnectTimer=null;if(pc.connectionState==='disconnected')this.close(peer,'直连已断开');},3000);
   if(pc.connectionState==='connected'){clearTimeout(peer.disconnectTimer);peer.disconnectTimer=null;}
  };
  pc.ondatachannel=event=>{
   const channel=event.channel;
   if(!peer.initiator&&channel.label==='joincraft-control-v1'&&!peer.control)this.control(peer,channel);
   else if(!peer.initiator&&peer.ready&&channel.label.startsWith('game:')&&idPattern.test(channel.label.slice(5))&&peer.channels.size<8&&channel.protocol==='joincraft-tcp-v1')this.attach(peer,channel,channel.label.slice(5),true);
   else this.close(peer,'直连通道协议不匹配');
  };
  if(peer.initiator){this.control(peer,pc.createDataChannel('joincraft-control-v1',{ordered:true,protocol:'joincraft-control-v1'}));await pc.setLocalDescription(await pc.createOffer());this.emit({kind:'signal',peerId:id,signal:{type:'offer',sdp:pc.localDescription.sdp}});}
 }
 control(peer,channel){
  if(!channel.ordered||channel.maxRetransmits!==null||channel.maxPacketLifeTime!==null||channel.protocol!=='joincraft-control-v1'){this.close(peer,'直连可靠性配置不匹配');return;}
  peer.control=channel;channel.onmessage=()=>this.close(peer,'直连控制消息无效');
  channel.onopen=()=>{if(peer.closed)return;peer.ready=true;this.emit({kind:'ready',peerId:peer.id});};
  channel.onclose=()=>this.close(peer,'直连已关闭');channel.onerror=()=>this.close(peer,'直连发生错误');
 }
 async signal(peer,signal){
  if(peer.closed)throw Error('直连已关闭');
  if(signal?.type==='candidate'){
   if(peer.pc.remoteDescription)await peer.pc.addIceCandidate(signal.candidate);
   else{if(peer.candidates.length>=100)throw Error('网络候选过多');peer.candidates.push(signal.candidate);}return;
  }
  if(!signal||!['offer','answer'].includes(signal.type)||(signal.type==='offer')===peer.initiator||peer.pc.remoteDescription)throw Error('直连协商顺序无效');
  await peer.pc.setRemoteDescription({type:signal.type,sdp:signal.sdp});
  for(const candidate of peer.candidates)await peer.pc.addIceCandidate(candidate);peer.candidates=[];
  if(!peer.initiator){await peer.pc.setLocalDescription(await peer.pc.createAnswer());this.emit({kind:'signal',peerId:peer.id,signal:{type:'answer',sdp:peer.pc.localDescription.sdp}});}
 }
 attach(peer,channel,id,incoming=false){
  if(peer.channels.has(id)||!channel.ordered||channel.maxRetransmits!==null||channel.maxPacketLifeTime!==null){this.close(peer,'游戏通道协议无效');return;}
  const item={channel,pending:0,localEnd:false,remoteEnd:false,waiters:new Set()};peer.channels.set(id,item);channel.binaryType='arraybuffer';channel.bufferedAmountLowThreshold=65536;
  if(incoming)this.emit({kind:'incoming',peerId:peer.id,channelId:id});
  channel.onopen=()=>this.emit({kind:'open',peerId:peer.id,channelId:id});
  channel.onmessage=event=>{
   const bytes=event.data instanceof ArrayBuffer?new Uint8Array(event.data):null;
   if(!bytes||bytes.length<1||bytes.length>FRAME_BYTES+1){channel.close();return;}
   if(bytes[0]===0&&bytes.length>1&&!item.remoteEnd){
    item.pending+=bytes.length-1;if(item.pending>WINDOW_BYTES+FRAME_BYTES){channel.close();return;}
    this.emit({kind:'data',peerId:peer.id,channelId:id,bytes:bytes.slice(1)});
   }else if(bytes[0]===1&&bytes.length===5)this.emit({kind:'credit',peerId:peer.id,channelId:id,size:new DataView(bytes.buffer).getUint32(1)});
   else if(bytes[0]===2&&bytes.length===1&&!item.remoteEnd){item.remoteEnd=true;this.emit({kind:'end',peerId:peer.id,channelId:id});}
   else channel.close();
  };
  channel.onclose=()=>{if(!peer.channels.delete(id))return;for(const reject of item.waiters)reject(Error('游戏通道已关闭'));this.emit({kind:'closed',peerId:peer.id,channelId:id});};
  channel.onerror=()=>channel.close();
 }
 async send(item,type,bytes=new Uint8Array()){
  const channel=item.channel;if(channel.readyState!=='open')throw Error('游戏通道尚未就绪');
  if(channel.bufferedAmount>262144)await new Promise((resolve,reject)=>{
   const finish=error=>{clearTimeout(timer);item.waiters.delete(failed);channel.removeEventListener('bufferedamountlow',ready);error?reject(error):resolve();};
   const ready=()=>finish(),failed=error=>finish(error),timer=setTimeout(()=>finish(Error('直连发送超时')),10000);item.waiters.add(failed);channel.addEventListener('bufferedamountlow',ready,{once:true});
  });
  if(channel.readyState!=='open')throw Error('游戏通道已关闭');const frame=new Uint8Array(bytes.length+1);frame[0]=type;frame.set(bytes,1);channel.send(frame);
 }
 async stats(peer){
  const reports=await peer.pc.getStats();let pair;
  for(const report of reports.values())if(report.type==='transport'&&report.selectedCandidatePairId)pair=reports.get(report.selectedCandidatePairId);
  if(!pair)for(const report of reports.values())if(report.type==='candidate-pair'&&report.nominated&&report.state==='succeeded')pair=report;
  return {latency:typeof pair?.currentRoundTripTime==='number'?Math.round(pair.currentRoundTripTime*1000):null};
 }
 close(peer,reason='直连已关闭'){
  if(peer.closed)return;peer.closed=true;clearTimeout(peer.disconnectTimer);this.peers.delete(peer.id);
  for(const {channel} of peer.channels.values())channel.close();peer.control?.close();peer.pc.close();this.emit({kind:'failed',peerId:peer.id,message:reason});
 }
}
