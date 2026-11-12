// Orchestration : relie le micro, les calculs, l'état et l'affichage.

import * as dsp from './dsp.js';
import { NASAL_BAND, PINCH_BAND, nasalIndex, comparePinch } from './nasality.js';
import { trialPhase, scoreTrial, historyStats } from './exercise.js';
import { loadState, saveState, exportState } from './storage.js';
import { micSupport, supportMessage, startMic, describeMicError } from './audio.js';
import { drawRoll, drawSession, drawHistory, Y_MAX } from './charts.js';

// ---------- Constantes ----------

const ROLL_MS = 15000;
const SESSION_STEP_MS = 200;
const SESSION_MAX_POINTS = 6000;
const PREP_MS = 1500;
const PINCH_PREP_MS = 3500;
const CAPTURE_MS = 2500;
const MIN_VOICED_MS = 1000;
const COUNTDOWN_MS = 3000;
const NOISE_MS = 1000;
const SMOOTH_MS = 80;
const NASAL_SMOOTH_MS = 150;
const NASAL_SPREAD_MS = 600;
const PITCH_EVERY = 4;
const PITCH_SAMPLES = 2048;
const CLARITY_MIN = 0.5;
const MIN_GAP_DB = 0.5;
const WEAK_GAP_DB = 3;
const PITCH_TOLERANCE_ST = 2;

const LOW_EDGES = dsp.bandEdges(NASAL_BAND.lo, NASAL_BAND.hi);
const WIDE_EDGES = dsp.bandEdges(PINCH_BAND.lo, PINCH_BAND.hi);

// ---------- État ----------

const state = loadState();
const $ = (id) => document.getElementById(id);

let mic = null;
let freq = null;
let time = null;
let lastT = null;
let frameNo = 0;
let pitch = { f0: null, clarity: 0 };
let gateDb = -50;
let noise = null; // { until, levels }
let smoothB = null;
let smoothNasal = null;
let capture = null; // { kind, instruction, prepUntil, until, frames, voicedMs, onDone }
let trial = null; // { startAt, durationMs, lo, hi, blind, samples }
let sessionStart = 0;
let lastSessionT = 0;
let sessionStep = SESSION_STEP_MS;
const roll = [];
const session = [];
const nasalRecent = [];

const fr = (n, digits = 1) => n.toLocaleString('fr-FR', { maximumFractionDigits: digits, minimumFractionDigits: digits });

// ---------- Calibration ----------

function bandConfig() {
  return { ...dsp.DEFAULT_BAND, twangLo: state.band.twangLo, twangHi: state.band.twangHi };
}

function calReady() {
  const { neutral, twang } = state.calibration;
  return Boolean(neutral && twang && twang.b - neutral.b > MIN_GAP_DB);
}

function oralReference() {
  const { neutral, twang } = state.calibration;
  return dsp.meanVector([neutral.low, twang.low]);
}

function summarize(frames) {
  return {
    b: dsp.median(frames.map((f) => f.b)),
    low: dsp.meanVector(frames.map((f) => f.low)),
    f0: dsp.median(frames.map((f) => f.f0)),
    levelDb: dsp.mean(frames.map((f) => f.level)),
    wideFrames: frames.map((f) => f.wide),
  };
}

function startCapture(kind, instruction, prepMs, onDone) {
  if (!mic || capture || trial) return;
  const now = performance.now();
  capture = { kind, instruction, prepUntil: now + prepMs, until: now + prepMs + CAPTURE_MS, frames: [], voicedMs: 0, onDone };
  refreshButtons();
}

function finishCapture() {
  const done = capture;
  capture = null;
  refreshButtons();
  if (done.voicedMs < MIN_VOICED_MS) {
    done.onDone(null);
    return;
  }
  done.onDone(summarize(done.frames));
}

const TOO_SHORT = 'Prise trop courte : la voix n’a pas été détectée assez longtemps. Chantez plus fort, ou remesurez le bruit ambiant en silence.';

