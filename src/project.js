// MacMovieMaker — Milestone 6 project file (.mmproj, JSON).
// Pure, DOM-free: serialize() captures the persistent subset of the live
// state; deserialize() validates, sanitizes, and reports warnings.
// Media bytes are never embedded (except snapshot data-URLs): clips keep a
// `file` path that the UI relinks on load. Node-safe.

import { transById, pzById } from "./gallery.js";
import { fxById } from "./effects.js";
import { animById, TEXT_ANIMS } from "./textanim.js";
import { FADE_SECONDS } from "./audio.js";
import { TRANS_DUR_MIN, TRANS_DUR_MAX } from "./clipops.js";

export const PROJECT_FORMAT = "mmproj";
export const PROJECT_VERSION = 1;
export const PROJECT_EXTENSIONS = ["mmproj"];

const KINDS = new Set(["video", "image", "title", "credits"]);
const AUDIO_KINDS = new Set(["music", "narration"]);
const FADE_KEYS = new Set(Object.keys(FADE_SECONDS));
const CLIP_FADES = new Set(["none", "black", "white"]);
const EMPHASES = new Set(["none", "video", "music", "narration"]);
const ASPECTS = new Set(["16:9", "4:3"]);

const num = (v, dflt) => (Number.isFinite(v) ? v : dflt);
const clamp = (v, lo, hi, dflt) => {
  const n = num(v, dflt);
  return Math.min(hi, Math.max(lo, n));
};
const str = (v, dflt = "") => (typeof v === "string" ? v : dflt);
const bool = (v) => v === true;

export function serializeProject(state) {
  const clips = state.clips.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    file: c.file || "",
    // Blob/asset URLs die with the session; only data-URLs (snapshots) persist.
    url: typeof c.url === "string" && c.url.startsWith("data:") ? c.url : "",
    duration: c.duration,
    in: c.in,
    out: c.out,
    rotation: c.rotation,
    volume: c.volume,
    muted: c.muted,
    transition: c.transition ? { ...c.transition } : null,
    panZoom: c.panZoom ?? null,
    fx: c.fx ? { ...c.fx } : null,
    text: c.text ? { ...c.text } : null,
    caption: c.caption ? { ...c.caption } : null,
    thumb: c.thumb ?? null,
    playable: c.playable !== false,
  }));
  const audioClips = state.audioClips.map((a) => ({
    id: a.id,
    kind: a.kind,
    name: a.name,
    file: a.file || "",
    url: typeof a.url === "string" && a.url.startsWith("data:") ? a.url : "",
    offset: a.offset,
    in: a.in,
    out: a.out,
    duration: a.duration,
    volume: a.volume,
    fadeIn: a.fadeIn,
    fadeOut: a.fadeOut,
    peaks: Array.isArray(a.peaks) ? a.peaks.slice(0, 256) : null,
  }));
  return {
    app: "MacMovieMaker",
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    aspect: state.aspect,
    emphasis: state.emphasis,
    nextId: state.nextId,
    nextAudioId: state.nextAudioId,
    selectedId: state.selectedId,
    selectedAudioId: state.selectedAudioId,
    clips,
    audioClips,
  };
}

function sanitizeText(t, warnings, where) {
  if (!t || typeof t !== "object") return null;
  const knownAnim = TEXT_ANIMS.some((a) => a.id === t.anim);
  if (t.anim != null && !knownAnim) {
    warnings.push(`${where}: unknown text animation “${t.anim}” — reset to Basic.`);
  }
  return {
    ...t,
    content: str(t.content),
    fontFamily: str(t.fontFamily, "system"),
    fontSize: clamp(t.fontSize, 8, 160, 48),
    color: str(t.color, "#ffffff"),
    opacity: clamp(t.opacity, 0.1, 1, 1),
    bold: bool(t.bold),
    italic: bool(t.italic),
    align: ["left", "center", "right"].includes(t.align) ? t.align : "center",
    bg: str(t.bg, "#1f2937"),
    x: clamp(t.x, 0, 1, 0.5),
    y: clamp(t.y, 0, 1, 0.5),
    anim: knownAnim ? t.anim : animById(undefined).id,
    dur: num(t.dur, 7) > 0 ? num(t.dur, 7) : 7,
    offset: Math.max(0, num(t.offset, 0)),
  };
}

