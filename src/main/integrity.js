'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

async function verifyIntegrity(distDirectory, logger) {
  const manifestPath = path.join(distDirectory, 'integrity.json');
  if (!fs.existsSync(manifestPath)) {
    logger?.warn('Manifeste d’intégrité absent.');
    return false;
  }

  let manifest;
  try {
    manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  } catch (error) {
    logger?.error(`Manifeste d’intégrité illisible: ${error.message}`);
    return false;
  }

  for (const [relative, expected] of Object.entries(manifest)) {
    const file = path.join(distDirectory, relative);
    try {
      const content = await fsp.readFile(file);
      const actual = createHash('sha256').update(content).digest('hex');
      if (actual !== expected) {
        logger?.error(`Fichier modifié : ${relative}`);
        return false;
      }
    } catch (error) {
      logger?.error(`Fichier manquant : ${relative} (${error.message})`);
      return false;
    }
  }
  return true;
}

module.exports = { verifyIntegrity };
