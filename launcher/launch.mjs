import path from 'node:path';
import os from 'node:os';
import { stat, readFile, mkdir, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { generateArguments, getPlatform, LaunchPrecheck, MinecraftFolder } from '@xmcl/core';
import { inside, resolveInstance, isolationFor } from './library.mjs';
import { offlineIdentity } from './auth.mjs';
import {readSystemMemory,resolveMemory} from './memory.mjs';
import {resolveLogging,prepareLogging} from './logging.mjs';

export function parseJava(text) {
  const match = text.match(/(?:java|openjdk) version "(\d+)(?:\.(\d+))?/i);
  if (!match) throw new Error('无法识别 Java 版本，请选择 Java 的 bin/java 或 bin/java.exe');
  const major = Number(match[1] === '1' ? match[2] : match[1]);
  const arch = /(?:aarch64|arm64)/i.test(text) ? 'arm64' : /(?:amd64|x86_64)/i.test(text) ? 'x64' : /(?:os.arch\s*=\s*(?:x86|i386))/.test(text) ? 'x86' : null;
  return { major, arch };
}
export async function probeJava(javaPath, {timeout=10000}={}) {
  // Paths come from local discovery or the native picker, never a remote web page.
  const base = path.basename(javaPath).toLowerCase();
  if (!['java', 'java.exe', 'javaw.exe'].includes(base) || !path.isAbsolute(javaPath)) throw new Error('请选择 Java 安装目录下的 bin/java.exe（macOS 为 bin/java）');
  const executable = base === 'javaw.exe' ? path.join(path.dirname(javaPath), 'java.exe') : javaPath;
  try {
    const { stdout, stderr } = await promisify(execFile)(executable, ['-XshowSettings:properties', '-version'], { timeout, maxBuffer: 128 * 1024, windowsHide: true, shell: false });
    return { ...parseJava(`${stdout}\n${stderr}`), version: `${stdout}\n${stderr}`.match(/(?:java|openjdk) version "([^"]+)"/i)?.[1], path: executable };
  } catch (e) { if (e.message.startsWith('无法识别')) throw e; throw new Error('Java 无法运行，请检查安装与操作系统架构'); }
}

async function checkFile(file, sha1, failures, signal) {
  signal?.throwIfAborted();
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size === 0) throw new Error();
    if (sha1) {
      if (!/^[a-f0-9]{40}$/i.test(sha1)) throw new Error();
      const hash = createHash('sha1');
      for await (const chunk of createReadStream(file,{signal})) hash.update(chunk);
      if (hash.digest('hex').toLowerCase() !== sha1.toLowerCase()) throw new Error();
    }
  } catch(error) { if(signal?.aborted)throw signal.reason;failures.push(file); }
}
export async function validateFiles(root, version, {signal}={}) {
  signal?.throwIfAborted();
  const files = [[path.join(root, 'versions', version.minecraftVersion, `${version.minecraftVersion}.jar`), version.downloads?.client?.sha1]];
  for (const lib of version.libraries) files.push([inside(path.join(root, 'libraries'), lib.download.path), lib.download.sha1]);
  const indexFile = path.join(root, 'assets', 'indexes', `${version.assets}.json`);
  let index;
  try { index = JSON.parse(await readFile(indexFile, 'utf8')); } catch { throw new Error('缺少或损坏资源索引，请先在 PCL 中修复该实例'); }
  if (!index.objects || typeof index.objects !== 'object' || Array.isArray(index.objects)) throw new Error('游戏资源索引格式错误');
  if (index.map_to_resources) throw new Error('此旧版使用 resources 资源映射，暂请通过 PCL 启动');
  files.push([indexFile, version.assetIndex?.sha1]);
  for (const [name, asset] of Object.entries(index.objects)) {
    inside(path.join(root, 'assets', 'virtual', version.assets), name);
    if (!/^[a-f0-9]{40}$/.test(asset.hash ?? '')) throw new Error('游戏资源索引包含无效哈希');
    files.push([path.join(root, 'assets', 'objects', asset.hash.slice(0, 2), asset.hash), asset.hash]);
  }
  const failures = [];
  let cursor = 0;
  await Promise.allSettled(Array.from({ length: 8 }, async () => { while (cursor < files.length) { signal?.throwIfAborted();const file = files[cursor++]; await checkFile(...file, failures,signal); } }));
  signal?.throwIfAborted();
  if (failures.length) throw new Error(`有 ${failures.length} 个游戏文件缺失或损坏，请先在 PCL 中补齐。首个文件：${path.relative(root, failures[0])}`);
  return files.length;
}

