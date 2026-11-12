// Traitement du signal : fonctions pures, sans accès au navigateur.
// Tout ce fichier est testé par tests/dsp.test.js (node --test).

/** Bandes par défaut, en Hz. La bande twang est une hypothèse de travail réglable. */
export const DEFAULT_BAND = Object.freeze({
  twangLo: 2500,
  twangHi: 4000,
  totalLo: 80,
  totalHi: 8000,
});

/** Somme des puissances (linéaires) d'un spectre en dB entre deux fréquences. */
export function bandPower(specDb, binHz, loHz, hiHz) {
  const i0 = Math.max(1, Math.ceil(loHz / binHz));
  const i1 = Math.min(specDb.length - 1, Math.floor(hiHz / binHz));
  let sum = 0;
  for (let i = i0; i <= i1; i++) sum += Math.pow(10, specDb[i] / 10);
  return sum;
}

/**
 * Brillance : part de la puissance située dans la bande twang, en dB.
 * Toujours négative ; plus elle est proche de 0, plus le son est brillant.
 * Indépendante du volume, car c'est un rapport.
 */
export function brightnessDb(specDb, binHz, band = DEFAULT_BAND) {
  const total = bandPower(specDb, binHz, band.totalLo, band.totalHi);
  const high = bandPower(specDb, binHz, band.twangLo, band.twangHi);
  if (!(total > 0) || !(high > 0)) return null;
  return 10 * Math.log10(high / total);
}

/** Niveau efficace d'un bloc temporel, en dB pleine échelle. */
export function rmsDb(samples) {
  let s = 0;
  for (let i = 0; i < samples.length; i++) s += samples[i] * samples[i];
  return 10 * Math.log10(s / samples.length + 1e-12);
}

