'use strict';

const { status: ping } = require('minecraft-server-util');

class ServerStatusService {
  constructor({ settingsStore, logger }) {
    this.settingsStore = settingsStore;
    this.logger = logger;
    this.cache = null;
  }

  async get(force = false) {
    const settings = this.settingsStore.get();
    const host = settings.serverHost;
    const port = settings.serverPort;
    const key = `${host}:${port}`;
    const now = Date.now();

    if (!force && this.cache && this.cache.key === key && this.cache.expiresAt > now) {
      return this.cache.value;
    }

    let value;
    try {
      const response = await ping(host, port, { timeout: 4500, enableSRV: true });
      value = {
        online: true,
        host,
        port,
        players: {
          online: response.players.online,
          max: response.players.max
        },
        version: response.version.name,
        motd: response.motd.clean,
        ping: Math.max(0, Math.round(response.roundTripLatency)),
        checkedAt: new Date().toISOString()
      };
    } catch (error) {
      this.logger?.debug(`Statut serveur indisponible (${key}): ${error.message}`);
      value = {
        online: false,
        host,
        port,
        players: null,
        version: null,
        motd: null,
        ping: null,
        error: 'Serveur injoignable pour le moment.',
        checkedAt: new Date().toISOString()
      };
    }

    this.cache = {
      key,
      value,
      expiresAt: now + (value.online ? 30000 : 10000)
    };
    return value;
  }
}

module.exports = { ServerStatusService };
