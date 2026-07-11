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
  feedbackCreateSchema,
  householdMemberSchema,
  householdUpdateSchema,
  loginSchema,
  notificationUpdateSchema,
  registerSchema,
  shoppingCreateSchema,
  shoppingToFridgeSchema,
  shoppingUpdateSchema,
  supportMessageCreateSchema,
  supportTicketCreateSchema,
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

function serializeHousehold(household) {
  return {
    id: household.id,
    name: household.name,
    members: household.users.map(serializeUser),
  };
}

function serializeNotification(notification) {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    readAt: notification.readAt?.toISOString() ?? null,
    data: notification.data ? JSON.parse(notification.data) : null,
    createdAt: notification.createdAt.toISOString(),
  };
}

function serializeSupportTicket(ticket) {
  const lastMessage = ticket.messages?.[0] ?? null;
  return {
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    closedAt: ticket.closedAt?.toISOString() ?? null,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    user: ticket.user ? serializeUser(ticket.user) : undefined,
    lastMessage: lastMessage
      ? {
          id: lastMessage.id,
          authorRole: lastMessage.authorRole,
          body: lastMessage.body,
          createdAt: lastMessage.createdAt.toISOString(),
        }
      : null,
  };
}

function serializeSupportMessage(message) {
  return {
    id: message.id,
    ticketId: message.ticketId,
    authorRole: message.authorRole,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
    author: message.author ? serializeUser(message.author) : undefined,
  };
}

function serializeFeedbackItem(item) {
  return {
    id: item.id,
    type: item.type,
    body: item.body,
    status: item.status,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    user: item.user ? serializeUser(item.user) : undefined,
  };
}

async function getHousehold(prisma, householdId) {
  const household = await prisma.household.findUnique({
    where: { id: householdId },
    include: { users: { orderBy: [{ displayName: 'asc' }, { email: 'asc' }] } },
  });
  if (!household) {
    const error = new Error('Group not found');
    error.status = 404;
    throw error;
  }
  return household;
}

async function mergeHouseholdInto(transaction, sourceHouseholdId, targetHouseholdId) {
  if (sourceHouseholdId === targetHouseholdId) {
    return;
  }

  await transaction.fridgeItem.updateMany({
    where: { householdId: sourceHouseholdId },
    data: { householdId: targetHouseholdId },
  });
  await transaction.shoppingItem.updateMany({
    where: { householdId: sourceHouseholdId },
    data: { householdId: targetHouseholdId },
  });
  await transaction.user.updateMany({
    where: { householdId: sourceHouseholdId },
    data: { householdId: targetHouseholdId },
  });
  await transaction.household.deleteMany({
    where: { id: sourceHouseholdId, users: { none: {} } },
  });
}

async function createNotification(prisma, { userId, type, title, body, data, dedupeKey }) {
  try {
    return await prisma.notification.create({
      data: {
        userId,
        type,
        title,
        body,
        data: data ? JSON.stringify(data) : null,
        dedupeKey,
      },
    });
  } catch (error) {
    if (error?.code === 'P2002' && dedupeKey) {
      return null;
    }
    throw error;
  }
}

async function ensureExpiryNotifications(prisma, user) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const items = await prisma.fridgeItem.findMany({
    where: { householdId: user.householdId },
    orderBy: [{ expiresAt: 'asc' }, { createdAt: 'desc' }],
  });

  await Promise.all(
    items.map(async (item) => {
      const expires = new Date(item.expiresAt);
      expires.setUTCHours(0, 0, 0, 0);
      const days = Math.ceil((expires.getTime() - today.getTime()) / 86_400_000);
      if (days > item.reminderDays) {
        return;
      }

      let body = `${item.name}: срок уже истек.`;
      if (days === 0) {
        body = `${item.name}: срок истекает сегодня.`;
      } else if (days > 0) {
        body = `${item.name}: срок истекает через ${days} дн.`;
      }

      await createNotification(prisma, {
        userId: user.id,
        type: 'expiry',
        title: 'Срок годности',
        body,
        data: { fridgeItemId: item.id, expiresAt: item.expiresAt.toISOString().slice(0, 10) },
        dedupeKey: `expiry:${item.id}:${today.toISOString().slice(0, 10)}`,
      });
    }),
  );
}

