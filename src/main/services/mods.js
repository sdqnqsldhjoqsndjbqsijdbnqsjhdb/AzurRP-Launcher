'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const yauzl = require('yauzl');
const { normalizeApiUrl } = require('../config');

const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_MOD_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_MOD_BYTES = 1024 * 1024 * 1024;
const MAX_ENTRIES = 10000;
const MAX_MODS = 512;
const MANIFEST = '.azurrp-managed.json';

function getModsUrl(apiUrl) {
  const base = new URL(normalizeApiUrl(apiUrl));
  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && localHosts.has(base.hostname))) {
    throw new Error('Le téléchargement des mods exige HTTPS (HTTP est autorisé uniquement en local).');
  }
  return new URL(`${base.pathname.replace(/\/+$/, '')}/mods/mods.zip`, base.origin);
}

function isSafeModName(name) {
  return typeof name === 'string' &&
    name.length > 4 &&
    name.toLowerCase().endsWith('.jar') &&
    name === path.basename(name) &&
    !/[<>:"/\\|?*\u0000-\u001f]/.test(name) &&
    name !== '.' &&
    name !== '..';
}

function openZip(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, {
      lazyEntries: true,
      validateEntrySizes: true,
      strictFileNames: true
    }, (error, zip) => error ? reject(error) : resolve(zip));
  });
}

async function extractJarEntries(zipPath, destination) {
  const zip = await openZip(zipPath);
  const jars = [];
  const seen = new Set();
  let entries = 0;
  let totalBytes = 0;

  return new Promise((resolve, reject) => {
    let finished = false;
    const fail = (error) => {
      if (finished) return;
      finished = true;
      zip.close();
      reject(error);
    };

    zip.on('error', fail);
    zip.on('end', () => {
      if (finished) return;
      finished = true;
      if (!jars.length) {
        reject(new Error('mods.zip ne contient aucun fichier .jar.'));
        return;
      }
      resolve(jars);
    });

    zip.on('entry', (entry) => {
      entries += 1;
      if (entries > MAX_ENTRIES) return fail(new Error('mods.zip contient trop de fichiers.'));

      const rawName = String(entry.fileName || '');
      const name = rawName.replace(/\\/g, '/');
      const isDirectory = name.endsWith('/');
      const safeName = isDirectory ? name.slice(0, -1) : name;
      const segments = safeName.split('/');
      if (
        !safeName ||
        safeName.startsWith('/') ||
        /^[A-Za-z]:/.test(safeName) ||
        segments.includes('..') ||
        segments.includes('') ||
        segments.includes('.')
      ) {
        return fail(new Error(`Chemin dangereux dans mods.zip : ${rawName.slice(0, 120)}`));
      }

      if (isDirectory) {
        zip.readEntry();
        return;
      }

      const normalized = segments[0]?.toLowerCase() === 'mods' ? segments.slice(1) : segments;
      if (!normalized.length || normalized.some((part) => part === '.' || part === '..')) {
        return fail(new Error(`Chemin invalide dans mods.zip : ${rawName.slice(0, 120)}`));
      }
      if (!normalized.at(-1).toLowerCase().endsWith('.jar')) {
        zip.readEntry();
        return;
      }
      if (normalized.length !== 1) {
        return fail(new Error('Les fichiers .jar doivent être à la racine du dossier mods dans mods.zip.'));
      }

      const filename = normalized[0];
      const key = filename.toLowerCase();
      const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
      if ((unixMode & 0xf000) === 0xa000) {
        return fail(new Error(`Lien symbolique interdit dans mods.zip : ${filename}`));
      }
      if (!isSafeModName(filename) || seen.has(key)) {
        return fail(new Error(`Nom de mod invalide ou dupliqué dans mods.zip : ${filename}`));
      }
      if (entry.uncompressedSize > MAX_MOD_BYTES) {
        return fail(new Error(`Le mod ${filename} dépasse la taille autorisée.`));
      }

      totalBytes += entry.uncompressedSize;
      if (totalBytes > MAX_TOTAL_MOD_BYTES || jars.length >= MAX_MODS) {
        return fail(new Error('Le pack mods.zip dépasse les limites autorisées.'));
      }
      seen.add(key);

      const target = path.join(destination, filename);
      zip.openReadStream(entry, (streamError, input) => {
        if (streamError) return fail(streamError);
        const output = fs.createWriteStream(target, { flags: 'wx' });
        pipeline(input, output).then(() => {
          jars.push({ filename, size: entry.uncompressedSize });
          zip.readEntry();
        }, fail);
      });
    });

    zip.readEntry();
  });
}

