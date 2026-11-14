import Fastify, { LogController, type FastifyRequest } from 'fastify';
import type {Readable} from 'node:stream';
import {UPLOAD_CHUNK_BYTES} from '../shared/pack-format.mjs';
import { readFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import {RoomPacks} from './room-packs.js';
import { Store } from './database.js';
import {avatarIds} from './avatars.js';
import { RoomService, digest, type Principal } from './service.js';
import { Community } from './community.js';
import { VoiceProxy } from './voice-proxy.js';
import { Voice, type VoiceConfig, type VoiceGateway } from './voice.js';
import { SocialService } from './social.js';
import { Relay } from './relay.js';
import {Realtime} from './realtime.js';
import { Accounts } from './accounts.js';
import { DesktopAuth } from './desktop-auth.js';
import { ApiError, fail, object } from './validation.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export type AppOptions = {
  port?: number; host?: string; dbPath?: string; publicOrigin?: string; packDir?:string;
  voice?: VoiceConfig; voiceGateway?: VoiceGateway; logger?: boolean; now?: () => number; trustedProxy?: string;
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
  const packs=await RoomPacks.create(service,options.packDir);service.packState=id=>packs.summary(id);
  const social = new SocialService(service);
  const community = new Community(service);
  const voice = new Voice(community,options.voice,options.voiceGateway);
  service.communityState=(id,actor)=>community.snapshot(id,actor);
  const secureCookie = Boolean(publicOrigin?.startsWith('https://'));
  const cookieName = secureCookie ? '__Host-blockroom_session' : 'blockroom_session';
  const cookie = (token: string, maxAge = 30 * 86400) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureCookie ? '; Secure' : ''}`;
  const desktopAuth = new DesktopAuth(accounts, secureCookie);
  const desktopPublic = new Set(['start','info','poll','claim','cancel','deny'].map(action => '/api/auth/desktop/'+action));
  const desktopPolling = new Set(['/api/auth/desktop/poll','/api/auth/desktop/info']);
  const explicitToken = (request: FastifyRequest) => request.headers.authorization !== undefined || request.headers['x-session'] !== undefined;
  const tokenOf = (request: FastifyRequest) => {
    if (request.headers.authorization !== undefined) return request.headers.authorization.startsWith('Bearer ') ? request.headers.authorization.slice(7) : '';
    if (typeof request.headers['x-session'] === 'string') return request.headers['x-session'];
    return request.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  };
  const app = Fastify({
    logger: options.logger ? { level: 'info', redact: ['req.headers.authorization', 'req.headers.x-session', 'req.headers.cookie', 'res.headers.set-cookie'] } : false,
    logController: new LogController({disableRequestLogging: req=>req.url.startsWith('/voice/')}), bodyLimit: 400000, requestTimeout: 120000, connectionTimeout: 30000,
    trustProxy: options.trustedProxy || false, forceCloseConnections: true,
  });
  app.addContentTypeParser('application/octet-stream',(_request,payload,done)=>done(null,payload));
  let origins: string[] = [];
  const relay = new Relay(service, app.server, () => origins);
  const voiceProxy=new VoiceProxy(voice,app.server,()=>origins);
  service.gameState = (id, actor) => relay.snapshot(id, actor);
  const actors = new WeakMap<FastifyRequest, Principal>();
  type Subscriber = { raw: ServerResponse; actor: Principal };
  const streams = new Set<Subscriber>();
  const presenceChanged=(user:string)=>{
    const users=new Set([user,...social.friendIds(user)]);
    for(const {room_id} of store.all<{room_id:string}>('SELECT room_id FROM members WHERE user_id=?',user))for(const id of service.members(room_id))users.add(id);
    store.bump();service.onChange([...users]);
  };
  const realtime=new Realtime({server:app.server,origins:()=>origins,now:()=>service.now(),valid:hash=>service.sessionValid(hash),
    countLegacy:user=>[...streams].filter(stream=>!user||stream.actor.id===user).length,
    consume:(key,max,window)=>service.consume(key,max,window),presence:presenceChanged,
    snapshot:principal=>({...service.state(principal),social:social.summary(principal)}),
    command:(principal,type,body)=>{
      if(type==='chat.send'){const peer=String(body.peerId||'');return social.send(principal,peer,body);}
      if(type==='room.send'){const id=String(body.roomId||''),result=community.send(principal,id,body);return community.message(principal,id,result.id);}
      if(type==='chat.read')return social.read(principal,String(body.peerId||''),body);
      if(type==='room.read')return community.read(principal,String(body.roomId||''),body);
      fail('不支持这个实时操作');
    },
    event:(principal,change)=>{
      if(change.type==='chat.message'){
        if(principal.id!==change.senderId&&principal.id!==change.peerId)return;
        const peerId=principal.id===change.senderId?change.peerId:change.senderId;
        return {type:change.type,peerId,message:social.message(principal,peerId,change.id)};
      }
      return {type:change.type,roomId:change.roomId,message:community.message(principal,change.roomId,change.id)};
    },
  });
  community.online=user=>realtime.online(user)||[...streams].some(s=>s.actor.id===user&&service.sessionValid(s.actor.tokenHash));
  social.online=community.online;
  service.onRevoke = hashes => {
    relay.revoke(hashes);voice.revoke(hashes);realtime.revoke(hashes);
    const revoked = new Set(hashes);
    for (const stream of streams) if (revoked.has(stream.actor.tokenHash)) stream.raw.end();
  };
  const sendEvent = (stream: Subscriber) => {
    if (!stream.raw.writableEnded && !stream.raw.write(`event: change\ndata: ${store.revision()}\n\n`)) stream.raw.end();
  };
  service.onChange = (users,change) => {
    relay.reconcile();
    realtime.publish(users,change);
    const allowed = new Set(users);
    for (const stream of streams) if (allowed.has(stream.actor.id)) sendEvent(stream);
  };
  const heartbeat = setInterval(() => {
    for (const stream of streams) {
      if (!service.sessionValid(stream.actor.tokenHash)) stream.raw.end();
      else if (!stream.raw.write(': heartbeat\n\n')) stream.raw.end();
    }
  }, 15000).unref();
  const cleanup = setInterval(() => {store.prune(service.now());void packs.cleanup().catch(error=>app.log.error({err:error},'Pack cleanup failed'));}, 3600000).unref();
  store.prune(service.now());
  app.addHook('onRequest', async (request, reply) => {
    reply.headers({
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ${options.voice ? new URL(options.voice.url).origin : ''}; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
    });
    const path = request.url.split('?')[0];
    // Health probes carry no application data and can use the container's internal Host.
    if (path === '/healthz' && request.method === 'GET') return;
    if (!origins.some(origin => new URL(origin).host === request.headers.host)) fail('访问地址未在服务配置中', 403);
    if (request.headers.origin && !origins.includes(request.headers.origin)) fail('不允许跨站请求', 403);
    if (request.method === 'POST' && !request.headers['content-type']?.startsWith('application/json')) fail('请求需要 JSON 格式', 415);
    if (path?.startsWith('/api/') && request.method === 'POST' && !desktopPolling.has(path)) service.consume(`write:${digest(request.ip)}`, 120, 60000);
    if (path?.startsWith('/api/') && path !== '/api/session' && !desktopPublic.has(path)) {
      const optional = ['/api/auth/login', '/api/auth/register', '/api/auth/logout'].includes(path);
      const token = tokenOf(request);
      if (optional) {
        if (token) try { actors.set(request, service.authenticate(token)); }
        catch (error) { if (path === '/api/auth/register' && explicitToken(request)) throw error; }
      } else actors.set(request, service.authenticate(token));
      if(request.method==='PUT'){if(!/^\/api\/rooms\/[^/]+\/pack\/uploads\/[^/]+\/chunk$/.test(path||''))fail('不支持此上传地址',404);service.consume('pack-chunks:'+actors.get(request)!.id,300,60000);}
      if(request.method==='POST'&&/^\/api\/rooms\/[^/]+\/pack$/.test(path||'')){service.consume('pack-upload:global',4,60000);service.consume('pack-upload:'+actors.get(request)!.id,3,60000);}
    }
  });
  const actor = (request: FastifyRequest) => actors.get(request)!;
  app.get('/healthz', async () => { store.get('SELECT 1'); return { ok: true, service: 'joincraft', database: 'ready' }; });
  app.post('/api/session', async (request, reply) => reply.code(201).send(service.createSession(object(request.body), request.ip)));
  // Read responses must not restore a previous cookie after another login completes.
  // Persistent cookies retain the 30-day expiry set when the session is issued.
  app.get('/api/state', async request => {
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
  app.post('/api/auth/desktop/start', async request => desktopAuth.start(object(request.body), request.ip));
  app.post('/api/auth/desktop/info', async (request, reply) => {
    const result = desktopAuth.info(object(request.body), request.headers.cookie, request.ip);
    if (result.cookie) reply.header('Set-Cookie', result.cookie);
    return result.data;
  });
  app.post('/api/auth/desktop/authorize', async request => desktopAuth.authorize(object(request.body), request.headers.cookie, actor(request)));
  app.post('/api/auth/desktop/poll', async request => desktopAuth.poll(object(request.body), request.ip));
  app.post('/api/auth/desktop/claim', async request => desktopAuth.claim(object(request.body)));
  app.post('/api/auth/desktop/cancel', async request => desktopAuth.cancel(object(request.body)));
  app.post('/api/auth/desktop/deny', async request => desktopAuth.deny(object(request.body), request.headers.cookie));
  app.post('/api/friends/request', async request => social.request(actor(request), object(request.body)));
  for (const action of ['accept', 'decline', 'cancel'] as const) {
    app.post<{Params:{peer:string}}>(`/api/friends/:peer/${action}`, async request => social.respond(actor(request),request.params.peer,action));
  }
  app.get<{Params:{peer:string};Querystring:{before?:string;after?:string}}>('/api/chats/:peer/messages', async request => social.messages(actor(request),request.params.peer,request.query.before,request.query.after));
  app.post<{Params:{peer:string}}>('/api/chats/:peer/messages', async request => social.send(actor(request),request.params.peer,object(request.body)));
  app.post<{Params:{peer:string}}>('/api/chats/:peer/read', async request => social.read(actor(request),request.params.peer,object(request.body)));
  app.get<{Params:{id:string};Querystring:{before?:string;after?:string}}>('/api/rooms/:id/messages',async req=>community.messages(actor(req),req.params.id,req.query.before,req.query.after));
  app.post<{Params:{id:string}}>('/api/rooms/:id/messages',async req=>community.send(actor(req),req.params.id,object(req.body)));
  app.post<{Params:{id:string}}>('/api/rooms/:id/read',async req=>community.read(actor(req),req.params.id,object(req.body)));
  app.post<{Params:{id:string}}>('/api/rooms/:id/groups',async req=>community.createGroup(actor(req),req.params.id,object(req.body)));
  app.post<{Params:{id:string;group:string}}>('/api/rooms/:id/groups/:group/rename',async req=>community.renameGroup(actor(req),req.params.id,req.params.group,object(req.body)));
  app.post<{Params:{id:string;group:string}}>('/api/rooms/:id/groups/:group/delete',async req=>{object(req.body);const result=community.deleteGroup(actor(req),req.params.id,req.params.group);await voice.reconcile();return result;});
  app.post<{Params:{id:string;group:string}}>('/api/rooms/:id/groups/:group/join',async req=>{object(req.body);return {...await voice.join(actor(req),req.params.id,req.params.group),url:origins[0]!.replace(/^http/,'ws')+'/voice'};});
  app.post<{Params:{id:string;user:string;action:string}}>('/api/rooms/:id/voice/:user/:action',async req=>{object(req.body);return voice.moderate(actor(req),req.params.id,req.params.user,req.params.action);});
  app.post<{Params:{identity:string}}>('/api/voice/:identity/heartbeat',async req=>{object(req.body);return voice.heartbeat(actor(req),req.params.identity);});
  app.post<{Params:{identity:string}}>('/api/voice/:identity/leave',async req=>{object(req.body);return voice.leave(actor(req),req.params.identity);});
  app.get<{Params:{id:string}}>('/api/profiles/:id',async request=>service.publicProfile(actor(request),request.params.id));
  app.post('/api/profile', async request => service.profile(actor(request), object(request.body)));
  app.post('/api/rooms', async (request, reply) => reply.code(201).send(await service.createRoom(actor(request), object(request.body))));
  for (const action of ['start', 'connect'] as const) app.post<{Params:{id:string}}>(`/api/rooms/:id/play/${action}`, async request => relay.issue(request.params.id, action, actor(request), object(request.body)));
  for (const action of ['stop', 'disconnect'] as const) app.post<{Params:{id:string}}>(`/api/rooms/:id/play/${action}`, async request => { object(request.body); return relay.stop(request.params.id, actor(request), action === 'disconnect'); });
  app.post<{Params:{id:string}}>('/api/rooms/:id/pack',{bodyLimit:24*1024*1024},async request=>packs.publish(actor(request),request.params.id,object(request.body)));
  app.get<{Params:{id:string};Querystring:{sha512?:string}}>('/api/rooms/:id/pack',async request=>packs.download(actor(request),request.params.id,request.query.sha512));
  app.post<{Params:{id:string}}>('/api/rooms/:id/pack/uploads',async request=>packs.begin(actor(request),request.params.id,object(request.body)));
  app.get<{Params:{id:string;upload:string}}>('/api/rooms/:id/pack/uploads/:upload',async request=>packs.info(actor(request),request.params.id,request.params.upload));
  app.put<{Params:{id:string;upload:string};Querystring:{offset?:string}}>('/api/rooms/:id/pack/uploads/:upload/chunk',{bodyLimit:UPLOAD_CHUNK_BYTES},async request=>packs.chunk(actor(request),request.params.id,request.params.upload,request.query.offset,request.body as Readable,request.headers['content-length'],request.headers['x-chunk-sha256']));
  app.post<{Params:{id:string;upload:string}}>('/api/rooms/:id/pack/uploads/:upload/commit',async request=>{object(request.body);return packs.commit(actor(request),request.params.id,request.params.upload);});
  app.post<{Params:{id:string;upload:string}}>('/api/rooms/:id/pack/uploads/:upload/cancel',async request=>{object(request.body);return packs.cancelUpload(actor(request),request.params.id,request.params.upload);});
  app.get<{Params:{id:string};Querystring:{sha512?:string}}>('/api/rooms/:id/pack/manifest',async request=>packs.manifest(actor(request),request.params.id,request.query.sha512));
  app.get<{Params:{id:string};Querystring:{sha512?:string}}>('/api/rooms/:id/pack/meta',async request=>packs.descriptor(actor(request),request.params.id,request.query.sha512));
  app.get<{Params:{id:string};Querystring:{sha512?:string}}>('/api/rooms/:id/pack/archive',async(request,reply)=>{
    const result=await packs.archive(actor(request),request.params.id,request.query.sha512,request.headers.range);
    reply.code(result.status).headers({'Content-Type':'application/x-modrinth-modpack+zip','Content-Length':String(result.end-result.start+1),'Accept-Ranges':'bytes',ETag:'"'+result.pack.sha512+'"','Content-Disposition':'attachment; filename="joincraft-'+result.pack.sha512.slice(0,16)+'.mrpack"'});
    if(result.status===206)reply.header('Content-Range','bytes '+result.start+'-'+result.end+'/'+result.pack.archiveSize);return reply.send(result.stream);
  });
  app.post<{Params:{id:string}}>('/api/rooms/:id/pack/remove',async request=>packs.remove(actor(request),request.params.id,object(request.body).expected));
  app.post('/api/join', async request => service.join(actor(request), object(request.body), request.ip));
  for (const action of ['settings', 'game', 'close', 'leave'] as const) {
    app.post<{ Params: { id: string } }>(`/api/rooms/:id/${action}`, async request =>
      { const result=await service.mutate(request.params.id, action, actor(request), object(request.body));if(action==='close')packs.release(request.params.id);if(action==='leave'||action==='close')await voice.reconcile();return result; });
  }
  for(const path of ['/voice/rtc/validate','/voice/rtc/v1/validate'])app.get<{Querystring:{access_token?:string}}>(path,{logLevel:'silent'},async req=>{await voice.authorize(req.query.access_token||'');return {ok:true};});
  app.post('/api/realtime/ticket',async request=>{object(request.body);return realtime.ticket(actor(request));});
  app.get('/api/events', async (request, reply) => {
    const principal = actor(request);
    if ([...streams].filter(s => s.actor.id === principal.id).length+realtime.count(principal.id) >= 6 || streams.size+realtime.count() >= 200) fail('实时连接数量已满，请关闭多余页面', 429);
    reply.hijack();
    for (const [key, value] of Object.entries(reply.getHeaders())) if (value !== undefined) reply.raw.setHeader(key, value);
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    const stream = { raw: reply.raw, actor: principal };
    streams.add(stream);
    presenceChanged(principal.id);
    reply.raw.on('close', () => {streams.delete(stream);presenceChanged(principal.id);});
    sendEvent(stream);
  });
  for(const path of ['/launcher','/launcher/','/launcher/index.html'])app.get(path,async (_request,reply)=>reply.redirect('/'));
  const files: Record<string, [string, string]> = {
    '/app-home.js':['app-home.js','text/javascript'], '/app-home.css':['app-home.css','text/css'],
    '/brand/mining-atlas-v2.png':['brand/mining-atlas-v2.png','image/png'],
    '/motion.js':['motion.js','text/javascript'], '/motion.css':['motion.css','text/css'], '/mining.js':['mining.js','text/javascript'],
    '/community.js': ['community.js','text/javascript'], '/voice.js':['voice.js','text/javascript'], '/voice-sdk.js':['voice-sdk.js','text/javascript'], '/community.css':['community.css','text/css'],
    '/type.css': ['type.css', 'text/css'],
    '/pixel-theme.css':['pixel-theme.css','text/css'],
    '/focus.js':['focus.js','text/javascript'],
    '/brand/ui-pixel-v1.woff2':['brand/ui-pixel-v1.woff2','font/woff2'],
    '/favicon.ico':['favicon.ico','image/x-icon'],
    '/brand/favicon.svg':['brand/favicon.svg','image/svg+xml'],
    '/brand/wordmark-license.txt':['brand/wordmark-license.txt','text/plain'],
    '/brand/wordmark-pixel-v1.svg':['brand/wordmark-pixel-v1.svg','image/svg+xml'],
    '/brand/mark.svg':['brand/mark.svg','image/svg+xml'],'/brand/mark-diamond.svg':['brand/mark-diamond.svg','image/svg+xml'],
    '/brand/app-192.png':['brand/app-192.png','image/png'],
    '/brand/app-512.png':['brand/app-512.png','image/png'],
    '/brand/maskable-512.png':['brand/maskable-512.png','image/png'],
    '/apple-touch-icon.png':['apple-touch-icon.png','image/png'],
    '/site.webmanifest':['site.webmanifest','application/manifest+json'],
    '/desktop-notifications.js':['desktop-notifications.js','text/javascript'], '/desktop-notifications.css':['desktop-notifications.css','text/css'],
    '/launcher/library.js': ['launcher/library.js', 'text/javascript'],
    '/launcher/memory.js':['launcher/memory.js','text/javascript'],
    '/launcher/library.css': ['launcher/library.css', 'text/css'],
    '/room-packs.js':['room-packs.js','text/javascript'],'/pack-progress.js':['pack-progress.js','text/javascript'],'/pack-progress.css':['pack-progress.css','text/css'],'/client-theme.css':['client-theme.css','text/css'],
    '/play.js': ['play.js', 'text/javascript'], '/play.css': ['play.css', 'text/css'],
    '/ui.js': ['ui.js', 'text/javascript'], '/ui.css': ['ui.css', 'text/css'], '/polish.css': ['polish.css', 'text/css'],
    '/': ['home/index.html', 'text/html'], '/app/':['index.html','text/html'], '/app':['index.html','text/html'],
    '/login':['auth/index.html','text/html'], '/login/':['auth/index.html','text/html'],
    '/auth/style.css':['auth/style.css','text/css'], '/auth/login.js':['auth/login.js','text/javascript'],
    '/auth/session.js':['auth/session.js','text/javascript'], '/auth/mine-v2.webp':['auth/mine-v2.webp','image/webp'], '/auth/world-v1.webp':['auth/world-v1.webp','image/webp'],
    '/home/entry.js':['home/entry.js','text/javascript'], '/home/style.css':['home/style.css','text/css'],
    '/home/world-v1.webp':['home/world-v1.webp','image/webp'], '/home/camp-v2.webp':['home/camp-v2.webp','image/webp'],
    '/home/pixel-display-v2.woff2':['home/pixel-display-v2.woff2','font/woff2'],
    '/home/pixel-bold-font-license.txt':['home/pixel-bold-font-license.txt','text/plain'],
    '/home/pixel-display-v1.woff2':['home/pixel-display-v1.woff2','font/woff2'],
    '/home/pixel-font-license.txt':['home/pixel-font-license.txt','text/plain'],
    '/home/display-900-v1.woff2':['home/display-900-v1.woff2','font/woff2'],
    '/home/font-license.txt':['home/font-license.txt','text/plain'], '/app.js': ['app.js', 'text/javascript'],
    '/instances.js': ['instances.js', 'text/javascript'], '/realtime.js': ['realtime.js', 'text/javascript'], '/social.js': ['social.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'],
  };
  files['/interaction.js']=['interaction.js','text/javascript'];
  files['/desktop-login.js']=['desktop-login.js','text/javascript'];
  files['/profile.js']=['profile.js','text/javascript'];
  files['/profile.css']=['profile.css','text/css'];
  files['/avatars.js']=['avatars.js','text/javascript'];
  for(const id of avatarIds)files[`/avatars/${id}-v1.svg`]=[`avatars/${id}-v1.svg`,'image/svg+xml'];
  for (const [path, [file, type]] of Object.entries(files)) {
    app.get(path, async (request, reply) => {
      // Existing desktop builds pin the domain root in their navigation/IPC guards.
      // This is public HTML selection only, never an authentication decision.
      const legacyClient=path==='/'&&/\bElectron\/\d/.test(request.headers['user-agent']||'')&&/\bjoincraft\/\d/i.test(request.headers['user-agent']||'');
      const selected=legacyClient?'index.html':file;
      if(path==='/')reply.header('Vary','User-Agent');
      const immutable=/^(?:home|auth|brand)\/.*-v[1-9]\d*\.(webp|woff2)$/.test(selected);
      return reply.type(type.startsWith('image/')||type.startsWith('font/')?type:`${type}; charset=utf-8`).header('Cache-Control',immutable?'public, max-age=31536000, immutable':'no-cache').send(await readFile(resolve(root,'public',selected)));
    });
  }
  app.get('/downloads/client/windows',async (_request,reply)=>reply.redirect('https://www.joincraft.top/updates/joincraft-setup.exe'));
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
  const dispose = () => { for(const stream of streams)stream.raw.removeAllListeners('close'); realtime.close(); relay.close(); voiceProxy.close(); clearInterval(heartbeat); clearInterval(cleanup); for (const stream of streams) stream.raw.end(); streams.clear(); };
  app.addHook('onClose', async () => { dispose(); await voice.close(); await packs.close(); store.close(); });
  let url: string;
  try {
    url = await app.listen({ port, host });
    const address = app.server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    origins = publicOrigin ? [publicOrigin] : [`http://127.0.0.1:${actualPort}`, `http://localhost:${actualPort}`, `http://[::1]:${actualPort}`];
  } catch (error) { await app.close(); throw error; }
  return { url, close: async () => { dispose(); await app.close(); } };
}
