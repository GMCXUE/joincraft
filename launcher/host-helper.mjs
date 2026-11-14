import path from 'node:path';
import {lstat,readFile,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
export const HELPER_COORDINATE='com.joincraft:host-helper:1.0.0';
export const HELPER_MAVEN_ROOT='.joincraft/components/maven';
const relative='com/joincraft/host-helper/1.0.0/host-helper-1.0.0.jar';
export function assertHostSupport(instance){if(!instance?.managed||instance.minecraft!=='1.20.1'||instance.loader!=='Forge')throw Error('自动开房目前支持 Joincraft 实例中的 Forge 1.20.1');}
export function assertWorldSupport(instance,world){if(instance.minecraft!=='1.20.1')throw Error('直接进入存档目前适配 Minecraft 1.20.1');if(world.snapshot||!Number.isInteger(world.dataVersion)||world.dataVersion>3465)throw Error('此存档版本较新或无法确认版本，请从游戏菜单检查后进入');}
async function privateDirectory(root,parts){let current=root;const base=await lstat(root);if(!base.isDirectory()||base.isSymbolicLink())throw Error('实例目录无效');for(const part of parts){current=path.join(current,part);try{await mkdir(current);}catch(error){if(error.code!=='EEXIST')throw error;}const info=await lstat(current);if(!info.isDirectory()||info.isSymbolicLink())throw Error('组件目录不能使用外部链接');}return current;}
export class HostHelper {
 constructor({resources,now=Date.now,timeout=20*60*1000,poll=500}={}){Object.assign(this,{resources,now,timeout,poll});}
 async prepare(instance,world,port){
  assertHostSupport(instance);assertWorldSupport(instance,world.metadata);
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('局域网端口应在 1024–65535 之间');
  const manifest=JSON.parse(await readFile(path.join(this.resources,'manifest.json'),'utf8'));
  if(manifest.schema!==1||manifest.coordinate!==HELPER_COORDINATE||manifest.file!=='host-helper-1.0.0.jar'||!Number.isInteger(manifest.size)||manifest.size<100||manifest.size>1024*1024||!/^[a-f0-9]{64}$/.test(manifest.sha256||''))throw Error('客户端辅助组件信息无效，请更新客户端');
  const bytes=await readFile(path.join(this.resources,manifest.file));
  if(bytes.length!==manifest.size||createHash('sha256').update(bytes).digest('hex')!==manifest.sha256)throw Error('客户端辅助组件校验失败，请重新安装客户端');
  const dir=await privateDirectory(instance.root,[...HELPER_MAVEN_ROOT.split('/'),...relative.split('/').slice(0,-1)]),target=path.join(dir,manifest.file);
  const existing=await lstat(target).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(existing?.isSymbolicLink()||existing&&!existing.isFile())throw Error('组件文件无效');
  if(!existing||createHash('sha256').update(await readFile(target)).digest('hex')!==manifest.sha256){const temp=target+'.'+randomUUID()+'.tmp';try{await writeFile(temp,bytes,{flag:'wx',mode:0o600});await rename(temp,target);}finally{await rm(temp,{force:true});}}
  const sessions=await privateDirectory(instance.root,['.joincraft','host-sessions']),request=path.join(sessions,randomUUID()+'.json'),status=request+'.status',nonce=randomBytes(32).toString('hex'),expiresAt=this.now()+this.timeout;
  await writeFile(request,JSON.stringify({schema:1,nonce,world:world.name,port,expiresAt}),{flag:'wx',mode:0o600});
  return {request,port,expiresAt,jvmArgs:['-Djoincraft.host.request='+request],gameArgs:['--fml.mods',HELPER_COORDINATE,'--fml.mavenRoots',HELPER_MAVEN_ROOT],
   cleanup:async()=>{await Promise.all([request,status,status+'.tmp'].map(file=>rm(file,{force:true})));},
   wait:async signal=>{for(;;){signal?.throwIfAborted();if(this.now()>expiresAt)throw Error('世界载入超时，可退出游戏后重试');try{const info=await lstat(status);if(!info.isFile()||info.isSymbolicLink()||info.size>4096)throw Error('辅助组件状态无效');const value=JSON.parse(await readFile(status,'utf8'));if(value.nonce!==nonce||value.port!==port||value.schema!==1)throw Error('辅助组件状态不匹配');if(value.state==='ready')return;if(value.state==='failed'||value.state==='cancelled')throw Error(value.message||'世界开放失败');}catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}try{await delay(this.poll,undefined,{signal});}catch(error){signal?.throwIfAborted();throw error;}}}
  };
 }
}
