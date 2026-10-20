import { describe, it, expect } from 'vitest';
import { webcrypto, generateKeyPairSync } from 'node:crypto';
import { verifyUpdateManifest } from './live-update-manifest';

const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const trust = {
  runtime: '2.0.0',
  nativeFingerprint: 'native-hash',
  publicKey: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
};
const manifest = {
  schema: 1,
  runtime: '2.0.0',
  version: '2.1.2',
  sequence: 42,
  nativeFingerprint: 'native-hash',
  sha256: 'a'.repeat(64),
  bytes: 1024,
};
async function envelope(value: unknown) {
  const key = await webcrypto.subtle.importKey(
    'pkcs8',
    pair.privateKey.export({ type: 'pkcs8', format: 'der' }),
    { name: 'RSA-PSS', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const data = Buffer.from(JSON.stringify(value));
  const signature = await webcrypto.subtle.sign({ name: 'RSA-PSS', saltLength: 32 }, key, data);
  return { payload: data.toString('base64'), signature: Buffer.from(signature).toString('base64') };
}
const subtle = webcrypto.subtle as unknown as SubtleCrypto;

describe('signed updates', () => {
  it('verifies the publisher signature with the pinned public key', async () => {
    expect(await verifyUpdateManifest(await envelope(manifest), trust, subtle)).toEqual(manifest);
  });
  it('rejects a modified payload and a signature from another key', async () => {
    const signed = await envelope(manifest);
    signed.payload = Buffer.from(JSON.stringify({ ...manifest, bytes: 12 })).toString('base64');
    await expect(verifyUpdateManifest(signed, trust, subtle)).rejects.toThrow();
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    await expect(
      verifyUpdateManifest(
        await envelope(manifest),
        {
          ...trust,
          publicKey: other.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
        },
        subtle,
      ),
    ).rejects.toThrow();
  });
  it('rejects signed but incompatible or invalid bundles', async () => {
    for (const changes of [
      { runtime: '3.0.0' },
      { nativeFingerprint: 'wrong' },
      { version: '../evil' },
      { bytes: 51 * 1024 * 1024 },
      { sha256: 'invalid' },
      { sequence: -1 },
    ]) {
      await expect(
        verifyUpdateManifest(await envelope({ ...manifest, ...changes }), trust, subtle),
      ).rejects.toThrow();
    }
  });
});
