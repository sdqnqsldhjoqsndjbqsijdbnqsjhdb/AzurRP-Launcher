'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, safeStorage, session, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const os = require('node:os');
const path = require('node:path');
const { APP_ID, APP_NAME, DEFAULT_FORGE_BUILD, MINECRAFT_VERSION } = require('./config');
const { Logger, sanitize } = require('./logger');
const { SettingsStore } = require('./settings');
const { SessionStore } = require('./session');
const { fallbackContent } = require('./content');
const { verifyIntegrity } = require('./integrity');
const api = require('./services/api');
const { detectJava } = require('./services/java');
const { MinecraftManager } = require('./services/minecraft');
const { ServerStatusService } = require('./services/serverStatus');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  boot();
}

function boot() {
  app.enableSandbox();
  app.setName(APP_NAME);
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(initialize).catch((error) => {
    dialog.showErrorBox('AzurRP — erreur de démarrage', sanitize(error.stack || error.message));
    app.quit();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

let mainWindow = null;
let logger = null;
let settingsStore = null;
let sessionStore = null;
let minecraft = null;
let serverStatus = null;
let defaultGameDir = '';
let rendererCrashed = false;

async function initialize() {
  Menu.setApplicationMenu(null);

  const userData = app.getPath('userData');
  const logsDir = path.join(userData, 'logs');
  defaultGameDir = path.join(app.getPath('appData'), 'AzurRP', 'minecraft');
  logger = new Logger(logsDir, { dev: !app.isPackaged });
  logger.info(`${APP_NAME} ${app.getVersion()} démarre (${process.platform}/${process.arch}).`);

  if (app.isPackaged) {
    const valid = await verifyIntegrity(__dirname, logger);
    if (!valid) {
      logger.error('Contrôle d’intégrité échoué.');
      dialog.showErrorBox(
        'AzurRP — installation altérée',
        'Les fichiers du launcher ont été modifiés. Réinstalle AzurRP depuis une source officielle.'
      );
      app.quit();
      return;
    }
  }

  settingsStore = new SettingsStore(path.join(userData, 'settings.json'), {
    gameDir: defaultGameDir,
    logger
  });
  sessionStore = new SessionStore(path.join(userData, 'session.dat'), {
    safeStorage,
    logger
  });
  sessionStore.load();
  if (!settingsStore.get().rememberSession) sessionStore.clear();
  enforceForgeForPlayers();

  serverStatus = new ServerStatusService({ settingsStore, logger });
  minecraft = new MinecraftManager({
    settingsStore,
    logger,
    defaultGameDir,
    getApiBase: apiBase,
    getUser: () => sessionStore.current?.user || null,
    emit: emitGameEvent
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  registerIpc();
  createWindow();
  initializeAutoUpdater();

  process.on('uncaughtException', (error) => {
    logger.error(`Exception non gérée: ${error.stack || error.message}`);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error(`Rejet non géré: ${reason?.stack || reason}`);
  });

  if (process.argv.includes('--smoke-test')) {
    setTimeout(() => {
      logger.info('Test de démarrage terminé.');
      app.quit();
    }, 5000);
  }
}

function initializeAutoUpdater() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = logger;
  autoUpdater.on('error', (error) => logger.warn(`Mise à jour indisponible: ${error.message}`));
  autoUpdater.on('update-available', (info) => {
    logger.info(`Mise à jour ${info.version} disponible.`);
    sendToRenderer('update:available', { version: info.version });
  });
  autoUpdater.on('download-progress', (progress) => {
    sendToRenderer('update:progress', { percent: Math.round(progress.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    logger.info(`Mise à jour ${info.version} téléchargée.`);
    sendToRenderer('update:downloaded', { version: info.version });
    if (!mainWindow || mainWindow.isDestroyed()) return;
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Mise à jour AzurRP prête',
      message: `La version ${info.version} est prête à être installée.`,
      detail: 'Redémarre le launcher maintenant pour terminer l’installation.',
      buttons: ['Redémarrer', 'Plus tard'],
      defaultId: 0,
      cancelId: 1
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });
  setTimeout(() => autoUpdater.checkForUpdates().catch((error) => {
    logger.warn(`Vérification des mises à jour impossible: ${error.message}`);
  }), 8000);
}

function iconPath() {
  return path.join(__dirname, '..', 'assets', 'brand', 'icon.png');
}

function createWindow() {
  const icon = nativeImage.createFromPath(iconPath());
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1040,
    minHeight: 690,
    show: false,
    frame: false,
    backgroundColor: '#050e18',
    title: APP_NAME,
    icon: icon.isEmpty() ? undefined : icon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged,
      spellcheck: false,
      backgroundThrottling: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('maximize', () => sendToRenderer('window:maximized', true));
  mainWindow.on('unmaximize', () => sendToRenderer('window:maximized', false));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      event.preventDefault();
      return;
    }
    if (parsed.protocol !== 'file:') {
      event.preventDefault();
      openExternal(url);
    }
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logger.error(`Processus de rendu terminé: ${details.reason} (${details.exitCode}).`);
    if (rendererCrashed || !mainWindow || details.reason === 'clean-exit') return;
    rendererCrashed = true;
    dialog
      .showMessageBox(mainWindow, {
        type: 'error',
        title: 'AzurRP — interface interrompue',
        message: 'L’interface du launcher a rencontré un problème.',
        detail: 'Le launcher va se recharger. Si le problème persiste, redémarre AzurRP.',
        buttons: ['Recharger', 'Quitter'],
        defaultId: 0,
        cancelId: 1
      })
      .then(({ response }) => {
        if (response === 0 && mainWindow) {
          rendererCrashed = false;
          mainWindow.reload();
        } else {
          app.quit();
        }
      });
  });
}

function sendToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function emitGameEvent(event) {
  sendToRenderer('game:event', event);
  if (event.type === 'spawned') {
    logger.info('Minecraft a démarré.');
    if (settingsStore.get().minimizeOnLaunch && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.minimize();
    }
  }
}

function trusted(event) {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender.id === mainWindow.webContents.id);
}

function handle(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!trusted(event)) {
      return { ok: false, error: { code: 'FORBIDDEN', message: 'Requête non autorisée.' } };
    }
    try {
      const data = await handler(...args);
      return { ok: true, data };
    } catch (error) {
      const message = error?.message ? sanitize(error.message) : 'Une erreur inattendue est survenue.';
      const networkDiagnostic = error?.code === 'NETWORK_ERROR' && error.details
        ? ` [hôte=${sanitize(error.details.host || 'inconnu')}; réseau=${sanitize(error.details.networkCode || 'inconnu')}]`
        : '';
      if (error?.code && error.code !== 'NETWORK_ERROR') {
        logger.warn(`IPC ${channel}: ${error.code} — ${message}`);
      } else {
        logger.debug(`IPC ${channel}: ${message}${networkDiagnostic}`);
      }
      return {
        ok: false,
        error: {
          code: error?.code || 'UNEXPECTED_ERROR',
          message,
          details: error?.details ?? null
        }
      };
    }
  });
}