function captureNeutral() {
  startCapture('neutral', 'Voix neutre, sans twang', PREP_MS, (s) => {
    if (!s) return setMsg('calMsg', TOO_SHORT);
    state.calibration.neutral = { b: s.b, low: s.low, f0: s.f0 };
    const { twang } = state.calibration;
    if (twang && twang.b - s.b <= MIN_GAP_DB) {
      state.calibration.twang = null;
      state.calibration.nasal = null;
      setMsg('calMsg', 'Cette voix neutre est aussi brillante que votre prise twang précédente : la prise twang est effacée, refaites-la.');
    } else {
      setMsg('calMsg', '');
    }
    persist();
    renderCalibration();
  });
}

function captureTwang() {
  if (!state.calibration.neutral) return setMsg('calMsg', 'Capturez d’abord la voix neutre.');
  startCapture('twang', 'Voix twang, la plus nette possible', PREP_MS, (s) => {
    if (!s) return setMsg('calMsg', TOO_SHORT);
    const { neutral } = state.calibration;
    const gap = s.b - neutral.b;
    if (gap <= MIN_GAP_DB) {
      return setMsg('calMsg', `Prise refusée : ce twang n’est pas plus brillant que votre voix neutre (écart ${fr(gap)} dB). Accentuez le twang ou refaites la voix neutre.`);
    }
    state.calibration.twang = { b: s.b, low: s.low, f0: s.f0 };
    state.calibration.nasal = null;
    const notes = [];
    if (gap < WEAK_GAP_DB) notes.push(`Écart faible entre les deux voix (${fr(gap)} dB) : la jauge sera nerveuse.`);
    const st = dsp.semitones(s.f0, neutral.f0);
    if (st !== null && Math.abs(st) > PITCH_TOLERANCE_ST) {
      notes.push(`Les deux prises ne sont pas sur la même note (${fr(Math.abs(st))} demi-tons d’écart) : refaites-les sur une seule note pour une mesure plus juste.`);
    }
    setMsg('calMsg', notes.join(' '));
    persist();
    renderCalibration();
  });
}

function captureNasalRef() {
  if (!calReady()) return;
  startCapture('nasal', 'Même voyelle, volontairement nasale', PREP_MS, (s) => {
    if (!s) return setMsg('nasalMsg', TOO_SHORT);
    const distance = dsp.meanAbsDiff(s.low, oralReference());
    state.calibration.nasal = { low: s.low, f0: s.f0 };
    setMsg('nasalMsg', distance < 1
      ? `Référence nasale très proche de votre référence orale (${fr(distance)} dB d’écart moyen) : l’indice distinguera mal les deux. Refaites une prise plus franchement nasale.`
      : '');
    persist();
  });
}

function runPinchTest() {
  startCapture('pinchOpen', 'Nez libre : tenez la voyelle', PREP_MS, (open) => {
    if (!open) return setMsg('pinchResult', TOO_SHORT);
    startCapture('pinchClosed', 'Pincez le nez, même voyelle, même note', PINCH_PREP_MS, (closed) => {
      if (!closed) return setMsg('pinchResult', TOO_SHORT);
      const r = comparePinch(
        { frames: open.wideFrames, levelDb: open.levelDb },
        { frames: closed.wideFrames, levelDb: closed.levelDb },
      );
      if (!r) return setMsg('pinchResult', TOO_SHORT);
      const verdict = {
        changed: 'Le spectre change nettement quand vous pincez le nez : une partie du son passe probablement par le nez.',
        unchanged: 'Le spectre ne change pas de façon mesurable quand vous pincez le nez : le son semble oral.',
        uncertain: 'Différence trop proche de la variation naturelle entre deux prises pour conclure. Refaites le test en tenant bien la même note.',
      }[r.verdict];
      const st = dsp.semitones(closed.f0, open.f0);
      const pitchNote = st !== null && Math.abs(st) > 1
        ? ` Attention : la note a bougé de ${fr(Math.abs(st))} demi-tons entre les deux prises, ce qui fausse la comparaison.`
        : '';
      setMsg('pinchResult', `${verdict} Écart de spectre : ${fr(r.diffDb)} dB (variation interne des prises : ${fr(r.floorDb)} dB). Niveau : ${r.levelDeltaDb >= 0 ? '+' : ''}${fr(r.levelDeltaDb)} dB.${pitchNote}`);
    });
  });
}

