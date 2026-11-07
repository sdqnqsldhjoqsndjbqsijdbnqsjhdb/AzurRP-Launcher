'use strict';

const crypto = require('node:crypto');

/**
 * Reproduit l'UUID hors-ligne utilisé par Minecraft : MD5 de "OfflinePlayer:<pseudo>",
 * avec les bits de version/variante forcés en UUID v3.
 * Retourne la forme sans tirets, celle attendue par les arguments de jeu.
 */
function offlineUuid(username) {
  if (typeof username !== 'string' || !username) throw new Error('Pseudo invalide.');
  const hash = crypto.createHash('md5').update(`OfflinePlayer:${username}`, 'utf8').digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  return hash.toString('hex');
}

function dashedUuid(uuid) {
  return `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`;
}

module.exports = { offlineUuid, dashedUuid };
