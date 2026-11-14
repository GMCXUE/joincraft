import {scanMods} from './mod-metadata.mjs';
import {readModState,modTransaction,recoverMods} from './mod-transactions.mjs';
export class ModUpdates {
 constructor({mods,downloads}){Object.assign(this,{mods,downloads});}
 async check({id,fileIds=[]}){
  if(this.mods.busy)throw Error('请先结束模组任务');const instance=await this.mods.instance(id),all=await scanMods(instance.root),files=all.filter(f=>f.sha512&&(!fileIds.length||fileIds.includes(f.fileId))),state=await readModState(instance),known=await this.mods.provider.hashes(files.map(f=>f.sha512)),updates=[],unidentified=[];
  // Keep API traffic bounded for large packs and let the provider's cache serve repeated checks.
  let cursor=0;await Promise.all(Array.from({length:Math.min(3,files.length)},async()=>{while(cursor<files.length){const file=files[cursor++],current=known[file.sha512];if(!current){unidentified.push(file.fileName);continue;}if(state.pins.includes(file.sha512)||!file.enabled)continue;const versions=await this.mods.provider.versions(current.project_id,instance),latest=versions.find(v=>v.version_type==='release');if(!latest||latest.id===current.id||Date.parse(latest.date_published)<=Date.parse(current.date_published))continue;updates.push({fileId:file.fileId,fileName:file.fileName,name:file.name,projectId:current.project_id,current:current.version_number,version:latest.version_number,versionId:latest.id,changelog:String(latest.changelog||'').slice(0,10000)});}}));
  return {id,updates:updates.sort((a,b)=>a.name.localeCompare(b.name)),unidentified,pinned:files.filter(f=>state.pins.includes(f.sha512)).length};
 }
 async pin({id,fileIds,locked}){return this.mods.exclusive(async signal=>{const instance=await this.mods.instance(id);await recoverMods(instance);if(!Array.isArray(fileIds)||!fileIds.length||typeof locked!=='boolean')throw Error('请选择模组与锁定状态');const files=(await scanMods(instance.root,{signal})).filter(f=>fileIds.includes(f.fileId));if(files.length!==new Set(fileIds).size||files.some(f=>!f.sha512))throw Error('无法锁定所选模组');await modTransaction(instance,{label:locked?'锁定模组版本':'解除模组锁定',statePatch:state=>{const pins=new Set(state.pins);for(const f of files)locked?pins.add(f.sha512):pins.delete(f.sha512);state.pins=[...pins];return state;}},{signal});return {id,editable:!!instance.editable};});}
}
