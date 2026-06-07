import { createServer } from 'node:http';
import { ZodError } from 'zod';
import {
  consumeSchema,
  fridgeCreateSchema,
  fridgeUpdateSchema,
  shoppingCreateSchema,
  shoppingToFridgeSchema,
  shoppingUpdateSchema,
} from './validation.mjs';

const BODY_LIMIT = 64 * 1024;

function json(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
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

function toDate(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function serializeFridgeItem(item) {
  return {
    ...item,
    expiresAt: item.expiresAt.toISOString().slice(0, 10),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function serializeShoppingItem(item) {
  return {
    ...item,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function routeMatch(pathname, pattern) {
  const match = pathname.match(pattern);
  return match?.groups ?? null;
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

      if (method === 'GET' && url.pathname === '/api/state') {
        const [fridgeItems, shoppingItems] = await Promise.all([
          prisma.fridgeItem.findMany({ orderBy: { createdAt: 'desc' } }),
          prisma.shoppingItem.findMany({ orderBy: { createdAt: 'desc' } }),
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
          data: { ...input, expiresAt: toDate(input.expiresAt) },
        });
        json(response, 201, serializeFridgeItem(item));
        return;
      }

      const fridgeRoute = routeMatch(url.pathname, /^\/api\/fridge\/(?<id>[^/]+)$/);
      if (fridgeRoute && method === 'PATCH') {
        const input = fridgeUpdateSchema.parse(await readJson(request));
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
        await prisma.fridgeItem.delete({ where: { id: fridgeRoute.id } });
        response.writeHead(204);
        response.end();
        return;
      }

      const consumeRoute = routeMatch(url.pathname, /^\/api\/fridge\/(?<id>[^/]+)\/consume$/);
      if (consumeRoute && method === 'POST') {
        const input = consumeSchema.parse(await readJson(request));
        const current = await prisma.fridgeItem.findUniqueOrThrow({
          where: { id: consumeRoute.id },
        });
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
          const current = await transaction.fridgeItem.findUniqueOrThrow({
            where: { id: fridgeToShoppingRoute.id },
          });
          const shoppingItem = await transaction.shoppingItem.create({
            data: {
              name: current.name,
              quantity: current.quantity,
              unit: current.unit,
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
        const item = await prisma.shoppingItem.create({ data: input });
        json(response, 201, serializeShoppingItem(item));
        return;
      }

      if (method === 'DELETE' && url.pathname === '/api/shopping/completed') {
        const result = await prisma.shoppingItem.deleteMany({ where: { checked: true } });
        json(response, 200, { deleted: result.count });
        return;
      }

      const shoppingRoute = routeMatch(url.pathname, /^\/api\/shopping\/(?<id>[^/]+)$/);
      if (shoppingRoute && method === 'PATCH') {
        const input = shoppingUpdateSchema.parse(await readJson(request));
        const item = await prisma.shoppingItem.update({
          where: { id: shoppingRoute.id },
          data: input,
        });
        json(response, 200, serializeShoppingItem(item));
        return;
      }

      if (shoppingRoute && method === 'DELETE') {
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
          const current = await transaction.shoppingItem.findUniqueOrThrow({
            where: { id: shoppingToFridgeRoute.id },
          });
          const fridgeItem = await transaction.fridgeItem.create({
            data: {
              name: current.name,
              quantity: input.quantity ?? current.quantity ?? 1,
              unit: input.unit ?? current.unit ?? 'шт',
              expiresAt: toDate(input.expiresAt),
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

      if (error?.code === 'P2025') {
        json(response, 404, { error: 'Item not found' });
        return;
      }

      const status = Number.isInteger(error?.status) ? error.status : 500;
      if (status >= 500) {
        logger.error(error);
      }
      json(response, status, { error: status >= 500 ? 'Internal server error' : error.message });
    }
  });
}
