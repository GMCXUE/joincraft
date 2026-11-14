// Read a user-selected pack without executing JARs or touching existing instances.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,copyFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {inspectMrpack,extractMrpackOverrides} from '../shared/pack-format.mjs';
import {scanMods} from '../launcher/mod-metadata.mjs';
const archive=process.argv[2];if(!archive)throw Error('Usage: node scripts/test-mods-large.mjs <pack.zip>');
const temp=await mkdtemp(path.join(os.tmpdir(),'joincraft-mod-large-'));
try{const pack=await inspectMrpack(archive),embedded=pack.overrides.filter(f=>/^mods\/[^/]+\.jar$/i.test(f.path));await extractMrpackOverrides(archive,embedded,temp);const files=await scanMods(temp);console.log(JSON.stringify({name:pack.name,downloadRefs:pack.files.filter(f=>f.path.startsWith('mods/')).length,embedded:files.length,statuses:files.reduce((s,f)=>(s[f.status]=(s[f.status]||0)+1,s),{}),warnings:files.filter(f=>f.status==='broken').map(f=>({file:f.fileName,warnings:f.warnings}))}));assert(files.length>0);assert.equal(files.filter(f=>f.status==='broken').length,0);
const target=path.join(temp,'large');await mkdir(path.join(target,'mods'),{recursive:true});for(let i=0;i<425;i++){const source=files[i%files.length];await copyFile(path.join(temp,'mods',source.fileName),path.join(target,'mods',String(i)+'.jar'));}const start=Date.now(),large=await scanMods(target);assert.equal(large.length,425);assert.equal(large.filter(f=>f.status==='broken').length,0);console.log(JSON.stringify({largeFiles:large.length,scanMs:Date.now()-start,rssMB:Math.round(process.memoryUsage().rss/1024**2)}));}finally{await rm(temp,{recursive:true,force:true});}
