import {PassThrough,Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {openEntryReadStream} from '@xmcl/unzip';

// yauzl 2's streams do not emit the modern close lifecycle on destroy(). Keep
// them outside pipeline, so aborting awaits only Node's standard streams.
export async function zipEntryStream(zip,entry,{signal}={}){
  signal?.throwIfAborted();const source=await openEntryReadStream(zip,entry);
  if(signal?.aborted){source.destroy();throw signal.reason;}
  const output=new PassThrough();source.on('error',error=>output.destroy(error));
  output.once('close',()=>{source.unpipe(output);source.destroy();});
  source.pipe(output);return output;
}
export async function readZipEntry(zip,entry,{signal}={}){
  const chunks=[];await pipeline(await zipEntryStream(zip,entry,{signal}),new Writable({write(chunk,_encoding,callback){chunks.push(chunk);callback();}}),{signal});return Buffer.concat(chunks);
}
export async function* zipEntries(zip,{signal}={}){
  let entry,ended=false,error,wake=()=>{};
  const onEntry=value=>{entry=value;wake();},onEnd=()=>{ended=true;wake();},onError=value=>{error=value;wake();};
  const onAbort=()=>onError(signal.reason),onClose=()=>{if(!ended&&!error)onError(Error('整合包读取提前结束'));};
  zip.on('entry',onEntry).on('end',onEnd).on('error',onError).on('close',onClose);signal?.addEventListener('abort',onAbort,{once:true});
  try{
    for(;;){
      signal?.throwIfAborted();if(error)throw error;if(ended)return;entry=undefined;
      await new Promise(resolve=>{wake=resolve;zip.readEntry();});
      signal?.throwIfAborted();if(error)throw error;if(ended)return;if(entry)yield entry;
    }
  }finally{zip.off('entry',onEntry).off('end',onEnd).off('error',onError).off('close',onClose);signal?.removeEventListener('abort',onAbort);}
}
