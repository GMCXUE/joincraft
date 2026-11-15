import {Store} from './database.js';
import type {Principal} from './service.js';
import {fail,object} from './validation.js';

type Kind='friend.request'|'friend.accepted'|'room.pack'|'room.game'|'room.closed';
type Notice={id:number;kind:Kind;peer_id:string|null;room_id:string|null;title:string;content:string;created_at:number;read_at:number|null};
type Social={conversations:{id:string;name:string;avatarId:string;preview:string;at:number;unread:number;lastId:number}[];requests:{id:string;incoming:boolean}[]};
export class Notifications {
 constructor(readonly store:Store,readonly now=Date.now){}
 // Called inside the originating mutation's transaction, so failed actions never notify.
 add(user:string,kind:Kind,title:string,content:string,{peerId=null,roomId=null}:{peerId?:string|null;roomId?:string|null}={}){
  this.store.run('INSERT INTO user_notifications(user_id,kind,peer_id,room_id,title,content,created_at) VALUES (?,?,?,?,?,?,?)',user,kind,peerId,roomId,title.slice(0,120),content.slice(0,500),this.now());
  this.store.run('DELETE FROM user_notifications WHERE user_id=? AND id NOT IN (SELECT id FROM user_notifications WHERE user_id=? ORDER BY id DESC LIMIT 200)',user,user);
 }
 resolveRequest(user:string,peer:string){this.store.run("UPDATE user_notifications SET read_at=coalesce(read_at,?) WHERE user_id=? AND peer_id=? AND kind='friend.request'",this.now(),user,peer);}
 snapshot(actor:Principal,social:Social){
  const pending=new Set(social.requests.filter(item=>item.incoming).map(item=>item.id));
  const rows=this.store.all<Notice>('SELECT * FROM user_notifications WHERE user_id=? ORDER BY id DESC LIMIT 200',actor.id);
  const notices=rows.map(row=>({id:'notice:'+row.id,kind:row.kind,category:row.kind.startsWith('friend.')?'friend':'system',title:row.title,
   body:row.content,at:row.created_at,unread:row.read_at===null?1:0,peerId:row.peer_id,roomId:row.room_id,
   pending:row.kind==='friend.request'&&pending.has(row.peer_id||'')}));
  const chats=social.conversations.filter(peer=>peer.lastId>0).map(peer=>({id:`chat:${peer.id}:${peer.lastId}`,kind:'chat.message',category:'friend',title:peer.name,
   body:peer.preview,at:peer.at,unread:peer.unread,peerId:peer.id,roomId:null,avatarId:peer.avatarId,pending:false}));
  const all=[...notices,...chats].sort((a,b)=>b.at-a.at||b.id.localeCompare(a.id));
  const friend=all.filter(item=>item.category==='friend').reduce((sum,item)=>sum+item.unread,0),system=notices.filter(item=>item.category==='system').reduce((sum,item)=>sum+item.unread,0);
  return {items:all.slice(0,100),unread:friend+system,friend,system,hasMore:all.length>100,throughId:rows[0]?.id||0,
   chatReads:social.conversations.filter(peer=>peer.unread>0).map(peer=>({peerId:peer.id,uptoId:peer.lastId}))};
 }
 read(actor:Principal,body:Record<string,unknown>){
  const ids=body.ids===undefined?[]:body.ids,chats=body.chats===undefined?[]:body.chats;
  if(!Array.isArray(ids)||ids.length>100||!ids.every(id=>Number.isSafeInteger(id)&&id>0)||new Set(ids).size!==ids.length)fail('通知标识无效');
  if(!Array.isArray(chats)||chats.length>200)fail('聊天标识无效');
  const through=body.throughId===undefined?0:body.throughId;
  if(!Number.isSafeInteger(through)||Number(through)<0)fail('通知游标无效');
  const cursors=chats.map(value=>{
   const item=object(value),peer=String(item.peerId||''),upto=Number(item.uptoId);
   if(!Number.isSafeInteger(upto)||upto<1||!this.store.get(`SELECT 1 FROM messages m JOIN friendships f ON f.low_id=m.low_id AND f.high_id=m.high_id
    WHERE m.id=? AND ((m.low_id=? AND m.high_id=?) OR (m.low_id=? AND m.high_id=?)) AND f.status='accepted'`,upto,actor.id,peer,peer,actor.id))fail('聊天不存在或无权访问',404);
   return {peer,upto};
  });
  this.store.transaction(()=>{
   for(const id of ids)if(!this.store.get('SELECT 1 FROM user_notifications WHERE id=? AND user_id=?',id,actor.id))fail('通知不存在',404);
   for(const id of ids)this.store.run('UPDATE user_notifications SET read_at=coalesce(read_at,?) WHERE id=? AND user_id=?',this.now(),id,actor.id);
   if(Number(through)>0)this.store.run('UPDATE user_notifications SET read_at=coalesce(read_at,?) WHERE user_id=? AND id<=?',this.now(),actor.id,Number(through));
   for(const {peer,upto} of cursors)this.store.run('INSERT INTO read_cursors VALUES (?,?,?) ON CONFLICT(user_id,peer_id) DO UPDATE SET last_id=max(last_id,excluded.last_id)',actor.id,peer,upto);
   this.store.bump();
  });
  return {ok:true};
 }
}
