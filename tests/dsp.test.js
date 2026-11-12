import test from 'node:test';
import assert from 'node:assert/strict';
import * as dsp from '../js/dsp.js';

const SR = 48000;
const BIN = SR / 4096;

/** Spectre plat à floorDb, avec des pics { hz: dB }. */
function spectrum(peaks, floorDb = -120) {
  const s = new Float32Array(2048).fill(floorDb);
  for (const [hz, db] of Object.entries(peaks)) s[Math.round(Number(hz) / BIN)] = db;
  return s;
}

function harmonicTone(f0, n = 2048, harmonics = [1, 0.5, 0.3]) {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    harmonics.forEach((a, k) => {
      x[i] += a * Math.sin((2 * Math.PI * f0 * (k + 1) * i) / SR);
    });
  }
  return x;
}

test('bandPower additionne les puissances de la bande et ignore le reste', () => {
  const s = spectrum({ 1000: -10, 3000: -10 });
  assert.ok(Math.abs(dsp.bandPower(s, BIN, 2500, 4000) - 0.1) < 1e-6);
  assert.ok(Math.abs(dsp.bandPower(s, BIN, 80, 8000) - 0.2) < 1e-6);
});

test('brightnessDb : moitié de la puissance dans la bande twang = environ -3 dB', () => {
  const b = dsp.brightnessDb(spectrum({ 1000: -10, 3000: -10 }), BIN);
  assert.ok(Math.abs(b + 3.01) < 0.05, `obtenu ${b}`);
});

test('brightnessDb ne dépend pas du volume', () => {
  const quiet = dsp.brightnessDb(spectrum({ 500: -40, 3000: -50 }), BIN);
  const loud = dsp.brightnessDb(spectrum({ 500: -10, 3000: -20 }), BIN);
  assert.ok(Math.abs(quiet - loud) < 1e-3);
});

test('brightnessDb monte quand l’énergie aiguë monte', () => {
  const dull = dsp.brightnessDb(spectrum({ 500: -10, 3000: -40 }), BIN);
  const bright = dsp.brightnessDb(spectrum({ 500: -10, 3000: -15 }), BIN);
  assert.ok(bright > dull + 10);
});

test('brightnessDb renvoie null sur un spectre vide', () => {
  assert.equal(dsp.brightnessDb(new Float32Array(2048).fill(-Infinity), BIN), null);
});

test('rmsDb : sinus pleine échelle = environ -3 dB', () => {
  const x = new Float32Array(4800);
  for (let i = 0; i < x.length; i++) x[i] = Math.sin((2 * Math.PI * 440 * i) / SR);
  assert.ok(Math.abs(dsp.rmsDb(x) + 3.01) < 0.05);
});

test('median, mean, std', () => {
  assert.equal(dsp.median([3, 1, 2]), 2);
  assert.equal(dsp.median([4, 1, 2, 3]), 2.5);
  assert.equal(dsp.median([]), null);
  assert.equal(dsp.mean([1, 2, 3]), 2);
  assert.ok(Math.abs(dsp.std([1, 3]) - 1) < 1e-9);
});

test('normalize place la valeur entre les repères et borne le résultat', () => {
  assert.equal(dsp.normalize(-20, -30, -10), 0.5);
  assert.equal(dsp.normalize(-40, -30, -10), 0);
  assert.equal(dsp.normalize(0, -30, -10), 1.2);
  assert.equal(dsp.normalize(-20, -10, -10), null);
  assert.equal(dsp.normalize(null, -30, -10), null);
});

test('ema : première valeur reprise telle quelle, puis convergence', () => {
  assert.equal(dsp.ema(null, 5, 16, 80), 5);
  let v = 0;
  for (let i = 0; i < 100; i++) v = dsp.ema(v, 1, 16, 80);
  assert.ok(Math.abs(v - 1) < 1e-6);
  // Même résultat après 160 ms, que l'écran soit à 60 ou 120 images par seconde.
  let a = 0;
  for (let i = 0; i < 10; i++) a = dsp.ema(a, 1, 16, 80);
  let b = 0;
  for (let i = 0; i < 20; i++) b = dsp.ema(b, 1, 8, 80);
  assert.ok(Math.abs(a - b) < 1e-9);
});

test('bandEdges : tiers d’octave, bornes respectées', () => {
  const e = dsp.bandEdges(200, 1600);
  assert.equal(e[0], 200);
  assert.equal(e[e.length - 1], 1600);
  assert.equal(e.length, 10);
  assert.ok(Math.abs(e[3] - 400) < 1e-6);
});

test('bandLevels est recentré : le volume global disparaît', () => {
  const edges = dsp.bandEdges(200, 1500);
  const a = dsp.bandLevels(spectrum({ 300: -20, 900: -30 }, -90), BIN, edges);
  const b = dsp.bandLevels(spectrum({ 300: -40, 900: -50 }, -110), BIN, edges);
  assert.ok(Math.abs(a.reduce((s, v) => s + v, 0)) < 1e-6);
  assert.ok(dsp.meanAbsDiff(a, b) < 1e-3);
});

test('project : position et résidu', () => {
  const a = [0, 0];
  const b = [2, 0];
  assert.deepEqual(dsp.project([1, 0], a, b), { t: 0.5, residual: 0 });
  const off = dsp.project([1, 2], a, b);
  assert.equal(off.t, 0.5);
  assert.equal(off.residual, 1);
  assert.equal(dsp.project([1, 1], a, a), null);
});

test('detectPitch retrouve la fondamentale d’un son harmonique', () => {
  for (const f0 of [110, 220, 330, 440, 660]) {
    const { f0: found, clarity } = dsp.detectPitch(harmonicTone(f0), SR);
    assert.ok(Math.abs(dsp.semitones(found, f0)) < 0.1, `${f0} Hz → ${found} Hz`);
    assert.ok(clarity > 0.9);
  }
});

test('detectPitch ne tombe pas à l’octave quand l’harmonique 2 domine', () => {
  const { f0 } = dsp.detectPitch(harmonicTone(220, 2048, [0.3, 1, 0.4]), SR);
  assert.ok(Math.abs(dsp.semitones(f0, 220)) < 0.1, `obtenu ${f0} Hz`);
});

test('detectPitch : silence et bruit ne donnent pas de note fiable', () => {
  assert.equal(dsp.detectPitch(new Float32Array(2048), SR).f0, null);
  let seed = 1;
  const noise = Float32Array.from({ length: 2048 }, () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 2147483648 - 1;
  });
  assert.ok(dsp.detectPitch(noise, SR).clarity < 0.5);
});

test('noteName et semitones', () => {
  assert.equal(dsp.noteName(440), 'la (A4)');
  assert.equal(dsp.noteName(261.63), 'do (C4)');
  assert.equal(dsp.noteName(0), null);
  assert.ok(Math.abs(dsp.semitones(880, 440) - 12) < 1e-9);
  assert.equal(dsp.semitones(null, 440), null);
});
