import path from 'node:path';
import {lstat,readdir,mkdir,copyFile,writeFile,rm,statfs} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {readModState} from './mod-transactions.mjs';
import {registerInstance} from './instance-registration.mjs';
const roots=new Set(['assets','libraries','versions','mods','config','defaultconfigs','scripts','kubejs','resourcepacks','shaderpacks','patchouli_books','options.txt','optionsof.txt']);
export async function environmentFiles(root,{signal}={}){
 const files=[];async function walk(dir,prefix=''){for(const name of await readdir(dir)){signal?.throwIfAborted();if(!prefix&&!roots.has(name.toLowerCase()))continue;const rel=prefix?prefix+'/'+name:name;if(/(?:^|\/)(?:\.cache|cache|logs|mcef-cache|exported)(?:\/|$)/i.test(rel))continue;const file=path.join(dir,name),info=await lstat(file);if(info.isSymbolicLink())throw Error('游戏环境包含符号链接：'+rel);if(info.isDirectory())await walk(file,rel);else if(info.isFile())files.push({path:rel,size:info.size});}}await walk(root);return files;
}
export async function copyEditable(instance,{signal,onProgress=()=>{}}={}){
 const parent=path.dirname(path.dirname(instance.root)),uuid=randomUUID(),directory=path.join(parent,uuid),root=path.join(directory,'.minecraft');let registered=false;
 try{const files=await environmentFiles(instance.root,{signal}),total=files.reduce((n,f)=>n+f.size,0),space=await statfs(parent);if(Number(space.bavail)*Number(space.bsize)<total+128*1024**2)throw Error('磁盘空间不足，无法创建编辑副本');await mkdir(root,{recursive:true});let completed=0;for(const f of files){signal?.throwIfAborted();const target=path.join(root,f.path);await mkdir(path.dirname(target),{recursive:true});await copyFile(path.join(instance.root,f.path),target,constants.COPYFILE_FICLONE);completed+=f.size;onProgress({file:f.path,completed,total});}
 signal?.throwIfAborted();await copyFile(path.join(path.dirname(instance.root),'pack.mrpack'),path.join(directory,'pack.mrpack'));await mkdir(path.join(root,'.joincraft'));await writeFile(path.join(root,'.joincraft','instance.json'),JSON.stringify({schema:1,version:instance.version}));
 const modState=await readModState(instance);await writeFile(path.join(directory,'mods-state.json'),JSON.stringify({...modState,changes:[]}));
 const {root:_,name,managed,isolation,...metadata}=instance;const record={...metadata,schema:1,id:'managed-'+uuid,editable:true,origin:{instanceId:instance.id,sha512:instance.pack.sha512,name,createdAt:Date.now()},modChanges:[],createdAt:Date.now()};await registerInstance(directory,record,{signal});registered=true;return {...record,root,managed:true,name:name+' · 编辑副本'};
 }finally{if(!registered)await rm(directory,{recursive:true,force:true}).catch(()=>{});}
}
