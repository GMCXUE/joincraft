import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import type {PackSummary} from '../shared/pack-format.mjs';
import { Store } from './database.js';
import {avatarFor,avatarIds} from './avatars.js';
import { fail, text, roomFields, gameFields, hashPassword, verifyPassword } from './validation.js';

export type Principal = { id: string; name: string; tokenHash: string; expiresAt: number; username: string | null };
export type RealtimeChange = {type:'chat.message';senderId:string;peerId:string;id:number}|{type:'room.message';roomId:string;id:number};
type Room = {
  id: string; code: string; owner_id: string; name: string; description: string; image: string;
  capacity: number; version: string; loader: string; port: number | null;
  password: string | null; created_at: number; closed: number;
};
export const digest = (input: string) => createHash('sha256').update(input).digest('hex');
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;

export class RoomService {
  packState: (id:string)=>PackSummary|null = ()=>null;
  gameState: (id: string, actor: Principal) => unknown = () => ({ status: 'offline' });
  communityState: (id: string, actor: Principal) => unknown = () => ({});
  onChange: (users: string[], change?:RealtimeChange) => void = () => {};
  onRevoke: (hashes: string[]) => void = () => {};
  constructor(readonly store: Store, readonly now = Date.now) {}
  consume(key: string, limit: number, windowMs: number) {
    const now = this.now();
    const row = this.store.get<{ count: number; reset_at: number }>('SELECT count, reset_at FROM rate_limits WHERE key=?', key);
    if (row && row.reset_at > now && row.count >= limit) fail('尝试过于频繁，请稍后重试', 429);
    this.store.run(`INSERT INTO rate_limits VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET
      count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END,
      reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END`, key, now + windowMs, now, now);
  }
  createSession(body: Record<string, unknown>, ip: string) {
    this.consume(`session:${digest(ip)}`, 30, 3600000);
    const name = text(body.name ?? '本地玩家', '昵称', 24), id = randomUUID();
    const token = randomBytes(32).toString('base64url'), now = this.now(), expiresAt = now + SESSION_TTL;
    this.store.transaction(() => {
      if (this.count('SELECT count(*) AS n FROM users') >= 10000) fail('设备数量已达当前服务上限', 503);
      this.store.run('INSERT INTO users VALUES (?, ?, ?)', id, name, now);
      this.store.run('INSERT INTO sessions VALUES (?, ?, ?, ?)', digest(token), id, expiresAt, now);
    });
    return { id: token, name, expiresAt };
  }
  authenticate(token: string | undefined): Principal {
    if (!token || token.length > 200) fail('设备会话已失效，请重新连接', 401);
    const tokenHash = digest(token), now = this.now();
    const row = this.store.get<{ id: string; name: string; expires_at: number; last_seen: number; username: string | null }>(
      `SELECT u.id, u.name, s.expires_at, s.last_seen, a.username FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN accounts a ON a.user_id=u.id
       WHERE s.token_hash=? AND s.expires_at>?`, tokenHash, now);
    if (!row) fail('设备会话已失效，请重新连接', 401);
    if (now - row.last_seen > 60000) {
      row.expires_at = now + SESSION_TTL;
      this.store.run('UPDATE sessions SET expires_at=?, last_seen=? WHERE token_hash=?', row.expires_at, now, tokenHash);
    }
    return { id: row.id, name: row.name, tokenHash, expiresAt: row.expires_at, username: row.username };
  }
  sessionValid(hash: string) {
    return Boolean(this.store.get('SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?', hash, this.now()));
  }
  private count(sql: string, ...args: string[]) { return this.store.get<{ n: number }>(sql, ...args)!.n; }
  private room(id: string): Room {
    const room = this.store.get<Room>('SELECT * FROM rooms WHERE id=?', id);
    if (!room) fail('房间不存在', 404);
    return room;
  }
  private member(roomId: string, userId: string) {
    return Boolean(this.store.get('SELECT 1 FROM members WHERE room_id=? AND user_id=?', roomId, userId));
  }
  accessible(id: string, actor: Principal) {
    const room = this.room(id);
    if (!this.member(id, actor.id)) fail('房间不存在或你尚未加入', 404);
    if (room.closed) fail('房间已经关闭');
    return room;
  }
  members(id: string) { return this.store.all<{ user_id: string }>('SELECT user_id FROM members WHERE room_id=?', id).map(x => x.user_id); }
  private record(id: string, message: string) {
    this.store.run('INSERT INTO events(room_id, at, message) VALUES (?, ?, ?)', id, this.now(), message);
    this.store.run('DELETE FROM events WHERE room_id=? AND seq NOT IN (SELECT seq FROM events WHERE room_id=? ORDER BY seq DESC LIMIT 100)', id, id);
    this.store.bump();
  }
  private notify(id: string, extra: string[] = []) { this.onChange([...new Set([...this.members(id), ...extra])]); }
  snapshot(room: Room, actor: Principal) {
    const members = this.store.all<{ id: string; name: string; avatarId:string|null }>(`SELECT u.id, u.name,p.avatar_id AS avatarId FROM members m
      JOIN users u ON u.id=m.user_id LEFT JOIN user_profiles p ON p.user_id=u.id WHERE m.room_id=? ORDER BY m.joined_at, u.id`, room.id);
    const events = this.store.all<{ seq: number; at: number; message: string }>(
      'SELECT seq, at, message FROM events WHERE room_id=? ORDER BY seq DESC LIMIT 12', room.id).reverse();
    return {
      id: room.id, code: room.code, name: room.name, image: room.image, description: room.description,
      capacity: room.capacity, version: room.version, loader: room.loader, port: room.port,
      pack:this.packState(room.id), connection: this.gameState(room.id, actor), community: this.communityState(room.id, actor),
      createdAt: room.created_at, closed: Boolean(room.closed), hasPassword: Boolean(room.password),
      hostName: members.find(m => m.id === room.owner_id)?.name ?? '房主', isHost: room.owner_id === actor.id,
      status: room.closed ? 'closed' : 'joined',
      members: members.map(m => ({ ...m, avatarId:avatarFor(m.id,m.avatarId), host: m.id === room.owner_id, self: m.id === actor.id })),
      events: events.map(e => ({ id: String(e.seq), at: e.at, message: e.message })),
    };
  }
  state(actor: Principal) {
    const rooms = this.store.all<Room>(`SELECT r.* FROM rooms r JOIN members m ON m.room_id=r.id
      WHERE m.user_id=? ORDER BY r.closed, r.created_at DESC LIMIT 100`, actor.id);
    return { profile: this.person(actor.id), revision: this.store.revision(),
      rooms: rooms.map(r => this.snapshot(r, actor)), mode: 'persistent-backend',
      capabilities: { persistence: true, realtime: 'sse', gameTunnel: true, identity: actor.username ? 'account' : 'device' } };
  }
  person(id:string) {
    const row=this.store.get<{id:string;name:string;username:string|null;avatarId:string|null;bio:string|null;createdAt:number}>(
      `SELECT u.id,u.name,a.username,p.avatar_id AS avatarId,p.bio,u.created_at AS createdAt FROM users u
       LEFT JOIN accounts a ON a.user_id=u.id LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id=?`,id);
    if(!row)fail('个人主页不存在或暂时无法查看',404);
    return {...row,avatarId:avatarFor(row.id,row.avatarId),bio:row.bio||'',kind:row.username?'account':'guest'};
  }
  publicProfile(actor:Principal,id:string) {
    const self=actor.id===id;
    const friendship=this.store.get<{status:string;requester:string}>('SELECT status,requester FROM friendships WHERE (low_id=? AND high_id=?) OR (low_id=? AND high_id=?)',actor.id,id,id,actor.id);
    const rooms=this.store.all<{id:string;name:string;image:string}>(`SELECT r.id,r.name,r.image FROM rooms r JOIN members a ON a.room_id=r.id JOIN members b ON b.room_id=r.id
      WHERE a.user_id=? AND b.user_id=? AND r.closed=0 ORDER BY r.created_at DESC LIMIT 100`,actor.id,id);
    if(!self&&!friendship&&!rooms.length)fail('个人主页不存在或暂时无法查看',404);
    return {...this.person(id),self,friendship:friendship?.status||null,requestIncoming:!!friendship&&friendship.requester!==actor.id,rooms};
  }
  profile(actor: Principal, body: Record<string, unknown>) {
    const current=this.person(actor.id);
    const name=body.name===undefined?current.name:text(body.name,'昵称',24);
    const bio=body.bio===undefined?current.bio:text(body.bio,'个人简介',240,true);
    const avatarId=body.avatarId===undefined?current.avatarId:body.avatarId;
    if(typeof avatarId!=='string'||!avatarIds.includes(avatarId as typeof avatarIds[number]))fail('请选择列表中的头像');
    this.store.transaction(() => {
      this.store.run('UPDATE users SET name=? WHERE id=?',name,actor.id);
      this.store.run(`INSERT INTO user_profiles VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET avatar_id=excluded.avatar_id,bio=excluded.bio,updated_at=excluded.updated_at`,actor.id,avatarId,bio,this.now());
      this.store.bump();
    });
    const related = this.store.all<{ user_id: string }>(`SELECT DISTINCT b.user_id FROM members a
      JOIN members b ON a.room_id=b.room_id WHERE a.user_id=?`, actor.id).map(m => m.user_id);
    const friends = this.store.all<{id:string}>('SELECT CASE WHEN low_id=? THEN high_id ELSE low_id END AS id FROM friendships WHERE low_id=? OR high_id=?',actor.id,actor.id,actor.id).map(p=>p.id);
    this.onChange([...new Set([actor.id, ...related, ...friends])]);
    return { ok: true };
  }
  async createRoom(actor: Principal, body: Record<string, unknown>) {
    const fields = roomFields(body), game = gameFields(body), password = await hashPassword(body.password);
    const id = randomUUID();
    this.store.transaction(() => {
      if (this.count('SELECT count(*) AS n FROM rooms WHERE owner_id=? AND closed=0', actor.id) >= 10) fail('最多同时创建 10 个房间');
      if (this.count('SELECT count(*) AS n FROM rooms') >= 1000) fail('房间数量已达当前服务上限', 503);
      let code: string;
      do { code = String(randomInt(100000, 1000000)); } while (this.store.get('SELECT 1 FROM rooms WHERE code=?', code));
      this.store.run(`INSERT INTO rooms(id, code, owner_id, name, description, image, capacity, version, loader, port, password, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, code, actor.id, fields.name, fields.description,
        fields.image, fields.capacity, game.version, game.loader, game.port, password, this.now());
      this.store.run('INSERT INTO members VALUES (?, ?, ?)', id, actor.id, this.now());
      this.store.run('INSERT INTO voice_groups VALUES (?,?,?,1,0,?)', 'game-'+id, id, '游戏', this.now());
      this.record(id, `${actor.name} 创建了房间`);
    });
    this.notify(id); return this.snapshot(this.room(id), actor);
  }
  async join(actor: Principal, body: Record<string, unknown>, ip: string) {
    this.consume(`join-user:${actor.id}`, 12, 60000);
    this.consume(`join-ip:${digest(ip)}`, 60, 60000);
    const code = text(body.code, '房间号', 6);
    if (!/^\d{6}$/.test(code)) fail('请输入 6 位数字房间号');
    const initial = this.store.get<Room>('SELECT * FROM rooms WHERE code=? AND closed=0', code);
    if (!initial) fail('房间不存在或已关闭，请核对房间号', 404);
    if (this.member(initial.id, actor.id)) return this.snapshot(initial, actor);
    if (initial.password) await verifyPassword(body.password, initial.password);
    this.store.transaction(() => {
      const room = this.room(initial.id);
      if (room.closed) fail('房间已关闭', 404);
      if (this.member(room.id, actor.id)) return;
      if (room.password !== initial.password) fail('房间密码已更新，请重试', 409);
      if (this.count('SELECT count(*) AS n FROM members WHERE room_id=?', room.id) >= room.capacity) fail('房间已满，请联系房主');
      if (this.count('SELECT count(*) AS n FROM members m JOIN rooms r ON r.id=m.room_id WHERE m.user_id=? AND r.closed=0', actor.id) >= 100) fail('最多同时加入 100 个房间');
      this.store.run('INSERT INTO members VALUES (?, ?, ?)', room.id, actor.id, this.now());
      this.record(room.id, `${actor.name} 加入了房间`);
    });
    this.notify(initial.id); return this.snapshot(this.room(initial.id), actor);
  }
  async mutate(id: string, action: 'game' | 'settings' | 'leave' | 'close', actor: Principal, body: Record<string, unknown>) {
    const initial = this.accessible(id, actor);
    if (action !== 'leave' && initial.owner_id !== actor.id) fail('只有房主可以操作', 403);
    const fields = action === 'settings' ? roomFields(body) : null;
    const game = action === 'game' ? gameFields(body) : null;
    const pack=this.packState(id);if(game&&pack&&(game.version!==pack.minecraft||game.loader!==pack.loader))fail('游戏版本由房间整合包确定，请通过更换整合包修改');
    const mode = body.passwordMode ?? 'keep';
    if (fields && !['keep', 'set', 'remove'].includes(String(mode))) fail('密码操作无效');
    const changedPassword = fields && mode === 'set' ? await hashPassword(body.password) : null;
    if (fields && mode === 'set' && !changedPassword) fail('请填写新密码');
    this.store.transaction(() => {
      const room = this.accessible(id, actor);
      if (action === 'leave') {
        if (room.owner_id === actor.id) fail('房主请使用关闭房间');
        this.store.run('DELETE FROM members WHERE room_id=? AND user_id=?', id, actor.id);
        this.record(id, `${actor.name} 退出了房间`);
      } else if (action === 'close') {
        this.store.run('UPDATE rooms SET closed=1 WHERE id=?', id);
        this.record(id, `${actor.name} 关闭了房间`);
      } else if (game) {
        this.store.run('UPDATE rooms SET version=?, loader=?, port=? WHERE id=?', game.version, game.loader, game.port, id);
        this.record(id, '房主更新了游戏环境');
      } else if (fields) {
        if (fields.capacity < this.count('SELECT count(*) AS n FROM members WHERE room_id=?', id)) fail('人数上限不能少于当前成员数');
        const password = mode === 'keep' ? room.password : mode === 'set' ? changedPassword : null;
        this.store.run('UPDATE rooms SET name=?, description=?, image=?, capacity=?, password=? WHERE id=?',
          fields.name, fields.description, fields.image, fields.capacity, password, id);
        this.record(id, '房主更新了房间设置');
      }
    });
    this.notify(id, [actor.id]);
    return action === 'leave' || action === 'close' ? { ok: true } : this.snapshot(this.room(id), actor);
  }
}
