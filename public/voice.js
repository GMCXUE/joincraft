import {Room,RoomEvent,Track} from './voice-sdk.js';
export function createVoice({api,getState,changed,toast}) {
 let current=null,epoch=0,busy=false,micBusy=false,timer=null,deaf=false,mutedByHost=false,lastHeartbeat=0;
 const audio=new Map(),volumes=new Map();let micDevice='',outputDevice='',status='',error='';
 const emit=()=>changed();
 function detach(track){const element=audio.get(track.sid);if(element){element.remove();audio.delete(track.sid);}track.detach();}
 function attach(track,participant){if(track.kind!==Track.Kind.Audio)return;detach(track);const element=track.attach();element.dataset.peer=participant.identity;element.hidden=true;element.muted=deaf;element.volume=volumes.get(participant.identity)??1;document.body.append(element);audio.set(track.sid,element);element.play().catch(()=>emit());}
 const micError=e=>e?.name==='NotAllowedError'?'麦克风权限未开启，请在浏览器或系统设置中允许。':e?.name==='NotFoundError'?'没有找到麦克风，请连接设备后重试。':e?.name==='NotReadableError'?'麦克风被占用或不可用。':e?.message||'麦克风暂不可用';
 async function leave(notify=true){
  ++epoch;const old=current;current=null;clearInterval(timer);timer=null;status='';error='';deaf=false;mutedByHost=false;busy=false;micBusy=false;
  for(const element of audio.values())element.remove();audio.clear();volumes.clear();
  emit();if(old){await old.room.disconnect();if(notify)api(`/api/voice/${old.identity}/leave`,{}).catch(()=>{});}
 }
 async function join(roomId,groupId){
  if(busy)return;if(current?.roomId===roomId&&current?.groupId===groupId)return;
  await leave();const attempt=++epoch;busy=true;status='正在连接';error='';emit();let lease,room;
  try{
   lease=await api(`/api/rooms/${roomId}/groups/${groupId}/join`,{});
   if(attempt!==epoch){api(`/api/voice/${lease.identity}/leave`,{}).catch(()=>{});return;}
   room=new Room({adaptiveStream:false,dynacast:false,audioCaptureDefaults:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},publishDefaults:{audioPreset:{maxBitrate:32000},dtx:true,red:true,stopMicTrackOnMute:true}});
   current={roomId,groupId,identity:lease.identity,room};mutedByHost=lease.muted;
   const active=()=>current?.room===room&&epoch===attempt;
   room.on(RoomEvent.TrackSubscribed,(t,_p,participant)=>{if(active())attach(t,participant);});
   room.on(RoomEvent.TrackUnsubscribed,t=>detach(t));
   for(const event of [RoomEvent.ActiveSpeakersChanged,RoomEvent.ParticipantConnected,RoomEvent.ParticipantDisconnected,RoomEvent.TrackMuted,RoomEvent.TrackUnmuted,RoomEvent.LocalTrackPublished,RoomEvent.LocalTrackUnpublished,RoomEvent.ParticipantPermissionsChanged,RoomEvent.AudioPlaybackStatusChanged])room.on(event,()=>{if(active())emit();});
   room.on(RoomEvent.Reconnecting,()=>{if(active()){status='正在重连';emit();}});
   room.on(RoomEvent.Reconnected,()=>{if(active()){status='语音已连接';emit();}});
   room.on(RoomEvent.Disconnected,()=>{if(active()){void leave();toast('语音已断开，可重新加入');}});
   room.on(RoomEvent.MediaDevicesError,e=>{if(active()){error=micError(e);emit();}});
   await room.connect(lease.url,lease.token,{autoSubscribe:true});
   if(!active()){await room.disconnect();return;}
   // Joining starts in listen-only mode. Only the microphone button can request capture.
   status='语音已连接';lastHeartbeat=Date.now();
   await room.startAudio().catch(()=>{});
   timer=setInterval(async()=>{
    if(!active())return;
    try{const result=await api(`/api/voice/${lease.identity}/heartbeat`,{});if(!active())return;lastHeartbeat=Date.now();mutedByHost=result.muted;if(mutedByHost&&room.localParticipant.isMicrophoneEnabled)await room.localParticipant.setMicrophoneEnabled(false);emit();}
    catch(e){if(active()&&(e.status===401||e.status===403||Date.now()-lastHeartbeat>40000)){await leave();toast('语音会话已结束，请重新加入');}}
   },12000);
  }catch(e){if(attempt===epoch){await leave();error=e.status?e.message:'无法连接语音服务，请确认服务运行和网络连接。';toast(error);}}
  finally{if(attempt===epoch){busy=false;emit();}}
 }
 async function microphone(){
  const selected=current;if(!selected||micBusy)return;
  if(mutedByHost||selected.room.localParticipant.permissions?.canPublish===false){toast('房主已限制你的麦克风');return;}
  micBusy=true;error='';emit();
  try{
   if(deaf){deaf=false;for(const el of audio.values())el.muted=false;await selected.room.startAudio();}
   await selected.room.localParticipant.setMicrophoneEnabled(!selected.room.localParticipant.isMicrophoneEnabled,micDevice?{deviceId:micDevice}:undefined);
   if(current!==selected)await selected.room.disconnect();
  }catch(e){if(current===selected)error=micError(e);}
  finally{micBusy=false;emit();}
 }
 async function deafen(){const selected=current;if(!selected)return;try{
  deaf=!deaf;for(const el of audio.values())el.muted=deaf;
  if(deaf)await selected.room.localParticipant.setMicrophoneEnabled(false);
  else await selected.room.startAudio();
 }catch(e){error=micError(e);}emit();}
 function snapshot(){
  const r=current?.room;return {roomId:current?.roomId,groupId:current?.groupId,busy,micBusy,status,error,deaf,
   mic:!!r?.localParticipant.isMicrophoneEnabled,blocked:mutedByHost||r?.localParticipant.permissions?.canPublish===false,
   playbackBlocked:r&&!r.canPlaybackAudio,
   participants:r?[r.localParticipant,...r.remoteParticipants.values()].map(p=>{let userId;try{userId=JSON.parse(p.metadata||'{}').userId;}catch{}return {userId,identity:p.identity,name:p.name,volume:volumes.get(p.identity)??1,muted:!p.isMicrophoneEnabled,speaking:p.isSpeaking};}):[]};
 }
 async function devices(){const inputs=await Room.getLocalDevices('audioinput',false),outputs=await Room.getLocalDevices('audiooutput',false);return {inputs,outputs,micDevice,outputDevice,outputSupported:typeof HTMLMediaElement.prototype.setSinkId==='function'};}
 async function selectDevices(input,output){if(!current)return;
  await current.room.switchActiveDevice('audioinput',input||'default');micDevice=input||'';
  if(output!==undefined){await current.room.switchActiveDevice('audiooutput',output||'default');outputDevice=output||'';}
 }
 function volume(identity,value){volumes.set(identity,value);for(const el of audio.values())if(el.dataset.peer===identity)el.volume=value;}
 function sync(){if(current){const room=getState().rooms.find(r=>r.id===current.roomId&&!r.closed);if(!room||!room.community?.groups.some(g=>g.id===current.groupId))void leave();else mutedByHost=room.community.muted.includes(getState().profile?.id);}}
 window.addEventListener('pagehide',()=>void leave());
 return {join,leave,microphone,deafen,snapshot,devices,selectDevices,volume,sync,resume:async()=>{await current?.room.startAudio();emit();}};
}
