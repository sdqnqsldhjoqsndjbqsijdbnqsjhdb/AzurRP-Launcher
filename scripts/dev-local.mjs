import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const electron = require('electron');
const env = { ...process.env, AZURRP_API_URL: 'http://127.0.0.1:3000' };

const api = spawn(process.execPath, ['src/local.js'], {
  cwd: path.join(root, 'server'),
  env,
  stdio: 'inherit'
});
let launcher = null;
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  launcher?.kill();
  api.kill();
  setTimeout(() => process.exit(code), 250).unref();
}

api.once('exit', (code) => {
  if (!stopping) {
    console.error(`[dev-local] API locale arrêtée (${code ?? 'signal'}).`);
    stop(code || 1);
  }
});
process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));

try {
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (api.exitCode !== null) throw new Error('Le processus API local s’est arrêté au démarrage.');
    try {
      const response = await fetch(`${env.AZURRP_API_URL}/api/v1/health`, {
        signal: AbortSignal.timeout(500)
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(200);
  }
  if (!ready) throw new Error('L’API locale ne répond pas sur http://127.0.0.1:3000.');

  launcher = spawn(electron, ['.'], { cwd: root, env, stdio: 'inherit' });
  launcher.once('exit', (code) => stop(code || 0));
} catch (error) {
  console.error(`[dev-local] ${error.message}`);
  stop(1);
}
