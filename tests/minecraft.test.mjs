import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { offlineUuid } = require('../src/main/utils/offlineUuid.js');

/* Remplace minecraft-java-core par un faux lanceur avant de charger le service. */
let lastOptions = null;
class FakeLaunch extends EventEmitter {
  async Launch(options) {
    lastOptions = options;
    this.emit('data', '[12:00:00] [Client thread/INFO]: Setting user: Aventurier\n');
    this.emit('data', '[12:00:00] [Client thread/INFO]: Done (3,214s)!\n');
    this.emit('close', 0);
  }
}

const mjcEntry = require.resolve('minecraft-java-core');
require.cache[mjcEntry] = {
  id: mjcEntry,
  filename: mjcEntry,
  loaded: true,
  exports: { Launch: FakeLaunch }
};

const { MinecraftManager } = require('../src/main/services/minecraft.js');

function makeLogger() {
  const lines = [];
  return {
    lines,
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    createGameLog: () => ({
      write: (line) => lines.push(line.trimEnd()),
      end: () => {}
    })
  };
}

function makeManager(overrides = {}) {
  const gameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'azurrp-mc-'));
  const settings = {
    gameDir,
    javaPath: '',
    memoryMinMb: 1024,
    memoryMaxMb: 4096,
    resolution: { width: 1280, height: 720, fullscreen: false },
    autoConnect: true,
    serverHost: 'play.azur-rp.eu',
    serverPort: 25565,
    useForge: true,
    forgeBuild: '14.23.5.2860',
    ...overrides
  };
  const events = [];
  const logger = makeLogger();
  const manager = new MinecraftManager({
    settingsStore: { get: () => ({ ...settings }) },
    logger,
    defaultGameDir: gameDir,
    getUser: () => ({ username: 'Aventurier' }),
    resolveJavaImpl: async () => 'java-test',
    emit: (event) => events.push(event)
  });
  return { manager, events, gameDir, logger };
}

test('buildProfile construit un profil hors-ligne cohérent', () => {
  const { manager } = makeManager();
  const profile = manager.buildProfile('Aventurier');
  assert.equal(profile.name, 'Aventurier');
  assert.equal(profile.uuid, offlineUuid('Aventurier'));
  assert.equal(profile.user_properties, '{}');
  assert.equal(profile.meta.type, 'mojang');
  assert.match(profile.access_token, /^[0-9a-f]{48}$/);
  assert.throws(() => manager.buildProfile('pseudo invalide'), /invalide/);
});

test('launch transmet les options attendues à minecraft-java-core', async () => {
  const { manager, events, gameDir } = makeManager();
  await manager.launch();

  assert.ok(lastOptions, 'le lanceur doit être appelé');
  assert.equal(lastOptions.path, gameDir);
  assert.equal(lastOptions.version, '1.12.2');
  assert.equal(lastOptions.bypassOffline, true);
  assert.equal(lastOptions.authenticator.name, 'Aventurier');
  assert.deepEqual(lastOptions.loader.enable, true);
  assert.equal(lastOptions.loader.type, 'forge');
  assert.equal(lastOptions.loader.build, '1.12.2-14.23.5.2860');
  assert.equal(lastOptions.loader.path, 'loader');
  assert.deepEqual(lastOptions.GAME_ARGS, [
    '--server',
    'play.azur-rp.eu',
    '--port',
    '25565'
  ]);
  assert.equal(lastOptions.memory.max, '4096M');
  assert.equal(lastOptions.screen.width, 1280);

  assert.ok(events.some((event) => event.type === 'spawned'));
  assert.ok(events.some((event) => event.type === 'closed'));
  assert.equal(manager.getState().status, 'idle');
});

test('launch démarre réellement le jeu sans télécharger quand Java est fourni', async () => {
  const { manager, events } = makeManager();
  await manager.launch();
  const running = events.find((event) => event.type === 'state' && event.state.status === 'running');
  assert.ok(running, 'état « running » émis');
});

test('launch refuse un lancement sans utilisateur connecté', async () => {
  const { manager } = makeManager();
  const broken = new MinecraftManager({
    settingsStore: { get: () => ({ gameDir: os.tmpdir() }) },
    logger: makeLogger(),
    defaultGameDir: os.tmpdir(),
    getUser: () => null,
    emit: () => {}
  });
  await assert.rejects(() => broken.launch(), /Connecte-toi/);
  assert.equal(manager.getState().status, 'idle');
});

test('launch refuse un dossier de jeu relatif', async () => {
  const { manager } = makeManager({ gameDir: 'relative/path' });
  await assert.rejects(() => manager.launch(), /absolu/);
});

test('les arguments de jeu respectent les réglages', async () => {
  const { manager } = makeManager({
    autoConnect: false,
    resolution: { width: 1920, height: 1080, fullscreen: true },
    useForge: false,
    memoryMinMb: 2048,
    memoryMaxMb: 6144
  });
  await manager.launch();
  assert.deepEqual(lastOptions.GAME_ARGS, ['--fullscreen']);
  assert.equal(lastOptions.loader.enable, false);
  assert.equal(lastOptions.loader.type, null);
  assert.equal(lastOptions.memory.min, '2048M');
  assert.equal(lastOptions.memory.max, '6144M');
});

test('les jetons sont masqués dans les logs', () => {
  const { manager } = makeManager();
  manager.profile = manager.buildProfile('Aventurier');
  const output = manager.redact(`--accessToken ${manager.profile.access_token} --clientToken ${manager.profile.client_token}`);
  assert.doesNotMatch(output, new RegExp(manager.profile.access_token));
  assert.doesNotMatch(output, new RegExp(manager.profile.client_token));
  assert.match(output, /--accessToken \*{8}/);
});
