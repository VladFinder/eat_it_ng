import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultDatabasePath = resolve(projectRoot, 'data', 'eat-it.db');

if (!process.env.DATABASE_URL) {
  mkdirSync(dirname(defaultDatabasePath), { recursive: true });
  process.env.DATABASE_URL = 'file:../data/eat-it.db';
}

export const prisma = new PrismaClient();
