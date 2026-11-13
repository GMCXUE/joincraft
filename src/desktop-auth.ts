import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Accounts } from './accounts.js';
import { digest, type Principal } from './service.js';
import { fail } from './validation.js';

type Pending = {
  id: string; challenge: string; code: string; mode: 'login'|'register'; expiresAt: number;
  phase: 'pending'|'approved'|'claimed'|'cancelled'; browserHash?: string;
  userId?: string; sessionHash?: string; issuedHash?: string; lastPoll?: number;
};
const challengeOf = (value: string) => createHash('sha256').update(value).digest('base64url');
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{32}$/.test(value);
// Requests live only for five minutes. Restarting the server invalidates pending logins.
// The URL identifies a request; only the native process holds its verifier.
export class DesktopAuth {
  private readonly requests = new Map<string, Pending>();
  constructor(private readonly accounts: Accounts, private readonly secure: boolean) {}
  private get service() { return this.accounts.service; }
  private prune() { for (const [id, item] of this.requests) if (item.expiresAt <= this.service.now()) this.requests.delete(id); }
  private get(body: Record<string, unknown>) {
    this.prune();
    if (!validId(body.id)) fail('登录请求无效，请从客户端重新发起', 400);
    const item = this.requests.get(body.id);
    if (!item) fail('登录请求已过期，请从客户端重新发起', 410);
    return item;
  }
  private snapshot(item: Pending) { return { phase: item.phase, code: item.code, expiresAt: item.expiresAt, mode: item.mode }; }
  private proof(body: Record<string, unknown>) {
    const item = this.get(body);
    if (typeof body.verifier !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.verifier) || !timingSafeEqual(Buffer.from(challengeOf(body.verifier)), Buffer.from(item.challenge))) fail('登录校验失败', 403);
    return item;
  }
  private name(id: string) { return `${this.secure ? '__Host-' : ''}joincraft_login_${id}`; }
  private browser(item: Pending, cookies: string|undefined) {
    const name = this.name(item.id) + '=';
    const value = cookies?.split(';').map(v => v.trim()).find(v => v.startsWith(name))?.slice(name.length);
    return value && item.browserHash && digest(value) === item.browserHash;
  }
  start(body: Record<string, unknown>, ip: string) {
    this.service.consume(`desktop-start:${digest(ip)}`, 10, 600000);
    if (typeof body.challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.challenge)) fail('登录校验参数无效', 400);
    if (body.mode !== 'login' && body.mode !== 'register') fail('登录方式无效', 400);
    this.prune();
    if (this.requests.size >= 500) fail('登录服务繁忙，请稍后重试', 503);
    const code = randomBytes(4).toString('hex').toUpperCase();
    const item: Pending = { id: randomBytes(24).toString('base64url'), challenge: body.challenge, code: code.slice(0,4)+'-'+code.slice(4), mode: body.mode, expiresAt: this.service.now()+300000, phase: 'pending' };
    this.requests.set(item.id, item);
    return { id: item.id, ...this.snapshot(item) };
  }
  info(body: Record<string, unknown>, cookies: string|undefined, ip: string) {
    this.service.consume(`desktop-info:${digest(ip)}`, 180, 60000);
    const item = this.get(body);
    let cookie: string|undefined;
    if (!item.browserHash) {
      const value = randomBytes(32).toString('base64url');
      item.browserHash = digest(value);
      cookie = `${this.name(item.id)}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=300${this.secure ? '; Secure' : ''}`;
    } else if (!this.browser(item, cookies)) fail('此登录请求已在另一个浏览器打开，请从客户端重新发起', 403);
    return { data: this.snapshot(item), cookie };
  }
  authorize(body: Record<string, unknown>, cookies: string|undefined, actor: Principal) {
    const item = this.get(body);
    if (!this.browser(item, cookies)) fail('请重新打开客户端登录页面', 403);
    if (!actor.username) fail('请先登录账号', 401);
    if (item.phase === 'approved' && item.userId === actor.id) return this.snapshot(item);
    if (item.phase !== 'pending') fail('此登录请求已经结束，请从客户端重新发起', 409);
    item.userId = actor.id; item.sessionHash = actor.tokenHash; item.phase = 'approved';
    return this.snapshot(item);
  }
  poll(body: Record<string, unknown>, ip: string) {
    this.service.consume(`desktop-poll:${digest(ip)}`, 300, 60000);
    const item = this.proof(body);
    // One native process polls every two seconds. The per-request limit also bounds replay load.
    if (item.lastPoll !== undefined && this.service.now()-item.lastPoll < 500) fail('请稍后查询登录状态', 429);
    item.lastPoll = this.service.now();
    return this.snapshot(item);
  }
  claim(body: Record<string, unknown>) {
    const item = this.proof(body);
    if (item.phase !== 'approved') fail('登录请求尚未确认或已被使用', 409);
    if (!item.sessionHash || !this.service.sessionValid(item.sessionHash)) { item.phase = 'cancelled'; fail('网页会话已失效，请重新登录', 401); }
    const result = this.accounts.issueDesktopSession(item.userId!);
    item.issuedHash = digest(result.token); item.phase = 'claimed';
    return { token: result.token, expiresAt: result.expiresAt, userId: item.userId! };
  }
  cancel(body: Record<string, unknown>) {
    const item = this.proof(body);
    if (item.issuedHash) {
      this.service.store.run('DELETE FROM sessions WHERE token_hash=?', item.issuedHash);
      this.service.onRevoke([item.issuedHash]); delete item.issuedHash;
    }
    item.phase = 'cancelled';
    return this.snapshot(item);
  }
  deny(body: Record<string, unknown>, cookies: string|undefined) {
    const item = this.get(body);
    if (!this.browser(item, cookies)) fail('请重新打开客户端登录页面', 403);
    if (item.phase !== 'claimed') item.phase = 'cancelled';
    return this.snapshot(item);
  }
}
