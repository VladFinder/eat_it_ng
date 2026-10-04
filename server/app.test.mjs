import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { createApiServer, findOrCreateOAuthUser } from './app.mjs';
import { createAuthLimiter, clientAddress } from './security.mjs';
import { createSession } from './auth.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const databasePath = resolve(projectRoot, 'data', 'eat-it-test.db');
process.env.DATABASE_URL = 'file:../data/eat-it-test.db';
function clearExternalConfiguration() {
  // Integration tests configure fake providers explicitly; never inherit live credentials.
  for (const key of [
    'SPOONACULAR_API_KEY',
    'YANDEX_TRANSLATE_API_KEY',
    'YANDEX_TRANSLATE_FOLDER_ID',
    'VAPID_PUBLIC_KEY',
    'VAPID_PRIVATE_KEY',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'APPLE_CLIENT_ID',
    'APPLE_TEAM_ID',
    'APPLE_KEY_ID',
    'APPLE_PRIVATE_KEY',
    'ADMIN_EMAILS',
    'ADMIN_USER_IDS',
    'TRUST_PROXY',
  ]) {
    delete process.env[key];
  }
}

let prisma;
let server;
let baseUrl;
let authToken;

before(async () => {
  mkdirSync(resolve(projectRoot, 'data'), { recursive: true });
  rmSync(databasePath, { force: true });

  prisma = new PrismaClient();
  // Prisma can load .env during construction, so clear it after creating the client.
  clearExternalConfiguration();
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "Household" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "plan" TEXT NOT NULL DEFAULT 'free',
      "subscriptionStatus" TEXT NOT NULL DEFAULT 'inactive',
      "subscriptionProvider" TEXT NOT NULL DEFAULT 'none',
      "subscriptionPeriodEnd" DATETIME,
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
      "notifyExpiry" BOOLEAN NOT NULL DEFAULT true,
      "notifyShopping" BOOLEAN NOT NULL DEFAULT true,
      "quietHoursStart" TEXT,
      "quietHoursEnd" TEXT,
      "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
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
      "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "HouseholdInvitation" (
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
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX "HouseholdInvitation_householdId_inviteeId_status_key"
    ON "HouseholdInvitation"("householdId", "inviteeId", "status")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "Notification" (
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
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key"
    ON "Notification"("userId", "dedupeKey")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "PushSubscription" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "endpoint" TEXT NOT NULL UNIQUE,
      "p256dh" TEXT NOT NULL,
      "auth" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "TranslationCache" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "sourceLanguage" TEXT NOT NULL,
      "targetLanguage" TEXT NOT NULL,
      "sourceText" TEXT NOT NULL,
      "translatedText" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX "TranslationCache_sourceLanguage_targetLanguage_sourceText_key"
    ON "TranslationCache"("sourceLanguage", "targetLanguage", "sourceText")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "SupportTicket" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "subject" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'open',
      "closedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "SupportMessage" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "ticketId" TEXT NOT NULL,
      "authorId" TEXT NOT NULL,
      "authorRole" TEXT NOT NULL DEFAULT 'user',
      "body" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("ticketId") REFERENCES "SupportTicket" ("id") ON DELETE CASCADE,
      FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "FeedbackItem" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "type" TEXT NOT NULL,
      "body" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'open',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
    )
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
      "expiresAt" DATETIME,
      "reminderDays" INTEGER NOT NULL DEFAULT 1,
      "autoAddToShopping" BOOLEAN NOT NULL DEFAULT false,
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
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "Product" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "normalizedName" TEXT NOT NULL UNIQUE,
      "aliases" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "Dish" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "householdId" TEXT,
      "externalId" TEXT,
      "title" TEXT NOT NULL,
      "subtitle" TEXT,
      "description" TEXT,
      "instructions" TEXT,
      "imageUrl" TEXT,
      "source" TEXT NOT NULL DEFAULT 'catalog',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX "Dish_source_externalId_key"
    ON "Dish"("source", "externalId")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "MealPlanEntry" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "householdId" TEXT NOT NULL,
      "dishId" TEXT NOT NULL,
      "date" DATETIME NOT NULL,
      "mealType" TEXT NOT NULL DEFAULT 'dinner',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE,
      FOREIGN KEY ("dishId") REFERENCES "Dish" ("id") ON DELETE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX "MealPlanEntry_householdId_date_mealType_key"
    ON "MealPlanEntry"("householdId", "date", "mealType")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "DishIngredient" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "dishId" TEXT NOT NULL,
      "productId" TEXT NOT NULL,
      "quantity" REAL,
      "unit" TEXT,
      "required" BOOLEAN NOT NULL DEFAULT true,
      FOREIGN KEY ("dishId") REFERENCES "Dish" ("id") ON DELETE CASCADE,
      FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX "DishIngredient_dishId_productId_key"
    ON "DishIngredient"("dishId", "productId")
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

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

test('health endpoint responds', async () => {
  const response = await request('/api/health', { skipAuth: true });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('allows Capacitor Android requests through CORS', async () => {
  const response = await request('/api/auth/login', {
    method: 'OPTIONS',
    skipAuth: true,
    headers: {
      Origin: 'https://localhost',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://localhost');
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');

  const rejected = await request('/api/auth/login', {
    method: 'OPTIONS',
    skipAuth: true,
    headers: { Origin: 'https://untrusted.example' },
  });
  assert.equal(rejected.headers.get('access-control-allow-origin'), null);
});

test('auth providers reflect configured OAuth credentials', async () => {
  const previous = {
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    appleClientId: process.env.APPLE_CLIENT_ID,
    appleTeamId: process.env.APPLE_TEAM_ID,
    appleKeyId: process.env.APPLE_KEY_ID,
    applePrivateKey: process.env.APPLE_PRIVATE_KEY,
  };
  process.env.GOOGLE_CLIENT_ID = 'google-client';
  process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
  process.env.APPLE_CLIENT_ID = 'apple-client';
  process.env.APPLE_TEAM_ID = 'apple-team';
  process.env.APPLE_KEY_ID = 'apple-key';
  process.env.APPLE_PRIVATE_KEY = 'apple-private-key';

  try {
    const response = await request('/api/auth/providers', { skipAuth: true });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { password: true, google: true, apple: true });
  } finally {
    restoreEnv('GOOGLE_CLIENT_ID', previous.googleClientId);
    restoreEnv('GOOGLE_CLIENT_SECRET', previous.googleClientSecret);
    restoreEnv('APPLE_CLIENT_ID', previous.appleClientId);
    restoreEnv('APPLE_TEAM_ID', previous.appleTeamId);
    restoreEnv('APPLE_KEY_ID', previous.appleKeyId);
    restoreEnv('APPLE_PRIVATE_KEY', previous.applePrivateKey);
  }
});

test('google auth starts OAuth flow with state cookies', async () => {
  const previous = {
    appUrl: process.env.APP_URL,
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  };
  process.env.APP_URL = 'http://127.0.0.1:4173';
  process.env.GOOGLE_CLIENT_ID = 'google-client';
  process.env.GOOGLE_CLIENT_SECRET = 'google-secret';

  try {
    const response = await fetch(`${baseUrl}/api/auth/google`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.match(
      response.headers.get('location'),
      /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/,
    );
    const cookies = response.headers.get('set-cookie');
    assert.match(cookies, /eat_it_google_state=/);
    assert.match(cookies, /eat_it_google_verifier=/);
  } finally {
    restoreEnv('APP_URL', previous.appUrl);
    restoreEnv('GOOGLE_CLIENT_ID', previous.googleClientId);
    restoreEnv('GOOGLE_CLIENT_SECRET', previous.googleClientSecret);
  }
});

test('invalid google callback redirects back to the app with an auth error', async () => {
  const previous = process.env.APP_URL;
  process.env.APP_URL = 'http://127.0.0.1:4173';

  try {
    const response = await fetch(`${baseUrl}/api/auth/google/callback?state=bad`, {
      redirect: 'manual',
    });
    assert.equal(response.status, 302);
    assert.equal(
      response.headers.get('location'),
      'http://127.0.0.1:4173/?auth_error=google_failed',
    );
  } finally {
    restoreEnv('APP_URL', previous);
  }
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

test('accounts start on the free plan without implicit test access', async () => {
  const response = await request('/api/state');
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.equal(state.household.subscription.isPlus, false);
  assert.equal(state.household.subscription.plan, 'free');
});

test('admins can activate and deactivate household Plus access from a user record', async () => {
  const previousAdmins = process.env.ADMIN_USER_IDS;
  process.env.ADMIN_USER_IDS = (
    await prisma.user.findUnique({ where: { email: 'test@example.com' } })
  ).id;
  try {
    const usersResponse = await request('/api/dev/users');
    assert.equal(usersResponse.status, 200);
    const target = (await usersResponse.json()).users.find(
      (item) => item.email === 'test@example.com',
    );
    assert.ok(target);

    const activateResponse = await request(`/api/dev/users/${target.id}/subscription`, {
      method: 'PATCH',
      body: JSON.stringify({ active: true }),
    });
    assert.equal(activateResponse.status, 200);
    assert.equal((await activateResponse.json()).user.subscription.isPlus, true);

    const deactivateResponse = await request(`/api/dev/users/${target.id}/subscription`, {
      method: 'PATCH',
      body: JSON.stringify({ active: false }),
    });
    assert.equal(deactivateResponse.status, 200);
    assert.equal((await deactivateResponse.json()).user.subscription.isPlus, false);
  } finally {
    restoreEnv('ADMIN_USER_IDS', previousAdmins);
  }
});

test('notification preferences control expiry and quiet hours', async () => {
  const updateResponse = await request('/api/notification-preferences', {
    method: 'PATCH',
    body: JSON.stringify({
      notifyExpiry: false,
      notifyShopping: true,
      quietHoursStart: '23:00',
      quietHoursEnd: '07:00',
      timezone: 'Asia/Yekaterinburg',
    }),
  });
  assert.equal(updateResponse.status, 200);
  assert.deepEqual(await updateResponse.json(), {
    notifyExpiry: false,
    notifyShopping: true,
    quietHoursStart: null,
    quietHoursEnd: null,
    timezone: 'Asia/Yekaterinburg',
  });

  const getResponse = await request('/api/notification-preferences');
  assert.equal(getResponse.status, 200);
  assert.equal((await getResponse.json()).notifyExpiry, false);

  await request('/api/notification-preferences', {
    method: 'PATCH',
    body: JSON.stringify({
      notifyExpiry: true,
      notifyShopping: true,
      quietHoursStart: null,
      quietHoursEnd: null,
      timezone: 'Europe/Moscow',
    }),
  });
});

test('support ticket can be created, answered by admin, and closed', async () => {
  const previousAdmins = process.env.ADMIN_USER_IDS;
  process.env.ADMIN_USER_IDS = (
    await prisma.user.findUnique({ where: { email: 'test@example.com' } })
  ).id;

  try {
    const createResponse = await request('/api/support/tickets', {
      method: 'POST',
      body: JSON.stringify({
        subject: 'Не понимаю покупки',
        message: 'Как перенести купленное в холодильник?',
      }),
    });
    assert.equal(createResponse.status, 201);
    const ticket = await createResponse.json();
    assert.equal(ticket.status, 'open');

    const adminListResponse = await request('/api/dev/support/tickets');
    assert.equal(adminListResponse.status, 200);
    const adminList = await adminListResponse.json();
    assert.equal(
      adminList.tickets.some((item) => item.id === ticket.id),
      true,
    );

    const replyResponse = await request(`/api/dev/support/tickets/${ticket.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ message: 'Нажмите на купленную позицию и выберите перенос.' }),
    });
    assert.equal(replyResponse.status, 201);
    assert.equal((await replyResponse.json()).authorRole, 'support');

    const closeResponse = await request(`/api/dev/support/tickets/${ticket.id}/close`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    assert.equal(closeResponse.status, 200);
    assert.equal((await closeResponse.json()).status, 'closed');

    const userReplyResponse = await request(`/api/support/tickets/${ticket.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ message: 'Спасибо' }),
    });
    assert.equal(userReplyResponse.status, 409);
  } finally {
    restoreEnv('ADMIN_USER_IDS', previousAdmins);
  }
});

test('feedback is visible to admins only', async () => {
  const createResponse = await request('/api/feedback', {
    method: 'POST',
    body: JSON.stringify({ type: 'bug', message: 'Кнопка выглядит странно' }),
  });
  assert.equal(createResponse.status, 201);

  const forbiddenResponse = await request('/api/dev/feedback');
  assert.equal(forbiddenResponse.status, 403);

  const previousAdmins = process.env.ADMIN_USER_IDS;
  process.env.ADMIN_USER_IDS = (
    await prisma.user.findUnique({ where: { email: 'test@example.com' } })
  ).id;
  try {
    const adminResponse = await request('/api/dev/feedback');
    assert.equal(adminResponse.status, 200);
    const admin = await adminResponse.json();
    assert.equal(
      admin.feedback.some((item) => item.type === 'bug'),
      true,
    );
  } finally {
    restoreEnv('ADMIN_USER_IDS', previousAdmins);
  }
});

test('registering an owner email does not grant admin access', async () => {
  const response = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      displayName: 'Unverified owner',
      email: 'vladfinder@yandex.ru',
      password: 'test-password-123',
    }),
    skipAuth: true,
  });
  assert.equal(response.status, 201);
  const owner = await response.json();
  assert.equal(owner.user.isAdmin, false);
  const summary = await request('/api/dev/summary', {
    headers: { Authorization: `Bearer ${owner.token}` },
  });
  assert.equal(summary.status, 403);
});

test('state rejects unauthenticated requests', async () => {
  const response = await request('/api/state', { skipAuth: true });
  assert.equal(response.status, 401);
});

test('push subscriptions can be enabled and disabled for the current device', async () => {
  const endpoint = 'https://fcm.googleapis.com/fcm/send/device-1';
  const createResponse = await request('/api/push/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      endpoint,
      keys: {
        p256dh: 'test-p256dh-key-material',
        auth: 'test-auth-key',
      },
    }),
  });
  assert.equal(createResponse.status, 201);
  assert.equal(await prisma.pushSubscription.count({ where: { endpoint } }), 1);

  const deleteResponse = await request('/api/push/subscriptions', {
    method: 'DELETE',
    body: JSON.stringify({ endpoint }),
  });
  assert.equal(deleteResponse.status, 200);
  assert.equal(await prisma.pushSubscription.count({ where: { endpoint } }), 0);
});

