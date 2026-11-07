'use strict';

/* Génère des captures dans docs/screenshots pour la documentation et le QA visuel.
   Usage : npm run screenshot */

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'docs', 'screenshots');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function capture(win, name) {
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
  await delay(450);
  await capture(win, '01-boot');

  await delay(1400);
  await capture(win, '02-login');

  await win.webContents.executeJavaScript(`
    (() => {
      document.querySelector('#login-identifier').value = 'Aventurier';
      document.querySelector('#login-password').value = 'motdepasse';
      document.querySelector('#login-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return true;
    })()
  `);
  await delay(1200);
  await capture(win, '03-play');

  for (const [view, name] of [
    ['news', '04-news'],
    ['server', '05-server'],
    ['settings', '06-settings']
  ]) {
    await win.webContents.executeJavaScript(
      `document.querySelector('.nav-item[data-view="${view}"]').click(), true`
    );
    await delay(650);
    await capture(win, name);
  }

  await win.close();
  app.quit();
}

app.whenReady().then(run).catch((error) => {
  console.error('[screenshot] échec:', error);
  app.quit();
});
