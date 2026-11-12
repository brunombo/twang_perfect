import test from 'node:test';
import assert from 'node:assert/strict';
import { nasalIndex, comparePinch } from '../js/nasality.js';

const ORAL = [4, 0, -4, 0];
const NASAL = [0, 4, 0, -4];

/** n trames identiques au vecteur donné, avec une petite variation alternée. */
function take(vector, levelDb, jitter = 0.1, n = 20) {
  const frames = [];
  for (let i = 0; i < n; i++) frames.push(vector.map((v, k) => v + (i % 2 ? jitter : -jitter) * (k % 2 ? 1 : -1)));
  return { frames, levelDb };
}

test('nasalIndex vaut 0 sur la référence orale et 1 sur la référence nasale', () => {
  assert.equal(nasalIndex(ORAL, ORAL, NASAL).value, 0);
  assert.equal(nasalIndex(NASAL, ORAL, NASAL).value, 1);
  const mid = nasalIndex([2, 2, -2, -2], ORAL, NASAL);
  assert.ok(Math.abs(mid.value - 0.5) < 1e-9);
  assert.equal(mid.inModel, true);
});

test('nasalIndex est borné à [0, 1]', () => {
  assert.equal(nasalIndex([8, -4, -8, 4], ORAL, NASAL).value, 0);
  assert.equal(nasalIndex([-4, 8, 4, -8], ORAL, NASAL).value, 1);
});

test('nasalIndex signale un son étranger aux deux références', () => {
  const odd = nasalIndex([30, 30, -30, -30], ORAL, NASAL);
  assert.equal(odd.inModel, false);
  assert.ok(odd.residual > 1);
});

test('nasalIndex renvoie null si les références sont confondues', () => {
  assert.equal(nasalIndex(ORAL, ORAL, ORAL), null);
});

test('comparePinch : spectre inchangé = « unchanged »', () => {
  const r = comparePinch(take(ORAL, -20), take(ORAL, -20.2));
  assert.equal(r.verdict, 'unchanged');
  assert.ok(r.diffDb < 0.2);
});

test('comparePinch : spectre nettement modifié = « changed », avec chute de niveau', () => {
  const r = comparePinch(take(ORAL, -20), take(NASAL, -26));
  assert.equal(r.verdict, 'changed');
  assert.ok(r.diffDb > 3);
  assert.ok(Math.abs(r.levelDeltaDb + 6) < 1e-9);
});

test('comparePinch : petite différence noyée dans la variation des prises = « uncertain »', () => {
  const shifted = ORAL.map((v, k) => v + (k % 2 ? 0.8 : -0.8));
  const r = comparePinch(take(ORAL, -20, 0.5), take(shifted, -20, 0.5));
  assert.equal(r.verdict, 'uncertain');
});

test('comparePinch refuse des prises trop courtes', () => {
  assert.equal(comparePinch(take(ORAL, -20, 0.1, 2), take(NASAL, -20)), null);
});
