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

async function ensureTable(prismaClient, tableName, sql) {
  const rows = await prismaClient.$queryRawUnsafe(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${tableName}'`,
  );
  if (rows.length > 0) {
    return;
  }
  await prismaClient.$executeRawUnsafe(sql);
}

export async function ensureDatabaseSchema(prismaClient = prisma) {
  await ensureColumn(prismaClient, 'FridgeItem', 'reminderDays', 'INTEGER NOT NULL DEFAULT 1');
  await ensureColumn(prismaClient, 'FridgeItem', 'category', "TEXT NOT NULL DEFAULT 'products'");
  await ensureColumn(prismaClient, 'ShoppingItem', 'category', "TEXT NOT NULL DEFAULT 'products'");
  await ensureTable(
    prismaClient,
    'HouseholdInvitation',
    `CREATE TABLE "HouseholdInvitation" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "householdId" TEXT NOT NULL,
      "inviterId" TEXT NOT NULL,
      "inviteeId" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'pending',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE,
      FOREIGN KEY ("inviterId") REFERENCES "User" ("id") ON DELETE CASCADE,
      FOREIGN KEY ("inviteeId") REFERENCES "User" ("id") ON DELETE CASCADE
    )`,
  );
  await ensureTable(
    prismaClient,
    'Notification',
    `CREATE TABLE "Notification" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "type" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "body" TEXT NOT NULL,
      "readAt" DATETIME,
      "data" TEXT,
      "dedupeKey" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
    )`,
  );
  await prismaClient.$executeRawUnsafe(
    'CREATE UNIQUE INDEX IF NOT EXISTS "HouseholdInvitation_householdId_inviteeId_status_key" ON "HouseholdInvitation"("householdId", "inviteeId", "status")',
  );
  await prismaClient.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS "HouseholdInvitation_inviteeId_status_idx" ON "HouseholdInvitation"("inviteeId", "status")',
  );
  await prismaClient.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS "HouseholdInvitation_householdId_idx" ON "HouseholdInvitation"("householdId")',
  );
  await prismaClient.$executeRawUnsafe(
    'CREATE UNIQUE INDEX IF NOT EXISTS "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey")',
  );
  await prismaClient.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt")',
  );
}
