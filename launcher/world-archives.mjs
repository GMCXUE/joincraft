import path from 'node:path';
import {lstat,mkdir,rm,rename,realpath} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {open} from '@xmcl/unzip';
import yazl from 'yazl';
import {zipEntries,zipEntryStream} from '../shared/zip-io.mjs';
import {worldPath,worldDirectory} from './world-backups.mjs';

export async function importWorld(backups,{id,source}){return backups.exclusive(id,'import',async signal=>{
 const context=await backups.store(id,{create:true}),work=path.join(context.store,'.import-'+randomUUID()),stage=path.join(work,'world');await mkdir(work);let committed=false;
 try{const info=await lstat(source);if(info.isSymbolicLink())throw Error('导入来源不能是符号链接');
  if(info.isDirectory()){const origin=await realpath(source);if(origin===context.root||origin.startsWith(context.root+path.sep))throw Error('同一实例的存档无需再次导入；请从其他目录选择世界');const files=await backups.files(origin,signal);await backups.capacity(context.store,files.reduce((n,f)=>n+f.size,0));const copied=await backups.copy(origin,stage,files,signal);await backups.verify(stage,copied,signal);const current=await backups.files(origin,signal);if(JSON.stringify(current)!==JSON.stringify(files))throw Error('导入期间原存档发生变化，请退出游戏后重试');}
  else if(info.isFile()){
   if(info.size>backups.maxBytes)throw Error('存档压缩包超过大小上限');const zip=await open(source),entries=[],seen=new Set();let bytes=0,count=0;
   try{for await(const entry of zipEntries(zip,{signal})){if(++count>backups.maxFiles*2)throw Error('存档压缩条目过多');const name=worldPath(entry.fileName.replace(/\/$/,'')),mode=entry.externalFileAttributes>>>16;if((mode&0xf000)===0xa000||entry.generalPurposeBitFlag&1)throw Error('存档压缩包不支持链接或加密文件');if(seen.has(name.toLowerCase()))throw Error('存档压缩包包含重复文件');seen.add(name.toLowerCase());if(!Number.isSafeInteger(entry.uncompressedSize)||entry.uncompressedSize<0||(bytes+=entry.uncompressedSize)>backups.maxBytes)throw Error('存档解压大小超过上限');if(!entry.fileName.endsWith('/'))entries.push({path:name,size:entry.uncompressedSize});}}finally{zip.close();}
   if(entries.length>backups.maxFiles)throw Error('存档文件数量过多');const levels=entries.filter(e=>e.path==='level.dat'||/^[^/]+\/level\.dat$/.test(e.path));if(levels.length!==1)throw Error('请选择只含一个世界的 ZIP，世界根目录应包含 level.dat');const prefix=levels[0].path.slice(0,-'level.dat'.length);if(entries.some(e=>prefix&&!e.path.startsWith(prefix)))throw Error('压缩包包含世界目录以外的文件');const expected=new Map(entries.map(e=>[e.path,e]));await backups.capacity(context.store,bytes);await mkdir(stage);let completed=0;backups.set({phase:'import',total:bytes,completed:0,percent:0,message:'正在解压存档'},true);const archive=await open(source);
   try{for await(const entry of zipEntries(archive,{signal})){if(entry.fileName.endsWith('/'))continue;const original=expected.get(entry.fileName);if(!original||original.size!==entry.uncompressedSize)throw Error('导入期间压缩包发生变化');expected.delete(entry.fileName);const relative=worldPath(entry.fileName.slice(prefix.length));if(relative==='session.lock'||relative==='.DS_Store')continue;let parent=stage;for(const part of relative.split('/').slice(0,-1)){parent=path.join(parent,part);await worldDirectory(parent,{create:true});}let size=0;await pipeline(await zipEntryStream(archive,entry,{signal}),new Transform({transform(chunk,_e,cb){size+=chunk.length;completed+=chunk.length;backups.set({file:relative,completed,percent:bytes?Math.min(99,completed/bytes*100):null});cb(size>original.size?Error('存档文件大小不一致'):null,chunk);}}),createWriteStream(path.join(stage,relative),{flags:'wx',mode:0o600}),{signal});if(size!==original.size)throw Error('存档文件大小不一致');}if(expected.size)throw Error('存档压缩包缺少文件');}finally{archive.close();}
   const current=await lstat(source);if(current.size!==info.size||current.mtimeMs!==info.mtimeMs)throw Error('导入期间压缩包发生变化');
  }else throw Error('请选择世界文件夹或 ZIP');
  const metadata=await backups.worlds.metadata(stage,'导入世界');if(!metadata?.readable)throw Error('无法读取导入世界的 level.dat，未添加存档');const folder='导入世界-'+randomUUID(),worldId=Buffer.from(folder).toString('base64url');signal.throwIfAborted();await worldDirectory(context.saves,{create:true});backups.set({phase:'committing',message:'正在登记导入存档'},true);await backups.move(stage,path.join(context.saves,folder));committed=true;return {worldId,name:metadata.name};
 }finally{await rm(work,{recursive:true,force:true}).catch(()=>{});}
});}
export async function exportWorld(backups,{id,worldId,destination}){return backups.exclusive(id,'export',async signal=>{
 const context=await backups.store(id,{create:true}),parent=await realpath(path.dirname(destination));if(parent===context.root||parent.startsWith(context.root+path.sep))throw Error('请将存档 ZIP 导出到当前实例以外的目录');const snapshot=await backups.snapshot(id,worldId,signal,'导出前自动备份'),backup=await backups.manifest(id,snapshot.id),temp=path.join(parent,'.joincraft-export-'+randomUUID()+'.zip');await backups.capacity(parent,backup.bytes);const zip=new yazl.ZipFile();zip.on('error',error=>zip.outputStream.destroy(error));const work=pipeline(zip.outputStream,createWriteStream(temp,{flags:'wx',mode:0o600}),{signal});
 try{for(const file of backup.files)zip.addFile(path.join(backup.directory,'world',file.path),file.path);zip.end();backups.set({phase:'export',percent:null,message:'正在压缩存档'},true);await work;await backups.verify(path.join(backup.directory,'world'),backup.files,signal);signal.throwIfAborted();await rename(temp,destination);return {saved:true,backupId:backup.id};}catch(error){zip.outputStream.destroy(error);await work.catch(()=>{});throw error;}finally{await rm(temp,{force:true}).catch(()=>{});}
});}
