import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify, constants } from 'node:crypto';
import { nativeFingerprint, signManifest } from './ota.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('OTA release signer signs exactly the payload and tampering invalidates the signature', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const envelope = signManifest({ version: '2.1.1', sha256: 'a'.repeat(64) }, privateKey);
  const options = { key: publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 };
  assert.equal(
    verify(
      'sha256',
      Buffer.from(envelope.payload, 'base64'),
      options,
      Buffer.from(envelope.signature, 'base64'),
    ),
    true,
  );
  assert.equal(
    verify(
      'sha256',
      Buffer.from('changed payload'),
      options,
      Buffer.from(envelope.signature, 'base64'),
    ),
    false,
  );
});

test('checked-in runtime fingerprint matches the native shell and pinned plugin versions', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const trust = JSON.parse(
    readFileSync(new URL('../src/app/core/ota-trust.json', import.meta.url), 'utf8'),
  );
  assert.equal(
    nativeFingerprint(root),
    trust.nativeFingerprint,
    'Native shell changed: bump APK version and run ota:runtime before shipping',
  );
});
