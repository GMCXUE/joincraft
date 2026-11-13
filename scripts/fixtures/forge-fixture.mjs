import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import yazl from 'yazl';
export async function forgeFixture({loaderKey='forge',mode='success'}={}){
  const root=await mkdtemp(path.join(tmpdir(),'joincraft-forge-fixture-'));
  const pack={minecraft:'1.20.1',loaderKey,loaderVersion:loaderKey==='forge'?'47.3.33':'20.4.237'},id=pack.minecraft+'-'+loaderKey+'-fixture';
  const profile={spec:1,profile:loaderKey,version:id,minecraft:pack.minecraft,json:'/version.json',path:'net.minecraftforge:forge:1.20.1-47.3.33',data:{},processors:[],libraries:[]};
  const version={id,inheritsFrom:pack.minecraft,mainClass:'net.minecraft.client.main.Main',libraries:[],arguments:{game:[],jvm:[]}};
  const zip=new yazl.ZipFile();zip.addBuffer(Buffer.from(JSON.stringify(profile)),'install_profile.json');zip.addBuffer(Buffer.from(JSON.stringify(version)),'version.json');zip.addBuffer(Buffer.alloc(256*1024,1),'fixture-padding.bin',{compress:false});zip.end();const chunks=[];for await(const chunk of zip.outputStream)chunks.push(chunk);const archive=Buffer.concat(chunks);
  await mkdir(path.join(root,'versions',pack.minecraft),{recursive:true});await writeFile(path.join(root,'versions',pack.minecraft,pack.minecraft+'.json'),JSON.stringify({id:pack.minecraft,type:'release',mainClass:'net.minecraft.client.main.Main',assets:'test',libraries:[],arguments:{game:[],jvm:[]}}));
  let reached;const entered=new Promise(resolve=>reached=resolve),requests=[],sockets=new Set();
  const server=createServer((req,res)=>{
    requests.push({method:req.method,path:req.url});reached();
    if(mode==='reset'){res.destroy();return;}
    if(mode==='redirect'&&req.url!=='/artifact.jar'){res.writeHead(302,{Location:'/artifact.jar'});res.end();return;}
    if(mode==='http-error'){res.writeHead(503,{'Content-Length':11});res.end('unavailable');return;}
    res.writeHead(200,{'Content-Length':archive.length});
    if(mode==='pending'){res.flushHeaders();return;}
    res.end(req.method==='HEAD'?undefined:archive);
  });
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  const installerRequire=createRequire(import.meta.resolve('@xmcl/installer')),transferRequire=createRequire(installerRequire.resolve('@xmcl/file-transfer')),{Agent,interceptors}=transferRequire('undici');
  const pool=new Agent().compose(interceptors.redirect({maxRedirections:5}));
  const dispatcher={dispatch(options,handler){if(String(options.origin)===origin)return pool.dispatch(options,handler);queueMicrotask(()=>handler.onError(Error('Fixture blocks external network')));return true;}};
  const close=async()=>{for(const socket of sockets)socket.destroy();await pool.close();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});};
  return {root,pack,id,archive,dispatcher,origin,requests,entered,close};
}
