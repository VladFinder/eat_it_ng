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

async function columnsFor(prismaClient, tableName) {
  try {
    return await prismaClient.$queryRawUnsafe(`PRAGMA table_info("${tableName}")`);
  } catch {
    return [];
  }
}

async function ensureColumn(prismaClient, tableName, columnName, definition) {
  const columns = await columnsFor(prismaClient, tableName);
  if (columns.length === 0 || columns.some((column) => column.name === columnName)) {
    return;
  }

  await prismaClient.$executeRawUnsafe(
    `ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${definition}`,
  );
}

export async function ensureDatabaseSchema(prismaClient = prisma) {
  await ensureColumn(prismaClient, 'FridgeItem', 'reminderDays', 'INTEGER NOT NULL DEFAULT 1');
  await ensureColumn(prismaClient, 'FridgeItem', 'category', "TEXT NOT NULL DEFAULT 'products'");
  await ensureColumn(prismaClient, 'ShoppingItem', 'category', "TEXT NOT NULL DEFAULT 'products'");
}