test('recipe suggestions return empty local result without external API key', async () => {
  const previous = process.env.SPOONACULAR_API_KEY;
  delete process.env.SPOONACULAR_API_KEY;

  try {
    const response = await request('/api/recipes/suggestions');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { recipes: [], ingredients: [] });
  } finally {
    restoreEnv('SPOONACULAR_API_KEY', previous);
  }
});

test('recipe suggestions calculate available and missing ingredients from local catalog', async () => {
  await prisma.product.createMany({
    data: [
      {
        id: 'product-egg',
        name: 'Яйца',
        normalizedName: 'яйца',
        aliases: JSON.stringify(['яйцо']),
      },
      {
        id: 'product-milk',
        name: 'Молоко',
        normalizedName: 'молоко',
        aliases: JSON.stringify([]),
      },
      {
        id: 'product-cheese',
        name: 'Сыр',
        normalizedName: 'сыр',
        aliases: JSON.stringify([]),
      },
    ],
  });
  await prisma.dish.create({
    data: {
      id: 'dish-omelet',
      title: 'Омлет с сыром',
      subtitle: '15 минут',
      description: 'Быстрый завтрак.',
      instructions: JSON.stringify(['Взбейте яйца.', 'Добавьте сыр.']),
      ingredients: {
        createMany: {
          data: [
            { id: 'dish-omelet-egg', productId: 'product-egg', quantity: 2, unit: 'шт.' },
            { id: 'dish-omelet-milk', productId: 'product-milk', quantity: 50, unit: 'мл' },
            { id: 'dish-omelet-cheese', productId: 'product-cheese', quantity: 40, unit: 'г' },
          ],
        },
      },
    },
  });
  await request('/api/fridge', {
    method: 'POST',
    body: JSON.stringify({
      name: 'яйцо',
      quantity: 4,
      unit: 'шт.',
      expiresAt: '2026-06-12',
      reminderDays: 3,
      category: 'products',
    }),
  });

  const response = await request('/api/recipes/suggestions');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.recipes[0].title, 'Омлет с сыром');
  assert.equal(result.recipes[0].matchPercent, 33);
  assert.deepEqual(result.recipes[0].usedIngredients, ['Яйца 2 шт.']);
  assert.deepEqual(result.recipes[0].missedIngredients, ['Молоко 50 мл', 'Сыр 40 г']);
});

