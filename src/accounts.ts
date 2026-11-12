import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { RoomService, digest, type Principal } from './service.js';
import { fail, text } from './validation.js';
const parameters = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const derive = (value: string, salt: string) => new Promise<Buffer>((resolve, reject) => scrypt(value, salt, 32, parameters, (error, result) => error ? reject(error) : resolve(result)));
const ttl = 30 * 86400000;
function username(value: unknown) {
  const name = text(value, '用户名', 24).toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(name)) fail('用户名需要 3–24 位字母、数字或下划线');
  return name;
}
function accountPassword(value: unknown, registering = false): string {
  if (typeof value !== 'string' || value.length > 64 || value.length < (registering ? 15 : 1)) {
    fail(registering ? '密码需要 15–64 个字符，可使用一句好记的话' : '用户名或密码不正确', registering ? 400 : 401);
  }
  return value;
}
async function encode(value: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(value, salt) as Buffer;
  return `scrypt$32768$8$3$${salt}$${hash.toString('hex')}`;
}
async function verify(value: string, encoded: string) {
  const [, n, r, p, salt, hex] = encoded.split('$');
  if (n !== '32768' || r !== '8' || p !== '3' || !salt || !hex) throw new Error('Invalid account hash');
  return timingSafeEqual(await derive(value, salt) as Buffer, Buffer.from(hex, 'hex'));
}
export class Accounts {
  private active = 0;
  private constructor(readonly service: RoomService, private readonly dummyHash: string) {}
  static async create(service: RoomService) { return new Accounts(service, await encode(randomBytes(32).toString('hex'))); }
  private async expensive<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= 2) fail('登录服务繁忙，请稍后重试', 503);
    this.active++;
    try { return await work(); } finally { this.active--; }
  }
  private issue(userId: string) {
    const token = randomBytes(32).toString('base64url'), now = this.service.now();
    // Bound retained sessions per account; newest device logins remain usable.
    const old = this.service.store.all<{ token_hash: string }>('SELECT token_hash FROM sessions WHERE user_id=? ORDER BY last_seen DESC LIMIT -1 OFFSET 9', userId);
    for (const row of old) this.service.store.run('DELETE FROM sessions WHERE token_hash=?', row.token_hash);
    this.service.store.run('INSERT INTO sessions VALUES (?, ?, ?, ?)', digest(token), userId, now + ttl, now);
    return { token, expiresAt: now + ttl, revoked: old.map(s => s.token_hash) };
  }
  async register(body: Record<string, unknown>, ip: string, actor?: Principal) {
    this.service.consume(`register:${digest(ip)}`, 10, 3600000);
    const login = username(body.username), password = accountPassword(body.password, true);
    const name = text(body.name || actor?.name || login, '昵称', 24);
    if (actor?.username) fail('你已经登录，请先退出当前账号', 409);
    const hash = await this.expensive(() => encode(password));
    const store = this.service.store;
    const result = store.transaction(() => {
      if (actor && !this.service.sessionValid(actor.tokenHash)) fail('原会话已失效，请重新打开注册窗口', 401);
      if (store.get('SELECT 1 FROM accounts WHERE username=?', login)) fail('这个用户名已被使用', 409);
      if (actor && store.get('SELECT 1 FROM accounts WHERE user_id=?', actor.id)) fail('当前身份已经绑定账号，请登录', 409);
      const userId = actor?.id || randomUUID();
      if (!actor) {
        if (store.get<{ n: number }>('SELECT count(*) AS n FROM users')!.n >= 10000) fail('用户数量已达当前服务上限', 503);
        store.run('INSERT INTO users VALUES (?, ?, ?)', userId, name, this.service.now());
      } else store.run('UPDATE users SET name=? WHERE id=?', name, userId);
      store.run('INSERT INTO accounts VALUES (?, ?, ?, ?)', userId, login, hash, this.service.now());
      const revoked = store.all<{ token_hash: string }>('SELECT token_hash FROM sessions WHERE user_id=?', userId).map(s => s.token_hash);
      store.run('DELETE FROM sessions WHERE user_id=?', userId);
      const issued = this.issue(userId);
      store.bump();
      return { ...issued, revoked: [...revoked, ...issued.revoked] };
    });
    this.service.onRevoke(result.revoked);
    if (actor) {
      const related = store.all<{ user_id: string }>('SELECT DISTINCT b.user_id FROM members a JOIN members b ON a.room_id=b.room_id WHERE a.user_id=?', actor.id).map(m => m.user_id);
      this.service.onChange([...new Set([actor.id, ...related])]);
    }
    return result;
  }
  async login(body: Record<string, unknown>, ip: string) {
    this.service.consume(`login-ip:${digest(ip)}`, 30, 900000);
    const login = username(body.username), password = accountPassword(body.password);
    this.service.consume(`login-user:${digest(login)}`, 15, 900000);
    const account = this.service.store.get<{ user_id: string; password_hash: string }>('SELECT user_id, password_hash FROM accounts WHERE username=?', login);
    const valid = await this.expensive(() => verify(password, account?.password_hash || this.dummyHash));
    if (!valid || !account) fail('用户名或密码不正确', 401);
    const result = this.service.store.transaction(() => this.issue(account.user_id));
    this.service.onRevoke(result.revoked);
    return result;
  }
  logout(actor?: Principal) {
    if (actor) {
      this.service.store.run('DELETE FROM sessions WHERE token_hash=?', actor.tokenHash);
      this.service.onRevoke([actor.tokenHash]);
    }
    return { ok: true };
  }
}
