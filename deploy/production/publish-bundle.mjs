import {readFile,copyFile,rename,chmod,stat,access,symlink,unlink} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {verify,createHash} from 'node:crypto';
const root='/var/lib/docker/volumes/remotescreen_caddy_data/_data/joincraft-releases';
const version=process.argv[2];if(!/^\d+\.\d+\.\d+$/.test(version||''))throw Error('Expected stable version argument');
const {publicKey}=JSON.parse(await readFile('/tmp/update-config.json'));
async function authenticate(name,expectedFile,kind){
 const envelope=JSON.parse(await readFile('/tmp/'+name));
 const payload=Buffer.from(envelope.payload,'base64');
 if(!verify(null,payload,publicKey,Buffer.from(envelope.signature,'base64')))throw Error('Signature invalid: '+name);
 const info=JSON.parse(payload);
 if(info.schema!==1||info.version!==version||info.platform!=='win32'||info.arch!=='x64'||info.file!==expectedFile||(kind&&info.kind!==kind)||!Number.isSafeInteger(info.size)||info.size<=0||info.size>512*1024*1024||!/^[a-f0-9]{128}$/.test(info.sha512))throw Error('Unexpected release metadata: '+name);
 const source='/tmp/'+info.file;
 if((await stat(source)).size!==info.size)throw Error('Size invalid: '+info.file);
 const hash=createHash('sha512');for await(const chunk of createReadStream(source))hash.update(chunk);
 if(hash.digest('hex')!==info.sha512)throw Error('Checksum invalid: '+info.file);
 await access(root+'/'+info.file).then(()=>{throw Error('Immutable version already published: '+info.file);},()=>{});
 return info;
}
// Verify both first-install and in-app update artifacts before changing any live pointers.
const bundle=await authenticate('windows-x64.json',`joincraft-${version}-win-x64.zip`);
const installer=await authenticate('windows-x64-setup.json',`joincraft-${version}-win-x64-setup.exe`,'installer');
if(process.argv[3]==='--check-only'){console.log('Verified installer and update bundle:',version);process.exit(0);}
for(const info of [bundle,installer]){
 const target=root+'/'+info.file;
 await copyFile('/tmp/'+info.file,target+'.next');await chmod(target+'.next',0o644);await rename(target+'.next',target);
}
for(const [alias,file] of [['joincraft-windows-x64.zip',bundle.file],['joincraft-setup.exe',installer.file]]){
 await unlink(root+'/'+alias+'.next').catch(e=>{if(e.code!=='ENOENT')throw e;});
 await symlink(file,root+'/'+alias+'.next');await rename(root+'/'+alias+'.next',root+'/'+alias);
}
const feed=root+'/windows-x64.json';
await copyFile(feed,`/opt/joincraft/backups/windows-x64-before-${version}.json`).catch(e=>{if(e.code!=='ENOENT')throw e;});
// The NSIS latest.yml channel remains untouched; current clients only consume the signed bundle feed.
for(const name of ['windows-x64-setup.json','windows-x64.json']){
 await copyFile('/tmp/'+name,root+'/'+name+'.next');await chmod(root+'/'+name+'.next',0o644);await rename(root+'/'+name+'.next',root+'/'+name);
}
console.log('Published installer:',installer.file,installer.size);
console.log('Published authenticated update bundle:',bundle.file,bundle.size);
