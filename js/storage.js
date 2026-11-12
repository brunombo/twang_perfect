// Persistance locale (localStorage). Rien ne quitte l'appareil.

import { DEFAULT_BAND } from './dsp.js';

const KEY = 'twangPerfect.v1';
const MAX_HISTORY = 500;

export function defaultState() {
  return {
    version: 1,
    band: { twangLo: DEFAULT_BAND.twangLo, twangHi: DEFAULT_BAND.twangHi },
    calibration: { neutral: null, twang: null, nasal: null },
    settings: { lo: 60, hi: 100, durationS: 8, blind: false },
    history: [],
  };
}

/** Charge l'état ; revient aux valeurs par défaut si le stockage est vide, illisible ou bloqué. */
export function loadState() {
  const base = defaultState();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw);
    if (!saved || saved.version !== 1) return base;
    return {
      ...base,
      ...saved,
      band: { ...base.band, ...saved.band },
      calibration: { ...base.calibration, ...saved.calibration },
      settings: { ...base.settings, ...saved.settings },
      history: Array.isArray(saved.history) ? saved.history : [],
    };
  } catch {
    return base;
  }
}

/** Enregistre l'état. Renvoie false si le navigateur refuse (navigation privée, quota). */
export function saveState(state) {
  try {
    if (state.history.length > MAX_HISTORY) state.history = state.history.slice(-MAX_HISTORY);
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/** Propose le téléchargement de l'état complet au format JSON. */
export function exportState(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `twang_perfect_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
