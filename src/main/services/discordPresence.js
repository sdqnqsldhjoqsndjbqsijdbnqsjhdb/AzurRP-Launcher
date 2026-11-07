'use strict';

const RPC = require('discord-rpc');

const BUILD_CLIENT_ID =
  typeof __AZURRP_DISCORD_CLIENT_ID__ === 'string' ? __AZURRP_DISCORD_CLIENT_ID__.trim() : '';
const CLIENT_ID = process.env.AZURRP_DISCORD_CLIENT_ID || BUILD_CLIENT_ID || '1468926076569780285';

class DiscordPresence {
  constructor({ logger }) {
    this.logger = logger;
    this.client = null;
    this.connected = false;
    this.active = false;
    this.timer = null;
    this.details = 'Dans le launcher';
  }

  start() {
    if (!CLIENT_ID || this.client || this.timer) return;
    const client = new RPC.Client({ transport: 'ipc' });
    this.client = client;
    client.on('ready', () => {
      if (this.client !== client) return;
      this.connected = true;
      this.publish();
      this.logger?.info('Discord Rich Presence connecté.');
    });
    client.on('disconnected', () => {
      this.connected = false;
      if (this.client === client) this.client = null;
      this.logger?.warn('Discord Rich Presence déconnecté.');
      client.destroy().catch(() => {});
      this.scheduleRetry();
    });
    client.login({ clientId: CLIENT_ID }).catch((error) => {
      if (this.client !== client) return;
      this.logger?.warn(`Discord Rich Presence indisponible: ${error.message}`);
      this.client = null;
      client.destroy().catch(() => {});
      this.scheduleRetry();
    });
  }

  scheduleRetry() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.start();
    }, 10000);
    this.timer.unref?.();
  }

  setGameState(active, details = 'Dans le serveur AzurRP') {
    this.active = Boolean(active);
    this.details = details;
    this.publish();
  }

  publish() {
    if (!this.connected || !this.client) return;
    const presence = this.active
      ? { details: 'Joue à AzurRP', state: this.details, startTimestamp: Date.now() }
      : { details: 'Dans le launcher', state: 'AzurRP' };
    this.client.setActivity(presence).catch((error) => {
      this.logger?.warn(`Mise à jour Discord Rich Presence impossible: ${error.message}`);
    });
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.client) return;
    this.client.clearActivity().catch(() => {});
    this.client.destroy().catch(() => {});
    this.client = null;
    this.connected = false;
  }
}

module.exports = { DiscordPresence };
