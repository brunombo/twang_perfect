// Nasalité : deux outils, tous deux relatifs à la voix de la personne.
// Fonctions pures, testées par tests/nasality.test.js.

import { meanVector, meanAbsDiff, project, mean } from './dsp.js';

/** Bande d'analyse de l'indice continu, en Hz. */
export const NASAL_BAND = Object.freeze({ lo: 200, hi: 1500 });
/** Bande de comparaison du test du nez pincé, en Hz. */
export const PINCH_BAND = Object.freeze({ lo: 200, hi: 4000 });

/** Au-delà de ce résidu, le son ne ressemble à aucune des deux références. */
export const RESIDUAL_LIMIT = 1.0;

/**
 * Indice continu : position du spectre courant entre la référence orale (0)
 * et la référence nasale volontaire (1) de la même personne.
 * Renvoie { value, residual, inModel } ou null si les références sont confondues.
 */
export function nasalIndex(levels, oralRef, nasalRef) {
  const p = project(levels, oralRef, nasalRef);
  if (!p) return null;
  return {
    value: Math.min(1, Math.max(0, p.t)),
    residual: p.residual,
    inModel: p.residual <= RESIDUAL_LIMIT,
  };
}

/** Seuils empiriques du test du nez pincé (non validés cliniquement). */
export const PINCH_THRESHOLDS = Object.freeze({
  minFloorDb: 0.5,
  clearRatio: 2.0,
  clearDiffDb: 1.5,
  noneRatio: 1.3,
});

/**
 * Test du nez pincé : compare deux prises de la même voyelle, nez libre puis nez pincé.
 * Chaque prise = { frames: [vecteur de niveaux par bande], levelDb }.
 * Le plancher est la variation interne de chaque prise (1re moitié contre 2de moitié) :
 * une différence entre prises ne compte que si elle dépasse nettement ce plancher.
 */
export function comparePinch(open, pinched, thresholds = PINCH_THRESHOLDS) {
  const half = (frames) => {
    const m = frames.length >> 1;
    return meanAbsDiff(meanVector(frames.slice(0, m)), meanVector(frames.slice(m)));
  };
  if (open.frames.length < 4 || pinched.frames.length < 4) return null;

  const diffDb = meanAbsDiff(meanVector(open.frames), meanVector(pinched.frames));
  const floorDb = Math.max(thresholds.minFloorDb, mean([half(open.frames), half(pinched.frames)]));
  const ratio = diffDb / floorDb;

  let verdict = 'uncertain';
  if (ratio >= thresholds.clearRatio && diffDb >= thresholds.clearDiffDb) verdict = 'changed';
  else if (ratio < thresholds.noneRatio) verdict = 'unchanged';

  return { diffDb, floorDb, ratio, levelDeltaDb: pinched.levelDb - open.levelDb, verdict };
}
