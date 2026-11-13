import path from 'node:path';
import {lstat,realpath,readFile,opendir} from 'node:fs/promises';
import {parseLevelData,MAX_LEVEL_BYTES} from './level-data.mjs';
const within=(root,file)=>file.startsWith(root+path.sep);
export class ManagedWorlds {
  constructor({getInstance,maxWorlds=128}={}){this.getInstance=getInstance;this.maxWorlds=maxWorlds;}
  async instance(id){const instance=await this.getInstance(id);if(!instance?.managed)throw Error('仅支持 Joincraft 管理的实例');return instance;}
  async root(id){
    const instance=await this.instance(id),info=await lstat(instance.root);if(!info.isDirectory()||info.isSymbolicLink())throw Error('实例目录不能指向外部链接');
    const root=await realpath(instance.root),saves=path.join(root,'saves'),saved=await lstat(saves).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if(saved&&(!saved.isDirectory()||saved.isSymbolicLink()))throw Error('存档目录不能指向外部链接');return {instance,root,saves,exists:!!saved};
  }
  async folder(instanceId,worldId){
    if(typeof worldId!=='string'||!/^[A-Za-z0-9_-]{1,400}$/.test(worldId))throw Error('存档标识无效');
    const name=Buffer.from(worldId,'base64url').toString('utf8');if(!name||name==='.'||name==='..'||/[\\/\x00-\x1f]/.test(name)||Buffer.from(name).toString('base64url')!==worldId)throw Error('存档标识无效');
    const context=await this.root(instanceId),directory=path.join(context.saves,name),info=await lstat(directory);if(!info.isDirectory()||info.isSymbolicLink()||!within(context.saves,await realpath(directory)))throw Error('存档目录不受支持');
    return {...context,name,directory};
  }
  async metadata(directory,name){
    let firstError,found=false;
    for(const source of ['level.dat','level.dat_old']){
      try{const file=path.join(directory,source),info=await lstat(file);found=true;if(!info.isFile()||info.isSymbolicLink()||info.size>MAX_LEVEL_BYTES)throw Error('存档信息文件不受支持');const data=await parseLevelData(await readFile(file));return {...data,name:data.name||name,source,readable:source==='level.dat',warning:source==='level.dat_old'?'主信息损坏，显示备份信息':null};}
      catch(error){if(error.code!=='ENOENT')firstError ||= error;}
    }
    if(!found&&!firstError)return null;return {name,readable:false,warning:firstError?.message||'无法读取存档信息',version:null,lastPlayed:null};
  }
  async icon(directory){
    try{const file=path.join(directory,'icon.png'),info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size>128*1024)return null;const bytes=await readFile(file);if(bytes.length<24||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.readUInt32BE(16)>512||bytes.readUInt32BE(20)>512)return null;return 'data:image/png;base64,'+bytes.toString('base64');}catch{return null;}
  }
  async list(instanceId){
    const context=await this.root(instanceId);if(!context.exists)return {worlds:[],truncated:false};const worlds=[];let inspected=0,truncated=false;
    for await(const entry of await opendir(context.saves)){
      if(++inspected>1024||worlds.length>=this.maxWorlds){truncated=true;break;}if(!entry.isDirectory()||entry.isSymbolicLink())continue;
      const directory=path.join(context.saves,entry.name),metadata=await this.metadata(directory,entry.name);if(!metadata)continue;
      worlds.push({id:Buffer.from(entry.name).toString('base64url'),folder:entry.name,...metadata,icon:await this.icon(directory)});
    }
    worlds.sort((a,b)=>(b.lastPlayed||0)-(a.lastPlayed||0)||a.name.localeCompare(b.name));return {worlds,truncated};
  }
  async resolve(instanceId,worldId){const context=await this.folder(instanceId,worldId),metadata=await this.metadata(context.directory,context.name);if(!metadata?.readable)throw Error('存档信息不可用，请先在游戏中恢复备份');return {...context,metadata};}
}