// ---------- Exercice ----------

function startTrial() {
  if (!mic || capture || trial) return;
  if (!calReady()) return setMsg('trialMsg', 'Faites d’abord la calibration (étape 2).');
  const lo = Math.min(state.settings.lo, state.settings.hi) / 100;
  const hi = Math.max(state.settings.lo, state.settings.hi) / 100;
  trial = {
    startAt: performance.now() + COUNTDOWN_MS,
    durationMs: state.settings.durationS * 1000,
    lo,
    hi,
    blind: state.settings.blind,
    samples: [],
  };
  $('result').hidden = true;
  setMsg('trialMsg', '');
  refreshButtons();
}

function finishTrial() {
  const done = trial;
  trial = null;
  const r = scoreTrial(done.samples, done.lo, done.hi, done.durationMs);
  state.history.push({
    t: new Date().toISOString(),
    score: r.score,
    insideS: r.insideMs / 1000,
    voicedS: r.voicedMs / 1000,
    durationS: done.durationMs / 1000,
    lo: done.lo,
    hi: done.hi,
    mean: r.mean,
    sd: r.sd,
    blind: done.blind,
  });
  const saved = persist();

  $('resScore').textContent = `${r.score} %`;
  const parts = [`${fr(r.insideMs / 1000)} s dans la cible sur ${fr(done.durationMs / 1000, 0)} s`];
  parts.push(`voix détectée pendant ${fr(r.voicedMs / 1000)} s`);
  if (r.mean !== null) parts.push(`brillance moyenne ${fr(r.mean * 100, 0)} %, variation ± ${fr(r.sd * 100, 0)} points`);
  $('resDetail').textContent = `${parts.join(' · ')}.`;
  $('result').hidden = false;
  setMsg('trialMsg', saved ? '' : 'Essai non enregistré : ce navigateur refuse le stockage local (navigation privée ?).');
  renderHistory();
  refreshButtons();
}

// ---------- Boucle d'analyse ----------

function frame(now) {
  if (!mic) return;
  requestAnimationFrame(frame);
  const dt = lastT === null ? 16 : Math.min(100, now - lastT);
  lastT = now;

  mic.analyser.getFloatFrequencyData(freq);
  mic.analyser.getFloatTimeDomainData(time);
  const level = dsp.rmsDb(time);
  if (frameNo++ % PITCH_EVERY === 0) {
    pitch = dsp.detectPitch(time.subarray(time.length - PITCH_SAMPLES), mic.sampleRate);
  }

  if (noise) {
    noise.levels.push(level);
    if (now >= noise.until) {
      gateDb = Math.min(-25, Math.max(-65, dsp.median(noise.levels) + 10));
      noise = null;
      refreshButtons();
    }
  }

  let f = null;
  if (!noise && level > gateDb && pitch.f0 && pitch.clarity >= CLARITY_MIN) {
    const b = dsp.brightnessDb(freq, mic.binHz, bandConfig());
    if (b !== null) {
      f = {
        b,
        level,
        f0: pitch.f0,
        low: dsp.bandLevels(freq, mic.binHz, LOW_EDGES),
        wide: dsp.bandLevels(freq, mic.binHz, WIDE_EDGES),
      };
    }
  }

  smoothB = f ? dsp.ema(smoothB, f.b, dt, SMOOTH_MS) : null;
  const cal = state.calibration;
  const norm = f && calReady() ? dsp.normalize(smoothB, cal.neutral.b, cal.twang.b, Y_MAX) : null;

  if (capture && now >= capture.prepUntil) {
    if (f) {
      capture.frames.push(f);
      capture.voicedMs += dt;
    }
    if (now >= capture.until) finishCapture();
  }

  if (trial) {
    const phase = trialPhase(trial, now);
    if (phase === 'running' && norm !== null) trial.samples.push({ v: norm, dt });
    if (phase === 'done') finishTrial();
  }

  roll.push({ t: now, v: norm });
  while (roll.length && now - roll[0].t > ROLL_MS) roll.shift();
  if (now - lastSessionT >= sessionStep) {
    lastSessionT = now;
    session.push({ t: now, v: norm });
    if (session.length > SESSION_MAX_POINTS) {
      // Séance longue : on garde un point sur deux et on espace les suivants.
      for (let i = 0; i < session.length / 2; i++) session[i] = session[i * 2];
      session.length = Math.floor(session.length / 2);
      sessionStep *= 2;
    }
  }

  render(now, dt, level, f, norm);
}

