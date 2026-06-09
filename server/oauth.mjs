import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from 'jose';

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const appleKeys = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

function baseUrl() {
  return (process.env.APP_URL ?? 'https://eat-it.space').replace(/\/$/, '');
}

function randomValue() {
  return randomBytes(32).toString('base64url');
}

function challenge(value) {
  return createHash('sha256').update(value).digest('base64url');
}

export function oauthCookie(name, value, secure = true, sameSite = 'Lax') {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/api/auth',
    'HttpOnly',
    `SameSite=${sameSite}`,
    'Max-Age=600',
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

export function clearOauthCookie(name, secure = true, sameSite = 'Lax') {
  return [
    `${name}=`,
    'Path=/api/auth',
    'HttpOnly',
    `SameSite=${sameSite}`,
    'Max-Age=0',
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

export function cookieValue(request, name) {
  const part = (request.headers.cookie ?? '')
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : null;
}

export function googleAuthorization() {
  const state = randomValue();
  const verifier = randomValue();
  const redirectUri = `${baseUrl()}/api/auth/google/callback`;
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge(verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return { url: url.toString(), state, verifier };
}

export async function exchangeGoogleCode(code, verifier) {
  const redirectUri = `${baseUrl()}/api/auth/google/callback`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  const tokens = await response.json();
  if (!response.ok || !tokens.id_token) {
    throw new Error('Google token exchange failed');
  }
  const { payload } = await jwtVerify(tokens.id_token, googleKeys, {
    audience: process.env.GOOGLE_CLIENT_ID,
    issuer: GOOGLE_ISSUERS,
  });
  return {
    subject: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified === true,
    displayName: payload.name ?? payload.email?.split('@')[0] ?? 'Google user',
  };
}

export function appleAuthorization() {
  const state = randomValue();
  const nonce = randomValue();
  const redirectUri = `${baseUrl()}/api/auth/apple/callback`;
  const url = new URL('https://appleid.apple.com/auth/authorize');
  url.search = new URLSearchParams({
    client_id: process.env.APPLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    response_mode: 'form_post',
    scope: 'name email',
    state,
    nonce,
  }).toString();
  return { url: url.toString(), state, nonce };
}

async function appleClientSecret() {
  const privateKey = process.env.APPLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const key = await importPKCS8(privateKey, 'ES256');
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: process.env.APPLE_KEY_ID })
    .setIssuer(process.env.APPLE_TEAM_ID)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .setAudience('https://appleid.apple.com')
    .setSubject(process.env.APPLE_CLIENT_ID)
    .sign(key);
}

export async function exchangeAppleCode(code, nonce) {
  const redirectUri = `${baseUrl()}/api/auth/apple/callback`;
  const response = await fetch('https://appleid.apple.com/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.APPLE_CLIENT_ID,
      client_secret: await appleClientSecret(),
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const tokens = await response.json();
  if (!response.ok || !tokens.id_token) {
    throw new Error('Apple token exchange failed');
  }
  const { payload } = await jwtVerify(tokens.id_token, appleKeys, {
    audience: process.env.APPLE_CLIENT_ID,
    issuer: 'https://appleid.apple.com',
  });
  if (payload.nonce !== nonce) {
    throw new Error('Apple nonce mismatch');
  }
  return {
    subject: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified === 'true' || payload.email_verified === true,
    displayName: payload.email?.split('@')[0] ?? 'Apple user',
  };
}
