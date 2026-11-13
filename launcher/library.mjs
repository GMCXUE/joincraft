import { readdir, readFile, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Version, getPlatform } from '@xmcl/core';

const exists = p => stat(p).then(s => s.isDirectory(), () => false);
export function safePart(value) {
  if (typeof value !== 'string' || !value || value === '.' || value === '..' || /[\\/:\x00-\x1f]/.test(value)) throw new Error('版本名称或路径不合法');
  return value;
}
export function inside(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0') || /^[A-Za-z]:/.test(relative)) throw new Error('游戏文件路径不合法');
  const result = path.resolve(root, relative);
  if (result === path.resolve(root) || !result.startsWith(path.resolve(root) + path.sep)) throw new Error('游戏文件路径超出所选目录');
  return result;
}
export async function readIni(file) {
  const text = await readFile(file, 'utf8').catch(e => { if (e.code === 'ENOENT') return ''; throw e; });
  return Object.fromEntries(text.replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.match(/^\s*([^#;[=]+?)\s*[:=]\s*(.*?)\s*$/)).filter(Boolean).map(m => [m[1], m[2]]));
}
export async function readHierarchy(root, id, seen = new Set()) {
  safePart(id);
  if (seen.has(id) || seen.size >= 20) throw new Error('版本继承循环或层数过多');
  seen.add(id);
  const file = path.join(root, 'versions', id, `${id}.json`);
  let json;
  try { json = JSON.parse(await readFile(file, 'utf8')); }
  catch { throw new Error(`缺少或无法读取版本配置：${id}.json，请先在 PCL 中修复该实例`); }
  if (json.id !== id) throw new Error(`版本配置 id 与目录名不一致：${id}`);
  for (const key of ['jar', 'clientVersion', '_minecraftVersion', 'assets']) if (json[key]) safePart(json[key]);
  if (json.assetIndex?.id) safePart(json.assetIndex.id);
  if (json.logging?.client?.file?.id) safePart(json.logging.client.file.id);
  if (json.patches) throw new Error('此实例使用额外版本补丁，暂不支持直接启动');
  const parent = json.inheritsFrom ? await readHierarchy(root, json.inheritsFrom, seen) : [];
  return [json, ...parent];
}

export async function resolveInstance(instance, platform = getPlatform()) {
  const hierarchy = await readHierarchy(instance.root, instance.version);
  let legacyArgs = '';
  for (const json of [...hierarchy].reverse()) {
    if (json.minecraftArguments) { legacyArgs = Version.mixinArgumentString(json.minecraftArguments, legacyArgs); json.minecraftArguments = legacyArgs; }
  }
  const normalized = hierarchy.map(json => Version.normalizeVersionJson(JSON.stringify({ ...json, libraries: (json.libraries || []).flatMap(lib => lib.natives && lib.downloads?.artifact ? [{ ...lib, natives: undefined }, lib] : [lib]) }), instance.root, platform));
  const version = Version.resolve(instance.root, normalized);
  // PCL can merge a loader and vanilla into one JSON/JAR instead of keeping a parent version.
  const base = hierarchy.at(-1);
  if (base.jar) version.minecraftVersion = safePart(base.jar);
  else if (base.id !== version.minecraftVersion && await stat(path.join(instance.root, 'versions', base.id, `${base.id}.jar`)).then(s => s.isFile(), () => false)) version.minecraftVersion = base.id;
  if (!hierarchy.some(json => json.javaVersion)) {
    const mc = hierarchy.map(json => json.clientVersion || json._minecraftVersion || json.id).find(id => /^1\.\d+(?:\.\d+)?$/.test(id));
    const [, minor, patch = 0] = (mc || '').split('.').map(Number);
    version.javaVersion.majorVersion = minor >= 21 || (minor === 20 && patch >= 5) ? 21 : minor >= 18 ? 17 : minor === 17 ? 16 : 8;
  }
  safePart(version.minecraftVersion);
  safePart(version.assets);
  for (const lib of version.libraries) inside(path.join(instance.root, 'libraries'), lib.download.path);
  return { version, hierarchy };
}

export async function isolationFor(root, id, hierarchy) {
  try { const managed=JSON.parse(await readFile(path.join(root,'.joincraft','instance.json'),'utf8'));if(managed.schema===1&&managed.version===id)return {mode:'shared',source:'joincraft 独立实例'}; } catch {}
  const dir = path.join(root, 'versions', id);
  const ini = await readIni(path.join(dir, 'PCL', 'Setup.ini'));
  // PCL launch scripts and injected authentication need explicit adapters. Never replay a .bat.
  const custom = Object.entries(ini).filter(([key, value]) => /(?:Advance(?:Jvm|Game|Run)|AuthServer|Authlib)/i.test(key) && value && value !== '0' && value !== 'False');
  if (custom.length) throw new Error(`实例含自定义启动设置（${custom.map(([k]) => k).join('、')}），请先使用 PCL 启动`);
  if (/^(true|false)$/i.test(ini.VersionArgumentIndieV2 ?? '')) return { mode: ini.VersionArgumentIndieV2.toLowerCase() === 'true' ? 'isolated' : 'shared', source: 'PCL 版本隔离设置' };
  if (['1', '2'].includes(ini.VersionArgumentIndie)) return { mode: ini.VersionArgumentIndie === '1' ? 'isolated' : 'shared', source: 'PCL 版本隔离设置' };
  const mods = await readdir(path.join(dir, 'mods')).catch(() => []);
  const saves = await readdir(path.join(dir, 'saves'), { withFileTypes: true }).catch(() => []);
  if (mods.length || saves.some(s => s.isDirectory())) return { mode: 'isolated', source: '实例目录已有模组或存档' };
  // PCL global defaults can live outside the selected folder. Ask for a directory choice instead of guessing.
  return { mode: 'unknown', source: '未找到明确的 PCL 隔离设置，请选择游戏目录' };
}

export async function scanLibrary(selected, platform = getPlatform()) {
  const chosen = await realpath(selected);
  let root = chosen;
  let only;
  if (await exists(path.join(chosen, '.minecraft', 'versions'))) root = path.join(chosen, '.minecraft');
  else if (path.basename(chosen).toLowerCase() === 'versions') root = path.dirname(chosen);
  else if (path.basename(path.dirname(chosen)).toLowerCase() === 'versions') { root = path.dirname(path.dirname(chosen)); only = path.basename(chosen); }
  if (!await exists(path.join(root, 'versions'))) throw new Error('未找到 versions 文件夹，请选择 PCL 整合包目录、.minecraft 或某个版本目录');
  const folders = (await readdir(path.join(root, 'versions'), { withFileTypes: true })).filter(d => d.isDirectory() && (!only || d.name === only));
  if (folders.length > 300) throw new Error('版本目录超过 300 个，请直接选择要启动的版本文件夹');
  const instances = [];
  for (const folder of folders) {
    const item = { id: randomUUID(), root, version: folder.name, name: folder.name };
    try {
      const { version, hierarchy } = await resolveInstance(item, platform);
      const names = version.libraries.map(l => l.name).join(' ');
      const isolation = await isolationFor(root, folder.name, hierarchy);
      Object.assign(item, { minecraft: version.minecraftVersion, javaMajor: version.javaVersion.majorVersion, loader: /neoforged/i.test(names) ? 'NeoForge' : /minecraftforge/i.test(names) ? 'Forge' : /fabricmc/i.test(names) ? 'Fabric' : /quiltmc/i.test(names) ? 'Quilt' : '原版', isolation });
    } catch (e) { item.error = e.message || '无法识别该版本配置'; }
    instances.push(item);
  }
  return { root, instances };
}
