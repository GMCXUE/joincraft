import {clientFetch} from './http.mjs';
import path from 'node:path';
import {mkdir,open,stat,rename,rm,copyFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';

export async function hashFile(file,algorithm='sha512',{signal}={}){
  signal?.throwIfAborted();
  const hash=createHash(algorithm);for await(const chunk of createReadStream(file,{signal}))hash.update(chunk);return hash.digest('hex');
}
export async function validDownload(file,{hash,algorithm='sha512',size,signal,allowEmpty=false}={}){
  try{signal?.throwIfAborted();const info=await stat(file);signal?.throwIfAborted();return info.isFile()&&(info.size>0||allowEmpty)&&(size===undefined||info.size===size)&&(!hash||(await hashFile(file,algorithm,{signal}))===hash);}catch(error){if(signal?.aborted)throw signal.reason;return false;}
}
export function officialURL(value){
  const url=new URL(value);if(url.protocol==='http:')url.protocol='https:';
  const hosts=['piston-meta.mojang.com','piston-data.mojang.com','launcher.mojang.com','launchermeta.mojang.com','resources.download.minecraft.net','libraries.minecraft.net','meta.fabricmc.net','maven.fabricmc.net','meta.quiltmc.org','maven.quiltmc.org','maven.minecraftforge.net','files.minecraftforge.net','maven.neoforged.net'];
  if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||!hosts.includes(url.hostname))throw Error('游戏依赖下载来源暂不支持：'+url.hostname);
  return url.href;
}
export async function fetchChecked(url,{fetchImpl=clientFetch,signal,checkURL=officialURL}={}){
  for(let redirects=0;redirects<6;redirects++){
    const safe=checkURL(url),response=await fetchImpl(safe,{redirect:'manual',signal});
    if([301,302,303,307,308].includes(response.status)){
      const next=response.headers.get('location');await response.body?.cancel();if(!next)throw Error('下载地址重定向无效');url=new URL(next,safe).href;continue;
    }
    if(!response.ok){await response.body?.cancel();throw Error('下载请求失败（'+response.status+'）');}return response;
  }throw Error('下载地址重定向过多');
}
export async function fetchJSON(url,{maxBytes=4*1024*1024,...options}={}){
  const response=await fetchChecked(url,{...options,signal:AbortSignal.any([...(options.signal?[options.signal]:[]),AbortSignal.timeout(30000)])});
  const chunks=[];let bytes=0;for await(const chunk of response.body){bytes+=chunk.length;if(bytes>maxBytes)throw Error('下载清单过大');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
// Only caller-approved game directories are searched. Group roots once so thousands of
// asset lookups do not repeatedly inspect unrelated PCL version/mod directories.
export function localResourceFiles(roots=[]){
  const known=[...new Set(roots.filter(root=>typeof root==='string'&&path.isAbsolute(root)).map(root=>path.resolve(root)))],groups=new Map();
  return async relative=>{
    const prefix=relative.split('/')[0];
    if(!/^(assets|libraries|versions|mods)$/.test(prefix))return [];
    if(!groups.has(prefix))groups.set(prefix,Promise.all(known.map(async root=>await stat(path.join(root,prefix)).then(info=>info.isDirectory(),()=>false)?root:null)).then(roots=>roots.filter(Boolean)));
    const files=(await groups.get(prefix)).map(root=>resourcePath(root,relative));
    // PCL may keep the vanilla client JAR under a merged instance's own name.
    // Its pinned digest must still match before any bytes are reused.
    if(/^versions\/[^/]+\/[^/]+\.jar$/.test(relative))for(const root of known)files.push(path.join(root,path.basename(root)+'.jar'));
    return [...new Set(files)];
  };
}
function resourcePath(root,relative){
  if(typeof relative!=='string'||!relative||relative.includes('\\')||relative.includes('\0')||relative.split('/').some(part=>!part||part==='.'||part==='..'||part.includes(':')))throw Error('游戏文件路径不合法');
  const target=path.resolve(root,relative);if(!target.startsWith(path.resolve(root)+path.sep))throw Error('游戏文件路径超出安装目录');return target;
}
async function copyVerified(source,target,verify,signal){
  if(!await stat(source).then(info=>info.isFile()&&(!verify.size||info.size===verify.size),()=>false))return false;
  const temporary=target+'.'+randomUUID()+'.part';
  try{
    signal?.throwIfAborted();await copyFile(source,temporary);signal?.throwIfAborted();
    if(!await validDownload(temporary,{...verify,signal}))return false;
    signal?.throwIfAborted();await rename(temporary,target);return true;
  }catch(error){if(signal?.aborted)throw signal.reason;if(['ENOENT','EACCES','EPERM','EBUSY'].includes(error.code))return false;throw error;}finally{await rm(temporary,{force:true}).catch(()=>{});}
}
export async function downloadFile(entry,target,{cacheDir,localFiles,progress,signal,fetchImpl=clientFetch,checkURL=officialURL,stallTimeoutMs=15000}={}){
  const algorithm=entry.hashes?.sha512?'sha512':'sha1',hash=entry.hashes?.[algorithm],verify={hash,algorithm,size:entry.size};
  if(hash&&!new RegExp(algorithm==='sha512'?'^[a-f0-9]{128}$':'^[a-f0-9]{40}$').test(hash))throw Error('下载文件校验信息无效');
  const report=(written,total,networkBytes=0,done=false,reused=false)=>progress?.update(entry.path,written,total,{networkBytes,done,reused});
  if(await validDownload(target,{...verify,signal})){const size=(await stat(target)).size;report(size,size,0,true,true);return;}
  const cached=hash&&cacheDir?path.join(cacheDir,algorithm,hash):null;
  await mkdir(path.dirname(target),{recursive:true});
  if(cached&&await copyVerified(cached,target,verify,signal)){const size=(await stat(target)).size;report(size,size,0,true,true);return;}
  if(hash&&localFiles)for(const source of await localFiles(entry.path)){
    if(await copyVerified(source,target,verify,signal)){
      if(cached){await mkdir(path.dirname(cached),{recursive:true});await copyVerified(target,cached,verify,signal);}
      const size=(await stat(target)).size;report(size,size,0,true,true);return;
    }
  }
  let lastError;
  for(let attempt=0;attempt<2;attempt++)for(const url of entry.downloads){
    signal?.throwIfAborted();const temp=target+'.'+randomUUID()+'.part';let handle,timer;
    const stall=new AbortController(),combined=AbortSignal.any([stall.signal,...(signal?[signal]:[])]);
    const touch=()=>{clearTimeout(timer);timer=setTimeout(()=>stall.abort(Error('下载长时间无响应')),stallTimeoutMs);timer.unref?.();};
    try{
      touch();const response=await fetchChecked(url,{fetchImpl,signal:combined,checkURL});
      const contentSize=Number(response.headers.get('content-length'))||undefined;
      if(entry.size&&contentSize&&entry.size!==contentSize){await response.body?.cancel();throw Error('文件大小与整合包清单不一致');}
      const total=entry.size||contentSize,hasher=createHash(algorithm);let written=0;handle=await open(temp,'wx');report(0,total);
      for await(const chunk of response.body){combined.throwIfAborted();touch();written+=chunk.length;if(written>(entry.size||2*1024**3))throw Error('下载文件超过预期大小');hasher.update(chunk);await handle.writeFile(chunk);report(written,total,chunk.length);}
      if(entry.size&&written!==entry.size)throw Error('文件下载不完整');if(hash&&hasher.digest('hex')!==hash)throw Error('文件校验失败');if(!written)throw Error('下载文件为空');
      await handle.close();handle=null;await rename(temp,target);
      if(cached){await mkdir(path.dirname(cached),{recursive:true});await copyVerified(target,cached,verify,signal);}
      report(written,written,0,true);return;
    }catch(error){if(signal?.aborted)throw signal.reason;lastError=error;report(0,entry.size);}
    finally{clearTimeout(timer);await handle?.close().catch(()=>{});await rm(temp,{force:true}).catch(()=>{});}
  }
  throw Error('下载失败：'+entry.path+'。'+(lastError?.message||'请检查网络后重试'));
}
export async function downloadMany(entries,root,options={}){
  const concurrency=options.concurrency??16;if(!Number.isInteger(concurrency)||concurrency<1||concurrency>32)throw Error('下载并发数须为 1–32');
  const queue=[...entries].sort((a,b)=>(b.size||0)-(a.size||0));
  let cursor=0;const abort=new AbortController(),signal=AbortSignal.any([abort.signal,...(options.signal?[options.signal]:[])]);
  const results=await Promise.allSettled(Array.from({length:Math.min(concurrency,queue.length)},async()=>{while(cursor<queue.length){signal.throwIfAborted();const item=queue[cursor++];try{await downloadFile(item,resourcePath(root,item.path),{...options,signal});}catch(error){abort.abort(error);throw error;}}}));
  const failure=results.find(r=>r.status==='rejected');if(failure)throw failure.reason;
}
