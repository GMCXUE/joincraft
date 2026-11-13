import path from 'node:path';
import {readFile,stat,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {safePart} from './library.mjs';

// Pin the official configurations independently of pack metadata. Old metadata may
// reference an earlier revision of the same stock ID; the fallback uses these bytes.
const bundled = new Map([
  ['client-1.7.xml', {sha1:'50c9cc4af6d853d9fc137c84bcd153e2bd3a9a82',size:966}],
  ['client-1.12.xml', {sha1:'bd65e7d2e3c237be76cfbef4c2405033d7f91521',size:888}],
  ['client-1.21.2.xml', {sha1:'39384bd14c0606d812afec88d8aff595b2587dd9',size:1073}],
]);
const digest = data => createHash('sha1').update(data).digest('hex');
async function validFile(file, expected) {
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size === 0 || info.size > 1024*1024) return false;
    if (expected.size !== undefined && info.size !== expected.size) return false;
    if (expected.sha1 !== undefined && !/^[a-f0-9]{40}$/i.test(expected.sha1)) return false;
    return expected.sha1 === undefined || digest(await readFile(file)) === expected.sha1.toLowerCase();
  } catch { return false; }
}
async function bundledBytes(id) {
  const expected = bundled.get(id);
  const data = await readFile(new URL('./log-configs/'+id, import.meta.url));
  if (!expected || data.length !== expected.size || digest(data) !== expected.sha1) throw new Error('客户端自带的日志配置损坏，请重新下载客户端');
  return data;
}

// Planning only reads. The JVM always receives one explicit logging configuration,
// including when the original file is absent and XMCL would omit the argument.
export async function resolveLogging(root, logging, cacheDir) {
  if (!logging?.client) return null;
  const {file,argument} = logging.client;
  const id = safePart(file?.id);
  if (!/^-Dlog4j(?:2)?\.configurationFile=\$\{path\}$/.test(argument ?? '')) throw new Error('此整合包的日志启动参数暂不支持，请通过 PCL 启动');
  const original = path.join(root,'assets','log_configs',id);
  if (await validFile(original,file)) return {file:original,argument:argument.replace('$'+'{path}',()=>original)};
  const expected = bundled.get(id);
  if (!expected) throw new Error('缺少或损坏自定义日志配置：'+id+'，请先通过 PCL 检查该实例');
  await bundledBytes(id);
  const target = path.join(cacheDir,'log-configs',expected.sha1,id);
  return {file:target,argument:argument.replace('$'+'{path}',()=>target),bundledId:id};
}

// Write only inside joincraft's cache, never into PCL's game directory.
export async function prepareLogging(logging) {
  if (!logging?.bundledId) return;
  const expected = bundled.get(logging.bundledId);
  if (await validFile(logging.file,expected)) return;
  const data = await bundledBytes(logging.bundledId);
  const temp = logging.file+'.'+randomUUID()+'.tmp';
  try {
    await mkdir(path.dirname(logging.file),{recursive:true});
    await writeFile(temp,data,{flag:'wx',mode:0o600});
    await rename(temp,logging.file);
  } catch {
    throw new Error('无法准备游戏日志配置，请检查客户端缓存目录的写入权限');
  } finally { await rm(temp,{force:true}).catch(()=>{}); }
}
