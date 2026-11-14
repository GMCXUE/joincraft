import {launchSettings} from '../launcher/launch-settings.mjs';
export async function returnToHome({showHome,remember,onSaveError=()=>{}},input){
  showHome();
  if(!input)return {returned:true};
  try{await remember(input);return {returned:true,settingsSaved:true};}
  catch{onSaveError();return {returned:true,settingsSaved:false};}
}

// The hosted home receives a small, path- and credential-free launcher view.
export class LauncherHome {
  constructor(options) { Object.assign(this, options); this.pending=false; }
  instances() { return [...this.library.values()].filter(item=>item.managed); }
  selected() { return this.instances().find(item=>item.id===this.getSelected()) || this.instances().find(item=>item.id===this.prefs.homeInstance) || this.instances()[0]; }
  owned(id) { const item=this.library.get(id); if(!item?.managed)throw Error('请选择已安装的 Joincraft 整合包'); return item; }
  assertIdle() { if(this.pending||this.packBusy()||this.gamePlay.active||this.launcher.states().some(run=>['checking','starting','running'].includes(run.state)))throw Error('请先结束当前游戏或任务'); }
  launchIdentity() {
    const saved=this.prefs.gameIdentity||this.prefs.managedLaunchInputs?.[this.selected()?.id]||{};
    return {accountMode:saved.accountMode==='microsoft'?'microsoft':'offline',name:typeof saved.name==='string'?saved.name:''};
  }
  setDeviceCode(event){this.deviceCode=/^[A-Z0-9 -]{4,16}$/.test(event.code||'')?event.code:null;this.changed();}
  async identity({mode,name}={}) {
    this.assertIdle();if(this.account.summary().busy)throw Error('请先完成当前登录');
    if(!['offline','microsoft'].includes(mode)||typeof name!=='string'||name.length>16||mode==='offline'&&!/^[A-Za-z0-9_]{3,16}$/.test(name))throw Error('玩家名需为 3–16 位字母、数字或下划线');
    if(mode==='microsoft'&&!this.account.summary().profile)throw Error('请先登录微软账号');
    const previous=this.prefs.gameIdentity;this.prefs.gameIdentity={accountMode:mode,name};
    try{await this.save();}catch(error){this.prefs.gameIdentity=previous;throw error;}
    this.identityChanged?.();this.changed();return this.state();
  }
  async login(){this.assertIdle();this.deviceCode=null;try{await this.account.login();await this.identity({mode:'microsoft',name:this.launchIdentity().name});return this.state();}finally{this.deviceCode=null;this.changed();}}
  async logout(){this.assertIdle();await this.account.logout();this.deviceCode=null;this.identityChanged?.();this.changed();return this.state();}
  state() {
    const selected=this.selected(),saved=this.prefs.managedLaunchInputs?.[selected?.id],account=this.account.summary();
    const identity=this.launchIdentity(),mode=identity.accountMode;
    const run=this.launcher.states().find(item=>['checking','starting','running'].includes(item.state))||this.launcher.states().find(item=>item.id===selected?.id);
    return {version:1,instances:this.instances().map(item=>({id:item.id,name:item.name,minecraft:item.minecraft||'',loader:item.loader||'',error:!!item.error})),selectedId:selected?.id||null,
      account:{mode,name:mode==='microsoft'?account.profile?.name||'':identity.name,offlineName:identity.name,configured:account.configured,profile:account.profile?{name:account.profile.name}:null,busy:account.busy,deviceCode:account.busy?this.deviceCode||null:null,ready:mode==='microsoft'?!!account.profile:/^[A-Za-z0-9_]{3,16}$/.test(identity.name)},
      busy:this.pending||!!account.busy||this.packBusy()||!!this.gamePlay.active||['checking','starting','running'].includes(run?.state),run:run?{state:run.state,message:run.message}:null};
  }
  async select({id}={}) { this.assertIdle(); const instance=this.owned(id),previous=this.prefs.homeInstance;this.prefs.homeInstance=id;try{await this.save();}catch(error){this.prefs.homeInstance=previous;throw error;}this.setSelected(instance.id);return this.state(); }
  async configure({id,accountMode}={}) {
    if(accountMode!==undefined&&!['offline','microsoft'].includes(accountMode))throw Error('启动账号类型无效');
    const instance=id?this.owned(id):this.selected();
    if(instance&&instance.id!==this.getSelected()){this.assertIdle();this.setSelected(instance.id);}
    await this.openSettings({id:instance?.id||null,accountMode});return {needsSetup:true};
  }
  async remember(input) {
    this.owned(input?.id);
    if(!['offline','microsoft'].includes(input.accountMode)||typeof input.name!=='string'||input.name.length>16||!['auto','custom'].includes(input.memoryMode)||input.memoryMode==='custom'&&(!Number.isInteger(input.memoryMB)||input.memoryMB<512||input.memoryMB>1048576))throw Error('启动设置无效');
    const previous=this.prefs.managedLaunchInputs,previousId=this.prefs.homeInstance,previousJava=this.prefs.managedJavaPaths;
    const identity=this.prefs.gameIdentity||{accountMode:input.accountMode,name:input.name.trim()},advanced=launchSettings(input);
    this.prefs.managedLaunchInputs={...previous,[input.id]:{...identity,...advanced,memoryMode:input.memoryMode,memoryMB:input.memoryMode==='auto'?4096:input.memoryMB,mode:'auto'}};
    this.prefs.homeInstance=input.id;
    if(this.launcher.javaPath)this.prefs.managedJavaPaths={...previousJava,[input.id]:this.launcher.javaPath};
    try{await this.save();}catch(error){this.prefs.managedLaunchInputs=previous;this.prefs.homeInstance=previousId;this.prefs.managedJavaPaths=previousJava;throw error;}
    this.setSelected(input.id);this.changed();return this.state();
  }
  async start({id}={}) {
    this.assertIdle();const instance=this.owned(id),input={memoryMode:'auto',memoryMB:4096,...this.prefs.managedLaunchInputs?.[id],...this.launchIdentity()};
    if(input.accountMode==='offline'&&!/^[A-Za-z0-9_]{3,16}$/.test(input.name)||input.accountMode==='microsoft'&&!this.account.summary().profile)return {needsIdentity:true};
    if(instance.error||!this.prefs.managedJavaPaths?.[id]&&!this.launcher.javaPath&&!instance.javaPath)return this.configure({id});
    this.assertCanLaunch();this.pending=true;this.changed();
    try{
      // Home launches to the game menu; opening a room remains an explicit room action.
      if(this.gamePlay.context)this.gamePlay.clear();
      this.setSelected(id);this.launcher.javaPath=this.prefs.managedJavaPaths?.[id]||instance.javaPath||this.launcher.javaPath;
      const {accountMode,name,memoryMode,memoryMB}=input;
      await this.launcher.start({id,accountMode,name,memoryMode,memoryMB,mode:'auto',...launchSettings(input)});return {started:true};
    }finally{this.pending=false;this.changed();}
  }
}
