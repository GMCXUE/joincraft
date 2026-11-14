import path from 'node:path';
import {lstat,realpath} from 'node:fs/promises';
import {copyEditable} from './instance-copy.mjs';
import {scanMods} from './mod-metadata.mjs';
export class ManagedMods {
 constructor({getInstance,notify=()=>{},assertIdle=()=>{},changed=async()=>{}}){Object.assign(this,{getInstance,notify,assertIdle,changed});this.cache=new Map();}
 async instance(id){const instance=await this.getInstance(id);if(!instance?.managed)throw Error('仅支持 Joincraft 管理的实例');const info=await lstat(instance.root);if(!info.isDirectory()||info.isSymbolicLink())throw Error('实例目录不能指向外部链接');return {...instance,root:await realpath(instance.root)};}
 async exclusive(fn){if(this.busy)throw Error('已有模组任务正在进行');this.assertIdle();this.busy=true;this.controller=new AbortController();try{return await fn(this.controller.signal);}finally{this.busy=false;}}
 async editable(id,signal){const instance=await this.instance(id);if(instance.editable)return instance;const copy=await copyEditable(instance,{signal,onProgress:p=>this.notify({type:'mods-progress',id,state:'copying',...p})});await this.changed(copy.id);return copy;}
 async fork({id}){return this.exclusive(signal=>this.editable(id,signal));}
 async list({id}){const instance=await this.instance(id),files=await scanMods(instance.root);this.cache.set(id,files);return {id,files,editable:!!instance.editable,origin:instance.origin||null};}
}
