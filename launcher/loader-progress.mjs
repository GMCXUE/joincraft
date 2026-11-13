import {statSync} from 'node:fs';

// XMCL parents repeat their children's byte updates. Observe only the actual
// download tasks, and use the multi-task's per-file progress and completion hook.
export function loaderProgress(progress){
  const seen=new WeakMap();
  const key=entry=>{const file=entry.destination?.replaceAll('\\','/')||'';return file.includes('/libraries/')?'libraries/'+file.split('/libraries/').at(-1):file.split('/').at(-1)||'加载器文件';};
  const size=(file,fallback)=>{try{return statSync(file).size;}catch{return fallback;}};
  function finish(task,index){
    const state=seen.get(task);if(!state||state.finished.has(index))return;
    const entry=task.options[index],bytes=size(entry.destination,task.totals[index]||task.progresses[index]||0);
    state.finished.add(index);progress.update(key(entry),bytes,bytes||undefined,{done:true,reused:!(state.written[index]>0)});
  }
  return {
    onStart(task){
      if(Array.isArray(task.options)){
        if(!task.options.length)return;
        const state={written:[],totals:[],finished:new Set()};seen.set(task,state);
        progress.phase('loader-download','下载加载器组件',4,task.options.map(entry=>({path:key(entry)})));
        const previous=task.onFinished;task.onFinished=index=>{previous?.(index);finish(task,index);};
      }else if(task.options?.destination){progress.phase('loader-download','下载加载器安装程序',4,[{path:key(task.options)}]);}
      else if(task.name==='postProcessing'&&task.total>0){progress.phase('loader-process','运行加载器处理器',4);progress.detail('处理器 0 / '+task.total);}
    },
    onUpdate(task,chunkSize){
      if(Array.isArray(task.options)){
        const state=seen.get(task);if(!state)return;
        for(let i=0;i<task.options.length;i++){
          if(state.finished.has(i))continue;
          const written=task.progresses[i]||0,total=task.totals[i]||undefined,previous=state.written[i]||0;
          if(written===previous&&total===state.totals[i])continue;
          state.written[i]=written;state.totals[i]=total;
          progress.update(key(task.options[i]),written,total,{networkBytes:chunkSize>0?Math.max(0,written-previous):0});
        }
      }else if(task.options?.destination){progress.update(key(task.options),Math.max(0,task.progress),task.total>0?task.total:undefined,{networkBytes:Math.max(0,chunkSize||0)});}
      else if(task.name==='postProcessing'&&task.total>0)progress.detail('处理器 '+task.progress+' / '+task.total);
    },
    onSucceed(task){
      if(Array.isArray(task.options)){for(let i=0;i<task.options.length;i++)finish(task,i);}
      else if(task.options?.destination){const bytes=size(task.options.destination,task.progress);progress.update(key(task.options),bytes,bytes||undefined,{done:true});}
    },
  };
}
