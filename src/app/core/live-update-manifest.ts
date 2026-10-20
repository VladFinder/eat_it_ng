export interface UpdateManifest {
  schema: 1;
  runtime: string;
  version: string;
  sequence: number;
  nativeFingerprint: string;
  sha256: string;
  bytes: number;
}

function bytes(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

export async function verifyUpdateManifest(
  envelope: unknown,
  trust: { runtime: string; publicKey: string; nativeFingerprint: string },
  subtle: SubtleCrypto = crypto.subtle,
): Promise<UpdateManifest> {
  if (!envelope || typeof envelope !== 'object') throw new Error('Invalid update manifest');
  const signed = envelope as Record<string, unknown>;
  if (
    typeof signed['payload'] !== 'string' ||
    signed['payload'].length > 12000 ||
    typeof signed['signature'] !== 'string' ||
    signed['signature'].length > 1024
  ) {
    throw new Error('Invalid update signature');
  }
  const data = bytes(signed['payload']);
  const key = await subtle.importKey(
    'spki',
    bytes(trust.publicKey),
    { name: 'RSA-PSS', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  if (
    !(await subtle.verify(
      { name: 'RSA-PSS', saltLength: 32 },
      key,
      bytes(signed['signature']),
      data,
    ))
  ) {
    throw new Error('Update signature verification failed');
  }
  const manifest: unknown = JSON.parse(new TextDecoder().decode(data));
  if (!manifest || typeof manifest !== 'object') throw new Error('Invalid update data');
  const value = manifest as Record<string, unknown>;
  if (
    value['schema'] !== 1 ||
    value['runtime'] !== trust.runtime ||
    value['nativeFingerprint'] !== trust.nativeFingerprint ||
    typeof value['version'] !== 'string' ||
    !/^\d{1,10}\.\d{1,10}\.\d{1,10}$/.test(value['version']) ||
    typeof value['sha256'] !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value['sha256']) ||
    typeof value['sequence'] !== 'number' ||
    !Number.isSafeInteger(value['sequence']) ||
    value['sequence'] <= 0 ||
    typeof value['bytes'] !== 'number' ||
    !Number.isSafeInteger(value['bytes']) ||
    value['bytes'] <= 0 ||
    value['bytes'] > 50 * 1024 * 1024
  ) {
    throw new Error('Incompatible update');
  }
  return value as unknown as UpdateManifest;
}
