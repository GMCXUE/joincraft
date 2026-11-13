import {clientFetch} from './http.mjs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,readdir,rm,stat,chmod,symlink,statfs,copyFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {Version,getPlatform} from '@xmcl/core';
import {installFabric,installQuiltVersion} from '@xmcl/installer';
import {loaderInstallTask,loaderErrorMessage,loaderErrorFile} from './installer-compat.mjs';
import {inspectMrpack,extractMrpackOverrides,archiveHash,packSummary,packURL,destination} from '../shared/pack-format.mjs';
import {safePart,inside,resolveInstance} from './library.mjs';
import {probeJava,validateFiles} from './launch.mjs';
import {InstallProgress} from './install-progress.mjs';
import {registerInstance} from './instance-registration.mjs';
import {loaderProgress} from './loader-progress.mjs';
import {downloadFile,downloadMany,fetchJSON,validDownload,localResourceFiles} from './pack-download.mjs';

const RUNTIME_INDEX='https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';
export class ManagedPacks {
  constructor({root,roots=[],notify=()=>{},javaCandidates=async()=>[],resourceRoots=async()=>[],probe=probeJava,platform=getPlatform(),fetchImpl=clientFetch,gatewayOrigin,engine}={}){
    Object.assign(this,{root:path.resolve(root),roots:[...new Set([path.resolve(root),...roots.map(p=>path.resolve(p))])],notify,javaCandidates,resourceRoots,probe,platform,fetchImpl,gatewayOrigin,engine});this.progress=new InstallProgress(notify);this.busy=false;
  }
  state(){return {...this.progress.state(),root:this.root};}
  async list(){
    const result=[];
    for(const base of this.roots){
      for(const folder of await readdir(path.join(base,'instances')).catch(()=>[])){
        if(!/^[a-f0-9-]{36}$/.test(folder))continue;
        try{
          const dir=path.join(base,'instances',folder),record=JSON.parse(await readFile(path.join(dir,'instance.json'),'utf8'));
          if(record.schema!==1||record.id!=='managed-'+folder||!record.pack?.sha512?.match(/^[a-f0-9]{128}$/))continue;
          safePart(record.version);
          result.push({...record,root:path.join(dir,'.minecraft'),managed:true,name:record.pack.name+' · '+record.pack.versionId,minecraft:record.pack.minecraft,loader:record.pack.loader,isolation:{mode:'shared',source:'joincraft 独立实例'}});
        }catch{/* A staging or damaged registration must not become launchable. */}
      }
    }return result.sort((a,b)=>b.createdAt-a.createdAt);
  }
  async matching(sha512,{signal}={}){
    signal?.throwIfAborted();
    if(typeof sha512!=='string'||!/^[a-f0-9]{128}$/.test(sha512))throw Error('整合包标识无效');
    let changed;
    for(const instance of (await this.list()).filter(item=>item.pack.sha512===sha512)){
      signal?.throwIfAborted();let valid=true;
      for(const entry of instance.lock||[]){if(!await validDownload(destination(instance.root,entry.path),{hash:entry.sha512,signal})){valid=false;break;}}
      // Extra mods change the environment even if all pinned files are still present.
      const expected=new Set((instance.lock||[]).filter(e=>e.path.startsWith('mods/')).map(e=>e.path.slice(5).toLowerCase()));
      for(const name of await readdir(path.join(instance.root,'mods')).catch(()=>[]))if(name.toLowerCase().endsWith('.jar')&&!expected.has(name.toLowerCase()))valid=false;
      if(valid)try{await validateFiles(instance.root,(await resolveInstance(instance,this.platform)).version,{signal});}catch(error){if(signal?.aborted)throw signal.reason;valid=false;}
      signal?.throwIfAborted();if(valid)return {status:'ready',instance};changed=instance;
    }
    return changed?{status:'changed',instance:changed}:{status:'missing'};
  }
  cancel(){if(this.busy){this.progress.end('cancelling','正在取消安装');this.controller.abort(Error('安装已取消'));}}
  async install(buffer,expectedHash){
    if(this.busy)throw Error('已有整合包正在安装，请等待完成或取消');
    this.busy=true;this.controller=new AbortController();const signal=this.controller.signal;
    let stage;this.progress.sha512=undefined;this.progress.begin('整合包');
    try{
      const pack=await inspectMrpack(buffer,{signal,onProgress:state=>this.progress.update(state.file,state.completed,state.total)});this.progress.name=pack.name;this.progress.sha512=pack.sha512;
      if(expectedHash&&pack.sha512!==expectedHash)throw Error('下载的整合包与房间版本不一致，请重新获取');
      signal.throwIfAborted();this.progress.phase('matching','检查已安装实例',1);
      const match=await this.matching(pack.sha512,{signal});signal.throwIfAborted();if(match.status==='ready'){this.progress.end('done','整合包已安装');return match.instance;}
      await mkdir(this.root,{recursive:true});const space=await statfs(this.root).catch(()=>null);
      if(space&&Number(space.bavail)*Number(space.bsize)<pack.totalBytes*2+pack.archiveSize*3+2*1024**3)throw Error('游戏目录可用空间不足，请更换安装目录');
      const uuid=randomUUID(),parent=path.join(this.root,'instances');await mkdir(parent,{recursive:true});
      stage=path.join(parent,uuid);const game=path.join(stage,'.minecraft');await mkdir(game,{recursive:true});
      const localRoots=[...await this.resourceRoots(),...(await this.list()).map(instance=>instance.root)];
      const context={signal,progress:this.progress,fetchImpl:this.fetchImpl,cacheDir:path.join(this.root,'cache'),localFiles:localResourceFiles(localRoots)};
      const installed=await (this.engine||this.installEnvironment.bind(this))(pack,game,context);
      signal.throwIfAborted();
      this.progress.phase('mods','下载模组',5,pack.files);
      await downloadMany(pack.files,game,{...context,checkURL:packURL});
      this.progress.phase('verify','解压配置与校验',6,pack.overrides.map(entry=>({path:entry.path,size:entry.size})));
      await extractMrpackOverrides(buffer,pack.overrides,game,{signal,onProgress:state=>this.progress.update(state.file,state.completed,state.total,{done:state.done})});
      const lock=[...pack.files.map(f=>({path:f.path,sha512:f.hashes.sha512})),...pack.overrides.filter(e=>/^(mods|config|defaultconfigs|scripts|kubejs)\//.test(e.path)).map(e=>({path:e.path,sha512:e.sha512}))];
      const packInfo=packSummary(pack),record={schema:1,id:'managed-'+uuid,pack:packInfo,version:installed.version,javaPath:installed.java.path,javaMajor:installed.java.major,lock,createdAt:Date.now()};
      await mkdir(path.join(game,'.joincraft'));await writeFile(path.join(game,'.joincraft','instance.json'),JSON.stringify({schema:1,version:record.version}));
      if(typeof buffer==='string')await copyFile(buffer,path.join(stage,'pack.mrpack'));else await writeFile(path.join(stage,'pack.mrpack'),buffer);
      if(await archiveHash(path.join(stage,'pack.mrpack'),{signal})!==pack.sha512)throw Error('整合包原文件已变化，请重新选择');
      this.progress.detail('登记游戏实例');
      await registerInstance(stage,record,{signal});stage=null;
      this.progress.end('done','安装完成，已加入游戏库');return (await this.list()).find(item=>item.id===record.id);
    }catch(error){const cancelled=signal.aborted;this.progress.end(cancelled?'cancelled':'failed',cancelled?'安装已取消':error.message||'安装失败，请重试');throw cancelled?Error('安装已取消'):error;}
    finally{if(stage)await rm(stage,{recursive:true,force:true}).catch(()=>{});this.busy=false;}
  }
  async runtime(meta,context){
    const major=meta.javaVersion?.majorVersion||8;
    for(const candidate of await this.javaCandidates()){
      if(candidate.major===major&&candidate.arch===this.platform.arch){try{const java=await this.probe(candidate.path);if(java.major===major&&java.arch===this.platform.arch)return java;}catch{}}
    }
    const component=meta.javaVersion?.component||'jre-legacy';safePart(component);
    const targetKey=this.platform.name==='windows'?'windows-'+this.platform.arch:this.platform.name==='osx'?(this.platform.arch==='arm64'?'mac-os-arm64':'mac-os'):this.platform.arch==='x64'?'linux':'linux-'+this.platform.arch;
    const runtimeRoot=path.join(this.root,'runtimes',targetKey,component),saved=path.join(runtimeRoot,'joincraft-runtime.json');
    try{const value=JSON.parse(await readFile(saved,'utf8')),java=await this.probe(inside(runtimeRoot,value.executable));if(java.major===major&&java.arch===this.platform.arch)return java;}catch{}
    this.progress.detail('Java '+major+' · 查询官方运行环境');
    const index=await fetchJSON(RUNTIME_INDEX,context),choice=index[targetKey]?.[component]?.[0];
    if(!choice)throw Error('该平台暂无可下载的 Java '+major+'，请先在游戏库中手动选择 Java 后重试');
    const indexPath=path.join(runtimeRoot,'manifest.json');
    await downloadFile({path:'Java / manifest.json',downloads:[choice.manifest.url],hashes:{sha1:choice.manifest.sha1},size:choice.manifest.size},indexPath,context);
    const manifest=JSON.parse(await readFile(indexPath,'utf8')),entries=[];
    for(const [relative,item] of Object.entries(manifest.files)){
      destination(runtimeRoot,relative);
      if(item.type==='file')entries.push({path:relative,downloads:[item.downloads.raw.url],hashes:{sha1:item.downloads.raw.sha1},size:item.downloads.raw.size});
    }
    this.progress.phase('java','下载 Java '+major,2,entries);await downloadMany(entries,runtimeRoot,context);
    for(const [relative,item] of Object.entries(manifest.files)){
      const file=destination(runtimeRoot,relative);if(item.type==='file'&&item.executable)await chmod(file,0o755);
      if(item.type==='directory')await mkdir(file,{recursive:true});
      if(item.type==='link'){
        const target=path.resolve(path.dirname(file),item.target);if(!target.startsWith(runtimeRoot+path.sep))throw Error('Java 运行环境链接超出安装目录');
        await mkdir(path.dirname(file),{recursive:true});await symlink(item.target,file).catch(error=>{if(error.code!=='EEXIST')throw error;});
      }
    }
    const executable=Object.keys(manifest.files).find(file=>file.endsWith(this.platform.name==='windows'?'bin/java.exe':'bin/java'));
    if(!executable)throw Error('Java 下载完成但未找到可执行文件');
    const java=await this.probe(destination(runtimeRoot,executable));if(java.major!==major||java.arch!==this.platform.arch)throw Error('下载的 Java 与游戏要求不匹配');
    await writeFile(saved,JSON.stringify({executable}));return java;
  }
  async dependencies(game,id,context,stage){
    const version=await Version.parse(game,id,this.platform),indexPath=path.join(game,'assets','indexes',version.assets+'.json');
    await downloadFile({path:'assets/indexes/'+version.assets+'.json',downloads:[version.assetIndex.url],hashes:{sha1:version.assetIndex.sha1},size:version.assetIndex.size},indexPath,context);
    const index=JSON.parse(await readFile(indexPath,'utf8'));if(!index.objects||index.map_to_resources)throw Error('该旧版资源布局暂不支持安装');
    const entries=version.libraries.map(lib=>{const relative='libraries/'+lib.download.path;inside(game,relative);return {path:relative,downloads:[lib.download.url],size:lib.download.size||undefined,hashes:{sha1:lib.download.sha1||undefined}};});
    for(const asset of Object.values(index.objects)){
      if(!/^[a-f0-9]{40}$/.test(asset.hash))throw Error('游戏资源校验信息无效');
      const relative=asset.hash.slice(0,2)+'/'+asset.hash;entries.push({path:'assets/objects/'+relative,downloads:['https://resources.download.minecraft.net/'+relative],hashes:{sha1:asset.hash},size:asset.size});
    }
    if(version.logging?.client){const file=version.logging.client.file;safePart(file.id);entries.push({path:'assets/log_configs/'+file.id,downloads:[file.url],hashes:{sha1:file.sha1},size:file.size});}
    const unique=[...new Map(entries.map(e=>[e.path,e])).values()];this.progress.phase(stage===3?'game':'loader-libraries',stage===3?'下载游戏资源与依赖':'下载加载器依赖',stage,unique);
    await downloadMany(unique,game,context);return version;
  }
  async runTask(task,context){
    context.signal.throwIfAborted();
    const cancel=()=>{void task.cancel(15000).catch(()=>{});};context.signal.addEventListener('abort',cancel,{once:true});
    try{return await task.startAndWait(loaderProgress(this.progress));}
    catch(error){if(context.signal.aborted)throw context.signal.reason;const file=loaderErrorFile(error);if(file)this.progress.detail(file);throw Error(loaderErrorMessage(error),{cause:error});}
    finally{context.signal.removeEventListener('abort',cancel);}
  }
  async installEnvironment(pack,game,context){
    const list=await fetchJSON('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',context),metadata=list.versions.find(v=>v.id===pack.minecraft);
    if(!metadata)throw Error('未找到 Minecraft '+pack.minecraft);
    const jsonPath=path.join(game,'versions',pack.minecraft,pack.minecraft+'.json');
    await downloadFile({path:'versions/'+pack.minecraft+'/'+pack.minecraft+'.json',downloads:[metadata.url],hashes:{sha1:metadata.sha1}},jsonPath,context);
    const meta=JSON.parse(await readFile(jsonPath,'utf8'));if(meta.id!==pack.minecraft)throw Error('游戏版本清单不一致');
    this.progress.phase('java','准备 Java',2);const java=await this.runtime(meta,context);context.signal.throwIfAborted();
    this.progress.phase('game','下载游戏本体',3);
    const jar=meta.downloads.client;await downloadFile({path:'versions/'+pack.minecraft+'/'+pack.minecraft+'.jar',downloads:[jar.url],hashes:{sha1:jar.sha1},size:jar.size},path.join(game,'versions',pack.minecraft,pack.minecraft+'.jar'),context);
    await this.dependencies(game,pack.minecraft,context,3);context.signal.throwIfAborted();
    this.progress.phase('loader','安装'+pack.loader,4);let id=pack.minecraft;
    const fetchImpl=(url,init)=>this.fetchImpl(url,{...init,signal:AbortSignal.any([context.signal,AbortSignal.timeout(30000)])});
    if(pack.loaderKey==='fabric-loader')id=await installFabric({minecraft:game,minecraftVersion:pack.minecraft,version:pack.loaderVersion,fetch:fetchImpl});
    if(pack.loaderKey==='quilt-loader')id=await installQuiltVersion({minecraft:game,minecraftVersion:pack.minecraft,version:pack.loaderVersion,fetch:fetchImpl});
    if(['forge','neoforge'].includes(pack.loaderKey))id=await this.runTask(loaderInstallTask(pack,game,{java:java.path,gatewayOrigin:this.gatewayOrigin,onFile:file=>this.progress.detail(file),spawn:(file,args)=>spawn(file,args,{shell:false,windowsHide:true})}),context);
    context.signal.throwIfAborted();safePart(id);
    const version=id===pack.minecraft?await Version.parse(game,id,this.platform):await this.dependencies(game,id,context,4);
    this.progress.detail('校验 Minecraft 文件');await validateFiles(game,version,{signal:context.signal});return {version:id,java};
  }
}
