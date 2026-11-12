import { randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, createWebSocketStream } from 'ws';
import { RoomService, digest, type Principal } from './service.js';
import { fail, gameFields } from './validation.js';

type Room = { id: string; owner_id: string; closed: number; capacity: number; port: number | null };
type Game = { id: string; roomId: string; port: number; status: 'waiting' | 'online' | 'error'; error: string; version: string; host?: Agent };
type Agent = { key: string; actor: Principal; role: 'host' | 'guest'; game: Game; expires: number; used: boolean; ws?: WebSocket; address?: string; error?: string; alive: boolean };
type Pair = { id: string; agent: Agent; guest: Duplex; host?: Duplex; timer: NodeJS.Timeout };

/** Authenticated, bounded TCP transport. No public Minecraft listening ports. */
export class Relay {
  private games = new Map<string, Game>();
  private agents = new Map<string, Agent>();
  private pairs = new Map<string, Pair>();
  private wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
  private timer: NodeJS.Timeout;
  constructor(private service: RoomService, server: Server, private origins: () => string[]) {
    server.on('upgrade', (request, socket, head) => this.upgrade(request, socket, head));
    this.timer = setInterval(() => {
      this.reconcile();
      for (const a of this.agents.values()) {
        if (!a.ws && a.expires < service.now()) { this.remove(a); continue; }
        if (!a.ws) continue;
        if (!a.alive) { this.remove(a); continue; }
        a.alive = false; a.ws.ping();
      }
    }, 15000).unref();
  }
  private room(id: string, actor: Principal) {
    const room = this.service.store.get<Room>('SELECT id,owner_id,closed,capacity,port FROM rooms WHERE id=?', id);
    if (!room || room.closed || !this.service.store.get('SELECT 1 FROM members WHERE room_id=? AND user_id=?', id, actor.id)) fail('房间不存在或你尚未加入', 404);
    if (!this.service.sessionValid(actor.tokenHash)) fail('登录已失效，请重新登录', 401);
    return room;
  }
  private notify(id: string) {
    this.service.onChange(this.service.store.all<{ user_id: string }>('SELECT user_id FROM members WHERE room_id=?', id).map(x => x.user_id));
  }
  snapshot(id: string, actor: Principal) {
    const g = this.games.get(id), mine = [...this.agents.values()].find(a => a.game === g && a.actor.id === actor.id);
    return { status: g?.status ?? 'offline', error: g?.error || '', version: g?.version || '', port: g?.port ?? null,
      local: mine ? { status: mine.address || mine.role === 'host' && g?.status === 'online' ? 'ready' : mine.error ? 'error' : mine.ws ? 'checking' : 'waiting', address: mine.address || '', error: mine.error || '', role: mine.role } : null,
      // Transport connections include MC status pings; this is deliberately not a player count.
      connections: g ? [...this.pairs.values()].filter(p => p.agent.game === g && p.host).length : 0 };
  }
  issue(id: string, action: 'start' | 'connect', actor: Principal, body: Record<string, unknown>) {
    this.reconcile();
    const room = this.room(id, actor);
    this.service.consume(`bridge-ticket:${actor.id}`, 15, 60000);
    if (this.agents.size >= 128) fail('连接服务繁忙，请稍后重试', 503);
    let game = this.games.get(id);
    if (action === 'start') {
      if (room.owner_id !== actor.id) fail('只有房主可以开房', 403);
      const port = gameFields({ port: body.port ?? room.port }).port;
      if (!port) fail('请填写 MC 开放局域网后显示的端口');
      if (game?.host?.ws) fail('已经在开房，请先停止后再启动', 409);
      if (this.games.size >= 16 && !game) fail('同时开房数量已达上限', 503);
      if (game) this.stopGame(game);
      game = { id: randomUUID(), roomId: id, port, status: 'waiting', error: '', version: '' };
      this.games.set(id, game);
    } else {
      if (!game || game.status !== 'online') fail('房主尚未开始联机', 409);
      if (room.owner_id === actor.id) fail('房主直接留在自己的 MC 世界中即可');
      for (const a of this.agents.values()) if (a.game === game && a.actor.id === actor.id) this.remove(a);
    }
    const token = randomBytes(32).toString('base64url'), key = digest(token), expires = this.service.now() + 300000;
    const a: Agent = { key, actor, role: action === 'start' ? 'host' : 'guest', game: game!, expires, used: false, alive: true };
    this.agents.set(key, a); if (a.role === 'host') game!.host = a;
    this.notify(id);
    return { ticket: token, expiresAt: expires, role: a.role, port: a.role === 'host' ? game!.port : null };
  }
  stop(id: string, actor: Principal, ownOnly = false) {
    const room = this.room(id, actor), game = this.games.get(id);
    if (!ownOnly && room.owner_id !== actor.id) fail('只有房主可以停止联机', 403);
    if (game) {
      if (!ownOnly) this.stopGame(game);
      else for (const a of this.agents.values()) if (a.game === game && a.actor.id === actor.id) this.remove(a);
    }
    this.notify(id); return { ok: true };
  }
  private stopGame(game: Game) {
    this.games.delete(game.roomId);
    for (const a of [...this.agents.values()]) if (a.game === game) this.remove(a, false);
  }
  private dropPair(p: Pair) {
    if (!this.pairs.delete(p.id)) return;
    clearTimeout(p.timer); p.guest.destroy(); p.host?.destroy(); this.notify(p.agent.game.roomId);
  }
  private remove(a: Agent, notify = true) {
    if (!this.agents.delete(a.key)) return;
    for (const p of [...this.pairs.values()]) if (p.agent === a || a.role === 'host' && p.agent.game === a.game) this.dropPair(p);
    a.ws?.terminate();
    if (a.role === 'host' && this.games.get(a.game.roomId) === a.game) {
      a.game.host = undefined;
      a.game.status = 'error'; a.game.error ||= a.used ? '房主连接程序已断开，请重新开房' : '连接凭据已过期，请重新开房';
      for (const peer of [...this.agents.values()]) if (peer.game === a.game) this.remove(peer, false);
    }
    if (notify) this.notify(a.game.roomId);
  }
  reconcile() {
    for (const a of [...this.agents.values()]) {
      try { this.room(a.game.roomId, a.actor); }
      catch { this.remove(a); }
    }
    for (const g of this.games.values()) {
      const room = this.service.store.get<{closed:number}>('SELECT closed FROM rooms WHERE id=?', g.roomId);
      if (!room || room.closed) this.stopGame(g);
    }
  }
  revoke(hashes: string[]) { for (const a of [...this.agents.values()]) if (hashes.includes(a.actor.tokenHash)) this.remove(a); }
  private upgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    socket.on('error', () => {});
    try {
      const path = request.url || '';
      if (!this.origins().some(o => new URL(o).host === request.headers.host) || request.headers.origin && !this.origins().includes(request.headers.origin)) fail('Forbidden', 403);
      if (path !== '/bridge/control' && !/^\/bridge\/data\/(new|[0-9a-f-]{36})$/.test(path)) fail('Not found', 404);
      this.service.consume(`bridge-upgrade:${digest(request.socket.remoteAddress || '')}`, 240, 60000);
      const raw = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : '';
      const a = raw.length <= 100 ? this.agents.get(digest(raw)) : undefined;
      if (!a) fail('连接凭据无效', 401);
      this.room(a.game.roomId, a.actor);
      if (path === '/bridge/control') {
        if (a.used || a.expires < this.service.now()) fail('连接凭据已使用或过期', 401);
        // Reserve before completing upgrade so concurrent requests cannot reuse a ticket.
        a.used = true;
        this.wss.handleUpgrade(request, socket, head, ws => this.control(a, ws));
      } else {
        if (!a.ws || a.ws.readyState !== WebSocket.OPEN || a.game.status !== 'online') fail('连接程序尚未就绪', 409);
        const pairId = path.split('/').at(-1)!;
        const pair = this.pairs.get(pairId);
        if (a.role === 'host') {
          if (!pair || pair.agent.game !== a.game || pair.host) fail('连接不存在', 404);
        } else {
          if (pairId !== 'new' || !a.address) fail('无效连接', 403);
          if (this.pairs.size >= 128 || [...this.pairs.values()].filter(p => p.agent === a).length >= 8) fail('连接数达到上限', 429);
        }
        this.wss.handleUpgrade(request, socket, head, ws => this.data(a, ws, pair));
      }
    } catch (error) {
      const status = typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 400;
      socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    }
  }
  private control(a: Agent, ws: WebSocket) {
    a.ws = ws; ws.on('error', () => this.remove(a)); ws.on('close', () => this.remove(a)); ws.on('pong', () => a.alive = true);
    ws.send(JSON.stringify({ type: 'welcome', role: a.role, port: a.role === 'host' ? a.game.port : null }));
    ws.on('message', (raw, binary) => {
      try {
        if (binary || raw.toString().length > 2048) throw Error();
        const m = JSON.parse(raw.toString());
        this.service.consume(`bridge-control:${a.key}`, 120, 60000);
        if (m.type === 'ready' && a.role === 'host') {
          a.game.status = 'online'; a.game.error = ''; a.game.version = typeof m.version === 'string' ? m.version.slice(0,80) : '';
        } else if (m.type === 'ready' && a.role === 'guest' && Number.isInteger(m.port) && m.port >= 1024 && m.port <= 65535) {
          a.address = `127.0.0.1:${m.port}`; a.error = '';
        } else if (m.type === 'error') {
          a.error = String(m.message || '连接失败').slice(0,160);
          if (a.role === 'host') { a.game.status = 'error'; a.game.error = a.error; this.remove(a); }
        } else if (m.type === 'failed' && a.role === 'host') {
          const p = this.pairs.get(m.id); if (p?.agent.game === a.game) this.dropPair(p);
        } else throw Error();
        this.notify(a.game.roomId);
      } catch { ws.close(1008, 'Invalid control message'); }
    });
    this.notify(a.game.roomId);
  }
  private data(a: Agent, ws: WebSocket, existing?: Pair) {
    const stream = createWebSocketStream(ws, { highWaterMark: 65536 });
    // The payload is opaque Minecraft TCP bytes, never control JSON.
    ws.on('message', (_data, binary) => { if (!binary) ws.close(1003, 'Binary only'); });
    stream.on('error', () => stream.destroy());
    if (a.role === 'guest') {
      const id = randomUUID();
      const p: Pair = { id, agent: a, guest: stream, timer: setTimeout(() => this.dropPair(p), 10000).unref() };
      this.pairs.set(id, p); stream.on('close', () => this.dropPair(p));
      a.game.host?.ws?.send(JSON.stringify({ type: 'incoming', id }));
    } else if (existing) {
      existing.host = stream; clearTimeout(existing.timer);
      stream.on('close', () => this.dropPair(existing));
      existing.guest.pipe(stream); stream.pipe(existing.guest);
      this.notify(a.game.roomId);
    }
  }
  close() { clearInterval(this.timer); for (const game of [...this.games.values()]) this.stopGame(game); this.wss.close(); }
}
