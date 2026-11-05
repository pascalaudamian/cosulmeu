import crypto from 'node:crypto';

const COOKIE_NAME = 'cosulmeu_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export function hashSecret(secret: string, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(secret, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifySecret(secret: string, encoded: string) {
  const [salt, expected] = encoded.split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(secret, salt, 64).toString('hex');
  return expected.length === actual.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

export function createSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function parseSessionCookie(header?: string) {
  const value = header?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE_NAME}=`));
  return value?.slice(COOKIE_NAME.length + 1) || null;
}

export function sessionCookie(token: string) {
  return `${COOKIE_NAME}=${token}; Max-Age=${SESSION_TTL_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export { COOKIE_NAME, SESSION_TTL_SECONDS };
