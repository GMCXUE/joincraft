import path from 'node:path';
import {lstat,realpath} from 'node:fs/promises';
import {scanMods} from './mod-metadata.mjs';
export class ManagedMods {
 constructor({getInstance,notify=()=>{}}){Object.assign(this,{getInstance,notify});this.cache=new Map();}
 async instance(id){const instance=await this.getInstance(id);if(!instance?.managed)throw Error('仅支持 Joincraft 管理的实例');const info=await lstat(instance.root);if(!info.isDirectory()||info.isSymbolicLink())throw Error('实例目录不能指向外部链接');return {...instance,root:await realpath(instance.root)};}
 async list({id}){const instance=await this.instance(id),files=await scanMods(instance.root);this.cache.set(id,files);return {id,files,editable:!!instance.editable,origin:instance.origin||null};}
}
