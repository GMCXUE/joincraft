import path from 'node:path';
import {lstat,readdir,realpath} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {open} from '@xmcl/unzip';
import {parse} from 'smol-toml';
import {zipEntries,zipEntryStream} from '../shared/zip-io.mjs';
const LIMIT=2*1024*1024;
const text=(v,max=400)=>typeof v==='string'?v.replace(/[\x00-\x08\x0b-\x1f]/g,'').slice(0,max):'';
const arr=v=>Array.isArray(v)?v:[];
const authors=v=>(typeof v==='string'?[v]:arr(v).map(a=>typeof a==='string'?a:a?.name)).filter(Boolean).map(v=>text(v));
const dependency=(id,range,kind='required')=>({id:text(id),range:text(Array.isArray(range)?range.join(' || '):String(range??'*')),kind});
export const modFileId=name=>createHash('sha256').update(name).digest('hex');
export async function fileHash(file,{signal,algorithm='sha512'}={}){const hash=createHash(algorithm);for await(const chunk of createReadStream(file,{signal})){signal?.throwIfAborted();hash.update(chunk);}return hash.digest('hex');}
async function bounded(zip,entry,signal,limit=LIMIT){
 if(entry.uncompressedSize>limit)throw Error('模组元数据过大');const chunks=[];let bytes=0;const stream=await zipEntryStream(zip,entry,{signal});
 try{for await(const chunk of stream){signal?.throwIfAborted();if((bytes+=chunk.length)>limit)throw Error('模组元数据过大');chunks.push(chunk);}return Buffer.concat(chunks);}finally{stream.destroy();}
}
function safeEntry(name){return typeof name==='string'&&name.length<500&&!/[\\:\x00-\x1f]/.test(name)&&!name.startsWith('/')&&!name.split('/').some(p=>p==='..'||p==='.');}
function decode(entries){
 const json=name=>JSON.parse(entries.get(name).toString('utf8'));
 const mods=[],formats=[],icons=[];
 let manifest=text(entries.get('META-INF/MANIFEST.MF')?.toString('utf8'),LIMIT).replace(/\r?\n /g,'');
 const jarVersion=manifest.match(/^Implementation-Version:\s*(.+)$/im)?.[1]?.trim();
 const add=(m,loader)=>{if(mods.length>=128)throw Error('JAR 内模组数量过多');mods.push({...m,id:text(m.id),name:text(m.name)||text(m.id),version:text(m.version)==='${file.jarVersion}'?jarVersion||'未知版本':text(m.version)||'未知版本',description:text(m.description,8000),authors:authors(m.authors),loader});if(m.icon)icons.push(m.icon);};
 for(const [name,loader] of [['META-INF/neoforge.mods.toml','NeoForge'],['META-INF/mods.toml','Forge']])if(entries.has(name)){
  const d=parse(entries.get(name).toString('utf8'),{unsafeKeyBehaviour:'throw'});formats.push(loader);
  for(const m of arr(d.mods))add({id:m.modId,name:m.displayName,version:m.version,authors:m.authors,description:m.description,icon:m.logoFile||d.logoFile,dependencies:arr(d.dependencies?.[m.modId]).map(x=>dependency(x.modId,x.versionRange,x.type==='incompatible'?'incompatible':x.mandatory===false||x.type==='optional'?'optional':'required'))},loader);
 }
 if(entries.has('fabric.mod.json')){const d=json('fabric.mod.json');formats.push('Fabric');const dependencies=[];for(const [field,kind] of [['depends','required'],['recommends','optional'],['suggests','optional'],['breaks','incompatible']])for(const [id,range] of Object.entries(d[field]||{}))dependencies.push(dependency(id,range,kind));add({id:d.id,name:d.name,version:d.version,authors:d.authors,description:d.description,environment:d.environment||'*',icon:typeof d.icon==='string'?d.icon:Object.values(d.icon||{})[0],dependencies},'Fabric');}
 if(entries.has('quilt.mod.json')){const d=json('quilt.mod.json').quilt_loader||{};formats.push('Quilt');add({id:d.id,name:d.metadata?.name,version:d.version,authors:Object.keys(d.metadata?.contributors||{}),description:d.metadata?.description,icon:d.metadata?.icon,dependencies:arr(d.depends).filter(x=>x?.id).map(x=>dependency(x.id,x.versions,x.optional?'optional':'required'))},'Quilt');}
 if(!mods.length&&entries.has('mcmod.info')){const d=json('mcmod.info');formats.push('Legacy');for(const m of arr(Array.isArray(d)?d:d.modList))add({id:m.modid,name:m.name,version:m.version,authors:m.authorList,description:m.description,icon:m.logoFile,dependencies:arr(m.requiredMods).map(id=>dependency(id,'*'))},'Legacy');}
 const unique=[...new Map(mods.map(m=>[m.id+'@'+m.loader,m])).values()];return {mods:unique,loaders:formats,icons};
}
export async function inspectMod(file,{signal,hash=true}={}){
 const before=await lstat(file);if(!before.isFile()||before.isSymbolicLink()||before.size>1024**3)throw Error('模组必须是普通 JAR 文件，最大支持 1 GB');
 const zip=await open(file),entries=new Map(),seen=new Set();let count=0;
 try{for await(const entry of zipEntries(zip,{signal})){
  if(++count>100000)throw Error('JAR 条目过多');if(!safeEntry(entry.fileName))throw Error('JAR 包含不安全路径');
  if(seen.has(entry.fileName))throw Error('JAR 包含重复条目');seen.add(entry.fileName);
  if(['META-INF/mods.toml','META-INF/neoforge.mods.toml','fabric.mod.json','quilt.mod.json','mcmod.info','META-INF/MANIFEST.MF'].includes(entry.fileName))entries.set(entry.fileName,await bounded(zip,entry,signal));
 }}finally{zip.close();}
 const result=decode(entries);let icon=null;
 const iconPath=result.icons.find(p=>safeEntry(p)&&/\.png$/i.test(p));
 if(iconPath){const images=await open(file);try{for await(const entry of zipEntries(images,{signal})){if(entry.fileName!==iconPath)continue;try{const data=await bounded(images,entry,signal,512*1024);if(data.length>=24&&data.readUInt32BE(16)<=1024&&data.readUInt32BE(20)<=1024&&data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))icon='data:image/png;base64,'+data.toString('base64');}catch(e){if(signal?.aborted)throw e;}break;}}finally{images.close();}}
 const sha512=hash?await fileHash(file,{signal}):null,after=await lstat(file);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('扫描期间模组文件发生变化，请刷新');
 return {mods:result.mods,loaders:result.loaders,icon,sha512,size:after.size,name:result.mods[0]?.name||path.basename(file).replace(/\.jar(?:\.disabled)?$/i,''),version:result.mods[0]?.version||'未知版本',status:result.mods.length?'ready':'unknown',warnings:result.mods.length?[]:['未找到可识别的模组信息']};
}
export async function scanMods(root,{signal,onProgress=()=>{}}={}){
 const dir=path.join(await realpath(root),'mods');try{if(await realpath(dir)!==dir)throw Error('模组目录不能是符号链接');}catch(error){if(error.code==='ENOENT')return [];throw error;}
 const files=(await readdir(dir)).filter(name=>/\.jar(?:\.disabled)?$/i.test(name)).sort();if(files.length>5000)throw Error('模组文件数量超过 5000');
 const result=[];let next=0;await Promise.all(Array.from({length:Math.min(4,files.length)},async()=>{while(next<files.length){const name=files[next++];signal?.throwIfAborted();let item;try{item=await inspectMod(path.join(dir,name),{signal});}catch(error){if(signal?.aborted)throw error;item={name,mods:[],loaders:[],status:'broken',warnings:[error.message]};}result.push({...item,fileId:modFileId(name),fileName:name,enabled:!name.toLowerCase().endsWith('.disabled')});onProgress({completed:result.length,total:files.length,file:name});}}));
 const ids=new Map();for(const item of result.filter(i=>i.enabled))for(const id of new Set(item.mods.map(m=>m.id))){const owners=ids.get(id)||[];owners.push(item);ids.set(id,owners);}for(const [id,owners] of ids)if(owners.length>1)for(const item of owners)item.warnings.push('重复 Mod ID：'+id);
 return result.sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
}
