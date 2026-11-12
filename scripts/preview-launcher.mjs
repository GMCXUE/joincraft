// Isolated UI fixture: no filesystem picker, Java, credentials, backend or game process.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const assets = new Map([['/', ['../public/launcher/index.html', 'text/html']], ['/library.js', ['../public/launcher/library.js', 'text/javascript']], ['/library.css', ['../public/launcher/library.css', 'text/css']], ['/mock-bridge.js', ['./preview-launcher-bridge.js', 'text/javascript']]]);
const server = createServer(async (request, response) => {
  const asset = assets.get(request.url?.split('?')[0]);
  if (!asset) { response.writeHead(404).end(); return; }
  let content = await readFile(fileURLToPath(new URL(asset[0], import.meta.url)), 'utf8');
  if (asset[1] === 'text/html') content = content.replace('<script type="module"', '<script src="./mock-bridge.js"></script><script type="module"');
  response.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8`, 'Cache-Control': 'no-store' }).end(content);
});
server.listen(Number(process.env.LAUNCHER_PREVIEW_PORT || 4188), '127.0.0.1', () => console.log(`Launcher simulation UI: http://127.0.0.1:${server.address().port} (NO real game launch or login)`));