function apiBase() {
  return process.env.AZURRP_API_URL || settingsStore.get().apiUrl;
}

const FOUNDER_ONLY_SETTINGS = [
  'serverHost',
  'serverPort',
  'autoConnect',
  'apiUrl',
  'useForge',
  'forgeBuild'
];

function isFounder() {
  return sessionStore.current?.user?.role === 'admin';
}

function enforceForgeForPlayers() {
  if (!settingsStore || isFounder()) return settingsStore?.get();
  const current = settingsStore.get();
  if (current.useForge && current.forgeBuild === DEFAULT_FORGE_BUILD) return current;
  return settingsStore.update({ useForge: true, forgeBuild: DEFAULT_FORGE_BUILD });
}

function assertString(value, label, max = 500) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} requis.`);
  if (value.length > max) throw new Error(`${label} trop long.`);
  return value.trim();
}

function assertPassword(value, label, max = 128) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} requis.`);
  if (value.length > max) throw new Error(`${label} trop long.`);
  return value;
}

function publicSession(sessionValue = sessionStore.current) {
  if (!sessionValue) return null;
  return {
    user: sessionValue.user,
    expiresAt: sessionValue.expiresAt || null
  };
}

function expireSessionIfNeeded() {
  const sessionValue = sessionStore.current;
  if (!sessionValue) return false;
  if (sessionValue.expiresAt && Date.parse(sessionValue.expiresAt) < Date.now() + 15000) {
    sessionStore.clear();
    return true;
  }
  return false;
}

