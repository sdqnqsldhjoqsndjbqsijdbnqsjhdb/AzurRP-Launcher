'use strict';

const APP_ID = 'fr.azurrp.launcher';
const APP_NAME = 'AzurRP';

// Constantes remplacées par esbuild au moment du build (voir scripts/build.mjs).
// En développement, elles valent une chaîne vide : les valeurs locales servent
// alors de repli. `typeof` protège les tests Node qui importent ce fichier.
const BUILD_API_URL = typeof __AZURRP_BUILD_API_URL__ === 'string' ? __AZURRP_BUILD_API_URL__.trim() : '';
const BUILD_SERVER_HOST =
  typeof __AZURRP_BUILD_SERVER_HOST__ === 'string' ? __AZURRP_BUILD_SERVER_HOST__.trim() : '';

const DEFAULT_API_URL = BUILD_API_URL || 'https://api.azur-rp.eu';
const DEFAULT_SERVER_HOST = BUILD_SERVER_HOST || 'play.azur-rp.eu';
const DEFAULT_SERVER_PORT = 22459;
const DEFAULT_FORGE_BUILD = '1.12.2-14.23.5.2860';
const MINECRAFT_VERSION = '1.12.2';

function defaultSettings(gameDir = '') {
  return {
    apiUrl: process.env.AZURRP_API_URL || DEFAULT_API_URL,
    gameDir,
    memoryMinMb: 1024,
    memoryMaxMb: 4096,
    javaPath: '',
    resolution: {
      width: 1280,
      height: 720,
      fullscreen: false
    },
    minimizeOnLaunch: true,
    autoConnect: true,
    useForge: true,
    forgeBuild: DEFAULT_FORGE_BUILD,
    serverHost: process.env.AZURRP_SERVER_HOST || DEFAULT_SERVER_HOST,
    serverPort: Number(process.env.AZURRP_SERVER_PORT) || DEFAULT_SERVER_PORT,
    rememberSession: true
  };
}

function normalizeApiUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('URL de l’API vide.');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('URL de l’API invalide.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('L’API doit utiliser HTTP ou HTTPS.');
  }
  if (url.username || url.password) {
    throw new Error('L’URL de l’API ne doit pas contenir d’identifiants.');
  }
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/+$/, '');
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} invalide.`);
  }
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function cleanString(value, fallback, maxLength) {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, maxLength);
}

function validateSettings(input, { base = defaultSettings(), totalMemoryMb = 32768 } = {}) {
  assertPlainObject(input, 'Configuration');
  const next = structuredClone(base);
  const hardMaxRam = Math.max(1024, Math.min(32768, totalMemoryMb - 1024));

  if (Object.hasOwn(input, 'apiUrl')) next.apiUrl = normalizeApiUrl(input.apiUrl);
  if (Object.hasOwn(input, 'gameDir')) next.gameDir = cleanString(input.gameDir, next.gameDir, 1024);
  if (Object.hasOwn(input, 'javaPath')) next.javaPath = cleanString(input.javaPath, next.javaPath, 1024);

  if (Object.hasOwn(input, 'memoryMinMb')) {
    next.memoryMinMb = clampInt(input.memoryMinMb, next.memoryMinMb, 512, hardMaxRam);
  }
  if (Object.hasOwn(input, 'memoryMaxMb')) {
    next.memoryMaxMb = clampInt(input.memoryMaxMb, next.memoryMaxMb, 1024, hardMaxRam);
  }
  if (next.memoryMinMb > next.memoryMaxMb) next.memoryMinMb = next.memoryMaxMb;

  if (Object.hasOwn(input, 'resolution')) {
    assertPlainObject(input.resolution, 'Résolution');
    next.resolution = {
      width: clampInt(input.resolution.width, next.resolution.width, 640, 7680),
      height: clampInt(input.resolution.height, next.resolution.height, 480, 4320),
      fullscreen: Boolean(input.resolution.fullscreen)
    };
  }

  for (const key of ['minimizeOnLaunch', 'autoConnect', 'useForge', 'rememberSession']) {
    if (Object.hasOwn(input, key)) next[key] = Boolean(input[key]);
  }

  if (Object.hasOwn(input, 'forgeBuild')) {
    const build = cleanString(input.forgeBuild, next.forgeBuild, 32);
    if (!/^(latest|recommended|[0-9][A-Za-z0-9._-]*)$/.test(build)) {
      throw new Error('Version de Forge invalide.');
    }
    next.forgeBuild = build;
  }

  if (Object.hasOwn(input, 'serverHost')) {
    const host = cleanString(input.serverHost, next.serverHost, 253).replace(/^minecraft:\/\//i, '');
    const label = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?';
    if (!new RegExp(`^${label}(?:\\.${label})*$`).test(host)) {
      throw new Error('Adresse du serveur invalide.');
    }
    next.serverHost = host;
  }
  if (Object.hasOwn(input, 'serverPort')) {
    next.serverPort = clampInt(input.serverPort, next.serverPort, 1, 65535);
  }

  if (!next.useForge) next.forgeBuild = DEFAULT_FORGE_BUILD;
  return next;
}

module.exports = {
  APP_ID,
  APP_NAME,
  DEFAULT_API_URL,
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
  DEFAULT_FORGE_BUILD,
  MINECRAFT_VERSION,
  defaultSettings,
  normalizeApiUrl,
  validateSettings
};
