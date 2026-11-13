import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, open, rm, copyFile, stat, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=resolve(process.env.DATABASE_PATH||resolve(root,'data/blockroom.sqlite'));
const target=resolve(process.argv[2]||resolve(root,`backups/blockroom-${Date.now()}.sqlite`));
const packs=resolve(process.env.PACK_DIRECTORY||join(dirname(source),'packs')),packBackup=target+'.packs';
if(source===target)throw new Error('备份目标不能覆盖正在使用的数据库');
await mkdir(dirname(target),{recursive:true,mode:0o700});
const db=new DatabaseSync(source,{readOnly:true});let reserved=false,packReserved=false;
try{
 const file=await open(target,'wx',0o600);await file.close();reserved=true;
 await backup(db,target);
 const snapshot=new DatabaseSync(target,{readOnly:true});let files=[];
 try{if(snapshot.prepare("SELECT 1 FROM sqlite_master WHERE name='pack_files'").get())files=snapshot.prepare('SELECT sha512,size FROM pack_files WHERE EXISTS(SELECT 1 FROM room_packs WHERE file_hash=pack_files.sha512)').all();}
 finally{snapshot.close();}
 if(files.length){
  await mkdir(packBackup,{mode:0o700});packReserved=true;await mkdir(join(packBackup,'files'),{mode:0o700});
  for(const entry of files){
   if(!/^[a-f0-9]{128}$/.test(entry.sha512))throw Error('备份发现无效整合包标识');
   const sourceFile=join(packs,'files',entry.sha512+'.mrpack'),targetFile=join(packBackup,'files',entry.sha512+'.mrpack');
   await copyFile(sourceFile,targetFile);if((await stat(targetFile)).size!==entry.size)throw Error('整合包备份大小不一致');
  }
  await writeFile(join(packBackup,'backup.json'),JSON.stringify({schema:1,database:target,files},null,2)+'\n',{flag:'wx',mode:0o600});
 }
 console.log(`备份完成：${target}${files.length?`，整合包目录 ${packBackup}（${files.length} 个）`:''}`);
}catch(error){if(packReserved)await rm(packBackup,{recursive:true,force:true});if(reserved)await rm(target,{force:true});throw error;}
finally{db.close();}
