import {CancellationToken} from 'builder-util-runtime';
import semver from 'semver';

const supported=new Set(['win32','darwin']);
export function updateError(error,stage){
 const message=String(error?.message||''),code=String(error?.code||'');
 if(/sha512|checksum|signature|code.?sign|ERR_UPDATER_INVALID_SIGNATURE/i.test(code+' '+message))return '更新包校验未通过，未安装。请稍后重新下载。';
 if(/portable client/i.test(message))return '请先从官网安装新版客户端，再重试更新。';
 if(/ENOSPC|disk space/i.test(code+' '+message))return '磁盘空间不足，请清理空间后重试。';
 if(/404|no published versions|ERR_UPDATER_NO_PUBLISHED_VERSIONS|ERR_UPDATER_CHANNEL_FILE_NOT_FOUND|ERR_UPDATER_LATEST_VERSION_NOT_FOUND/i.test(code+' '+message))return '暂未发布可用的更新包。';
 if(/EACCES|EPERM|permission|read.only/i.test(code+' '+message))return '没有写入权限，请将客户端安装到可写位置后重试。';
 return stage==='check'?'检查更新失败，请检查网络后重试。':stage==='install'?'更新未能完成，请重新下载后重试；原版本仍可使用。':'下载失败，请检查网络后重试。';
}
const notes=info=>(typeof info?.releaseNotes==='string'?info.releaseNotes:Array.isArray(info?.releaseNotes)?info.releaseNotes.map(n=>String(n.note||'')).join('\n\n'):'').slice(0,20000);
export class ClientUpdater {
 constructor({updater,currentVersion,packaged,platform=process.platform,notify=()=>{},gameBusy=()=>false,confirmInstall=async()=>false,beforeInstall=async()=>{},now=Date.now}){
  Object.assign(this,{updater,notify,gameBusy,confirmInstall,beforeInstall,now});this.operation=null;this.token=null;this.cancelRequested=false;
  this.value={currentVersion,phase:packaged&&supported.has(platform)?'idle':'unsupported',version:null,notes:'',percent:0,transferred:0,total:0,bytesPerSecond:0,lastChecked:null,error:'',errorStage:null,message:!packaged?'开发模式不下载更新，请使用安装版。':!supported.has(platform)?'当前平台暂不支持客户端更新。':''};
  updater.autoDownload=false;updater.autoInstallOnAppQuit=false;updater.allowPrerelease=false;updater.allowDowngrade=false;updater.autoRunAppAfterInstall=true;
  // Use electron-builder's packaged app-update.yml. Renderer cannot set a feed or executable path.
  this.listeners={
   'update-available':info=>{if(this.value.phase!=='checking')return;this.offer(info);},
   'update-not-available':()=>{if(this.value.phase==='checking')this.set({phase:'idle',version:null,notes:'',lastChecked:now()});},
   'download-progress':p=>{if(this.value.phase==='downloading')this.set({percent:Math.min(100,Math.max(0,Number(p.percent)||0)),transferred:Math.max(0,Number(p.transferred)||0),total:Math.max(0,Number(p.total)||0),bytesPerSecond:Math.max(0,Number(p.bytesPerSecond)||0)});},
   'update-downloaded':info=>{if(this.value.phase==='downloading'&&!this.cancelRequested&&info.version===this.value.version)this.set({phase:'downloaded',percent:100,error:'',errorStage:null});},
   // Library emits errors before rejecting its operation; the operation owns check/download state.
   error:error=>{if(this.value.phase==='installing')this.set({phase:'downloaded',error:updateError(error,'install'),errorStage:'install'});}
  };
  for(const [event,listener]of Object.entries(this.listeners))updater.on(event,listener);
 }
 state(){return {...this.value,gameRunning:this.gameBusy(),canInstall:this.value.phase==='downloaded'&&!this.gameBusy()&&!this.operation};}
 set(patch){Object.assign(this.value,patch);this.notify({type:'update',...this.state()});}
 offer(info){
  if(!semver.valid(info?.version)||!semver.gt(info.version,this.value.currentVersion)||semver.prerelease(info.version))throw new Error('Invalid stable update version');
  this.set({phase:'available',version:info.version,notes:notes(info),lastChecked:this.now(),error:'',errorStage:null});
 }
 async check(){
  if(this.value.phase==='unsupported'||this.operation||['downloaded','confirming','installing'].includes(this.value.phase))return this.state();
  this.set({phase:'checking',error:'',errorStage:null,percent:0});
  const job=(async()=>{try{const result=await this.updater.checkForUpdates();if(!result)throw new Error('No updater result');if(this.value.phase==='checking'){
   if(result.updateInfo&&semver.valid(result.updateInfo.version)&&semver.gt(result.updateInfo.version,this.value.currentVersion))this.offer(result.updateInfo);
   else this.set({phase:'idle',version:null,notes:'',lastChecked:this.now()});
  }}catch(e){this.set({phase:'error',error:updateError(e,'check'),errorStage:'check'});}})();
  this.operation=job;try{await job;}finally{this.operation=null;this.set({});}return this.state();
 }
 async download(){
  if(this.operation)return this.state();
  if(!(this.value.phase==='available'||this.value.phase==='error'&&this.value.errorStage==='download'))throw new Error('请先检查并选择可用更新');
  this.token=new CancellationToken();this.cancelRequested=false;this.set({phase:'downloading',percent:0,transferred:0,total:0,bytesPerSecond:0,error:'',errorStage:null});
  const job=(async()=>{try{await this.updater.downloadUpdate(this.token);if(this.cancelRequested)this.set({phase:'available',percent:0});else if(this.value.phase!=='downloaded')throw new Error('Download was not verified');}
   catch(e){if(this.cancelRequested)this.set({phase:'available',percent:0,error:'',errorStage:null});else this.set({phase:'error',error:updateError(e,'download'),errorStage:'download'});}})();
  this.operation=job;try{await job;}finally{this.operation=null;this.token=null;this.set({});}return this.state();
 }
 cancel(){if(this.value.phase==='downloading'&&this.token){this.cancelRequested=true;this.set({phase:'cancelling'});this.token.cancel();}return this.state();}
 installLocked(){return ['confirming','installing'].includes(this.value.phase);}
 assertCanLaunch(){if(this.installLocked())throw new Error('正在准备客户端更新，请完成或取消更新后再启动游戏');}
 async install(){
  if(this.operation||this.value.phase!=='downloaded')throw new Error('更新尚未下载完成');
  if(this.gameBusy())throw new Error('请先退出正在启动或运行的游戏，再更新客户端');
  this.set({phase:'confirming',error:'',errorStage:null});
  try{
   if(!await this.confirmInstall(this.value.version)){this.set({phase:'downloaded'});return this.state();}
   await this.beforeInstall();if(this.gameBusy())throw new Error('游戏正在运行');
   this.set({phase:'installing'});await this.updater.quitAndInstall(false,true);
  }catch(e){this.set({phase:'downloaded',error:updateError(e,'install'),errorStage:'install'});}
  return this.state();
 }
 dispose(){for(const [event,listener]of Object.entries(this.listeners))this.updater.removeListener(event,listener);this.token?.cancel();}
}
