'use strict';

/* Test de bout en bout du vrai processus principal : API simulée, pont IPC
   réel, authentification, contenu, navigation et déconnexion.
   Usage : npm run e2e */

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
const consoleErrors = [];

function check(condition, label) {
  if (condition) {
    console.log(`  ok  ${label}`);
  } else {
    failures.push(label);
    console.error(`  KO  ${label}`);
  }
}

const user = {
  id: 1,
  username: 'Nova',
  email: 'Nova@azurrp.fr',
  role: 'admin',
  createdAt: '2026-01-18T10:24:00.000Z'
};

const news = [
  {
    id: 'festival-lanternes',
    title: 'Le Festival des Lumières illumine le centre-ville',
    excerpt: 'Trois soirées de concerts et d’installations lumineuses.',
    tag: 'Événement',
    image: 'news-festival.svg',
    publishedAt: '2026-10-28T18:00:00.000Z'
  },
  {
    id: 'marche-suspendu',
    title: 'Le marché nocturne s’installe sur l’avenue',
    excerpt: 'Artisans et commerçants prennent possession du centre-ville.',
    tag: 'Économie',
    image: 'news-market.svg',
    publishedAt: '2026-10-21T16:30:00.000Z'
  },
  {
    id: 'archives-azur',
    title: 'Le quartier d’affaires ouvre ses portes',
    excerpt: 'Bureaux et résidences accueillent leurs premiers habitants.',
    tag: 'Ville',
    image: 'news-lore.svg',
    publishedAt: '2026-10-14T12:00:00.000Z'
  }
];

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function data(res, value, status = 200) {
  send(res, status, { ok: true, data: value });
}

function fail(res, status, code, message) {
  send(res, status, { ok: false, error: { code, message } });
}

function createApi() {
  return http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      let body = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        return fail(res, 400, 'INVALID_JSON', 'JSON invalide.');
      }

      const route = `${req.method} ${req.url.split('?')[0]}`;
      if (route === 'GET /api/v1/health') {
        return data(res, { status: 'ok', version: '1.0.0', uptime: 12 });
      }
      if (route === 'POST /api/v1/auth/login') {
        const ok = body.identifier === user.username && body.password === 'motdepasse123';
        if (!ok) return fail(res, 401, 'INVALID_CREDENTIALS', 'Pseudo, email ou mot de passe incorrect.');
        return data(res, {
          token: 'e2e-token',
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          user
        });
      }
      if (route === 'POST /api/v1/auth/register') {
        const created = { ...user, username: body.username || 'Nouveau', email: body.email || user.email };
        return data(res, {
          token: 'e2e-token',
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          user: created
        }, 201);
      }
      if (route === 'GET /api/v1/auth/me') {
        if (req.headers.authorization !== 'Bearer e2e-token') {
          return fail(res, 401, 'INVALID_TOKEN', 'Session invalide.');
        }
        return data(res, { user });
      }
      if (route === 'GET /api/v1/content') {
        return data(res, {
          news,
          links: {
            discord: 'https://discord.gg/azurrp',
            website: 'https://azurrp.fr',
            rules: 'https://azurrp.fr/reglement',
            map: 'https://azurrp.fr/carte'
          },
          announcement: null
        });
      }
      return fail(res, 404, 'NOT_FOUND', 'Ressource introuvable.');
    });
  });
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function waitFor(win, expression, timeout = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await win.webContents.executeJavaScript(expression).catch(() => null);
    if (value) return value;
    await delay(120);
  }
  throw new Error(`Timeout en attendant : ${expression}`);
}

