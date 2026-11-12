import Fastify, { type FastifyRequest } from 'fastify';
import { readFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { Store } from './database.js';
import { RoomService, digest, type Principal } from './service.js';
import { SocialService } from './social.js';
import { Relay } from './relay.js';
import { Accounts } from './accounts.js';
import { ApiError, fail, object } from './validation.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export type AppOptions = {
  port?: number; host?: string; dbPath?: string; publicOrigin?: string;
  logger?: boolean; now?: () => number; trustedProxy?: string;
};
export async function createApp(options: AppOptions = {}) {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 4180;
  const publicOrigin = options.publicOrigin ? new URL(options.publicOrigin).origin : undefined;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !publicOrigin) throw new Error('对外监听必须配置 PUBLIC_ORIGIN');
  if (publicOrigin && !publicOrigin.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(publicOrigin)) {
    throw new Error('公网 PUBLIC_ORIGIN 必须使用 HTTPS');
  }
  const store = new Store(options.dbPath ?? resolve(root, 'data/blockroom.sqlite'));
  const service = new RoomService(store, options.now);
  const accounts = await Accounts.create(service);
  const social = new SocialService(service);
  const secureCookie = Boolean(publicOrigin?.startsWith('https://'));
  const cookieName = secureCookie ? '__Host-blockroom_session' : 'blockroom_session';
  const cookie = (token: string, maxAge = 30 * 86400) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureCookie ? '; Secure' : ''}`;
  const explicitToken = (request: FastifyRequest) => request.headers.authorization !== undefined || request.headers['x-session'] !== undefined;
  const tokenOf = (request: FastifyRequest) => {
    if (request.headers.authorization !== undefined) return request.headers.authorization.startsWith('Bearer ') ? request.headers.authorization.slice(7) : '';
    if (typeof request.headers['x-session'] === 'string') return request.headers['x-session'];
    return request.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  };
  const app = Fastify({
    logger: options.logger ? { level: 'info', redact: ['req.headers.authorization', 'req.headers.x-session', 'req.headers.cookie', 'res.headers.set-cookie'] } : false,
    bodyLimit: 400000, requestTimeout: 15000, connectionTimeout: 30000,
    trustProxy: options.trustedProxy || false, forceCloseConnections: true,
  });
  let origins: string[] = [];
  const relay = new Relay(service, app.server, () => origins);
  service.gameState = (id, actor) => relay.snapshot(id, actor);
  const actors = new WeakMap<FastifyRequest, Principal>();
  type Subscriber = { raw: ServerResponse; actor: Principal };
  const streams = new Set<Subscriber>();
  service.onRevoke = hashes => {
    relay.revoke(hashes);
    const revoked = new Set(hashes);
    for (const stream of streams) if (revoked.has(stream.actor.tokenHash)) stream.raw.end();
  };
  const sendEvent = (stream: Subscriber) => {
    if (!stream.raw.writableEnded && !stream.raw.write(`event: change\ndata: ${store.revision()}\n\n`)) stream.raw.end();
  };
  service.onChange = users => {
    relay.reconcile();
    const allowed = new Set(users);
    for (const stream of streams) if (allowed.has(stream.actor.id)) sendEvent(stream);
  };
  const heartbeat = setInterval(() => {
    for (const stream of streams) {
      if (!service.sessionValid(stream.actor.tokenHash)) stream.raw.end();
      else if (!stream.raw.write(': heartbeat\n\n')) stream.raw.end();
    }
  }, 15000).unref();
  const cleanup = setInterval(() => store.prune(service.now()), 3600000).unref();
  store.prune(service.now());
  app.addHook('onRequest', async (request, reply) => {
    reply.headers({
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    });
    const path = request.url.split('?')[0];
    // Health probes carry no application data and can use the container's internal Host.
    if (path === '/healthz' && request.method === 'GET') return;
    if (!origins.some(origin => new URL(origin).host === request.headers.host)) fail('访问地址未在服务配置中', 403);
    if (request.headers.origin && !origins.includes(request.headers.origin)) fail('不允许跨站请求', 403);
    if (request.method === 'POST' && !request.headers['content-type']?.startsWith('application/json')) fail('请求需要 JSON 格式', 415);
    if (path?.startsWith('/api/') && request.method === 'POST') service.consume(`write:${digest(request.ip)}`, 120, 60000);
    if (path?.startsWith('/api/') && path !== '/api/session') {
      const optional = ['/api/auth/login', '/api/auth/register', '/api/auth/logout'].includes(path);
      const token = tokenOf(request);
      if (optional) {
        if (token) try { actors.set(request, service.authenticate(token)); }
        catch (error) { if (path === '/api/auth/register' && explicitToken(request)) throw error; }
      } else actors.set(request, service.authenticate(token));
    }
  });
  const actor = (request: FastifyRequest) => actors.get(request)!;
  app.get('/healthz', async () => { store.get('SELECT 1'); return { ok: true, service: 'joincraft', database: 'ready' }; });
  app.post('/api/session', async (request, reply) => reply.code(201).send(service.createSession(object(request.body), request.ip)));
  app.get('/api/state', async (request, reply) => {
    if (!explicitToken(request)) reply.header('Set-Cookie', cookie(tokenOf(request)!));
    return { ...service.state(actor(request)), social: social.summary(actor(request)) };
  });
  app.post('/api/auth/register', async (request, reply) => {
    const result = await accounts.register(object(request.body), request.ip, actors.get(request));
    return reply.code(201).header('Set-Cookie', cookie(result.token)).send({ ok: true, expiresAt: result.expiresAt });
  });
  app.post('/api/auth/login', async (request, reply) => {
    const result = await accounts.login(object(request.body), request.ip);
    return reply.header('Set-Cookie', cookie(result.token)).send({ ok: true, expiresAt: result.expiresAt });
  });
  app.post('/api/auth/logout', async (request, reply) => {
    object(request.body);
    if (!explicitToken(request)) reply.header('Set-Cookie', cookie('', 0));
    return accounts.logout(actors.get(request));
  });
  app.post('/api/friends/request', async request => social.request(actor(request), object(request.body)));
  for (const action of ['accept', 'decline', 'cancel'] as const) {
    app.post<{Params:{peer:string}}>(`/api/friends/:peer/${action}`, async request => social.respond(actor(request),request.params.peer,action));
  }
  app.get<{Params:{peer:string};Querystring:{before?:string}}>('/api/chats/:peer/messages', async request => social.messages(actor(request),request.params.peer,request.query.before));
  app.post<{Params:{peer:string}}>('/api/chats/:peer/messages', async request => social.send(actor(request),request.params.peer,object(request.body)));
  app.post<{Params:{peer:string}}>('/api/chats/:peer/read', async request => social.read(actor(request),request.params.peer,object(request.body)));
  app.post('/api/profile', async request => service.profile(actor(request), object(request.body)));
  app.post('/api/rooms', async (request, reply) => reply.code(201).send(await service.createRoom(actor(request), object(request.body))));
  for (const action of ['start', 'connect'] as const) app.post<{Params:{id:string}}>(`/api/rooms/:id/play/${action}`, async request => relay.issue(request.params.id, action, actor(request), object(request.body)));
  for (const action of ['stop', 'disconnect'] as const) app.post<{Params:{id:string}}>(`/api/rooms/:id/play/${action}`, async request => { object(request.body); return relay.stop(request.params.id, actor(request), action === 'disconnect'); });
  app.post('/api/join', async request => service.join(actor(request), object(request.body), request.ip));
  for (const action of ['settings', 'game', 'close', 'leave'] as const) {
    app.post<{ Params: { id: string } }>(`/api/rooms/:id/${action}`, async request =>
      service.mutate(request.params.id, action, actor(request), object(request.body)));
  }
  app.get('/api/events', async (request, reply) => {
    const principal = actor(request);
    if ([...streams].filter(s => s.actor.id === principal.id).length >= 6 || streams.size >= 200) fail('实时连接数量已满，请关闭多余页面', 429);
    reply.hijack();
    for (const [key, value] of Object.entries(reply.getHeaders())) if (value !== undefined) reply.raw.setHeader(key, value);
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    const stream = { raw: reply.raw, actor: principal };
    streams.add(stream);
    reply.raw.on('close', () => streams.delete(stream));
    sendEvent(stream);
  });
  const files: Record<string, [string, string]> = {
    '/launcher/index.html': ['launcher/index.html', 'text/html'],
    '/launcher/library.js': ['launcher/library.js', 'text/javascript'],
    '/launcher/library.css': ['launcher/library.css', 'text/css'],
    '/play.js': ['play.js', 'text/javascript'], '/play.css': ['play.css', 'text/css'],
    '/ui.js': ['ui.js', 'text/javascript'], '/ui.css': ['ui.css', 'text/css'], '/polish.css': ['polish.css', 'text/css'],
    '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'],
    '/instances.js': ['instances.js', 'text/javascript'], '/realtime.js': ['realtime.js', 'text/javascript'], '/social.js': ['social.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'],
  };
  for (const [path, [file, type]] of Object.entries(files)) {
    app.get(path, async (_request, reply) => reply.type(`${type}; charset=utf-8`).header('Cache-Control', 'no-cache').send(await readFile(resolve(root, 'public', file))));
  }
  // Keep the previous download URL working for existing pages and commands.
  for (const filename of ['joincraft-bridge.cjs', 'blockroom-bridge.cjs']) {
    app.get(`/downloads/${filename}`, async (_request, reply) => reply.type('application/octet-stream').header('Content-Disposition', `attachment; filename=${filename}`).send(await readFile(resolve(root, 'public/joincraft-bridge.cjs'))));
  }
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: '页面或接口不存在' }));
  app.setErrorHandler((error, request, reply) => {
    const status = error instanceof ApiError ? error.statusCode : typeof error === 'object' && error !== null && 'statusCode' in error ? Number(error.statusCode) : 500;
    const code = status >= 400 && status < 600 ? status : 500;
    if (code === 500) request.log.error({ err: error }, 'Request failed');
    if (code === 429) reply.header('Retry-After', '60');
    const message = error instanceof ApiError ? error.message : code === 413 ? '请求内容过大' : code === 415 ? '请求需要 JSON 格式' : code === 400 ? '请求格式无效' : '服务暂时不可用，请稍后重试';
    reply.code(code).send({ error: message });
  });
  const dispose = () => { relay.close(); clearInterval(heartbeat); clearInterval(cleanup); for (const stream of streams) stream.raw.end(); streams.clear(); };
  app.addHook('onClose', async () => { dispose(); store.close(); });
  let url: string;
  try {
    url = await app.listen({ port, host });
    const address = app.server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    origins = publicOrigin ? [publicOrigin] : [`http://127.0.0.1:${actualPort}`, `http://localhost:${actualPort}`, `http://[::1]:${actualPort}`];
  } catch (error) { await app.close(); throw error; }
  return { url, close: async () => { dispose(); await app.close(); } };
}
