// MacMovieMaker — Milestone 5 audio helpers.
// Pure, DOM-free mix math: fade envelopes, emphasis ducking, span fitting,
// MIME/extension maps, narration filenames. Node-safe.

export const FADE_SECONDS = { none: 0, slow: 3, medium: 1.5, fast: 0.75 };
export const DUCK_LEVEL = 0.25; // non-emphasized tracks drop to this gain

/** Gain multiplier (0..1) for fade in/out at local seconds into the kept span. */
export function fadeEnvelope(fadeIn, fadeOut, local, kept) {
  if (kept <= 0) return 0;
  const rel = Math.min(Math.max(local, 0), kept);
  let env = 1;
  const fi = Math.min(FADE_SECONDS[fadeIn] ?? 0, kept);
  const fo = Math.min(FADE_SECONDS[fadeOut] ?? 0, kept);
  if (fi > 0 && rel < fi) env *= rel / fi;
  if (fo > 0 && rel > kept - fo) env *= (kept - rel) / fo;
  return env;
}

/** Playhead position on the audio lane as a 0..1 fraction of the project. */
export function audioLaneFraction(t, total) {
  if (!(total > 0)) return 0;
  return Math.min(1, Math.max(0, t / total));
}

/** Emphasis ducking factor for a track kind ('music'|'narration'|'video'). */
export function emphasisFactor(emphasis, kind) {
  if (!emphasis || emphasis === "none") return 1;
  return emphasis === kind ? 1 : DUCK_LEVEL;
}

/**
 * Scale photo kept-spans so they sum to target (Fit to music), then absorb
 * rounding on the last span. Returns null when infeasible.
 */
export function scaleSpans(kepts, target, min = 0.5) {
  const sum = kepts.reduce((a, k) => a + k, 0);
  if (sum <= 0 || target < kepts.length * min) return null;
  const f = target / sum;
  const out = kepts.map((k) => Math.max(min, k * f));
  const resid = out.reduce((a, k) => a + k, 0) - target;
  const last = out.length - 1;
  out[last] = Math.max(min, out[last] - resid);
  return out;
}

const MIME_BY_EXT = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  aiff: "audio/aiff",
  aif: "audio/aiff",
  ogg: "audio/ogg",
  opus: "audio/opus",
  flac: "audio/flac",
  mp4: "audio/mp4",
  webm: "audio/webm",
};

export const mimeForExt = (ext) => MIME_BY_EXT[String(ext || "").toLowerCase()] || "audio/mpeg";

const EXT_BY_MIME = {
  "audio/mp4": "m4a",
  "audio/aac": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
};

export const extForMime = (mime) => EXT_BY_MIME[String(mime || "").split(";")[0].toLowerCase()] || "m4a";

/** "narration-20261009-143022.m4a" style names for saved takes. */
export function narrationFileName(date, mime) {
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `narration-${stamp}.${extForMime(mime)}`;
}

export const AUDIO_EXTS = ["mp3", "m4a", "aac", "wav", "aiff", "aif", "ogg", "opus", "flac"];
