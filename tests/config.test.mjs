import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  DEFAULT_SERVER_HOST,
  defaultSettings,
  normalizeApiUrl,
  validateSettings
} = require('../src/main/config.js');

test('normalizeApiUrl nettoie l’URL de l’API', () => {
  assert.equal(normalizeApiUrl('http://127.0.0.1:3000/'), 'http://127.0.0.1:3000');
  assert.equal(normalizeApiUrl('https://api.azur-rp.eu///?x=1#top'), 'https://api.azur-rp.eu');
  assert.equal(normalizeApiUrl('  https://api.azur-rp.eu  '), 'https://api.azur-rp.eu');
});

test('normalizeApiUrl rejette les schémas et identifiants dangereux', () => {
  for (const value of ['', 'ftp://azur-rp.eu', 'file:///etc/passwd', 'javascript:alert(1)']) {
    assert.throws(() => normalizeApiUrl(value), /API/);
  }
  assert.throws(() => normalizeApiUrl('https://user:pass@azur-rp.eu'), /identifiants/);
});

test('les paramètres par défaut ciblent le serveur AzurRP', () => {
  const settings = defaultSettings();
  assert.equal(settings.serverHost, DEFAULT_SERVER_HOST);
  assert.equal(settings.serverHost, 'play.azur-rp.eu');
  assert.equal(settings.serverPort, 25565);
  assert.equal(settings.memoryMaxMb, 4096);
});

test('validateSettings borne la mémoire et conserve les valeurs valides', () => {
  const settings = validateSettings(
    { memoryMinMb: 512, memoryMaxMb: 8192, memoryMinMb2: 0 },
    { totalMemoryMb: 16384 }
  );
  assert.equal(settings.memoryMaxMb, 8192);
  assert.equal(settings.memoryMinMb, 512);

  const clamped = validateSettings({ memoryMaxMb: 999999 }, { totalMemoryMb: 8192 });
  assert.equal(clamped.memoryMaxMb, 7168);

  const minimum = validateSettings({ memoryMaxMb: 1 }, { totalMemoryMb: 16384 });
  assert.equal(minimum.memoryMaxMb, 1024);
});

test('validateSettings maintient mémoire min ≤ mémoire max', () => {
  const settings = validateSettings({ memoryMinMb: 8192, memoryMaxMb: 2048 });
  assert.equal(settings.memoryMinMb, 2048);
});

test('validateSettings rejette les adresses serveur invalides', () => {
  for (const host of ['', 'http://azur-rp.eu', 'azur rp', '-azur-rp.eu', 'azur-rp..eu']) {
    assert.throws(() => validateSettings({ serverHost: host }), /serveur/);
  }
  const settings = validateSettings({ serverHost: 'minecraft://play.azur-rp.eu' });
  assert.equal(settings.serverHost, 'play.azur-rp.eu');
});

test('validateSettings valide la résolution et la version de Forge', () => {
  const settings = validateSettings({
    resolution: { width: 100, height: 99999, fullscreen: true },
    forgeBuild: '14.23.5.2860'
  });
  assert.equal(settings.resolution.width, 640);
  assert.equal(settings.resolution.height, 4320);
  assert.equal(settings.resolution.fullscreen, true);

  assert.throws(() => validateSettings({ forgeBuild: '../evil' }), /Forge/);
});

test('désactiver Forge restaure la version par défaut', () => {
  const settings = validateSettings({ useForge: false, forgeBuild: '14.23.5.2859' });
  assert.equal(settings.useForge, false);
  assert.equal(settings.forgeBuild, '14.23.5.2860');
});

test('validateSettings refuse un objet non structuré', () => {
  assert.throws(() => validateSettings(null), /Configuration/);
  assert.throws(() => validateSettings([]), /Configuration/);
  assert.throws(() => validateSettings('x'), /Configuration/);
});