async function main() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'azurrp-e2e-'));
  app.setPath('userData', userData);

  const api = createApi();
  const port = await listen(api);
  process.env.AZURRP_API_URL = `http://127.0.0.1:${port}`;

  require(path.join(__dirname, '..', 'dist', 'main.js'));

  await app.whenReady();
  let win = null;
  for (let i = 0; i < 80 && !win; i += 1) {
    win = BrowserWindow.getAllWindows()[0] || null;
    if (!win) await delay(100);
  }
  if (!win) throw new Error('Fenêtre principale introuvable.');

  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') consoleErrors.push(event.message);
  });

  console.log('› Démarrage et écran de connexion');
  await waitFor(win, `document.querySelector('#login-screen')?.classList.contains('hidden') === false`);
  check(true, 'écran de connexion affiché');
  check(
    await win.webContents.executeJavaScript(
      `getComputedStyle(document.querySelector('#titlebar-status')).display === 'none'`
    ),
    'statut du serveur masqué hors de l’application'
  );

  console.log('› Inscription : validations locales');
  await win.webContents.executeJavaScript(
    `document.querySelector('.auth-tab[data-auth-tab="register"]').click(), true`
  );
  await waitFor(win, `document.querySelector('#register-form')?.classList.contains('hidden') === false`);
  await win.webContents.executeJavaScript(`
    (() => {
      document.querySelector('#register-username').value = 'Nouveau';
      document.querySelector('#register-email').value = 'nouveau@azurrp.fr';
      document.querySelector('#register-password').value = 'motdepasse123';
      document.querySelector('#register-confirm').value = 'different123';
      document.querySelector('#register-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return true;
    })()
  `);
  await waitFor(win, `document.querySelector('#register-error')?.classList.contains('visible')`);
  check(true, 'mots de passe différents refusés');
  await win.webContents.executeJavaScript(
    `document.querySelector('.auth-tab[data-auth-tab="login"]').click(), true`
  );

  console.log('› Mauvais mot de passe');
  await win.webContents.executeJavaScript(`
    (() => {
      document.querySelector('#login-identifier').value = 'Nova';
      document.querySelector('#login-password').value = 'mauvais';
      document.querySelector('#login-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return true;
    })()
  `);
  await waitFor(win, `document.querySelector('#login-error')?.classList.contains('visible')`);
  check(true, 'erreur de connexion affichée');

  console.log('› Connexion réussie');
  await win.webContents.executeJavaScript(`
    (() => {
      document.querySelector('#login-identifier').value = 'Nova';
      document.querySelector('#login-password').value = 'motdepasse123';
      document.querySelector('#login-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return true;
    })()
  `);
  await waitFor(win, `document.querySelector('#main-screen')?.classList.contains('hidden') === false`);
  await waitFor(win, `document.querySelectorAll('.news-preview-item').length === 3`);
  check(
    (await win.webContents.executeJavaScript(
      `document.querySelector('.account-meta [data-username]')?.textContent`
    )) === 'Nova',
    'pseudo du compte affiché'
  );
  check(
    (await win.webContents.executeJavaScript(`document.querySelector('#news-preview').children.length`)) === 3,
    'aperçu des actualités chargé depuis l’API'
  );

  console.log('› Navigation');
  for (const view of ['news', 'server', 'settings']) {
    await win.webContents.executeJavaScript(
      `document.querySelector('.nav-item[data-view="${view}"]').click(), true`
    );
    await delay(300);
    const active = await win.webContents.executeJavaScript(
      `document.querySelector('.view.active')?.dataset.viewPanel`
    );
    check(active === view, `vue « ${view} » active`);
  }
  check(
    (await win.webContents.executeJavaScript(
      `document.querySelectorAll('#news-grid .news-card').length`
    )) === 3,
    'grille des actualités rendue'
  );
  check(
    (await win.webContents.executeJavaScript(
      `document.querySelector('[data-server-ip]')?.textContent`
    )).includes('play.azur-rp.eu'),
    'adresse du serveur affichée'
  );

  console.log('› Console');
  await win.webContents.executeJavaScript(`document.querySelector('#console-button').click(), true`);
  check(
    await win.webContents.executeJavaScript(
      `document.querySelector('#console-drawer').classList.contains('open')`
    ),
    'console ouverte'
  );
  await win.webContents.executeJavaScript(`document.querySelector('#console-close').click(), true`);
  check(
    !(await win.webContents.executeJavaScript(
      `document.querySelector('#console-drawer').classList.contains('open')`
    )),
    'console fermée'
  );

  console.log('› Persistance de session');
  await delay(300);
  check(fs.existsSync(path.join(userData, 'session.dat')), 'session chiffrée enregistrée');

  console.log('› Repli hors ligne du contenu');
  await new Promise((resolve) => api.close(resolve));
  await win.webContents.executeJavaScript(
    `document.querySelector('.nav-item[data-view="news"]').click(), true`
  );
  await win.webContents.executeJavaScript(
    `document.querySelector('#news-refresh').click(), true`
  );
  await waitFor(win, `document.querySelector('#news-offline-banner')?.classList.contains('hidden') === false`, 6000);
  check(true, 'bannière hors ligne affichée avec le contenu local');
  check(
    (await win.webContents.executeJavaScript(
      `document.querySelectorAll('#news-grid .news-card').length`
    )) === 3,
    'actualités de secours conservées'
  );

  console.log('› Déconnexion');
  await win.webContents.executeJavaScript(`document.querySelector('#sidebar-logout').click(), true`);
  await waitFor(win, `document.querySelector('#login-screen')?.classList.contains('hidden') === false`);
  check(true, 'retour à l’écran de connexion');
  check(!fs.existsSync(path.join(userData, 'session.dat')), 'session locale supprimée');

  check(consoleErrors.length === 0, `aucune erreur console (${consoleErrors.length})`);
  for (const message of consoleErrors) console.error(`      ${message}`);

  win.close();
  console.log(`[e2e] dossier temporaire : ${userData}`);

  if (failures.length) {
    console.error(`\n[e2e] ${failures.length} échec(s).`);
    app.exit(1);
  } else {
    console.log('\n[e2e] tous les contrôles sont passés.');
    app.exit(0);
  }
}

main().catch((error) => {
  console.error('[e2e] échec fatal:', error);
  app.exit(1);
});