test('recipe suggestions include local dishes when fridge is empty', async () => {
  await prisma.dishIngredient.deleteMany();
  await prisma.dish.deleteMany();
  await prisma.product.deleteMany();
  await prisma.product.create({
    data: {
      id: 'product-rice-empty',
      name: 'Рис',
      normalizedName: 'рис',
      aliases: JSON.stringify([]),
      dishIngredients: {
        create: {
          id: 'dish-rice-empty-rice',
          quantity: 200,
          unit: 'г',
          dish: {
            create: {
              id: 'dish-rice-empty',
              title: 'Рисовая каша',
              subtitle: '30 минут',
              description: 'Простое блюдо из крупы.',
              instructions: JSON.stringify(['Промойте рис.', 'Отварите до готовности.']),
            },
          },
        },
      },
    },
  });

  const response = await request('/api/recipes/suggestions');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(
    result.recipes.some((recipe) => recipe.title === 'Рисовая каша'),
    true,
  );
});

test('household dishes can be created and matched against fridge products', async () => {
  await prisma.dishIngredient.deleteMany();
  await prisma.dish.deleteMany();
  await prisma.product.deleteMany();
  await request('/api/fridge', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Картофель',
      quantity: 5,
      unit: 'шт.',
      expiresAt: null,
      reminderDays: 0,
      category: 'products',
    }),
  });

  const createResponse = await request('/api/dishes', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Картофельное пюре',
      description: 'Домашнее блюдо.',
      imageUrl: 'https://example.com/puree.jpg',
      ingredients: ['Картофель', 'Молоко'],
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.recipes[0].title, 'Картофельное пюре');
  assert.equal(created.recipes[0].matchPercent, 50);
  assert.deepEqual(created.recipes[0].usedIngredients, ['Картофель']);
  assert.deepEqual(created.recipes[0].missedIngredients, ['Молоко']);

  const listResponse = await request('/api/dishes');
  assert.equal(listResponse.status, 200);
  const listed = await listResponse.json();
  assert.equal(
    listed.recipes.some((recipe) => recipe.title === 'Картофельное пюре'),
    true,
  );
});

test('Plus household can plan a recipe for the week and remove it', async () => {
  await prisma.household.update({
    where: { id: 'legacy-household' },
    data: { plan: 'plus', subscriptionStatus: 'active', subscriptionProvider: 'admin' },
  });
  const dishesResponse = await request('/api/dishes');
  const dishes = await dishesResponse.json();
  const dish = dishes.recipes.find((recipe) => recipe.title === 'Картофельное пюре');
  const date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

  const createResponse = await request('/api/meal-plan', {
    method: 'POST',
    body: JSON.stringify({ dishId: dish.id, date, mealType: 'dinner' }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.date, date);
  assert.equal(created.mealType, 'dinner');
  assert.equal(created.dish.title, 'Картофельное пюре');

  const listResponse = await request('/api/meal-plan');
  assert.equal(listResponse.status, 200);
  const plan = await listResponse.json();
  assert.equal(
    plan.entries.some((entry) => entry.id === created.id),
    true,
  );

  const deleteResponse = await request(`/api/meal-plan/${created.id}`, { method: 'DELETE' });
  assert.equal(deleteResponse.status, 204);
});

test('recipes using expiring products are prioritized', async () => {
  await prisma.dishIngredient.deleteMany();
  await prisma.dish.deleteMany();
  await prisma.product.deleteMany();
  await prisma.fridgeItem.deleteMany();

  const expiringDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const stableDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  await request('/api/dishes', {
    method: 'POST',
    body: JSON.stringify({ title: 'Салат с томатом', ingredients: ['Томат'] }),
  });
  await request('/api/dishes', {
    method: 'POST',
    body: JSON.stringify({ title: 'Салат с огурцом', ingredients: ['Огурец'] }),
  });
  await request('/api/fridge', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Томат',
      quantity: 2,
      unit: 'шт.',
      expiresAt: expiringDate,
      reminderDays: 3,
      category: 'products',
    }),
  });
  await request('/api/fridge', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Огурец',
      quantity: 2,
      unit: 'шт.',
      expiresAt: stableDate,
      reminderDays: 1,
      category: 'products',
    }),
  });

  const response = await request('/api/dishes');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.recipes[0].title, 'Салат с томатом');
  assert.equal(result.recipes[0].expiringIngredientCount, 1);
  assert.equal(result.recipes[1].expiringIngredientCount, 0);
});

