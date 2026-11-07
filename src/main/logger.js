'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function sanitize(value) {
  let text = String(value ?? '');
  text = text.replace(/(--accessToken\s+)(\S+)/gi, '$1********');
  text = text.replace(/(--clientToken\s+)(\S+)/gi, '$1********');
  text = text.replace(/(--session\s+)(\S+)/gi, '$1********');
  text = text.replace(/(Bearer\s+)([A-Za-z0-9._-]+)/gi, '$1********');
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  return text.length > 6000 ? `${text.slice(0, 6000)}…` : text;
}

class Logger {
  constructor(directory, { dev = false } = {}) {
    this.directory = directory;
    this.dev = dev;
    this.minLevel = dev ? LEVELS.debug : LEVELS.info;
    fs.mkdirSync(directory, { recursive: true });
    this.cleanup();
    this.file = path.join(directory, `launcher-${new Date().toISOString().slice(0, 10)}.log`);
  }

  cleanup() {
    try {
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      for (const name of fs.readdirSync(this.directory)) {
        if (!/^(launcher|minecraft)-.*\.log$/.test(name)) continue;
        const fullPath = path.join(this.directory, name);
        if (fs.statSync(fullPath).mtimeMs < cutoff) fs.rmSync(fullPath, { force: true });
      }
    } catch {
      // Le nettoyage ne doit jamais empêcher le launcher de démarrer.
    }
  }

  log(level, message) {
    if ((LEVELS[level] ?? 100) < this.minLevel) return;
    const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${sanitize(message)}`;
    if (this.dev) {
      const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
      console[method](line);
    }
    try {
      fs.appendFileSync(this.file, `${line}\n`, 'utf8');
    } catch {
      // Écriture best-effort uniquement.
    }
  }

  debug(message) { this.log('debug', message); }
  info(message) { this.log('info', message); }
  warn(message) { this.log('warn', message); }
  error(message) { this.log('error', message); }

  createGameLog() {
    const file = path.join(this.directory, `minecraft-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
    return fs.createWriteStream(file, { flags: 'a', encoding: 'utf8' });
  }
}

module.exports = { Logger, sanitize };