// ---------- Affichage ----------

function setMsg(id, text) {
  $(id).textContent = text;
}

function persist() {
  return saveState(state);
}

function refreshButtons() {
  const idle = Boolean(mic) && !capture && !trial && !noise;
  $('btnNoise').disabled = !idle;
  $('btnNeutral').disabled = !idle;
  $('btnTwang').disabled = !idle || !state.calibration.neutral;
  $('btnTrial').disabled = !idle || !calReady();
  $('btnPinch').disabled = !idle;
  $('btnNasalRef').disabled = !idle || !calReady();
  $('btnMic').textContent = mic ? 'Micro actif' : 'Activer le micro';
  $('btnMic').disabled = Boolean(mic);
}

function renderCalibration() {
  const { neutral, twang } = state.calibration;
  const show = (c) => (c ? `${fr(c.b)} dB · ${dsp.noteName(c.f0) || 'note inconnue'}` : '—');
  $('calNeutral').textContent = show(neutral);
  $('calTwang').textContent = show(twang);
  refreshButtons();
}

function renderSettings() {
  const s = state.settings;
  $('lo').value = s.lo;
  $('hi').value = s.hi;
  $('dur').value = s.durationS;
  $('blind').checked = s.blind;
  $('loVal').textContent = `${s.lo} %`;
  $('hiVal').textContent = `${s.hi} %`;
  $('durVal').textContent = `${s.durationS} s`;
  const lo = Math.min(s.lo, s.hi);
  const hi = Math.max(s.lo, s.hi);
  $('twangTarget').style.left = `${(lo / (Y_MAX * 100)) * 100}%`;
  $('twangTarget').style.width = `${((hi - lo) / (Y_MAX * 100)) * 100}%`;
  $('twLo').value = state.band.twangLo;
  $('twHi').value = state.band.twangHi;
}

