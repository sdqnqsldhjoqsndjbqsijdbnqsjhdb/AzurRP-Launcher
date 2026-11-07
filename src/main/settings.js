'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { defaultSettings, validateSettings } = require('./config');

class SettingsStore {
  constructor(filePath, { gameDir = '', logger = null } = {}) {
    this.filePath = filePath;
    this.logger = logger;
    this.defaults = defaultSettings(gameDir);
    this.value = this.load();
  }

  totalMemoryMb() {
    return Math.max(1024, Math.floor(os.totalmem() / 1024 / 1024));
  }

  load() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      if (!fs.existsSync(this.filePath)) {
        const fresh = structuredClone(this.defaults);
        this.write(fresh);
        return fresh;
      }
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return validateSettings(parsed, {
        base: this.defaults,
        totalMemoryMb: this.totalMemoryMb()
      });
    } catch (error) {
      this.logger?.warn(`Configuration illisible, réinitialisation: ${error.message}`);
      this.backupCorruptFile();
      const fresh = structuredClone(this.defaults);
      try {
        this.write(fresh);
      } catch {
        // Le prochain enregistrement retentera.
      }
      return fresh;
    }
  }

  backupCorruptFile() {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const backup = `${this.filePath}.corrupt-${Date.now()}`;
      fs.renameSync(this.filePath, backup);
    } catch {
      // Rien de plus à faire : on ne veut jamais bloquer le launcher ici.
    }
  }

  get() {
    return structuredClone(this.value);
  }

  update(patch) {
    const next = validateSettings(patch, {
      base: this.value,
      totalMemoryMb: this.totalMemoryMb()
    });
    this.write(next);
    this.value = next;
    return this.get();
  }

  reset() {
    const next = structuredClone(this.defaults);
    this.write(next);
    this.value = next;
    return this.get();
  }

  write(value) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tempFile = `${this.filePath}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempFile, this.filePath);
  }
}

module.exports = { SettingsStore };