test('missing recipe ingredients are added to shopping without duplicates', async () => {
  await prisma.dishIngredient.deleteMany();
  await prisma.dish.deleteMany();
  await prisma.product.deleteMany();
  await prisma.fridgeItem.deleteMany();
  await prisma.shoppingItem.deleteMany();

  const createResponse = await request('/api/dishes', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Пюре с сыром',
      ingredients: ['Картофель', 'Молоко', 'Сыр'],
    }),
  });
  const createdDish = (await createResponse.json()).recipes[0];
  await request('/api/fridge', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Картофель',
      quantity: 3,
      unit: 'шт.',
      expiresAt: null,
      reminderDays: 0,
      category: 'products',
    }),
  });
  await request('/api/shopping', {
    method: 'POST',
    body: JSON.stringify({ name: 'молоко', quantity: 1, unit: 'л', category: 'products' }),
  });

  const firstResponse = await request(`/api/recipes/${createdDish.id}/missing-to-shopping`, {
    method: 'POST',
    body: '{}',
  });
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  assert.equal(first.addedCount, 1);
  assert.equal(first.skippedCount, 1);
  assert.deepEqual(
    first.items.map((item) => item.name),
    ['Сыр'],
  );

  const secondResponse = await request(`/api/recipes/${createdDish.id}/missing-to-shopping`, {
    method: 'POST',
    body: '{}',
  });
  const second = await secondResponse.json();
  assert.equal(second.addedCount, 0);
  assert.equal(second.skippedCount, 2);
  assert.equal(await prisma.shoppingItem.count(), 2);
});

test('user recipes can be deleted without deleting catalog recipes', async () => {
  await prisma.dishIngredient.deleteMany();
  await prisma.dish.deleteMany();
  await prisma.product.deleteMany();

  const createResponse = await request('/api/dishes', {
    method: 'POST',
    body: JSON.stringify({ title: 'Мой суп', ingredients: ['Вода'] }),
  });
  const userDish = (await createResponse.json()).recipes[0];
  await prisma.dish.create({
    data: {
      id: 'catalog-protected-dish',
      title: 'Каталожный суп',
      source: 'catalog',
      ingredients: {
        create: {
          product: {
            create: { name: 'Бульон', normalizedName: 'бульон', aliases: '[]' },
          },
        },
      },
    },
  });

  const deleteResponse = await request(`/api/dishes/${userDish.id}`, { method: 'DELETE' });
  assert.equal(deleteResponse.status, 204);
  assert.equal(await prisma.dish.count({ where: { id: userDish.id } }), 0);

  const protectedResponse = await request('/api/dishes/catalog-protected-dish', {
    method: 'DELETE',
  });
  assert.equal(protectedResponse.status, 404);
  assert.equal(await prisma.dish.count({ where: { id: 'catalog-protected-dish' } }), 1);
});

test('recipe catalog loads Spoonacular recipes with images', async () => {
  const previousKey = process.env.SPOONACULAR_API_KEY;
  const previousFetch = globalThis.fetch;
  await prisma.dishIngredient.deleteMany();
  await prisma.dish.deleteMany();
  await prisma.product.deleteMany();
  await prisma.fridgeItem.deleteMany();
  process.env.SPOONACULAR_API_KEY = 'test-spoonacular-key';
  let requestedUrl;
  let requestedIngredientUrl;

  globalThis.fetch = async (url, options) => {
    requestedUrl = new URL(url);
    if (requestedUrl.origin === baseUrl) {
      return previousFetch(url, options);
    }
    if (requestedUrl.pathname === '/recipes/informationBulk') {
      return Response.json([
        {
          id: 715538,
          title: 'Potato Tomato Bake',
          image: 'https://example.com/potato-tomato-bake.jpg',
          summary: '<p>A complete potato and tomato bake.</p>',
          readyInMinutes: 35,
          analyzedInstructions: [{ steps: [{ step: 'Bake until golden.' }] }],
        },
      ]);
    }
    requestedIngredientUrl = requestedUrl;
    return Response.json([
      {
        id: 715538,
        title: 'Potato Tomato Bake',
        image: 'https://example.com/potato-tomato-bake.jpg',
        usedIngredientCount: 2,
        missedIngredientCount: 1,
        usedIngredients: [{ name: 'potato' }, { name: 'tomato' }],
        missedIngredients: [{ name: 'cheese' }],
      },
    ]);
  };

  try {
    await request('/api/fridge', {
      method: 'POST',
      body: JSON.stringify({
        name: 'картошка',
        quantity: 2,
        unit: 'шт.',
        expiresAt: '2026-06-12',
        reminderDays: 3,
        category: 'products',
      }),
    });
    await request('/api/fridge', {
      method: 'POST',
      body: JSON.stringify({
        name: 'помидор',
        quantity: 1,
        unit: 'кг',
        expiresAt: null,
        reminderDays: 0,
        category: 'products',
      }),
    });

    const response = await request('/api/recipes');
    assert.equal(response.status, 200);
    assert.equal(requestedUrl.origin, 'https://api.spoonacular.com');
    assert.equal(requestedUrl.pathname, '/recipes/informationBulk');
    assert.equal(requestedUrl.searchParams.get('apiKey'), 'test-spoonacular-key');
    assert.equal(requestedUrl.searchParams.get('ids'), '715538');
    assert.match(requestedIngredientUrl.searchParams.get('ingredients'), /potato/);
    assert.match(requestedIngredientUrl.searchParams.get('ingredients'), /tomato/);

    const result = await response.json();
    assert.equal(result.ingredients.includes('картошка'), true);
    assert.deepEqual(result.recipes[0], {
      id: 'spoonacular-715538',
      title: 'Potato Tomato Bake',
      image: 'https://example.com/potato-tomato-bake.jpg',
      source: 'spoonacular',
      externalId: '715538',
      subtitle: '35 мин.',
      description: 'A complete potato and tomato bake.',
      instructions: ['Bake until golden.'],
      ingredients: ['cheese', 'potato', 'tomato'],
      preparationMinutes: 35,
      usedIngredientCount: 2,
      missedIngredientCount: 1,
      expiringIngredientCount: 1,
      matchPercent: 67,
      usedIngredients: ['potato', 'tomato'],
      missedIngredients: ['cheese'],
    });
    const previousAdmins = process.env.ADMIN_USER_IDS;
    process.env.ADMIN_USER_IDS = (
      await prisma.user.findUnique({ where: { email: 'test@example.com' } })
    ).id;
    const savedResponse = await request('/api/dev/recipes');
    restoreEnv('ADMIN_USER_IDS', previousAdmins);
    assert.equal(savedResponse.status, 200);
    const saved = await savedResponse.json();
    assert.equal(
      saved.recipes.some((recipe) => recipe.externalId === '715538'),
      true,
    );
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv('SPOONACULAR_API_KEY', previousKey);
  }
});

