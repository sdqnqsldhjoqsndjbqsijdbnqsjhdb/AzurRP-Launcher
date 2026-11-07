import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import JavaScriptObfuscator from 'javascript-obfuscator';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const dev = process.argv.includes('--dev') || process.env.AZURRP_DEV === '1';

// Valeurs injectées à la compilation : elles permettent de livrer un launcher
// préconfiguré (URL d'API, adresse du serveur) sans embarquer de fichier .env.
// Exemple : AZURRP_API_URL=https://api.azur-rp.eu npm run dist:win
const buildApiUrl = String(process.env.AZURRP_API_URL || '').trim();
const buildServerHost = String(process.env.AZURRP_SERVER_HOST || '').trim();

const shared = {
  bundle: true,
  legalComments: 'none',
  logLevel: 'info',
  sourcemap: false,
  minify: !dev,
  charset: 'utf8',
  define: {
    'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production'),
    __AZURRP_BUILD_API_URL__: JSON.stringify(buildApiUrl),
    __AZURRP_BUILD_SERVER_HOST__: JSON.stringify(buildServerHost)
  }
};

// Les visuels et polices restent servis depuis « assets/ » à la racine de
// l'application : on empêche esbuild de les dupliquer dans « dist/ ».
const keepAssets = {
  name: 'keep-assets',
  setup(build) {
    build.onResolve({ filter: /^\.\.\/\.\.\/assets\// }, (args) => ({
      path: args.path,
      external: true
    }));
  }
};

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'renderer'), { recursive: true });

await build({
  ...shared,
  entryPoints: [path.join(root, 'src', 'main', 'index.js')],
  outfile: path.join(dist, 'main.js'),
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron', 'electron-updater', 'minecraft-java-core', 'minecraft-server-util']
});

await build({
  ...shared,
  entryPoints: [path.join(root, 'src', 'preload', 'index.js')],
  outfile: path.join(dist, 'preload.js'),
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron']
});

await build({
  ...shared,
  entryPoints: [path.join(root, 'src', 'renderer', 'app.js')],
  outfile: path.join(dist, 'renderer', 'renderer.js'),
  platform: 'browser',
  target: 'chrome120',
  format: 'iife'
});

await build({
  ...shared,
  entryPoints: [path.join(root, 'src', 'renderer', 'styles.css')],
  outfile: path.join(dist, 'renderer', 'styles.css'),
  plugins: [keepAssets]
});

await copyFile(path.join(root, 'src', 'renderer', 'index.html'), path.join(dist, 'renderer', 'index.html'));

if (!dev) {
  const obfuscation = {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.45,
    deadCodeInjection: false,
    debugProtection: false,
    disableConsoleOutput: false,
    identifierNamesGenerator: 'hexadecimal',
    numbersToExpressions: true,
    renameGlobals: false,
    selfDefending: true,
    simplify: true,
    splitStrings: true,
    splitStringsChunkLength: 12,
    stringArray: true,
    stringArrayCallsTransform: true,
    stringArrayEncoding: ['base64'],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayThreshold: 0.7,
    transformObjectKeys: false,
    unicodeEscapeSequence: false
  };

  for (const file of ['main.js', 'preload.js', 'renderer/renderer.js']) {
    const target = path.join(dist, file);
    const source = await readFile(target, 'utf8');
    const result = JavaScriptObfuscator.obfuscate(source, obfuscation).getObfuscatedCode();
    await writeFile(target, result, 'utf8');
    console.log(`[obfuscation] ${file} (${(result.length / 1024).toFixed(0)} Ko)`);
  }
}

const integrity = {};
for (const file of ['main.js', 'preload.js', 'renderer/renderer.js', 'renderer/styles.css', 'renderer/index.html']) {
  const content = await readFile(path.join(dist, file));
  integrity[file.replaceAll('\\', '/')] = createHash('sha256').update(content).digest('hex');
}
await writeFile(path.join(dist, 'integrity.json'), JSON.stringify(integrity, null, 2));

console.log(`[build] terminé en mode ${dev ? 'développement' : 'production'}`);
