import { createServer } from 'node:http';
import { ZodError } from 'zod';
import {
  authenticate,
  clearSessionCookie,
  createSession,
  hashPassword,
  hashToken,
  sessionCookie,
  verifyPassword,
} from './auth.mjs';
import {
  appleAuthorization,
  clearOauthCookie,
  cookieValue,
  exchangeAppleCode,
  exchangeGoogleCode,
  googleAuthorization,
  oauthCookie,
} from './oauth.mjs';
import {
  consumeSchema,
  fridgeCreateSchema,
  fridgeUpdateSchema,
  loginSchema,
  registerSchema,
  shoppingCreateSchema,
  shoppingToFridgeSchema,
  shoppingUpdateSchema,
} from './validation.mjs';

const BODY_LIMIT = 64 * 1024;

function json(response, status, body, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let size = 0;
  const chunks = [];

  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) {
      const error = new Error('Request body is too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Invalid JSON');
    error.status = 400;
    throw error;
  }
}

async function readForm(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk.toString('utf8');
    if (body.length > BODY_LIMIT) {
      const error = new Error('Request body is too large');
      error.status = 413;
      throw error;
    }
  }
  return new URLSearchParams(body);
}

function toDate(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function serializeFridgeItem({ householdId, ...item }) {
  return {
    ...item,
    expiresAt: item.expiresAt.toISOString().slice(0, 10),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function serializeShoppingItem({ householdId, ...item }) {
  return {
    ...item,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function serializeUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    householdId: user.householdId,
    authProvider: user.authProvider,
  };
}

function routeMatch(pathname, pattern) {
  const match = pathname.match(pattern);
  return match?.groups ?? null;
}

function isSecureRequest(request) {
  return request.headers['x-forwarded-proto'] === 'https';
}

function authResponse(response, status, user, session, request) {
  json(
    response,
    status,
    { user: serializeUser(user), token: session.token, expiresAt: session.expiresAt.toISOString() },
    { 'Set-Cookie': sessionCookie(session.token, session.expiresAt, isSecureRequest(request)) },
  );
}

function redirect(response, location, cookies = []) {
  response.writeHead(302, {
    Location: location,
    'Cache-Control': 'no-store',
    ...(cookies.length > 0 ? { 'Set-Cookie': cookies } : {}),
  });
  response.end();
}

async function createHouseholdForUser(transaction, displayName) {
  const userCount = await transaction.user.count();
  if (userCount === 0) {
    const legacy = await transaction.household.findUnique({
      where: { id: 'legacy-household' },
    });
    if (legacy) {
      return legacy;
    }
  }
  return transaction.household.create({ data: { name: `${displayName}: дом` } });
}

async function findOrCreateOAuthUser(prisma, provider, profile) {
  if (!profile.subject || !profile.email || !profile.emailVerified) {
    throw new Error('OAuth provider did not return a verified email');
  }

  const identity = await prisma.authIdentity.findUnique({
    where: { provider_subject: { provider, subject: profile.subject } },
    include: { user: true },
  });
  if (identity) {
    return identity.user;
  }

  return prisma.$transaction(async (transaction) => {
    let user = await transaction.user.findUnique({
      where: { email: profile.email.toLowerCase() },
    });
    if (!user) {
      const household = await createHouseholdForUser(transaction, profile.displayName);
      user = await transaction.user.create({
        data: {
          householdId: household.id,
          email: profile.email.toLowerCase(),
          displayName: profile.displayName,
          authProvider: provider,
          providerSubject: profile.subject,
        },
      });
    }
    await transaction.authIdentity.create({
      data: { userId: user.id, provider, subject: profile.subject },
    });
    return user;
  });
}

async function findFridgeItem(prisma, id, householdId) {
  const item = await prisma.fridgeItem.findFirst({ where: { id, householdId } });
  if (!item) {
    const error = new Error('Item not found');
    error.status = 404;
    throw error;
  }
  return item;
}

async function findShoppingItem(prisma, id, householdId) {
  const item = await prisma.shoppingItem.findFirst({ where: { id, householdId } });
  if (!item) {
    const error = new Error('Item not found');
    error.status = 404;
    throw error;
  }
  return item;
}

export function createApiServer(prisma, logger = console) {
  return createServer(async (request, response) => {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', 'http://localhost');

    try {
      if (method === 'GET' && url.pathname === '/api/health') {
        json(response, 200, { status: 'ok' });
        return;
      }

      if (method === 'GET' && url.pathname === '/api/auth/providers') {
        json(response, 200, {
          password: true,
          google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
          apple: Boolean(
            process.env.APPLE_CLIENT_ID &&
            process.env.APPLE_TEAM_ID &&
            process.env.APPLE_KEY_ID &&
            process.env.APPLE_PRIVATE_KEY,
          ),
        });
        return;
      }

      if (method === 'POST' && url.pathname === '/api/auth/register') {
        const input = registerSchema.parse(await readJson(request));
        const existing = await prisma.user.findUnique({ where: { email: input.email } });
        if (existing) {
          json(response, 409, { error: 'Аккаунт с таким email уже существует' });
          return;
        }

        const passwordHash = await hashPassword(input.password);
        const user = await prisma.$transaction(async (transaction) => {
          const household = await createHouseholdForUser(transaction, input.displayName);

          return transaction.user.create({
            data: {
              householdId: household.id,
              email: input.email,
              displayName: input.displayName,
              passwordHash,
            },
          });
        });
        const session = await createSession(prisma, user.id);
        authResponse(response, 201, user, session, request);
        return;
      }

      if (method === 'POST' && url.pathname === '/api/auth/login') {
        const input = loginSchema.parse(await readJson(request));
        const user = await prisma.user.findUnique({ where: { email: input.email } });
        if (!user?.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) {
          json(response, 401, { error: 'Неверный email или пароль' });
          return;
        }
        const session = await createSession(prisma, user.id);
        authResponse(response, 200, user, session, request);
        return;
      }

      if (method === 'GET' && url.pathname === '/api/auth/google') {
        if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
          json(response, 503, { error: 'Google OAuth is not configured' });
          return;
        }
        const authorization = googleAuthorization();
        redirect(response, authorization.url, [
          oauthCookie('eat_it_google_state', authorization.state, isSecureRequest(request)),
          oauthCookie('eat_it_google_verifier', authorization.verifier, isSecureRequest(request)),
        ]);
        return;
      }

      if (method === 'GET' && url.pathname === '/api/auth/google/callback') {
        const state = cookieValue(request, 'eat_it_google_state');
        const verifier = cookieValue(request, 'eat_it_google_verifier');
        if (!state || state !== url.searchParams.get('state') || !verifier) {
          json(response, 400, { error: 'Invalid Google OAuth state' });
          return;
        }
        const profile = await exchangeGoogleCode(url.searchParams.get('code'), verifier);
        const user = await findOrCreateOAuthUser(prisma, 'google', profile);
        const session = await createSession(prisma, user.id);
        redirect(response, process.env.APP_URL ?? 'https://eat-it.space', [
          sessionCookie(session.token, session.expiresAt, isSecureRequest(request)),
          clearOauthCookie('eat_it_google_state', isSecureRequest(request)),
          clearOauthCookie('eat_it_google_verifier', isSecureRequest(request)),
        ]);
        return;
      }

      if (method === 'GET' && url.pathname === '/api/auth/apple') {
        if (
          !process.env.APPLE_CLIENT_ID ||
          !process.env.APPLE_TEAM_ID ||
          !process.env.APPLE_KEY_ID ||
          !process.env.APPLE_PRIVATE_KEY
        ) {
          json(response, 503, { error: 'Apple OAuth is not configured' });
          return;
        }
        const authorization = appleAuthorization();
        redirect(response, authorization.url, [
          oauthCookie('eat_it_apple_state', authorization.state, true, 'None'),
          oauthCookie('eat_it_apple_nonce', authorization.nonce, true, 'None'),
        ]);
        return;
      }

      if (method === 'POST' && url.pathname === '/api/auth/apple/callback') {
        const form = await readForm(request);
        const state = cookieValue(request, 'eat_it_apple_state');
        const nonce = cookieValue(request, 'eat_it_apple_nonce');
        if (!state || state !== form.get('state') || !nonce) {
          json(response, 400, { error: 'Invalid Apple OAuth state' });
          return;
        }
        const profile = await exchangeAppleCode(form.get('code'), nonce);
        const user = await findOrCreateOAuthUser(prisma, 'apple', profile);
        const session = await createSession(prisma, user.id);
        redirect(response, process.env.APP_URL ?? 'https://eat-it.space', [
          sessionCookie(session.token, session.expiresAt, true),
          clearOauthCookie('eat_it_apple_state', true, 'None'),
          clearOauthCookie('eat_it_apple_nonce', true, 'None'),
        ]);
        return;
      }

      const auth = await authenticate(prisma, request);
      if (!auth) {
        json(response, 401, { error: 'Требуется авторизация' });
        return;
      }
      const { user } = auth;

      if (method === 'GET' && url.pathname === '/api/auth/me') {
        json(response, 200, { user: serializeUser(user) });
        return;
      }

      if (method === 'POST' && url.pathname === '/api/auth/logout') {
        await prisma.session.delete({ where: { id: auth.session.id } });
        json(
          response,
          200,
          { success: true },
          { 'Set-Cookie': clearSessionCookie(isSecureRequest(request)) },
        );
        return;
      }

      if (method === 'DELETE' && url.pathname === '/api/auth/account') {
        await prisma.$transaction(async (transaction) => {
          const householdUsers = await transaction.user.count({
            where: { householdId: user.householdId },
          });
          await transaction.user.delete({ where: { id: user.id } });
          if (householdUsers === 1) {
            await transaction.household.delete({ where: { id: user.householdId } });
          }
        });
        json(
          response,
          200,
          { success: true },
          { 'Set-Cookie': clearSessionCookie(isSecureRequest(request)) },
        );
        return;
      }

      if (method === 'GET' && url.pathname === '/api/state') {
        const [fridgeItems, shoppingItems] = await Promise.all([
          prisma.fridgeItem.findMany({
            where: { householdId: user.householdId },
            orderBy: [{ expiresAt: 'asc' }, { createdAt: 'desc' }],
          }),
          prisma.shoppingItem.findMany({
            where: { householdId: user.householdId },
            orderBy: { createdAt: 'desc' },
          }),
        ]);
        json(response, 200, {
          fridgeItems: fridgeItems.map(serializeFridgeItem),
          shoppingItems: shoppingItems.map(serializeShoppingItem),
        });
        return;
      }

      if (method === 'POST' && url.pathname === '/api/fridge') {
        const input = fridgeCreateSchema.parse(await readJson(request));
        const item = await prisma.fridgeItem.create({
          data: { ...input, householdId: user.householdId, expiresAt: toDate(input.expiresAt) },
        });
        json(response, 201, serializeFridgeItem(item));
        return;
      }

      const fridgeRoute = routeMatch(url.pathname, /^\/api\/fridge\/(?<id>[^/]+)$/);
      if (fridgeRoute && method === 'PATCH') {
        const input = fridgeUpdateSchema.parse(await readJson(request));
        await findFridgeItem(prisma, fridgeRoute.id, user.householdId);
        const item = await prisma.fridgeItem.update({
          where: { id: fridgeRoute.id },
          data: {
            ...input,
            ...(input.expiresAt ? { expiresAt: toDate(input.expiresAt) } : {}),
          },
        });
        json(response, 200, serializeFridgeItem(item));
        return;
      }

      if (fridgeRoute && method === 'DELETE') {
        await findFridgeItem(prisma, fridgeRoute.id, user.householdId);
        await prisma.fridgeItem.delete({ where: { id: fridgeRoute.id } });
        response.writeHead(204);
        response.end();
        return;
      }

      const consumeRoute = routeMatch(url.pathname, /^\/api\/fridge\/(?<id>[^/]+)\/consume$/);
      if (consumeRoute && method === 'POST') {
        const input = consumeSchema.parse(await readJson(request));
        const current = await findFridgeItem(prisma, consumeRoute.id, user.householdId);
        const remaining = current.quantity - input.quantity;

        if (remaining <= 0) {
          await prisma.fridgeItem.delete({ where: { id: current.id } });
          json(response, 200, { removed: true, item: null });
          return;
        }

        const item = await prisma.fridgeItem.update({
          where: { id: current.id },
          data: { quantity: remaining },
        });
        json(response, 200, { removed: false, item: serializeFridgeItem(item) });
        return;
      }

      const fridgeToShoppingRoute = routeMatch(
        url.pathname,
        /^\/api\/fridge\/(?<id>[^/]+)\/move-to-shopping$/,
      );
      if (fridgeToShoppingRoute && method === 'POST') {
        const result = await prisma.$transaction(async (transaction) => {
          const current = await findFridgeItem(
            transaction,
            fridgeToShoppingRoute.id,
            user.householdId,
          );
          const shoppingItem = await transaction.shoppingItem.create({
            data: {
              householdId: user.householdId,
              name: current.name,
              quantity: current.quantity,
              unit: current.unit,
              category: current.category,
            },
          });
          await transaction.fridgeItem.delete({ where: { id: current.id } });
          return shoppingItem;
        });
        json(response, 200, serializeShoppingItem(result));
        return;
      }

      if (method === 'POST' && url.pathname === '/api/shopping') {
        const input = shoppingCreateSchema.parse(await readJson(request));
        const item = await prisma.shoppingItem.create({
          data: {
            ...input,
            householdId: user.householdId,
          },
        });
        json(response, 201, serializeShoppingItem(item));
        return;
      }

      if (method === 'DELETE' && url.pathname === '/api/shopping/completed') {
        const result = await prisma.shoppingItem.deleteMany({
          where: { householdId: user.householdId, checked: true },
        });
        json(response, 200, { deleted: result.count });
        return;
      }

      const shoppingRoute = routeMatch(url.pathname, /^\/api\/shopping\/(?<id>[^/]+)$/);
      if (shoppingRoute && method === 'PATCH') {
        const input = shoppingUpdateSchema.parse(await readJson(request));
        await findShoppingItem(prisma, shoppingRoute.id, user.householdId);
        const item = await prisma.shoppingItem.update({
          where: { id: shoppingRoute.id },
          data: input,
        });
        json(response, 200, serializeShoppingItem(item));
        return;
      }

      if (shoppingRoute && method === 'DELETE') {
        await findShoppingItem(prisma, shoppingRoute.id, user.householdId);
        await prisma.shoppingItem.delete({ where: { id: shoppingRoute.id } });
        response.writeHead(204);
        response.end();
        return;
      }

      const shoppingToFridgeRoute = routeMatch(
        url.pathname,
        /^\/api\/shopping\/(?<id>[^/]+)\/move-to-fridge$/,
      );
      if (shoppingToFridgeRoute && method === 'POST') {
        const input = shoppingToFridgeSchema.parse(await readJson(request));
        const result = await prisma.$transaction(async (transaction) => {
          const current = await findShoppingItem(
            transaction,
            shoppingToFridgeRoute.id,
            user.householdId,
          );
          const fridgeItem = await transaction.fridgeItem.create({
            data: {
              householdId: user.householdId,
              name: current.name,
              quantity: input.quantity ?? current.quantity ?? 1,
              unit: input.unit ?? current.unit ?? 'шт',
              expiresAt: toDate(input.expiresAt),
              reminderDays: input.reminderDays ?? 1,
              category: input.category ?? current.category,
            },
          });
          await transaction.shoppingItem.delete({ where: { id: current.id } });
          return fridgeItem;
        });
        json(response, 200, serializeFridgeItem(result));
        return;
      }

      json(response, 404, { error: 'Route not found' });
    } catch (error) {
      if (error instanceof ZodError) {
        json(response, 400, { error: 'Validation failed', details: error.issues });
        return;
      }

      if (error?.code === 'P2002') {
        json(response, 409, { error: 'Такая запись уже существует' });
        return;
      }

      const status = Number.isInteger(error?.status) ? error.status : 500;
      if (status >= 500) {
        logger.error(`${method} ${url.pathname}`, error);
      }
      json(response, status, { error: status >= 500 ? 'Internal server error' : error.message });
    }
  });
}
