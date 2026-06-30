import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { createApiServer } from './app.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const databasePath = resolve(projectRoot, 'data', 'eat-it-test.db');
process.env.DATABASE_URL = 'file:../data/eat-it-test.db';

let prisma;
let server;
let baseUrl;
let authToken;

before(async () => {
  mkdirSync(resolve(projectRoot, 'data'), { recursive: true });
  rmSync(databasePath, { force: true });

  prisma = new PrismaClient();
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "Household" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "householdId" TEXT NOT NULL,
      "email" TEXT NOT NULL UNIQUE,
      "displayName" TEXT NOT NULL,
      "passwordHash" TEXT,
      "authProvider" TEXT NOT NULL DEFAULT 'password',
      "providerSubject" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX "User_authProvider_providerSubject_key"
    ON "User"("authProvider", "providerSubject")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "Session" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "tokenHash" TEXT NOT NULL UNIQUE,
      "expiresAt" DATETIME NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "AuthIdentity" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "provider" TEXT NOT NULL,
      "subject" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX "AuthIdentity_provider_subject_key"
    ON "AuthIdentity"("provider", "subject")
  `);
  await prisma.household.create({
    data: { id: 'legacy-household', name: 'Мой дом' },
  });
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "FridgeItem" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "householdId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "quantity" REAL NOT NULL,
      "unit" TEXT NOT NULL,
      "expiresAt" DATETIME NOT NULL,
      "reminderDays" INTEGER NOT NULL DEFAULT 1,
      "category" TEXT NOT NULL DEFAULT 'products',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "ShoppingItem" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "householdId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "quantity" REAL,
      "unit" TEXT,
      "category" TEXT NOT NULL DEFAULT 'products',
      "checked" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE
    )
  `);
  server = createApiServer(prisma, { error() {} });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;

  const registerResponse = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      displayName: 'Тест',
      email: 'test@example.com',
      password: 'test-password-123',
    }),
    skipAuth: true,
  });
  assert.equal(registerResponse.status, 201);
  authToken = (await registerResponse.json()).token;
});

after(async () => {
  if (server) {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
  if (prisma) {
    await prisma.$disconnect();
  }
  rmSync(databasePath, { force: true });
});

async function request(path, options) {
  const { skipAuth, ...fetchOptions } = options ?? {};
  return fetch(`${baseUrl}${path}`, {
    ...fetchOptions,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken && !skipAuth ? { Authorization: `Bearer ${authToken}` } : {}),
      ...fetchOptions.headers,
    },
  });
}

test('health endpoint responds', async () => {
  const response = await request('/api/health', { skipAuth: true });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('account can log in and access the current user', async () => {
  const loginResponse = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'test@example.com', password: 'test-password-123' }),
    skipAuth: true,
  });
  assert.equal(loginResponse.status, 200);
  const login = await loginResponse.json();

  const meResponse = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${login.token}` },
  });
  assert.equal(meResponse.status, 200);
  assert.equal((await meResponse.json()).user.email, 'test@example.com');
});

test('state rejects unauthenticated requests', async () => {
  const response = await request('/api/state', { skipAuth: true });
  assert.equal(response.status, 401);
});

test('fridge item can be created and partially consumed', async () => {
  const createResponse = await request('/api/fridge', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Творог',
      quantity: 2,
      unit: 'упак',
      expiresAt: '2026-06-12',
      reminderDays: 3,
      category: 'household',
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.reminderDays, 3);
  assert.equal(created.category, 'household');

  const consumeResponse = await request(`/api/fridge/${created.id}/consume`, {
    method: 'POST',
    body: JSON.stringify({ quantity: 0.5 }),
  });
  assert.equal(consumeResponse.status, 200);
  const consumed = await consumeResponse.json();
  assert.equal(consumed.item.quantity, 1.5);
});

test('completed shopping item can be moved to the fridge', async () => {
  const createResponse = await request('/api/shopping', {
    method: 'POST',
    body: JSON.stringify({ name: 'Кефир', quantity: 1, unit: 'л' }),
  });
  const shoppingItem = await createResponse.json();

  const updateResponse = await request(`/api/shopping/${shoppingItem.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ checked: true }),
  });
  assert.equal(updateResponse.status, 200);

  const moveResponse = await request(`/api/shopping/${shoppingItem.id}/move-to-fridge`, {
    method: 'POST',
    body: JSON.stringify({ expiresAt: '2026-06-15' }),
  });
  assert.equal(moveResponse.status, 200);
  const fridgeItem = await moveResponse.json();
  assert.equal(fridgeItem.name, 'Кефир');
  assert.equal(fridgeItem.category, 'products');

  const stateResponse = await request('/api/state');
  const state = await stateResponse.json();
  assert.equal(
    state.shoppingItems.some((item) => item.id === shoppingItem.id),
    false,
  );
});

test('shopping item defaults to one piece and preserves its category', async () => {
  const createResponse = await request('/api/shopping', {
    method: 'POST',
    body: JSON.stringify({ name: 'Средство для стекол', category: 'household' }),
  });
  assert.equal(createResponse.status, 201);
  const shoppingItem = await createResponse.json();
  assert.equal(shoppingItem.quantity, 1);
  assert.equal(shoppingItem.unit, 'шт');
  assert.equal(shoppingItem.category, 'household');

  const updateResponse = await request(`/api/shopping/${shoppingItem.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ quantity: 2 }),
  });
  assert.equal(updateResponse.status, 200);
  assert.equal((await updateResponse.json()).quantity, 2);
});

test('invalid payload is rejected', async () => {
  const response = await request('/api/fridge', {
    method: 'POST',
    body: JSON.stringify({ name: '', quantity: -1, unit: 'bad', expiresAt: 'today' }),
  });
  assert.equal(response.status, 400);
});
