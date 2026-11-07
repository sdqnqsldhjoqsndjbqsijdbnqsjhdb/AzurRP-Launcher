'use strict';

/* Pont de démonstration utilisé uniquement par scripts/screenshot.js.
   Il remplace l'API IPC réelle pour produire des captures sans serveur. */

const { contextBridge } = require('electron');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const settings = {
  memoryMaxMb: 4096,
  memoryMinMb: 1024,
  resolution: { width: 1280, height: 720, fullscreen: false },
  serverHost: 'play.azur-rp.eu',
  serverPort: 22459,
  autoConnect: true,
  useForge: true,
  forgeBuild: '1.12.2-14.23.5.2860',
  gameDir: 'C:\\Users\\Nova\\AppData\\Roaming\\AzurRP\\minecraft',
  javaPath: '',
  apiUrl: 'https://api.azur-rp.eu',
  minimizeOnLaunch: true,
  rememberSession: true
};

const user = {
  id: 1,
  username: 'Draco',
  email: 'dracomc-off@proton.me',
  role: 'admin',
  createdAt: '2026-01-18T10:24:00.000Z'
};

const news = [];

const server = {
  online: true,
  host: 'play.azur-rp.eu',
  port: 22459,
  players: { online: 0, max: 20 },
  ping: 20,
  version: '1.12.2',
  motd: 'A Minecraft Server'
};

contextBridge.exposeInMainWorld('azur', {
  bootstrap: async () => {
    await delay(1200);
    return {
      session: null,
      offline: false,
      expired: false,
      settings,
      system: {
        platform: 'win32',
        arch: 'x64',
        release: '10.0.22631',
        cpus: 16,
        totalMemoryMb: 32768,
        freeMemoryMb: 18432,
        appVersion: '1.0.0',
        minecraftVersion: '1.12.2',
        electron: '39.8.10',
        chrome: '142.0.0.0',
        node: '20.20.2',
        defaultGameDir: settings.gameDir,
        gameDir: settings.gameDir,
        logsDir: 'C:\\Users\\Aventurier\\AppData\\Roaming\\AzurRP\\logs',
        apiUrl: settings.apiUrl
      },
      game: { status: 'idle' }
    };
  },

  auth: {
    login: async () => ({ session: { user, expiresAt: '2026-12-04T00:00:00.000Z' }, user }),
    register: async () => ({ session: { user, expiresAt: '2026-12-04T00:00:00.000Z' }, user }),
    logout: async () => true
  },

  content: {
    get: async () => ({
      news,
      links: {
        discord: 'https://discord.azur-rp.eu',
        website: 'https://azur-rp.eu',
        rules: 'https://azur-rp.eu/reglement',
        map: 'https://azur-rp.eu/carte'
      },
      announcement: null,
      offline: false
    })
  },

  server: {
    status: async () => server
  },

  settings: {
    save: async (patch) => Object.assign(settings, patch),
    reset: async () => settings
  },

  system: {
    info: async () => ({}),
    detectJava: async () => ({ best: { major: 8, vendor: 'Temurin', path: 'C:\\Program Files\\Java\\jre1.8\\bin\\java.exe' } })
  },

  dialog: {
    selectDirectory: async () => null,
    selectJava: async () => null
  },

  game: {
    launch: async () => ({ started: true }),
    state: async () => ({ status: 'idle' }),
    openFolder: async () => true,
    openLogs: async () => true,
    onEvent: () => () => {}
  },

  app: {
    openExternal: async () => true,
    testApi: async () => ({ latency: 24, version: '1.0.0' })
  },

  window: {
    minimize: async () => true,
    toggleMaximize: async () => false,
    close: async () => true,
    onMaximized: () => () => {}
  }
});
