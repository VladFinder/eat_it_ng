// Local-only browser regression fixture: real production UI, disposable in-memory API.
// Run npm run build, then node scripts/serve-swipe-fixture.mjs.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';

const root = resolve('dist/eat_it_ng/browser');
const user = { id: 'swipe-fixture', displayName: 'Swipe test', email: 'test@example.test', householdId: 'fixture', authProvider: 'password' };
const fridgeItems = ['products', 'household', 'medicine'].flatMap((category) =>
  Array.from({ length: 10 }, (_, i) => ({
    id: `${category}-${i}`, name: `${category} ${i + 1}`, category, quantity: 2,
    unit: 'шт.', expiresAt: i === 0 && category !== 'household' ? '2020-01-01' : null,
    reminderDays: 1, autoAddToShopping: false,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  })),
);
const api = {
  '/api/auth/me': { user },
  '/api/auth/providers': { password: true, google: false, apple: false },
  '/api/state': { fridgeItems, shoppingItems: [], household: { id: 'fixture', name: 'Swipe test', members: [] } },
  '/api/notifications': { notifications: [], unreadCount: 0 },
  '/api/support/tickets': { tickets: [] },
  '/api/recipes/suggestions': { recipes: [], ingredients: [] },
  '/api/recipes': { recipes: [], ingredients: [] },
  '/api/dishes': { recipes: [], ingredients: [] },
};
let failNextMove = process.argv.includes('--fail-move-once');
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  res.setHeader('Cache-Control', 'no-store');
  const move = path.match(/^\/api\/fridge\/([^/]+)\/move-to-shopping$/);
  const remove = path.match(/^\/api\/fridge\/([^/]+)$/);
  if ((move && req.method === 'POST') || (remove && req.method === 'DELETE')) {
    const id = (move ?? remove)[1];
    const index = fridgeItems.findIndex((item) => item.id === id);
    if (index < 0) {
      res.writeHead(404).end();
      return;
    }
    if (move && failNextMove) {
      failNextMove = false;
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Temporary test failure. Swipe again to retry.' }));
      return;
    }
    const [item] = fridgeItems.splice(index, 1);
    if (move) {
      const shoppingItem = { ...item, id: `shopping-${id}`, checked: false };
      api['/api/state'].shoppingItems.push(shoppingItem);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(shoppingItem));
    } else {
      res.writeHead(204).end();
    }
    return;
  }
  if (req.method !== 'GET') {
    res.writeHead(405).end();
    return;
  }
  if (path.startsWith('/api/')) {
    res.writeHead(api[path] ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(api[path] ?? { error: 'Unknown fixture endpoint' }));
    return;
  }
  const file = resolve(root, `.${path === '/' ? '/index.html' : path}`);
  if (!file.startsWith(root + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
});
server.listen(4318, '127.0.0.1', () => console.log('Swipe fixture: http://127.0.0.1:4318'));