test('recipe translations are localized once and then loaded from SQLite cache', async () => {
  const previousSpoonacularKey = process.env.SPOONACULAR_API_KEY;
  const previousYandexKey = process.env.YANDEX_TRANSLATE_API_KEY;
  const previousFetch = globalThis.fetch;
  await prisma.translationCache.deleteMany();
  await prisma.dishIngredient.deleteMany();
  await prisma.dish.deleteMany();
  await prisma.product.deleteMany();
  await prisma.fridgeItem.deleteMany();
  process.env.SPOONACULAR_API_KEY = 'test-spoonacular-key';
  process.env.YANDEX_TRANSLATE_API_KEY = 'test-yandex-key';
  let translationCalls = 0;

  const translations = new Map([
    ['Banana Smoothie', 'Банановый смузи'],
    ['banana', 'банан'],
    ['milk', 'молоко'],
  ]);
  globalThis.fetch = async (url, options) => {
    const parsedUrl = new URL(url);
    if (parsedUrl.origin === baseUrl) {
      return previousFetch(url, options);
    }
    if (parsedUrl.hostname === 'translate.api.cloud.yandex.net') {
      translationCalls += 1;
      assert.equal(options.headers.Authorization, 'Api-Key test-yandex-key');
      const body = JSON.parse(options.body);
      assert.equal(body.targetLanguageCode, 'ru');
      return Response.json({
        translations: body.texts.map((text) => ({ text: translations.get(text) ?? text })),
      });
    }
    return Response.json([
      {
        id: 774411,
        title: 'Banana Smoothie',
        image: 'https://example.com/banana-smoothie.jpg',
        usedIngredientCount: 1,
        missedIngredientCount: 1,
        usedIngredients: [{ name: 'banana' }],
        missedIngredients: [{ name: 'milk' }],
      },
    ]);
  };

  try {
    await request('/api/fridge', {
      method: 'POST',
      body: JSON.stringify({
        name: 'банан',
        quantity: 2,
        unit: 'шт.',
        expiresAt: null,
        reminderDays: 0,
        category: 'products',
      }),
    });

    const firstResponse = await request('/api/recipes');
    assert.equal(firstResponse.status, 200);
    const firstResult = await firstResponse.json();
    assert.equal(firstResult.recipes[0].title, 'Банановый смузи');
    assert.deepEqual(firstResult.recipes[0].usedIngredients, ['банан']);
    assert.equal(translationCalls, 1);

    const secondResponse = await request('/api/recipes');
    assert.equal(secondResponse.status, 200);
    assert.equal(translationCalls, 1);
    assert.equal(await prisma.translationCache.count(), 3);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv('SPOONACULAR_API_KEY', previousSpoonacularKey);
    restoreEnv('YANDEX_TRANSLATE_API_KEY', previousYandexKey);
  }
});

test('recipe catalog falls back to popular Spoonacular recipes for unknown names', async () => {
  const previousKey = process.env.SPOONACULAR_API_KEY;
  const previousFetch = globalThis.fetch;
  await prisma.dishIngredient.deleteMany();
  await prisma.dish.deleteMany();
  await prisma.product.deleteMany();
  await prisma.fridgeItem.deleteMany();
  process.env.SPOONACULAR_API_KEY = 'test-spoonacular-key';
  let requestedUrl;

  globalThis.fetch = async (url, options) => {
    const parsedUrl = new URL(url);
    if (parsedUrl.origin === baseUrl) {
      return previousFetch(url, options);
    }
    requestedUrl = parsedUrl;
    return Response.json({
      results: [
        {
          id: 991122,
          title: 'Popular Salmon Dinner',
          image: 'https://example.com/popular-salmon.jpg',
          extendedIngredients: [{ name: 'salmon' }, { name: 'lemon' }],
        },
      ],
    });
  };

  try {
    await request('/api/fridge', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Неизвестный продукт',
        quantity: 1,
        unit: 'шт.',
        expiresAt: null,
        reminderDays: 0,
        category: 'products',
      }),
    });

    const response = await request('/api/recipes');
    assert.equal(response.status, 200);
    assert.equal(requestedUrl.pathname, '/recipes/complexSearch');
    assert.equal(requestedUrl.searchParams.get('addRecipeInformation'), 'true');

    const result = await response.json();
    assert.equal(result.warning, undefined);
    assert.equal(result.recipes[0].source, 'spoonacular-catalog');
    assert.equal(result.recipes[0].image, 'https://example.com/popular-salmon.jpg');
    assert.deepEqual(result.recipes[0].missedIngredients, ['lemon', 'salmon']);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv('SPOONACULAR_API_KEY', previousKey);
  }
});

