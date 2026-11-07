import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import bcrypt from 'bcryptjs';
import { signToken, verifyToken } from './token.js';

// Development-only API, bound to loopback and backed by a local SQLite file.
const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const secretPath = path.join(dataDir, 'local-jwt-secret');
if (!fs.existsSync(secretPath)) {
  fs.writeFileSync(secretPath, crypto.randomBytes(48), { mode: 0o600, flag: 'wx' });
}
const secret = fs.readFileSync(secretPath);
const db = new DatabaseSync(path.join(dataDir, 'azurrp-local.sqlite'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'player',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at TEXT
  );
`);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

function sendData(res, data, status = 200) {
  res.status(status).json({ ok: true, data });
}

function sendError(res, status, code, message) {
  res.status(status).json({ ok: false, error: { code, message } });
}

function publicUser(row) {
  return {
    id: Number(row.id),
    username: row.username,
    email: row.email,
    role: row.role,
    createdAt: row.created_at ? new Date(`${row.created_at.replace(' ', 'T')}Z`).toISOString() : null,
    lastLoginAt: row.last_login_at ? new Date(`${row.last_login_at.replace(' ', 'T')}Z`).toISOString() : null
  };
}

function issueSession(row) {
  const user = publicUser(row);
  const issued = signToken(
    { sub: String(row.id), username: row.username, role: row.role },
    secret,
    30 * 24 * 60 * 60
  );
  return { token: issued.token, expiresAt: issued.expiresAt, user };
}

function authorizedUser(req) {
  const token = /^Bearer\s+([A-Za-z0-9._-]+)$/i.exec(req.get('authorization') || '')?.[1];
  const payload = token && verifyToken(token, secret);
  if (!payload?.sub) return null;
  return db.prepare('SELECT id, username, email, role, created_at, last_login_at FROM users WHERE id = ?')
    .get(payload.sub) || null;
}

app.get('/api/v1/health', (_req, res) => sendData(res, {
  status: 'ok',
  version: '1.0.0-local',
  uptime: Math.round(process.uptime()),
  time: new Date().toISOString()
}));

app.post('/api/v1/auth/register', async (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
    return sendError(res, 400, 'INVALID_USERNAME', 'Le pseudo doit contenir 3 à 16 caractères : lettres, chiffres ou tirets bas.');
  }
  if (email.length > 190 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return sendError(res, 400, 'INVALID_EMAIL', 'Cette adresse email n’est pas valide.');
  }
  if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
    return sendError(res, 400, 'WEAK_PASSWORD', 'Le mot de passe doit contenir entre 8 et 72 octets.');
  }
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const result = db.prepare(
      'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)'
    ).run(username, email, passwordHash);
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    return sendData(res, issueSession(row), 201);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const existing = db.prepare('SELECT username, email FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE')
        .get(username, email);
      const emailTaken = existing?.email.toLowerCase() === email;
      return sendError(res, 409, emailTaken ? 'EMAIL_TAKEN' : 'USERNAME_TAKEN',
        emailTaken ? 'Un compte utilise déjà cette adresse email.' : 'Ce pseudo est déjà pris. Choisis-en un autre.');
    }
    console.error('[api-local] inscription impossible:', error);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Une erreur interne est survenue.');
  }
});

app.post('/api/v1/auth/login', async (req, res) => {
  const identifier = String(req.body?.identifier ?? '').trim();
  const password = String(req.body?.password ?? '');
  if (!identifier || identifier.length > 190 || !password || Buffer.byteLength(password, 'utf8') > 72) {
    return sendError(res, 400, 'INVALID_CREDENTIALS', 'Indique ton pseudo/email et ton mot de passe.');
  }
  const row = identifier.includes('@')
    ? db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(identifier)
    : db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(identifier);
  const valid = await bcrypt.compare(password, row?.password_hash || '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid');
  if (!row || !valid) return sendError(res, 401, 'INVALID_CREDENTIALS', 'Pseudo, email ou mot de passe incorrect.');
  db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(row.id);
  return sendData(res, issueSession(updated));
});

app.get('/api/v1/auth/me', (req, res) => {
  const user = authorizedUser(req);
  if (!user) return sendError(res, 401, 'INVALID_TOKEN', 'Session invalide ou expirée.');
  return sendData(res, { user: publicUser(user) });
});

app.get('/api/v1/content', (_req, res) => sendData(res, {
  news: [],
  links: {
    discord: 'https://discord.gg/azurrp',
    website: 'https://azurrp.fr',
    rules: 'https://azurrp.fr/reglement',
    map: 'https://azurrp.fr/carte'
  },
  announcement: 'API locale de développement'
}));

app.use((error, _req, res, _next) => {
  console.error('[api-local] erreur:', error);
  sendError(res, error.status || 500, 'INTERNAL_ERROR', 'Une erreur interne est survenue.');
});

const server = app.listen(3000, '127.0.0.1', () => {
  console.log('[api-local] écoute sur http://127.0.0.1:3000 (SQLite local)');
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
