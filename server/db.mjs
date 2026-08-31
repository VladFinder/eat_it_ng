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

function normalizeProductName(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, ' ');
}

function nowIso() {
  return new Date().toISOString();
}

async function upsertProduct(prismaClient, product) {
  const normalizedName = normalizeProductName(product.name);
  await prismaClient.$executeRawUnsafe(
    `INSERT INTO "Product" ("id", "name", "normalizedName", "aliases", "updatedAt")
     VALUES ('catalog-product-${normalizedName.replace(/[^a-zа-я0-9]+/giu, '-')}', ?, ?, ?, ?)
     ON CONFLICT("normalizedName") DO UPDATE SET
       "name" = excluded."name",
       "aliases" = excluded."aliases",
       "updatedAt" = excluded."updatedAt"`,
    product.name,
    normalizedName,
    JSON.stringify((product.aliases ?? []).map(normalizeProductName)),
    nowIso(),
  );
  const rows = await prismaClient.$queryRawUnsafe(
    `SELECT "id" FROM "Product" WHERE "normalizedName" = ? LIMIT 1`,
    normalizedName,
  );
  return rows[0].id;
}

async function seedLocalRecipeCatalog(prismaClient) {
  const existing = await prismaClient.$queryRawUnsafe(`SELECT COUNT(*) AS count FROM "Dish"`);
  if (Number(existing[0]?.count ?? 0) > 0) {
    return;
  }

  const dishes = [
    {
      id: 'catalog-dish-omelet-cheese',
      title: 'Омлет с сыром',
      subtitle: '15 минут',
      description: 'Быстрый завтрак из базовых продуктов.',
      instructions: JSON.stringify([
        'Взбейте яйца с молоком и щепоткой соли.',
        'Вылейте смесь на разогретую сковороду.',
        'Добавьте сыр и доведите омлет до готовности под крышкой.',
      ]),
      ingredients: [
        { name: 'Яйца', aliases: ['яйцо'], quantity: 2, unit: 'шт.' },
        { name: 'Молоко', quantity: 50, unit: 'мл' },
        { name: 'Сыр', quantity: 40, unit: 'г' },
      ],
    },
    {
      id: 'catalog-dish-chicken-rice',
      title: 'Рис с курицей',
      subtitle: '40 минут',
      description: 'Сытный ужин, который легко собрать из запасов и пары покупок.',
      instructions: JSON.stringify([
        'Отварите рис до полуготовности.',
        'Обжарьте курицу с луком и морковью.',
        'Смешайте с рисом и доведите под крышкой.',
      ]),
      ingredients: [
        { name: 'Куриное филе', aliases: ['курица'], quantity: 300, unit: 'г' },
        { name: 'Рис', quantity: 200, unit: 'г' },
        { name: 'Лук', quantity: 1, unit: 'шт.' },
        { name: 'Морковь', quantity: 1, unit: 'шт.' },
      ],
    },
    {
      id: 'catalog-dish-vegetable-pasta',
      title: 'Паста с овощами',
      subtitle: '25 минут',
      description: 'Простой ужин, где овощи можно заменить тем, что уже есть дома.',
      instructions: JSON.stringify([
        'Отварите пасту до состояния аль денте.',
        'Обжарьте овощи на сковороде.',
        'Смешайте пасту с овощами и добавьте сыр по желанию.',
      ]),
      ingredients: [
        { name: 'Макароны', aliases: ['паста', 'спагетти'], quantity: 200, unit: 'г' },
        { name: 'Помидоры', aliases: ['томат', 'томаты'], quantity: 2, unit: 'шт.' },
        { name: 'Перец', aliases: ['болгарский перец'], quantity: 1, unit: 'шт.' },
        { name: 'Сыр', quantity: 30, unit: 'г', required: false },
      ],
    },
    {
      id: 'catalog-dish-cottage-cheese-pancakes',
      title: 'Сырники',
      subtitle: '25 минут',
      description: 'Завтрак или быстрый десерт из творога.',
      instructions: JSON.stringify([
        'Смешайте творог, яйцо, муку и сахар.',
        'Сформируйте небольшие сырники.',
        'Обжарьте с двух сторон до румяной корочки.',
      ]),
      ingredients: [
        { name: 'Творог', quantity: 300, unit: 'г' },
        { name: 'Яйца', aliases: ['яйцо'], quantity: 1, unit: 'шт.' },
        { name: 'Мука', quantity: 3, unit: 'ст. л.' },
        { name: 'Сахар', quantity: 1, unit: 'ст. л.', required: false },
      ],
    },
  ];

  for (const dish of dishes) {
    await prismaClient.$executeRawUnsafe(
      `INSERT INTO "Dish" ("id", "title", "subtitle", "description", "instructions", "source", "updatedAt")
       VALUES (?, ?, ?, ?, ?, 'local', ?)
       ON CONFLICT("id") DO UPDATE SET
         "title" = excluded."title",
         "subtitle" = excluded."subtitle",
         "description" = excluded."description",
         "instructions" = excluded."instructions",
         "updatedAt" = excluded."updatedAt"`,
      dish.id,
      dish.title,
      dish.subtitle,
      dish.description,
      dish.instructions,
      nowIso(),
    );
    for (const ingredient of dish.ingredients) {
      const productId = await upsertProduct(prismaClient, ingredient);
      await prismaClient.$executeRawUnsafe(
        `INSERT INTO "DishIngredient" ("id", "dishId", "productId", "quantity", "unit", "required")
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT("dishId", "productId") DO UPDATE SET
           "quantity" = excluded."quantity",
           "unit" = excluded."unit",
           "required" = excluded."required"`,
        `${dish.id}-${productId}`,
        dish.id,
        productId,
        ingredient.quantity ?? null,
        ingredient.unit ?? null,
        ingredient.required ?? true,
      );
    }
  }
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
  await ensureTable(
    prismaClient,
    'Product',
    `CREATE TABLE "Product" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "normalizedName" TEXT NOT NULL,
      "aliases" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )`,
  );
  await ensureTable(
    prismaClient,
    'Dish',
    `CREATE TABLE "Dish" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "title" TEXT NOT NULL,
      "subtitle" TEXT,
      "description" TEXT,
      "instructions" TEXT,
      "source" TEXT NOT NULL DEFAULT 'local',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )`,
  );
  await ensureTable(
    prismaClient,
    'DishIngredient',
    `CREATE TABLE "DishIngredient" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "dishId" TEXT NOT NULL,
      "productId" TEXT NOT NULL,
      "quantity" REAL,
      "unit" TEXT,
      "required" BOOLEAN NOT NULL DEFAULT true,
      FOREIGN KEY ("dishId") REFERENCES "Dish" ("id") ON DELETE CASCADE,
      FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE
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
  await prismaClient.$executeRawUnsafe(
    'CREATE UNIQUE INDEX IF NOT EXISTS "Product_normalizedName_key" ON "Product"("normalizedName")',
  );
  await prismaClient.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS "Dish_source_title_idx" ON "Dish"("source", "title")',
  );
  await prismaClient.$executeRawUnsafe(
    'CREATE UNIQUE INDEX IF NOT EXISTS "DishIngredient_dishId_productId_key" ON "DishIngredient"("dishId", "productId")',
  );
  await prismaClient.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS "DishIngredient_productId_idx" ON "DishIngredient"("productId")',
  );
  await seedLocalRecipeCatalog(prismaClient);
}
