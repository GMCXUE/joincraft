import {clientFetch} from '../launcher/http.mjs';
import {EventEmitter} from 'node:events';
import {createHash,verify,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,rename,rm,copyFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {Transform,Readable} from 'node:stream';
import {spawn} from 'node:child_process';
import path from 'node:path';
import semver from 'semver';
import config from './update-config.json' with {type:'json'};

const feed='https://www.joincraft.top/updates/';
export function verifyManifest(envelope,{publicKey=config.publicKey,currentVersion,arch='x64'}={}){
 if(typeof envelope?.payload!=='string'||envelope.payload.length>100000||typeof envelope.signature!=='string')throw Error('Invalid update manifest');
 const payload=Buffer.from(envelope.payload,'base64');
 if(!verify(null,payload,publicKey,Buffer.from(envelope.signature,'base64')))throw Error('Update signature invalid');
 const value=JSON.parse(payload);
 if(value.schema!==1||value.platform!=='win32'||value.arch!==arch||!semver.valid(value.version)||semver.prerelease(value.version)||currentVersion&&!semver.gt(value.version,currentVersion))throw Error('Invalid stable update version');
 if(value.file!==`joincraft-${value.version}-win-${arch}.zip`||!Number.isSafeInteger(value.size)||value.size<1||value.size>512*1024*1024||!/^[a-f0-9]{128}$/.test(value.sha512))throw Error('Invalid update artifact');
 return value;
}
async function jsonFile(file,value){const temp=file+'.tmp';await writeFile(temp,JSON.stringify(value),{mode:0o600});await rename(temp,file);}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export class BundleUpdater extends EventEmitter{
 constructor({app,currentVersion,arch=process.arch,fetcher=clientFetch,publicKey=config.publicKey,base=feed,spawnHelper=spawn,resourcesPath=process.resourcesPath,prepareTimeout=90000}){
  super();Object.assign(this,{app,currentVersion,arch,fetcher,publicKey,base,spawnHelper,resourcesPath,prepareTimeout});
  this.cache=path.join(app.getPath('userData'),'bundle-updates');
 }
 async checkForUpdates(){
  const response=await this.fetcher(this.base+`windows-${this.arch}.json`,{signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!response.ok)throw Error('Update feed unavailable');
  const chunks=[];let length=0;for await(const chunk of response.body){length+=chunk.length;if(length>150000)throw Error('Manifest too large');chunks.push(chunk);}
  const envelope=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  // An authenticated older/current release means no update, not an error.
  const info=verifyManifest(envelope,{publicKey:this.publicKey,arch:this.arch});
  if(!semver.gt(info.version,this.currentVersion)){this.emit('update-not-available');return {updateInfo:{version:this.currentVersion}};}
  this.info=info;this.envelope=envelope;this.emit('update-available',{version:info.version,releaseNotes:String(info.notes||'').slice(0,20000)});
  return {updateInfo:{version:info.version,releaseNotes:info.notes}};
 }
 async downloadUpdate(token){
  if(!this.info)throw Error('No update selected');
  // Only our marked, user-writable distribution supports directory replacement.
  const installRoot=path.dirname(this.app.getPath('exe'));
  const marker=JSON.parse(await readFile(path.join(installRoot,'joincraft-release.json'),'utf8'));
  if(marker.distribution!=='bundle'||marker.version!==this.currentVersion)throw Error('This installation requires the new portable client');
  await mkdir(this.cache,{recursive:true});const folder=path.join(this.cache,randomUUID());await mkdir(folder,{mode:0o700});
  const partial=path.join(folder,'update.zip.partial'),target=path.join(folder,'update.zip');
  const controller=new AbortController();const cancel=()=>controller.abort();token?.onCancel(cancel);
  const timeout=setTimeout(cancel,10*60*1000);timeout.unref();
  const hash=createHash('sha512');let transferred=0;const started=Date.now();
  try{
   const response=await this.fetcher(this.base+this.info.file,{signal:controller.signal,redirect:'error'});if(!response.ok)throw Error('Download failed');
   const counter=new Transform({transform:(chunk,encoding,next)=>{transferred+=chunk.length;if(transferred>this.info.size){next(Error('Update size mismatch'));return;}hash.update(chunk);this.emit('download-progress',{percent:transferred*100/this.info.size,transferred,total:this.info.size,bytesPerSecond:transferred*1000/Math.max(1,Date.now()-started)});next(null,chunk);}});
   await pipeline(Readable.fromWeb(response.body),counter,createWriteStream(partial,{flags:'wx',mode:0o600}),{signal:controller.signal});
   if(transferred!==this.info.size||hash.digest('hex')!==this.info.sha512)throw Error('Update checksum mismatch');
   await rename(partial,target);await jsonFile(path.join(folder,'manifest.json'),this.envelope);
   this.downloaded={folder,target,envelope:this.envelope};this.emit('update-downloaded',{version:this.info.version});return [target];
  }catch(error){await rm(folder,{recursive:true,force:true});throw error;}
  finally{clearTimeout(timeout);token?.removeListener?.('cancel',cancel);}
 }
 async quitAndInstall(){
  if(!this.downloaded)throw Error('Update not ready');
  const folder=path.join(this.cache,randomUUID());await mkdir(folder,{mode:0o700});
  await copyFile(this.downloaded.target,path.join(folder,'update.zip'));
  await jsonFile(path.join(folder,'manifest.json'),this.downloaded.envelope);
  const root=path.dirname(this.app.getPath('exe'));
  const helper=path.join(folder,'joincraft-update.exe');await copyFile(path.join(this.resourcesPath,'updater','joincraft-update.exe'),helper);
  const job={root,currentVersion:this.currentVersion,parentPid:process.pid,token:path.basename(folder),userData:this.app.getPath('userData')};
  await jsonFile(path.join(folder,'job.json'),job);await jsonFile(path.join(this.cache,'last-job.json'),{token:job.token});
  const child=this.spawnHelper(helper,[folder],{cwd:folder,detached:true,stdio:'ignore',windowsHide:true});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
  // The helper authenticates/extracts the package and checks write access BEFORE we quit.
  const deadline=Date.now()+this.prepareTimeout;
  while(Date.now()<deadline){
   const state=await readFile(path.join(folder,'status.json'),'utf8').then(JSON.parse).catch(()=>null);
   if(state?.phase==='ready'){this.app.quit();return;}
   if(state?.phase==='failed')throw Error(state.code||'Update helper failed');
   await pause(150);
  }
  // No permission elevation, process killing, installer fallback, or forced quit.
  await writeFile(path.join(folder,'abort'),'cancelled',{mode:0o600});
  throw Error('Update helper timed out');
 }
}
export async function acknowledgeBundle(app,currentVersion){
 const arg=process.argv.find(value=>value.startsWith('--joincraft-update='));if(!arg)return;
 const token=arg.split('=')[1];if(!/^[0-9a-f-]{36}$/.test(token))return;
 const folder=path.join(app.getPath('userData'),'bundle-updates',token);
 try{
  const job=JSON.parse(await readFile(path.join(folder,'job.json'),'utf8'));
  const envelope=JSON.parse(await readFile(path.join(folder,'manifest.json'),'utf8'));
  const info=verifyManifest(envelope);
  if(info.version!==currentVersion||path.resolve(job.root)!==path.dirname(app.getPath('exe'))||job.token!==token)return;
  await jsonFile(path.join(folder,'healthy.json'),{token,version:currentVersion});
 }catch{/* The helper retains the old bundle if startup cannot be confirmed. */}
}
export async function previousBundleResult(app){
 try{
  const cache=path.join(app.getPath('userData'),'bundle-updates');const {token}=JSON.parse(await readFile(path.join(cache,'last-job.json'),'utf8'));
  if(!/^[0-9a-f-]{36}$/.test(token))return '';
  const {phase}=JSON.parse(await readFile(path.join(cache,token,'status.json'),'utf8'));
  if(phase==='rolled-back')return '上次更新启动失败，已恢复原版本。';
  if(phase==='failed')return '上次更新未完成，原版本仍可使用。请重新下载后重试。';
  if(phase==='unconfirmed')return '上次更新尚未确认完成，旧版本备份已保留。';
 }catch{}
 return '';
}
