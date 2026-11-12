// Tracés sur <canvas>. L'axe vertical va de 0 % (voix neutre) à 120 %.

export const Y_MAX = 1.2;

const PAD = { left: 44, right: 10, top: 10, bottom: 20 };
const FONT = '11px "IBM Plex Mono", ui-monospace, Menlo, monospace';

let palette = null;
function colors() {
  if (!palette) {
    const css = getComputedStyle(document.documentElement);
    const v = (name) => css.getPropertyValue(name).trim();
    palette = {
      ink: v('--ink'),
      muted: v('--muted'),
      hair: v('--hair'),
      plot: v('--plot'),
      vermilion: v('--vermilion'),
      slate: v('--slate'),
      sage: v('--sage'),
    };
  }
  return palette;
}

function prepare(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const plot = { x: PAD.left, y: PAD.top, w: w - PAD.left - PAD.right, h: h - PAD.top - PAD.bottom };
  return { ctx, w, h, plot };
}

function yOf(plot, v) {
  return plot.y + (1 - v / Y_MAX) * plot.h;
}

function frame(ctx, plot, c) {
  ctx.fillStyle = c.plot;
  ctx.fillRect(plot.x, plot.y, plot.w, plot.h);
  ctx.font = FONT;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const [v, label] of [[0, 'neutre'], [0.5, '50 %'], [1, 'twang']]) {
    const y = yOf(plot, v);
    ctx.strokeStyle = c.hair;
    ctx.lineWidth = 1;
    ctx.setLineDash(v === 0.5 ? [3, 4] : []);
    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.w, y);
    ctx.stroke();
    ctx.fillStyle = c.muted;
    ctx.fillText(label, plot.x - 6, y);
  }
  ctx.setLineDash([]);
}

function targetBand(ctx, plot, c, lo, hi) {
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = c.sage;
  ctx.fillRect(plot.x, yOf(plot, hi), plot.w, yOf(plot, lo) - yOf(plot, hi));
  ctx.globalAlpha = 1;
}

// points : [{ t, v }] avec v = null pendant les silences (la courbe s'interrompt).
function curve(ctx, plot, points, xOf, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  let pen = false;
  for (const p of points) {
    if (p.v === null) {
      pen = false;
      continue;
    }
    const x = xOf(p.t);
    const y = yOf(plot, p.v);
    if (pen) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
    pen = true;
  }
  ctx.stroke();
}

function note(ctx, plot, c, text) {
  ctx.font = FONT;
  ctx.fillStyle = c.muted;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, plot.x + plot.w / 2, plot.y + plot.h / 2);
}

function xLabels(ctx, plot, c, left, right) {
  ctx.font = FONT;
  ctx.fillStyle = c.muted;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(left, plot.x, plot.y + plot.h + 5);
  ctx.textAlign = 'right';
  ctx.fillText(right, plot.x + plot.w, plot.y + plot.h + 5);
}

/** Trace roulante : les windowMs dernières millisecondes. */
export function drawRoll(canvas, points, now, { windowMs, lo, hi, hidden }) {
  const c = colors();
  const { ctx, plot } = prepare(canvas);
  frame(ctx, plot, c);
  targetBand(ctx, plot, c, lo, hi);
  if (hidden) note(ctx, plot, c, 'retour masqué pendant l’essai');
  else curve(ctx, plot, points, (t) => plot.x + (1 - (now - t) / windowMs) * plot.w, c.vermilion, 2);
  xLabels(ctx, plot, c, `il y a ${Math.round(windowMs / 1000)} s`, 'maintenant');
}

/** Ligne de session : tout depuis l'ouverture du micro. */
export function drawSession(canvas, points, now, { startedAt, hidden }) {
  const c = colors();
  const { ctx, plot } = prepare(canvas);
  frame(ctx, plot, c);
  const span = Math.max(1, now - startedAt);
  if (hidden) note(ctx, plot, c, 'retour masqué pendant l’essai');
  else if (points.length < 2) note(ctx, plot, c, 'la séance s’affichera ici');
  else curve(ctx, plot, points, (t) => plot.x + ((t - startedAt) / span) * plot.w, c.slate, 1.5);
  const minutes = Math.floor(span / 60000);
  const seconds = Math.floor((span % 60000) / 1000);
  xLabels(ctx, plot, c, 'début', `${minutes} min ${String(seconds).padStart(2, '0')} s`);
}

/** Historique : une barre par essai (les plus récents à droite). */
export function drawHistory(canvas, history, maxBars = 30) {
  const c = colors();
  const { ctx, plot } = prepare(canvas);
  ctx.fillStyle = c.plot;
  ctx.fillRect(plot.x, plot.y, plot.w, plot.h);
  ctx.font = FONT;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const v of [0, 50, 100]) {
    const y = plot.y + (1 - v / 100) * plot.h;
    ctx.strokeStyle = c.hair;
    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.w, y);
    ctx.stroke();
    ctx.fillStyle = c.muted;
    ctx.fillText(`${v} %`, plot.x - 6, y);
  }
  const bars = history.slice(-maxBars);
  if (bars.length === 0) {
    note(ctx, plot, c, 'aucun essai enregistré');
    return;
  }
  const slot = plot.w / maxBars;
  const barW = Math.max(2, slot - 3);
  bars.forEach((h, i) => {
    const hgt = (h.score / 100) * plot.h;
    ctx.fillStyle = h.blind ? c.slate : c.vermilion;
    ctx.fillRect(plot.x + i * slot + 1.5, plot.y + plot.h - hgt, barW, Math.max(1, hgt));
  });
  xLabels(ctx, plot, c, `${bars.length} dernier(s) essai(s)`, 'le plus récent →');
}
