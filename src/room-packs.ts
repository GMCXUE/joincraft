import path from 'node:path';
import {mkdtemp,mkdir,readFile,writeFile,rename,rm,stat,open,statfs,readdir} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createHash,randomUUID} from 'node:crypto';
import os from 'node:os';
import {RoomService,type Principal} from './service.js';
import {fail} from './validation.js';
import {inspectMrpack,packSummary,archiveHash,MAX_PACK_BYTES,LEGACY_PACK_BYTES,UPLOAD_CHUNK_BYTES,type PackSummary} from '../shared/pack-format.mjs';

type Upload={id:string;room_id:string;user_id:string;sha512:string;size:number;expected_hash:string|null;state:string;error:string|null;expires_at:number};
type Stored={sha512:string;size:number;summary:string};
const validHash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{128}$/.test(value);
const TTL=2*60*60*1000;
export class RoomPacks {
  private storageQueue:Promise<unknown>=Promise.resolve();
  private verifyQueue:Promise<unknown>=Promise.resolve();
  private jobs=new Map<string,{controller:AbortController;promise:Promise<void>;file:string}>();
  private closing=false;
  private constructor(readonly service:RoomService,readonly directory:string,readonly ephemeral:boolean,readonly quota=5*1024**3){}
  static async create(service:RoomService,directory?:string){
    const ephemeral=!directory&&service.store.path===':memory:';
    const folder=directory|| (ephemeral?await mkdtemp(path.join(os.tmpdir(),'joincraft-packs-store-')):path.join(path.dirname(service.store.path),'packs'));
    const packs=new RoomPacks(service,path.resolve(folder),ephemeral);await packs.initialize();return packs;
  }
  private storedFile(hash:string){if(!validHash(hash))fail('整合包标识无效');return path.join(this.directory,'files',hash+'.mrpack');}
  private uploadFile(id:string){if(!/^[a-f0-9-]{36}$/.test(id))fail('上传任务不存在',404);return path.join(this.directory,'uploads',id+'.part');}
  private async serialize<T>(fn:()=>Promise<T>):Promise<T>{const next=this.storageQueue.catch(()=>{}).then(fn);this.storageQueue=next.catch(()=>{});return next;}
  private host(actor:Principal,id:string){if(!this.service.sessionValid(actor.tokenHash))fail('登录已失效，请重新登录',401);const room=this.service.accessible(id,actor);if(room.owner_id!==actor.id)fail('只有房主可以设置整合包',403);return room;}
  summary(id:string):PackSummary|null {const row=this.service.store.get<{summary:string}>('SELECT summary FROM room_packs WHERE room_id=?',id);return row?JSON.parse(row.summary):null;}
  private checkExpected(id:string,expected:unknown){if((expected??null)!==(this.summary(id)?.sha512??null))fail('房间整合包已变化，请刷新后重试',409);}
  private stored(hash:string){return this.service.store.get<Stored>('SELECT sha512,size,summary FROM pack_files WHERE sha512=?',hash);}
  private async initialize(){
    await mkdir(path.join(this.directory,'files'),{recursive:true,mode:0o700});await mkdir(path.join(this.directory,'uploads'),{recursive:true,mode:0o700});
    this.service.store.run("UPDATE pack_uploads SET state='uploading' WHERE state='checking'");
    // Version 0.9.19 stored <=16 MB archives in SQLite. Move one at a time without
    // changing their fingerprints or membership, then leave a compatibility marker.
    for(const row of this.service.store.all<{room_id:string;summary:string}>('SELECT room_id,summary FROM room_packs WHERE file_hash IS NULL')){
      const data=this.service.store.get<{archive:Uint8Array}>('SELECT archive FROM room_packs WHERE room_id=?',row.room_id)!;
      const buffer=Buffer.from(data.archive),summary=JSON.parse(row.summary) as PackSummary;
      if(buffer.length>LEGACY_PACK_BYTES||await archiveHash(buffer)!==summary.sha512)throw Error('旧版房间整合包校验失败，迁移已停止');
      const temp=path.join(this.directory,'uploads',randomUUID()+'.migrate');try{await writeFile(temp,buffer,{flag:'wx',mode:0o600});await rename(temp,this.storedFile(summary.sha512));}finally{await rm(temp,{force:true}).catch(()=>{});}
      this.service.store.transaction(()=>{this.service.store.run('INSERT OR IGNORE INTO pack_files(sha512,size,summary,created_at) VALUES (?,?,?,?)',summary.sha512,buffer.length,row.summary,this.service.now());this.service.store.run("UPDATE room_packs SET archive=x'',file_hash=? WHERE room_id=?",summary.sha512,row.room_id);});
    }
    for(const name of await readdir(path.join(this.directory,'files'))){const match=name.match(/^([a-f0-9]{128})\.mrpack$/);if(match&&!this.stored(match[1]!))await rm(path.join(this.directory,'files',name),{force:true});}
    for(const name of await readdir(path.join(this.directory,'uploads'))){const match=name.match(/^([a-f0-9-]{36})\.part$/);if(!match||!this.service.store.get('SELECT 1 FROM pack_uploads WHERE id=?',match[1]!))await rm(path.join(this.directory,'uploads',name),{force:true});}
    await this.cleanup();
  }
  private bind(actor:Principal,id:string,summary:PackSummary,expected:unknown){
    this.host(actor,id);this.checkExpected(id,expected);const previous=this.summary(id);
    this.service.store.run("INSERT INTO room_packs(room_id,summary,archive,updated_at,file_hash) VALUES (?,?,x'',?,?) ON CONFLICT(room_id) DO UPDATE SET summary=excluded.summary,archive=x'',updated_at=excluded.updated_at,file_hash=excluded.file_hash",id,JSON.stringify(summary),this.service.now(),summary.sha512);
    this.service.store.run('UPDATE pack_files SET released_at=NULL WHERE sha512=?',summary.sha512);
    this.service.store.run('UPDATE rooms SET version=?,loader=? WHERE id=?',summary.minecraft,summary.loader,id);
    this.service.store.run('INSERT INTO events(room_id,at,message) VALUES (?,?,?)',id,this.service.now(),'房主设置了整合包：'+summary.name+' · '+summary.versionId);
    this.service.store.run('DELETE FROM events WHERE room_id=? AND seq NOT IN (SELECT seq FROM events WHERE room_id=? ORDER BY seq DESC LIMIT 100)',id,id);
    if(previous?.sha512!==summary.sha512)this.markReleased(previous?.sha512);this.service.store.bump();
  }
  private markReleased(hash?:string){if(hash)this.service.store.run('UPDATE pack_files SET released_at=COALESCE(released_at,?) WHERE sha512=? AND NOT EXISTS(SELECT 1 FROM room_packs WHERE file_hash=?)',this.service.now(),hash,hash);}
  private usage(){return this.service.store.get<{bytes:number}>('SELECT COALESCE(SUM(size),0) AS bytes FROM pack_files')!.bytes+this.service.store.get<{bytes:number}>("SELECT COALESCE(SUM(size),0) AS bytes FROM pack_uploads u WHERE state IN ('uploading','checking') AND NOT EXISTS(SELECT 1 FROM pack_files f WHERE f.sha512=u.sha512)")!.bytes;}
  async publish(actor:Principal,id:string,body:Record<string,unknown>){
    this.host(actor,id);if(typeof body.archive!=='string'||body.archive.length>Math.ceil(LEGACY_PACK_BYTES/3)*4)fail('大整合包请更新客户端，最大支持 600 MB');
    const buffer=Buffer.from(body.archive,'base64');if(buffer.toString('base64')!==body.archive)fail('整合包文件编码无效');
    const temporary=path.join(this.directory,'uploads',randomUUID()+'.legacy');await writeFile(temporary,buffer,{flag:'wx',mode:0o600});
    try{
      let summary:PackSummary;try{summary=packSummary(await inspectMrpack(temporary));}catch(error){fail(error instanceof Error?error.message:'无法识别整合包');}
      return await this.serialize(async()=>{this.host(actor,id);this.checkExpected(id,body.expected);const existing=this.stored(summary.sha512);if(!existing&&this.usage()+summary.archiveSize>this.quota)fail('整合包存储空间已满，请清理不用的房间整合包',507);
        await rename(temporary,this.storedFile(summary.sha512));try{this.service.store.transaction(()=>{this.service.store.run('INSERT OR IGNORE INTO pack_files(sha512,size,summary,created_at) VALUES (?,?,?,?)',summary.sha512,summary.archiveSize,JSON.stringify(summary),this.service.now());this.bind(actor,id,summary,body.expected);});}catch(error){if(!this.stored(summary.sha512))await rm(this.storedFile(summary.sha512),{force:true});throw error;}this.service.onChange(this.service.members(id));return {ok:true,pack:summary};});
    }finally{await rm(temporary,{force:true}).catch(()=>{});}
  }
  descriptor(actor:Principal,id:string,sha512?:string){this.service.accessible(id,actor);const pack=this.summary(id);if(!pack)fail('房间尚未设置整合包',404);if(sha512&&sha512!==pack.sha512)fail('房间整合包已变化，请刷新后重试',409);return {pack,transferVersion:2,maxArchiveSize:MAX_PACK_BYTES};}
  async download(actor:Principal,id:string,sha512?:string){const {pack}=this.descriptor(actor,id,sha512);if(pack.archiveSize>LEGACY_PACK_BYTES)fail('此整合包需要新版客户端，请更新后下载',426);return {pack,archive:(await readFile(this.storedFile(pack.sha512))).toString('base64')};}
  async archive(actor:Principal,id:string,sha512:string|undefined,range:string|undefined){
    const {pack}=this.descriptor(actor,id,sha512);let start=0,end=pack.archiveSize-1,status=200;
    if(range){const match=range.match(/^bytes=(\d+)-(\d*)$/);if(!match)fail('下载范围无效',416);start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),end):end;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||start>=pack.archiveSize)fail('下载范围无效',416);status=206;}
    const file=await open(this.storedFile(pack.sha512),'r');return {pack,start,end,status,stream:file.createReadStream({start,end,autoClose:true})};
  }
  private upload(actor:Principal,id:string,uploadId:string){this.host(actor,id);this.uploadFile(uploadId);const value=this.service.store.get<Upload>('SELECT * FROM pack_uploads WHERE id=? AND room_id=? AND user_id=?',uploadId,id,actor.id);if(!value||value.expires_at<=this.service.now())fail('上传任务已过期，请重试',404);return value;}
  async begin(actor:Principal,id:string,body:Record<string,unknown>){
    this.host(actor,id);if(!validHash(body.sha512)||!Number.isSafeInteger(body.size)||Number(body.size)<20||Number(body.size)>MAX_PACK_BYTES)fail('整合包文件最大支持 600 MB');
    const hash=body.sha512,size=Number(body.size);if(body.expected!==undefined&&body.expected!==null&&!validHash(body.expected))fail('整合包版本标识无效');
    await this.cleanup();return this.serialize(async()=>{
      this.host(actor,id);const current=this.summary(id);if(current?.sha512===hash)return {state:'ready',pack:current,offset:size,chunkSize:UPLOAD_CHUNK_BYTES};this.checkExpected(id,body.expected);
      const existing=this.service.store.get<Upload>("SELECT * FROM pack_uploads WHERE user_id=? AND room_id=? AND sha512=? AND state<>'ready'",actor.id,id,hash);
      if(existing){if(existing.size!==size||existing.expected_hash!==(body.expected??null))fail('上传任务与当前房间版本不一致',409);if(existing.state==='failed'){if(this.service.store.get<{n:number}>("SELECT count(*) AS n FROM pack_uploads WHERE user_id=? AND state IN ('uploading','checking')",actor.id)!.n)fail('请先完成或取消当前上传',409);if(this.service.store.get<{n:number}>("SELECT count(*) AS n FROM pack_uploads WHERE state IN ('uploading','checking')")!.n>=2)fail('当前已有两个整合包正在上传，请稍后重试',429);if(!this.stored(hash)&&this.usage()+size>this.quota)fail('整合包存储空间已满，请清理不用的房间整合包',507);const free=await statfs(this.directory);if(!this.stored(hash)&&Number(free.bavail)*Number(free.bsize)<size+512*1024*1024)fail('服务器剩余空间不足',507);}this.service.store.run("UPDATE pack_uploads SET expires_at=?,state=CASE WHEN state='failed' THEN 'uploading' ELSE state END,error=NULL WHERE id=?",this.service.now()+TTL,existing.id);if(!this.stored(hash)&&!await stat(this.uploadFile(existing.id)).then(()=>true,()=>false))await writeFile(this.uploadFile(existing.id),Buffer.alloc(0),{flag:'wx',mode:0o600});return this.info(actor,id,existing.id);}
      const previousUploads=this.service.store.all<Upload>("SELECT * FROM pack_uploads WHERE user_id=? AND state IN ('uploading','checking')",actor.id);
      for(const previous of previousUploads){if(body.replace!==true||previous.state==='checking'||this.writing.has(previous.id))fail('请先完成或取消当前上传',409);this.service.store.run('DELETE FROM pack_uploads WHERE id=?',previous.id);await rm(this.uploadFile(previous.id),{force:true});}

      const active=this.service.store.get<{n:number}>("SELECT count(*) AS n FROM pack_uploads WHERE state IN ('uploading','checking')")!.n;if(active>=2)fail('当前已有两个整合包正在上传，请稍后重试',429);
      const stored=this.stored(hash);if(stored&&stored.size!==size)fail('整合包大小不一致');if(!stored&&this.usage()+size>this.quota)fail('整合包存储空间已满，请清理不用的房间整合包',507);
      const free=await statfs(this.directory);if(!stored&&Number(free.bavail)*Number(free.bsize)<size+512*1024*1024)fail('服务器剩余空间不足',507);
      const uploadId=randomUUID();this.service.store.run('INSERT INTO pack_uploads(id,room_id,user_id,sha512,size,expected_hash,state,expires_at) VALUES (?,?,?,?,?,?,?,?)',uploadId,id,actor.id,hash,size,typeof body.expected==='string'?body.expected:null,'uploading',this.service.now()+TTL);
      if(!stored)await writeFile(this.uploadFile(uploadId),Buffer.alloc(0),{flag:'wx',mode:0o600});return this.info(actor,id,uploadId);
    });
  }
  async info(actor:Principal,id:string,uploadId:string){const upload=this.upload(actor,id,uploadId),stored=this.stored(upload.sha512);const offset=stored?upload.size:await stat(this.uploadFile(upload.id)).then(value=>value.size,()=>0);return {uploadId:upload.id,state:upload.state,offset,size:upload.size,chunkSize:UPLOAD_CHUNK_BYTES,expiresAt:upload.expires_at,...(upload.state==='ready'&&stored?{pack:JSON.parse(stored.summary)}:{}),...(upload.error?{error:upload.error}:{}),file:this.jobs.get(upload.id)?.file||''};}
  private writing=new Set<string>();
  async chunk(actor:Principal,id:string,uploadId:string,offsetValue:unknown,payload:Readable,contentLength:unknown,chunkHash:unknown){
    const upload=this.upload(actor,id,uploadId),offset=Number(offsetValue),length=Number(contentLength);
    if(upload.state!=='uploading'||!Number.isSafeInteger(offset)||offset<0||offset>=upload.size)fail('上传偏移无效',409);
    const required=Math.min(UPLOAD_CHUNK_BYTES,upload.size-offset);if(length!==required||typeof chunkHash!=='string'||!/^[a-f0-9]{64}$/.test(chunkHash))fail('上传分块大小或校验信息无效',413);
    if(this.writing.has(uploadId))fail('该任务已有分块正在上传',409);this.writing.add(uploadId);
    const target=this.uploadFile(uploadId),temporary=target+'.'+randomUUID()+'.chunk';
    try{
      if((await stat(target)).size!==offset)fail('上传位置已变化，请继续上传',409);
      const handle=await open(temporary,'wx',0o600),hash=createHash('sha256');let received=0;
      try{for await(const chunk of payload){received+=chunk.length;if(received>required)fail('上传分块过大',413);hash.update(chunk);await handle.writeFile(chunk);}}finally{await handle.close();}
      if(received!==required||hash.digest('hex')!==chunkHash)fail('上传分块校验失败');this.upload(actor,id,uploadId);
      await pipeline(createReadStream(temporary),createWriteStream(target,{flags:'a',mode:0o600}));
      this.service.store.run('UPDATE pack_uploads SET expires_at=? WHERE id=?',this.service.now()+TTL,uploadId);return {offset:offset+received};
    }finally{this.writing.delete(uploadId);await rm(temporary,{force:true}).catch(()=>{});}
  }
  async commit(actor:Principal,id:string,uploadId:string){
    const upload=this.upload(actor,id,uploadId);if(upload.state==='ready'||this.jobs.has(uploadId))return this.info(actor,id,uploadId);
    if((await this.info(actor,id,uploadId)).offset!==upload.size)fail('整合包尚未上传完整',409);
    this.service.store.run("UPDATE pack_uploads SET state='checking',error=NULL,expires_at=? WHERE id=?",this.service.now()+TTL,uploadId);
    const controller=new AbortController();const promise=this.verifyQueue.catch(()=>{}).then(async()=>{
      try{
        if(this.closing)throw Error('服务正在重启，请重试');
        const stored=this.stored(upload.sha512),file=stored?this.storedFile(upload.sha512):this.uploadFile(uploadId);
        let summary:PackSummary;
        if(stored){if(await archiveHash(file,{signal:controller.signal})!==upload.sha512)throw Error('服务器整合包文件校验失败');summary=JSON.parse(stored.summary);}
        else{const parsed=await inspectMrpack(file,{signal:controller.signal,onProgress:state=>{const job=this.jobs.get(uploadId);if(job)job.file=state.file;}});summary=packSummary(parsed);if(summary.sha512!==upload.sha512||summary.archiveSize!==upload.size)throw Error('整合包校验失败，请重新上传');}
        await this.serialize(async()=>{controller.signal.throwIfAborted();this.upload(actor,id,uploadId);this.checkExpected(id,upload.expected_hash);if(!stored)await rename(file,this.storedFile(summary.sha512));try{this.service.store.transaction(()=>{this.service.store.run('INSERT OR IGNORE INTO pack_files(sha512,size,summary,created_at) VALUES (?,?,?,?)',summary.sha512,summary.archiveSize,JSON.stringify(summary),this.service.now());this.bind(actor,id,summary,upload.expected_hash);this.service.store.run("UPDATE pack_uploads SET state='ready',expires_at=? WHERE id=?",this.service.now()+10*60*1000,uploadId);});}catch(error){if(!stored&&!this.stored(summary.sha512))await rm(this.storedFile(summary.sha512),{force:true});throw error;}this.service.onChange(this.service.members(id));});
      }catch(error){if(!this.closing&&!this.stored(upload.sha512))await rm(this.uploadFile(uploadId),{force:true}).catch(()=>{});this.service.store.run("UPDATE pack_uploads SET state=?,error=? WHERE id=?",this.closing?'uploading':'failed',this.closing?null:error instanceof Error?error.message:'整合包校验失败',uploadId);}
      finally{this.jobs.delete(uploadId);}
    });this.jobs.set(uploadId,{controller,promise,file:'等待校验整合包'});this.verifyQueue=promise;return this.info(actor,id,uploadId);
  }
  async cancelUpload(actor:Principal,id:string,uploadId:string){this.upload(actor,id,uploadId);if(this.writing.has(uploadId))fail('正在写入分块，请稍后重试',409);const job=this.jobs.get(uploadId);if(job){job.controller.abort(Error('上传已取消'));await job.promise;}await this.serialize(async()=>{this.service.store.run('DELETE FROM pack_uploads WHERE id=?',uploadId);await rm(this.uploadFile(uploadId),{force:true});});return {ok:true};}
  remove(actor:Principal,id:string,expected:unknown){this.host(actor,id);this.checkExpected(id,expected);this.service.store.transaction(()=>{this.release(id);this.service.store.bump();});this.service.onChange(this.service.members(id));return {ok:true};}
  release(id:string){const old=this.summary(id);this.service.store.run('DELETE FROM room_packs WHERE room_id=?',id);this.markReleased(old?.sha512);}
  async cleanup(){return this.serialize(async()=>{
    for(const upload of this.service.store.all<Upload>('SELECT * FROM pack_uploads WHERE expires_at<=?',this.service.now())){if(this.jobs.has(upload.id)||this.writing.has(upload.id))continue;this.service.store.run('DELETE FROM pack_uploads WHERE id=?',upload.id);await rm(this.uploadFile(upload.id),{force:true}).catch(()=>{});this.markReleased(upload.sha512);}
    for(const file of this.service.store.all<{sha512:string}>('SELECT sha512 FROM pack_files WHERE released_at<? AND NOT EXISTS(SELECT 1 FROM room_packs WHERE file_hash=pack_files.sha512) AND NOT EXISTS(SELECT 1 FROM pack_uploads WHERE sha512=pack_files.sha512)',this.service.now()-60*60*1000)){await rm(this.storedFile(file.sha512),{force:true});this.service.store.run('DELETE FROM pack_files WHERE sha512=?',file.sha512);}
  });}
  async close(){this.closing=true;for(const job of this.jobs.values())job.controller.abort(Error('服务正在关闭'));await this.verifyQueue.catch(()=>{});await this.storageQueue.catch(()=>{});if(this.ephemeral)await rm(this.directory,{recursive:true,force:true});}
}