function routeMatch(pathname, pattern) {
  const match = pathname.match(pattern);
  return match?.groups ?? null;
}

function isSecureRequest(request) {
  return request.headers['x-forwarded-proto'] === 'https';
}

function adminEmails() {
  return new Set(
    (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isAdmin(user) {
  return adminEmails().has(user.email.toLowerCase());
}

function requireAdmin(user) {
  if (isAdmin(user)) {
    return;
  }
  const error = new Error('Admin access required');
  error.status = 403;
  throw error;
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

function appLocation(searchParams = {}) {
  const location = new URL(process.env.APP_URL ?? 'https://eat-it.space');
  for (const [key, value] of Object.entries(searchParams)) {
    if (value) {
      location.searchParams.set(key, value);
    }
  }
  return location.toString();
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
        const clearCookies = [
          clearOauthCookie('eat_it_google_state', isSecureRequest(request)),
          clearOauthCookie('eat_it_google_verifier', isSecureRequest(request)),
        ];
        if (url.searchParams.get('error')) {
          redirect(response, appLocation({ auth_error: 'google_cancelled' }), clearCookies);
          return;
        }

        const state = cookieValue(request, 'eat_it_google_state');
        const verifier = cookieValue(request, 'eat_it_google_verifier');
        const code = url.searchParams.get('code');
        if (!state || state !== url.searchParams.get('state') || !verifier || !code) {
          redirect(response, appLocation({ auth_error: 'google_failed' }), clearCookies);
          return;
        }
        try {
          const profile = await exchangeGoogleCode(code, verifier);
          const user = await findOrCreateOAuthUser(prisma, 'google', profile);
          const session = await createSession(prisma, user.id);
          redirect(response, appLocation(), [
            sessionCookie(session.token, session.expiresAt, isSecureRequest(request)),
            ...clearCookies,
          ]);
        } catch (error) {
          logger.error(`${method} ${url.pathname}`, error);
          redirect(response, appLocation({ auth_error: 'google_failed' }), clearCookies);
        }
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
        const clearCookies = [
          clearOauthCookie('eat_it_apple_state', true, 'None'),
          clearOauthCookie('eat_it_apple_nonce', true, 'None'),
        ];
        if (form.get('error')) {
          redirect(response, appLocation({ auth_error: 'apple_cancelled' }), clearCookies);
          return;
        }

        const state = cookieValue(request, 'eat_it_apple_state');
        const nonce = cookieValue(request, 'eat_it_apple_nonce');
        const code = form.get('code');
        if (!state || state !== form.get('state') || !nonce || !code) {
          redirect(response, appLocation({ auth_error: 'apple_failed' }), clearCookies);
          return;
        }
        try {
          const profile = await exchangeAppleCode(code, nonce);
          const user = await findOrCreateOAuthUser(prisma, 'apple', profile);
          const session = await createSession(prisma, user.id);
          redirect(response, appLocation(), [
            sessionCookie(session.token, session.expiresAt, true),
            ...clearCookies,
          ]);
        } catch (error) {
          logger.error(`${method} ${url.pathname}`, error);
          redirect(response, appLocation({ auth_error: 'apple_failed' }), clearCookies);
        }
        return;
      }

      const auth = await authenticate(prisma, request);
      if (!auth) {
        json(response, 401, { error: 'Требуется авторизация' });
        return;
      }
      const { user } = auth;

      if (method === 'GET' && url.pathname === '/api/auth/me') {
        json(response, 200, { user: { ...serializeUser(user), isAdmin: isAdmin(user) } });
        return;
      }

      if (method === 'GET' && url.pathname === '/api/support/tickets') {
        const tickets = await prisma.supportTicket.findMany({
          where: { userId: user.id },
          orderBy: [{ updatedAt: 'desc' }],
          include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
        });
        json(response, 200, { tickets: tickets.map(serializeSupportTicket) });
        return;
      }

      if (method === 'POST' && url.pathname === '/api/support/tickets') {
        const input = supportTicketCreateSchema.parse(await readJson(request));
        const ticket = await prisma.$transaction(async (transaction) => {
          const created = await transaction.supportTicket.create({
            data: { userId: user.id, subject: input.subject },
          });
          await transaction.supportMessage.create({
            data: {
              ticketId: created.id,
              authorId: user.id,
              authorRole: 'user',
              body: input.message,
            },
          });
          return transaction.supportTicket.findUnique({
            where: { id: created.id },
            include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
          });
        });
        json(response, 201, serializeSupportTicket(ticket));
        return;
      }

      const supportMessagesRoute = routeMatch(
        url.pathname,
        /^\/api\/support\/tickets\/(?<id>[^/]+)\/messages$/,
      );
      if (supportMessagesRoute && method === 'GET') {
        const ticket = await prisma.supportTicket.findFirst({
          where: { id: supportMessagesRoute.id, userId: user.id },
          include: { messages: { orderBy: { createdAt: 'asc' }, include: { author: true } } },
        });
        if (!ticket) {
          const error = new Error('Ticket not found');
          error.status = 404;
          throw error;
        }
        json(response, 200, {
          ticket: serializeSupportTicket(ticket),
          messages: ticket.messages.map(serializeSupportMessage),
        });
        return;
      }

      if (supportMessagesRoute && method === 'POST') {
        const input = supportMessageCreateSchema.parse(await readJson(request));
        const ticket = await prisma.supportTicket.findFirst({
          where: { id: supportMessagesRoute.id, userId: user.id },
        });
        if (!ticket) {
          const error = new Error('Ticket not found');
          error.status = 404;
          throw error;
        }
        if (ticket.status === 'closed') {
          const error = new Error('Ticket is closed');
          error.status = 409;
          throw error;
        }
        const message = await prisma.$transaction(async (transaction) => {
          const created = await transaction.supportMessage.create({
            data: {
              ticketId: ticket.id,
              authorId: user.id,
              authorRole: 'user',
              body: input.message,
            },
            include: { author: true },
          });
          await transaction.supportTicket.update({
            where: { id: ticket.id },
            data: { updatedAt: new Date() },
          });
          return created;
        });
        json(response, 201, serializeSupportMessage(message));
        return;
      }

      if (method === 'POST' && url.pathname === '/api/feedback') {
        const input = feedbackCreateSchema.parse(await readJson(request));
        const item = await prisma.feedbackItem.create({
          data: { userId: user.id, type: input.type, body: input.message },
        });
        json(response, 201, serializeFeedbackItem(item));
        return;
      }

      if (method === 'GET' && url.pathname === '/api/dev/summary') {
        requireAdmin(user);
        const since = new Date(Date.now() - 5 * 60 * 1000);
        const [
          userCount,
          onlineUsers,
          fridgeItems,
          shoppingItems,
          openTickets,
          closedTickets,
          feedbackCount,
          recentUsers,
        ] = await Promise.all([
          prisma.user.count(),
          prisma.session
            .findMany({
              where: { expiresAt: { gt: new Date() }, lastSeenAt: { gte: since } },
              distinct: ['userId'],
            })
            .then((sessions) => sessions.length),
          prisma.fridgeItem.count(),
          prisma.shoppingItem.count(),
          prisma.supportTicket.count({ where: { status: 'open' } }),
          prisma.supportTicket.count({ where: { status: 'closed' } }),
          prisma.feedbackItem.count({ where: { status: 'open' } }),
          prisma.user.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }),
        ]);
        json(response, 200, {
          users: { total: userCount, online: onlineUsers, recent: recentUsers.map(serializeUser) },
          usage: { fridgeItems, shoppingItems },
          support: { openTickets, closedTickets, openFeedback: feedbackCount },
        });
        return;
      }

      if (method === 'GET' && url.pathname === '/api/dev/support/tickets') {
        requireAdmin(user);
        const tickets = await prisma.supportTicket.findMany({
          orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
          include: {
            user: true,
            messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
          take: 100,
        });
        json(response, 200, { tickets: tickets.map(serializeSupportTicket) });
        return;
      }

      const devSupportMessagesRoute = routeMatch(
        url.pathname,
        /^\/api\/dev\/support\/tickets\/(?<id>[^/]+)\/messages$/,
      );
      if (devSupportMessagesRoute && method === 'GET') {
        requireAdmin(user);
        const ticket = await prisma.supportTicket.findUnique({
          where: { id: devSupportMessagesRoute.id },
          include: {
            user: true,
            messages: { orderBy: { createdAt: 'asc' }, include: { author: true } },
          },
        });
        if (!ticket) {
          const error = new Error('Ticket not found');
          error.status = 404;
          throw error;
        }
        json(response, 200, {
          ticket: serializeSupportTicket(ticket),
          messages: ticket.messages.map(serializeSupportMessage),
        });
        return;
      }

      if (devSupportMessagesRoute && method === 'POST') {
        requireAdmin(user);
        const input = supportMessageCreateSchema.parse(await readJson(request));
        const ticket = await prisma.supportTicket.findUnique({
          where: { id: devSupportMessagesRoute.id },
        });
        if (!ticket) {
          const error = new Error('Ticket not found');
          error.status = 404;
          throw error;
        }
        if (ticket.status === 'closed') {
          const error = new Error('Ticket is closed');
          error.status = 409;
          throw error;
        }
        const message = await prisma.$transaction(async (transaction) => {
          const created = await transaction.supportMessage.create({
            data: {
              ticketId: ticket.id,
              authorId: user.id,
              authorRole: 'support',
              body: input.message,
            },
            include: { author: true },
          });
          await transaction.supportTicket.update({
            where: { id: ticket.id },
            data: { updatedAt: new Date() },
          });
          return created;
        });
        json(response, 201, serializeSupportMessage(message));
        return;
      }

      const devSupportCloseRoute = routeMatch(
        url.pathname,
        /^\/api\/dev\/support\/tickets\/(?<id>[^/]+)\/close$/,
      );
      if (devSupportCloseRoute && method === 'POST') {
        requireAdmin(user);
        const ticket = await prisma.supportTicket.update({
          where: { id: devSupportCloseRoute.id },
          data: { status: 'closed', closedAt: new Date() },
          include: { user: true, messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
        });
        json(response, 200, serializeSupportTicket(ticket));
        return;
      }

      if (method === 'GET' && url.pathname === '/api/dev/feedback') {
        requireAdmin(user);
        const items = await prisma.feedbackItem.findMany({
          orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
          include: { user: true },
          take: 100,
        });
        json(response, 200, { feedback: items.map(serializeFeedbackItem) });
        return;
      }

      const devFeedbackCloseRoute = routeMatch(
        url.pathname,
        /^\/api\/dev\/feedback\/(?<id>[^/]+)\/close$/,
      );
      if (devFeedbackCloseRoute && method === 'POST') {
        requireAdmin(user);
        const item = await prisma.feedbackItem.update({
          where: { id: devFeedbackCloseRoute.id },
          data: { status: 'closed' },
          include: { user: true },
        });
        json(response, 200, serializeFeedbackItem(item));
        return;
      }

      if (method === 'GET' && url.pathname === '/api/household') {
        const household = await getHousehold(prisma, user.householdId);
        json(response, 200, serializeHousehold(household));
        return;
      }

      if (method === 'PATCH' && url.pathname === '/api/household') {
        const input = householdUpdateSchema.parse(await readJson(request));
        const household = await prisma.household.update({
          where: { id: user.householdId },
          data: { name: input.name },
          include: { users: { orderBy: [{ displayName: 'asc' }, { email: 'asc' }] } },
        });
        json(response, 200, serializeHousehold(household));
        return;
      }

      if (method === 'POST' && url.pathname === '/api/household/members') {
        const input = householdMemberSchema.parse(await readJson(request));
        const invitation = await prisma.$transaction(async (transaction) => {
          const member = await transaction.user.findUnique({
            where: { email: input.email },
          });
          if (!member) {
            const error = new Error('User not found');
            error.status = 404;
            throw error;
          }

          if (member.id === user.id || member.householdId === user.householdId) {
            const error = new Error('User is already in this group');
            error.status = 409;
            throw error;
          }

          const household = await transaction.household.findUnique({
            where: { id: user.householdId },
          });
          const created = await transaction.householdInvitation.create({
            data: {
              householdId: user.householdId,
              inviterId: user.id,
              inviteeId: member.id,
            },
          });
          await createNotification(transaction, {
            userId: member.id,
            type: 'group_invite',
            title: 'Приглашение в группу',
            body: `${user.displayName} приглашает вас в группу «${household.name}».`,
            data: { invitationId: created.id, householdId: user.householdId },
            dedupeKey: `group-invite:${created.id}`,
          });
          return created;
        });

        json(response, 201, { invitationId: invitation.id, status: invitation.status });
        return;
      }

      const invitationRoute = routeMatch(
        url.pathname,
        /^\/api\/household\/invitations\/(?<id>[^/]+)\/(?<action>accept|decline)$/,
      );
      if (invitationRoute && method === 'POST') {
        const household = await prisma.$transaction(async (transaction) => {
          const invitation = await transaction.householdInvitation.findFirst({
            where: { id: invitationRoute.id, inviteeId: user.id, status: 'pending' },
            include: { household: true },
          });
          if (!invitation) {
            const error = new Error('Invitation not found');
            error.status = 404;
            throw error;
          }

          if (invitationRoute.action === 'decline') {
            await transaction.householdInvitation.update({
              where: { id: invitation.id },
              data: { status: 'declined' },
            });
            return getHousehold(transaction, user.householdId);
          }

          const sourceHouseholdId = user.householdId;
          await mergeHouseholdInto(transaction, sourceHouseholdId, invitation.householdId);
          await transaction.householdInvitation.update({
            where: { id: invitation.id },
            data: { status: 'accepted' },
          });
          await transaction.householdInvitation.updateMany({
            where: { inviteeId: user.id, status: 'pending', id: { not: invitation.id } },
            data: { status: 'declined' },
          });
          return getHousehold(transaction, invitation.householdId);
        });

        json(response, 200, serializeHousehold(household));
        return;
      }

      if (method === 'GET' && url.pathname === '/api/notifications') {
        await ensureExpiryNotifications(prisma, user);
        const notifications = await prisma.notification.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: 'desc' },
          take: 50,
        });
        json(response, 200, {
          notifications: notifications.map(serializeNotification),
          unreadCount: notifications.filter((notification) => !notification.readAt).length,
        });
        return;
      }

      const notificationRoute = routeMatch(url.pathname, /^\/api\/notifications\/(?<id>[^/]+)$/);
      if (notificationRoute && method === 'PATCH') {
        const input = notificationUpdateSchema.parse(await readJson(request));
        const current = await prisma.notification.findFirst({
          where: { id: notificationRoute.id, userId: user.id },
        });
        if (!current) {
          const error = new Error('Notification not found');
          error.status = 404;
          throw error;
        }
        const notification = await prisma.notification.update({
          where: { id: notificationRoute.id },
          data: { readAt: input.read ? new Date() : null },
        });
        json(response, 200, serializeNotification(notification));
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
          household: serializeHousehold(await getHousehold(prisma, user.householdId)),
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
