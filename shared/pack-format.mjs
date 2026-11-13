import {createHash} from 'node:crypto';
import path from 'node:path';
import {stat,mkdir} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {Transform,Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {open,walkEntriesGenerator,readEntry,openEntryReadStream} from '@xmcl/unzip';

export const MAX_PACK_BYTES=600*1024*1024;
export const LEGACY_PACK_BYTES=16*1024*1024;
export const UPLOAD_CHUNK_BYTES=4*1024*1024;
const allowedHosts=new Set(['cdn.modrinth.com','github.com','raw.githubusercontent.com','objects.githubusercontent.com','release-assets.githubusercontent.com','gitlab.com']);
export function packURL(value){
  let url;try{url=new URL(value);}catch{throw Error('整合包包含无效下载地址');}
  if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||!allowedHosts.has(url.hostname))throw Error('整合包下载来源暂不支持：'+url.hostname);
  return url.href;
}
export function packPath(value){
  if(typeof value!=='string'||value.length>300||/[\\:\x00-\x1f]/.test(value)||value.startsWith('/')||value.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))throw Error('整合包包含不安全的文件路径');
  if(/^(?:versions|libraries|assets|runtimes|pcl|\.joincraft)(?:\/|$)/i.test(value))throw Error('整合包不能覆盖启动器的运行环境');
  return value;
}
const label=(value,max)=>{if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x1f]/.test(value))throw Error('整合包名称或版本无效');return value.trim();};
const version=value=>{if(typeof value!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._+\-]{0,79}$/.test(value))throw Error('整合包依赖版本无效');return value;};
export function inspectIndex(index){
  if(index?.formatVersion!==1||index.game!=='minecraft'||!Array.isArray(index.files)||index.files.length>5000)throw Error('请选择标准 Modrinth .mrpack 整合包');
  const name=label(index.name,120),versionId=label(index.versionId,100),deps=index.dependencies;
  if(!deps||typeof deps!=='object'||Array.isArray(deps))throw Error('整合包缺少游戏版本');
  const minecraft=version(deps.minecraft),loaders=Object.keys(deps).filter(key=>key!=='minecraft');
  if(loaders.length>1||loaders.some(key=>!['fabric-loader','forge','neoforge','quilt-loader'].includes(key)))throw Error('整合包加载器暂不支持');
  const loaderKey=loaders[0]||null,loaderVersion=loaderKey?version(deps[loaderKey]):'';
  const loader=({'fabric-loader':'Fabric',forge:'Forge',neoforge:'NeoForge','quilt-loader':'Quilt'})[loaderKey]||'原版';
  const seen=new Set();let totalBytes=0;
  const files=index.files.map(file=>{
    const filePath=packPath(file.path),key=filePath.toLowerCase();if(seen.has(key))throw Error('整合包包含重复文件路径');seen.add(key);
    if(!/^[a-f0-9]{128}$/i.test(file.hashes?.sha512??'')||!/^[a-f0-9]{40}$/i.test(file.hashes?.sha1??''))throw Error('整合包文件缺少校验信息');
    if(!Number.isSafeInteger(file.fileSize)||file.fileSize<=0||file.fileSize>2*1024**3)throw Error('整合包文件大小无效');
    const client=file.env?.client??'required';if(!['required','optional','unsupported'].includes(client))throw Error('整合包客户端标记无效');
    if(!Array.isArray(file.downloads)||!file.downloads.length||file.downloads.length>8)throw Error('整合包缺少文件下载地址');
    const downloads=file.downloads.map(packURL);if(client!=='unsupported')totalBytes+=file.fileSize;
    return {path:filePath,hashes:{sha1:file.hashes.sha1.toLowerCase(),sha512:file.hashes.sha512.toLowerCase()},size:file.fileSize,downloads,client};
  }).filter(file=>file.client!=='unsupported');
  if(totalBytes>20*1024**3)throw Error('整合包超过首版 20 GB 安装上限');
  return {name,versionId,minecraft,loader,loaderKey,loaderVersion,files,totalBytes};
}
export async function archiveSize(source){
  const size=Buffer.isBuffer(source)?source.length:typeof source==='string'?await stat(source).then(info=>info.isFile()?info.size:0):0;
  if(size<20||size>MAX_PACK_BYTES)throw Error('整合包文件最大支持 600 MB');return size;
}
export async function archiveHash(source,{signal,onProgress}={}){
  const total=await archiveSize(source),hash=createHash('sha512');let completed=0;
  const stream=Buffer.isBuffer(source)?[source]:createReadStream(source,{highWaterMark:256*1024});
  try{for await(const chunk of stream){signal?.throwIfAborted();hash.update(chunk);completed+=chunk.length;onProgress?.({file:'校验整合包文件',completed,total});}}
  finally{stream.destroy?.();}
  return hash.digest('hex');
}
export async function inspectMrpack(source,{overrides=false,signal,onProgress}={}){
  const size=await archiveSize(source),zip=await open(source),seen=new Set(),entries=[];let index,total=0,count=0,buffered=0;
  try{
    for await(const entry of walkEntriesGenerator(zip)){
      signal?.throwIfAborted();if(++count>12000)throw Error('整合包文件数量过多');
      const name=entry.fileName;packPath(name.endsWith('/')?name.slice(0,-1):name);
      if(seen.has(name.toLowerCase()))throw Error('整合包包含重复压缩条目');seen.add(name.toLowerCase());
      const mode=entry.externalFileAttributes>>>16;if((mode&0xf000)===0xa000)throw Error('整合包不支持符号链接');
      if(!Number.isSafeInteger(entry.uncompressedSize)||entry.uncompressedSize<0)throw Error('整合包文件大小无效');
      total+=entry.uncompressedSize;if(total>4*1024**3||entry.uncompressedSize>1024**3)throw Error('整合包解压后总大小不得超过 4 GB，单个文件不得超过 1 GB');
      if(name==='modrinth.index.json'){
        if(entry.uncompressedSize>2*1024*1024)throw Error('整合包清单过大');index=JSON.parse((await readEntry(zip,entry)).toString('utf8'));
      }else if(!name.endsWith('/')&&/^(?:overrides|client-overrides)\//.test(name)){
        const relative=packPath(name.slice(name.indexOf('/')+1)),hash=createHash('sha512'),chunks=[];let completed=0;
        if(overrides&&(buffered+=entry.uncompressedSize)>LEGACY_PACK_BYTES)throw Error('大整合包需要使用文件流模式解压');
        const stream=await openEntryReadStream(zip,entry);
        // yauzl 2 streams override destroy() without the modern close contract.
        // pipeline uses their end events, including tiny stored ZIP entries.
        try{await pipeline(stream,new Writable({write(chunk,_encoding,callback){try{signal?.throwIfAborted();hash.update(chunk);completed+=chunk.length;if(completed>entry.uncompressedSize)throw Error('整合包文件大小不一致');if(overrides)chunks.push(chunk);onProgress?.({file:relative,completed,total:entry.uncompressedSize});callback();}catch(error){callback(error);}}}),{signal});if(completed!==entry.uncompressedSize)throw Error('整合包文件大小不一致');}
        finally{stream.destroy();}
        entries.push({path:relative,entryName:name,size:entry.uncompressedSize,priority:name.startsWith('client-overrides/')?1:0,sha512:hash.digest('hex'),...(overrides?{data:Buffer.concat(chunks)}:{})});
      }
    }
  }finally{zip.close();}
  const parsed=inspectIndex(index),selected=new Map();for(const entry of entries.sort((a,b)=>a.priority-b.priority))selected.set(entry.path.toLowerCase(),entry);
  const files=new Set(parsed.files.map(f=>f.path.toLowerCase()));for(const entry of selected.values())if(files.has(entry.path.toLowerCase()))throw Error('整合包下载清单与内置文件重复');
  return {...parsed,totalBytes:parsed.totalBytes+[...selected.values()].reduce((sum,entry)=>sum+entry.size,0),sha512:await archiveHash(source,{signal,onProgress}),archiveSize:size,overrides:[...selected.values()]};
}
export async function extractMrpackOverrides(source,entries,root,{signal,onProgress}={}){
  const selected=new Map(entries.map(entry=>[entry.entryName,entry])),zip=await open(source);let written=0;
  try{
    for await(const entry of walkEntriesGenerator(zip)){
      signal?.throwIfAborted();const expected=selected.get(entry.fileName);if(!expected)continue;
      const file=destination(root,expected.path);await mkdir(path.dirname(file),{recursive:true});
      const hash=createHash('sha512');let bytes=0;
      const meter=new Transform({transform(chunk,_encoding,callback){try{signal?.throwIfAborted();bytes+=chunk.length;if(bytes>expected.size)throw Error('整合包文件大小不一致');hash.update(chunk);onProgress?.({file:expected.path,completed:bytes,total:expected.size});callback(null,chunk);}catch(error){callback(error);}}});
      await pipeline(await openEntryReadStream(zip,entry),meter,createWriteStream(file,{flags:'wx',mode:0o600}),{signal});
      if(bytes!==expected.size||hash.digest('hex')!==expected.sha512)throw Error('解压校验失败：'+expected.path);
      onProgress?.({file:expected.path,completed:bytes,total:expected.size,done:true});written++;
    }
    if(written!==entries.length)throw Error('整合包缺少内置文件');
  }finally{zip.close();}
}
export function packSummary(pack){const {sha512,name,versionId,minecraft,loader,loaderVersion,archiveSize,totalBytes}=pack;return {sha512,name,versionId,minecraft,loader,loaderVersion,archiveSize,totalBytes};}
export function destination(root,relative){return path.join(root,...packPath(relative).split('/'));}
