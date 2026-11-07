'use strict';

/* Génère des captures dans docs/screenshots pour la documentation et le QA visuel.
   Usage : npm run screenshot */

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'docs', 'screenshots');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const only = new Set(process.argv.slice(2));

async function waitFor(win, expression, label, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await win.webContents.executeJavaScript(expression).catch(() => false)) return;
    await delay(100);
  }
  throw new Error(`Délai dépassé en attendant ${label}`);
}

async function capture(win, name) {
  if (only.size && !only.has(name)) return;
  await win.webContents.executeJavaScript(`
    (async () => {
      const view = document.querySelector('.view.active');
      const animations = view
        ? view.getAnimations({ subtree: true }).filter((animation) => {
            const timing = animation.effect?.getComputedTiming();
            return timing && timing.iterations !== Infinity && animation.playState === 'running';
          })
        : [];
      await Promise.all(animations.map((animation) => animation.finished.catch(() => {})));
    })()
  `);
  await win.webContents.executeJavaScript(
    'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
  );
  const image = await win.webContents.capturePage();
  await fs.writeFile(path.join(output, `${name}.png`), image.toPNG());
  console.log(`[screenshot] ${name}.png`);
}

async function run() {
  await fs.mkdir(output, { recursive: true });

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    frame: false,
    backgroundColor: '#050e18',
    webPreferences: {
      preload: path.join(__dirname, 'screenshot-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      offscreen: false
    }
  });

  await win.loadFile(path.join(root, 'dist', 'renderer', 'index.html'));
  await waitFor(
    win,
    `(() => {
      const boot = document.querySelector('#boot-screen');
      return boot && !boot.classList.contains('hidden');
    })()`,
    'affichage de l’écran de démarrage'
  );
  await delay(250);
  await capture(win, '01-boot');

  await waitFor(win, `document.querySelector('#login-screen')?.classList.contains('hidden') === false`, 'écran de connexion');
  await capture(win, '02-login');

  await win.webContents.executeJavaScript(`
    (() => {
      document.querySelector('#login-identifier').value = 'Aventurier';
      document.querySelector('#login-password').value = 'motdepasse';
      document.querySelector('#login-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return true;
    })()
  `);
  await waitFor(win, `document.querySelector('#main-screen')?.classList.contains('hidden') === false`, 'connexion réussie');
  await waitFor(
    win,
    `document.querySelector('#news-grid')?.querySelector('.news-card, .detail-card') !== null`,
    'chargement du contenu'
  );
  await capture(win, '03-play');

  for (const [view, name] of [
    ['news', '04-news'],
    ['server', '05-server'],
    ['settings', '06-settings']
  ]) {
    await win.webContents.executeJavaScript(
      `document.querySelector('.nav-item[data-view="${view}"]').click(), true`
    );
    await waitFor(
      win,
      `document.querySelector('.view.active')?.dataset.viewPanel === '${view}'`,
      `vue ${view}`
    );
    if (view === 'server') {
      await waitFor(
        win,
        `(() => {
          const status = document.querySelector('#server-big-status');
          return status?.classList.contains('online') || status?.classList.contains('offline');
        })()`,
        'fin de la vérification du serveur'
      );
    }
    if (view === 'settings') {
      await waitFor(win, `document.querySelector('#set-server-host')?.value === 'play.azur-rp.eu'`, 'chargement des paramètres');
    }
    await capture(win, name);
  }

  await win.close();
  app.quit();
}

app.whenReady().then(run).catch((error) => {
  console.error('[screenshot] échec:', error);
  app.quit();
});