function persistAuth(auth) {
  if (auth.user?.role !== 'admin') {
    settingsStore.update({ useForge: true, forgeBuild: DEFAULT_FORGE_BUILD });
  }
  const sessionValue = {
    token: auth.token,
    user: auth.user,
    expiresAt: auth.expiresAt || new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()
  };
  sessionStore.set(sessionValue, settingsStore.get().rememberSession);
  return publicSession(sessionValue);
}

function systemInfo() {
  const settings = settingsStore.get();
  return {
    platform: process.platform,
    arch: process.arch,
    release: os.release(),
    cpus: os.cpus().length,
    totalMemoryMb: Math.floor(os.totalmem() / 1024 / 1024),
    freeMemoryMb: Math.floor(os.freemem() / 1024 / 1024),
    appVersion: app.getVersion(),
    minecraftVersion: MINECRAFT_VERSION,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    defaultGameDir,
    gameDir: settings.gameDir || defaultGameDir,
    logsDir: logger.directory,
    apiUrl: apiBase()
  };
}

function normalizeLinks(links) {
  const fallback = fallbackContent().links;
  const result = { ...fallback };
  if (links && typeof links === 'object') {
    for (const key of Object.keys(result)) {
      if (typeof links[key] === 'string' && /^https?:\/\//i.test(links[key]) && links[key].length < 2048) {
        result[key] = links[key];
      }
    }
  }
  return result;
}

function normalizeNews(news) {
  if (!Array.isArray(news)) return fallbackContent().news;
  const cleaned = news
    .filter((item) => item && typeof item === 'object')
    .slice(0, 12)
    .map((item, index) => ({
      id: String(item.id ?? `news-${index}`),
      title: String(item.title ?? 'Actualité AzurRP').slice(0, 160),
      excerpt: String(item.excerpt ?? '').slice(0, 600),
      tag: String(item.tag ?? 'AzurRP').slice(0, 40),
      image: String(item.image ?? 'news-lore.svg').slice(0, 200),
      publishedAt: item.publishedAt || item.published_at || null
    }));
  return cleaned.length ? cleaned : fallbackContent().news;
}

