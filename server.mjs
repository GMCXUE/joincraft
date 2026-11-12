import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { createApp } from './dist/app.js';
export { createApp };
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createApp({
    port: Number(process.env.PORT || 4180), host: process.env.HOST || '127.0.0.1',
    dbPath: process.env.DATABASE_PATH, publicOrigin: process.env.PUBLIC_ORIGIN,
    logger: process.env.LOG_LEVEL !== 'silent', trustedProxy: process.env.TRUST_PROXY,
  });
  console.log(`joincraft服务 ${app.url} · SQLite 持久化已启用`);
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
    if (stopping) return; stopping = true; await app.close(); process.exit(0);
  });
}