function renderHistory() {
  drawHistory($('history'), state.history);
  const st = historyStats(state.history);
  $('histStats').textContent = st.count
    ? `${st.count} essai(s) · meilleur score ${st.best} % · moyenne des 5 derniers ${st.recent} %`
    : '';
  const rows = state.history.slice(-8).reverse().map((h) => {
    const d = new Date(h.t);
    const when = `${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    const target = `${Math.round(h.lo * 100)}–${Math.round(h.hi * 100)} %`;
    return `<tr><td>${when}</td><td>${target}</td><td>${Number(h.durationS)} s</td><td>${h.blind ? 'masqué' : 'visible'}</td><td class="num">${Number(h.score)} %</td></tr>`;
  });
  $('histList').innerHTML = rows.length
    ? `<table><thead><tr><th>Date</th><th>Cible</th><th>Durée</th><th>Retour</th><th class="num">Score</th></tr></thead><tbody>${rows.join('')}</tbody></table>`
    : '';
}

function renderBar(now) {
  const bar = $('bar');
  const progress = $('barProgress');
  let text = 'Micro inactif';
  let ratio = null;
  let alert = false;

  if (mic) text = `Micro actif · ${dsp.noteName(pitch.clarity >= CLARITY_MIN ? pitch.f0 : null) || 'silence'}`;
  if (noise) text = 'Mesure du bruit ambiant : restez silencieux…';
  if (capture) {
    alert = true;
    if (now < capture.prepUntil) {
      text = `${capture.instruction} — dans ${Math.ceil((capture.prepUntil - now) / 1000)}…`;
    } else {
      text = `${capture.instruction} — chantez maintenant`;
      ratio = (now - capture.prepUntil) / CAPTURE_MS;
    }
  }
  if (trial) {
    alert = true;
    if (now < trial.startAt) {
      text = `Essai dans ${Math.ceil((trial.startAt - now) / 1000)}…`;
    } else {
      text = `Tenez la cible — encore ${Math.ceil((trial.startAt + trial.durationMs - now) / 1000)} s`;
      ratio = (now - trial.startAt) / trial.durationMs;
    }
  }

  if ($('barText').textContent !== text) $('barText').textContent = text;
  bar.classList.toggle('alert', alert);
  progress.hidden = ratio === null;
  if (ratio !== null) progress.value = Math.min(1, Math.max(0, ratio));
}

function renderNasal(now, dt, f) {
  const { nasal } = state.calibration;
  if (!nasal || !calReady()) {
    $('nasalFill').style.width = '0%';
    $('nasalVal').textContent = 'non calibré';
    return;
  }
  const idx = f ? nasalIndex(f.low, oralReference(), nasal.low) : null;
  if (!idx) {
    smoothNasal = null;
    nasalRecent.length = 0;
    $('nasalFill').style.width = '0%';
    $('nasalVal').textContent = '—';
    return;
  }
  smoothNasal = dsp.ema(smoothNasal, idx.value, dt, NASAL_SMOOTH_MS);
  nasalRecent.push({ t: now, v: idx.value });
  while (nasalRecent.length && now - nasalRecent[0].t > NASAL_SPREAD_MS) nasalRecent.shift();
  const spread = dsp.std(nasalRecent.map((p) => p.v));
  $('nasalFill').style.width = `${smoothNasal * 100}%`;
  $('nasalVal').textContent = idx.inModel
    ? `${Math.round(smoothNasal * 100)} % ± ${Math.round(spread * 100)}`
    : 'hors modèle';
}

function render(now, dt, level, f, norm) {
  renderBar(now);

  $('levelFill').style.width = `${Math.min(100, Math.max(0, ((level + 90) / 90) * 100))}%`;
  $('levelVal').textContent = noise ? 'mesure…' : `${Math.round(level)} dB · seuil ${Math.round(gateDb)} dB`;
  $('gateMark').hidden = Boolean(noise);
  $('gateMark').style.left = `${((gateDb + 90) / 90) * 100}%`;

  const hidden = Boolean(trial && trial.blind && trialPhase(trial, now) === 'running');
  $('noteVal').textContent = f ? `${dsp.noteName(f.f0)} · ${Math.round(f.f0)} Hz` : '—';

  const refF0 = state.calibration.neutral && state.calibration.neutral.f0;
  const st = f && calReady() ? dsp.semitones(f.f0, refF0) : null;
  setMsg('pitchWarn', st !== null && Math.abs(st) > PITCH_TOLERANCE_ST
    ? `Vous chantez ${fr(Math.abs(st), 0)} demi-tons ${st > 0 ? 'au-dessus' : 'au-dessous'} de la note de calibration : la mesure est moins fiable.`
    : '');

  if (hidden) {
    $('twangFill').style.width = '0%';
    $('twangVal').textContent = 'masqué';
  } else if (norm === null) {
    $('twangFill').style.width = '0%';
    $('twangVal').textContent = f && !calReady() ? 'calibration à faire' : '—';
  } else {
    $('twangFill').style.width = `${(norm / Y_MAX) * 100}%`;
    $('twangVal').textContent = `${Math.round(norm * 100)} %`;
  }

  renderNasal(now, dt, f);

  const s = state.settings;
  const lo = (trial ? trial.lo * 100 : Math.min(s.lo, s.hi)) / 100;
  const hi = (trial ? trial.hi * 100 : Math.max(s.lo, s.hi)) / 100;
  drawRoll($('roll'), roll, now, { windowMs: ROLL_MS, lo, hi, hidden });
  drawSession($('session'), session, now, { startedAt: sessionStart, hidden });
}

function drawIdle() {
  const s = state.settings;
  const now = performance.now();
  drawRoll($('roll'), [], now, { windowMs: ROLL_MS, lo: Math.min(s.lo, s.hi) / 100, hi: Math.max(s.lo, s.hi) / 100, hidden: false });
  drawSession($('session'), [], now, { startedAt: now, hidden: false });
  drawHistory($('history'), state.history);
}

// ---------- Démarrage du micro ----------

function measureNoise() {
  noise = { until: performance.now() + NOISE_MS, levels: [] };
  refreshButtons();
}

async function keepScreenOn() {
  try {
    if ('wakeLock' in navigator) await navigator.wakeLock.request('screen');
  } catch {
    // Refus possible (économie d'énergie) : sans conséquence pour la mesure.
  }
}

async function activateMic() {
  const support = micSupport();
  if (!support.ok) return setMsg('micMsg', supportMessage(support.code));
  $('btnMic').disabled = true;
  try {
    mic = await startMic();
  } catch (err) {
    $('btnMic').disabled = false;
    return setMsg('micMsg', describeMicError(err));
  }
  freq = new Float32Array(mic.analyser.frequencyBinCount);
  time = new Float32Array(mic.analyser.fftSize);
  sessionStart = performance.now();
  lastSessionT = 0;
  lastT = null;
  setMsg('micMsg', mic.processed
    ? 'Ce navigateur applique un traitement automatique au micro (réduction de bruit ou gain automatique) qui peut modifier le timbre mesuré. Calibrez et exercez-vous toujours sur le même appareil.'
    : '');
  measureNoise();
  keepScreenOn();
  requestAnimationFrame(frame);
}

// ---------- Événements ----------

$('btnMic').addEventListener('click', activateMic);
$('btnNoise').addEventListener('click', measureNoise);
$('btnNeutral').addEventListener('click', captureNeutral);
$('btnTwang').addEventListener('click', captureTwang);
$('btnNasalRef').addEventListener('click', captureNasalRef);
$('btnPinch').addEventListener('click', runPinchTest);
$('btnTrial').addEventListener('click', startTrial);

$('btnCalReset').addEventListener('click', () => {
  state.calibration = { neutral: null, twang: null, nasal: null };
  persist();
  setMsg('calMsg', '');
  renderCalibration();
});

for (const [id, key] of [['lo', 'lo'], ['hi', 'hi'], ['dur', 'durationS']]) {
  $(id).addEventListener('input', () => {
    state.settings[key] = Number($(id).value);
    persist();
    renderSettings();
    if (!mic) drawIdle();
  });
}
$('blind').addEventListener('change', () => {
  state.settings.blind = $('blind').checked;
  persist();
});

$('btnExport').addEventListener('click', () => exportState(state));
$('btnClear').addEventListener('click', () => {
  if (!confirm('Effacer tous les essais enregistrés ?')) return;
  state.history = [];
  persist();
  renderHistory();
});

$('btnBand').addEventListener('click', () => {
  const lo = Number($('twLo').value);
  const hi = Number($('twHi').value);
  if (!(lo >= 1000 && hi <= 8000 && hi - lo >= 300)) {
    return setMsg('bandMsg', 'Bande refusée : il faut 1 000 Hz au moins, 8 000 Hz au plus, et 300 Hz de largeur au minimum.');
  }
  state.band = { twangLo: lo, twangHi: hi };
  state.calibration = { neutral: null, twang: null, nasal: null };
  persist();
  renderCalibration();
  setMsg('bandMsg', `Bande appliquée : ${lo} à ${hi} Hz. Calibration effacée, refaites l’étape 2.`);
});

document.addEventListener('visibilitychange', () => {
  if (mic && document.visibilityState === 'visible') keepScreenOn();
});
window.addEventListener('resize', () => {
  if (!mic) drawIdle();
});

// ---------- Initialisation ----------

renderSettings();
renderCalibration();
renderHistory();
drawIdle();
const support = micSupport();
if (!support.ok) setMsg('micMsg', supportMessage(support.code));
