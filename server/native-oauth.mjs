import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const digest = (value) => createHash('sha256').update(value).digest('base64url');
const random = () => randomBytes(32).toString('base64url');
const matches = (value, expected) => {
  const actual = Buffer.from(digest(value));
  const target = Buffer.from(expected);
  return actual.length === target.length && timingSafeEqual(actual, target);
};

// Short-lived handoffs belong to this API process. A restart requires a fresh sign-in.
export function createNativeOAuthStore({ now = Date.now, ttl = 600_000, maximum = 1_024 } = {}) {
  const entries = new Map();
  const tickets = new Map();
  const remove = (id) => {
    const entry = entries.get(id);
    if (entry) tickets.delete(entry.ticketHash);
    entries.delete(id);
  };
  const prune = () => {
    for (const [id, entry] of entries) if (entry.expiresAt <= now()) remove(id);
  };
  return {
    create(provider, challenge) {
      prune();
      if (entries.size >= maximum) return null;
      const id = random();
      const ticket = random();
      const expiresAt = now() + ttl;
      const ticketHash = digest(ticket);
      entries.set(id, {
        provider,
        challenge,
        expiresAt,
        ticketHash,
        stateHash: null,
        result: null,
      });
      tickets.set(ticketHash, id);
      return { id, ticket, expiresAt };
    },
    begin(provider, ticket, state) {
      prune();
      const hash = digest(ticket);
      const id = tickets.get(hash);
      const entry = entries.get(id);
      if (!entry || entry.provider !== provider || entry.stateHash) return null;
      tickets.delete(hash);
      entry.stateHash = digest(state);
      return id;
    },
    finish(provider, id, state, result) {
      prune();
      const entry = entries.get(id);
      if (
        !entry ||
        entry.provider !== provider ||
        !entry.stateHash ||
        entry.result ||
        !state ||
        !matches(state, entry.stateHash)
      )
        return false;
      entry.result = result;
      return true;
    },
    consume(id, verifier) {
      prune();
      const entry = entries.get(id);
      if (!entry || !matches(verifier, entry.challenge)) return null;
      if (!entry.result) return { pending: true };
      // Consume synchronously before creating a database session: concurrent polls cannot replay it.
      const result = entry.result;
      remove(id);
      return result;
    },
    cancel(id, verifier) {
      prune();
      const entry = entries.get(id);
      if (entry && matches(verifier, entry.challenge)) remove(id);
    },
  };
}

export function nativeOAuthPage(response, successful, cookies = []) {
  const title = successful ? 'Вход выполнен' : 'Вход не завершён';
  const message = successful
    ? 'Вернитесь в приложение Homie. Вход в аккаунт завершится автоматически.'
    : 'Вернитесь в Homie и попробуйте войти ещё раз.';
  const style =
    'body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f8f3e9;color:#193d2b;font:18px system-ui}main{max-width:420px;padding:32px;text-align:center}p{line-height:1.6}small{color:#6b6154}';
  const styleHash = createHash('sha256').update(style).digest('base64');
  response.writeHead(successful ? 200 : 400, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': `default-src 'none'; style-src 'sha256-${styleHash}'; frame-ancestors 'none'; base-uri 'none'`,
    ...(cookies.length ? { 'Set-Cookie': cookies } : {}),
  });
  response.end(
    `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} — Homie</title><style>${style}</style><main><small>HOMIE</small><h1>${title}</h1><p>${message}</p><p>Можно закрыть эту вкладку и переключиться в приложение.</p></main></html>`,
  );
}
