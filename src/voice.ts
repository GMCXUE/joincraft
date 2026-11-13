import { randomUUID } from 'node:crypto';
import { AccessToken, TokenVerifier, RoomServiceClient, TrackSource, type ParticipantInfo } from 'livekit-server-sdk';
import type { Principal } from './service.js';
import { Community } from './community.js';
import { fail } from './validation.js';
export type VoiceConfig = { url: string; apiUrl?: string; key: string; secret: string };
export type VoiceGateway = Pick<RoomServiceClient,'createRoom'|'listRooms'|'listParticipants'|'removeParticipant'|'updateParticipant'>;
type Lease = {identity:string;user_id:string;token_hash:string;room_id:string;group_id:string;expires_at:number;revoked:number};
type Presence = {userId:string;groupId:string;muted:boolean};
const mediaRoom=(group:string)=>`joincraft-${group}`;
const absent=(e:unknown)=>!!e&&typeof e==='object'&&'code' in e&&e.code==='not_found';
export class Voice {
  disconnectSignal: (identity:string)=>void = ()=>{};
  private gateway?: VoiceGateway;
  private queue: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private stopped=false;
  private reconciling:Promise<void>|null=null;
  private presence=new Map<string,Presence[]>();
  constructor(readonly community:Community,readonly config?:VoiceConfig,gateway?:VoiceGateway) {
    if(config){
      const url=new URL(config.url);if(!['ws:','wss:'].includes(url.protocol))throw new Error('LIVEKIT_URL must use ws/wss');
      this.gateway=gateway??new RoomServiceClient(config.apiUrl??config.url.replace(/^ws/,'http'),config.key,config.secret,{requestTimeout:4});
      community.voiceEnabled=true;
      // A server restart invalidates outstanding browser leases instead of trusting old sessions.
      this.store.run('UPDATE voice_leases SET revoked=1');
      this.timer=setInterval(()=>void this.reconcile(),3000).unref();
    }
    community.voiceState=id=>this.presence.get(id)??[];
  }
  private get store(){return this.community.store;}
  private get rooms(){return this.community.rooms;}
  private serial<T>(fn:()=>Promise<T>):Promise<T> {
    const result=this.queue.then(()=>{if(this.stopped)throw new Error('Voice stopped');return fn();});
    this.queue=result.catch(()=>{});return result;
  }
  private ready(){if(!this.gateway||!this.config)fail('语音服务尚未配置',503);return this.gateway;}
  private leases(sql='1=1',...params:string[]){return this.store.all<Lease>(`SELECT * FROM voice_leases WHERE ${sql}`,...params);}
  private valid(l:Lease){return !l.revoked&&!this.store.get<{revoked:number}>('SELECT revoked FROM voice_leases WHERE identity=?',l.identity)?.revoked&&l.expires_at>this.rooms.now()&&this.rooms.sessionValid(l.token_hash)&&!!this.store.get(`SELECT 1 FROM members m JOIN rooms r ON r.id=m.room_id JOIN voice_groups g ON g.room_id=r.id WHERE m.user_id=? AND r.id=? AND r.closed=0 AND g.id=? AND g.deleted=0`,l.user_id,l.room_id,l.group_id);}
  private muted(room:string,user:string){return !!this.store.get<{muted:number}>('SELECT muted FROM voice_rules WHERE room_id=? AND user_id=?',room,user)?.muted;}
  private async remove(l:Lease) {
    this.store.run('UPDATE voice_leases SET revoked=1 WHERE identity=?',l.identity);
    this.disconnectSignal(l.identity);
    try{await this.ready().removeParticipant(mediaRoom(l.group_id),l.identity,{revokeTokenTs:BigInt(Math.floor(this.rooms.now()/1000)+1)});}
    catch(e){if(!absent(e))throw e;}
  }
  identityValid(identity:string){const lease=this.store.get<Lease>('SELECT * FROM voice_leases WHERE identity=?',identity);return !!lease&&this.valid(lease);}
  async authorize(token:string){
    this.ready();if(!token||token.length>16000)fail('语音凭据无效',401);
    let claims;try{claims=await new TokenVerifier(this.config!.key,this.config!.secret).verify(token,0);}catch{fail('语音凭据已失效',401);}
    const lease=this.store.get<Lease>('SELECT * FROM voice_leases WHERE identity=?',claims.sub??'');
    if(!lease||!this.valid(lease)||claims.video?.room!==mediaRoom(lease.group_id))fail('语音会话已结束',403);
    const user=this.store.get<{name:string}>('SELECT name FROM users WHERE id=?',lease.user_id)!;
    // Re-sign from current rules: a cached/refreshed token cannot undo a host mute on reconnect.
    const upstream=new AccessToken(this.config!.key,this.config!.secret,{identity:lease.identity,name:user.name,ttl:30,metadata:JSON.stringify({userId:lease.user_id})});
    upstream.addGrant({roomJoin:true,room:mediaRoom(lease.group_id),canSubscribe:true,canPublish:!this.muted(lease.room_id,lease.user_id),canPublishData:false,canPublishSources:[TrackSource.MICROPHONE]});
    const upstreamToken=await upstream.toJwt();if(!this.valid(lease))fail('语音会话已结束',403);
    return {identity:lease.identity,upstreamToken};
  }
  join(actor:Principal,id:string,groupId:string){return this.serial(async()=>{
    const gateway=this.ready();let room=this.rooms.accessible(id,actor);this.community.group(id,groupId);
    this.rooms.consume(`voice-join:${actor.id}`,20,60000);
    const allowed=()=>{
      room=this.rooms.accessible(id,actor);this.community.group(id,groupId);
      if(!this.rooms.sessionValid(actor.tokenHash))fail('登录已失效',401);
      const rule=this.store.get<{blocked_until:number}>('SELECT blocked_until FROM voice_rules WHERE room_id=? AND user_id=?',id,actor.id);
      if(rule&&rule.blocked_until>this.rooms.now())fail('房主已将你移出语音，请稍后再加入',403);
    };allowed();
    try{
      for(const lease of this.leases('user_id=? AND revoked=0',actor.id))await this.remove(lease);
      await gateway.createRoom({name:mediaRoom(groupId),maxParticipants:room.capacity,emptyTimeout:60,departureTimeout:20});
    }catch{fail('语音服务器连接失败，请稍后重试',503);}
    allowed();
    const identity=randomUUID(),muted=this.muted(id,actor.id);
    const token=new AccessToken(this.config!.key,this.config!.secret,{identity,name:actor.name,ttl:30,metadata:JSON.stringify({userId:actor.id})});
    token.addGrant({roomJoin:true,room:mediaRoom(groupId),canSubscribe:true,canPublish:!muted,canPublishData:false,canPublishSources:[TrackSource.MICROPHONE]});
    const jwt=await token.toJwt();allowed();
    this.store.run('INSERT INTO voice_leases VALUES (?,?,?,?,?,?,0)',identity,actor.id,actor.tokenHash,id,groupId,this.rooms.now()+45000);
    return {url:this.config!.url,token:jwt,identity,groupId,muted};
  });}
  heartbeat(actor:Principal,identity:string){
    const lease=this.store.get<Lease>('SELECT * FROM voice_leases WHERE identity=? AND token_hash=?',identity,actor.tokenHash);
    if(!lease||!this.valid(lease))fail('语音连接已结束，请重新加入',403);
    this.store.run('UPDATE voice_leases SET expires_at=? WHERE identity=?',this.rooms.now()+45000,identity);
    return {ok:true,muted:this.muted(lease.room_id,actor.id)};
  }
  leave(actor:Principal,identity:string){return this.serial(async()=>{
    const lease=this.store.get<Lease>('SELECT * FROM voice_leases WHERE identity=? AND token_hash=?',identity,actor.tokenHash);
    if(lease){try{await this.remove(lease);}catch{fail('语音断开请求尚未完成，请重试',503);}}
    return {ok:true};
  });}
  moderate(actor:Principal,id:string,user:string,action:string){return this.serial(async()=>{
    const gateway=this.ready();this.community.host(actor,id);
    if(user===actor.id||!this.rooms.members(id).includes(user))fail('请选择其他房间成员');
    if(!['mute','allow','remove'].includes(action))fail('语音操作无效');
    this.store.run('INSERT OR IGNORE INTO voice_rules(room_id,user_id) VALUES (?,?)',id,user);
    if(action==='remove')this.store.run('UPDATE voice_rules SET blocked_until=? WHERE room_id=? AND user_id=?',this.rooms.now()+60000,id,user);
    else this.store.run('UPDATE voice_rules SET muted=? WHERE room_id=? AND user_id=?',action==='mute'?1:0,id,user);
    let failed=false;
    for(const l of this.leases('room_id=? AND user_id=? AND revoked=0',id,user))try{
      if(action==='remove')await this.remove(l);
      // Unmute is opt-in on the user's own device; granting permission never activates their mic.
      else await gateway.updateParticipant(mediaRoom(l.group_id),l.identity,{permission:{canSubscribe:true,canPublish:action==='allow',canPublishData:false,canPublishSources:[TrackSource.MICROPHONE]}});
    }catch(e){if(!absent(e))failed=true;}
    this.community.notify(id);
    if(failed)fail('限制已保存，语音服务器暂未响应，正在重试',503);
    return {ok:true};
  });}
  reconcile():Promise<void>{if(this.reconciling)return this.reconciling;this.reconciling=this.serial(async()=>{
    if(!this.gateway)return;
    try{
      const leases=this.leases();
      for(const l of leases)if(!l.revoked&&!this.valid(l))await this.remove(l);
      const liveRooms=await this.gateway.listRooms();
      const next=new Map<string,Presence[]>();
      for(const remote of liveRooms){
        if(!remote.name.startsWith('joincraft-'))continue;
        const groupId=remote.name.slice('joincraft-'.length);
        const group=this.store.get<{room_id:string}>('SELECT room_id FROM voice_groups WHERE id=?',groupId);
        if(!group)continue;
        const peers:ParticipantInfo[]=await this.gateway.listParticipants(remote.name);
        for(const peer of peers){
          const lease=leases.find(l=>l.identity===peer.identity&&l.group_id===groupId);
          if(!lease||!this.valid(lease)){
            await this.gateway.removeParticipant(remote.name,peer.identity,{revokeTokenTs:BigInt(Math.floor(this.rooms.now()/1000)+1)});continue;
          }
          const muted=this.muted(lease.room_id,lease.user_id);
          if(peer.permission?.canPublish===muted)await this.gateway.updateParticipant(remote.name,peer.identity,{permission:{canSubscribe:true,canPublish:!muted,canPublishData:false,canPublishSources:[TrackSource.MICROPHONE]}});
          const list=next.get(group.room_id)??[];
          list.push({userId:lease.user_id,groupId,muted:muted||!peer.tracks.some(t=>t.source===TrackSource.MICROPHONE&&!t.muted)});next.set(group.room_id,list);
        }
      }
      for(const id of new Set([...this.presence.keys(),...next.keys()])){
        const a=this.presence.get(id)??[],b=next.get(id)??[];b.sort((a,b)=>a.userId.localeCompare(b.userId));
        if(JSON.stringify(a)!==JSON.stringify(b)){this.presence.set(id,b);this.community.notify(id);}
      }
      this.store.run('DELETE FROM voice_leases WHERE revoked=1 AND expires_at<?',this.rooms.now()-60000);
    }catch{/* Keep leases revoked and retry on the next tick when SFU connectivity returns. */}
  }).catch(()=>{}).finally(()=>{this.reconciling=null;});return this.reconciling;}
  revoke(hashes:string[]){for(const hash of hashes){for(const l of this.leases('token_hash=?',hash))this.disconnectSignal(l.identity);this.store.run('UPDATE voice_leases SET revoked=1 WHERE token_hash=?',hash);}void this.reconcile();}
  async close(){clearInterval(this.timer);await this.queue;this.stopped=true;}
}
