import crypto from 'node:crypto';

const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

function signature(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

/**
 * Jeton signé HMAC-SHA256, au format JWT compact.
 * Aucune dépendance externe : moins de surface d'attaque et de mises à jour.
 */
export function signToken(payload, secret, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const body = {
    ...payload,
    iat: now,
    exp: now + Math.max(60, Number(ttlSeconds) || 0)
  };
  const data = `${HEADER}.${Buffer.from(JSON.stringify(body)).toString('base64url')}`;
  return {
    token: `${data}.${signature(data, secret)}`,
    expiresAt: new Date(body.exp * 1000).toISOString()
  };
}

export function verifyToken(token, secret) {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const data = `${parts[0]}.${parts[1]}`;
  const expected = signature(data, secret);
  const provided = parts[2];
  if (provided.length !== expected.length) return null;

  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!payload || typeof payload !== 'object') return null;
    if (!Number.isFinite(payload.exp) || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
