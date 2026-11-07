/**
 * Vérifie qu'un build de production est réellement protégé avant publication.
 *
 *   node scripts/verify-dist.mjs [chemin/vers/app.asar]
 *
 * Contrôles :
 *  - tous les fichiers attendus existent dans dist/ ;
 *  - le manifeste d'intégrité couvre le processus principal, le preload et le
 *    renderer, et les empreintes SHA-256 correspondent ;
 *  - aucun sourcemap ni fichier source n'est présent ;
 *  - le code JavaScript est bien obfusqué ;
 *  - si un ASAR est fourni (ou détecté dans release/), les dépendances
 *    nécessaires sont empaquetées et aucun sourcemap ne s'y cache.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import asar from '@electron/asar';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const failures = [];
const checks = [];

function ok(label, detail = '') {
  checks.push({ label, detail, ok: true });
}

function fail(label, detail = '') {
  checks.push({ label, detail, ok: false });
  failures.push(label);
}

function expect(condition, label, detail = '') {
  if (condition) ok(label, detail);
  else fail(label, detail);
}

async function sha256(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}

// ── 1. Fichiers du build ────────────────────────────────────────────────
const required = ['main.js', 'preload.js', 'renderer/index.html', 'renderer/renderer.js', 'renderer/styles.css', 'integrity.json'];
const missing = [];
for (const relative of required) {
  if (!existsSync(path.join(dist, relative))) missing.push(relative);
}
expect(missing.length === 0, 'Fichiers obligatoires présents', missing.join(', '));

if (missing.length) {
  report();
  process.exit(1);
}

// ── 2. Manifeste d'intégrité ────────────────────────────────────────────
const manifest = JSON.parse(await readFile(path.join(dist, 'integrity.json'), 'utf8'));
expect(
  manifest['main.js'] && manifest['preload.js'] && manifest['renderer/renderer.js'],
  'Le manifeste couvre main, preload et renderer'
);

let hashFailures = 0;
for (const [relative, expected] of Object.entries(manifest)) {
  const file = path.join(dist, relative);
  if (!existsSync(file)) {
    hashFailures += 1;
    fail(`Empreinte manquante : ${relative}`);
    continue;
  }
  const actual = await sha256(file);
  if (actual !== expected) {
    hashFailures += 1;
    fail(`Empreinte invalide : ${relative}`);
  }
}
if (!hashFailures) ok('Empreintes SHA-256 conformes', `${Object.keys(manifest).length} fichiers`);

// ── 3. Aucun code source lisible ────────────────────────────────────────
const files = await walk(dist);
const sourceMaps = files.filter((file) => file.endsWith('.map'));
expect(sourceMaps.length === 0, 'Aucun sourcemap', sourceMaps.map((f) => path.relative(dist, f)).join(', '));

const bundled = await readFile(path.join(dist, 'main.js'), 'utf8');
expect(
  !/sourceMappingURL/.test(bundled),
  'Aucune référence à un sourcemap dans main.js'
);
expect(
  /_0x[a-f0-9]{3,}/i.test(bundled),
  'Obfuscation détectée (identifiants hexadécimaux)'
);
expect(
  !/require\(["']\.\/config["']\)/.test(bundled),
  'Les modules internes sont regroupés (pas de require brut)'
);

// ── 4. ASAR empaqueté (optionnel) ───────────────────────────────────────
let asarPath = process.argv[2] ? path.resolve(process.argv[2]) : '';
if (!asarPath) {
  const candidates = [
    path.join(root, 'release', 'win-unpacked', 'resources', 'app.asar'),
    path.join(root, 'release', 'linux-unpacked', 'resources', 'app.asar'),
    path.join(root, 'release', 'mac', 'AzurRP.app', 'Contents', 'Resources', 'app.asar'),
    path.join(root, 'release', 'mac-arm64', 'AzurRP.app', 'Contents', 'Resources', 'app.asar'),
    path.join(root, 'release', 'mac-x64', 'AzurRP.app', 'Contents', 'Resources', 'app.asar')
  ];
  asarPath = candidates.find((candidate) => existsSync(candidate)) || '';
}

if (asarPath) {
  const entries = (await Promise.resolve(asar.listPackage(asarPath))).map((entry) =>
    entry.replaceAll('\\', '/')
  );
  const has = (needle) => entries.some((entry) => entry === needle || entry.endsWith(`/${needle}`));
  expect(has('node_modules/minecraft-java-core'), 'Dépendance minecraft-java-core empaquetée');
  expect(has('node_modules/minecraft-server-util'), 'Dépendance minecraft-server-util empaquetée');
  expect(has('dist/main.js'), 'main.js présent dans l’ASAR');
  expect(!entries.some((entry) => /\/src\/main\//.test(entry)), 'Aucun source src/main dans l’ASAR');
  expect(
    !entries.some((entry) => entry.startsWith('/dist/') && entry.endsWith('.map')),
    'Aucun sourcemap du launcher dans l’ASAR'
  );
  expect(!entries.some((entry) => entry.endsWith('/.env')), 'Aucun fichier .env dans l’ASAR');
  const size = (await stat(asarPath)).size;
  ok('ASAR inspecté', `${path.relative(root, asarPath)} (${(size / 1024 / 1024).toFixed(1)} Mo)`);
} else {
  ok('ASAR non fourni', 'contrôle limité à dist/ (normal avant packaging)');
}

// ── Rapport ─────────────────────────────────────────────────────────────
function report() {
  console.log('\nVérification du build de production\n');
  for (const check of checks) {
    const mark = check.ok ? 'ok ' : 'ERR';
    console.log(`  ${mark}  ${check.label}${check.detail ? ` — ${check.detail}` : ''}`);
  }
  console.log('');
}

report();
if (failures.length) {
  console.error(`[verify-dist] ${failures.length} contrôle(s) en échec.`);
  process.exit(1);
}
console.log('[verify-dist] build conforme.');