export async function buildPlan({ instance, java, memoryMB, mode, identity, cacheDir, platform = getPlatform() }) {
  if (!Number.isInteger(memoryMB) || memoryMB < 512 || memoryMB > Math.floor(os.totalmem() / 1048576)) throw new Error('内存必须在 512 MB 与本机物理内存上限之间');
  const { version, hierarchy } = await resolveInstance(instance, platform);
  const isolation = await isolationFor(instance.root, instance.version, hierarchy);
  const selectedMode = mode === 'auto' ? isolation.mode : mode;
  if (!['shared', 'isolated'].includes(selectedMode)) throw new Error('请确认使用独立版本目录还是共享 .minecraft 目录');
  if (java.major !== version.javaVersion.majorVersion) throw new Error(`此实例需要 Java ${version.javaVersion.majorVersion}，当前选择的是 Java ${java.major}`);
  if (!java.arch || java.arch !== platform.arch) throw new Error(`Java 架构需与客户端一致（${platform.arch}），请重新选择 Java`);
  const gamePath = selectedMode === 'isolated' ? path.join(instance.root, 'versions', instance.version) : instance.root;
  const files = await validateFiles(instance.root, version);
  const logging = await resolveLogging(instance.root, version.logging, cacheDir);
  const nativeRoot = path.join(cacheDir, 'natives', randomUUID());
  // Core formats classpaths using the host delimiter. Override explicitly so Windows plans
  // can also be tested on macOS without executing a cross-platform command.
  const separator = platform.name === 'windows' ? ';' : ':';
  const classpath = [...version.libraries.filter(l => !l.isNative).map(l => inside(path.join(instance.root, 'libraries'), l.download.path)), path.join(instance.root, 'versions', version.minecraftVersion, `${version.minecraftVersion}.jar`)].join(separator);
  const options = { javaPath: java.path, gamePath, resourcePath: instance.root, version: { ...version, logging: undefined }, platform, nativeRoot, maxMemory: memoryMB, minMemory: Math.min(512, memoryMB), gameProfile: { id: identity.id, name: identity.name }, accessToken: identity.accessToken, userType: identity.userType, launcherName: 'joincraft', launcherBrand: '0.9.0', extraJVMArgs: logging ? [logging.argument] : [], features: { blockroom_values: { clientid: identity.clientId || '0', auth_xuid: identity.xuid || '0', classpath, classpath_separator: separator } } };
  const argv = await generateArguments(options);
  if (argv.some(arg => /\$\{[^}]+\}/.test(arg))) throw new Error('此实例包含尚未支持的启动参数，请通过 PCL 启动');
  if (argv.some(arg => arg.includes('\0'))) throw new Error('启动参数包含无效字符');
  return { options, argv, files, gamePath, nativeRoot, logging, instanceId: instance.id };
}

