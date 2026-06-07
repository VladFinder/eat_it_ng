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

before(async () => {
  mkdirSync(resolve(projectRoot, 'data'), { recursive: true });
  rmSync(databasePath, { force: true });

  prisma = new PrismaClient();
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "FridgeItem" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "quantity" REAL NOT NULL,
      "unit" TEXT NOT NULL,
      "expiresAt" DATETIME NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "ShoppingItem" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "quantity" REAL,
      "unit" TEXT,
      "checked" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )
  `);
  server = createApiServer(prisma, { error() {} });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
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
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
}

test('health endpoint responds', async () => {
  const response = await request('/api/health');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('fridge item can be created and partially consumed', async () => {
  const createResponse = await request('/api/fridge', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Творог',
      quantity: 2,
      unit: 'упак',
      expiresAt: '2026-06-12',
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();

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

  const stateResponse = await request('/api/state');
  const state = await stateResponse.json();
  assert.equal(
    state.shoppingItems.some((item) => item.id === shoppingItem.id),
    false,
  );
});

test('invalid payload is rejected', async () => {
  const response = await request('/api/fridge', {
    method: 'POST',
    body: JSON.stringify({ name: '', quantity: -1, unit: 'bad', expiresAt: 'today' }),
  });
  assert.equal(response.status, 400);
});
