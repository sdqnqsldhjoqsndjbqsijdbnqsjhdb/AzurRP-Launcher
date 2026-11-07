'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Launch } = require('minecraft-java-core');
const { offlineUuid } = require('../utils/offlineUuid');
const { MINECRAFT_VERSION } = require('../config');
const { resolveJava } = require('./java');
const { syncMods } = require('./mods');

const ANSI_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;

function cleanLine(value) {
  return String(value ?? '')
    .replace(ANSI_PATTERN, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .slice(0, 4000);
}

function errorMessage(error) {
  if (!error) return 'Erreur inconnue.';
  if (typeof error === 'string') return error;
  if (typeof error.error === 'string') return error.error;
  if (typeof error.message === 'string') return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Erreur inconnue.';
  }
}

class MinecraftManager {
  constructor({ settingsStore, logger, getUser, emit, defaultGameDir, getApiBase }) {
    this.settingsStore = settingsStore;
    this.logger = logger;
    this.getUser = getUser;
    this.emit = emit;
    this.defaultGameDir = defaultGameDir;
    this.getApiBase = getApiBase;
    this.launcher = null;
    this.finalized = true;
    this.logStream = null;
    this.logQueue = [];
    this.logTimer = null;
    this.lastProgressAt = 0;
    this.state = {
      status: 'idle',
      startedAt: null,
      lastError: null,
      version: MINECRAFT_VERSION
    };
  }

  getState() {
    return { ...this.state };
  }

  resolveGameDir(settings = this.settingsStore.get()) {
    const directory = settings.gameDir || this.defaultGameDir;
    if (!path.isAbsolute(directory)) {
      const error = new Error('Le dossier de jeu doit être un chemin absolu.');
      error.code = 'GAME_DIR_INVALID';
      throw error;
    }
    fs.mkdirSync(directory, { recursive: true });
    return directory;
  }

