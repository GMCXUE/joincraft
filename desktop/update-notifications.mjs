// Serialize claims across all windows and persist before acknowledging a reminder.
export class UpdateNotifications {
 constructor({lastVersion=null,saveVersion}){this.lastVersion=lastVersion;this.saveVersion=saveVersion;this.pending=Promise.resolve();}
 claim(state,canPresent=()=>true){
  const job=this.pending.then(async()=>{
   if(!canPresent()||!['available','downloaded'].includes(state.phase)||!state.version||state.version===this.lastVersion)return null;
   await this.saveVersion(state.version);this.lastVersion=state.version;return {version:state.version};
  });this.pending=job.catch(()=>{});return job;
 }
}
