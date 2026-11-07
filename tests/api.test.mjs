import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const api = require('../src/main/services/api.js');

function mockFetch(implementation) {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  return () => { globalThis.fetch = original; };
}

test('client API décode le format standard de la route santé', async () => {
  const restore = mockFetch(async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:3000/api/v1/health');
    assert.equal(options.method, 'GET');
    return new Response(JSON.stringify({ ok: true, data: { status: 'ok', version: '1.0.0' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  });
  try {
    assert.deepEqual(await api.health('http://127.0.0.1:3000/'), { status: 'ok', version: '1.0.0' });
  } finally {
    restore();
  }
});

test('client API préserve les erreurs HTTP structurées', async () => {
  const restore = mockFetch(async () => new Response(JSON.stringify({
    ok: false,
    error: { code: 'USERNAME_TAKEN', message: 'Pseudo déjà utilisé.' }
  }), { status: 409 }));
  try {
    await assert.rejects(api.register('https://api.example.test', 'Player', 'p@example.test', 'password123'), {
      code: 'USERNAME_TAKEN',
      status: 409,
      message: 'Pseudo déjà utilisé.'
    });
  } finally {
    restore();
  }
});

test('client API fournit une piste exploitable pour un échec DNS', async () => {
  const restore = mockFetch(async () => {
    const error = new TypeError('fetch failed');
    error.cause = Object.assign(new Error('getaddrinfo ENOTFOUND api.example.test'), { code: 'ENOTFOUND' });
    throw error;
  });
  try {
    await assert.rejects(api.health('https://api.example.test'), (error) => {
      assert.equal(error.code, 'NETWORK_ERROR');
      assert.equal(error.details.networkCode, 'ENOTFOUND');
      assert.match(error.message, /DNS/);
      return true;
    });
  } finally {
    restore();
  }
});

test('le délai maximum couvre également la lecture de la réponse', async () => {
  const restore = mockFetch(async (_url, { signal }) => new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve({
      ok: true,
      status: 200,
      text: () => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    }), { once: true });
  }));
  try {
    await assert.rejects(api.request('https://api.example.test', '/slow', { timeout: 10 }), {
      code: 'TIMEOUT'
    });
  } finally {
    restore();
  }
});
