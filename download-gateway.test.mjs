import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DOWNLOAD_SOURCES,gatewayURL,acceleratedURLs,createDownloadFetch} from './launcher/download-gateway.mjs';
import {clientFetch} from './launcher/http.mjs';
import {downloadFile} from './launcher/pack-download.mjs';

const original='https://maven.minecraftforge.net/org/example/tool/1/tool-1.jar';
async function fixture(t,handler){
  const requests=[],sockets=new Set(),server=createServer((req,res)=>{requests.push({url:req.url,headers:req.headers,method:req.method});handler(req,res);});
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));});
  return {origin:'http://127.0.0.1:'+server.address().port,requests};
}
test('gateway routing permits only fixed public sources and excludes signed URLs and credentials',()=>{
  assert.equal(gatewayURL(original,'https://www.joincraft.top/app/'),'https://www.joincraft.top/game-downloads/forge/org/example/tool/1/tool-1.jar');
  for(const url of ['https://127.0.0.1/private','https://login.live.com/token','https://evil.example/a.jar',original+'?token=private',original+'#fragment',original.replace('https://','https://user:secret@'),original.replace('.net/','.net:8443/')])assert.equal(gatewayURL(url,'https://www.joincraft.top'),null,url);
  assert.throws(()=>gatewayURL(original,'http://external.example'),/HTTPS/);
  assert.throws(()=>gatewayURL(original,'https://user:secret@www.joincraft.top'),/凭证/);
  assert.deepEqual(acceleratedURLs([original,original],'https://www.joincraft.top'),[gatewayURL(original,'https://www.joincraft.top'),original]);
});
test('real HTTP gateway preserves range requests and never receives account headers',async t=>{
  const f=await fixture(t,(req,res)=>{assert.equal(req.headers.range,'bytes=1-3');assert.equal(req.headers.cookie,undefined);assert.equal(req.headers.authorization,undefined);res.writeHead(206,{'Content-Range':'bytes 1-3/5','Content-Length':3,'X-Joincraft-Cache':'HIT'});res.end('bcd');});
  let direct=0;const fetch=createDownloadFetch({origin:f.origin,fetchImpl:(url,options)=>{if(new URL(url).origin===f.origin)return clientFetch(url,options);direct++;throw Error('unexpected origin');}});
  const response=await fetch(original,{headers:{Range:'bytes=1-3',Cookie:'secret',Authorization:'Bearer private'}});
  assert.equal(response.status,206);assert.equal(await response.text(),'bcd');assert.equal(response.headers.get('x-joincraft-cache'),'HIT');assert.equal(direct,0);assert.equal(f.requests[0].url,'/game-downloads/forge/org/example/tool/1/tool-1.jar');
});
test('an unavailable gateway falls back to the original and briefly avoids repeated failed cache connections',async t=>{
  const f=await fixture(t,(req,res)=>{res.writeHead(503);res.end('unavailable');});let direct=0;
  const fetch=createDownloadFetch({origin:f.origin,fetchImpl:(url,options)=>new URL(url).origin===f.origin?clientFetch(url,options):(direct++,Promise.resolve(new Response('original bytes')))});
  assert.equal(await (await fetch(original)).text(),'original bytes');assert.equal(await (await fetch(original)).text(),'original bytes');assert.equal(direct,2);assert.equal(f.requests.length,1);
});
test('a missing cached artifact may still use the original source',async t=>{
  const f=await fixture(t,(req,res)=>{res.writeHead(404);res.end();});let direct=0;
  const fetch=createDownloadFetch({origin:f.origin,fetchImpl:(url,options)=>new URL(url).origin===f.origin?clientFetch(url,options):(direct++,Promise.resolve(new Response('fallback')))});
  assert.equal(await (await fetch(original)).text(),'fallback');assert.equal(direct,1);
});
test('cancellation stops an in-flight gateway request without falling back',async t=>{
  let entered;const ready=new Promise(resolve=>entered=resolve),f=await fixture(t,()=>entered());let direct=0;
  const fetch=createDownloadFetch({origin:f.origin,fetchImpl:(url,options)=>new URL(url).origin===f.origin?clientFetch(url,options):(direct++,Promise.reject(Error('unexpected fallback')))});
  const controller=new AbortController(),job=fetch(original,{signal:controller.signal}),rejected=assert.rejects(job,/cancel fixture/);await ready;controller.abort(Error('cancel fixture'));await rejected;assert.equal(direct,0);
});
test('cached bytes still require the original pinned digest before becoming an installed file',async t=>{
  const f=await fixture(t,(req,res)=>{res.end('corrupt data');}),root=await mkdtemp(path.join(tmpdir(),'joincraft-cache-check-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const fetch=createDownloadFetch({origin:f.origin}),target=path.join(root,'tool.jar'),expected=Buffer.from('correct data');
  await assert.rejects(downloadFile({path:'libraries/tool.jar',downloads:[original],hashes:{sha1:createHash('sha1').update(expected).digest('hex')},size:expected.length},target,{fetchImpl:fetch}),/校验/);
  assert.equal(await stat(target).then(()=>true,()=>false),false);assert.equal(f.requests.length,2);
});
test('nginx upstream whitelist matches the client source map',async()=>{
  const config=await readFile(new URL('./deploy/production/nginx.conf',import.meta.url),'utf8'),block=config.split('map $joincraft_download_source $joincraft_download_host {')[1].split('}')[0];
  const entries=[...block.matchAll(/^\s+([a-z-]+) ([a-z0-9.-]+);$/gm)].map(match=>[match[1],match[2]]);
  assert.deepEqual(Object.fromEntries(entries),DOWNLOAD_SOURCES);
});
