import { createApiServer } from './app.mjs';
import { prisma } from './db.mjs';

const port = Number(process.env.PORT ?? 3000);
const server = createApiServer(prisma);

server.listen(port, '127.0.0.1', () => {
  console.log(`Eat it API listening on http://127.0.0.1:${port}`);
});

async function shutdown() {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