test('fridge item can be created and partially consumed', async () => {
  const createResponse = await request('/api/fridge', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Творог',
      quantity: 2,
      unit: 'упак.',
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

for (const category of ['products', 'household', 'medicine']) {
  test(`moves ${category} from stock to shopping atomically and rejects a repeat`, async () => {
    const input = {
      name: `Swipe ${category}`,
      quantity: 2.5,
      unit: 'упак.',
      category,
      expiresAt: null,
      reminderDays: 0,
    };
    const createdResponse = await request('/api/fridge', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    const route = `/api/fridge/${created.id}/move-to-shopping`;
    const movedResponse = await request(route, { method: 'POST' });
    assert.equal(movedResponse.status, 200);
    const moved = await movedResponse.json();
    for (const field of ['name', 'quantity', 'unit', 'category'])
      assert.equal(moved[field], input[field]);
    assert.equal(moved.checked, false);
    const repeatedResponse = await request(route, { method: 'POST' });
    assert.equal(repeatedResponse.status, 404);
    const state = await (await request('/api/state')).json();
    assert.equal(
      state.fridgeItems.some((item) => item.id === created.id),
      false,
    );
    assert.equal(state.shoppingItems.filter((item) => item.name === input.name).length, 1);
  });
}

test('failed stock-to-shopping transaction preserves the stock item', async () => {
  const createResponse = await request('/api/fridge', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Swipe rollback',
      quantity: 1,
      unit: 'шт.',
      expiresAt: null,
      reminderDays: 0,
    }),
  });
  const item = await createResponse.json();
  // Fail the second half of the transaction after the shopping insert succeeds.
  await prisma.$executeRawUnsafe(`CREATE TRIGGER swipe_delete_failure BEFORE DELETE ON FridgeItem
    WHEN OLD.name = 'Swipe rollback' BEGIN SELECT RAISE(ABORT, 'test rollback'); END`);
  try {
    const result = await request(`/api/fridge/${item.id}/move-to-shopping`, { method: 'POST' });
    assert.equal(result.status, 500);
    const state = await (await request('/api/state')).json();
    assert.equal(
      state.fridgeItems.some((current) => current.id === item.id),
      true,
    );
    assert.equal(
      state.shoppingItems.some((current) => current.name === item.name),
      false,
    );
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER swipe_delete_failure');
  }
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

test('fridge items can be stored without an expiry date', async () => {
  const createResponse = await request('/api/fridge', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Соль',
      quantity: 1,
      unit: 'шт.',
      expiresAt: null,
      reminderDays: 0,
      category: 'products',
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.expiresAt, null);

  const shoppingResponse = await request('/api/shopping', {
    method: 'POST',
    body: JSON.stringify({ name: 'Губка', category: 'household' }),
  });
  assert.equal(shoppingResponse.status, 201);
  const shoppingItem = await shoppingResponse.json();

  const moveResponse = await request(`/api/shopping/${shoppingItem.id}/move-to-fridge`, {
    method: 'POST',
    body: JSON.stringify({ expiresAt: null, reminderDays: 0, category: 'household' }),
  });
  assert.equal(moveResponse.status, 200);
  const moved = await moveResponse.json();
  assert.equal(moved.expiresAt, null);
  assert.equal(moved.category, 'household');

  const stateResponse = await request('/api/state');
  const state = await stateResponse.json();
  assert.equal(
    state.fridgeItems.some((item) => item.id === created.id && item.expiresAt === null),
    true,
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
  assert.equal(shoppingItem.unit, 'шт.');
  assert.equal(shoppingItem.category, 'household');

  const updateResponse = await request(`/api/shopping/${shoppingItem.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ quantity: 2 }),
  });
  assert.equal(updateResponse.status, 200);
  assert.equal((await updateResponse.json()).quantity, 2);
});

test('household invitation can be accepted and items are shared', async () => {
  const registerResponse = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      displayName: 'РџР°СЂС‚РЅРµСЂ',
      email: 'partner@example.com',
      password: 'test-password-123',
    }),
    skipAuth: true,
  });
  assert.equal(registerResponse.status, 201);
  const partner = await registerResponse.json();

  const partnerCreateResponse = await request('/api/fridge', {
    method: 'POST',
    headers: { Authorization: `Bearer ${partner.token}` },
    body: JSON.stringify({
      name: '\u0421\u044b\u0440',
      quantity: 1,
      unit: '\u0448\u0442.',
      expiresAt: '2026-06-20',
    }),
  });
  assert.equal(partnerCreateResponse.status, 201);
  const partnerItem = await partnerCreateResponse.json();

  const inviteResponse = await request('/api/household/members', {
    method: 'POST',
    body: JSON.stringify({ email: 'partner@example.com' }),
  });
  assert.equal(inviteResponse.status, 201);
  const invitation = await inviteResponse.json();
  assert.equal(invitation.status, 'pending');

  const notificationsResponse = await request('/api/notifications', {
    headers: { Authorization: `Bearer ${partner.token}` },
  });
  assert.equal(notificationsResponse.status, 200);
  const notifications = await notificationsResponse.json();
  assert.equal(
    notifications.notifications.some((notification) => notification.type === 'group_invite'),
    true,
  );

  const acceptResponse = await request(
    `/api/household/invitations/${invitation.invitationId}/accept`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${partner.token}` },
    },
  );
  assert.equal(acceptResponse.status, 200);
  const household = await acceptResponse.json();
  assert.equal(household.members.length, 2);
  assert.equal(
    household.members.some((member) => member.email === 'partner@example.com'),
    true,
  );

  const stateResponse = await request('/api/state');
  const state = await stateResponse.json();
  assert.equal(
    state.fridgeItems.some((item) => item.id === partnerItem.id),
    true,
  );
  assert.equal(state.household.members.length, 2);
});

test('shopping list changes notify the other household members', async () => {
  const partnerLoginResponse = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'partner@example.com',
      password: 'test-password-123',
    }),
    skipAuth: true,
  });
  assert.equal(partnerLoginResponse.status, 200);
  const partner = await partnerLoginResponse.json();

  const createResponse = await request('/api/shopping', {
    method: 'POST',
    body: JSON.stringify({ name: 'Хлеб', quantity: 1, unit: 'шт.', category: 'products' }),
  });
  assert.equal(createResponse.status, 201);
  const item = await createResponse.json();

  const afterCreateResponse = await request('/api/notifications', {
    headers: { Authorization: `Bearer ${partner.token}` },
  });
  const afterCreate = await afterCreateResponse.json();
  assert.equal(
    afterCreate.notifications.some(
      (notification) =>
        notification.type === 'shopping_added' && notification.data?.shoppingItemId === item.id,
    ),
    true,
  );

  const deleteResponse = await request(`/api/shopping/${item.id}`, { method: 'DELETE' });
  assert.equal(deleteResponse.status, 204);
  const afterDeleteResponse = await request('/api/notifications', {
    headers: { Authorization: `Bearer ${partner.token}` },
  });
  const afterDelete = await afterDeleteResponse.json();
  assert.equal(
    afterDelete.notifications.some(
      (notification) =>
        notification.type === 'shopping_removed' && notification.data?.shoppingItemId === item.id,
    ),
    true,
  );
});

test('expiry notifications are generated once per day', async () => {
  const createResponse = await request('/api/fridge', {
    method: 'POST',
    body: JSON.stringify({
      name: '\u0419\u043e\u0433\u0443\u0440\u0442',
      quantity: 1,
      unit: '\u0448\u0442.',
      expiresAt: new Date().toISOString().slice(0, 10),
      reminderDays: 1,
      category: 'products',
    }),
  });
  assert.equal(createResponse.status, 201);

  const firstResponse = await request('/api/notifications');
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  assert.equal(
    first.notifications.some((notification) => notification.type === 'expiry'),
    true,
  );

  const secondResponse = await request('/api/notifications');
  const second = await secondResponse.json();
  assert.equal(
    second.notifications.filter((notification) => notification.type === 'expiry').length,
    first.notifications.filter((notification) => notification.type === 'expiry').length,
  );
});

test('invalid payload is rejected', async () => {
  const response = await request('/api/fridge', {
    method: 'POST',
    body: JSON.stringify({ name: '', quantity: -1, unit: 'bad', expiresAt: 'today' }),
  });
  assert.equal(response.status, 400);
});

test('a verified OAuth owner can access admin endpoints', async () => {
  const owner = await prisma.user.create({
    data: {
      email: 'krisyagodka@gmail.com',
      displayName: 'Verified owner',
      authProvider: 'google',
      providerSubject: 'verified-google-owner',
      household: { create: { name: 'Owner home' } },
    },
  });
  const session = await createSession(prisma, owner.id);
  const response = await request('/api/dev/summary', {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  assert.equal(response.status, 200);
});

test('untrusted origins cannot mutate data even with a valid session', async () => {
  const count = await prisma.shoppingItem.count();
  const response = await request('/api/shopping', {
    method: 'POST',
    headers: { Origin: 'https://untrusted.example' },
    body: JSON.stringify({ name: 'Forged shopping item' }),
  });
  assert.equal(response.status, 403);
  assert.equal(await prisma.shoppingItem.count(), count);
  const native = await request('/api/shopping', {
    method: 'POST',
    headers: { Origin: 'https://localhost' },
    body: JSON.stringify({ name: 'Native shopping item' }),
  });
  assert.equal(native.status, 201);
});

test('JSON routes reject form and text bodies', async () => {
  const response = await request('/api/shopping', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ name: 'Forged shopping item' }),
  });
  assert.equal(response.status, 415);
});

