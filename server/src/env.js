import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, '..', '.env') });

function bool(value, fallback) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const production = process.env.NODE_ENV === 'production';
const dbName = process.env.DB_NAME || 'azurrp';

if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
  throw new Error('DB_NAME ne doit contenir que des lettres, chiffres et tirets bas.');
}

let jwtSecret = process.env.JWT_SECRET || '';
if (jwtSecret.length > 0 && jwtSecret.length < 32) {
  throw new Error('JWT_SECRET doit contenir au moins 32 caractères.');
}
if (!jwtSecret) {
  if (production) {
    throw new Error('JWT_SECRET est obligatoire en production. Génère-le avec : openssl rand -hex 48');
  }
  jwtSecret = crypto.randomBytes(48).toString('hex');
  console.warn('[env] JWT_SECRET absent : secret de développement généré. Les sessions seront invalidées à chaque redémarrage.');
}

export const env = {
  production,
  host: process.env.HOST || '0.0.0.0',
  port: int(process.env.PORT, 3000, 1, 65535),
  trustProxy: bool(process.env.TRUST_PROXY, false),

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: int(process.env.DB_PORT, 3306, 1, 65535),
    user: process.env.DB_USER || 'azurrp',
    password: process.env.DB_PASSWORD || '',
    database: dbName,
    connectionLimit: int(process.env.DB_POOL_SIZE, 10, 1, 50)
  },

  jwtSecret,
  tokenTtlDays: int(process.env.TOKEN_TTL_DAYS, 30, 1, 365),
  bcryptRounds: int(process.env.BCRYPT_ROUNDS, 12, 10, 15),
  autoMigrate: bool(process.env.AUTO_MIGRATE, true),
  autoSeed: bool(process.env.AUTO_SEED, true),

  links: {
    discord: process.env.DISCORD_URL || 'https://discord.gg/azurrp',
    website: process.env.WEBSITE_URL || 'https://azurrp.fr',
    rules: process.env.RULES_URL || 'https://azurrp.fr/reglement',
    map: process.env.MAP_URL || 'https://azurrp.fr/carte'
  },

  version: '1.0.0'
};

export default env;
