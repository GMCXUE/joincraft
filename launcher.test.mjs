import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { scanLibrary, resolveInstance } from './launcher/library.mjs';
import { buildPlan, GameLauncher, parseJava } from './launcher/launch.mjs';
import { offlineIdentity, MicrosoftAccount } from './launcher/auth.mjs';

const platform = { name: 'windows', version: '10.0.22631', arch: 'x64' };
const hash = value => createHash('sha1').update(value).digest('hex');
async function put(file, value) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, typeof value === 'object' && !Buffer.isBuffer(value) ? JSON.stringify(value) : value); }
async function fixture(t, { legacy = false, loader = 'fabric' } = {}) {
  const temp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'blockroom-launch-')));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, '我的整合包 & friends', '.minecraft');
  const vanilla = legacy ? '1.12.2' : '1.20.1';
  const pack = '周末 生存';
  const jar = Buffer.from('simulated Minecraft jar, never executed');
  const index = JSON.stringify({ objects: {} });
  const base = { id: vanilla, mainClass: 'net.minecraft.client.main.Main', type: 'release', assets: vanilla, assetIndex: { id: vanilla, sha1: hash(index) }, downloads: { client: { sha1: hash(jar), size: jar.length, url: 'https://example.invalid/client.jar' } }, javaVersion: { majorVersion: legacy ? 8 : 17 }, libraries: [], ...(legacy ? { minecraftArguments: '--username ${auth_player_name} --uuid ${auth_uuid} --accessToken ${auth_access_token} --gameDir ${game_directory} --assetsDir ${assets_root} --assetIndex ${assets_index_name} --userType ${user_type}' } : { arguments: { jvm: ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}', { rules: [{ action: 'allow', os: { name: 'windows' } }], value: '-DwindowsOnly=true' }, { rules: [{ action: 'allow', os: { name: 'osx' } }], value: '-DmacOnly=true' }], game: ['--username', '${auth_player_name}', '--uuid', '${auth_uuid}', '--accessToken', '${auth_access_token}', '--gameDir', '${game_directory}', '--userType', '${user_type}', '--clientId', '${clientid}', '--xuid', '${auth_xuid}'] } }) };
  const libName = loader === 'fabric' ? 'net.fabricmc:fabric-loader:0.15.11' : loader === 'forge' ? 'net.minecraftforge:forge:1.12.2-14.23.5.2860' : 'net.neoforged:neoforge:21.1.0';
  const libPath = `${libName.split(':')[0].replaceAll('.', '/')}/${libName.split(':')[1]}/${libName.split(':')[2]}/loader.jar`;
  const libData = Buffer.from('simulated loader');
  const child = { id: pack, inheritsFrom: vanilla, mainClass: loader === 'fabric' ? 'net.fabricmc.loader.impl.launch.knot.KnotClient' : loader === 'forge' ? 'net.minecraft.launchwrapper.Launch' : 'cpw.mods.bootstraplauncher.BootstrapLauncher', libraries: [{ name: libName, downloads: { artifact: { path: libPath, sha1: hash(libData), url: 'https://example.invalid/loader.jar', size: libData.length } } }], ...(legacy ? { minecraftArguments: '--tweakClass net.minecraftforge.fml.common.launcher.FMLTweaker' } : { arguments: { jvm: [], game: [] } }) };
  const baseFile = path.join(root, 'versions', vanilla, `${vanilla}.json`);
  const childFile = path.join(root, 'versions', pack, `${pack}.json`);
  await put(baseFile, base); await put(childFile, child);
  await put(path.join(root, 'versions', vanilla, `${vanilla}.jar`), jar);
  await put(path.join(root, 'libraries', libPath), libData);
  await put(path.join(root, 'assets', 'indexes', `${vanilla}.json`), index);
  await put(path.join(root, 'versions', pack, 'PCL', 'Setup.ini'), 'VersionArgumentIndieV2:True\r\n');
  await put(path.join(root, 'versions', pack, 'saves', '我的世界', 'level.dat'), 'must remain unchanged');
  const result = await scanLibrary(path.dirname(root), platform);
  const instance = result.instances.find(i => i.name === pack);
  assert.equal(instance.error, undefined);
  const options = { instance, java: { path: 'C:\\Program Files\\Java\\bin\\java.exe', major: legacy ? 8 : 17, arch: 'x64' }, memoryMB: 1024, mode: 'auto', identity: offlineIdentity('Player_1'), cacheDir: path.join(temp, 'cache'), platform };
  return { temp, root, pack, vanilla, base, child, baseFile, childFile, libPath, instance, options };
}

test('offline identity uses Java name-based UUID, stable and validated', () => {
  assert.equal(offlineIdentity('Steve').id, '5627dd98e6be3c21b8a8e92344183641');
  assert.deepEqual(offlineIdentity('Player_1'), offlineIdentity('Player_1'));
  assert.throws(() => offlineIdentity('bad name'), /玩家名/);
  assert.notEqual(offlineIdentity('Steve').id, offlineIdentity('steve').id);
});
test('Java version and architecture detection includes Java 8 and modern Windows', () => {
  assert.deepEqual(parseJava('java version "1.8.0_412"\n os.arch = amd64'), { major: 8, arch: 'x64' });
  assert.deepEqual(parseJava('openjdk version "21.0.2"\n os.arch = aarch64'), { major: 21, arch: 'arm64' });
  assert.throws(() => parseJava('not java'), /无法识别/);
});
test('PCL scanning finds instances from pack root, versions folder and selected instance', async t => {
  const f = await fixture(t);
  assert.equal(f.instance.loader, 'Fabric');
  assert.equal(f.instance.isolation.mode, 'isolated');
  assert.equal((await scanLibrary(path.join(f.root, 'versions'), platform)).instances.length, 2);
  assert.equal((await scanLibrary(path.join(f.root, 'versions', f.pack), platform)).instances.length, 1);
  const plan = await buildPlan(f.options);
  assert.equal(plan.gamePath, path.join(f.root, 'versions', f.pack));
  assert.equal(plan.argv[0], f.options.java.path);
  assert.ok(plan.argv.includes(plan.gamePath));
  assert.ok(plan.argv.includes('-DwindowsOnly=true'));
  assert.ok(!plan.argv.includes('-DmacOnly=true'));
  assert.ok(plan.argv[plan.argv.indexOf('-cp') + 1].includes(';'));
  assert.ok(!plan.argv.some(v => v.includes('${')));
  assert.equal(await readFile(path.join(plan.gamePath, 'saves', '我的世界', 'level.dat'), 'utf8'), 'must remain unchanged');
  assert.equal(await stat(plan.nativeRoot).then(() => true, () => false), false, 'planning does not write/extract natives');
});
test('Legacy Forge inheritance and tweakClass arguments retain offline identity', async t => {
  const f = await fixture(t, { legacy: true, loader: 'forge' });
  const plan = await buildPlan(f.options);
  assert.equal(f.instance.loader, 'Forge');
  assert.ok(plan.argv.includes('net.minecraft.launchwrapper.Launch'));
  assert.ok(plan.argv.includes('net.minecraftforge.fml.common.launcher.FMLTweaker'));
  assert.ok(plan.argv.includes('Player_1'));
  assert.ok(plan.argv.includes('legacy'));
});
test('NeoForge metadata and PCL merged JSON/JAR resolve without requiring vanilla folder', async t => {
  const f = await fixture(t, { loader: 'neo' });
  assert.equal(f.instance.loader, 'NeoForge');
  const merged = { ...f.base, ...f.child, inheritsFrom: undefined, clientVersion: f.vanilla, arguments: { jvm: f.base.arguments.jvm, game: f.base.arguments.game } };
  await put(f.childFile, merged);
  await put(path.join(f.root, 'versions', f.pack, `${f.pack}.jar`), 'simulated Minecraft jar, never executed');
  await rm(path.join(f.root, 'versions', f.vanilla), { recursive: true });
  const plan = await buildPlan(f.options);
  assert.ok(plan.argv.includes('cpw.mods.bootstraplauncher.BootstrapLauncher'));
  assert.ok(plan.argv.some(a => a.includes(`${f.pack}.jar`)));
});
test('Unknown isolation requires a choice; explicit shared mode preserves shared saves', async t => {
  const f = await fixture(t);
  await rm(path.join(f.root, 'versions', f.pack, 'PCL'), { recursive: true });
  await rm(path.join(f.root, 'versions', f.pack, 'saves'), { recursive: true });
  await assert.rejects(buildPlan(f.options), /请确认/);
  const shared = await buildPlan({ ...f.options, mode: 'shared' });
  assert.equal(shared.gamePath, f.root);
  await put(path.join(f.root, 'versions', f.pack, 'PCL', 'Setup.ini'), 'VersionArgumentIndie:2');
  assert.equal((await buildPlan(f.options)).gamePath, f.root);
});
test('Missing files, wrong hash, Java major and architecture stop launch planning', async t => {
  const f = await fixture(t);
  await assert.rejects(buildPlan({ ...f.options, java: { ...f.options.java, major: 8 } }), /需要 Java 17/);
  await assert.rejects(buildPlan({ ...f.options, java: { ...f.options.java, arch: 'arm64' } }), /架构/);
  await assert.rejects(buildPlan({ ...f.options, memoryMB: -1 }), /内存/);
  await put(path.join(f.root, 'libraries', f.libPath), 'tampered');
  await assert.rejects(buildPlan(f.options), /文件缺失或损坏/);
  await rm(path.join(f.root, 'assets', 'indexes', `${f.vanilla}.json`));
  await assert.rejects(buildPlan(f.options), /资源索引/);
});
test('Version cycles, missing parent, path traversal and custom PCL scripts are rejected', async t => {
  const f = await fixture(t);
  await put(f.childFile, { ...f.child, inheritsFrom: '../escape' });
  await assert.rejects(resolveInstance(f.instance, platform), /路径不合法/);
  await put(f.childFile, { ...f.child, inheritsFrom: f.pack });
  await assert.rejects(resolveInstance(f.instance, platform), /继承循环/);
  await put(f.childFile, { ...f.child, inheritsFrom: 'missing' });
  await assert.rejects(resolveInstance(f.instance, platform), /缺少/);
  f.child.libraries[0].downloads.artifact.path = '../../outside.jar';
  await put(f.childFile, f.child);
  await assert.rejects(resolveInstance(f.instance, platform), /超出/);
  f.child.libraries[0].downloads.artifact.path = f.libPath; await put(f.childFile, f.child);
  await put(path.join(f.root, 'versions', f.pack, 'PCL', 'Setup.ini'), 'VersionArgumentIndieV2:True\nVersionAdvanceRun:echo unsafe');
  await assert.rejects(buildPlan(f.options), /自定义启动设置/);
});
test('Actual launcher controller prepares, mock-spawns without shell, tracks exit and prevents repeats', async t => {
  const f = await fixture(t);
  const events = [], children = [], calls = [];
  const launcher = new GameLauncher({ library: new Map([[f.instance.id, f.instance]]), account: {}, cacheDir: path.join(f.temp, 'cache'), platform, notify: e => events.push(e), probe: async () => f.options.java, spawnImpl: (...args) => { calls.push(args); const child = new EventEmitter(); children.push(child); queueMicrotask(() => child.emit('spawn')); return child; } });
  launcher.javaPath = f.options.java.path;
  const input = { id: f.instance.id, accountMode: 'offline', name: 'Player_1', mode: 'auto', memoryMB: 1024 };
  const checked = await launcher.check(input);
  assert.ok(checked.files >= 3); assert.equal(calls.length, 0);
  await launcher.start(input);
  assert.equal(calls.length, 1); assert.equal(calls[0][2].shell, false);
  assert.equal(calls[0][2].cwd, path.join(f.root, 'versions', f.pack));
  assert.equal(calls[0][0], f.options.java.path);
  assert.ok(calls[0][1].includes(path.join(f.root, 'versions', f.pack)));
  await assert.rejects(launcher.start(input), /已在启动/);
  children[0].emit('exit', 0, null);
  assert.equal(launcher.states()[0].state, 'exited');
  await launcher.start(input); children[1].emit('exit', 1, null);
  assert.equal(launcher.states()[0].state, 'failed');
  assert.ok(events.some(e => e.state === 'running'));
});
test('Spawn failure is reported and allows retry; online failure never spawns offline', async t => {
  const f = await fixture(t); let spawns = 0;
  const launcher = new GameLauncher({ library: new Map([[f.instance.id, f.instance]]), account: { forLaunch: async () => { throw new Error('请先登录微软正版账号'); } }, cacheDir: path.join(f.temp, 'cache'), platform, probe: async () => f.options.java, spawnImpl: () => { spawns++; const child = new EventEmitter(); queueMicrotask(() => child.emit('error', new Error('sensitive internal details'))); return child; } });
  launcher.javaPath = f.options.java.path;
  const input = { id: f.instance.id, accountMode: 'microsoft', name: 'Player_1', mode: 'auto', memoryMB: 1024 };
  await assert.rejects(launcher.start(input), /请先登录/); assert.equal(spawns, 0);
  await assert.rejects(launcher.start({ ...input, accountMode: 'offline' }), /Java 进程启动失败/);
  assert.equal(launcher.states()[0].state, 'failed'); assert.equal(spawns, 1);
});

function mockAuth({ failAt, now = () => 1000 } = {}) {
  const calls = [], events = []; let silent = 0, interactive = 0;
  const client = { acquireTokenByDeviceCode: async request => { interactive++; request.deviceCodeCallback({ userCode: 'TEST-ONLY', verificationUri: 'https://www.microsoft.com/link', expiresIn: 900 }); return { accessToken: 'MS_SECRET', account: { homeAccountId: 'fake' } }; }, acquireTokenSilent: async () => { silent++; return { accessToken: 'REFRESHED_MS_SECRET' }; }, getTokenCache: () => ({ removeAccount: async () => {} }) };
  const responses = [{ Token: 'XBOX_SECRET' }, { Token: 'XSTS_SECRET', DisplayClaims: { xui: [{ uhs: 'hash', xid: '12345' }] } }, { access_token: 'MC_SECRET', expires_in: 3600 }, { id: '0123456789abcdef0123456789abcdef', name: 'OwnedPlayer' }];
  const account = new MicrosoftAccount({ clientId: 'own-test-client', client, now, notify: e => events.push(e), fetchImpl: async (url, options) => { const stage = calls.length % 4; calls.push({ url, options }); return new Response(JSON.stringify(responses[stage]), { status: stage === failAt ? (stage === 3 ? 404 : 401) : 200 }); } });
  return { account, calls, events, counters: () => ({ silent, interactive }) };
}
test('Microsoft device code → Xbox → XSTS → MC profile, memory refresh, logout, no renderer token', async () => {
  let now = 1000;
  const m = mockAuth({ now: () => now });
  await m.account.login();
  assert.equal(m.account.summary().profile.name, 'OwnedPlayer');
  assert.match(m.calls[0].options.body, /d=MS_SECRET/);
  assert.match(m.calls[2].options.body, /XBL3.0 x=hash;XSTS_SECRET/);
  assert.equal(m.calls[3].options.headers.Authorization, 'Bearer MC_SECRET');
  assert.equal((await m.account.forLaunch()).xuid, '12345');
  assert.equal(m.calls.length, 4);
  now += 3600 * 1000;
  assert.equal((await m.account.forLaunch()).accessToken, 'MC_SECRET');
  assert.deepEqual(m.counters(), { silent: 1, interactive: 1 });
  assert.doesNotMatch(JSON.stringify([m.events, m.account.summary()]), /MS_SECRET|MC_SECRET|XBOX_SECRET|XSTS_SECRET/);
  await m.account.logout(); await assert.rejects(m.account.forLaunch(), /先登录/);
});
test('Microsoft unconfigured, denied entitlement/profile, XSTS failure and expired refresh block launch', async () => {
  await assert.rejects(new MicrosoftAccount({}).login(), /尚未配置/);
  const xsts = mockAuth({ failAt: 1 }); await assert.rejects(xsts.account.login(), /Xbox 授权/); assert.equal(xsts.account.summary().profile, null);
  const missing = mockAuth({ failAt: 3 }); await assert.rejects(missing.account.login(), /没有可用的 Java/);
  const m = mockAuth(); await m.account.login(); m.account.identity.expiresAt = 0; m.account.client.acquireTokenSilent = async () => { throw new Error('SECRET'); };
  await assert.rejects(m.account.forLaunch(), /授权已过期/); assert.equal(m.account.summary().profile, null);
});
test('Online launch arguments use owned profile and token; renderer status never contains token', async t => {
  const f = await fixture(t); const m = mockAuth(); await m.account.login();
  const plan = await buildPlan({ ...f.options, identity: await m.account.forLaunch() });
  assert.equal(plan.argv[plan.argv.indexOf('--username') + 1], 'OwnedPlayer');
  assert.equal(plan.argv[plan.argv.indexOf('--accessToken') + 1], 'MC_SECRET');
  assert.equal(plan.argv[plan.argv.indexOf('--userType') + 1], 'msa');
  assert.equal(plan.argv[plan.argv.indexOf('--clientId') + 1], 'own-test-client');
});

function zipFixture(entries) {
  const local = [], central = []; let offset = 0;
  for (const [name, content] of entries) {
    const filename = Buffer.from(name), data = Buffer.from(content);
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50); head.writeUInt16LE(20, 4); head.writeUInt32LE(crc, 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(filename.length, 26);
    const dir = Buffer.alloc(46); dir.writeUInt32LE(0x02014b50); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(data.length, 24); dir.writeUInt16LE(filename.length, 28); dir.writeUInt32LE(offset, 42);
    local.push(head, filename, data); central.push(dir, filename); offset += head.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
test('Native JAR extraction runs for real with synthetic DLLs; artifact stays on classpath', async t => {
  const f = await fixture(t);
  const jar = zipFixture([['lwjgl.dll', 'synthetic DLL, not executable'], ['META-INF/MANIFEST.MF', 'excluded'], ['linux/x64/liblwjgl.so', 'wrong platform']]);
  const artifact = 'org/test/lwjgl/1/lwjgl-1.jar', native = 'org/test/lwjgl/1/lwjgl-1-natives-windows.jar';
  f.base.libraries.push({ name: 'org.test:lwjgl:1', natives: { windows: 'natives-windows', osx: 'natives-macos' }, extract: { exclude: ['META-INF/'] }, downloads: { artifact: { path: artifact, sha1: hash('classes'), url: 'https://example.invalid/artifact' }, classifiers: { 'natives-windows': { path: native, sha1: hash(jar), url: 'https://example.invalid/native' } } } });
  await put(f.baseFile, f.base); await put(path.join(f.root, 'libraries', artifact), 'classes'); await put(path.join(f.root, 'libraries', native), jar);
  let extracted, child;
  const launcher = new GameLauncher({ library: new Map([[f.instance.id, f.instance]]), account: {}, cacheDir: path.join(f.temp, 'cache'), platform, probe: async () => f.options.java, spawnImpl: (_exe, args) => {
    extracted = args.find(a => a.startsWith('-Djava.library.path=')).slice('-Djava.library.path='.length);
    assert.ok(args[args.indexOf('-cp') + 1].includes('lwjgl-1.jar'));
    assert.ok(!args[args.indexOf('-cp') + 1].includes('natives-windows.jar'));
    child = new EventEmitter(); queueMicrotask(() => child.emit('spawn')); return child;
  } });
  launcher.javaPath = f.options.java.path;
  await launcher.start({ id: f.instance.id, accountMode: 'offline', name: 'Player_1', mode: 'auto', memoryMB: 1024 });
  assert.equal(await readFile(path.join(extracted, 'lwjgl.dll'), 'utf8'), 'synthetic DLL, not executable');
  assert.equal(await stat(path.join(extracted, 'MANIFEST.MF')).then(() => true, () => false), false);
  assert.equal(await stat(path.join(extracted, 'liblwjgl.so')).then(() => true, () => false), false);
  child.emit('exit', 0, null);
});
test('Asset object hashing and traversal checks run before any process spawn', async t => {
  const f = await fixture(t);
  const content = 'synthetic sound', sha1 = hash(content);
  const index = JSON.stringify({ objects: { 'minecraft/sounds/test.ogg': { hash: sha1, size: content.length } } });
  f.base.assetIndex.sha1 = hash(index); await put(f.baseFile, f.base);
  await put(path.join(f.root, 'assets', 'indexes', `${f.vanilla}.json`), index);
  await assert.rejects(buildPlan(f.options), /文件缺失或损坏/);
  await put(path.join(f.root, 'assets', 'objects', sha1.slice(0, 2), sha1), content);
  await buildPlan(f.options);
  await put(path.join(f.root, 'assets', 'indexes', `${f.vanilla}.json`), { objects: { '../../../../outside': { hash: sha1 } } });
  await assert.rejects(buildPlan(f.options), /超出/);
});
