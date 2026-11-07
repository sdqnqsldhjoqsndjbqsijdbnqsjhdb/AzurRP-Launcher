import { Router } from 'express';
import env from '../env.js';
import { query } from '../db.js';
import {
  ApiError,
  asyncHandler,
  sendData
} from '../http.js';
import {
  assertEmail,
  assertPassword,
  assertUsername,
  hashPassword,
  issueSession,
  normalizeEmail,
  requireAuth,
  verifyPassword
} from '../auth.js';
import { rateLimit } from '../rateLimit.js';

const router = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, keyPrefix: 'login' });
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 8, keyPrefix: 'register' });

router.post(
  '/register',
  registerLimiter,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const username = assertUsername(body.username);
    const email = assertEmail(body.email);
    const password = assertPassword(body.password);

    const existing = await query(
      'SELECT username, email FROM users WHERE username = ? OR email = ? LIMIT 1',
      [username, email]
    );
    if (existing.length) {
      const conflict = normalizeEmail(existing[0].email) === email ? 'EMAIL_TAKEN' : 'USERNAME_TAKEN';
      throw new ApiError(
        409,
        conflict,
        conflict === 'EMAIL_TAKEN'
          ? 'Un compte utilise déjà cette adresse email.'
          : 'Ce pseudo est déjà pris. Choisis-en un autre.'
      );
    }

    const passwordHash = await hashPassword(password);
    let result;
    try {
      result = await query(
        'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
        [username, email, passwordHash, 'player']
      );
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        throw new ApiError(409, 'USERNAME_TAKEN', 'Ce pseudo ou cette adresse email est déjà utilisé.');
      }
      throw error;
    }

    const rows = await query(
      'SELECT id, username, email, role, created_at, last_login_at FROM users WHERE id = ? LIMIT 1',
      [result.insertId]
    );
    const session = issueSession(rows[0]);
    console.log(`[auth] inscription de ${username} (${email})`);
    sendData(res, session, 201);
  })
);

router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const identifier = String(body.identifier ?? '').trim();
    const password = String(body.password ?? '');

    if (!identifier || identifier.length > 190) {
      throw new ApiError(400, 'MISSING_IDENTIFIER', 'Indique ton pseudo ou ton email.');
    }
    if (!password || Buffer.byteLength(password, 'utf8') > 72) {
      throw new ApiError(400, 'MISSING_PASSWORD', 'Indique ton mot de passe.');
    }

    const rows = identifier.includes('@')
      ? await query('SELECT * FROM users WHERE email = ? LIMIT 1', [normalizeEmail(identifier)])
      : await query('SELECT * FROM users WHERE username = ? LIMIT 1', [identifier]);

    const user = rows[0] || null;
    const valid = await verifyPassword(password, user?.password_hash);
    if (!user || !valid) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Pseudo, email ou mot de passe incorrect.');
    }

    const ip = req.ip || req.socket?.remoteAddress || null;
    await query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP, last_login_ip = ? WHERE id = ?', [
      ip ? String(ip).slice(0, 64) : null,
      user.id
    ]);

    user.last_login_at = new Date().toISOString();
    const session = issueSession(user);
    console.log(`[auth] connexion de ${user.username}`);
    sendData(res, session);
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    sendData(res, { user: req.user });
  })
);

router.post(
  '/logout',
  requireAuth,
  asyncHandler(async (_req, res) => {
    sendData(res, { loggedOut: true });
  })
);

router.get(
  '/config',
  asyncHandler(async (_req, res) => {
    sendData(res, {
      version: env.version,
      tokenTtlDays: env.tokenTtlDays
    });
  })
);

export default router;
