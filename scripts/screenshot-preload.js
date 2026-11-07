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
  serverPort: 25565,
  autoConnect: true,
  useForge: true,
  forgeBuild: '14.23.5.2860',
  gameDir: 'C:\\Users\\Nova\\AppData\\Roaming\\AzurRP\\minecraft',
  javaPath: '',
  apiUrl: 'http://127.0.0.1:3000',
  minimizeOnLaunch: true,
  rememberSession: true
};

const user = {
  id: 1,
  username: 'Nova',
  email: 'nova@azurrp.fr',
  role: 'admin',
  createdAt: '2026-01-18T10:24:00.000Z'
};

const news = [
  {
    id: 'festival-lanternes',
    title: 'Le Festival des Lumières illumine le centre-ville',
    excerpt:
      'Trois soirées de concerts, de food trucks et d’installations lumineuses sur l’avenue centrale. La ville ne dormira pas.',
    tag: 'Événement',
    image: 'news-festival.svg',
    publishedAt: '2026-10-28T18:00:00.000Z'
  },
  {
    id: 'marche-suspendu',
    title: 'Le marché nocturne s’installe sur l’avenue',
    excerpt:
      'Artisans, producteurs et commerçants prennent possession du centre-ville à la tombée de la nuit. Un nouvel espace pour l’économie locale.',
    tag: 'Économie',
    image: 'news-market.svg',
    publishedAt: '2026-10-21T16:30:00.000Z'
  },
  {
    id: 'archives-azur',
    title: 'Le quartier d’affaires ouvre ses portes',
    excerpt:
      'Bureaux, commerces et résidences haut de gamme : le nouveau quartier d’affaires d’AzurRP accueille ses premiers habitants et entreprises.',
    tag: 'Ville',
    image: 'news-lore.svg',
    publishedAt: '2026-10-14T12:00:00.000Z'
  }
];

const server = {
  online: true,
  host: 'play.azur-rp.eu',
  port: 25565,
  players: { online: 42, max: 120 },
  ping: 34,
  version: '1.12.2',
  motd: 'AzurRP — Modern RP'
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
        discord: 'https://discord.gg/azurrp',
        website: 'https://azurrp.fr',
        rules: 'https://azurrp.fr/reglement',
        map: 'https://azurrp.fr/carte'
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
