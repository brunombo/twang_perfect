import test from 'node:test';
import assert from 'node:assert/strict';
import { trialPhase, scoreTrial, historyStats } from '../js/exercise.js';

const samples = (pairs) => pairs.map(([v, dt]) => ({ v, dt }));

test('trialPhase suit le décompte, l’essai, puis la fin', () => {
  const trial = { startAt: 3000, durationMs: 8000 };
  assert.equal(trialPhase(trial, 0), 'countdown');
  assert.equal(trialPhase(trial, 3000), 'running');
  assert.equal(trialPhase(trial, 10999), 'running');
  assert.equal(trialPhase(trial, 11000), 'done');
});

test('scoreTrial : cible tenue tout l’essai = 100 %', () => {
  const r = scoreTrial(samples([[0.8, 4000], [0.9, 4000]]), 0.6, 1.0, 8000);
  assert.equal(r.score, 100);
  assert.equal(r.insideMs, 8000);
});

test('scoreTrial : le silence compte comme hors cible', () => {
  // 2 s dans la cible, puis 6 s de silence (aucune trame voisée).
  const r = scoreTrial(samples([[0.8, 2000]]), 0.6, 1.0, 8000);
  assert.equal(r.score, 25);
  assert.equal(r.voicedMs, 2000);
});

test('scoreTrial : hors cible au-dessus et au-dessous', () => {
  const r = scoreTrial(samples([[0.2, 2000], [0.8, 4000], [1.15, 2000]]), 0.6, 1.0, 8000);
  assert.equal(r.score, 50);
  assert.ok(Math.abs(r.mean - (0.2 * 2 + 0.8 * 4 + 1.15 * 2) / 8) < 1e-9);
  assert.ok(r.sd > 0);
});

test('scoreTrial : bornes de la cible incluses', () => {
  assert.equal(scoreTrial(samples([[0.6, 500], [1.0, 500]]), 0.6, 1.0, 1000).score, 100);
});

test('scoreTrial : aucun son = 0 %, sans moyenne', () => {
  const r = scoreTrial([], 0.6, 1.0, 8000);
  assert.equal(r.score, 0);
  assert.equal(r.mean, null);
  assert.equal(r.sd, null);
});

test('historyStats : meilleur score et moyenne récente', () => {
  assert.deepEqual(historyStats([]), { count: 0, best: null, recent: null });
  const h = [10, 90, 40, 50, 60, 70, 80].map((score) => ({ score }));
  assert.deepEqual(historyStats(h), { count: 7, best: 90, recent: 60 });
});
