// Returning is navigation, independent of launch/installation form validity or busy state.
export function createLibraryReturn({api,read,remember=()=>{},onError=()=>{},onBusy=()=>{}}){
 let pending=false;
 return async()=>{
  if(pending)return;pending=true;onBusy(true);
  let input;try{remember();input=read();}catch{/* Partial forms must not trap the player here. */}
  try{if(api.returnHome)await api.returnHome(input);else await api.rooms();}
  catch(error){onError(error);}
  finally{pending=false;onBusy(false);}
 };
}
