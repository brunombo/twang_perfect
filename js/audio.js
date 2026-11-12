// Accès au microphone et chaîne Web Audio.

export const FFT_SIZE = 4096;

/** Le navigateur peut-il donner le micro à cette page ? */
export function micSupport() {
  if (!window.isSecureContext) return { ok: false, code: 'insecure' };
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return { ok: false, code: 'unsupported' };
  }
  return { ok: true, code: null };
}

/** Message d'aide pour une page qui ne peut pas demander le micro. */
export function supportMessage(code) {
  if (code === 'insecure') {
    return (
      `Le navigateur bloque le micro, car cette page n'est pas ouverte par une adresse sécurisée ` +
      `(adresse actuelle : ${location.protocol}//…). Ouvrez l'outil par son adresse https:// ` +
      `au lieu d'ouvrir le fichier téléchargé.`
    );
  }
  return `Ce navigateur ne propose pas l'accès au micro pour les pages web. Essayez Firefox ou Chrome à jour.`;
}

/** Ouvre le micro sans traitement automatique et branche un analyseur de spectre. */
export async function startMic() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  if (ctx.state === 'suspended') await ctx.resume();

  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser);

  const track = stream.getAudioTracks()[0];
  const settings = track && track.getSettings ? track.getSettings() : {};
  return {
    ctx,
    stream,
    analyser,
    sampleRate: ctx.sampleRate,
    binHz: ctx.sampleRate / FFT_SIZE,
    // true si le navigateur a gardé un traitement malgré la demande.
    processed: Boolean(settings.autoGainControl || settings.noiseSuppression || settings.echoCancellation),
  };
}

export function stopMic(mic) {
  for (const t of mic.stream.getTracks()) t.stop();
  mic.ctx.close().catch(() => {});
}

/** Traduit une erreur getUserMedia en consigne utilisable. */
export function describeMicError(err) {
  switch (err && err.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return (
        `Accès au micro refusé. Touchez le cadenas de la barre d'adresse, autorisez le microphone ` +
        `pour ce site, puis réessayez. Sur téléphone, vérifiez aussi l'autorisation « Microphone » ` +
        `du navigateur dans les réglages du système.`
      );
    case 'NotFoundError':
    case 'OverconstrainedError':
      return `Aucun microphone trouvé. Branchez-en un ou vérifiez qu'il n'est pas désactivé.`;
    case 'NotReadableError':
    case 'AbortError':
      return `Le microphone est occupé ou indisponible. Fermez les autres applications qui l'utilisent, puis réessayez.`;
    default:
      return `Le micro n'a pas pu démarrer (${(err && err.name) || 'erreur inconnue'}).`;
  }
}
