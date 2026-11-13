import path from 'node:path';
import {open, stat, realpath} from 'node:fs/promises';

// PCL's LoginLegacyName is encrypted. Read only the explicit offline-login marker
// from its local logs; never import access tokens, passwords or an online identity.
export function offlineNamesFromLog(text) {
  return [...text.matchAll(/登录方式[：:]\s*离线[（(]([A-Za-z0-9_]{3,16})[）)]/g)].map(match => match[1]);
}
export async function readPclProfile({selected, root}) {
  const directories = [...new Set([selected, root, path.dirname(root)].filter(Boolean))];
  const candidates = [];
  for (const directory of directories) for (let n=1;n<=5;n++) {
    const file=path.join(directory,'PCL',`Log${n}.txt`);
    const info=await stat(file).catch(()=>null);
    if(info?.isFile())candidates.push({file,mtime:info.mtimeMs});
  }
  candidates.sort((a,b)=>b.mtime-a.mtime);
  const visited=new Set();
  for(const {file} of candidates){
    let handle;
    try{
      const canonical=await realpath(file);if(visited.has(canonical))continue;visited.add(canonical);
      handle=await open(file,'r');const info=await handle.stat();
      const size=Math.min(info.size,2*1024*1024),buffer=Buffer.alloc(size);
      const {bytesRead}=await handle.read(buffer,0,size,info.size-size);
      const data=buffer.subarray(0,bytesRead);
      const text=data.toString(data[0]===0xff&&data[1]===0xfe?'utf16le':'utf8');
      const names=[...new Set(offlineNamesFromLog(text).reverse())];
      if(names.length)return {name:names[0],names,source:'PCL 最近离线启动'};
    }catch{/* Missing, locked or unrecognised logs leave manual input available. */}
    finally{await handle?.close();}
  }
  return null;
}
