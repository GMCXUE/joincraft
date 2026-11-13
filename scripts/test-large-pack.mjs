import {createRequire} from 'node:module';
import {createWriteStream} from 'node:fs';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import assert from 'node:assert/strict';
const root=new URL('..',import.meta.url).pathname.replace(/\/$/,''),require=createRequire(root+'/package.json'),yazl=require('yazl');
const {createApp}=await import(root+'/server.mjs');
const {PackTransfer}=await import(root+'/desktop/pack-transfer.mjs');
const {ManagedPacks}=await import(root+'/launcher/pack-installer.mjs');
const {MAX_PACK_BYTES,archiveHash}=await import(root+'/shared/pack-format.mjs');
const dir=await mkdtemp('/tmp/joincraft-600mb-'),archive=dir+'/600mb.mrpack';let app,peak=0;
const memory=setInterval(()=>{peak=Math.max(peak,process.memoryUsage().rss);},50);
try{
 const payload=MAX_PACK_BYTES-4096,index={formatVersion:1,game:'minecraft',name:'600 MB 流式测试',versionId:'1',dependencies:{minecraft:'1.20.1'},files:[]};
 const zip=new yazl.ZipFile();zip.addBuffer(Buffer.from(JSON.stringify(index)),'modrinth.index.json');
 zip.addReadStream(Readable.from((async function*(){const chunk=Buffer.alloc(64*1024,0x71);for(let offset=0;offset<payload;offset+=chunk.length)yield chunk.subarray(0,Math.min(chunk.length,payload-offset));})()),'overrides/config/large.bin',{compress:false,size:payload});zip.end();await pipeline(zip.outputStream,createWriteStream(archive));
 const size=(await stat(archive)).size;assert.ok(size<=MAX_PACK_BYTES&&size>599*1024*1024);console.log('Archive bytes:',size);
 app=await createApp({port:0,dbPath:dir+'/server/app.sqlite'});
 const json=async(route,body,token)=>{const response=await fetch(app.url+route,{method:body===undefined?'GET':'POST',headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{'X-Session':token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});assert.equal(response.ok,true,await response.clone().text());return response.json();};
 const host=(await json('/api/session',{name:'大包房主'})).id,member=(await json('/api/session',{name:'大包成员'})).id,room=await json('/api/rooms',{name:'600 MB 测试'},host);await json('/api/join',{code:room.code},member);
 const h=new PackTransfer({serverURL:app.url,getDirectory:()=>dir+'/host',getHeaders:async()=>({'X-Session':host})});const chosen=await h.inspect(archive);console.log('Native file inspection passed');
 await h.publish({roomId:room.id,draftId:chosen.draftId});assert.equal((await stat(dir+'/server/packs/files/'+chosen.pack.sha512+'.mrpack')).size,size);console.log('600 MB upload and server verification passed');
 const m=new PackTransfer({serverURL:app.url,getDirectory:()=>dir+'/member',getHeaders:async()=>({'X-Session':member})});const downloaded=await m.download({roomId:room.id,sha512:chosen.pack.sha512});assert.equal(await archiveHash(downloaded.file),chosen.pack.sha512);console.log('600 MB member streaming download passed');
 const installer=new ManagedPacks({root:dir+'/member',engine:async()=>({version:'1.20.1',java:{path:'/mock/java',major:17}})});const installed=await installer.install(downloaded.file,chosen.pack.sha512);
 assert.equal((await stat(installed.root+'/config/large.bin')).size,payload);assert.equal((await stat(installed.root+'/../pack.mrpack')).size,size);console.log('600 MB streamed extraction, local archive and durable library registration passed');
 console.log('Peak combined client + server RSS MB:',Math.round(peak/1024/1024));assert.ok(peak<450*1024*1024,'Streaming regression: unexpectedly large RSS');
}finally{clearInterval(memory);await app?.close();await rm(dir,{recursive:true,force:true});}
