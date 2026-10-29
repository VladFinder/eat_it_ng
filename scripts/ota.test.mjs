import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify, constants } from 'node:crypto';
import { nativeFingerprint, signManifest } from './ota.mjs';
import {
  readFileSync,
  cpSync,
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
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

test('native fingerprint is stable before and after cap sync but detects native source edits', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const fixture = mkdtempSync(join(tmpdir(), 'homie-native-'));
  try {
    cpSync(join(root, 'android'), join(fixture, 'android'), {
      recursive: true,
      filter: (path) =>
        ![
          '.gradle',
          'build',
          'assets',
          'capacitor-cordova-android-plugins',
          'key.properties',
          'local.properties',
        ].includes(basename(path)) && !/\.(jks|keystore)$/.test(path),
    });
    for (const file of ['capacitor.config.ts', 'package.json', 'package-lock.json']) {
      cpSync(join(root, file), join(fixture, file));
    }
    symlinkSync(join(root, 'node_modules'), join(fixture, 'node_modules'), 'junction');
    const generatedConfig = join(fixture, 'android/app/src/main/res/xml/config.xml');
    rmSync(generatedConfig, { force: true });
    const cleanFingerprint = nativeFingerprint(fixture);
    mkdirSync(join(fixture, 'android/app/src/main/res/xml'), { recursive: true });
    writeFileSync(generatedConfig, '<widget><access origin="*" /></widget>');
    assert.equal(nativeFingerprint(fixture), cleanFingerprint);
    const manifest = join(fixture, 'android/app/src/main/AndroidManifest.xml');
    writeFileSync(manifest, readFileSync(manifest, 'utf8') + '\n<!-- native edit -->\n');
    assert.notEqual(nativeFingerprint(fixture), cleanFingerprint);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
