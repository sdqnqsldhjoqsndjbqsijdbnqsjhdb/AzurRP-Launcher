import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import env from './env.js';
import { closeDatabase, initDatabase } from './db.js';
import { seedDefaults } from './seed.js';
import { ApiError, errorHandler, notFoundHandler, sendData } from './http.js';
import authRoutes from './routes/auth.js';
import contentRoutes from './routes/content.js';
import adminRoutes from './routes/admin.js';

const app = express();
const serverDir = path.dirname(fileURLToPath(import.meta.url));
const modsArchive = path.resolve(process.env.MODS_DIR || path.join(serverDir, '..', 'mods'), 'mods.zip');

app.disable('x-powered-by');
if (env.trustProxy) app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use(express.json({ limit: '64kb' }));

app.use((req, res, next) => {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const id = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '-';
    if (!req.path.startsWith('/api/v1/health')) {
      console.log(
        `[http] ${req.method} ${req.path} → ${res.statusCode} (${ms.toFixed(1)} ms) ${id}`
      );
    }
  });
  next();
});

app.get('/api/v1/health', (_req, res) => {
  sendData(res, {
    status: 'ok',
    version: env.version,
    uptime: Math.round(process.uptime()),
    time: new Date().toISOString()
  });
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1', contentRoutes);
app.use('/api/v1/admin', adminRoutes);

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    data: {
      name: 'AzurRP API',
      version: env.version,
      endpoints: ['/api/v1/health', '/api/v1/auth', '/api/v1/content']
    }
  });
});

app.get('/mods/mods.zip', (_req, res, next) => {
  if (!fs.existsSync(modsArchive)) {
    return res.status(404).json({
      ok: false,
      error: { code: 'MOD_PACK_NOT_FOUND', message: 'Le pack mods.zip n’est pas installé sur le serveur.' }
    });
  }
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.type('application/zip');
  res.sendFile(modsArchive, (error) => {
    if (error) next(error);
  });
});

app.use(notFoundHandler);
app.use(errorHandler);

let server = null;
let shuttingDown = false;

async function start() {
  await initDatabase();

  if (env.autoSeed) {
    try {
      await seedDefaults();
    } catch (error) {
      console.warn(`[seed] ignoré : ${error.message}`);
    }
  }

  server = http.createServer(app);
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(env.port, env.host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  console.log(`[api] AzurRP v${env.version} à l’écoute sur http://${env.host}:${env.port}`);
  console.log(`[api] base MySQL ${env.db.host}:${env.db.port}/${env.db.database}`);
  if (!env.production) {
    console.log('[api] mode développement — les erreurs détaillées sont journalisées.');
  }
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[api] arrêt demandé (${signal})…`);

  const force = setTimeout(() => {
    console.error('[api] arrêt forcé : le serveur ne répond plus.');
    process.exit(1);
  }, 10_000);
  force.unref();

  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await closeDatabase();
    clearTimeout(force);
    console.log('[api] arrêt terminé.');
    process.exit(0);
  } catch (error) {
    console.error('[api] erreur pendant l’arrêt:', error);
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  console.error('[api] rejet non géré:', reason);
});
process.on('uncaughtException', (error) => {
  console.error('[api] exception non gérée:', error);
  shutdown('uncaughtException');
});

start().catch((error) => {
  if (error instanceof ApiError) {
    console.error(`[api] ${error.code}: ${error.message}`);
  } else {
    console.error('[api] démarrage impossible:', error?.stack || error);
  }
  process.exit(1);
});
