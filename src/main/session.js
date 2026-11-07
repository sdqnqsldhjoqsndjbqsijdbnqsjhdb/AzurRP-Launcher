'use strict';

const fs = require('node:fs');
const path = require('node:path');

class SessionStore {
  constructor(filePath, { safeStorage = null, logger = null } = {}) {
    this.filePath = filePath;
    this.safeStorage = safeStorage;
    this.logger = logger;
    this.current = null;
    this.warnedPlaintext = false;
  }

  encryptionAvailable() {
    try {
      return Boolean(this.safeStorage?.isEncryptionAvailable());
    } catch {
      return false;
    }
  }

  load() {
    try {
      if (!fs.existsSync(this.filePath)) return null;
      const envelope = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!envelope || envelope.v !== 1 || typeof envelope.payload !== 'string') return null;
      let json;
      if (envelope.mode === 'safe') {
        if (!this.encryptionAvailable()) {
          this.logger?.warn('Session chiffrée présente mais le trousseau système est indisponible.');
          return null;
        }
        json = this.safeStorage.decryptString(Buffer.from(envelope.payload, 'base64'));
      } else if (envelope.mode === 'plain') {
        json = Buffer.from(envelope.payload, 'base64').toString('utf8');
      } else {
        return null;
      }
      const session = JSON.parse(json);
      if (!session || typeof session.token !== 'string' || !session.user?.username) return null;
      this.current = session;
      return this.publicSession(session);
    } catch (error) {
      this.logger?.warn(`Session illisible: ${error.message}`);
      return null;
    }
  }

  publicSession(session = this.current) {
    if (!session) return null;
    return {
      user: session.user,
      expiresAt: session.expiresAt || null
    };
  }

  set(session, persist = true) {
    this.current = session;
    if (!persist) {
      this.clearFile();
      return;
    }
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const json = JSON.stringify(session);
      let envelope;
      if (this.encryptionAvailable()) {
        envelope = {
          v: 1,
          mode: 'safe',
          payload: this.safeStorage.encryptString(json).toString('base64')
        };
      } else {
        if (!this.warnedPlaintext) {
          this.logger?.warn('Trousseau système indisponible : session stockée sans chiffrement local.');
          this.warnedPlaintext = true;
        }
        envelope = { v: 1, mode: 'plain', payload: Buffer.from(json, 'utf8').toString('base64') };
      }
      const temp = `${this.filePath}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(envelope), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temp, this.filePath);
    } catch (error) {
      this.logger?.error(`Impossible d’enregistrer la session: ${error.message}`);
    }
  }

  clear() {
    this.current = null;
    this.clearFile();
  }

  clearFile() {
    try {
      fs.rmSync(this.filePath, { force: true });
    } catch {
      // Ignoré volontairement.
    }
  }
}

module.exports = { SessionStore };
