import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {downloadFile} from './launcher/pack-download.mjs';

for(const mode of ['unread','truncated'])test('HTTP peer closes while reads are paused: '+mode+' remains inside the child process error boundary',()=>{
  const child=spawnSync(process.execPath,[fileURLToPath(new URL('./scripts/fixtures/http-parser-child.mjs',import.meta.url)),'--mode='+mode],{encoding:'utf8',timeout:10000});
  assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);assert.doesNotMatch(child.stderr,/AssertionError|ERR_ASSERTION/);
  const result=JSON.parse(child.stdout.trim());assert.equal(result.survived,true);assert.equal(result.catchableError,mode==='truncated');
});

test('a real interrupted connection is retried and verified without uncaught parser exceptions or leftover partial files',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'joincraft-http-regression-'));t.after(()=>rm(root,{recursive:true,force:true}));const bytes=Buffer.alloc(128*1024,3);let calls=0;
  const server=createServer((_req,res)=>{calls++;res.writeHead(200,{'Content-Length':bytes.length,Connection:'close'});res.end(calls===1?bytes.subarray(0,bytes.length/2):bytes);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const target=path.join(root,'resource'),entry={path:'resource',size:bytes.length,hashes:{sha1:createHash('sha1').update(bytes).digest('hex')},downloads:['http://127.0.0.1:'+server.address().port+'/resource']};
  await downloadFile(entry,target,{checkURL:value=>value});assert.equal(calls,2);assert.deepEqual(await readFile(target),bytes);assert.deepEqual(await readdir(root),['resource']);
});