test('malformed session and OAuth cookies do not cause server errors', async () => {
  const session = await request('/api/state', {
    skipAuth: true,
    headers: { Cookie: 'eat_it_session=%E0%A4%A' },
  });
  assert.equal(session.status, 401);
  const oauth = await request('/api/auth/google/callback?code=bad&state=bad', {
    skipAuth: true,
    redirect: 'manual',
    headers: { Cookie: 'eat_it_google_state=%ZZ' },
  });
  assert.equal(oauth.status, 302);
  assert.match(oauth.headers.get('location'), /auth_error=google_failed/);
});

test('push subscriptions reject internal, insecure and lookalike endpoints', async () => {
  const count = await prisma.pushSubscription.count();
  for (const endpoint of [
    'http://fcm.googleapis.com/fcm/send/token',
    'https://127.0.0.1/private',
    'https://169.254.169.254/latest/meta-data',
    'https://localhost/private',
    'https://fcm.googleapis.com.evil.example/push',
    'https://evil.example/push',
    'https://fcm.googleapis.com:444/push',
    'https://user:password@fcm.googleapis.com/push',
  ]) {
    const response = await request('/api/push/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        endpoint,
        keys: { p256dh: 'test-p256dh-key-material', auth: 'test-auth-key' },
      }),
    });
    assert.equal(response.status, 400, endpoint);
  }
  assert.equal(await prisma.pushSubscription.count(), count);
});

test('impossible calendar dates are rejected without database writes', async () => {
  const count = await prisma.fridgeItem.count();
  for (const expiresAt of ['2026-02-30', '2026-13-01', '2026-00-00']) {
    const response = await request('/api/fridge', {
      method: 'POST',
      body: JSON.stringify({ name: 'Invalid date', quantity: 1, unit: 'шт.', expiresAt }),
    });
    assert.equal(response.status, 400);
  }
  assert.equal(await prisma.fridgeItem.count(), count);
});

test('login throttling applies across email casing and spoofed proxy headers', async () => {
  for (let i = 0; i < 11; i++) {
    const response = await request('/api/auth/login', {
      method: 'POST',
      skipAuth: true,
      headers: { 'X-Forwarded-For': `192.0.2.${i}` },
      body: JSON.stringify({
        email: i % 2 ? 'RATE-LIMIT@example.com' : 'rate-limit@example.com',
        password: 'wrong-password',
      }),
    });
    assert.equal(response.status, i < 10 ? 401 : 429);
    if (i === 10) assert.ok(Number(response.headers.get('retry-after')) > 0);
  }
});

test('auth rate limits expire after their window', () => {
  const limit = createAuthLimiter();
  assert.equal(limit('ip:test', 2, 0), 0);
  assert.equal(limit('ip:test', 2, 1), 0);
  assert.equal(limit('ip:test', 2, 2), 900);
  assert.equal(limit('ip:test', 2, 900_000), 0);
});

test('proxy client addresses require explicit trust and a local connection', () => {
  const previous = process.env.TRUST_PROXY;
  try {
    const request = {
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'x-real-ip': '192.0.2.1' },
    };
    delete process.env.TRUST_PROXY;
    assert.equal(clientAddress(request), '127.0.0.1');
    process.env.TRUST_PROXY = 'true';
    assert.equal(clientAddress(request), '192.0.2.1');
    request.socket.remoteAddress = '192.0.2.2';
    assert.equal(clientAddress(request), '192.0.2.2');
  } finally {
    restoreEnv('TRUST_PROXY', previous);
  }
});

test('accepting an invitation cannot transfer other household members', async () => {
  const inviter = await prisma.user.create({
    data: {
      email: 'privacy-inviter@example.com',
      displayName: 'Inviter',
      household: { create: { name: 'Inviter home' } },
    },
  });
  const source = await prisma.household.create({ data: { name: 'Private shared home' } });
  const member = await prisma.user.create({
    data: { email: 'privacy-member@example.com', displayName: 'Member', householdId: source.id },
  });
  const bystander = await prisma.user.create({
    data: {
      email: 'privacy-bystander@example.com',
      displayName: 'Bystander',
      householdId: source.id,
    },
  });
  const item = await prisma.fridgeItem.create({
    data: { householdId: source.id, name: 'Private item', quantity: 1, unit: 'шт.' },
  });
  const invitation = await prisma.householdInvitation.create({
    data: { householdId: inviter.householdId, inviterId: inviter.id, inviteeId: member.id },
  });
  const session = await createSession(prisma, member.id);
  const response = await request(`/api/household/invitations/${invitation.id}/accept`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.token}` },
  });
  assert.equal(response.status, 409);
  assert.equal(
    (await prisma.user.findUnique({ where: { id: bystander.id } })).householdId,
    source.id,
  );
  assert.equal(
    (await prisma.fridgeItem.findUnique({ where: { id: item.id } })).householdId,
    source.id,
  );
  assert.equal(
    (await prisma.householdInvitation.findUnique({ where: { id: invitation.id } })).status,
    'pending',
  );
});

test('verified OAuth sign-in revokes the unverified password and old sessions', async () => {
  const response = await request('/api/auth/register', {
    method: 'POST',
    skipAuth: true,
    body: JSON.stringify({
      email: 'oauth-owner@example.com',
      displayName: 'Old registrant',
      password: 'old-password-123',
    }),
  });
  assert.equal(response.status, 201);
  const registrant = await response.json();
  const owner = await findOrCreateOAuthUser(prisma, 'google', {
    subject: 'verified-email-owner',
    email: 'oauth-owner@example.com',
    emailVerified: true,
    displayName: 'Owner',
  });
  assert.equal(owner.id, registrant.user.id);
  assert.equal(owner.passwordHash, null);
  assert.equal(owner.authProvider, 'google');
  const staleSession = await request('/api/state', {
    headers: { Authorization: `Bearer ${registrant.token}` },
  });
  assert.equal(staleSession.status, 401);
  const passwordLogin = await request('/api/auth/login', {
    method: 'POST',
    skipAuth: true,
    body: JSON.stringify({ email: 'oauth-owner@example.com', password: 'old-password-123' }),
  });
  assert.equal(passwordLogin.status, 401);
  assert.equal(
    (
      await findOrCreateOAuthUser(prisma, 'google', {
        subject: 'verified-email-owner',
        email: 'oauth-owner@example.com',
        emailVerified: true,
      })
    ).id,
    owner.id,
  );
});

async function recipeAccount(email) {
  const user = await prisma.user.create({
    data: { email, displayName: 'Recipe tester', household: { create: { name: 'Recipe home' } } },
  });
  const session = await createSession(prisma, user.id);
  return { user, headers: { Authorization: `Bearer ${session.token}` } };
}

test('own recipes save real steps and editing preserves identifiers, quantities and meal plans', async () => {
  const { user, headers } = await recipeAccount('recipe-editor@example.com');
  const input = {
    title: 'Домашняя запеканка',
    description: 'Наш рецепт',
    ingredients: ['Картофель', 'картофель', 'Молоко'],
    instructions: ['Очистите картофель.', 'Запеките до готовности.'],
    preparationMinutes: 45,
    imageUrl: 'https://example.com/casserole.jpg',
  };
  const created = await request('/api/dishes', {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });
  assert.equal(created.status, 201);
  const recipe = (await created.json()).recipes[0];
  assert.deepEqual(recipe.instructions, input.instructions);
  assert.equal(recipe.ingredients.length, 2);
  assert.equal(recipe.preparationMinutes, 45);
  const detail = await request(`/api/recipes/${recipe.id}`, { headers });
  assert.equal((await detail.json()).recipe.id, recipe.id);
  const ingredient = await prisma.dishIngredient.findFirst({ where: { dishId: recipe.id } });
  await prisma.dishIngredient.update({
    where: { id: ingredient.id },
    data: { quantity: 3, unit: 'шт.' },
  });
  const plan = await prisma.mealPlanEntry.create({
    data: {
      householdId: user.householdId,
      dishId: recipe.id,
      date: new Date('2026-10-05T00:00:00.000Z'),
      mealType: 'dinner',
    },
  });
  const updatedInput = {
    ...input,
    title: 'Новая запеканка',
    ingredients: recipe.ingredients,
    instructions: ['Теперь другой способ.'],
    preparationMinutes: 30,
    imageUrl: null,
  };
  const updated = await request(`/api/dishes/${recipe.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(updatedInput),
  });
  assert.equal(updated.status, 200);
  const edited = (await updated.json()).recipes[0];
  assert.equal(edited.id, recipe.id);
  assert.equal(edited.title, updatedInput.title);
  assert.equal(edited.image, null);
  assert.equal(edited.preparationMinutes, 30);
  assert.deepEqual(edited.instructions, updatedInput.instructions);
  assert.equal(
    (await prisma.mealPlanEntry.findUnique({ where: { id: plan.id } })).dishId,
    recipe.id,
  );
  const retained = await prisma.dishIngredient.findFirst({
    where: { dishId: recipe.id, productId: ingredient.productId },
  });
  assert.equal(retained.quantity, 3);
  assert.equal(retained.unit, 'шт.');
  const invalid = await request(`/api/dishes/${recipe.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ ...updatedInput, instructions: [] }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(
    (await prisma.dish.findUnique({ where: { id: recipe.id } })).instructions,
    JSON.stringify(updatedInput.instructions),
  );
  for (const patch of [
    { ingredients: ['!!!'] },
    { ingredients: Array.from({ length: 21 }, (_, index) => `Ingredient ${index}`) },
    { instructions: ['a'.repeat(1001)] },
    { preparationMinutes: -1 },
    { preparationMinutes: 1.5 },
    { imageUrl: 'javascript:alert(1)' },
  ]) {
    const invalidResponse = await request(`/api/dishes/${recipe.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ ...updatedInput, ...patch }),
    });
    assert.equal(invalidResponse.status, 400);
  }
});

