import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const SESSION_DAYS = 30;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, 64);
  return `scrypt:${salt.toString('hex')}:${derivedKey.toString('hex')}`;
}

export async function verifyPassword(password, storedHash) {
  const [algorithm, saltHex, keyHex] = storedHash?.split(':') ?? [];
  if (algorithm !== 'scrypt' || !saltHex || !keyHex) {
    return false;
  }

  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(prisma, userId) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: { userId, tokenHash: hashToken(token), expiresAt },
  });
  return { token, expiresAt };
}

export function readSessionToken(request) {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) {
    return authorization.slice(7).trim();
  }

  const cookie = request.headers.cookie ?? '';
  const sessionCookie = cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('eat_it_session='));
  return sessionCookie ? decodeURIComponent(sessionCookie.slice('eat_it_session='.length)) : null;
}

export async function authenticate(prisma, request) {
  const token = readSessionToken(request);
  if (!token) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt <= new Date()) {
    if (session) {
      await prisma.session.delete({ where: { id: session.id } });
    }
    return null;
  }
  return { session, user: session.user, token };
}

export function sessionCookie(token, expiresAt, secure) {
  return [
    `eat_it_session=${encodeURIComponent(token)}`,
    'Path=/api',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expiresAt.toUTCString()}`,
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

export function clearSessionCookie(secure) {
  return [
    'eat_it_session=',
    'Path=/api',
    'HttpOnly',
    'SameSite=Lax',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}
