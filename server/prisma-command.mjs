import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const databasePath = resolve(projectRoot, 'data', 'eat-it.db');
mkdirSync(dirname(databasePath), { recursive: true });

const prismaCli = resolve(projectRoot, 'node_modules', 'prisma', 'build', 'index.js');
const result = spawnSync(process.execPath, [prismaCli, ...process.argv.slice(2)], {
  cwd: projectRoot,
  env: {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL ?? 'file:../data/eat-it.db',
  },
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
