import {gunzip} from 'node:zlib';
import {promisify} from 'node:util';
export const MAX_LEVEL_BYTES=4*1024*1024;
const MAX_UNCOMPRESSED_BYTES=16*1024*1024;
const MAX_DEPTH=64;
const scalarWidths=[0,1,2,4,8,4,8];
const minimumWidths=[0,1,2,4,8,4,8,4,2,5,1,4,4];
// Exact path components prevent unrelated mod fields such as "Version.Id"
// from replacing the actual Data.Version.Id compound value.
const metadata=new Map();
for(const [key,type] of [['LevelName',8],['DataVersion',3],['Version.Name',8],['Version.Id',3],['Version.Snapshot',1],['GameType',3],['hardcore',1],['Difficulty',1],['LastPlayed',4],['RandomSeed',4],['WorldGenSettings.seed',4],['SpawnX',3],['SpawnY',3],['SpawnZ',3],['allowCommands',1]]){
 const parts=key.split('.');let children=metadata;
 for(const part of parts.slice(0,-1)){if(!children.has(part))children.set(part,{children:new Map()});children=children.get(part).children;}
 children.set(parts.at(-1),{key,type});
}
const rootFields=new Map(metadata);rootFields.set('Data',{children:metadata});
// Java NBT uses DataInput's modified UTF-8, including UTF-16 surrogate pairs.
function decodeString(buffer){
  const units=[];for(let i=0;i<buffer.length;){const a=buffer[i++];if(a<128){units.push(a);continue;}const b=buffer[i++];if(b===undefined||(b&192)!==128)throw Error('存档字符串编码无效');if((a&224)===192){units.push(((a&31)<<6)|(b&63));continue;}const c=buffer[i++];if(c===undefined||(c&192)!==128)throw Error('存档字符串编码无效');if((a&240)===224){units.push(((a&15)<<12)|((b&63)<<6)|(c&63));continue;}const d=buffer[i++];if((a&248)!==240||d===undefined||(d&192)!==128)throw Error('存档字符串编码无效');const cp=((a&7)<<18)|((b&63)<<12)|((c&63)<<6)|(d&63);if(cp>0x10ffff||cp<0x10000)throw Error('存档字符串编码无效');units.push(0xd800+((cp-0x10000)>>10),0xdc00+((cp-0x10000)&1023));}
  let value='';for(let i=0;i<units.length;i+=4096)value+=String.fromCharCode(...units.slice(i,i+4096));return value;
}
export async function parseLevelData(input,{signal}={}){
  signal?.throwIfAborted();
  if(!Buffer.isBuffer(input)||input.length>MAX_LEVEL_BYTES)throw Error('存档信息文件过大');
  const buffer=input[0]===31&&input[1]===139?await promisify(gunzip)(input,{maxOutputLength:MAX_UNCOMPRESSED_BYTES}):input;
  signal?.throwIfAborted();
  let offset=0;const result=new Map();
  const take=n=>{if(!Number.isSafeInteger(n)||n<0||offset+n>buffer.length)throw Error('存档信息不完整');const start=offset;offset+=n;return start;};
  const u8=()=>buffer.readUInt8(take(1)),i32=()=>buffer.readInt32BE(take(4));
  const skipString=()=>take(buffer.readUInt16BE(take(2)));
  const string=()=>{const length=buffer.readUInt16BE(take(2));return decodeString(buffer.subarray(take(length),offset));};
  const guard=depth=>{if(depth>MAX_DEPTH)throw Error('存档信息结构过于复杂');signal?.throwIfAborted();};
  const count=()=>{const value=i32();if(value<0)throw Error('存档数组长度无效');return value;};

  // Forge registry trees can legitimately exceed 200k tags. Unknown payloads
  // are skipped without decoding names/values or building arrays/objects.
  // Every iteration consumes bytes: bounded input + depth, rather than a tag
  // count, limits work while allowing large, shallow mod registries.
  function skip(type,depth){
    guard(depth);
    if(scalarWidths[type]){take(scalarWidths[type]);return;}
    switch(type){
      case 7:take(count());return;
      case 8:skipString();return;
      case 9:{
        const child=u8(),length=i32();
        if(length<0||child>12||(!child&&length)||length>Math.floor((buffer.length-offset)/(minimumWidths[child]||1)))throw Error('存档列表长度无效');
        if(scalarWidths[child]){if(length)guard(depth+1);take(length*scalarWidths[child]);return;}
        for(let i=0;i<length;i++)skip(child,depth+1);
        return;
      }
      case 10:
        for(;;){const child=u8();if(!child)return;if(child>12)throw Error('存档标签类型无效');skipString();skip(child,depth+1);}
      case 11:take(count()*4);return;
      case 12:take(count()*8);return;
      default:throw Error('存档标签类型无效');
    }
  }
  function compound(fields,depth){
    guard(depth);
    for(;;){
      const type=u8();if(!type)return;if(type>12)throw Error('存档标签类型无效');
      const field=fields.get(string());
      if(field?.children&&type===10){compound(field.children,depth+1);continue;}
      if(field?.type===type){
        guard(depth+1);
        const value=type===1?buffer.readInt8(take(1)):type===3?i32():type===4?buffer.readBigInt64BE(take(8)):string();
        result.set(field.key,value);
      }else skip(type,depth+1);
    }
  }
  if(u8()!==10)throw Error('仅支持 Java 版 level.dat 存档');
  skipString();compound(rootFields,0);
  const integer=key=>Number.isSafeInteger(result.get(key))?result.get(key):null;
  const long=key=>typeof result.get(key)==='bigint'?result.get(key):null;
  const name=result.get('LevelName'),version=result.get('Version.Name'),lastPlayed=long('LastPlayed'),seed=long('WorldGenSettings.seed')??long('RandomSeed');
  return {name:typeof name==='string'?name.replace(/§[0-9a-fk-or]/gi,'').replace(/[\x00-\x1f]/g,'').slice(0,160):'',version:typeof version==='string'?version.slice(0,80):null,dataVersion:integer('DataVersion')??integer('Version.Id'),snapshot:result.get('Version.Snapshot')===1,gameMode:integer('GameType'),hardcore:result.get('hardcore')===1,difficulty:integer('Difficulty'),lastPlayed:lastPlayed!==null&&lastPlayed>0n&&lastPlayed<8640000000000000n?Number(lastPlayed):null,seed:seed?.toString()??null,spawn:{x:integer('SpawnX'),y:integer('SpawnY'),z:integer('SpawnZ')},allowCommands:result.get('allowCommands')===1};
}
