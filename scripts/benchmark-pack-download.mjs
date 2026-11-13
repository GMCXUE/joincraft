// Deterministic latency model, not a claim about an end user's Internet speed.
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {performance} from 'node:perf_hooks';
import {downloadMany} from '../launcher/pack-download.mjs';
import {InstallProgress} from '../launcher/install-progress.mjs';
const root=await mkdtemp(path.join(os.tmpdir(),'joincraft-download-bench-')),data=Buffer.alloc(64*1024,7),hash=createHash('sha1').update(data).digest('hex');
const entries=Array.from({length:128},(_,i)=>({path:'assets/objects/ab/'+i,size:data.length,hashes:{sha1:hash},downloads:['https://resources.download.minecraft.net/ab/'+i]}));
try{
  const runs=[];
  for(const concurrency of [4,16]){
    const progress=new InstallProgress();progress.begin('benchmark');progress.phase('game','download',3,entries);let requests=0;
    const started=performance.now();
    await downloadMany(entries,path.join(root,String(concurrency)),{concurrency,progress,fetchImpl:async(_url,{signal})=>{requests++;await delay(60,undefined,{signal});let offset=0;return new Response(new ReadableStream({async pull(controller){await delay(5,undefined,{signal});if(offset===data.length){controller.close();return;}controller.enqueue(data.subarray(offset,offset+16384));offset+=16384;}}));}});
    const seconds=(performance.now()-started)/1000;runs.push({concurrency,seconds:Number(seconds.toFixed(3)),MBps:Number((entries.length*data.length/1024**2/seconds).toFixed(2)),requests,completedFiles:progress.state().completedFiles});
  }
  console.log(JSON.stringify({model:'128 files × 64 KiB; 60 ms response latency; 5 ms per 16 KiB chunk; synthetic fetch, SHA-1 verification and real disk writes',runs,speedup:Number((runs[0].seconds/runs[1].seconds).toFixed(2))},null,2));
}finally{await rm(root,{recursive:true,force:true});}
