import {clientFetch} from './http.mjs';
import { createHash } from 'node:crypto';

export function offlineIdentity(name) {
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name ?? '')) throw new Error('离线玩家名需为 3–16 位字母、数字或下划线');
  const uuid = createHash('md5').update(`OfflinePlayer:${name}`).digest();
  uuid[6] = (uuid[6] & 15) | 48;
  uuid[8] = (uuid[8] & 63) | 128;
  return { name, id: uuid.toString('hex'), accessToken: '0', userType: 'legacy', xuid: '0', clientId: '0' };
}

export class MicrosoftAccount {
  constructor({ clientId, client, fetchImpl = clientFetch, notify = () => {}, now = Date.now }) {
    this.clientId = clientId;
    this.client = client;
    this.fetch = fetchImpl;
    this.notify = notify;
    this.now = now;
    this.identity = null;
    this.account = null;
    this.busy = false;
  }
  summary() { return { configured: Boolean(this.clientId && this.client), profile: this.identity ? { name: this.identity.name, id: this.identity.id } : null, busy: this.busy }; }
  async request(url, data, bearer) {
    let response;
    try {
      response = await this.fetch(url, { method: data ? 'POST' : 'GET', headers: { Accept: 'application/json', ...(data ? { 'Content-Type': 'application/json' } : {}), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(30000), redirect: 'error' });
    } catch { throw new Error('无法连接微软或 Minecraft 登录服务，请检查网络后重试'); }
    if (!response.ok) {
      if (url.endsWith('/minecraft/profile') && response.status === 404) throw new Error('该微软账号没有可用的 Java 版游戏档案，请确认已拥有 Java 版并创建角色');
      if (url.includes('xsts')) throw new Error('Xbox 授权未完成，请检查 Xbox 档案、年龄与家庭权限');
      throw new Error(`正版登录服务拒绝请求（HTTP ${response.status}），请重新登录`);
    }
    try { return await response.json(); } catch { throw new Error('登录服务返回了无法识别的响应，请稍后重试'); }
  }
  async exchange(msToken) {
    const xbox = await this.request('https://user.auth.xboxlive.com/user/authenticate', { Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msToken}` }, RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT' });
    if (!xbox.Token) throw new Error('Xbox 登录响应不完整');
    const xsts = await this.request('https://xsts.auth.xboxlive.com/xsts/authorize', { Properties: { SandboxId: 'RETAIL', UserTokens: [xbox.Token] }, RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT' });
    const claim = xsts.DisplayClaims?.xui?.[0];
    if (!xsts.Token || !claim?.uhs) throw new Error('Xbox 游戏授权响应不完整');
    const token = await this.request('https://api.minecraftservices.com/authentication/login_with_xbox', { identityToken: `XBL3.0 x=${claim.uhs};${xsts.Token}` });
    if (!token.access_token || !(token.expires_in > 0)) throw new Error('Minecraft 授权响应不完整');
    const profile = await this.request('https://api.minecraftservices.com/minecraft/profile', null, token.access_token);
    if (!/^[a-f0-9]{32}$/i.test(profile.id ?? '') || !/^[A-Za-z0-9_]{1,16}$/.test(profile.name ?? '')) throw new Error('Minecraft 游戏档案无效');
    return { id: profile.id, name: profile.name, accessToken: token.access_token, expiresAt: this.now() + token.expires_in * 1000, userType: 'msa', xuid: claim.xid || '0', clientId: this.clientId };
  }
  async login() {
    if (!this.client || !this.clientId) throw new Error('此构建尚未配置微软登录，请由开发者设置应用 Client ID');
    if (this.busy) throw new Error('微软登录正在进行，请完成当前授权');
    this.busy = true;
    try {
      let result;
      try {
        result = await this.client.acquireTokenByDeviceCode({ scopes: ['XboxLive.signin', 'offline_access'], deviceCodeCallback: code => this.notify({ type: 'device-code', code: code.userCode, url: code.verificationUri, expiresIn: code.expiresIn }) });
      } catch { throw new Error('微软登录未完成或授权已过期，请重试'); }
      if (!result?.accessToken) throw new Error('微软未返回有效授权');
      const identity = await this.exchange(result.accessToken);
      this.identity = identity;
      this.account = result.account;
      return { ...this.summary(), busy: false };
    } finally { this.busy = false; this.notify({ type: 'account', ...this.summary() }); }
  }
  async forLaunch() {
    if (!this.identity || !this.account) throw new Error('请先登录微软正版账号');
    if (this.identity.expiresAt > this.now() + 120000) return this.identity;
    try {
      const result = await this.client.acquireTokenSilent({ account: this.account, scopes: ['XboxLive.signin', 'offline_access'] });
      if (!result?.accessToken) throw new Error();
      this.identity = await this.exchange(result.accessToken);
      return this.identity;
    } catch { this.identity = null; this.account = null; this.notify({ type: 'account', ...this.summary() }); throw new Error('正版授权已过期，请重新登录微软账号'); }
  }
  async logout() {
    if (this.busy) throw new Error('请等待当前登录完成');
    if (this.account) await this.client.getTokenCache().removeAccount(this.account);
    this.identity = null;
    this.account = null;
    this.notify({ type: 'account', ...this.summary() });
    return this.summary();
  }
}