test('recipe editing, details and match lists are scoped to the household and protect the catalog', async () => {
  const owner = await recipeAccount('recipe-owner@example.com');
  const stranger = await recipeAccount('recipe-stranger@example.com');
  const input = { title: 'Секретный рецепт', ingredients: ['Рис'], instructions: ['Сварите рис.'] };
  const created = await request('/api/dishes', {
    method: 'POST',
    headers: owner.headers,
    body: JSON.stringify(input),
  });
  const recipe = (await created.json()).recipes[0];
  const catalog = await prisma.dish.create({
    data: { title: 'Защищённый каталог', source: 'catalog' },
  });
  for (const id of [recipe.id, catalog.id]) {
    const response = await request(`/api/dishes/${id}`, {
      method: 'PATCH',
      headers: stranger.headers,
      body: JSON.stringify(input),
    });
    assert.equal(response.status, 404);
  }
  assert.equal(
    (await request(`/api/recipes/${recipe.id}`, { headers: stranger.headers })).status,
    404,
  );
  const matches = await request('/api/recipes/matches', { headers: stranger.headers });
  assert.equal(matches.status, 200);
  assert.equal(
    (await matches.json()).recipes.some((item) => item.id === recipe.id),
    false,
  );
  assert.equal((await prisma.dish.findUnique({ where: { id: catalog.id } })).title, catalog.title);
});

test('local matches include the whole catalog, own recipes and all stock without external requests', async () => {
  const { user, headers } = await recipeAccount('recipe-matches@example.com');
  const product = await prisma.product.upsert({
    where: { normalizedName: 'pickeringredient' },
    update: {},
    create: { name: 'PickerIngredient', normalizedName: 'pickeringredient', aliases: '[]' },
  });
  const dishes = [];
  for (let index = 0; index < 10; index++) {
    dishes.push(
      await prisma.dish.create({
        data: {
          title: `Picker catalog ${index}`,
          source: 'catalog',
          ingredients: { create: { productId: product.id } },
        },
      }),
    );
  }
  await prisma.fridgeItem.create({
    data: {
      householdId: user.householdId,
      name: product.name,
      quantity: 1,
      unit: 'шт.',
      createdAt: new Date('2020-01-01'),
    },
  });
  for (let index = 0; index < 101; index++) {
    await prisma.fridgeItem.create({
      data: {
        householdId: user.householdId,
        name: `Unrelated ${index}`,
        quantity: 1,
        unit: 'шт.',
      },
    });
  }
  const created = await request('/api/dishes', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: 'Picker own',
      ingredients: [product.name, 'PickerMissing'],
      instructions: ['Смешайте.'],
    }),
  });
  const own = (await created.json()).recipes[0];
  const previousKey = process.env.SPOONACULAR_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.SPOONACULAR_API_KEY = 'must-not-be-used';
  globalThis.fetch = (url, options) => {
    assert.equal(new URL(url).origin, baseUrl, 'matches must use the saved catalog');
    return previousFetch(url, options);
  };
  try {
    const response = await request('/api/recipes/matches', { headers });
    assert.equal(response.status, 200);
    const matches = (await response.json()).recipes;
    for (const dish of dishes) {
      assert.equal(matches.find((item) => item.id === dish.id)?.missedIngredientCount, 0);
      assert.equal(
        (await (await request(`/api/recipes/${dish.id}`, { headers })).json()).recipe.id,
        dish.id,
      );
    }
    assert.deepEqual(matches.find((item) => item.id === own.id).missedIngredients, [
      'PickerMissing',
    ]);
    const stock = await request('/api/fridge', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'PickerMissing',
        quantity: 1,
        unit: 'шт.',
        category: 'products',
        expiresAt: null,
        reminderDays: 0,
      }),
    });
    assert.equal(stock.status, 201);
    const stockItem = await stock.json();
    const refreshed = (await (await request('/api/recipes/matches', { headers })).json()).recipes;
    assert.equal(refreshed.find((item) => item.id === own.id).missedIngredientCount, 0);
    assert.equal(
      (await request(`/api/fridge/${stockItem.id}`, { method: 'DELETE', headers })).status,
      204,
    );
    const afterRemoval = (await (await request('/api/recipes/matches', { headers })).json())
      .recipes;
    assert.equal(afterRemoval.find((item) => item.id === own.id).missedIngredientCount, 1);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv('SPOONACULAR_API_KEY', previousKey);
  }
});
