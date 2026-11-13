import {renderInstallProgress} from '../pack-progress.js';
export function mountPackInstaller({api,onBusy,onInstalled,onError}){
  let state={state:'idle'},pending=false;
  const render=()=>renderInstallProgress(document.querySelector('#pack-install-progress'),state,{cancel:()=>api.cancelPack().catch(onError),retry:()=>run(()=>api.retryPack())});
  const run=async action=>{if(pending)return;pending=true;onBusy(true);try{const result=await action();if(result)await onInstalled(result);}catch(error){onError(error);}finally{pending=false;onBusy(false);}};
  document.querySelector('#import-pack').onclick=()=>run(()=>api.importPack());
  document.querySelector('#empty-install').onclick=()=>run(()=>api.importPack());
  api.onEvent(event=>{if(event.type==='pack-install'){state=event;render();onBusy(['installing','cancelling'].includes(event.state));}});
  api.installState().then(value=>{state=value;render();}).catch(onError);
  return {render};
}
