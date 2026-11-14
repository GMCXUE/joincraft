// The hosted home receives a small, path- and credential-free launcher view.
export class LauncherHome {
  constructor(options) { Object.assign(this, options); this.pending=false; }
  instances() { return [...this.library.values()].filter(item=>item.managed); }
  selected() { return this.instances().find(item=>item.id===this.getSelected()) || this.instances().find(item=>item.id===this.prefs.homeInstance) || this.instances()[0]; }
  owned(id) { const item=this.library.get(id); if(!item?.managed)throw Error('请选择已安装的 Joincraft 整合包'); return item; }
  assertIdle() { if(this.pending||this.packBusy()||this.gamePlay.active||this.launcher.states().some(run=>['checking','starting','running'].includes(run.state)))throw Error('请先结束当前游戏或任务'); }
  state() {
    const selected=this.selected(),saved=this.prefs.managedLaunchInputs?.[selected?.id],account=this.account.summary();
    const mode=saved?.accountMode==='microsoft'?'microsoft':'offline';
    const run=this.launcher.states().find(item=>['checking','starting','running'].includes(item.state))||this.launcher.states().find(item=>item.id===selected?.id);
    return {version:1,instances:this.instances().map(item=>({id:item.id,name:item.name,minecraft:item.minecraft||'',loader:item.loader||'',error:!!item.error})),selectedId:selected?.id||null,
      account:{mode,name:mode==='microsoft'?account.profile?.name||'':saved?.name||'',configured:account.configured,ready:mode==='microsoft'?!!account.profile:/^[A-Za-z0-9_]{3,16}$/.test(saved?.name||'')},
      busy:this.pending||this.packBusy()||!!this.gamePlay.active||['checking','starting','running'].includes(run?.state),run:run?{state:run.state,message:run.message}:null};
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
    const previous=this.prefs.managedLaunchInputs,previousId=this.prefs.homeInstance;
    this.prefs.managedLaunchInputs={...previous,[input.id]:{accountMode:input.accountMode,name:input.name.trim(),memoryMode:input.memoryMode,memoryMB:input.memoryMode==='auto'?4096:input.memoryMB,mode:'auto'}};
    this.prefs.homeInstance=input.id;
    try{await this.save();}catch(error){this.prefs.managedLaunchInputs=previous;this.prefs.homeInstance=previousId;throw error;}
    this.setSelected(input.id);this.changed();return this.state();
  }
  async start({id}={}) {
    this.assertIdle();const instance=this.owned(id),input=this.prefs.managedLaunchInputs?.[id];
    if(instance.error||!input||!this.launcher.javaPath&& !instance.javaPath||input.accountMode==='offline'&&!/^[A-Za-z0-9_]{3,16}$/.test(input.name||'')||input.accountMode==='microsoft'&&!this.account.summary().profile)return this.configure({id});
    this.assertCanLaunch();this.pending=true;this.changed();
    try{
      // Home launches to the game menu; opening a room remains an explicit room action.
      if(this.gamePlay.context)this.gamePlay.clear();
      this.setSelected(id);if(instance.javaPath)this.launcher.javaPath=instance.javaPath;
      const {accountMode,name,memoryMode,memoryMB}=input;
      await this.launcher.start({id,accountMode,name,memoryMode,memoryMB,mode:'auto'});return {started:true};
    }finally{this.pending=false;this.changed();}
  }
}
