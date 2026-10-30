import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBarcodeLookup, normalizeBarcode } from './barcodes.mjs';

test('GTIN validation checks the check digit and treats UPC and zero-prefixed EAN as one product', () => {
  assert.equal(normalizeBarcode('4006381333931'), '04006381333931');
  assert.equal(normalizeBarcode('0 36000 29145 2'), normalizeBarcode('0036000291452'));
  assert.equal(normalizeBarcode('96385074'), '00000096385074');
  for (const value of [
    '4006381333932',
    '123',
    'https://example.com',
    '4006381333931<script>',
    null,
  ])
    assert.equal(normalizeBarcode(value), null);
});

test('provider lookup deduplicates concurrent scans, validates response identity and caches results', async () => {
  let calls = 0;
  let time = 60_000;
  const lookup = createBarcodeLookup({
    now: () => time,
    fetcher: async (url, options) => {
      calls++;
      assert.equal(url.origin, 'https://world.openfoodfacts.org');
      assert.equal(url.pathname, '/api/v3/product/4006381333931');
      assert.equal(options.redirect, 'error');
      assert.ok(!('Authorization' in options.headers));
      return Response.json({
        product: {
          code: '4006381333931',
          product_name_ru: 'Молоко\n 1 л',
          brands: 'Тест',
          quantity: '1 л',
        },
      });
    },
  });
  const code = normalizeBarcode('4006381333931');
  const [a, b] = await Promise.all([lookup(code), lookup(code)]);
  assert.deepEqual(a, b);
  assert.equal(a.name, 'Молоко 1 л');
  assert.equal(calls, 1);
  await lookup(code);
  assert.equal(calls, 1);
  time += 86_400_001;
  await lookup(code);
  assert.equal(calls, 2);
});

test('missing products are cached but provider failures remain retryable', async () => {
  let calls = 0;
  const lookup = createBarcodeLookup({
    fetcher: async () => {
      calls++;
      return new Response(null, { status: 404 });
    },
  });
  assert.equal(await lookup(normalizeBarcode('4006381333931')), null);
  assert.equal(await lookup(normalizeBarcode('4006381333931')), null);
  assert.equal(calls, 1);
  let available = false;
  const retry = createBarcodeLookup({
    fetcher: async () =>
      available
        ? Response.json({ product: { code: '4006381333931', product_name: 'Milk' } })
        : new Response(null, { status: 503 }),
  });
  await assert.rejects(retry(normalizeBarcode('4006381333931')), { status: 503 });
  available = true;
  assert.equal((await retry(normalizeBarcode('4006381333931'))).name, 'Milk');
});

test('oversized, invalid and mismatched provider responses cannot populate a product', async () => {
  for (const payload of [
    { product: { code: '96385074', product_name: 'Wrong product' } },
    { product: {} },
  ]) {
    const lookup = createBarcodeLookup({ fetcher: async () => Response.json(payload) });
    assert.equal(await lookup(normalizeBarcode('4006381333931')), null);
  }
  const large = createBarcodeLookup({ fetcher: async () => new Response('x'.repeat(65537)) });
  await assert.rejects(large(normalizeBarcode('4006381333931')), { status: 503 });
  const bad = createBarcodeLookup({ fetcher: async () => new Response('not json') });
  await assert.rejects(bad(normalizeBarcode('4006381333931')), { status: 503 });
});

test('upstream rate cap applies to distinct scans while cached products remain available', async () => {
  let calls = 0;
  const lookup = createBarcodeLookup({
    fetcher: async () => {
      calls++;
      return new Response(null, { status: 404 });
    },
  });
  const codeFor = (n) => {
    const digits = String(1000000 + n);
    const sum = [...digits].reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 3 : 1), 0);
    return normalizeBarcode(digits + ((10 - (sum % 10)) % 10));
  };
  for (let n = 0; n < 12; n++) await lookup(codeFor(n));
  await assert.rejects(lookup(codeFor(12)), { status: 503 });
  assert.equal(await lookup(codeFor(0)), null);
  assert.equal(calls, 12);
});
