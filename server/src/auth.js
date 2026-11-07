import bcrypt from 'bcryptjs';
import env from './env.js';
import { query, serializeUser } from './db.js';
import { signToken, verifyToken } from './token.js';
import { ApiError, asyncHandler } from './http.js';

let dummyHash = null;

async function getDummyHash() {
  if (!dummyHash) dummyHash = await bcrypt.hash('azurrp-dummy-password', env.bcryptRounds);
  return dummyHash;
}

export function normalizeUsername(value) {
  return String(value ?? '').trim();
}

export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function assertUsername(value) {
  const username = normalizeUsername(value);
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
    throw new ApiError(
      400,
      'INVALID_USERNAME',
      'Le pseudo doit contenir 3 à 16 caractères : lettres, chiffres ou tirets bas.'
    );
  }
  return username;
}

export function assertEmail(value) {
  const email = normalizeEmail(value);
  if (email.length < 5 || email.length > 190 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new ApiError(400, 'INVALID_EMAIL', 'Cette adresse email n’est pas valide.');
  }
  return email;
}

export function assertPassword(value) {
  const password = String(value ?? '');
  if (password.length < 8) {
    throw new ApiError(400, 'WEAK_PASSWORD', 'Le mot de passe doit contenir au moins 8 caractères.');
  }
  if (Buffer.byteLength(password, 'utf8') > 72) {
    throw new ApiError(400, 'PASSWORD_TOO_LONG', 'Le mot de passe ne peut pas dépasser 72 octets.');
  }
  return password;
}

export async function hashPassword(password) {
  return bcrypt.hash(password, env.bcryptRounds);
}

export async function verifyPassword(password, hash) {
  if (!hash) {
    const fake = await getDummyHash();
    await bcrypt.compare(String(password ?? ''), fake);
    return false;
  }
  return bcrypt.compare(String(password ?? ''), hash);
}

export function issueSession(user) {
  const { token, expiresAt } = signToken(
    { sub: String(user.id), username: user.username, role: user.role },
    env.jwtSecret,
    env.tokenTtlDays * 24 * 60 * 60
  );
  return { token, expiresAt, user: serializeUser(user) };
}

function bearerToken(req) {
  const header = req.get('authorization') || '';
  const match = /^Bearer\s+([A-Za-z0-9._-]+)$/i.exec(header);
  return match ? match[1] : null;
}

export const requireAuth = asyncHandler(async (req, _res, next) => {
  const token = bearerToken(req);
  if (!token) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentification requise.');

  const payload = verifyToken(token, env.jwtSecret);
  if (!payload?.sub) throw new ApiError(401, 'INVALID_TOKEN', 'Session invalide ou expirée.');

  const rows = await query(
    'SELECT id, username, email, role, created_at, last_login_at FROM users WHERE id = ? LIMIT 1',
    [payload.sub]
  );
  if (!rows.length) throw new ApiError(401, 'INVALID_TOKEN', 'Compte introuvable.');

  req.user = serializeUser(rows[0]);
  next();
});

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(new ApiError(401, 'AUTH_REQUIRED', 'Authentification requise.'));
    if (!roles.includes(req.user.role)) {
      return next(new ApiError(403, 'FORBIDDEN', 'Tu n’as pas accès à cette ressource.'));
    }
    return next();
  };
}
