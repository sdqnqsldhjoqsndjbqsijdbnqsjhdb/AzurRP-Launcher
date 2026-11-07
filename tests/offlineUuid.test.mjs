import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { offlineUuid, dashedUuid } = require('../src/main/utils/offlineUuid.js');

test('offlineUuid reproduit les UUID hors-ligne de Minecraft', () => {
  assert.equal(offlineUuid('Notch'), 'b50ad385829d3141a2167e7d7539ba7f');
  assert.equal(offlineUuid('Aventurier'), 'e08591bfbd52335d9984721c06341954');
  assert.equal(offlineUuid('AzurRP'), '5595743e72bf32dfbb5a7da6e7268004');
});

test('offlineUuid force la version 3 et la variante RFC 4122', () => {
  for (const name of ['Aventurier', 'Notch', 'x'.repeat(16)]) {
    const uuid = offlineUuid(name);
    assert.match(uuid, /^[0-9a-f]{32}$/);
    assert.equal(uuid[12], '3');
    assert.match(uuid[16], /[89ab]/);
  }
});

test('offlineUuid refuse les pseudos vides ou non textuels', () => {
  assert.throws(() => offlineUuid(''));
  assert.throws(() => offlineUuid(null));
  assert.throws(() => offlineUuid(42));
});

test('dashedUuid formate un UUID compact', () => {
  assert.equal(
    dashedUuid('b50ad385829d3141a2167e7d7539ba7f'),
    'b50ad385-829d-3141-a216-7e7d7539ba7f'
  );
});
