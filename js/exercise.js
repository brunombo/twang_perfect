// Exercice « tenir la cible » : logique pure, testée par tests/exercise.test.js.

/** Phase d'un essai à l'instant now (ms) : 'countdown', 'running' ou 'done'. */
export function trialPhase(trial, now) {
  if (now < trial.startAt) return 'countdown';
  if (now < trial.startAt + trial.durationMs) return 'running';
  return 'done';
}

/**
 * Score d'un essai.
 * samples : trames voisées { v: brillance normalisée, dt: durée en ms }.
 * Le score est le temps passé dans la cible rapporté à la durée de l'essai :
 * un silence compte comme hors cible.
 */
export function scoreTrial(samples, lo, hi, durationMs) {
  let voiced = 0;
  let inside = 0;
  let sum = 0;
  let sum2 = 0;
  for (const s of samples) {
    voiced += s.dt;
    if (s.v >= lo && s.v <= hi) inside += s.dt;
    sum += s.v * s.dt;
    sum2 += s.v * s.v * s.dt;
  }
  inside = Math.min(inside, durationMs);
  const meanV = voiced > 0 ? sum / voiced : null;
  const sd = voiced > 0 ? Math.sqrt(Math.max(0, sum2 / voiced - meanV * meanV)) : null;
  return {
    score: durationMs > 0 ? Math.round((100 * inside) / durationMs) : 0,
    insideMs: inside,
    voicedMs: Math.min(voiced, durationMs),
    mean: meanV,
    sd,
  };
}

/** Résumé de l'historique : meilleur score et moyenne des derniers essais. */
export function historyStats(history, lastN = 5) {
  if (history.length === 0) return { count: 0, best: null, recent: null };
  let best = -Infinity;
  for (const h of history) if (h.score > best) best = h.score;
  const last = history.slice(-lastN);
  let s = 0;
  for (const h of last) s += h.score;
  return { count: history.length, best, recent: Math.round(s / last.length) };
}
