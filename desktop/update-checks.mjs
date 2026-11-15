// Checking a signed feed is safe during ordinary use; installation stays explicit.
export function scheduleUpdateChecks({updater,packaged,window,now=Date.now,setTimeoutFn=setTimeout,setIntervalFn=setInterval,clearTimeoutFn=clearTimeout,clearIntervalFn=clearInterval}){
 let stopped=false,lastAttempt=null;
 const check=async()=>{
  if(stopped||!packaged)return;
  const state=updater.state();
  if(['unsupported','checking','downloading','cancelling','downloaded','confirming','installing'].includes(state.phase))return;
  if(lastAttempt!==null&&now()-lastAttempt<60000)return;
  lastAttempt=now();await updater.check();
 };
 const background=()=>{void check().catch(()=>{});};
 if(!packaged)return {check,dispose(){stopped=true;}};
 const initial=setTimeoutFn(background,3000),periodic=setIntervalFn(background,5*60*1000);initial.unref?.();periodic.unref?.();
 window.on('focus',background);
 return {check,dispose(){stopped=true;clearTimeoutFn(initial);clearIntervalFn(periodic);window.removeListener('focus',background);}};
}
