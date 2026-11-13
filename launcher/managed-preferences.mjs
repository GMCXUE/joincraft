import path from 'node:path';
export function managedPreferences(value,{platform=process.platform}={}){
  const next={...value},p=platform==='win32'?path.win32:path.posix;
  const normalize=file=>platform==='win32'?p.resolve(file).toLowerCase():p.resolve(file);
  const within=(file,base)=>file===base||file.startsWith(base+p.sep);
  const owned=[value.managedRoot,...(value.managedRoots||[])].filter(item=>typeof item==='string'&&p.isAbsolute(item)).map(normalize);
  const old=[value.root,value.selectedRoot].filter(item=>typeof item==='string'&&p.isAbsolute(item));
  const legacy=old.flatMap(item=>[item,...(p.basename(item).toLowerCase()==='.minecraft'?[p.dirname(item)]:[])]).map(normalize);
  if(typeof value.javaPath==='string'&&p.isAbsolute(value.javaPath)){
    const java=normalize(value.javaPath);if(!owned.some(base=>within(java,base))&&legacy.some(base=>within(java,base)))next.javaPath=null;
  }
  delete next.root;delete next.selectedRoot;return next;
}