export function median(values) {
  if (values.length === 0) return null;
  const s = Array.from(values).sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function mean(values) {
  if (values.length === 0) return null;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

export function std(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  let s = 0;
  for (const v of values) s += (v - m) * (v - m);
  return Math.sqrt(s / values.length);
}

/**
 * Place une valeur entre deux repères : 0 = repère bas, 1 = repère haut.
 * Borne à [0, max] ; max > 1 laisse dépasser le repère haut.
 * Renvoie null si les repères sont confondus.
 */
export function normalize(value, low, high, max = 1.2) {
  const span = high - low;
  if (value === null || !(Math.abs(span) > 1e-9)) return null;
  return Math.min(max, Math.max(0, (value - low) / span));
}

/** Lissage exponentiel indépendant de la cadence d'affichage. */
export function ema(previous, value, dtMs, tauMs) {
  if (previous === null || previous === undefined) return value;
  const alpha = 1 - Math.exp(-dtMs / tauMs);
  return previous + alpha * (value - previous);
}

/** Bornes de bandes en fraction d'octave (tiers d'octave par défaut). */
export function bandEdges(loHz, hiHz, perOctave = 3) {
  const edges = [loHz];
  const step = Math.pow(2, 1 / perOctave);
  let f = loHz * step;
  while (f < hiHz * 0.999) {
    edges.push(f);
    f *= step;
  }
  edges.push(hiHz);
  return edges;
}

/**
 * Niveaux par bande, en dB, recentrés sur leur moyenne.
 * Le recentrage retire le volume global : il reste la forme du spectre.
 */
export function bandLevels(specDb, binHz, edges) {
  const out = new Array(edges.length - 1);
  let sum = 0;
  for (let k = 0; k < out.length; k++) {
    const p = bandPower(specDb, binHz, edges[k], edges[k + 1]);
    out[k] = p > 0 ? Math.max(-120, 10 * Math.log10(p)) : -120;
    sum += out[k];
  }
  const m = sum / out.length;
  for (let k = 0; k < out.length; k++) out[k] -= m;
  return out;
}

/** Moyenne composante par composante d'une liste de vecteurs de même taille. */
export function meanVector(vectors) {
  if (vectors.length === 0) return null;
  const out = new Array(vectors[0].length).fill(0);
  for (const v of vectors) for (let k = 0; k < out.length; k++) out[k] += v[k];
  for (let k = 0; k < out.length; k++) out[k] /= vectors.length;
  return out;
}

/** Écart moyen absolu entre deux vecteurs de niveaux, en dB. */
export function meanAbsDiff(a, b) {
  let s = 0;
  for (let k = 0; k < a.length; k++) s += Math.abs(a[k] - b[k]);
  return s / a.length;
}

/**
 * Projette x sur la droite qui va de a à b.
 * t = 0 en a, t = 1 en b. residual = distance à la droite, rapportée à |b - a|.
 */
export function project(x, a, b) {
  let dd = 0;
  let xd = 0;
  for (let k = 0; k < a.length; k++) {
    const d = b[k] - a[k];
    dd += d * d;
    xd += (x[k] - a[k]) * d;
  }
  if (!(dd > 1e-9)) return null;
  const t = xd / dd;
  let r = 0;
  for (let k = 0; k < a.length; k++) {
    const e = x[k] - a[k] - t * (b[k] - a[k]);
    r += e * e;
  }
  return { t, residual: Math.sqrt(r / dd) };
}

/**
 * Hauteur fondamentale par autocorrélation normalisée.
 * Renvoie { f0, clarity } ; clarity proche de 1 = son très périodique.
 * f0 vaut null si aucun pic exploitable.
 */
export function detectPitch(samples, sampleRate, fMin = 70, fMax = 1000) {
  const minLag = Math.max(2, Math.floor(sampleRate / fMax));
  const maxLag = Math.min(samples.length - 2, Math.ceil(sampleRate / fMin));
  const n = samples.length - maxLag;
  if (n < 32 || maxLag <= minLag) return { f0: null, clarity: 0 };

  let dc = 0;
  for (let i = 0; i < samples.length; i++) dc += samples[i];
  dc /= samples.length;

  let e0 = 0;
  for (let i = 0; i < n; i++) {
    const a = samples[i] - dc;
    e0 += a * a;
  }
  if (!(e0 > 1e-10)) return { f0: null, clarity: 0 };

  const r = new Float32Array(maxLag - minLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0;
    let e1 = 0;
    for (let i = 0; i < n; i++) {
      const a = samples[i] - dc;
      const b = samples[i + lag] - dc;
      num += a * b;
      e1 += b * b;
    }
    r[lag - minLag] = e1 > 1e-10 ? num / Math.sqrt(e0 * e1) : 0;
  }

  // Sortir de la retombée initiale (corrélation forte aux très petits retards).
  let start = 0;
  while (start < r.length - 1 && r[start + 1] < r[start]) start++;

  let best = -1;
  for (let i = start; i < r.length; i++) if (r[i] > best) best = r[i];
  if (!(best > 0)) return { f0: null, clarity: 0 };

  // Premier pic local assez haut : évite de tomber une octave trop bas.
  const threshold = 0.9 * best;
  for (let i = Math.max(1, start); i < r.length - 1; i++) {
    if (r[i] >= threshold && r[i] >= r[i - 1] && r[i] >= r[i + 1]) {
      const y0 = r[i - 1];
      const y1 = r[i];
      const y2 = r[i + 1];
      const den = y0 - 2 * y1 + y2;
      const shift = Math.abs(den) > 1e-12 ? (0.5 * (y0 - y2)) / den : 0;
      return { f0: sampleRate / (i + minLag + shift), clarity: y1 };
    }
  }
  return { f0: null, clarity: 0 };
}

const NOTES_FR = ['do', 'do♯', 'ré', 'ré♯', 'mi', 'fa', 'fa♯', 'sol', 'sol♯', 'la', 'la♯', 'si'];
const NOTES_EN = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

/** Nom de note : solfège, puis notation internationale (la 440 Hz = A4). */
export function noteName(f0) {
  if (!(f0 > 0)) return null;
  const midi = Math.round(69 + 12 * Math.log2(f0 / 440));
  const pc = ((midi % 12) + 12) % 12;
  return `${NOTES_FR[pc]} (${NOTES_EN[pc]}${Math.floor(midi / 12) - 1})`;
}

/** Écart entre deux fréquences, en demi-tons (positif si f est plus aigu). */
export function semitones(f, ref) {
  if (!(f > 0) || !(ref > 0)) return null;
  return 12 * Math.log2(f / ref);
}
