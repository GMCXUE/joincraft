import {Modrinth} from './modrinth.mjs';
import path from 'node:path';
import {lstat,realpath} from 'node:fs/promises';
import {copyEditable} from './instance-copy.mjs';
import {modTransaction,recoverMods,modHistory,rollbackMod,readModState} from './mod-transactions.mjs';
import {inspectMod,fileHash} from './mod-metadata.mjs';
import {scanMods} from './mod-metadata.mjs';
export class ManagedMods {
 constructor({getInstance,notify=()=>{},assertIdle=()=>{},changed=async()=>{}}){Object.assign(this,{getInstance,notify,assertIdle,changed});this.cache=new Map();this.provider=new Modrinth();}
 async instance(id){const instance=await this.getInstance(id);if(!instance?.managed)throw Error('仅支持 Joincraft 管理的实例');const info=await lstat(instance.root);if(!info.isDirectory()||info.isSymbolicLink())throw Error('实例目录不能指向外部链接');return {...instance,root:await realpath(instance.root)};}
 async exclusive(fn){if(this.busy)throw Error('已有模组任务正在进行');this.assertIdle();this.busy=true;this.controller=new AbortController();this.notify({type:'mods-progress',state:'working'});try{const value=await fn(this.controller.signal);this.notify({type:'mods-progress',state:'done'});return value;}catch(error){this.notify({type:'mods-progress',state:this.controller.signal.aborted?'cancelled':'failed',message:error.message});throw error;}finally{this.busy=false;}}
 async editable(id,signal){const instance=await this.instance(id);if(instance.editable)return instance;const copy=await copyEditable(instance,{signal,onProgress:p=>this.notify({type:'mods-progress',id,state:'copying',...p})});return copy;}
 async fork({id}){return this.exclusive(async signal=>{const copy=await this.editable(id,signal);await this.changed(copy.id);return copy;});}
 cancel(){this.controller?.abort(Error('模组操作已取消'));}
 async search(input){return this.provider.search(input,await this.instance(input.id));}
 async versions(input){return this.provider.versions(input.projectId,await this.instance(input.id));}
 async prepareLaunch(id){if(this.busy)throw Error('请先结束模组任务');await recoverMods(await this.instance(id));}
 async history({id}){if(this.busy)throw Error('请先结束模组任务');return modHistory(await this.instance(id));}
 async restore({id,backupId}){return this.exclusive(async signal=>{const instance=await this.editable(id,signal);await rollbackMod(instance,backupId,{signal});await this.changed(instance.id);return {id:instance.id};});}
 async apply({id,action,fileIds=[],imports=[]}){return this.exclusive(async signal=>{
  if(!['enable','disable','remove','import'].includes(action))throw Error('模组操作无效');const original=await this.instance(id);await recoverMods(original);const files=await scanMods(original.root,{signal}),chosen=files.filter(f=>fileIds.includes(f.fileId));if(action!=='import'&&(!chosen.length||chosen.length!==new Set(fileIds).size))throw Error('请选择有效模组');
  const instance=await this.editable(id,signal),remove=[],put=[],expected={};
  for(const f of chosen){if(!f.sha512){if(action!=='remove')throw Error('损坏文件只能移除，请重新导入');f.sha512=await fileHash(path.join(original.root,'mods',f.fileName),{signal});}if(action==='enable'&&f.enabled||action==='disable'&&!f.enabled)continue;remove.push(f.fileName);expected[f.fileName]=f.sha512;if(action!=='remove')put.push({name:action==='enable'?f.fileName.slice(0,-9):f.fileName+'.disabled',source:path.join(instance.root,'mods',f.fileName),sha512:f.sha512});}
  if(action==='import'){if(!imports.length||imports.length>128)throw Error('每次请选择 1 至 128 个 JAR');for(const source of imports){const info=await inspectMod(source,{signal});if(info.status!=='ready')throw Error('无法识别模组：'+path.basename(source));put.push({name:path.basename(source),source,sha512:info.sha512});}}
  await modTransaction(instance,{remove,put,expected,label:({enable:'启用模组',disable:'停用模组',remove:'移除模组',import:'导入模组'})[action]},{signal});await this.changed(instance.id);return {id:instance.id};
 });}
 async list({id}){if(this.busy)throw Error('请先结束模组任务');const instance=await this.instance(id),files=await (recoverMods(instance).then(()=>scanMods(instance.root)));const state=await readModState(instance);for(const f of files)f.locked=state.pins.includes(f.sha512);this.cache.set(id,files);return {id,files,state,editable:!!instance.editable,origin:instance.origin||null};}
}
