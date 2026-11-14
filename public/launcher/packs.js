import {renderInstallProgress} from '../pack-progress.js';
export function mountPackInstaller({api,onBusy,onInstalled,onError,renderProgress=renderInstallProgress,document:doc=globalThis.document}){
  let state={state:'idle'},pending=false,revision=0;
  const syncBusy=()=>onBusy(pending||['installing','cancelling'].includes(state.state));
  const render=()=>renderProgress(doc.querySelector('#pack-install-progress'),state,{cancel:()=>api.cancelPack().catch(onError),retry:!state.operation||state.operation==='install'?()=>run(()=>api.retryPack()):undefined});
  const run=async action=>{if(pending)return;pending=true;syncBusy();try{const result=await action();if(result)await onInstalled(result);}catch(error){onError(error);}finally{pending=false;syncBusy();}};
  doc.querySelector('#import-pack').onclick=()=>run(()=>api.importPack());
  doc.querySelector('#empty-install').onclick=()=>run(()=>api.importPack());
  api.onEvent(event=>{if(event.type==='pack-install'){revision++;state=event;render();syncBusy();}});
  const initialRevision=revision;api.installState().then(value=>{if(revision!==initialRevision)return;state=value;render();syncBusy();}).catch(onError);
  return {render};
}
