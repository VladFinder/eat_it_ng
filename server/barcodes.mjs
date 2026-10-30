export function normalizeBarcode(value) {
  if (typeof value !== 'string') return null;
  const digits = value.trim().replace(/[\s-]/g, '');
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(digits)) return null;
  let sum = 0;
  for (let i = digits.length - 2, weight = 3; i >= 0; i--, weight = 4 - weight) {
    sum += Number(digits[i]) * weight;
  }
  if ((10 - (sum % 10)) % 10 !== Number(digits.at(-1))) return null;
  return digits.padStart(14, '0');
}

function text(value, maximum) {
  return typeof value === 'string'
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maximum)
    : '';
}

function unavailable(message = 'База товаров временно недоступна. Введите название вручную.') {
  return Object.assign(new Error(message), { status: 503 });
}

// Only public provider data is cached here. Household names never enter this cache.
export function createBarcodeLookup({ fetcher = fetch, now = Date.now } = {}) {
  const cache = new Map();
  const pending = new Map();
  let windowStart = 0;
  let requests = 0;
  async function lookup(barcode) {
    if (normalizeBarcode(barcode) !== barcode)
      throw Object.assign(new Error('Некорректный штрихкод'), { status: 400 });
    const time = now();
    for (const [key, value] of cache) if (value.expiresAt <= time) cache.delete(key);
    if (cache.has(barcode)) return cache.get(barcode).product;
    if (pending.has(barcode)) return pending.get(barcode);
    if (time - windowStart >= 60_000) {
      windowStart = time;
      requests = 0;
    }
    // Leave headroom below the provider's 15 product reads/minute/IP limit.
    if (requests >= 12)
      throw unavailable(
        'Поиск товаров занят. Попробуйте через минуту или введите название вручную.',
      );
    requests++;
    const request = (async () => {
      try {
        const code = barcode.startsWith('000000')
          ? barcode.slice(-8)
          : barcode.startsWith('0')
            ? barcode.slice(1)
            : barcode;
        const url = new URL(`https://world.openfoodfacts.org/api/v3/product/${code}`);
        url.searchParams.set('fields', 'code,product_name,product_name_ru,brands,quantity');
        const response = await fetcher(url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Homie/2.0.4 (https://homie-web.app)',
          },
          signal: AbortSignal.timeout(7000),
          redirect: 'error',
        });
        if (response.status === 404) return remember(null);
        if (!response.ok || !response.body) throw unavailable();
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > 64 * 1024) {
            throw unavailable();
          }
          chunks.push(Buffer.from(chunk));
        }
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const source = payload.product;
        if (!source || (source.code && normalizeBarcode(source.code) !== barcode))
          return remember(null);
        const name = text(source.product_name_ru || source.product_name, 120);
        if (!name) return remember(null);
        return remember({
          name,
          brand: text(source.brands, 120),
          packageQuantity: text(source.quantity, 80),
          category: 'products',
          unit: 'шт.',
          source: 'open_food_facts',
        });
      } catch (error) {
        if (error.status === 503) throw error;
        throw unavailable();
      }
    })();
    function remember(product) {
      if (cache.size >= 512) cache.delete(cache.keys().next().value);
      cache.set(barcode, { product, expiresAt: now() + (product ? 86_400_000 : 3_600_000) });
      return product;
    }
    pending.set(barcode, request);
    try {
      return await request;
    } finally {
      pending.delete(barcode);
    }
  }
  return lookup;
}

export async function rememberHouseholdBarcode(transaction, householdId, barcode, input) {
  if (!barcode) return;
  const values = { name: input.name, category: input.category, unit: input.unit };
  await transaction.householdBarcodeProduct.upsert({
    where: { householdId_barcode: { householdId, barcode } },
    create: { householdId, barcode, ...values },
    update: values,
  });
}
