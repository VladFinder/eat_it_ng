import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createNativeOAuthStore } from './native-oauth.mjs';

const proof = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

test('native OAuth requires the original verifier and consumes a completed handoff once', () => {
  const store = createNativeOAuthStore();
  const { verifier, challenge } = proof();
  const attempt = store.create('google', challenge);
  assert.equal(store.consume(attempt.id, 'wrong-proof'), null);
  assert.deepEqual(store.consume(attempt.id, verifier), { pending: true });
  assert.equal(store.begin('google', attempt.ticket, 'browser-state'), attempt.id);
  assert.equal(store.begin('google', attempt.ticket, 'replay'), null);
  assert.equal(
    store.finish('google', attempt.id, 'browser-state', { userId: 'verified-user' }),
    true,
  );
  assert.equal(store.consume(attempt.id, 'wrong-proof'), null);
  assert.deepEqual(store.consume(attempt.id, verifier), { userId: 'verified-user' });
  assert.equal(store.consume(attempt.id, verifier), null);
});

test('native OAuth binds browser state and provider, rejecting substituted callbacks', () => {
  const store = createNativeOAuthStore();
  const first = proof();
  const second = proof();
  const a = store.create('google', first.challenge);
  const b = store.create('google', second.challenge);
  assert.equal(store.begin('apple', a.ticket, 'wrong-provider'), null);
  store.begin('google', a.ticket, 'state-a');
  store.begin('google', b.ticket, 'state-b');
  assert.equal(store.finish('google', b.id, 'state-a', { userId: 'attacker' }), false);
  assert.equal(store.finish('apple', a.id, 'state-a', { userId: 'attacker' }), false);
  assert.deepEqual(store.consume(a.id, first.verifier), { pending: true });
  assert.deepEqual(store.consume(b.id, second.verifier), { pending: true });
});

test('native OAuth cannot complete before the browser starts or overwrite a completed result', () => {
  const store = createNativeOAuthStore();
  const p = proof();
  const attempt = store.create('google', p.challenge);
  assert.equal(store.finish('google', attempt.id, 'state', { userId: 'user' }), false);
  store.begin('google', attempt.ticket, 'state');
  assert.equal(store.finish('google', attempt.id, 'state', { userId: 'user' }), true);
  assert.equal(store.finish('google', attempt.id, 'state', { userId: 'other' }), false);
  assert.deepEqual(store.consume(attempt.id, p.verifier), { userId: 'user' });
});

test('native OAuth cancellation needs the correct proof and invalidates its launch ticket', () => {
  const store = createNativeOAuthStore();
  const p = proof();
  const attempt = store.create('google', p.challenge);
  store.cancel(attempt.id, 'wrong');
  assert.deepEqual(store.consume(attempt.id, p.verifier), { pending: true });
  store.cancel(attempt.id, p.verifier);
  assert.equal(store.begin('google', attempt.ticket, 'state'), null);
  assert.equal(store.consume(attempt.id, p.verifier), null);
});

test('native OAuth expiry bounds memory, browser tickets and completed results', () => {
  let now = 1_000;
  const store = createNativeOAuthStore({ now: () => now, ttl: 100, maximum: 1 });
  const p = proof();
  const attempt = store.create('google', p.challenge);
  assert.equal(store.create('apple', p.challenge), null);
  now += 100;
  assert.equal(store.consume(attempt.id, p.verifier), null);
  assert.equal(store.begin('google', attempt.ticket, 'state'), null);
  const next = store.create('apple', p.challenge);
  store.begin('apple', next.ticket, 'state');
  store.finish('apple', next.id, 'state', { userId: 'user' });
  now += 100;
  assert.equal(store.consume(next.id, p.verifier), null);
});
