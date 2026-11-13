import {gunzip} from 'node:zlib';
import {promisify} from 'node:util';
export const MAX_LEVEL_BYTES=4*1024*1024;
const wanted=new Set(['LevelName','DataVersion','Version.Name','Version.Id','Version.Snapshot','GameType','hardcore','Difficulty','LastPlayed','RandomSeed','WorldGenSettings.seed','SpawnX','SpawnY','SpawnZ','DayTime','Time','allowCommands']);
// Java NBT uses DataInput's modified UTF-8, including UTF-16 surrogate pairs.
function decodeString(buffer){
  const units=[];for(let i=0;i<buffer.length;){const a=buffer[i++];if(a<128){units.push(a);continue;}const b=buffer[i++];if(b===undefined||(b&192)!==128)throw Error('存档字符串编码无效');if((a&224)===192){units.push(((a&31)<<6)|(b&63));continue;}const c=buffer[i++];if(c===undefined||(c&192)!==128)throw Error('存档字符串编码无效');if((a&240)===224){units.push(((a&15)<<12)|((b&63)<<6)|(c&63));continue;}const d=buffer[i++];if((a&248)!==240||d===undefined||(d&192)!==128)throw Error('存档字符串编码无效');const cp=((a&7)<<18)|((b&63)<<12)|((c&63)<<6)|(d&63);if(cp>0x10ffff||cp<0x10000)throw Error('存档字符串编码无效');units.push(0xd800+((cp-0x10000)>>10),0xdc00+((cp-0x10000)&1023));}
  let value='';for(let i=0;i<units.length;i+=4096)value+=String.fromCharCode(...units.slice(i,i+4096));return value;
}
export async function parseLevelData(input,{signal}={}){
  signal?.throwIfAborted();if(!Buffer.isBuffer(input)||input.length>MAX_LEVEL_BYTES)throw Error('存档信息文件过大');
  const buffer=input[0]===31&&input[1]===139?await promisify(gunzip)(input,{maxOutputLength:16*1024*1024}):input;signal?.throwIfAborted();
  let offset=0,tags=0;const result=new Map();
  const take=n=>{if(!Number.isSafeInteger(n)||n<0||offset+n>buffer.length)throw Error('存档信息不完整');const start=offset;offset+=n;return start;};
  const u8=()=>buffer.readUInt8(take(1)),i32=()=>buffer.readInt32BE(take(4));
  const string=()=>{const length=buffer.readUInt16BE(take(2));return decodeString(buffer.subarray(take(length),offset));};
  function read(type,key,depth){
    if(++tags>200000||depth>64)throw Error('存档信息结构过于复杂');signal?.throwIfAborted();let value;
    switch(type){
      case 1:value=buffer.readInt8(take(1));break;case 2:value=buffer.readInt16BE(take(2));break;case 3:value=i32();break;case 4:value=buffer.readBigInt64BE(take(8));break;
      case 5:value=buffer.readFloatBE(take(4));break;case 6:value=buffer.readDoubleBE(take(8));break;
      case 7:take(i32());return;case 8:value=string();break;
      case 9:{const child=u8(),count=i32();if(count<0||count>200000||child>12||(!child&&count))throw Error('存档列表长度无效');for(let i=0;i<count;i++)read(child,key+'[]',depth+1);return;}
      case 10:for(;;){const child=u8();if(child===0)return;if(child>12)throw Error('存档标签类型无效');const name=string();read(child,key==='?'||key.length>512||name.length>128?'?':key?key+'.'+name:name,depth+1);} 
      case 11:{const count=i32();if(count<0)throw Error('存档数组长度无效');take(count*4);return;}
      case 12:{const count=i32();if(count<0)throw Error('存档数组长度无效');take(count*8);return;}
      default:throw Error('存档标签类型无效');
    }
    const relative=key.startsWith('Data.')?key.slice(5):key;if(wanted.has(relative))result.set(relative,value);
  }
  if(u8()!==10)throw Error('仅支持 Java 版 level.dat 存档');const rootName=string();read(10,'',0);
  const integer=key=>Number.isSafeInteger(result.get(key))?result.get(key):null;
  const long=key=>typeof result.get(key)==='bigint'?result.get(key):null;
  const name=result.get('LevelName'),version=result.get('Version.Name'),lastPlayed=long('LastPlayed'),seed=long('WorldGenSettings.seed')??long('RandomSeed');
  return {name:typeof name==='string'?name.replace(/§[0-9a-fk-or]/gi,'').replace(/[\x00-\x1f]/g,'').slice(0,160):'',version:typeof version==='string'?version.slice(0,80):null,dataVersion:integer('DataVersion')??integer('Version.Id'),snapshot:result.get('Version.Snapshot')===1,gameMode:integer('GameType'),hardcore:result.get('hardcore')===1,difficulty:integer('Difficulty'),lastPlayed:lastPlayed!==null&&lastPlayed>0n&&lastPlayed<8640000000000000n?Number(lastPlayed):null,seed:seed?.toString()??null,spawn:{x:integer('SpawnX'),y:integer('SpawnY'),z:integer('SpawnZ')},allowCommands:result.get('allowCommands')===1};
}
