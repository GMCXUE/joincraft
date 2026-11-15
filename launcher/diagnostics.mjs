import path from 'node:path';
import {constants} from 'node:fs';
import {lstat,realpath,open,readdir} from 'node:fs/promises';
import {StringDecoder} from 'node:string_decoder';
import {isIP} from 'node:net';

const LIMIT=128*1024;
export function redactDiagnostic(value,secrets=[]){
 let text=String(value??'');
 for(const secret of secrets)if(typeof secret==='string'&&secret.length>5)text=text.split(secret).join('[凭据已隐藏]');
 return text.replace(/(^|\n)(\s*(?:Cookie|Set-Cookie|Authorization)\s*:)[^\r\n]*/gi,'$1$2 [已隐藏]')
  .replace(/(https?:\/\/)[^/\s@:]+:[^@\s]+@/gi,'$1[凭据已隐藏]@')
  .replace(/\bBearer\s+[^\s"'<>]+/gi,'Bearer [已隐藏]')
  .replace(/((?:--|["']?)(?:access[-_]?token|refresh[-_]?token|id[-_]?token|client[-_]?secret|password|token|authorization|cookie|x-session)["']?\s*(?:[=:]\s*|\s+))["']?[^\s,"'<>}]+["']?/gi,'$1[已隐藏]')
  .replace(/(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/gi,'$1?[参数已隐藏]')
  .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,'[凭据已隐藏]')
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[邮箱已隐藏]')
  .replace(/[A-Za-z]:[\\/]Users[\\/][^\\/\r\n"']+/gi,'C:\\Users\\[用户]')
  .replace(/\/(?:Users|home)\/[^/\r\n"']+/g,'/[用户目录]')
  .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g,ip=>ip.split('.').every(n=>Number(n)<=255)?'[IP 已隐藏]':ip)
  .replace(/[0-9a-f]*:[0-9a-f:]+/gi,ip=>isIP(ip)===6?'[IP 已隐藏]':ip)
  .replace(/\x1b\[[0-9;]*[A-Za-z]/g,'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
}
const rules=[
 ['java-version',/UnsupportedClassVersionError|compiled by a more recent version|此实例需要 Java|Java 架构需|Java 无法运行/i,'Java 运行环境不匹配','选择与整合包要求一致的 Java 版本和架构，再重新启动。'],
 ['memory',/OutOfMemoryError|Could not reserve enough space|insufficient memory|Native memory allocation.*failed|内存必须在/i,'游戏或系统内存不足','关闭占用内存较多的程序，并在启动设置中调整内存；分配过多也可能导致启动失败。'],
 ['missing-dependency',/Missing mandatory dependencies|Missing or unsupported mandatory dependencies|requires? (?:version|.*? which is missing)|depends on .*? which is missing|requires .*? (?:but|missing)|未安装.*前置/i,'可能缺少模组前置或版本不匹配','在模组管理中检查报错提到的前置模组与版本。使用整合包作者推荐的组合。'],
 ['duplicate-mod',/DuplicateModsFoundException|Duplicate (?:mods|mod id)|Found duplicate mods/i,'发现重复模组','在模组管理中检查重复的模组 ID，只保留适合当前整合包的版本。'],
 ['mod-conflict',/MixinApplyError|MixinTransformerError|InjectionError|ModLoadingException|Incompatible mod set|incompatible mods/i,'可能存在模组兼容问题','查看下方日志中提到的模组。可在编辑副本中逐项停用最近添加或更新的模组，避免直接改动房间版本。'],
 ['game-files',/游戏文件缺失或损坏|缺少或损坏资源索引|游戏资源索引格式错误|ClassNotFoundException|NoClassDefFoundError/i,'可能缺少游戏文件或依赖','先运行“检查文件”；若仍失败，重新安装对应房间版本，保留原实例和存档。'],
 ['network',/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|Connection refused|Connection timed out|UnknownHostException|连接已断开|房主.*(?:离线|未开房)|联机连接已断开|无法连接/i,'游戏连接未能建立或已中断','确认房主在线并已成功开房，再重新加入；直连失败时可在联机设置中尝试仅服务器中继。'],
 ['disk',/ENOSPC|No space left on device|磁盘空间不足/i,'磁盘空间不足','清理实例所在磁盘的可用空间后重试，保留存档及需要的备份。'],
 ['permission',/EACCES|EPERM|AccessDeniedException|Permission denied|另一个程序正在使用/i,'文件被占用或无法写入','退出游戏和占用文件的程序，检查目录写入权限；不要直接删除存档或关闭安全防护。'],
];
export function diagnoseSources(sources){
 const findings=[];
 for(const [id,pattern,title,suggestion]of rules){
  for(const source of sources){const line=source.text.split(/\r?\n/).find(line=>pattern.test(line));if(line){findings.push({id,title,suggestion,evidence:line.slice(0,500),source:source.name});break;}}
 }
 return findings;
}
async function tail(root,relative,since){
 const file=path.join(root,relative),parent=await lstat(path.dirname(file)).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
 if(!parent)return null;if(!parent.isDirectory()||parent.isSymbolicLink())throw Error('日志目录不能指向外部链接');
 const info=await lstat(file).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(!info)return null;
 if(!info.isFile()||info.isSymbolicLink()||!(await realpath(file)).startsWith(root+path.sep))throw Error('日志文件不能指向外部链接');
 if(since&&info.mtimeMs<since-1000)return null;
 const fd=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const current=await fd.stat();if(!current.isFile()||current.ino!==info.ino||current.dev!==info.dev)throw Error('日志文件读取期间发生变化');const offset=Math.max(0,current.size-LIMIT),buffer=Buffer.alloc(Math.min(current.size,LIMIT)),{bytesRead}=await fd.read(buffer,0,buffer.length,offset);let text=buffer.subarray(0,bytesRead).toString('utf8');if(offset>0)text=text.includes('\n')?text.slice(text.indexOf('\n')+1):'';return {name:relative.split(path.sep).join('/'),text,truncated:offset>0};}finally{await fd.close();}
}
export class GameDiagnostics{
 constructor({getInstance,now=Date.now}={}){Object.assign(this,{getInstance,now});this.records=new Map();}
 begin(id){const record={startedAt:this.now(),output:'',decoders:new Map(),secrets:[],error:'',exitCode:null,signal:null};this.records.delete(id);this.records.set(id,record);if(this.records.size>32)this.records.delete(this.records.keys().next().value);return record;}
 capture(record,chunk,source='stdout'){if(!record.decoders.has(source))record.decoders.set(source,new StringDecoder('utf8'));record.output+=record.decoders.get(source).write(Buffer.isBuffer(chunk)?chunk:Buffer.from(String(chunk)));if(record.output.length>LIMIT){record.output=record.output.slice(-LIMIT);record.output=record.output.includes('\n')?record.output.slice(record.output.indexOf('\n')+1):'';record.truncated=true;}}
 failed(id,error){const record=this.records.get(id)||this.begin(id);record.error=String(error?.message||error||'操作失败').slice(0,LIMIT);record.failedAt=this.now();}
 async context(id){const instance=await this.getInstance(id);if(!instance?.managed)throw Error('仅支持 Joincraft 管理的实例');const info=await lstat(instance.root);if(!info.isDirectory()||info.isSymbolicLink())throw Error('实例目录不能指向外部链接');return {...instance,root:await realpath(instance.root)};}
 async read({id}){
  const instance=await this.context(id),record=this.records.get(id),sources=[],warnings=[];
  if(record?.error)sources.push({name:'本次操作',text:record.error});
  if(record?.output)sources.push({name:'本次启动输出',text:record.output,truncated:!!record.truncated});
  for(const relative of ['logs/latest.log','logs/debug.log'])try{const source=await tail(instance.root,relative,record?.startedAt);if(source)sources.push(source);}catch{warnings.push('未能安全读取 '+relative+'，已跳过。');}
  const crashDir=path.join(instance.root,'crash-reports'),crashes=[];
  try{const info=await lstat(crashDir);if(!info.isDirectory()||info.isSymbolicLink())throw Error();const entries=await readdir(crashDir,{withFileTypes:true});for(const entry of entries.slice(0,256))if(entry.isFile()&&/^crash-[^/\\]+\.txt$/i.test(entry.name)){const file=await lstat(path.join(crashDir,entry.name));if(!record||file.mtimeMs>=record.startedAt-1000)crashes.push({name:entry.name,at:file.mtimeMs});}for(const entry of crashes.sort((a,b)=>b.at-a.at).slice(0,2)){const source=await tail(instance.root,path.join('crash-reports',entry.name),record?.startedAt);if(source)sources.push(source);}}catch(e){if(e.code!=='ENOENT')warnings.push('未能安全读取崩溃报告，已跳过。');}
  const safe=sources.map(s=>({...s,text:redactDiagnostic(s.text,record?.secrets),name:redactDiagnostic(s.name)}));
  const findings=diagnoseSources(safe),failed=!!record?.error||record?.exitCode!==null&&record?.exitCode!==undefined&&record.exitCode!==0||!!record?.signal;
  return {schema:1,generatedAt:this.now(),instance:{id:instance.id,name:redactDiagnostic(instance.name),minecraft:instance.minecraft,loader:instance.loader},lastRun:record?{startedAt:record.startedAt,exitCode:record.exitCode,signal:record.signal}:null,summary:findings.length?`发现 ${findings.length} 项可能的问题`:failed?'尚未识别出明确原因，可导出诊断日志继续排查':safe.length?'未发现已知错误特征；这不代表游戏或连接一定正常':'尚无可分析的日志，请在启动或连接失败后检查',findings,sources:safe,warnings};
 }
}