  buildProfile(username) {
    if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
      const error = new Error('Pseudo Minecraft invalide.');
      error.code = 'INVALID_USERNAME';
      throw error;
    }
    return {
      access_token: crypto.randomBytes(24).toString('hex'),
      client_token: crypto.randomBytes(24).toString('hex'),
      uuid: offlineUuid(username),
      name: username,
      user_properties: '{}',
      meta: { type: 'mojang', demo: false }
    };
  }

  redact(text) {
    let output = cleanLine(text);
    const profile = this.profile;
    if (profile) {
      for (const secret of [profile.access_token, profile.client_token]) {
        if (secret) output = output.split(secret).join('********');
      }
    }
    return output.replace(/(--accessToken\s+)(\S+)/gi, '$1********').replace(/(--clientToken\s+)(\S+)/gi, '$1********');
  }

  setState(patch) {
    this.state = { ...this.state, ...patch };
    this.emit({ type: 'state', state: this.getState() });
  }

  queueLog(chunk) {
    const text = this.redact(chunk);
    if (!text) return;
    for (const line of text.split(/\r?\n/)) {
      const clean = line.trimEnd();
      if (!clean) continue;
      this.logQueue.push(clean);
      if (this.logStream) {
        try {
          this.logStream.write(`${clean}\n`);
        } catch {
          // Le flux de log ne doit jamais interrompre le jeu.
        }
      }
    }
    if (this.logQueue.length > 600) this.logQueue.splice(0, this.logQueue.length - 600);
    if (this.logTimer) return;
    this.logTimer = setTimeout(() => {
      this.logTimer = null;
      const lines = this.logQueue.splice(0, this.logQueue.length);
      if (lines.length) this.emit({ type: 'log', lines });
    }, 120);
  }

  closeLogStream() {
    if (this.logTimer) {
      clearTimeout(this.logTimer);
      this.logTimer = null;
    }
    if (this.logQueue.length) {
      const lines = this.logQueue.splice(0, this.logQueue.length);
      this.emit({ type: 'log', lines });
    }
    if (this.logStream) {
      try {
        this.logStream.end();
      } catch {
        // Ignoré.
      }
      this.logStream = null;
    }
  }

  async launch() {
    if (!this.finalized || ['preparing', 'downloading', 'running'].includes(this.state.status)) {
      const error = new Error('Minecraft est déjà en cours de lancement.');
      error.code = 'GAME_ALREADY_RUNNING';
      throw error;
    }

    const user = this.getUser();
    if (!user) {
      const error = new Error('Connecte-toi avant de lancer Minecraft.');
      error.code = 'AUTH_REQUIRED';
      throw error;
    }

    const settings = this.settingsStore.get();
    const gameDir = this.resolveGameDir(settings);
    this.profile = this.buildProfile(user.username);
    this.finalized = false;
    this.lastProgressAt = 0;
    this.state = {
      status: 'preparing',
      startedAt: null,
      lastError: null,
      version: MINECRAFT_VERSION
    };
    this.emit({ type: 'state', state: this.getState() });
    this.emit({ type: 'phase', phase: 'preparing', message: 'Préparation du lancement…' });

    let javaPath = null;
    try {
      if (settings.useForge && this.getApiBase) {
        await syncMods({
          apiUrl: this.getApiBase(),
          gameDir,
          emit: this.emit,
          logger: this.logger
        });
      }
      javaPath = await resolveJava({ customPath: settings.javaPath, gameDir });
    } catch (error) {
      this.finalized = true;
      this.state = { ...this.state, status: 'idle', lastError: error.message };
      this.emit({ type: 'state', state: this.getState() });
      throw error;
    }

    if (!javaPath) {
      this.emit({
        type: 'phase',
        phase: 'java',
        message: 'Java 8 absent : téléchargement automatique d’un runtime compatible…'
      });
    }

    this.logStream = this.logger.createGameLog();
    this.logger.info(`Lancement de Minecraft ${MINECRAFT_VERSION} (Forge: ${settings.useForge ? settings.forgeBuild : 'non'}).`);

    const gameArgs = [];
    if (settings.resolution.fullscreen) gameArgs.push('--fullscreen');
    if (settings.autoConnect) {
      gameArgs.push('--server', settings.serverHost, '--port', String(settings.serverPort));
    }

    const options = {
      path: gameDir,
      version: MINECRAFT_VERSION,
      authenticator: this.profile,
      bypassOffline: true,
      intelEnabledMac: true,
      downloadFileMultiple: 8,
      timeout: 20000,
      detached: false,
      verify: false,
      memory: {
        min: `${Math.min(settings.memoryMinMb, settings.memoryMaxMb)}M`,
        max: `${settings.memoryMaxMb}M`
      },
      java: {
        path: javaPath,
        version: null,
        type: 'jre'
      },
      screen: {
        width: settings.resolution.width,
        height: settings.resolution.height,
        fullscreen: false
      },
      loader: {
        enable: settings.useForge,
        type: settings.useForge ? 'forge' : null,
        build: settings.forgeBuild,
        path: path.join(gameDir, 'loader')
      },
      GAME_ARGS: gameArgs
    };

    const launcher = new Launch();
    this.launcher = launcher;

    launcher.on('progress', (downloaded, total, element) => {
      if (this.finalized) return;
      const size = Number(total) || 0;
      const current = Number(downloaded) || 0;
      const percent = size > 0 ? Math.max(0, Math.min(99.5, (current / size) * 100)) : null;
      const now = Date.now();
      if (now - this.lastProgressAt < 120 && percent !== null && percent < 99) return;
      this.lastProgressAt = now;
      if (this.state.status !== 'downloading') this.setState({ status: 'downloading' });
      let detail = '';
      if (element) {
        try {
          detail = path.basename(String(element));
        } catch {
          detail = String(element);
        }
      }
      this.emit({ type: 'progress', phase: 'download', percent, detail });
    });

    launcher.on('check', (downloaded, total, element) => {
      if (this.finalized) return;
      const size = Number(total) || 0;
      const percent = size > 0 ? Math.min(99.5, (Number(downloaded) / size) * 100) : null;
      this.emit({ type: 'progress', phase: 'verify', percent, detail: element ? String(element) : '' });
    });

    launcher.on('speed', (speed) => {
      if (!this.finalized) this.emit({ type: 'speed', speed: Number(speed) || 0 });
    });

    launcher.on('estimated', (seconds) => {
      if (!this.finalized) this.emit({ type: 'estimated', seconds: Number(seconds) || 0 });
    });

    launcher.on('extract', (element) => {
      if (this.finalized) return;
      this.emit({ type: 'phase', phase: 'extract', message: `Extraction : ${cleanLine(element)}` });
    });

    launcher.on('patch', (message) => {
      if (this.finalized) return;
      this.emit({ type: 'phase', phase: 'loader', message: cleanLine(message) });
    });

    launcher.on('data', (chunk) => {
      if (this.finalized) return;
      if (this.state.status !== 'running') {
        this.setState({ status: 'running', startedAt: Date.now() });
        this.emit({ type: 'phase', phase: 'running', message: 'Minecraft est lancé. Bon jeu !' });
        this.emit({ type: 'spawned' });
      }
      this.queueLog(chunk);
    });

    launcher.on('error', (error) => {
      if (this.finalized) {
        this.queueLog(`Erreur après lancement : ${errorMessage(error)}`);
        return;
      }
      const message = errorMessage(error);
      this.logger.error(`Erreur Minecraft: ${message}`);
      this.finalized = true;
      this.closeLogStream();
      this.setState({ status: 'idle', startedAt: null, lastError: message });
      this.emit({ type: 'error', message });
      this.emit({ type: 'failed', message });
    });

    launcher.on('close', (code) => {
      if (this.finalized) return;
      this.finalized = true;
      this.closeLogStream();
      this.setState({ status: 'idle', startedAt: null });
      this.logger.info(`Minecraft fermé (code ${code}).`);
      this.emit({ type: 'closed', code: Number(code) || 0 });
    });

    try {
      await launcher.Launch(options);
    } catch (error) {
      if (this.finalized) return;
      const message = errorMessage(error);
      this.logger.error(`Impossible de lancer Minecraft: ${message}`);
      this.finalized = true;
      this.closeLogStream();
      this.setState({ status: 'idle', startedAt: null, lastError: message });
      this.emit({ type: 'error', message });
      this.emit({ type: 'failed', message });
      throw error;
    }
  }
}

module.exports = { MinecraftManager };
