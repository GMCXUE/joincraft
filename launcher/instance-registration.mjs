import path from 'node:path';
import {writeFile,rename,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

// Keep the game directory stable: Windows may deny renaming a directory after
// Java or a file scanner has opened one of its descendants. Publish only the
// small registration file after every install step has completed.
export async function registerInstance(directory,record,{signal,renameImpl=rename,wait=ms=>delay(ms,undefined,{signal})}={}){
  const pending=path.join(directory,'.instance-'+randomUUID()+'.json');
  try{
    signal?.throwIfAborted();await writeFile(pending,JSON.stringify(record),{flag:'wx'});
    for(let attempt=0;;attempt++){
      signal?.throwIfAborted();
      try{await renameImpl(pending,path.join(directory,'instance.json'));return;}
      catch(error){
        if(!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=6)throw error;
        await wait(Math.min(150*2**attempt,1500));
      }
    }
  }finally{await rm(pending,{force:true}).catch(()=>{});}
}
