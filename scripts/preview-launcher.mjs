// Isolated UI fixture: no filesystem picker, Java, credentials, backend or game process.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const assets = new Map([['/brand/mining-atlas-v2.png',['../public/brand/mining-atlas-v2.png','image/png']],['/motion.js',['../public/motion.js','text/javascript']],['/mining.js',['../public/mining.js','text/javascript']],['/motion.css',['../public/motion.css','text/css']],['/focus.js',['../public/focus.js','text/javascript']],['/pixel-theme.css',['../public/pixel-theme.css','text/css']],['/brand/ui-pixel-v1.woff2',['../public/brand/ui-pixel-v1.woff2','font/woff2']],['/memory.js',['../public/launcher/memory.js','text/javascript']],['/brand/mark.svg',['../public/brand/mark.svg','image/svg+xml']],['/brand/favicon.svg',['../public/brand/favicon.svg','image/svg+xml']],['/desktop-notifications.js',['../public/desktop-notifications.js','text/javascript']],['/desktop-notifications.css',['../public/desktop-notifications.css','text/css']],['/notifications.html',['../public/launcher/notifications.html','text/html']],['/notifications.js',['../public/launcher/notifications.js','text/javascript']],['/updates.js',['../public/launcher/updates.js','text/javascript']],['/updates.css',['../public/launcher/updates.css','text/css']],['/type.css', ['../public/type.css', 'text/css']],['/', ['../public/launcher/index.html', 'text/html']], ['/library.js', ['../public/launcher/library.js', 'text/javascript']], ['/library.css', ['../public/launcher/library.css', 'text/css']], ['/mock-bridge.js', ['./preview-launcher-bridge.js', 'text/javascript']]]);
const server = createServer(async (request, response) => {
  const asset = assets.get(request.url?.split('?')[0]);
  if (!asset) { response.writeHead(404).end(); return; }
  let content = await readFile(fileURLToPath(new URL(asset[0], import.meta.url)));
  if (asset[1].startsWith('text/')) content=content.toString('utf8');
  if (asset[1] === 'text/html') content = content.replace('<script type="module"', '<script src="./mock-bridge.js"></script><script type="module"');
  response.writeHead(200, { 'Content-Type': asset[1].startsWith('text/') ? `${asset[1]}; charset=utf-8` : asset[1], 'Cache-Control': 'no-store' }).end(content);
});
server.listen(Number(process.env.LAUNCHER_PREVIEW_PORT || 4188), '127.0.0.1', () => console.log(`Launcher simulation UI: http://127.0.0.1:${server.address().port} (NO real game launch or login)`));
