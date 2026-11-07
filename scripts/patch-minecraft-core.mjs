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

const diagnosticCatch = ".catch((err) => ({ error: err?.message || (typeof err === 'string' ? err : require('node:util').inspect(err, { depth: 8, breakLength: 120 })) }));";
if (source.includes(diagnosticCatch)) {
  console.log('[build] Correctif de diagnostic Forge déjà présent.');
} else {
  const oldCatch = /\.catch\(\s*\(err\)\s*=>\s*\(\{\s*error:\s*err\?\.message\s*\|\|\s*String\(err\)\s*\}\)\s*\);/;
  if (!oldCatch.test(source)) {
    // Diagnostic-only: a dependency formatting/API change must not fail builds.
    console.warn('[build] Catch Forge non reconnu dans minecraft-java-core; correctif de diagnostic ignoré.');
  } else {
    await writeFile(launchFile, source.replace(oldCatch, diagnosticCatch), 'utf8');
    console.log('[build] Correctif de diagnostic Forge appliqué.');
  }
}
