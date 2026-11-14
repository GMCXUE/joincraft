import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {parseLevelData} from './launcher/level-data.mjs';
import {ManagedWorlds} from './launcher/worlds.mjs';
const str=s=>{const b=Buffer.from(s),n=Buffer.alloc(2);n.writeUInt16BE(b.length);return Buffer.concat([n,b]);};
const num=(n,size=4)=>{const b=Buffer.alloc(size);size===8?b.writeBigInt64BE(BigInt(n)):b.writeIntBE(n,0,size);return b;};
const tag=(t,n,b)=>Buffer.concat([Buffer.from([t]),str(n),b]);
const compound=items=>Buffer.concat([...items,Buffer.from([0])]);
export const level=(name='建筑世界',date=1700000000000)=>gzipSync(tag(10,'Ignored root',compound([tag(10,'Data',compound([tag(8,'LevelName',str(name)),tag(3,'DataVersion',num(3465)),tag(10,'Version',compound([tag(8,'Name',str('1.20.1'))])),tag(3,'GameType',num(1)),tag(4,'LastPlayed',num(date,8)),tag(10,'WorldGenSettings',compound([tag(4,'seed',num('9223372036854775806',8))]))]))])));
test('Java NBT reads world metadata without losing 64-bit seeds',async()=>{const d=await parseLevelData(level('§a测试 🌍'));assert.equal(d.name,'测试 🌍');assert.equal(d.version,'1.20.1');assert.equal(d.gameMode,1);assert.equal(d.dataVersion,3465);assert.equal(d.seed,'9223372036854775806');assert.equal(d.lastPlayed,1700000000000);});
test('Java modified UTF-8 surrogate pairs are decoded',async()=>{const s=Buffer.from([0,6,0xed,0xa0,0xbc,0xed,0xbc,0x8d]);const bytes=tag(10,'',compound([tag(10,'Data',compound([tag(8,'LevelName',s)]))]));assert.equal((await parseLevelData(bytes)).name,'🌍');});
test('list compounds cannot replace root metadata',async()=>{const nested=Buffer.concat([Buffer.from([10]),num(1),compound([tag(8,'LevelName',str('spoof'))])]);const bytes=tag(10,'',compound([tag(8,'LevelName',str('actual')),tag(9,'',nested)]));assert.equal((await parseLevelData(bytes)).name,'actual');});
test('malformed, truncated, oversized and deeply nested NBT are bounded',async()=>{for(const b of [Buffer.from([10]),Buffer.from([1,0,0]),Buffer.alloc(4*1024*1024+1),gzipSync(Buffer.alloc(17*1024*1024))])await assert.rejects(parseLevelData(b));let nested=Buffer.from([0]);for(let i=0;i<67;i++)nested=compound([tag(10,'nested',nested)]);await assert.rejects(parseLevelData(tag(10,'',nested)),/复杂/);const controller=new AbortController();controller.abort();await assert.rejects(parseLevelData(level(),{signal:controller.signal}));});
async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'joincraft-worlds-'));t.after(()=>rm(root,{recursive:true,force:true}));const game=path.join(root,'.minecraft');await mkdir(path.join(game,'saves'),{recursive:true});const worlds=new ManagedWorlds({getInstance:id=>id==='owned'?{id,root:game,managed:true}:null});const add=async(name,bytes=level(name))=>{const dir=path.join(game,'saves',name);await mkdir(dir);await writeFile(path.join(dir,'level.dat'),bytes);return dir;};return {root,game,worlds,add};}
test('owned worlds list newest first, show corrupt/backup rows and skip non-worlds',async t=>{const f=await fixture(t);await f.add('older',level('Old',100));await f.add('newer',level('New',200));const broken=await f.add('backup',Buffer.from('broken'));await writeFile(path.join(broken,'level.dat_old'),level('Recovered'));await f.add('corrupt',Buffer.from('broken'));await mkdir(path.join(f.game,'saves','not a save'));const list=await f.worlds.list('owned');assert.equal(list.worlds.length,4);assert.equal(list.worlds[0].name,'Recovered');assert.equal(list.worlds[0].readable,false);assert.deepEqual(list.worlds.filter(w=>w.readable).map(w=>w.name),['New','Old']);await assert.rejects(f.worlds.resolve('owned',list.worlds[0].id),/恢复/);const world=await f.worlds.resolve('owned',Buffer.from('newer').toString('base64url'));assert.equal(world.name,'newer');});
test('external directories, symlinks, traversal and linked level files are rejected',async t=>{const f=await fixture(t);await assert.rejects(f.worlds.list('external'),/Joincraft/);for(const name of ['..','../external','a\\b'])await assert.rejects(f.worlds.resolve('owned',Buffer.from(name).toString('base64url')));const out=path.join(f.root,'outside');await mkdir(out);await writeFile(path.join(out,'level.dat'),level('outside'));await symlink(out,path.join(f.game,'saves','linked'));assert.equal((await f.worlds.list('owned')).worlds.length,0);await assert.rejects(f.worlds.resolve('owned',Buffer.from('linked').toString('base64url')));const local=await f.add('local');await rm(path.join(local,'level.dat'));await symlink(path.join(out,'level.dat'),path.join(local,'level.dat'));assert.equal((await f.worlds.list('owned')).worlds[0].readable,false);});
test('missing saves is an empty state and list size is bounded',async t=>{const f=await fixture(t);await rm(path.join(f.game,'saves'),{recursive:true});assert.deepEqual(await f.worlds.list('owned'),{worlds:[],truncated:false});await mkdir(path.join(f.game,'saves'));await f.add('one');await f.add('two');f.worlds.maxWorlds=1;assert.equal((await f.worlds.list('owned')).truncated,true);});