export class GameLauncher {
  constructor({ library, account, cacheDir, notify = () => {}, spawnImpl = spawn, probe = probeJava, platform = getPlatform(), memoryProvider = readSystemMemory, prepare = async plan => {
    await mkdir(plan.nativeRoot, { recursive: true });
    const resource = MinecraftFolder.from(plan.options.resourcePath);
    await LaunchPrecheck.checkNatives(resource, plan.options.version, plan.options);
    await LaunchPrecheck.linkAssets(resource, plan.options.version, plan.options);
  } }) {
    Object.assign(this, { library, account, cacheDir, notify, spawnImpl, probe, platform, prepare, memoryProvider });
    this.runs = new Map();
    this.javaPath = null;
  }
  states() { return [...this.runs.entries()].map(([id, run]) => ({ id, state: run.state, message: run.message, ...(Number.isInteger(run.memoryMB)?{memoryMB:run.memoryMB}:{}) })); }
  state(id, state, message, details={}) { const run = this.runs.get(id) || {}; if(state==='checking')delete run.memoryMB;Object.assign(run, { state, message },details); this.runs.set(id, run); this.notify({ type: 'run', id, state, message, ...(Number.isInteger(run.memoryMB)?{memoryMB:run.memoryMB}:{}) }); }
  async plan(input, realLaunch = false) {
    const instance = this.library.get(input.id);
    if (!instance || instance.error) throw new Error(instance?.error || '请重新选择整合包目录');
    if (!this.javaPath) throw new Error('请先选择 Java');
    if (!['offline', 'microsoft'].includes(input.accountMode)) throw new Error('请选择启动账号');
    // Checking files never opens Microsoft sign-in or creates a game process.
    const identity = input.accountMode === 'offline' ? offlineIdentity(input.name) : realLaunch ? await this.account.forLaunch() : { name: 'AccountCheck', id: '00000000000000000000000000000000', accessToken: '0', userType: 'msa', clientId: this.account.clientId || '0', xuid: '0' };
    const java = await this.probe(this.javaPath);
    try { return await buildPlan({ instance, java, memoryMB: resolveMemory(input,await this.memoryProvider()), mode: input.mode, identity, cacheDir: this.cacheDir, platform: this.platform }); }
    catch(error){if(instance.managed&&/PCL/.test(error.message))throw new Error(error.message.replace(/请先在 PCL 中补齐|请先在 PCL 中修复该实例|请先在 PCL 中修复该实例/g,'请重新安装此整合包，旧实例和存档会保留'));throw error;}
  }
  async check(input) {
    const plan = await this.plan(input);
    return { memoryMB:plan.options.maxMemory, files: plan.files, gamePath: plan.gamePath, javaMajor: plan.options.version.javaVersion.majorVersion, accountReady: input.accountMode === 'offline' || Boolean(this.account.summary().profile) };
  }
  async start(input, target = null) {
    if (['checking', 'starting', 'running'].includes(this.runs.get(input.id)?.state)) throw new Error('该实例已在启动或运行中');
    // A shared game directory can contain the same saves even when the version IDs differ.
    if ([...this.runs.values()].some(r => ['checking', 'starting', 'running'].includes(r.state))) throw new Error('请先退出当前游戏，再启动另一个实例');
    this.state(input.id, 'checking', '正在校验游戏文件');
    let plan;
    try {
      plan = await this.plan(input, true);
      await prepareLogging(plan.logging);
      await this.prepare(plan);
      const memoryMB=resolveMemory(input,await this.memoryProvider());
      if(memoryMB!==plan.options.maxMemory){plan.options.maxMemory=memoryMB;plan.argv=await generateArguments(plan.options);}
      target?.signal?.throwIfAborted();
      if(target){
        if(!this.library.get(input.id)?.managed||plan.gamePath!==this.library.get(input.id).root)throw Error('自动进入仅支持自有独立实例');
        if(target.type==='world'){
          if(typeof target.folder!=='string'||!target.folder||target.folder==='.'||target.folder==='..'||/[\\/\x00-\x1f]/.test(target.folder))throw Error('存档名称无效');
          plan.argv=[plan.argv[0],...(target.helper?.jvmArgs||[]),...plan.argv.slice(1),'--quickPlaySingleplayer',target.folder,...(target.helper?.gameArgs||[])];
        }else if(target.type==='server'&&/^127\.0\.0\.1:[0-9]{1,5}$/.test(target.address)&&Number(target.address.split(':')[1])<=65535&&Number(target.address.split(':')[1])>0){plan.argv.push('--quickPlayMultiplayer',target.address);}
        else throw Error('游戏进入目标无效');
      }
      this.state(input.id, 'starting', '正在创建 Java 进程',{memoryMB});
      const child = this.spawnImpl(plan.argv[0], plan.argv.slice(1), { cwd: plan.gamePath, shell: false, windowsHide: true, stdio: 'ignore' });
      this.runs.get(input.id).child = child;
      const cleanup = () => rm(plan.nativeRoot, { recursive: true, force: true }).catch(() => {});
      child.once('exit', (code, signal) => { target?.onExit?.(); this.state(input.id, code === 0 ? 'exited' : 'failed', code === 0 ? '游戏已退出' : `游戏进程已退出（${signal || code}），可查看该实例 logs/latest.log`); void cleanup(); });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', () => { this.state(input.id, 'failed', 'Java 进程启动失败，请检查所选 Java'); void cleanup(); reject(new Error('Java 进程启动失败，请检查所选 Java')); }); });
      if (this.runs.get(input.id).state === 'starting') this.state(input.id, 'running', '游戏进程已启动');
      return { started: true };
    } catch (e) {
      if (plan) await rm(plan.nativeRoot, { recursive: true, force: true }).catch(() => {});
      this.state(input.id, 'failed', e.message || '启动失败，请先通过 PCL 检查实例');
      throw e;
    }
  }
}
