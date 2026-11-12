export const loaders=['原版','Fabric','Forge','NeoForge'];
export const exampleInstance={id:'example-vanilla',name:'原版生存',version:'1.21.1',loader:'原版',port:'',example:true};
export function validateInstance(input){
 const name=String(input.name||'').trim(),version=String(input.version||'').trim(),loader=String(input.loader||'');
 const raw=String(input.port??'').trim(),port=raw?Number(raw):'';
 if(!name||name.length>40)throw new Error('实例名称需要 1–40 个字符');
 if(!version||version.length>30)throw new Error('请填写游戏版本，最多 30 个字符');
 if(!loaders.includes(loader))throw new Error('请选择游戏环境');
 if(raw&&(!Number.isInteger(port)||port<1024||port>65535))throw new Error('端口需要为 1024–65535 的整数，也可以暂不填写');
 return {name,version,loader,port};
}
export function parseInstances(raw){
 if(!raw)return [];
 try{const data=JSON.parse(raw);if(!Array.isArray(data))return [];
 const ids=new Set();return data.slice(0,40).flatMap(x=>{try{if(!x||typeof x.id!=='string'||ids.has(x.id))return [];const item={...validateInstance(x),id:x.id};ids.add(x.id);return[item];}catch{return[];}});
 }catch{return [];}
}
