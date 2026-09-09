import { createApiServer, dispatchExpiryNotifications } from './app.mjs';
import { ensureDatabaseSchema, prisma } from './db.mjs';
import { readFile } from 'node:fs/promises';

async function loadLocalEnv() {
  try {
    const body = await readFile(new URL('../.env', import.meta.url), 'utf8');
    for (const line of body.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
      if (!match || process.env[match[1]] !== undefined) {
        continue;
      }
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

await loadLocalEnv();
const port = Number(process.env.PORT ?? 3000);
await ensureDatabaseSchema();
const server = createApiServer(prisma);

async function runExpiryNotificationCheck() {
  try {
    await dispatchExpiryNotifications(prisma);
  } catch (error) {
    console.error('Expiry notification check failed', error);
  }
}

void runExpiryNotificationCheck();
const expiryNotificationTimer = setInterval(runExpiryNotificationCheck, 30 * 60 * 1000);
expiryNotificationTimer.unref();

server.listen(port, '127.0.0.1', () => {
  console.log(`Eat it API listening on http://127.0.0.1:${port}`);
});

async function shutdown() {
  clearInterval(expiryNotificationTimer);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
