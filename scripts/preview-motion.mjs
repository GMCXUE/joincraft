// Local visual review only. No accounts, network requests or game processes.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const preview={'/':'design/motion/index.html','/preview.js':'design/motion/preview.js','/preview.css':'design/motion/preview.css'};
const allowed=new Set(['brand/mining-atlas-v2.png','motion.js','mining.js','motion.css','focus.js','style.css','polish.css','type.css','pixel-theme.css','profile.css','brand/mark.svg','brand/wordmark-pixel-v1.svg','brand/favicon.svg','brand/ui-pixel-v1.woff2','avatars/fox-v1.svg','avatars/skeleton-v1.svg']);
const types={html:'text/html',js:'text/javascript',css:'text/css',svg:'image/svg+xml',png:'image/png',woff2:'font/woff2'};
const server=createServer(async(request,response)=>{
 const path=new URL(request.url,'http://127.0.0.1').pathname,file=preview[path]||(allowed.has(path.slice(1))?'public'+path:null);
 if(!file){response.writeHead(404);response.end();return;}
 try{const data=await readFile(root+file);response.writeHead(200,{'Content-Type':types[file.split('.').at(-1)]||'application/octet-stream','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; object-src 'none'"});response.end(data);}catch{response.writeHead(500);response.end('Preview asset unavailable');}
});
server.listen(Number(process.env.PORT||4230),'127.0.0.1',()=>console.log('joincraft motion preview: http://127.0.0.1:'+server.address().port));
