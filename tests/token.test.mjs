import test from 'node:test';
import assert from 'node:assert/strict';
import { signToken, verifyToken } from '../server/src/token.js';

const SECRET = 'a'.repeat(64);

test('signToken produit un jeton vérifiable', () => {
  const { token, expiresAt } = signToken({ sub: '42', role: 'admin' }, SECRET, 3600);
  assert.equal(token.split('.').length, 3);
  assert.ok(Date.parse(expiresAt) > Date.now());

  const payload = verifyToken(token, SECRET);
  assert.equal(payload.sub, '42');
  assert.equal(payload.role, 'admin');
  assert.ok(payload.exp > payload.iat);
});

test('verifyToken rejette un jeton altéré', () => {
  const { token } = signToken({ sub: '42' }, SECRET, 3600);
  const parts = token.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  payload.sub = '1';
  const forged = `${parts[0]}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${parts[2]}`;
  assert.equal(verifyToken(forged, SECRET), null);
});

test('verifyToken rejette un mauvais secret, un format invalide et un jeton vide', () => {
  const { token } = signToken({ sub: '42' }, SECRET, 3600);
  assert.equal(verifyToken(token, 'b'.repeat(64)), null);
  assert.equal(verifyToken('abc', SECRET), null);
  assert.equal(verifyToken('', SECRET), null);
  assert.equal(verifyToken(null, SECRET), null);
  assert.equal(verifyToken('a.b.c', SECRET), null);
});

test('signToken impose une durée de vie minimale', () => {
  const { token } = signToken({ sub: '42' }, SECRET, 0);
  const payload = verifyToken(token, SECRET);
  assert.ok(payload.exp - payload.iat >= 60);
});
