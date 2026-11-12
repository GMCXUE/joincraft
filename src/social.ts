import { RoomService, type Principal } from './service.js';
import { fail, text } from './validation.js';
type Link = { low_id: string; high_id: string; requester: string; status: string; created_at: number };
type Message = { id: number; sender_id: string; recipient_id: string; content: string; created_at: number; client_id: string };
export class SocialService {
  constructor(readonly rooms: RoomService) {}
  private get store() { return this.rooms.store; }
  private account(actor: Principal) { if (!actor.username) fail('请先注册或登录账号，再使用好友与聊天', 403); }
  private pair(a: string, b: string) { return a < b ? [a, b] as const : [b, a] as const; }
  private link(a: string, b: string) { return this.store.get<Link>('SELECT * FROM friendships WHERE low_id=? AND high_id=?', ...this.pair(a, b)); }
  private accepted(actor: Principal, peer: string) {
    this.account(actor);
    if (this.link(actor.id, peer)?.status !== 'accepted') fail('成为好友后才可以聊天', 403);
  }
  private notify(ids: string[]) { this.rooms.onChange(ids); }
  summary(actor: Principal) {
    if (!actor.username) return { friends: [], requests: [], conversations: [], unread: 0 };
    const links = this.store.all<Link>('SELECT * FROM friendships WHERE low_id=? OR high_id=?', actor.id, actor.id);
    const friends = [], requests = [], conversations = [];
    let totalUnread = 0;
    for (const link of links) {
      const id = link.low_id === actor.id ? link.high_id : link.low_id;
      const peer = this.store.get<{id: string; name: string; username: string}>('SELECT u.id,u.name,a.username FROM users u JOIN accounts a ON a.user_id=u.id WHERE u.id=?', id)!;
      if (link.status === 'pending') { requests.push({ ...peer, incoming: link.requester !== actor.id, createdAt: link.created_at }); continue; }
      friends.push(peer);
      const last = this.store.get<Message>('SELECT * FROM messages WHERE low_id=? AND high_id=? ORDER BY id DESC LIMIT 1', link.low_id, link.high_id);
      const cursor = this.store.get<{last_id: number}>('SELECT last_id FROM read_cursors WHERE user_id=? AND peer_id=?', actor.id, id);
      const unread = this.store.get<{n: number}>('SELECT count(*) AS n FROM messages WHERE low_id=? AND high_id=? AND recipient_id=? AND id>?', link.low_id, link.high_id, actor.id, cursor?.last_id ?? 0)!.n;
      if (last || cursor) conversations.push({ ...peer, preview: last?.content.slice(0, 80) || '', at: last?.created_at || 0, unread });
      totalUnread += unread;
    }
    friends.sort((a,b) => a.name.localeCompare(b.name));
    conversations.sort((a,b) => b.at-a.at);
    requests.sort((a,b) => b.createdAt-a.createdAt);
    return { friends, requests, conversations, unread: totalUnread };
  }
  request(actor: Principal, body: Record<string, unknown>) {
    this.account(actor);this.rooms.consume(`friend-request:${actor.id}`, 20, 60000);
    const username = text(body.username, '用户名', 24).toLowerCase();
    const target = this.store.get<{user_id: string}>('SELECT user_id FROM accounts WHERE username=?', username);
    if (!target) fail('未找到这个用户名，请确认后再试', 404);
    if (target.user_id === actor.id) fail('不能添加自己为好友');
    this.store.transaction(() => {
      const existing = this.link(actor.id, target.user_id);
      if (existing?.status === 'accepted') fail('你们已经是好友', 409);
      if (existing) fail(existing.requester === actor.id ? '好友申请已发送，请等待对方处理' : '对方已向你发送申请，请在好友申请中接受', 409);
      for (const id of [actor.id, target.user_id]) if (this.store.get<{n:number}>('SELECT count(*) AS n FROM friendships WHERE low_id=? OR high_id=?', id,id)!.n >= 200) fail('好友及申请数量已达到上限');
      this.store.run('INSERT INTO friendships VALUES (?,?,?,?,?)', ...this.pair(actor.id,target.user_id),actor.id,'pending',this.rooms.now());
      this.store.bump();
    });
    this.notify([actor.id,target.user_id]);return {ok:true};
  }
  respond(actor: Principal, peer: string, action: 'accept' | 'decline' | 'cancel') {
    this.account(actor);
    this.store.transaction(() => {
      const link = this.link(actor.id,peer);
      if (!link || link.status !== 'pending') fail('这条申请已处理或不存在',404);
      if (action === 'cancel' ? link.requester !== actor.id : link.requester === actor.id) fail('你不能执行这个操作',403);
      if (action === 'accept') this.store.run("UPDATE friendships SET status='accepted' WHERE low_id=? AND high_id=?",link.low_id,link.high_id);
      else this.store.run('DELETE FROM friendships WHERE low_id=? AND high_id=?',link.low_id,link.high_id);
      this.store.bump();
    });
    this.notify([actor.id,peer]);return {ok:true};
  }
  private serialize(message: Message, actor: Principal) {
    return {id:message.id,content:message.content,at:message.created_at,self:message.sender_id===actor.id,clientId:message.client_id};
  }
  messages(actor: Principal, peer: string, before?: string) {
    this.accepted(actor,peer);
    const boundary = before === undefined ? Number.MAX_SAFE_INTEGER : Number(before);
    if (!Number.isSafeInteger(boundary) || boundary < 1) fail('消息游标无效');
    const rows = this.store.all<Message>('SELECT * FROM messages WHERE low_id=? AND high_id=? AND id<? ORDER BY id DESC LIMIT 51',...this.pair(actor.id,peer),boundary);
    return {messages:rows.slice(0,50).reverse().map(m=>this.serialize(m,actor)),hasMore:rows.length>50};
  }
  send(actor: Principal, peer: string, body: Record<string, unknown>) {
    this.accepted(actor,peer);
    const content=text(body.content,'消息',2000),clientId=text(body.clientId,'消息标识',64);
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(clientId)) fail('消息标识格式无效');
    const existing=this.store.get<Message>('SELECT * FROM messages WHERE sender_id=? AND client_id=?',actor.id,clientId);
    if(existing){if(existing.recipient_id!==peer||existing.content!==content)fail('消息标识已被使用',409);return this.serialize(existing,actor);}
    this.rooms.consume(`chat:${actor.id}`,60,60000);
    const row=this.store.transaction(()=>{
      const inserted=this.store.run('INSERT INTO messages(low_id,high_id,sender_id,recipient_id,content,created_at,client_id) VALUES (?,?,?,?,?,?,?)',...this.pair(actor.id,peer),actor.id,peer,content,this.rooms.now(),clientId);
      this.store.bump();return this.store.get<Message>('SELECT * FROM messages WHERE id=?',inserted.lastInsertRowid)!;
    });
    this.notify([actor.id,peer]);return this.serialize(row,actor);
  }
  read(actor: Principal, peer: string, body: Record<string, unknown>) {
    this.accepted(actor,peer);
    const id=Number(body.uptoId);
    if(!Number.isSafeInteger(id)||id<0)fail('消息游标无效');
    if(id&&!this.store.get('SELECT 1 FROM messages WHERE id=? AND low_id=? AND high_id=?',id,...this.pair(actor.id,peer)))fail('消息不存在',404);
    const old=this.store.get<{last_id:number}>('SELECT last_id FROM read_cursors WHERE user_id=? AND peer_id=?',actor.id,peer);
    if(old&&old.last_id>=id)return {ok:true};
    this.store.transaction(()=>{
      this.store.run('INSERT INTO read_cursors VALUES (?,?,?) ON CONFLICT(user_id,peer_id) DO UPDATE SET last_id=max(last_id,excluded.last_id)',actor.id,peer,id);
      this.store.bump();
    });
    this.notify([actor.id]);return {ok:true};
  }
}
