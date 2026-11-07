import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import env from './env.js';

const here = path.dirname(fileURLToPath(import.meta.url));

let pool = null;

const baseConfig = {
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  charset: 'utf8mb4',
  timezone: 'Z',
  dateStrings: true,
  waitForConnections: true,
  connectionLimit: env.db.connectionLimit,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000
};

async function createDatabase() {
  const connection = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password
  });
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${env.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    console.log(`[db] base « ${env.db.database} » créée`);
  } finally {
    await connection.end();
  }
}

export function getPool() {
  if (!pool) throw new Error('La base de données n’est pas initialisée.');
  return pool;
}

export async function query(sql, params = []) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

export async function migrate() {
  const schema = await fs.readFile(path.join(here, 'schema.sql'), 'utf8');
  const statements = schema
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await getPool().query(statement);
  }
}

export async function initDatabase() {
  pool = mysql.createPool({ ...baseConfig, database: env.db.database });
  try {
    await pool.query('SELECT 1');
  } catch (error) {
    if (error.code === 'ER_BAD_DB_ERROR') {
      await pool.end().catch(() => {});
      pool = null;
      await createDatabase();
      pool = mysql.createPool({ ...baseConfig, database: env.db.database });
      await pool.query('SELECT 1');
    } else {
      throw new Error(`Connexion MySQL impossible (${error.code || 'ERREUR'}): ${error.message}`);
    }
  }

  if (env.autoMigrate) {
    await migrate();
    console.log('[db] schéma à jour');
  }
}

export async function closeDatabase() {
  if (!pool) return;
  await pool.end();
  pool = null;
}

export function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  if (text.includes('T')) {
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const date = new Date(`${text.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function serializeUser(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    username: row.username,
    email: row.email,
    role: row.role,
    createdAt: toIso(row.created_at),
    lastLoginAt: toIso(row.last_login_at)
  };
}