async function downloadArchive(url, archivePath, etag) {
  const headers = { Accept: 'application/zip, application/octet-stream' };
  if (etag) headers['If-None-Match'] = etag;

  let response;
  try {
    response = await fetch(url, {
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(5 * 60 * 1000)
    });
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      throw new Error('Le téléchargement de mods.zip a dépassé le délai autorisé.');
    }
    throw new Error(`Impossible de télécharger mods.zip depuis l’API : ${error.message}`);
  }

  if (response.status === 304) return { unchanged: true, etag };
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('mods.zip est absent du site de l’API. Dépose-le dans server/mods/mods.zip puis redéploie l’API.');
    }
    throw new Error(`Téléchargement de mods.zip refusé par l’API (HTTP ${response.status}).`);
  }
  if (!response.body) throw new Error('L’API a renvoyé une archive vide.');

  const size = Number(response.headers.get('content-length')) || 0;
  if (size > MAX_ARCHIVE_BYTES) throw new Error('mods.zip dépasse la taille maximale autorisée (512 Mio).');

  let received = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > MAX_ARCHIVE_BYTES) {
        callback(new Error('mods.zip dépasse la taille maximale autorisée (512 Mio).'));
        return;
      }
      callback(null, chunk);
    }
  });
  await pipeline(Readable.fromWeb(response.body), limiter, fs.createWriteStream(archivePath, { flags: 'wx' }));

  if (received < 4) throw new Error('Le fichier mods.zip est trop petit ou invalide.');
  const header = Buffer.alloc(4);
  const handle = await fsp.open(archivePath, 'r');
  try {
    await handle.read(header, 0, 4, 0);
  } finally {
    await handle.close();
  }
  if (header[0] !== 0x50 || header[1] !== 0x4b) {
    throw new Error('Le fichier reçu depuis /mods/mods.zip n’est pas une archive ZIP valide.');
  }
  return { unchanged: false, etag: response.headers.get('etag') || null };
}

async function readManifest(modsDir) {
  try {
    const data = JSON.parse(await fsp.readFile(path.join(modsDir, MANIFEST), 'utf8'));
    if (data?.version !== 1 || !Array.isArray(data.files)) return null;
    const files = data.files.filter(isSafeModName);
    const hashes = data.hashes && typeof data.hashes === 'object' ? data.hashes : {};
    return { etag: typeof data.etag === 'string' ? data.etag : null, files, hashes };
  } catch {
    return null;
  }
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function manifestMatches(modsDir, manifest) {
  if (!manifest?.files.length || manifest.files.some((file) => !/^[a-f0-9]{64}$/i.test(manifest.hashes[file] || ''))) {
    return false;
  }
  for (const file of manifest.files) {
    try {
      if (await hashFile(path.join(modsDir, file)) !== manifest.hashes[file]) return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function syncMods({ apiUrl, gameDir, emit = () => {}, logger = null }) {
  const url = getModsUrl(apiUrl);
  const modsDir = path.join(gameDir, 'mods');
  await fsp.mkdir(modsDir, { recursive: true });
  const modsStat = await fsp.lstat(modsDir);
  if (!modsStat.isDirectory() || modsStat.isSymbolicLink()) {
    throw new Error('Le chemin .minecraft/mods doit être un dossier normal, pas un lien symbolique.');
  }

  const previous = await readManifest(modsDir);
  const stage = await fsp.mkdtemp(path.join(gameDir, '.azurrp-mods-'));
  const archivePath = path.join(stage, 'mods.zip');
  const extractDir = path.join(stage, 'extract');
  await fsp.mkdir(extractDir);

  try {
    emit({ type: 'phase', phase: 'download', message: 'Vérification et téléchargement des mods du serveur…' });
    const download = await downloadArchive(url, archivePath, previous?.etag || null);
    if (download.unchanged && await manifestMatches(modsDir, previous)) {
      logger?.info('Mods déjà à jour.');
      emit({ type: 'phase', phase: 'preparing', message: 'Mods déjà à jour.' });
      return { unchanged: true, count: previous.files.length };
    }

    if (download.unchanged) {
      await fsp.rm(archivePath, { force: true });
      await downloadArchive(url, archivePath, null);
    }
    const jars = await extractJarEntries(archivePath, extractDir);
    const nextFiles = jars.map((jar) => jar.filename);
    const nextSet = new Set(nextFiles.map((file) => file.toLowerCase()));
    const hashes = {};
    for (const jar of jars) hashes[jar.filename] = await hashFile(path.join(extractDir, jar.filename));

    for (const oldFile of previous?.files || []) {
      if (!nextSet.has(oldFile.toLowerCase())) {
        await fsp.rm(path.join(modsDir, oldFile), { force: true });
      }
    }

    for (const jar of jars) {
      const source = path.join(extractDir, jar.filename);
      const target = path.join(modsDir, jar.filename);
      const temporary = path.join(modsDir, `.${jar.filename}.${crypto.randomBytes(6).toString('hex')}.tmp`);
      await fsp.copyFile(source, temporary, fs.constants.COPYFILE_EXCL);
      await fsp.rm(target, { force: true });
      await fsp.rename(temporary, target);
    }

    const manifest = {
      version: 1,
      etag: download.etag,
      installedAt: new Date().toISOString(),
      files: nextFiles,
      hashes
    };
    const manifestTemp = path.join(modsDir, `.${MANIFEST}.${crypto.randomBytes(6).toString('hex')}.tmp`);
    await fsp.writeFile(manifestTemp, JSON.stringify(manifest, null, 2), { flag: 'wx' });
    await fsp.rm(path.join(modsDir, MANIFEST), { force: true });
    await fsp.rename(manifestTemp, path.join(modsDir, MANIFEST));

    logger?.info(`${jars.length} mod(s) synchronisé(s) depuis ${url.origin}.`);
    emit({ type: 'phase', phase: 'preparing', message: `${jars.length} mod(s) prêt(s).` });
    return { unchanged: false, count: jars.length };
  } finally {
    await fsp.rm(stage, { recursive: true, force: true });
  }
}

module.exports = { getModsUrl, isSafeModName, syncMods };
