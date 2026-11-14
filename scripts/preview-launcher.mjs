// Isolated UI fixture: no Java, account, backend or real game process.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../public');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
const server=createServer(async(request,response)=>{try{const route=decodeURIComponent(new URL(request.url,'http://localhost').pathname);if(route==='/'){response.writeHead(302,{Location:'/launcher/index.html'}).end();return;}const file=route==='/mock-bridge.js'?path.join(import.meta.dirname,'preview-launcher-bridge.js'):path.resolve(root,'.'+route);if(route!=='/mock-bridge.js'&&!file.startsWith(root+path.sep))throw Error();let body=await readFile(file);const type=types[path.extname(file)]||'application/octet-stream';if(type==='text/html')body=body.toString().replace('<script type="module"','<script src="/mock-bridge.js"></script><script type="module"');response.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'}).end(body);}catch{response.writeHead(404).end();}});
server.listen(Number(process.env.LAUNCHER_PREVIEW_PORT||4188),'127.0.0.1',()=>console.log('Launcher UI simulation: http://127.0.0.1:'+server.address().port+' (NO real game launch or login)'));
