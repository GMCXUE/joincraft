import {RoomService,type Principal} from './service.js';
import {fail} from './validation.js';
import {inspectMrpack,packSummary,MAX_PACK_BYTES,type PackSummary} from '../shared/pack-format.mjs';

export class RoomPacks {
  private parsing=false;
  constructor(readonly service:RoomService){}
  summary(id:string):PackSummary|null {
    const row=this.service.store.get<{summary:string}>('SELECT summary FROM room_packs WHERE room_id=?',id);
    return row?JSON.parse(row.summary):null;
  }
  async publish(actor:Principal,id:string,body:Record<string,unknown>){
    const initial=this.service.accessible(id,actor);if(initial.owner_id!==actor.id)fail('只有房主可以设置整合包',403);
    if(this.parsing)fail('正在处理其他整合包，请稍后重试',429);
    if(typeof body.archive!=='string'||body.archive.length>Math.ceil(MAX_PACK_BYTES/3)*4)fail('首版支持 16 MB 以内的 .mrpack 文件');
    const archive=Buffer.from(body.archive,'base64');if(archive.toString('base64')!==body.archive)fail('整合包文件编码无效');
    this.parsing=true;let summary:PackSummary;
    try{summary=packSummary(await inspectMrpack(archive));}catch(error){fail(error instanceof Error?error.message:'无法识别整合包');}finally{this.parsing=false;}
    this.service.store.transaction(()=>{
      const room=this.service.accessible(id,actor);if(room.owner_id!==actor.id)fail('只有房主可以设置整合包',403);
      const previous=this.summary(id);if((body.expected??null)!==(previous?.sha512??null))fail('房间整合包已变化，请刷新后重试',409);
      const total=this.service.store.get<{bytes:number}>('SELECT COALESCE(SUM(length(archive)),0) AS bytes FROM room_packs WHERE room_id<>?',id)!.bytes;
      if(total+archive.length>256*1024*1024)fail('整合包存储空间已满，请稍后重试',503);
      this.service.store.run('INSERT INTO room_packs VALUES (?,?,?,?) ON CONFLICT(room_id) DO UPDATE SET summary=excluded.summary,archive=excluded.archive,updated_at=excluded.updated_at',id,JSON.stringify(summary),archive,this.service.now());
      this.service.store.run('UPDATE rooms SET version=?,loader=? WHERE id=?',summary.minecraft,summary.loader,id);
      this.service.store.run('INSERT INTO events(room_id,at,message) VALUES (?,?,?)',id,this.service.now(),'房主设置了整合包：'+summary.name+' · '+summary.versionId);this.service.store.bump();
    });
    this.service.onChange(this.service.members(id));return {ok:true,pack:summary};
  }
  download(actor:Principal,id:string,sha512?:string){
    this.service.accessible(id,actor);const summary=this.summary(id);if(!summary)fail('房间尚未设置整合包',404);
    if(sha512&&sha512!==summary.sha512)fail('房间整合包已变化，请刷新后重试',409);
    const row=this.service.store.get<{archive:Uint8Array}>('SELECT archive FROM room_packs WHERE room_id=?',id)!;
    return {pack:summary,archive:Buffer.from(row.archive).toString('base64')};
  }
  remove(actor:Principal,id:string,expected:unknown){
    const room=this.service.accessible(id,actor);if(room.owner_id!==actor.id)fail('只有房主可以设置整合包',403);
    if((expected??null)!==(this.summary(id)?.sha512??null))fail('房间整合包已变化，请刷新后重试',409);
    this.service.store.transaction(()=>{this.release(id);this.service.store.bump();});this.service.onChange(this.service.members(id));return {ok:true};
  }
  release(id:string){this.service.store.run('DELETE FROM room_packs WHERE room_id=?',id);}
}
