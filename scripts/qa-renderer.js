'use strict';

/* Audit automatisé de l'interface : erreurs console, images cassées et
   débordements horizontaux sur chaque écran. Usage : npm run qa */

const { app, BrowserWindow } = require('electron');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const problems = [];

async function inspect(win, label) {
  const report = await win.webContents.executeJavaScript(`
    (() => {
      const issues = [];
      const doc = document.documentElement;
      if (doc.scrollWidth > doc.clientWidth + 2) {
        issues.push('débordement horizontal du document: ' + doc.scrollWidth + ' > ' + doc.clientWidth);
      }
      for (const image of document.images) {
        if (image.offsetParent === null) continue;
        if (image.complete && image.naturalWidth === 0) {
          issues.push('image cassée: ' + image.getAttribute('src'));
        }
      }
      for (const element of document.querySelectorAll('.view.active, .login-panel, .launch-modal')) {
        const rect = element.getBoundingClientRect();
        if (rect.width > window.innerWidth + 2) {
          issues.push('élément trop large: ' + (element.id || element.className) + ' ' + Math.round(rect.width));
        }
      }
      return issues;
    })()
  `);
  for (const issue of report) problems.push(`[${label}] ${issue}`);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'screenshot-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.webContents.on('console-message', (event) => {
    if (event.level !== 'warning' && event.level !== 'error') return;
    if (/Autofill\.|Electron Security Warning/i.test(event.message)) return;
    problems.push(`[console] ${event.message}`);
  });

  await win.loadFile(path.join(root, 'dist', 'renderer', 'index.html'));
  await delay(1900);
  await inspect(win, 'connexion');

  await win.webContents.executeJavaScript(`
    (() => {
      document.querySelector('#login-identifier').value = 'Nova';
      document.querySelector('#login-password').value = 'motdepasse';
      document.querySelector('#login-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return true;
    })()
  `);
  await delay(1200);

  for (const view of ['play', 'news', 'server', 'settings']) {
    await win.webContents.executeJavaScript(
      `document.querySelector('.nav-item[data-view="${view}"]').click(), true`
    );
    await delay(500);
    await inspect(win, view);
  }

  await win.close();

  if (problems.length) {
    console.error(`[qa] ${problems.length} problème(s) détecté(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    app.exit(1);
  } else {
    console.log('[qa] aucune anomalie détectée.');
    app.exit(0);
  }
}).catch((error) => {
  console.error('[qa] échec:', error);
  app.exit(1);
});
