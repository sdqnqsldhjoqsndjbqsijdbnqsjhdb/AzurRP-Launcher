import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const launchFile = path.join(root, 'node_modules', 'minecraft-java-core', 'build', 'Launch.js');

let source;
try {
  source = await readFile(launchFile, 'utf8');
} catch (error) {
  throw new Error(`minecraft-java-core introuvable (${launchFile}). Lancez npm install avant le build.`, { cause: error });
}

const oldCatch = ".catch((err) => ({ error: err?.message || String(err) }));";
const diagnosticCatch = ".catch((err) => ({ error: err?.message || (typeof err === 'string' ? err : require('node:util').inspect(err, { depth: 8, breakLength: 120 })) }));";

if (source.includes(diagnosticCatch)) {
  process.exit(0);
}
if (!source.includes(oldCatch)) {
  throw new Error('Version inattendue de minecraft-java-core : impossible d’appliquer le correctif de diagnostic Forge.');
}

await writeFile(launchFile, source.replace(oldCatch, diagnosticCatch), 'utf8');
console.log('[build] Correctif de diagnostic Forge appliqué.');
