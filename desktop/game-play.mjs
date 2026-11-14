import {startBridge} from '../bridge/client.mjs';
import {status} from '../bridge/minecraft.mjs';
import {assertHostSupport,assertWorldSupport} from '../launcher/host-helper.mjs';
export class GamePlay {
 constructor({api,server,worlds,helper,launcher,matching,getInstance,assertCanLaunch=()=>{},notify=()=>{},bridge=startBridge,probe=status,peerFactory}){Object.assign(this,{api,server,worlds,helper,launcher,matching,getInstance,assertCanLaunch,notify,bridge,probe,peerFactory});this.network=null;this.context=null;this.active=null;this.progress={phase:'idle'};}
 state(){return {context:this.context,progress:this.progress,network:this.network};}
 bridgeState(operation,event){if(this.active!==operation||operation.controller.signal.aborted)return;if(event.status==='route'){this.network={transport:event.transport,latency:event.latency??null,reason:event.reason||''};this.notify({type:'game-play',...this.state()});}else if(['closed','error'].includes(event.status))void this.fail(operation,Error(event.message||'联机连接已断开'));}
 set(phase,message){this.progress={phase,message,roomId:this.context?.roomId,instanceId:this.context?.instanceId,role:this.context?.role};this.notify({type:'game-play',...this.state()});}
 async room(roomId,signal){if(typeof roomId!=='string'||!/^[a-f0-9-]{36}$/i.test(roomId))throw Error('房间标识无效');const state=await this.api('/api/state',undefined,{signal});const room=state.rooms?.find(r=>r.id===roomId&&!r.closed);if(!room)throw Error('房间已关闭或你已离开房间');return room;}
 async exact(room,expectedId,signal){if(!room.pack?.sha512)throw Error('请先为房间选择整合包');const match=await this.matching(room.pack.sha512,{signal});signal?.throwIfAborted();if(match.status!=='ready'||!match.instance?.managed)throw Error('请先安装房间版本的整合包');if(expectedId&&match.instance.id!==expectedId)throw Error('房间整合包已更换，请重新选择');return match.instance;}
 async select(roomId){if(this.active)throw Error('请先停止当前联机');const room=await this.room(roomId),instance=await this.exact(room);if(room.isHost)assertHostSupport(instance);else if(instance.minecraft!=='1.20.1')throw Error('一键加入目前适配 Minecraft 1.20.1');this.network=null;this.context={roomId,roomName:room.name,instanceId:instance.id,role:room.isHost?'host':'guest',port:room.port||25565};this.set('selected',room.isHost?'选择存档后开房':'确认启动设置后加入');return this.state();}
 clear(){if(this.active)throw Error('请先停止当前联机');this.context=null;this.network=null;this.set('idle','');}
 async launch(input,{worldId,port,connectionMode=input?.connectionMode??'auto'}={}){
  this.assertCanLaunch();if(!['auto','relay'].includes(connectionMode))throw Error('联机方式无效');if(this.active)throw Error('已有联机任务，请先停止');
  const context=this.context,controller=new AbortController(),signal=controller.signal;
  const operation={controller,context,id:input.id,helper:null,bridge:null,issued:false,settled:null,connectionMode};this.active=operation;this.network=null;
  const isCurrent=()=>this.active===operation&&!signal.aborted;
  const onExit=()=>{if(isCurrent())void this.stop();};
  try{
   const instance=await this.getInstance(input.id);if(!instance?.managed)throw Error('请选择自有实例');
   if(context&&context.instanceId!==instance.id)throw Error('请选择当前房间对应的实例，或退出房间启动模式');
   if(context?.role==='guest'){
    const room=await this.room(context.roomId,signal);if(room.isHost)throw Error('房间身份已变化，请重新进入');await this.exact(room,instance.id,signal);
    this.set('connecting','正在连接房主');const issued=await this.api(`/api/rooms/${room.id}/play/connect`,{},{signal});operation.issued=true;
    operation.bridge=await this.bridge({server:this.server,ticket:issued.ticket,signal,connectionMode,peerFactory:this.peerFactory,onState:event=>this.bridgeState(operation,event)});
    signal.throwIfAborted();this.set('launching','正在启动并加入房间');await this.launcher.start(input,{type:'server',address:operation.bridge.address,signal,onExit});signal.throwIfAborted();this.set('online','已连接房间，等待游戏进入');return {started:true};
   }
   if(!worldId)throw Error('请先选择一个存档');const world=await this.worlds.resolve(instance.id,worldId);assertWorldSupport(instance,world.metadata);
   if(context){const room=await this.room(context.roomId,signal);if(!room.isHost)throw Error('只有房主可以开房');await this.exact(room,instance.id,signal);assertHostSupport(instance);operation.helper=await this.helper.prepare(instance,world,port??context.port);if(signal.aborted){await operation.helper.cleanup();signal.throwIfAborted();}}
   signal.throwIfAborted();this.set('launching',context?'正在启动世界':'正在进入存档');
   await this.launcher.start(input,{type:'world',folder:world.name,helper:operation.helper,signal,onExit});signal.throwIfAborted();
   if(!context){this.active=null;this.set('idle','已启动存档');return {started:true};}
   this.set('world-loading','等待世界载入并开放端口');
   operation.settled=this.hostReady(operation,context,instance);void operation.settled.catch(error=>this.fail(operation,error));
   return {started:true,hosting:true};
  }catch(error){await this.fail(operation,error);throw error;}
 }
 async hostReady(operation,context,instance){
  const signal=operation.controller.signal;await operation.helper.wait(signal);signal.throwIfAborted();this.set('checking','正在确认世界连接');await this.probe(operation.helper.port,4000,signal);signal.throwIfAborted();
  const room=await this.room(context.roomId,signal);if(!room.isHost)throw Error('房主身份已变化');await this.exact(room,instance.id,signal);
  this.set('connecting','正在建立联机连接');const issued=await this.api(`/api/rooms/${room.id}/play/start`,{port:operation.helper.port},{signal});operation.issued=true;
  operation.bridge=await this.bridge({server:this.server,ticket:issued.ticket,signal,connectionMode:operation.connectionMode,peerFactory:this.peerFactory,onState:event=>this.bridgeState(operation,event)});
  signal.throwIfAborted();if(this.active!==operation)return;this.set('online','开房成功，朋友可以加入游戏');
 }
 async dispose(operation){operation.controller.abort(Error('联机已停止'));operation.bridge?.close();await operation.helper?.cleanup();if(operation.issued&&operation.context)await this.api(`/api/rooms/${operation.context.roomId}/play/${operation.context.role==='host'?'stop':'disconnect'}`,{}).catch(()=>{});}
 async fail(operation,error){if(this.active!==operation)return;this.active=null;this.set('failed',error.message||'联机失败');await this.dispose(operation).catch(()=>{});}
 async stop(){const operation=this.active;this.active=null;this.network=null;this.set('stopped','联机已停止，游戏保持运行');if(operation)await this.dispose(operation).catch(()=>{});}
}
