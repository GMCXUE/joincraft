import path from 'node:path';
import {stat,mkdir,open,rename,rm,copyFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {inspectMrpack,packSummary,archiveHash,MAX_PACK_BYTES} from '../shared/pack-format.mjs';
import {InstallProgress} from '../launcher/install-progress.mjs';
const MB=1024*1024;
const delay=(ms,signal)=>new Promise((resolve,reject)=>{const timer=setTimeout(done,ms);function done(){signal?.removeEventListener('abort',abort);resolve();}function abort(){clearTimeout(timer);reject(signal.reason);}signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});
export class PackTransfer {
  constructor({serverURL,getHeaders=async()=>({}),getDirectory,notify=()=>{},fetchImpl=fetch}){
    this.origin=new URL(serverURL).origin;if(!this.origin.startsWith('https:')&&!/^http:\/\/(?:localhost|127\.0\.0\.1)(?::|$)/.test(this.origin))throw Error('整合包服务地址无效');
    Object.assign(this,{getHeaders,getDirectory,notify,fetchImpl});this.progress=new InstallProgress(notify);this.drafts=new Map();this.busy=false;
  }
  state(){return this.progress.state();}
  roomPath(roomId){if(typeof roomId!=='string'||!/^[a-f0-9-]{36}$/.test(roomId))throw Error('房间标识无效');return '/api/rooms/'+roomId+'/pack';}
  async run(operation,name,fn){
    if(this.busy)throw Error('已有整合包任务正在进行');this.busy=true;this.controller=new AbortController();this.progress.operation=operation;this.progress.sha512=undefined;this.progress.begin(name);const signal=this.controller.signal;
    try{const result=await fn(signal);this.progress.end('done',operation==='upload'?'整合包已发布到房间':operation==='download'?'下载校验完成，准备安装':'整合包校验完成');return result;}
    catch(error){const cancelled=signal.aborted;this.progress.end(cancelled?'cancelled':'failed',cancelled?'操作已取消，可重试':error.message||'传输失败，请重试');throw cancelled?Error('操作已取消'):error;}
    finally{this.busy=false;this.currentUpload=null;}
  }
  async inspect(file){return this.run('inspect','检查整合包',async signal=>{
    const before=await stat(file);if(!before.isFile()||before.size>MAX_PACK_BYTES)throw Error('整合包文件最大支持 600 MB');
    this.progress.phase('inspect','检查整合包文件',1);
    const pack=packSummary(await inspectMrpack(file,{signal,onProgress:value=>this.progress.update(value.file,value.completed,value.total)}));
    const after=await stat(file);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('整合包文件已变化，请重新选择');
    for(const [id,draft] of this.drafts)if(draft.expiresAt<Date.now())this.drafts.delete(id);
    const draftId=randomUUID();this.drafts.set(draftId,{file,pack,size:after.size,mtime:after.mtimeMs,expiresAt:Date.now()+2*60*60*1000});
    return {draftId,pack};
  });}
  async request(url,{signal,headers={},method='GET',body,raw=false}={}){
    const target=new URL(url,this.origin);if(target.origin!==this.origin||!target.pathname.startsWith('/api/rooms/'))throw Error('不允许跨站传输整合包');
    const result=await this.fetchImpl(target.href,{method,headers:{...headers,Origin:this.origin,...(!raw&&body!==undefined?{'Content-Type':'application/json'}:{})},...(body===undefined?{}:{body:raw?body:JSON.stringify(body),...(raw?{duplex:'half'}:{})}),signal,redirect:'error'});
    if(!result.ok){const detail=await result.json().catch(()=>null);const error=Object.assign(Error(detail?.error||'整合包请求失败（'+result.status+'）'),{status:result.status});throw error;}return result;
  }
  async json(url,options={}){const signal=AbortSignal.any([...(options.signal?[options.signal]:[]),AbortSignal.timeout(options.raw?120000:30000)]);return (await this.request(url,{...options,signal})).json();}
  async retry(fn,signal){let error;for(let i=0;i<3;i++){signal.throwIfAborted();try{return await fn();}catch(e){error=e;if(signal.aborted)throw signal.reason;if(e.status&&e.status<500&&![408,429].includes(e.status))throw e;if(i<2)await delay(700*(i+1),signal);}}throw error;}
  async retainArchive(file,pack,signal){
    const directory=path.join(this.getDirectory(),'downloads');await mkdir(directory,{recursive:true});
    const target=path.join(directory,pack.sha512+'.mrpack');
    if(await stat(target).then(info=>info.isFile()&&info.size===pack.archiveSize,()=>false)&&await archiveHash(target,{signal})===pack.sha512)return target;
    const temporary=target+'.'+randomUUID()+'.part';
    try{
      signal.throwIfAborted();await copyFile(file,temporary);signal.throwIfAborted();
      if(await stat(temporary).then(info=>info.size!==pack.archiveSize)||await archiveHash(temporary,{signal})!==pack.sha512)throw Error('整合包文件已变化，请重新选择');
      signal.throwIfAborted();await rename(temporary,target);return target;
    }finally{await rm(temporary,{force:true}).catch(()=>{});}
  }
  async publish({roomId,draftId,expected=null,token}){
    const draft=this.drafts.get(draftId);if(!draft||draft.expiresAt<Date.now())throw Error('整合包选择已过期，请重新选择');
    const route=this.roomPath(roomId);
    return this.run('upload',draft.pack.name,async signal=>{
      const metadata=await stat(draft.file);if(metadata.size!==draft.size||metadata.mtimeMs!==draft.mtime)throw Error('整合包文件已变化，请重新选择');
      this.progress.sha512=draft.pack.sha512;this.progress.phase('prepare','保留本地整合包',1);
      const local=await this.retainArchive(draft.file,draft.pack,signal);
      const headers=await this.getHeaders(token);this.progress.sha512=draft.pack.sha512;const name=path.basename(draft.file);this.progress.phase('upload','上传房间整合包',1,[{path:name,size:draft.size}]);
      let upload=await this.retry(()=>this.json(route+'/uploads',{method:'POST',body:{sha512:draft.pack.sha512,size:draft.size,expected,replace:true},headers,signal}),signal);
      if(upload.state==='ready')return upload.pack;
      const uploadRoute=route+'/uploads/'+upload.uploadId;this.currentUpload={route:uploadRoute,headers};
      const handle=await open(local,'r');
      try{
        while(upload.offset<draft.size){
          signal.throwIfAborted();const offset=upload.offset,length=Math.min(upload.chunkSize||4*MB,draft.size-offset);if(!Number.isInteger(offset)||offset<0||length<=0||length>4*MB)throw Error('服务器上传位置无效');
          const chunk=Buffer.allocUnsafe(length);let loaded=0;while(loaded<length){const result=await handle.read(chunk,loaded,length-loaded,offset+loaded);if(!result.bytesRead)throw Error('读取整合包不完整');loaded+=result.bytesRead;}
          const sha=createHash('sha256').update(chunk).digest('hex');
          try{
            upload=await this.retry(async()=>{
              let sent=0;const progress=this.progress;
              const body=Readable.from((async function*(){for(let start=0;start<chunk.length;start+=65536){signal.throwIfAborted();const data=chunk.subarray(start,Math.min(start+65536,chunk.length));sent+=data.length;progress.update(name,offset+sent,draft.size,{networkBytes:data.length});yield data;}})());
              return this.json(uploadRoute+'/chunk?offset='+offset,{method:'PUT',raw:true,body,headers:{...headers,'Content-Type':'application/octet-stream','Content-Length':String(length),'X-Chunk-Sha256':sha},signal});
            },signal);
          }catch(error){if(error.status!==409)throw error;upload=await this.json(uploadRoute,{headers,signal});if(upload.offset===offset)throw error;}
          if(upload.offset>draft.size)throw Error('服务器上传位置无效');this.progress.update(name,upload.offset,draft.size);
        }
      }finally{await handle.close();}
      await this.retry(()=>this.json(uploadRoute+'/commit',{method:'POST',body:{},headers,signal}),signal);
      this.progress.phase('verify','服务器校验整合包',1);this.progress.detail(name);
      for(;;){
        const state=await this.retry(()=>this.json(uploadRoute,{headers,signal}),signal);
        if(state.state==='ready'){if(state.pack?.sha512!==draft.pack.sha512)throw Error('服务器整合包版本不一致');return state.pack;}
        if(state.state==='failed')throw Error(state.error||'服务器整合包校验失败');if(state.state==='uploading'){if(state.offset!==draft.size)throw Error('服务重启后上传不完整，请重试');await this.retry(()=>this.json(uploadRoute+'/commit',{method:'POST',body:{},headers,signal}),signal);}this.progress.detail(state.file||'服务器正在校验整合包');await delay(600,signal);
      }
    });
  }
  async download({roomId,sha512,token}){
    if(typeof sha512!=='string'||!/^[a-f0-9]{128}$/.test(sha512))throw Error('整合包标识无效');const route=this.roomPath(roomId);
    return this.run('download','获取房间整合包',async signal=>{
      const headers=await this.getHeaders(token),meta=await this.json(route+'/meta?sha512='+sha512,{headers,signal});
      if(meta.pack?.sha512!==sha512||!Number.isSafeInteger(meta.pack.archiveSize)||meta.pack.archiveSize>MAX_PACK_BYTES)throw Error('房间整合包信息无效');
      const directory=path.join(this.getDirectory(),'downloads');await mkdir(directory,{recursive:true});const target=path.join(directory,sha512+'.mrpack'),temporary=target+'.part';
      if(await stat(target).then(info=>info.size===meta.pack.archiveSize,()=>false)&&await archiveHash(target,{signal})===sha512)return {file:target,pack:meta.pack};
      this.progress.name=meta.pack.name;this.progress.sha512=sha512;const name=meta.pack.name+'.mrpack';this.progress.phase('download','下载房间整合包',1,[{path:name,size:meta.pack.archiveSize}]);
      await this.retry(async()=>{
        this.progress.phase('download','下载房间整合包',1,[{path:name,size:meta.pack.archiveSize}]);
        let offset=await stat(temporary).then(info=>info.size,()=>0);if(offset>meta.pack.archiveSize){await rm(temporary,{force:true});offset=0;}
        if(offset<meta.pack.archiveSize){
          const idle=new AbortController();let timer;const touch=()=>{clearTimeout(timer);timer=setTimeout(()=>idle.abort(Error('下载长时间无响应')),60000);timer.unref?.();};touch();
          const combined=AbortSignal.any([signal,idle.signal]);let handle;
          try{
            const response=await this.request(route+'/archive?sha512='+sha512,{headers:{...headers,...(offset?{Range:'bytes='+offset+'-'}:{})},signal:combined});
            if(offset&&response.status!==206){await response.body?.cancel();await rm(temporary,{force:true});throw Error('服务器未返回续传内容，请重试');}
            if(offset&&response.headers.get('content-range')!=='bytes '+offset+'-'+(meta.pack.archiveSize-1)+'/'+meta.pack.archiveSize){await response.body?.cancel();throw Error('下载范围不一致');}
            handle=await open(temporary,offset?'a':'w',0o600);
            for await(const chunk of response.body){combined.throwIfAborted();touch();offset+=chunk.length;if(offset>meta.pack.archiveSize)throw Error('整合包下载超过预期大小');await handle.writeFile(chunk);this.progress.update(name,offset,meta.pack.archiveSize,{networkBytes:chunk.length});}
          }finally{clearTimeout(timer);await handle?.close();}
        }
        if(offset!==meta.pack.archiveSize)throw Error('整合包下载不完整');
        this.progress.phase('verify','校验整合包文件',1);
        if(await archiveHash(temporary,{signal,onProgress:value=>this.progress.update(name,value.completed,value.total)})!==sha512){await rm(temporary,{force:true});throw Error('下载的整合包校验失败，请重试');}
      },signal);
      await rename(temporary,target);return {file:target,pack:meta.pack};
    });
  }
  async cancel(){
    if(!this.busy)return;const upload=this.currentUpload;this.progress.end('cancelling','正在取消传输');this.controller.abort(Error('操作已取消'));
    if(upload){for(let i=0;i<3;i++){try{await this.json(upload.route+'/cancel',{method:'POST',body:{},headers:upload.headers,signal:AbortSignal.timeout(10000)});break;}catch(error){if(error.status===404)break;if(i<2)await delay(500);}}}
  }
}
