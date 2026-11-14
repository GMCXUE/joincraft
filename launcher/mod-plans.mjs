import {compatibleVersion} from './modrinth.mjs';
import {packURL,packPath} from '../shared/pack-format.mjs';
export function versionFile(version){const candidates=(version.files||[]).filter(f=>/\.jar$/i.test(f.filename||''));const f=candidates.find(f=>f.primary)||candidates[0];if(!f||!/^[a-f0-9]{128}$/i.test(f.hashes?.sha512||'')||!/^[a-f0-9]{40}$/i.test(f.hashes?.sha1||'')||!Number.isSafeInteger(f.size)||f.size<=0||f.size>1024**3)throw Error('模组文件缺少可信校验信息');packPath('mods/'+f.filename);if(f.filename.includes('/'))throw Error('模组文件名无效');const url=packURL(f.url);if(new URL(url).hostname!=='cdn.modrinth.com')throw Error('Modrinth 文件来源无效');return {path:'mods/'+f.filename,name:f.filename,size:f.size,hashes:{sha512:f.hashes.sha512.toLowerCase(),sha1:f.hashes.sha1.toLowerCase()},downloads:[url]};}
export async function resolveModPlan({provider,instance,files,versionIds,optionalIds=[],signal,known={},pins=[]}){
 const installed=new Map();for(const f of files){const v=known[f.sha512];if(v){const a=installed.get(v.project_id)||[];a.push({file:f,version:v});installed.set(v.project_id,a);}}
 const selected=new Map(),visiting=new Set(),optional=new Map(),conflicts=[],skipped=[];
 const hasConflict=d=>{if(d.version_id)return [...installed.values()].flat().some(x=>x.file.enabled&&x.version.id===d.version_id)||[...selected.values()].some(x=>x.version.id===d.version_id);return !!d.project_id&&((installed.get(d.project_id)||[]).some(x=>x.file.enabled)||selected.has(d.project_id));};
 async function visit(id,reason='选择安装'){
  signal?.throwIfAborted();if(visiting.has(id))throw Error('模组前置存在循环依赖');if([...selected.values()].some(x=>x.version.id===id))return;if(selected.size>256)throw Error('前置依赖数量过多');visiting.add(id);
  const version=await provider.version(id,{signal});if(!compatibleVersion(version,instance))throw Error('模组版本与当前 Minecraft 或加载器不兼容');const existing=selected.get(version.project_id);if(existing&&existing.version.id!==id)throw Error('不同模组要求同一前置的不同版本');const file=versionFile(version),local=installed.get(version.project_id)||[];
  if(local.some(x=>pins.includes(x.file.sha512)&&x.version.id!==id))throw Error('所需模组版本已锁定，请先解除锁定');
  selected.set(version.project_id,{version,file,reason,replace:local.filter(x=>x.file.sha512!==file.hashes.sha512||!x.file.enabled).map(x=>x.file)});
  for(const d of version.dependencies||[]){
   if(d.dependency_type==='embedded')continue;const projectId=d.project_id;
   if(d.dependency_type==='incompatible'){if(hasConflict(d))conflicts.push('冲突模组：'+(projectId||d.version_id));continue;}
   if(d.dependency_type==='optional'){const key=projectId||d.version_id;if(key)optional.set(key,{id:key,projectId,versionId:d.version_id,label:d.file_name||key});if(!optionalIds.includes(key))continue;}
   if(!['required','optional'].includes(d.dependency_type))continue;
   const localDep=installed.get(projectId)||[];if(localDep.some(x=>x.file.enabled&&(!d.version_id||x.version.id===d.version_id))){skipped.push(projectId);continue;}
   let depId=d.version_id;if(!depId){if(!projectId)throw Error('前置依赖缺少项目标识：'+(d.file_name||'未知'));const candidates=await provider.versions(projectId,instance,{signal});depId=candidates.find(v=>v.version_type==='release')?.id;if(!depId)throw Error('没有兼容的正式版前置：'+projectId);}
   await visit(depId,'必需前置');
  }
  visiting.delete(id);
 }
 for(const id of versionIds)await visit(id);
 // Recheck incompatibilities after the entire dependency closure has been selected.
 for(const item of selected.values())for(const d of item.version.dependencies||[])if(d.dependency_type==='incompatible'&&hasConflict(d))conflicts.push('冲突模组：'+(d.project_id||d.version_id));
 for(const item of selected.values())for(const d of item.version.dependencies||[])if(d.dependency_type==='required'&&d.project_id&&d.version_id&&selected.has(d.project_id)&&selected.get(d.project_id).version.id!==d.version_id)throw Error('所选模组要求前置的不同版本');
 const items=[...selected.values()].filter(x=>!files.some(f=>f.enabled&&f.sha512===x.file.hashes.sha512));const names=new Set();for(const item of items){if(names.has(item.file.name.toLowerCase()))throw Error('模组下载文件名重复');names.add(item.file.name.toLowerCase());const collision=files.find(f=>f.fileName.toLowerCase()===item.file.name.toLowerCase());if(collision&&!item.replace.some(f=>f.fileId===collision.fileId))conflicts.push('文件名冲突：'+collision.fileName);}
 if(items.reduce((n,i)=>n+i.file.size,0)>5*1024**3)throw Error('模组下载总量超过 5 GB');return {items,optional:[...optional.values()],conflicts:[...new Set(conflicts)],skipped:[...new Set(skipped)]};
}
