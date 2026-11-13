import path from 'node:path';
import os from 'node:os';
import {readdir,realpath,stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {probeJava} from './launch.mjs';

export function javaSearchLocations({platform=process.platform,env=process.env,home=os.homedir(),root,selected}={}){
  const p=platform==='win32'?path.win32:path.posix;
  const folders=[],executables=[];
  const add=(base,...parts)=>{if(base&&p.isAbsolute(base))folders.push(p.join(base,...parts));};
  add(env.JAVA_HOME);add(env.JDK_HOME);add(home,'.jdks');add(home,'.sdkman','candidates','java');
  for(const bin of (env.PATH||env.Path||'').split(platform==='win32'?';':':'))if(p.isAbsolute(bin.replace(/^"|"$/g,'')))executables.push(p.join(bin.replace(/^"|"$/g,''),platform==='win32'?'java.exe':'java'));
  for(const base of new Set([selected,root,root&&p.dirname(root)].filter(Boolean))){
    for(const folder of ['java','jre','jdk','runtime','PCL/Java'])add(base,...folder.split('/'));
  }
  if(platform==='win32'){
    for(const base of new Set([env.ProgramFiles,env['ProgramFiles(x86)'],env.ProgramW6432].filter(Boolean))){
      for(const vendor of ['Java','Eclipse Adoptium','Eclipse Foundation','Microsoft','Amazon Corretto','Zulu','BellSoft','Semeru','Minecraft Launcher/runtime','Minecraft/runtime'])add(base,...vendor.split('/'));
    }
    add(env.APPDATA,'.minecraft','runtime');add(env.LOCALAPPDATA,'Programs','Eclipse Adoptium');add(env.LOCALAPPDATA,'.ftba','bin','runtime');add(home,'curseforge','minecraft','Install','runtime');
  }else if(platform==='darwin'){
    add('/Library/Java/JavaVirtualMachines');add(home,'Library','Java','JavaVirtualMachines');
    add('/opt/homebrew/opt');add('/usr/local/opt');
  }else{add('/usr/lib/jvm');add('/usr/java');add('/opt/java');}
  return {folders:[...new Set(folders)],executables:[...new Set(executables)]};
}
async function registryJavaPaths(){
  const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32','reg.exe');
  const result=[];
  // Query only Java installation keys, never enumerate PCL accounts or credentials.
  for(const view of ['64','32'])try{
    const {stdout}=await promisify(execFile)(executable,['query','HKLM\\SOFTWARE\\JavaSoft','/s',`/reg:${view}`],{windowsHide:true,shell:false,timeout:2500,maxBuffer:256*1024});
    for(const line of stdout.split(/\r?\n/)){const match=line.match(/^\s*JavaHome\s+REG_SZ\s+(.+)$/i);if(match)result.push(path.join(match[1].trim(),'bin','java.exe'));}
  }catch{}
  return result;
}
export async function discoverJava({root,selected,savedPath,platform=process.platform,locations,probe=probeJava,maxCandidates=48,maxDirectories=600}={}){
  const search=locations||javaSearchLocations({root,selected,platform});
  const candidates=[savedPath,...search.executables].filter(Boolean);
  if(!locations&&platform==='win32')candidates.push(...await registryJavaPaths());
  const queue=search.folders.map(folder=>({folder,depth:0})),visited=new Set();
  const names=platform==='win32'?['java.exe']:['java'];let directories=0;
  const add=async file=>{if(await stat(file).then(s=>s.isFile(),()=>false))candidates.push(file);};
  while(queue.length&&directories<maxDirectories&&candidates.length<maxCandidates*4){
    const {folder,depth}=queue.shift();const canonical=await realpath(folder).catch(()=>null);
    if(!canonical||visited.has(canonical))continue;visited.add(canonical);directories++;
    for(const name of names){await add(path.join(canonical,name));await add(path.join(canonical,'bin',name));await add(path.join(canonical,'Contents','Home','bin',name));}
    if(depth>=5)continue;
    const entries=await readdir(canonical,{withFileTypes:true}).catch(()=>[]);
    for(const entry of entries.slice(0,120)){
      if(!entry.isDirectory()&&!entry.isSymbolicLink())continue;
      if(/^(?:lib|jmods|legal|include|conf|man|mods|saves|assets|libraries|node_modules|\.git)$/i.test(entry.name))continue;
      if(/\/(?:homebrew|local)\/opt$/.test(canonical)&&!/(?:openjdk|java|temurin|corretto|zulu)/i.test(entry.name))continue;
      queue.push({folder:path.join(canonical,entry.name),depth:depth+1});
    }
  }
  const unique=[];const seen=new Set();
  for(const candidate of candidates){
    const canonical=await realpath(candidate).catch(()=>null);if(!canonical)continue;
    if(platform==='darwin'&&canonical==='/usr/bin/java')continue; // macOS installer stub, not an installed JVM
    const key=platform==='win32'?canonical.toLowerCase():canonical;
    if(seen.has(key))continue;seen.add(key);unique.push(canonical);if(unique.length>=maxCandidates)break;
  }
  let cursor=0;const installations=[];
  await Promise.all(Array.from({length:3},async()=>{while(cursor<unique.length){const file=unique[cursor++];try{installations.push(await probe(file,{timeout:4000}));}catch{}}}));
  return installations.sort((a,b)=>b.major-a.major||a.path.localeCompare(b.path));
}