function sanitizeClip(raw, warnings) {
  if (!raw || typeof raw !== "object") return null;
  const name = str(raw.name, "Untitled");
  if (!KINDS.has(raw.kind)) {
    warnings.push(`Dropped “${name}”: unknown clip kind “${raw.kind}”.`);
    return null;
  }
  const duration = Math.max(0, num(raw.duration, 0));
  let start = Math.max(0, num(raw.in, 0));
  let end = num(raw.out, duration);
  if (!Number.isFinite(end) || end < start) {
    warnings.push(`“${name}”: invalid trim range — reset to the full clip.`);
    start = 0;
    end = duration;
  }
  let transition = null;
  if (raw.transition) {
    if (transById(raw.transition.id)) {
      transition = {
        id: raw.transition.id,
        duration: clamp(raw.transition.duration, TRANS_DUR_MIN, TRANS_DUR_MAX, 1),
      };
    } else {
      warnings.push(`“${name}”: unknown transition “${raw.transition.id}” — removed.`);
    }
  }
  let panZoom = null;
  if (raw.panZoom != null) {
    if (raw.kind !== "image") {
      warnings.push(`“${name}”: pan/zoom only applies to photos — removed.`);
    } else if (pzById(raw.panZoom)) {
      panZoom = raw.panZoom;
    } else {
      warnings.push(`“${name}”: unknown pan/zoom preset — removed.`);
    }
  }
  const fxRaw = raw.fx && typeof raw.fx === "object" ? raw.fx : {};
  const effect = fxById(fxRaw.effect) ? fxRaw.effect : "none";
  if (fxRaw.effect != null && effect === "none" && fxRaw.effect !== "none") {
    warnings.push(`“${name}”: unknown effect “${fxRaw.effect}” — removed.`);
  }
  return {
    id: num(raw.id, -1),
    name,
    kind: raw.kind,
    file: str(raw.file),
    url: typeof raw.url === "string" && raw.url.startsWith("data:") ? raw.url : "",
    duration,
    in: start,
    out: end,
    rotation: [0, 90, 180, 270].includes(raw.rotation) ? raw.rotation : 0,
    volume: clamp(raw.volume, 0, 1, 1),
    muted: bool(raw.muted),
    transition,
    panZoom,
    fx: {
      effect,
      brightness: clamp(fxRaw.brightness, -1, 1, 0),
      fadeIn: CLIP_FADES.has(fxRaw.fadeIn) ? fxRaw.fadeIn : "none",
      fadeOut: CLIP_FADES.has(fxRaw.fadeOut) ? fxRaw.fadeOut : "none",
    },
    text: sanitizeText(raw.text, warnings, `“${name}”`),
    caption: sanitizeText(raw.caption, warnings, `Caption on “${name}”`),
    thumb: typeof raw.thumb === "string" ? raw.thumb : null,
    playable: raw.playable !== false,
  };
}

function sanitizeAudio(raw, warnings) {
  if (!raw || typeof raw !== "object") return null;
  const name = str(raw.name, "Audio");
  if (!AUDIO_KINDS.has(raw.kind)) {
    warnings.push(`Dropped audio “${name}”: unknown kind “${raw.kind}”.`);
    return null;
  }
  const duration = Math.max(0, num(raw.duration, 0));
  const start = Math.max(0, num(raw.in, 0));
  let end = num(raw.out, duration);
  if (!Number.isFinite(end) || end < start) end = duration;
  const peaks = Array.isArray(raw.peaks) && raw.peaks.every(Number.isFinite) ? raw.peaks.slice(0, 256) : null;
  return {
    id: num(raw.id, -1),
    kind: raw.kind,
    name,
    file: str(raw.file),
    url: typeof raw.url === "string" && raw.url.startsWith("data:") ? raw.url : "",
    offset: Math.max(0, num(raw.offset, 0)),
    in: start,
    out: end,
    duration,
    volume: clamp(raw.volume, 0, 1, 1),
    fadeIn: FADE_KEYS.has(raw.fadeIn) ? raw.fadeIn : "none",
    fadeOut: FADE_KEYS.has(raw.fadeOut) ? raw.fadeOut : "none",
    peaks,
  };
}

export function deserializeProject(doc) {
  const warnings = [];
  if (!doc || typeof doc !== "object") throw new Error("That file isn't a project file.");
  if (doc.app !== "MacMovieMaker" || doc.format !== PROJECT_FORMAT) {
    throw new Error("That file isn't a MacMovieMaker project.");
  }
  if (doc.version !== PROJECT_VERSION) {
    if (Number.isFinite(doc.version) && doc.version > PROJECT_VERSION) {
      throw new Error("This project needs a newer MacMovieMaker to open.");
    }
    throw new Error("That project file is too old or corrupt to open.");
  }
  const clips = [];
  for (const raw of Array.isArray(doc.clips) ? doc.clips : []) {
    const c = sanitizeClip(raw, warnings);
    if (c) clips.push(c);
  }
  const audioClips = [];
  for (const raw of Array.isArray(doc.audioClips) ? doc.audioClips : []) {
    const a = sanitizeAudio(raw, warnings);
    if (a) audioClips.push(a);
  }
  const ids = new Set(clips.map((c) => c.id));
  const audioIds = new Set(audioClips.map((a) => a.id));
  const maxId = Math.max(0, ...ids, 0);
  const maxAudioId = Math.max(0, ...audioIds, 0);
  return {
    state: {
      aspect: ASPECTS.has(doc.aspect) ? doc.aspect : "16:9",
      emphasis: EMPHASES.has(doc.emphasis) ? doc.emphasis : "none",
      clips,
      audioClips,
      nextId: Math.max(num(doc.nextId, 1), maxId + 1, 1),
      nextAudioId: Math.max(num(doc.nextAudioId, 1), maxAudioId + 1, 1),
      selectedId: ids.has(doc.selectedId) ? doc.selectedId : null,
      selectedAudioId: audioIds.has(doc.selectedAudioId) ? doc.selectedAudioId : null,
    },
    warnings,
  };
}
