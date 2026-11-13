import os from 'node:os';
const MB=1048576,STEP=256;
const down=value=>Math.floor(value/STEP)*STEP;
/** Physical system memory, not the VPS or Electron renderer heap. */
export function memorySnapshot({totalBytes=os.totalmem(),availableBytes=os.freemem(),now=Date.now()}={}){
 if(!Number.isFinite(totalBytes)||totalBytes<MB||!Number.isFinite(availableBytes)||availableBytes<0)throw Error('无法读取系统内存');
 const totalMB=Math.floor(totalBytes/MB),availableMB=Math.min(totalMB,Math.floor(availableBytes/MB));
 const reserveMB=Math.max(1024,Math.min(4096,down(totalMB*.1)));
 const maxMB=Math.max(512,Math.min(32768,down(totalMB-reserveMB)));
 // reserveMB/maxMB bound custom settings only. Automatic means ALL currently available RAM.
 const recommendedMB=availableMB;
 return {totalMB,availableMB,usedMB:totalMB-availableMB,reserveMB,maxMB,recommendedMB,lowMemory:availableMB<512,sampledAt:now};
}
export function resolveMemory(input,snapshot=memorySnapshot()){
 const mode=input.memoryMode??'custom';
 if(!['auto','custom'].includes(mode))throw Error('请选择自动配置或自定义内存');
 if(mode==='auto'){
  if(!Number.isInteger(snapshot.availableMB)||snapshot.availableMB<512||snapshot.availableMB>snapshot.totalMB)throw Error('当前可用内存不足，请关闭部分程序后再启动游戏');
  return snapshot.availableMB;
 }
 const memoryMB=Number(input.memoryMB);
 if(!Number.isInteger(memoryMB)||memoryMB<512||memoryMB>snapshot.maxMB||memoryMB>snapshot.totalMB)throw Error(`游戏内存需在 512 MB 与 ${snapshot.maxMB} MB 之间`);
 return memoryMB;
}

export function availableFromVmStat(text){
 const page=Number(text.match(/page size of (\d+) bytes/i)?.[1]);
 const count=label=>Number(text.match(new RegExp(`^${label}:\\s*(\\d+)\\.?`,'m'))?.[1]);
 const free=count('Pages free'),inactive=count('Pages inactive'),speculative=count('Pages speculative');
 if(!page||![free,inactive,speculative].every(Number.isFinite))throw Error('无法识别系统内存统计');
 // Purgeable pages can already be counted as inactive: do not add them twice.
 return (free+inactive+speculative)*page;
}
export async function readSystemMemory({platform=process.platform,totalBytes=os.totalmem(),freeBytes=os.freemem(),readFileImpl,execImpl}={}){
 let availableBytes=freeBytes,approximate=false;
 if(platform==='linux'){
  try{const read=readFileImpl||(await import('node:fs/promises')).readFile;const text=await read('/proc/meminfo','utf8');const available=Number(text.match(/^MemAvailable:\s*(\d+)\s+kB/m)?.[1]);if(!Number.isFinite(available))throw Error('Missing MemAvailable');availableBytes=available*1024;}catch{approximate=true;}
 }else if(platform==='darwin'){
  try{let exec=execImpl;if(!exec){const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');exec=promisify(execFile);}const {stdout}=await exec('/usr/bin/vm_stat',[],{timeout:1500,maxBuffer:65536,windowsHide:true,shell:false});availableBytes=availableFromVmStat(stdout);}catch{/* Conservative free-only fallback. */}
  approximate=true;
 }
 return {...memorySnapshot({totalBytes,availableBytes}),approximate};
}
