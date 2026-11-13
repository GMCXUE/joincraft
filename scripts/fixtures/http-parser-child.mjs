// Run separately: a socket callback assertion cannot be caught by a caller's try/catch.
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {clientFetch} from '../../launcher/http.mjs';
const fetcher=process.argv.includes('--builtin')?globalThis.fetch:clientFetch;
const mode=process.argv.find(arg=>arg.startsWith('--mode='))?.slice(7)||'unread';
const bytes=Buffer.alloc(64*1024,0x4a),sockets=new Set();
const server=createServer(socket=>{
  sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));
  socket.once('data',()=>{
    const length=mode==='truncated'?bytes.length*2:bytes.length;
    socket.end(Buffer.concat([Buffer.from('HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: '+length+'\r\n\r\n'),bytes]));
  });
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
  const response=await fetcher('http://127.0.0.1:'+server.address().port+'/');
  // Keep the application consumer paused when FIN reaches the parser.
  await delay(1000);let received=0,error;
  try{for await(const chunk of response.body){received+=chunk.length;await delay(10);}}catch(e){error=e;}
  if(mode==='truncated'&&!error)throw Error('truncated response was silently accepted');
  if(mode==='unread'&&(error||received!==bytes.length))throw error||Error('response did not complete');
  console.log(JSON.stringify({survived:true,received,mode,catchableError:!!error}));
}finally{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}