// Synthetic Forge-style registry data: valid shallow NBT can exceed 200k tags.
let registryFixture;
function moddedLevel(){
 if(registryFixture)return registryFixture;
 const entries=[];
 for(let i=0;i<55000;i++)entries.push(tag(10,'item_'+i,compound([tag(3,'id',num(i)),tag(8,'name',str('examplemod:item_'+i)),tag(1,'enabled',Buffer.from([1]))])));
 const metadata=compound([tag(10,'forge',compound([tag(10,'registries',compound(entries))])),tag(8,'LevelName',str('模组世界')),tag(3,'DataVersion',num(3465)),tag(10,'Version',compound([tag(8,'Name',str('1.20.1'))])),tag(3,'GameType',num(0)),tag(4,'LastPlayed',num(1700000000000,8))]);
 registryFixture=gzipSync(tag(10,'',compound([tag(10,'Data',metadata)])));return registryFixture;
}
test('large Forge-style registry does not disable an otherwise valid world',async t=>{
 const bytes=moddedLevel(),data=await parseLevelData(bytes);assert.equal(data.name,'模组世界');assert.equal(data.dataVersion,3465);assert.equal(data.gameMode,0);assert.equal(data.version,'1.20.1');
 const f=await fixture(t),directory=await f.add('Modded world',bytes),before=await readFile(path.join(directory,'level.dat'));
 const result=await f.worlds.list('owned');assert.equal(result.worlds[0].readable,true);assert.equal(result.worlds[0].warning,null);assert.equal((await f.worlds.resolve('owned',result.worlds[0].id)).metadata.version,'1.20.1');assert.deepEqual(await readFile(path.join(directory,'level.dat')),before);
});
test('large unrelated numeric and string lists are skipped while later world metadata is read',async()=>{
 const count=250001,numeric=Buffer.concat([Buffer.from([3]),num(count),Buffer.alloc(count*4)]),strings=Buffer.concat([Buffer.from([8]),num(count),Buffer.alloc(count*2)]);
 const bytes=gzipSync(tag(10,'',compound([tag(10,'Data',compound([tag(9,'ModIds',numeric),tag(9,'ModLabels',strings),tag(8,'LevelName',str('After lists')),tag(3,'DataVersion',num(3465))]))])));
 const data=await parseLevelData(bytes);assert.equal(data.name,'After lists');assert.equal(data.dataVersion,3465);
});
test('unrelated dotted field names and nested list compounds cannot replace world metadata',async()=>{
 const bytes=tag(10,'',compound([tag(10,'Data',compound([tag(10,'Version',compound([tag(8,'Name',str('1.20.1')),tag(3,'Id',num(3465))])),tag(8,'Version.Name',str('spoof')),tag(3,'Version.Id',num(100)),tag(10,'forge',compound([tag(8,'LevelName',str('spoof'))])),tag(8,'LevelName',str('Actual'))]))]));
 const data=await parseLevelData(bytes);assert.equal(data.name,'Actual');assert.equal(data.version,'1.20.1');assert.equal(data.dataVersion,3465);
});
test('skipping unrelated NBT still rejects impossible lengths, truncated values and invalid wanted strings',async()=>{
 const bad=[tag(7,'ignored',num(-1)),tag(7,'ignored',num(12345)),tag(9,'ignored',Buffer.concat([Buffer.from([10]),num(2147483647)])),tag(9,'ignored',Buffer.concat([Buffer.from([0]),num(1)])),tag(11,'ignored',num(2147483647)),tag(12,'ignored',num(-1)),tag(3,'ignored',Buffer.from([0])),tag(8,'LevelName',Buffer.from([0,1,0xff]))];
 for(const entry of bad)await assert.rejects(parseLevelData(tag(10,'',compound([entry]))));
});
