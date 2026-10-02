const WINDOW_MS = 15 * 60 * 1000;
const MAX_BUCKETS = 10_000;

// Each API process owns its limiter. Never trust client-supplied proxy headers by default.
export function createAuthLimiter() {
  const buckets = new Map();
  return (key, maximum, now = Date.now()) => {
    for (const [id, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(id);
    }
    let bucket = buckets.get(key);
    if (!bucket) {
      if (buckets.size >= MAX_BUCKETS) return 60;
      bucket = { count: 0, resetAt: now + WINDOW_MS };
      buckets.set(key, bucket);
    }
    if (bucket.count >= maximum) return Math.ceil((bucket.resetAt - now) / 1000);
    bucket.count += 1;
    return 0;
  };
}

export function clientAddress(request) {
  const address = request.socket.remoteAddress ?? 'unknown';
  if (
    process.env.TRUST_PROXY === 'true' &&
    ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)
  ) {
    return request.headers['x-real-ip'] ?? address;
  }
  return address;
}

export function isAllowedWriteOrigin(request, capacitorOrigins) {
  const origin = request.headers.origin;
  if (!origin) return request.headers['sec-fetch-site'] !== 'cross-site';
  if (capacitorOrigins.has(origin)) return true;
  const appOrigin = new URL(process.env.APP_URL ?? 'https://eat-it.space').origin;
  if (origin === appOrigin) return true;
  return process.env.NODE_ENV !== 'production' && origin === 'http://localhost:4200';
}
