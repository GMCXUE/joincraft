import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {once} from 'node:events';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import yazl from 'yazl';
import {createHash} from 'node:crypto';
import {createApp} from './server.mjs';
import {GamePlay} from './desktop/game-play.mjs';
import {createPlayAPI} from './desktop/play-api.mjs';
import {HostHelper} from './launcher/host-helper.mjs';
import {packet,varint,status} from './bridge/minecraft.mjs';
const wait=async fn=>{for(let i=0;i<100;i++){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,20));}throw Error('State did not settle');};
test('native host-to-guest flow uses a verified private helper and real HTTPS-compatible relay, with simulated MC only',async t=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'joincraft-native-flow-')),app=await createApp({port:0,dbPath:':memory:',packDir:path.join(temp,'server-packs')}),sockets=new Set(),plays=[];
 const mc=net.createServer(socket=>{sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));socket.on('data',()=>{const json=Buffer.from(JSON.stringify({version:{name:'Forge 1.20.1 simulation',protocol:763}}));socket.end(packet(Buffer.concat([varint(0),varint(json.length),json])));});});mc.listen(0,'127.0.0.1');await once(mc,'listening');
 t.after(async()=>{for(const play of plays)await play.stop();for(const s of sockets)s.destroy();await new Promise(r=>mc.close(r));await app.close();await rm(temp,{recursive:true,force:true});});
 const request=async(route,body,token)=>{const response=await fetch(app.url+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();assert(response.ok,data.error);return data;};
 const host=(await request('/api/session',{name:'Host'})).id,guest=(await request('/api/session',{name:'Guest'})).id,room=await request('/api/rooms',{name:'Native simulated test',capacity:4},host);await request('/api/join',{code:room.code},guest);
 const zip=new yazl.ZipFile();zip.addBuffer(Buffer.from(JSON.stringify({formatVersion:1,game:'minecraft',name:'Simulation pack',versionId:'1',dependencies:{minecraft:'1.20.1',forge:'47.3.33'},files:[]})),'modrinth.index.json');zip.end();const chunks=[];for await(const chunk of zip.outputStream)chunks.push(chunk);
 const resources=path.join(temp,'component-resource');await mkdir(resources);const component=Buffer.alloc(200,1),componentFile='host-helper-1.0.0.jar';await writeFile(path.join(resources,componentFile),component);await writeFile(path.join(resources,'manifest.json'),JSON.stringify({schema:1,coordinate:'com.joincraft:host-helper:1.0.0',file:componentFile,size:component.length,sha256:createHash('sha256').update(component).digest('hex')}));
 // Synthetic component bytes keep Node tests independent of a Java build. The real JAR is separately built and parsed by Forge's locator test.
 const uploaded=await request('/api/rooms/'+room.id+'/pack',{archive:Buffer.concat(chunks).toString('base64')},host);const pack=uploaded.pack;
 async function client(token,role){const root=path.join(temp,role,'.minecraft');await mkdir(path.join(root,'mods'),{recursive:true});await writeFile(path.join(root,'mods','original.jar'),'original simulation mod');const instance={id:'owned-'+role,managed:true,root,minecraft:'1.20.1',loader:'Forge',pack};let target;
  const play=new GamePlay({server:app.url,api:createPlayAPI({serverURL:app.url,getHeaders:async()=>({Authorization:'Bearer '+token})}),worlds:{resolve:async()=>({name:'World 你好',metadata:{version:'1.20.1',dataVersion:3465}})},helper:new HostHelper({resources,poll:5}),getInstance:()=>instance,matching:async sha=>({status:sha===pack.sha512?'ready':'changed',instance}),launcher:{start:async(input,value)=>{target=value;if(value.helper){const data=JSON.parse(await readFile(value.helper.request,'utf8'));assert.equal(data.world,'World 你好');await writeFile(value.helper.request+'.status',JSON.stringify({schema:1,nonce:data.nonce,port:data.port,state:'ready'}));}return {started:true};}}});plays.push(play);return {play,instance,target:()=>target};
 }
 const owner=await client(host,'host'),member=await client(guest,'guest');await owner.play.select(room.id);await owner.play.launch({id:owner.instance.id},{worldId:'world',port:mc.address().port});await owner.play.active.settled;
 await wait(async()=>(await request('/api/state',undefined,guest)).rooms[0].connection.status==='online');
 await member.play.select(room.id);await member.play.launch({id:member.instance.id});const address=member.target().address;assert.match(address,/^127\.0\.0\.1:\d+$/);assert.equal((await status(Number(address.split(':')[1]))).version,'Forge 1.20.1 simulation');assert.deepEqual(await readdir(path.join(owner.instance.root,'mods')),['original.jar']);assert.deepEqual(await readdir(path.join(member.instance.root,'mods')),['original.jar']);
 await owner.play.stop();await wait(async()=>{try{await status(Number(address.split(':')[1]),100);return false;}catch{return true;}});assert.equal((await request('/api/state',undefined,guest)).rooms[0].connection.status,'offline');
});