function registerIpc() {
  handle('app:bootstrap', async () => {
    let sessionValue = sessionStore.current;
    let offline = false;
    let expired = false;

    if (sessionValue && expireSessionIfNeeded()) {
      sessionValue = null;
      expired = true;
    }

    if (sessionValue) {
      try {
        const user = await api.me(apiBase(), sessionValue.token);
        sessionValue.user = user;
        sessionStore.set(sessionValue, settingsStore.get().rememberSession);
      } catch (error) {
        if (error instanceof api.ApiError && [401, 403].includes(error.status)) {
          sessionStore.clear();
          sessionValue = null;
          expired = true;
        } else {
          offline = true;
          logger.warn(`Vérification de session hors ligne: ${error.message}`);
        }
      }
    }
    enforceForgeForPlayers();

    return {
      session: publicSession(sessionValue),
      offline,
      expired,
      settings: { ...settingsStore.get(), apiUrl: apiBase() },
      system: systemInfo(),
      game: minecraft.getState()
    };
  });

  handle('auth:login', async (payload = {}) => {
    const identifier = assertString(payload.identifier, 'Pseudo ou email', 190);
    const password = assertPassword(payload.password, 'Mot de passe', 128);
    const auth = await api.login(apiBase(), identifier, password);
    return { session: persistAuth(auth), user: auth.user };
  });

  handle('auth:register', async (payload = {}) => {
    const username = assertString(payload.username, 'Pseudo', 16);
    const email = assertString(payload.email, 'Email', 190);
    const password = assertPassword(payload.password, 'Mot de passe', 72);
    const auth = await api.register(apiBase(), username, email, password);
    return { session: persistAuth(auth), user: auth.user };
  });

  handle('auth:logout', async () => {
    sessionStore.clear();
    return true;
  });

  handle('content:get', async () => {
    try {
      const data = await api.content(apiBase(), sessionStore.current?.token || null);
      return {
        news: normalizeNews(data?.news),
        links: normalizeLinks(data?.links),
        announcement: typeof data?.announcement === 'string' ? data.announcement.slice(0, 500) : null,
        offline: false
      };
    } catch (error) {
      logger.warn(`Contenu distant indisponible: ${error.message}`);
      const fallback = fallbackContent();
      return { ...fallback, links: normalizeLinks(fallback.links), offline: true };
    }
  });

  handle('server:status', async (force = false) => serverStatus.get(Boolean(force)));

  handle('system:info', async () => systemInfo());

  handle('system:detectJava', async () => {
    const settings = settingsStore.get();
    const gameDir = settings.gameDir || defaultGameDir;
    return detectJava({ customPath: settings.javaPath, gameDir });
  });

  handle('settings:save', async (patch = {}) => {
    if (
      !isFounder() &&
      FOUNDER_ONLY_SETTINGS.some((key) => Object.hasOwn(patch, key))
    ) {
      const error = new Error('Seuls les fondateurs peuvent modifier ces paramètres.');
      error.code = 'FORBIDDEN';
      throw error;
    }
    let settings = settingsStore.update(patch);
    settings = enforceForgeForPlayers() || settings;
    if (settings.rememberSession && sessionStore.current) {
      sessionStore.set(sessionStore.current, true);
    } else if (!settings.rememberSession) {
      sessionStore.clearFile();
    }
    return { ...settings, apiUrl: apiBase() };
  });

  handle('settings:reset', async () => {
    const protectedSettings = settingsStore.get();
    let settings = settingsStore.reset();
    if (!isFounder()) {
      settings = settingsStore.update({
        serverHost: protectedSettings.serverHost,
        serverPort: protectedSettings.serverPort,
        autoConnect: protectedSettings.autoConnect,
        apiUrl: protectedSettings.apiUrl,
        useForge: true,
        forgeBuild: DEFAULT_FORGE_BUILD
      });
    }
    sessionStore.clearFile();
    return { ...settings, apiUrl: apiBase() };
  });

  handle('dialog:selectDirectory', async (options = {}) => {
    const title = typeof options.title === 'string' ? options.title.slice(0, 100) : 'Choisir un dossier';
    const result = await dialog.showOpenDialog(mainWindow, {
      title,
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: options.defaultPath && path.isAbsolute(options.defaultPath) ? options.defaultPath : undefined
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  handle('dialog:selectJava', async (options = {}) => {
    const title = typeof options.title === 'string' ? options.title.slice(0, 100) : 'Choisir Java';
    const defaultPath =
      options.defaultPath && path.isAbsolute(options.defaultPath) ? options.defaultPath : undefined;
    const result = await dialog.showOpenDialog(mainWindow, {
      title,
      properties: ['openFile'],
      defaultPath,
      filters:
        process.platform === 'win32'
          ? [{ name: 'Java', extensions: ['exe'] }]
          : [{ name: 'Tous les fichiers', extensions: ['*'] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  handle('game:launch', async () => {
    await minecraft.launch();
    return { started: true };
  });

  handle('game:state', async () => minecraft.getState());

  handle('game:openFolder', async () => {
    const settings = settingsStore.get();
    const directory = minecraft.resolveGameDir(settings);
    const error = await shell.openPath(directory);
    if (error) throw new Error(`Impossible d’ouvrir le dossier: ${error}`);
    return true;
  });

  handle('game:openLogs', async () => {
    const error = await shell.openPath(logger.directory);
    if (error) throw new Error(`Impossible d’ouvrir les logs: ${error}`);
    return true;
  });

  handle('app:openExternal', async (url) => {
    const target = assertString(url, 'Lien', 2048);
    const allowed = openExternal(target);
    if (!allowed) throw new Error('Lien non autorisé.');
    return true;
  });

  handle('app:testApi', async (url) => {
    const started = Date.now();
    const data = await api.health(url);
    return { latency: Date.now() - started, version: data?.version || null };
  });

  handle('window:minimize', async () => {
    mainWindow?.minimize();
    return true;
  });
  handle('window:toggleMaximize', async () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  handle('window:close', async () => {
    mainWindow?.close();
    return true;
  });
}

function openExternal(url) {
  try {
    const parsed = new URL(String(url));
    if (!['https:', 'http:', 'mailto:'].includes(parsed.protocol)) return false;
    if (String(url).length > 2048) return false;
    shell.openExternal(parsed.toString());
    return true;
  } catch {
    return false;
  }
}

process.on('warning', (warning) => {
  logger?.warn(`Avertissement Node: ${warning.message}`);
});
