import { randomUUID } from 'node:crypto';
import { RoomService, type Principal, type RealtimeChange } from './service.js';
import { fail, text } from './validation.js';
import {avatarFor} from './avatars.js';
export type VoiceGroup = { id: string; room_id: string; name: string; is_default: number; deleted: number };
export class Community {
  online: (user: string) => boolean = () => false;
  voiceState: (room: string) => unknown[] = () => [];
  voiceEnabled = false;
  constructor(readonly rooms: RoomService) {}
  get store() { return this.rooms.store; }
  notify(id: string,change?:RealtimeChange) { this.store.bump(); this.rooms.onChange(this.rooms.members(id),change); }
  groups(id: string) { return this.store.all<VoiceGroup>('SELECT * FROM voice_groups WHERE room_id=? AND deleted=0 ORDER BY is_default DESC,created_at,id',id); }
  group(id: string, groupId: string) {
    const group=this.store.get<VoiceGroup>('SELECT * FROM voice_groups WHERE room_id=? AND id=? AND deleted=0',id,groupId);
    if(!group)fail('语音分组不存在',404);return group;
  }
  host(actor: Principal,id: string) { const room=this.rooms.accessible(id,actor);if(room.owner_id!==actor.id)fail('只有房主可以操作',403);return room; }
  snapshot(id: string,actor: Principal) {
    return { groups:this.groups(id).map(g=>({id:g.id,name:g.name,isDefault:!!g.is_default})), voiceEnabled:this.voiceEnabled,
      participants:this.voiceState(id), online:this.rooms.members(id).filter(user=>this.online(user)),
      muted:this.store.all<{user_id:string}>('SELECT user_id FROM voice_rules WHERE room_id=? AND muted=1',id).map(r=>r.user_id),
      unread:this.store.get<{n:number}>(`SELECT count(*) AS n FROM room_messages WHERE room_id=? AND sender_id<>? AND id>COALESCE((SELECT last_id FROM room_reads WHERE room_id=? AND user_id=?),0)`,id,actor.id,id,actor.id)!.n };
  }
  createGroup(actor:Principal,id:string,body:Record<string,unknown>) {
    this.host(actor,id);const name=text(body.name,'分组名称',20);
    if(this.groups(id).length>=8)fail('每个房间最多 8 个语音分组');
    if(this.groups(id).some(g=>g.name===name))fail('已有同名语音分组',409);
    const groupId=randomUUID();this.store.run('INSERT INTO voice_groups VALUES (?,?,?,0,0,?)',groupId,id,name,this.rooms.now());
    this.notify(id);return {id:groupId,name};
  }
  renameGroup(actor:Principal,id:string,groupId:string,body:Record<string,unknown>) {
    this.host(actor,id);this.group(id,groupId);const name=text(body.name,'分组名称',20);
    if(this.groups(id).some(g=>g.id!==groupId&&g.name===name))fail('已有同名语音分组',409);
    this.store.run('UPDATE voice_groups SET name=? WHERE id=?',name,groupId);this.notify(id);return {ok:true};
  }
  deleteGroup(actor:Principal,id:string,groupId:string) {
    this.host(actor,id);if(this.group(id,groupId).is_default)fail('默认分组不能删除');
    this.store.run('UPDATE voice_groups SET deleted=1 WHERE id=?',groupId);this.notify(id);return {ok:true};
  }
  message(actor:Principal,id:string,messageId:number){
    this.rooms.accessible(id,actor);
    const row=this.store.get<{userId:string;avatarId:string|null;[key:string]:unknown}>(`SELECT m.id,m.sender_id AS userId,u.name,p.avatar_id AS avatarId,m.content,m.client_id AS clientId,m.created_at AS at FROM room_messages m JOIN users u ON u.id=m.sender_id LEFT JOIN user_profiles p ON p.user_id=u.id WHERE m.room_id=? AND m.id=?`,id,messageId);
    if(!row)fail('消息不存在',404);return {...row,avatarId:avatarFor(row.userId,row.avatarId)};
  }
  messages(actor:Principal,id:string,before?:string,after?:string) {
    this.rooms.accessible(id,actor);
    if(after!==undefined){
      const cursor=Number(after);if(before!==undefined||!Number.isSafeInteger(cursor)||cursor<0)fail('消息游标无效');
      const rows=this.store.all<{userId:string;avatarId:string|null;[key:string]:unknown}>(`SELECT m.id,m.sender_id AS userId,u.name,p.avatar_id AS avatarId,m.content,m.client_id AS clientId,m.created_at AS at FROM room_messages m JOIN users u ON u.id=m.sender_id LEFT JOIN user_profiles p ON p.user_id=u.id WHERE m.room_id=? AND m.id>? ORDER BY m.id ASC LIMIT 101`,id,cursor);
      return {messages:rows.slice(0,100).map(m=>({...m,avatarId:avatarFor(m.userId,m.avatarId)})),hasMore:rows.length>100};
    }
    const boundary=before===undefined?Number.MAX_SAFE_INTEGER:Number(before);
    if(!Number.isSafeInteger(boundary)||boundary<1)fail('消息游标无效');
    const rows=this.store.all<{userId:string;avatarId:string|null;[key:string]:unknown}>(`SELECT m.id,m.sender_id AS userId,u.name,p.avatar_id AS avatarId,m.content,m.client_id AS clientId,m.created_at AS at FROM room_messages m JOIN users u ON u.id=m.sender_id LEFT JOIN user_profiles p ON p.user_id=u.id WHERE m.room_id=? AND m.id<? ORDER BY m.id DESC LIMIT 51`,id,boundary);
    return {messages:rows.slice(0,50).reverse().map(m=>({...m,avatarId:avatarFor(m.userId,m.avatarId)})),hasMore:rows.length>50};
  }
  send(actor:Principal,id:string,body:Record<string,unknown>) {
    this.rooms.accessible(id,actor);const content=text(body.content,'消息',2000),clientId=text(body.clientId,'消息标识',64);
    if(!/^[A-Za-z0-9_-]{8,64}$/.test(clientId))fail('消息标识格式无效');
    const old=this.store.get<{id:number;room_id:string;content:string}>('SELECT * FROM room_messages WHERE sender_id=? AND client_id=?',actor.id,clientId);
    if(old){if(old.room_id!==id||old.content!==content)fail('消息标识已被使用',409);return {id:old.id};}
    this.rooms.consume(`room-chat:${actor.id}`,60,60000);
    const result=this.store.run('INSERT INTO room_messages(room_id,sender_id,content,client_id,created_at) VALUES (?,?,?,?,?)',id,actor.id,content,clientId,this.rooms.now());
    // Bound storage on the small VPS; retain the most recent 5,000 messages per room.
    this.store.run('DELETE FROM room_messages WHERE room_id=? AND id NOT IN (SELECT id FROM room_messages WHERE room_id=? ORDER BY id DESC LIMIT 5000)',id,id);
    this.notify(id,{type:'room.message',roomId:id,id:Number(result.lastInsertRowid)});return {id:Number(result.lastInsertRowid)};
  }
  read(actor:Principal,id:string,body:Record<string,unknown>) {
    this.rooms.accessible(id,actor);const last=Number(body.lastId);
    if(!Number.isSafeInteger(last)||!this.store.get('SELECT 1 FROM room_messages WHERE room_id=? AND id=?',id,last))fail('消息游标无效');
    const previous=this.store.get<{last_id:number}>('SELECT last_id FROM room_reads WHERE room_id=? AND user_id=?',id,actor.id);if(previous&&previous.last_id>=last)return {ok:true};
    this.store.run('INSERT INTO room_reads VALUES (?,?,?) ON CONFLICT(room_id,user_id) DO UPDATE SET last_id=MAX(last_id,excluded.last_id)',id,actor.id,last);
    this.store.bump();this.rooms.onChange([actor.id]);return {ok:true};
  }
}
