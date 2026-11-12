import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, open, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=resolve(process.env.DATABASE_PATH||resolve(root,'data/blockroom.sqlite'));
const target=resolve(process.argv[2]||resolve(root,`backups/blockroom-${Date.now()}.sqlite`));
if(source===target)throw new Error('备份目标不能覆盖正在使用的数据库');
await mkdir(dirname(target),{recursive:true,mode:0o700});
const db=new DatabaseSync(source,{readOnly:true});
let reserved=false;
try{
 const file=await open(target,'wx',0o600);await file.close();reserved=true;
 await backup(db,target);
 console.log(`备份完成：${target}`);
}catch(error){if(reserved)await rm(target,{force:true});throw error;}
finally{db.close();}
