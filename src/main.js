/* MacMovieMaker — Milestone 3 frontend.
   Canvas-composited monitor: sequence playback renders transitions, Ken Burns
   pan/zoom, rotation, and trim live at preview time. (FFmpeg-side export
   rendering is a later milestone.) Editing rules live in clipops.js,
   gallery data/renderers in gallery.js. */

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  PHOTO_DURATION,
  clamp,
  createClip,
  keptDuration,
  setInPoint,
  setOutPoint,
  splitPointValid,
  splitClip,
  deleteClip,
  rotateClip,
  History,
  TRANS_DUR_MIN,
  TRANS_DUR_MAX,
  TRANS_DUR_DEFAULT,
  computeLayout,
  locAtT,
  moveClipIn,
  insertionGap,
  reorderChanged,
} from "./clipops.js";
import {
  TRANSITIONS,
  TRANS_RENDER,
  transById,
  PANZOOM_PRESETS,
  PZ_GROUPS,
  pzById,
  panZoomSource,
  paintTransThumb,
  paintPZThumb,
} from "./gallery.js";
import {
  EFFECTS,
  fxById,
  DEFAULT_FX,
  applyPixelChain,
  boxBlur,
  paintVignette,
  paintGrain,
  paintScratch,
  paintLetterbox,
  fadeAlphas,
  paintFxThumb,
} from "./effects.js";
import {
  fadeEnvelope,
  emphasisFactor,
  scaleSpans,
  audioLaneFraction,
  mimeForExt,
  narrationFileName,
  AUDIO_EXTS,
} from "./audio.js";
import { THEMES, themeById } from "./automovie.js";
import {
  SAVE_PRESETS,
  SHARE_SERVICES,
  buildExportPlan,
  resolvePreset,
  estimateMBPerMin,
  presetBlurb,
  loadCustomPresets,
  saveCustomPreset,
} from "./export.js";
import { serializeProject, deserializeProject, PROJECT_EXTENSIONS } from "./project.js";
import { writeFile, writeTextFile, readTextFile, mkdir, exists, remove } from "@tauri-apps/plugin-fs";
import { audioDir, join, tempDir, videoDir } from "@tauri-apps/api/path";
import {
  TEXT_ANIMS,
  animById,
  makeText,
  fontOf,
  FONT_STACKS,
  paintAnimThumb,
} from "./textanim.js";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/* ---------------------------------------------------------------- icons
   Original 24px stroke icons drawn for this project. */
const P = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

const ICONS = {
  save: P(`<path d="M5 4h11l4 4v12H5z"/><path d="M8 4v5h7V4"/><rect x="8" y="14" width="8" height="6"/>`),
  undo: P(`<path d="M8 6L4 10l4 4"/><path d="M4 10h9a6 6 0 0 1 0 12h-2"/>`),
  redo: P(`<path d="M16 6l4 4-4 4"/><path d="M20 10h-9a6 6 0 0 0 0 12h2"/>`),
  paste: P(`<rect x="6" y="6" width="12" height="14" rx="2"/><path d="M9 6V4h7l3 3v3"/>`),
  cut: P(`<circle cx="7" cy="7" r="2.4"/><circle cx="7" cy="17" r="2.4"/><path d="M9 8.5L20 19M9 15.5L20 5"/>`),
  copy: P(`<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>`),
  "add-photo": P(`<rect x="3" y="5" width="14" height="14" rx="2"/><circle cx="8" cy="10" r="1.6"/><path d="M4 17l4.5-4.5 3 3 2.5-2.5L17 16"/><path d="M19 13v6M16 16h6"/>`),
  music: P(`<circle cx="7" cy="17" r="3"/><path d="M10 17V5l9-2v12"/><circle cx="16" cy="15" r="3"/>`),
  mic: P(`<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>`),
  webcam: P(`<rect x="3" y="6" width="18" height="12" rx="3"/><circle cx="12" cy="12" r="3.4"/><circle cx="12" cy="12" r="1" fill="currentColor"/>`),
  snapshot: P(`<rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13" r="3.6"/><path d="M8 7l1.2-2h5.6L16 7"/>`),
  title: P(`<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6M12 9v7"/>`),
  caption: P(`<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M11 10.5h4M12 10.5V15M8 17.5h8"/>`),
  credits: P(`<path d="M6 4h12v16l-3-2-3 2-3-2-3 2z"/><path d="M9 9h6M9 12h6M9 15h4"/>`),
  rotl: P(`<path d="M4 9V4h5"/><path d="M4.5 9a8 8 0 1 1-1 6"/>`),
  rotr: P(`<path d="M20 9V4h-5"/><path d="M19.5 9a8 8 0 1 0 1 6"/>`),
  remove: P(`<path d="M6 6l12 12M18 6L6 18"/>`),
  "select-all": P(`<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3.5 2.5"/><path d="M9 12l2 2 4-4.5"/>`),
  export: P(`<path d="M12 15V3M7.5 7.5L12 3l4.5 4.5"/><path d="M4 13v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"/>`),
  upload: P(`<circle cx="6" cy="12" r="2.6"/><circle cx="17" cy="5.5" r="2.6"/><circle cx="17" cy="18.5" r="2.6"/><path d="M8.3 10.8l6.4-3.9M8.3 13.2l6.4 3.9"/>`),
  "file-new": P(`<path d="M6 3h8l4 4v14H6z"/><path d="M12 11v6M9 14h6"/>`),
  "file-open": P(`<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>`),
  play: P(`<path d="M8 5l11 7-11 7z" fill="currentColor" stroke="none"/>`),
  pause: P(`<rect x="7" y="5" width="3.4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.6" y="5" width="3.4" height="14" rx="1" fill="currentColor" stroke="none"/>`),
  prev: P(`<rect x="5" y="6" width="2.6" height="12" rx="1" fill="currentColor" stroke="none"/><path d="M19 6l-8 6 8 6z" fill="currentColor" stroke="none"/>`),
  next: P(`<rect x="16.4" y="6" width="2.6" height="12" rx="1" fill="currentColor" stroke="none"/><path d="M5 6l8 6-8 6z" fill="currentColor" stroke="none"/>`),
  fullscreen: P(`<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>`),
  plus: P(`<path d="M12 5v14M5 12h14"/>`),
  minus: P(`<path d="M5 12h14"/>`),
  fit: P(`<path d="M9 4H4v5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><rect x="9" y="9" width="6" height="6"/>`),
  film: P(`<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4"/>`),
  vol: P(`<path d="M4 10v4h3l4 3.5v-11L7 10z"/><path d="M15 9a4.2 4.2 0 0 1 0 6M17.5 6.5a8 8 0 0 1 0 11"/>`),
  mute: P(`<path d="M4 10v4h3l4 3.5v-11L7 10z"/><path d="M15.5 9.5l5 5M20.5 9.5l-5 5"/>`),
  split: P(`<circle cx="7" cy="7" r="2.4"/><circle cx="7" cy="17" r="2.4"/><path d="M9 8.5L20 19M9 15.5L20 5"/>`),
  trim: P(`<path d="M9 4v16M15 4v16"/><path d="M4 8l2 2-2 2M20 8l-2 2 2 2M4 14l2 2-2 2M20 14l-2 2 2 2"/>`),
  "in-point": P(`<path d="M6 4v16"/><path d="M10 8l6 4-6 4z" fill="currentColor" stroke="none"/>`),
  "out-point": P(`<path d="M18 4v16"/><path d="M14 8l-6 4 6 4z" fill="currentColor" stroke="none"/>`),
  fade: P(`<path d="M3 18L12 6l3 3 6-6"/><path d="M3 21h18" opacity="0.45"/>`),
  speed: P(`<circle cx="12" cy="13" r="8"/><path d="M12 13l4-4M9 3h6"/>`),
  steady: P(`<rect x="7" y="3" width="10" height="7" rx="2"/><path d="M12 10v9M8 17h8M4 7l2-2M20 7l-2-2"/>`),
  bright: P(`<circle cx="12" cy="12" r="4"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>`),
  opacity: P(`<circle cx="12" cy="12" r="7"/><path d="M12 5v14" opacity="0.4"/><path d="M12 5a7 7 0 0 1 0 14z" fill="currentColor" stroke="none" opacity="0.45"/>`),
  "align-l": P(`<path d="M4 6h16M4 11h11M4 16h16M4 21h11"/>`),
  "align-c": P(`<path d="M4 6h16M6.5 11h11M4 16h16M6.5 21h11"/>`),
  "align-r": P(`<path d="M4 6h16M9 11h11M4 16h16M9 21h11"/>`),
  "edit-text": P(`<path d="M5 19l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L9 18z"/><path d="M14.5 6.5l3 3"/>`),
  "bg-fill": P(`<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 15l4.5-4.5 3 3L16 9l4 4v7H4z" fill="currentColor" stroke="none" opacity="0.4"/>`),
  "rec-dot": P(`<circle cx="12" cy="12" r="7" fill="currentColor" stroke="none"/>`),
  "stop-sq": P(`<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>`),
  wide: P(`<rect x="2" y="7" width="20" height="10" rx="2"/>`),
  square: P(`<rect x="6" y="4" width="12" height="16" rx="2"/>`),
};

function injectIcons(root = document) {
  for (const el of root.querySelectorAll("[data-icon]")) {
    const art = ICONS[el.dataset.icon];
    if (art) el.innerHTML = art;
  }
}

/* ---------------------------------------------------------------- state */
const VIDEO_EXTS = new Set(["mp4", "mov", "m4v", "mkv", "avi", "wmv", "mpg", "mpeg", "webm", "3gp"]);
const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "bmp", "gif", "tif", "tiff", "webp", "heic", "heif"]);
const ALL_EXTS = [...VIDEO_EXTS, ...IMAGE_EXTS];

let clips = [];
let nextId = 1;
let selectedId = null;
let layout = { segments: [], total: 0 };
let T = 0; // project-time playhead, seconds
let playing = false;
let scrubHeld = false;
let volSnapshotTaken = false;
let trimEntryT = 0;
let trimEntryAbs = 0;
let dialogAbs = null; // trim-dialog live preview (absolute local secs) or null
let hover = null; // {kind:'trans'|'pz', ...} or null
let hoverFx = null; // effect id previewed from the FX gallery, or null
let dragging = null; // {text, moveX, moveY} while dragging a text box
let lastTextBox = null; // stage-coords hit box of the topmost drawn text
let brightSnapshotTaken = false;
let musicVolSnapshotTaken = false;
let snapCount = 0;

// Audio track state (M5): one music clip + any number of narration takes.
let audioClips = [];
let nextAudioId = 1;
let selectedAudioId = null;
let emphasis = "none"; // 'none' | 'video' | 'music' | 'narration'
let aspect = "16:9";
let recordOpen = false;
let narr = null; // active narration take while recording
let audioDrag = null;
let laneRenderSuppressed = false;
let justDraggedAudio = false;
let currentProjectPath = null;
let projectDirty = false;
let exportRun = null;
let stripDrag = null; // storyboard pointer-reorder state while a chip is dragged
let suppressStripClick = false; // a real drag must not reselect on mouseup
let audioCtx = null;
let masterGain = null;
const deckGains = new Map();
const audioNodes = new Map(); // audioClipId -> {el, gain}
let hintTimer = null;
const history = new History(50);

// Offscreen workspaces: text cards and the per-layer effects chain.
const textCanvas = document.createElement("canvas");
textCanvas.width = 960;
textCanvas.height = 540;
const fxCanvas = document.createElement("canvas");
const fxTiny = document.createElement("canvas");

const $ = (id) => document.getElementById(id);
const els = {};
for (const id of ["strip", "dropzone", "itemCount", "statusHint", "stage",
  "screen", "screenEmpty", "screenNotice", "timeReadout", "scrub", "btnPlay", "btnPrevFrame",
  "btnNextFrame", "btnFullscreen", "btnAddMedia", "btnRemove", "btnRotL", "btnRotR",
  "btnUndo", "btnRedo", "zoom", "btnZoomIn", "btnZoomOut", "btnFit", "boardPane",
  "browserFallbackInput", "monitorPane", "tabEdit", "volSlider", "volRow", "btnMute",
  "muteLabel", "btnSetIn", "btnSetOut", "btnSplit", "btnTrimTool", "btnERotL", "btnERotR",
  "clipDuration", "trimOverlay", "trimClipName", "trimStart", "trimEnd", "trimStartVal",
  "trimEndVal", "trimKept", "trimSave", "trimCancel", "transGallery", "pzGallery",
  "transDuration", "btnTransAll", "btnPzAll", "deckA", "deckB", "hoverA", "hoverB",
  "tabFormat", "btnTitle", "btnCaption", "btnCredits", "fxGallery", "brightSlider",
  "brightRow", "brightVal", "btnFadeInB", "btnFadeOutB", "btnFadeInW", "btnFadeOutW",
  "btnFxAll", "fmtFamily", "fmtSize", "fmtBold", "fmtItalic", "fmtColor", "fmtOpacity",
  "fmtAlignL", "fmtAlignC", "fmtAlignR", "fmtEditText", "fmtBgRow", "fmtBg",
  "fmtDuration", "fmtRemoveCaption", "animGallery", "textEditor", "textEditArea",
  "textEditSave", "textEditCancel", "tabMusic", "tabRecord", "btnAddMusic",
  "musicMenu", "btnMusicStart", "btnMusicPoint", "btnRecordNarration", "btnSnapshot",
  "audioBars", "audioEmpty", "musicVol", "musicFadeIn", "musicFadeOut", "musicOffset",
  "musicIn", "musicOut", "btnNarrRecord", "btnNarrStop", "btnNarrCancel", "narrLevel",
  "narrStatus", "btnFitMusic", "browserAudioInput", "btnSave",
  "fileNew", "fileOpen", "fileSave", "fileSaveAs", "filePresetList", "fileCustom",
  "fileShareList", "fileRecentList", "btnSaveMovie", "saveMovieMenu", "shareCol",
  "exportOverlay", "expTitle", "expPhase", "expFill", "expStats", "expWarnings",
  "expCancel", "expClose", "customOverlay", "custName", "custW", "custH",
  "custVbr", "custFps", "custEst", "custCancel", "custSave"]) {
  els[id] = $(id);
}

const stripPlayhead = document.createElement("div");
stripPlayhead.className = "playhead-line";
stripPlayhead.hidden = true;
const audioPlayhead = document.createElement("div");
audioPlayhead.className = "playhead-line";
audioPlayhead.hidden = true;

const stageCtx = els.stage.getContext("2d");
let STAGE_W = els.stage.width, STAGE_H = els.stage.height;
function syncStageSize() {
  STAGE_W = els.stage.width;
  STAGE_H = els.stage.height;
}

const selectedClip = () => clips.find((c) => c.id === selectedId) ?? null;
const clipsById = () => new Map(clips.map((c) => [c.id, c]));
const segOfClip = (id) => layout.segments.find((s) => s.clipId === id) ?? null;
const clipIndex = (id) => clips.findIndex((c) => c.id === id);
const extOf = (name) => (name.split(".").pop() || "").toLowerCase();
const snapshotState = () => ({
  clips, selectedId, nextId,
  audioClips, selectedAudioId, nextAudioId, emphasis, aspect,
});

function fmtTime(t) {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const c = Math.floor((t % 1) * 100);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

function hint(msg) {
  els.statusHint.textContent = msg;
  if (hintTimer) clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { els.statusHint.textContent = ""; }, 3500);
}

/* ---------------------------------------------------------------- intake */
function toSrc(pathOrFile) {
  if (typeof pathOrFile === "string") return isTauri ? convertFileSrc(pathOrFile) : pathOrFile;
  return URL.createObjectURL(pathOrFile); // browser fallback File object
}
function nameOf(pathOrFile) {
  if (typeof pathOrFile === "string") return pathOrFile.split("/").pop() || pathOrFile;
  return pathOrFile.name;
}

function kindFor(name) {
  const ext = extOf(name);
  if (VIDEO_EXTS.has(ext)) return "video";
  if (IMAGE_EXTS.has(ext)) return "image";
  return null;
}

async function probeVideo(url) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    v.crossOrigin = "anonymous";
    let settled = false;
    const done = (result) => { if (!settled) { settled = true; v.src = ""; resolve(result); } };
    const timer = setTimeout(() => done({ ok: false }), 10000);
    v.addEventListener("error", () => { clearTimeout(timer); done({ ok: false }); }, { once: true });
    v.addEventListener("loadedmetadata", () => {
      const duration = Number.isFinite(v.duration) ? v.duration : 0;
      const target = duration > 0 ? Math.min(1, duration * 0.1) : 0;
      const onFrame = () => { clearTimeout(timer); done({ ok: true, duration, thumb: captureFrame(v, 0) }); };
      v.addEventListener("seeked", onFrame, { once: true });
      setTimeout(onFrame, 2500); // fallback if seeked never fires (e.g. target 0)
      try { v.currentTime = target; } catch { /* fallback timer covers it */ }
    }, { once: true });
    v.src = url;
  });
}

async function probeImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const timer = setTimeout(() => resolve({ ok: false }), 10000);
    img.onload = () => { clearTimeout(timer); resolve({ ok: true, thumb: captureFrame(img, 0) }); };
    img.onerror = () => { clearTimeout(timer); resolve({ ok: false }); };
    img.src = url;
  });
}

/** Render a video frame or image into a 192x108 thumbnail, honoring rotation. */
function captureFrame(source, rotation = 0) {
  try {
    const w = source.videoWidth || source.naturalWidth || 0;
    const h = source.videoHeight || source.naturalHeight || 0;
    if (!w || !h) return null;
    const cw = 192, ch = 108;
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cw, ch);
    const r = ((rotation % 360) + 360) % 360;
    const swap = r === 90 || r === 270;
    const scale = Math.min(cw / (swap ? h : w), ch / (swap ? w : h));
    ctx.translate(cw / 2, ch / 2);
    ctx.rotate((r * Math.PI) / 180);
    ctx.drawImage(source, (-w * scale) / 2, (-h * scale) / 2, w * scale, h * scale);
    return canvas.toDataURL("image/jpeg", 0.72);
  } catch {
    return null; // e.g. canvas tainted by a codec path — use placeholder tile
  }
}

/** Paint a title/credits card thumbnail (192x108) into a canvas. */
function paintTextThumb(canvas, clip) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  const text = clip.text || makeText(clip.kind);
  ctx.fillStyle = text.bg || "#1f2937";
  ctx.fillRect(0, 0, w, h);
  const lines = String(text.content || "").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 3);
  ctx.fillStyle = text.color || "#fff";
  const stack = FONT_STACKS[text.fontFamily] || FONT_STACKS.system;
  ctx.font = `${text.italic ? "italic " : ""}${text.bold ? "bold " : ""}${Math.max(9, Math.round(text.fontSize * (w / 960)))}px ${stack}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const show = lines.length ? lines : [clip.kind === "credits" ? "Credits" : "Title"];
  const lh = Math.max(11, Math.round(text.fontSize * (w / 960) * 1.25));
  const y0 = h / 2 - ((show.length - 1) * lh) / 2;
  show.forEach((line, i) => ctx.fillText(line.length > 26 ? line.slice(0, 25) + "…" : line, w / 2, y0 + i * lh));
  return canvas.toDataURL("image/jpeg", 0.72);
}

/** Re-render a clip's thumbnail at an absolute media time (default: trim start). */
function regenThumb(clip, atTime = clip.in) {
  return new Promise((resolve) => {
    if (clip.kind === "title" || clip.kind === "credits") {
      const cv = document.createElement("canvas");
      cv.width = 192;
      cv.height = 108;
      try { resolve(paintTextThumb(cv, clip)); } catch { resolve(null); }
      return;
    }
    if (clip.kind === "image") {
      const img = new Image();
      img.crossOrigin = "anonymous";
      const timer = setTimeout(() => resolve(null), 8000);
      img.onload = () => { clearTimeout(timer); resolve(captureFrame(img, clip.rotation)); };
      img.onerror = () => { clearTimeout(timer); resolve(null); };
      img.src = clip.url;
      return;
    }
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    v.crossOrigin = "anonymous";
    let settled = false;
    const done = (thumb) => { if (!settled) { settled = true; v.src = ""; resolve(thumb); } };
    const timer = setTimeout(() => done(null), 8000);
    v.addEventListener("error", () => { clearTimeout(timer); done(null); }, { once: true });
    v.addEventListener("loadedmetadata", () => {
      const d = Number.isFinite(v.duration) ? v.duration : 0;
      const target = clamp(atTime, 0, Math.max(0, d - 0.05));
      const onFrame = () => { clearTimeout(timer); done(captureFrame(v, clip.rotation)); };
      v.addEventListener("seeked", onFrame, { once: true });
      setTimeout(onFrame, 2500);
      try { v.currentTime = target; } catch { /* fallback covers it */ }
    }, { once: true });
    v.src = clip.url;
  });
}

async function addSources(sources) {
  const fresh = [];
  for (const s of sources) {
    const name = nameOf(s);
    const kind = kindFor(name);
    if (!kind) continue;
    const url = toSrc(s);
    let clip;
    if (kind === "video") {
      const r = await probeVideo(url);
      clip = createClip({ id: nextId++, name, kind, url, duration: r.ok ? r.duration : 0, thumb: r.thumb ?? null, playable: r.ok });
    } else {
      const r = await probeImage(url);
      clip = createClip({ id: nextId++, name, kind, url, duration: PHOTO_DURATION, thumb: r.thumb ?? null, playable: r.ok });
      primeImage(clip.url);
    }
    clip.file = typeof s === "string" ? s : "";
    clips.push(clip);
    fresh.push(clip);
  }
  rebuildLayout();
  renderStrip();
  if (selectedId == null && clips.length > 0) selectClip(clips[0].id);
  else updateStatus();
  return fresh;
}

async function browseForMedia() {
  if (isTauri) {
    const picked = await open({
      multiple: true,
      title: "Add videos and photos",
      filters: [
        { name: "Videos and photos", extensions: ALL_EXTS },
        { name: "Videos", extensions: [...VIDEO_EXTS] },
        { name: "Photos", extensions: [...IMAGE_EXTS] },
      ],
    });
    if (picked) await addSources(Array.isArray(picked) ? picked : [picked]);
  } else {
    els.browserFallbackInput.click(); // plain-browser fallback
  }
}

/* ------------------------------------------------------------- storyboard */
function isTrimmed(clip) {
  return clip.in > 0.001 || clip.out < clip.duration - 0.001;
}

const KIND_LABEL = { video: "Video", image: "Photo", title: "Title", credits: "Credits" };

function chipTitle(clip) {
  let t = clip.name;
  if (clip.transition) {
    const def = transById(clip.transition.id);
    t += ` — ${def ? def.name : clip.transition.id} (${clip.transition.duration.toFixed(2)}s)`;
  }
  if (clip.panZoom) {
    const preset = pzById(clip.panZoom);
    if (preset) t += ` — ${preset.name}`;
  }
  if (clip.fx && clip.fx.effect && clip.fx.effect !== "none") {
    const def = fxById(clip.fx.effect);
    if (def) t += ` — ${def.name}`;
  }
  if (clip.caption) t += " — Caption";
  return t;
}

function renderStrip() {
  els.strip.innerHTML = "";
  els.dropzone.hidden = clips.length > 0;
  for (const clip of clips) {
    const b = document.createElement("button");
    b.className = "clip" + (clip.id === selectedId ? " selected" : "");
    b.dataset.id = clip.id;
    b.title = chipTitle(clip);
    const kept = keptDuration(clip);
    const label = kept > 0 ? fmtTime(kept).slice(0, 5) : "--:--";
    b.innerHTML = `
      ${clip.transition ? `<span class="trans-flag"></span>` : ""}
      <span class="film">
        <span class="sprockets"></span>
        <span class="thumb">${clip.thumb ? `<img src="${clip.thumb}" alt="" draggable="false" />` : `<span class="unplayable">${clip.playable ? "No preview" : "Preview unavailable"}</span>`}
          ${isTrimmed(clip) ? `<span class="trimmed-flag">Trimmed</span>` : ""}
          <span class="kind">${KIND_LABEL[clip.kind] || clip.kind}</span>
          <span class="badge">${label}</span>
        </span>
        <span class="sprockets"></span>
      </span>
      ${clip.caption ? `<span class="caption-bar"><span>T</span></span>` : ""}
      <span class="clip-name">${escapeHtml(clip.name)}</span>`;
    b.addEventListener("click", () => {
      if (suppressStripClick) { suppressStripClick = false; return; }
      selectClip(clip.id);
    });
    b.addEventListener("mousedown", (e) => beginStripDrag(e, clip.id));
    els.strip.appendChild(b);
  }
  els.strip.appendChild(stripPlayhead);
  renderAudioLane();
  updateStatus();
}

function clearStripDropMarks() {
  els.strip.querySelectorAll(".drop-before,.drop-after").forEach((el) =>
    el.classList.remove("drop-before", "drop-after"));
}
/* -------------------------------------- storyboard pointer reorder.
 * Plain mouse dragging instead of HTML5 DnD: deterministic in every engine,
 * same interaction as the audio-lane edge drags. A press without movement
 * falls through to the click listener, so selection is unchanged. */

function stripChipRects() {
  return [...els.strip.querySelectorAll(".clip")].map((el) => {
    const r = el.getBoundingClientRect();
    return { id: Number(el.dataset.id), left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  });
}

function beginStripDrag(e, id) {
  suppressStripClick = false;
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
  stripDrag = { id, x0: e.clientX, y0: e.clientY, px: e.clientX, py: e.clientY, active: false, gap: null, raf: 0 };
  document.addEventListener("mousemove", moveStripDrag);
  document.addEventListener("mouseup", endStripDrag);
  document.addEventListener("keydown", cancelStripDragOnEsc);
}

function paintStripGap() {
  clearStripDropMarks();
  const g = stripDrag?.gap;
  if (!g || g.id === stripDrag.id) return;
  els.strip.querySelector(`.clip[data-id="${g.id}"]`)
    ?.classList.toggle(g.before ? "drop-before" : "drop-after", true);
}

function moveStripDrag(e) {
  if (!stripDrag) return;
  stripDrag.px = e.clientX;
  stripDrag.py = e.clientY;
  if (!stripDrag.active) {
    if (Math.hypot(e.clientX - stripDrag.x0, e.clientY - stripDrag.y0) < 5) return;
    stripDrag.active = true;
    els.strip.querySelector(`.clip[data-id="${stripDrag.id}"]`)?.classList.add("drag-src");
    stripDrag.raf = requestAnimationFrame(tickStripDrag);
  }
  stripDrag.gap = insertionGap(stripChipRects(), e.clientX, e.clientY);
  paintStripGap();
}

function tickStripDrag() {
  if (!stripDrag?.active) return;
  const pane = els.boardPane;
  const r = pane.getBoundingClientRect();
  const M = 28, STEP = 14;
  let scrolled = false;
  if (stripDrag.py < r.top + M) { pane.scrollTop -= STEP; scrolled = true; }
  else if (stripDrag.py > r.bottom - M) { pane.scrollTop += STEP; scrolled = true; }
  if (stripDrag.px < r.left + M) { pane.scrollLeft -= STEP; scrolled = true; }
  else if (stripDrag.px > r.right - M) { pane.scrollLeft += STEP; scrolled = true; }
  if (scrolled) {
    stripDrag.gap = insertionGap(stripChipRects(), stripDrag.px, stripDrag.py);
    paintStripGap();
  }
  stripDrag.raf = requestAnimationFrame(tickStripDrag);
}

function teardownStripDrag() {
  document.removeEventListener("mousemove", moveStripDrag);
  document.removeEventListener("mouseup", endStripDrag);
  document.removeEventListener("keydown", cancelStripDragOnEsc);
  if (stripDrag?.raf) cancelAnimationFrame(stripDrag.raf);
  const d = stripDrag;
  stripDrag = null;
  clearStripDropMarks();
  els.strip.querySelector(".drag-src")?.classList.remove("drag-src");
  return d;
}

function endStripDrag(e) {
  const d = teardownStripDrag();
  if (!d?.active) return; // plain press: the click listener selects as usual
  suppressStripClick = true; // a real drag must not reselect on mouseup
  const gap = insertionGap(stripChipRects(), e.clientX, e.clientY);
  commitStripMove(d.id, gap);
}

function cancelStripDragOnEsc(e) {
  if (e.key !== "Escape" || !stripDrag) return;
  teardownStripDrag();
}

function commitStripMove(fromId, gap) {
  if (!gap || gap.id === fromId) return;
  if (narr?.recording) { hint("Stop the narration recording first."); return; }
  const ids = clips.map((c) => c.id);
  if (!reorderChanged(ids, fromId, gap.id, gap.before)) return;
  const name = clips.find((c) => c.id === fromId)?.name ?? "clip";
  moveClip(fromId, gap.id, gap.before);
  hint(`Moved \u201c${name}\u201d.`);
}

function moveClip(fromId, toId, before) {
  if (fromId === toId) return;
  if (clips.findIndex((c) => c.id === fromId) < 0 || clips.findIndex((c) => c.id === toId) < 0) return;
  history.push(snapshotState());
  moveClipIn(clips, fromId, toId, before);
  updateUndoButtons();
  pausePlayback();
  rebuildLayout();
  renderStrip();
  // Keep the playhead on the moved clip's first clean frame.
  if (selectedId != null) {
    const seg = segOfClip(selectedId);
    if (seg) T = seg.x ? seg.x.end : seg.bodyStart;
  }
}

function updateStatus() {
  const ai = audioClips.findIndex((c) => c.id === selectedAudioId);
  if (ai >= 0) {
    els.itemCount.textContent = `Audio ${ai + 1} of ${audioClips.length} \u2014 ${audioClips[ai].name}`;
    return;
  }
  const i = clips.findIndex((c) => c.id === selectedId);
  els.itemCount.textContent = clips.length === 0 ? "No clips" : `Item ${i + 1} of ${clips.length}`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

/* ---------------------------------------------------------- media pools */
const deckA = { el: els.deckA, clipId: null };
const deckB = { el: els.deckB, clipId: null };
const decks = [deckA, deckB];
const imgCache = new Map(); // url -> HTMLImageElement (loading or ready)
const thumbCache = new Map(); // clipId -> HTMLImageElement from storyboard thumb

function primeImage(url) {
  if (!url || imgCache.has(url)) return;
  const img = new Image();
  img.decoding = "async";
  // Tauri's asset protocol sends ACAO, so anonymous CORS keeps canvas pixels
  // readable for effects. Without this, getImageData throws (black preview).
  // See tests/media-cors.test.mjs.
  img.crossOrigin = "anonymous";
  img.src = url;
  imgCache.set(url, img);
}

function fullImg(clip) {
  primeImage(clip.url);
  const img = imgCache.get(clip.url);
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

function thumbImg(clip) {
  if (!clip.thumb) return null;
  let img = thumbCache.get(clip.id);
  if (!img) {
    img = new Image();
    img.src = clip.thumb;
    thumbCache.set(clip.id, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

function loadDeck(deck, clip) {
  if (deck.clipId === clip.id) return deck;
  deck.clipId = clip.id;
  if (deck.el.dataset.clip !== String(clip.id)) {
    deck.el.dataset.clip = String(clip.id);
    deck.el.src = clip.url;
  }
  return deck;
}

/** Assign a deck to a video clip, stealing the least-needed one. */
function deckFor(clip, keepIds) {
  if (deckA.clipId === clip.id) return deckA;
  if (deckB.clipId === clip.id) return deckB;
  const spare = !keepIds.has(deckA.clipId) ? deckA : deckB;
  return loadDeck(spare, clip);
}

/* ---------------------------------------------------------------- player */
function rebuildLayout() {
  layout = computeLayout(clips);
  T = clips.length ? clamp(T, 0, layout.total) : 0;
}

/** {clip, local} under the playhead; during overlaps, the majority side wins. */
function playhead() {
  if (!clips.length) return null;
  const loc = locAtT(layout, clipsById(), T);
  if (loc.type === "empty") return null;
  if (loc.type === "body") return { clip: clips[loc.i], local: loc.local };
  const incoming = clips[loc.i];
  if (loc.p >= 0.5 || loc.localA == null) return { clip: incoming, local: loc.localB };
  const from = clipsById().get(layout.segments[loc.i].x.fromId);
  return { clip: from, local: loc.localA };
}

/** First fully-visible frame of a segment (past its transition, if any). */
function cleanFrameT(seg) {
  return seg.x ? seg.x.end : seg.bodyStart;
}

function selectClip(id) {
  selectedId = id;
  selectedAudioId = null;
  const clip = selectedClip();
  if (clip) {
    const seg = segOfClip(id);
    if (seg) T = cleanFrameT(seg);
  }
  syncSelectionUI();
}

function syncSelectionUI() {
  document.querySelectorAll(".clip").forEach((el) =>
    el.classList.toggle("selected", Number(el.dataset.id) === selectedId));
  const clip = selectedClip();
  els.screenEmpty.style.display = clips.length ? "none" : "flex";
  if (clip && !clip.playable) {
    els.screenNotice.hidden = false;
    els.screenNotice.textContent =
      `“${clip.name}” can't be previewed in this build — ` +
      `FFmpeg-powered playback for this format arrives in a later milestone.`;
  } else {
    els.screenNotice.hidden = true;
  }
  updateEditTab();
  refreshEditPanel();
  refreshAnimPanel();
  updateFormatTab();
  refreshFormatPanel();
  refreshFxPanel();
  updateMusicTab();
  refreshMusicPanel();
  refreshProjectPanel();
  if (!laneRenderSuppressed) renderAudioLane();
  updateStatus();
}

/** Make sure the right media is loaded and roughly in position. */
function ensureMedia(loc) {
  if (loc.type === "empty") return;
  const needs = []; // [{clip, local}]
  if (loc.type === "body") {
    needs.push({ clip: clips[loc.i], local: loc.local });
    // Preload the incoming side shortly before an overlap starts.
    const seg = layout.segments[loc.i];
    const next = layout.segments[loc.i + 1];
    if (next?.x && seg.end - T < 1.5) {
      needs.push({ clip: clips[loc.i + 1], local: clips[loc.i + 1].in, preload: true });
    }
  } else {
    const seg = layout.segments[loc.i];
    if (loc.localA != null) needs.push({ clip: clipsById().get(seg.x.fromId), local: loc.localA });
    needs.push({ clip: clips[loc.i], local: loc.localB });
  }
  const keepIds = new Set(needs.map((n) => n.clip.id));
  for (const { clip, local } of needs) {
    if (clip.kind === "video") {
      const deck = deckFor(clip, keepIds);
      if (Number.isFinite(local) && Math.abs((deck.el.currentTime || 0) - local) > 0.45) {
        try { deck.el.currentTime = clamp(local, 0, Math.max(0, clip.duration)); } catch { /* not ready */ }
      }
    } else {
      primeImage(clip.url);
    }
  }
}

function driveDecks(loc) {
  const wanted = new Set();
  if (playing && loc.type !== "empty") {
    if (loc.type === "body") {
      const clip = clips[loc.i];
      if (clip.kind === "video") wanted.add(clip.id);
    } else {
      const seg = layout.segments[loc.i];
      if (loc.localA != null) {
        const from = clipsById().get(seg.x.fromId);
        if (from.kind === "video") wanted.add(from.id);
      }
      if (clips[loc.i].kind === "video") wanted.add(clips[loc.i].id);
    }
  }
  for (const deck of decks) {
    if (wanted.has(deck.clipId)) {
      if (deck.el.paused) deck.el.play().catch(() => {});
    } else if (!deck.el.paused) {
      deck.el.pause();
    }
  }
}

function syncVolumes() {
  const byId = clipsById();
  for (const deck of decks) {
    const clip = deck.clipId != null ? byId.get(deck.clipId) : null;
    const level = clip && clip.kind === "video"
      ? clip.volume * (clip.muted ? 0 : 1) * emphasisFactor(emphasis, "video")
      : 0;
    const g = deckGains.get(deck.el);
    if (g) g.gain.value = level;
    else if (clip) deck.el.volume = level; // pre-init fallback
  }
}

const fxWarned = new Set();

function noteFxFailure(clip) {
  if (!clip || fxWarned.has(clip.id)) return;
  fxWarned.add(clip.id);
  hint(`\u201c${clip.name}\u201d can't be processed for effects \u2014 showing the original.`);
}

/**
 * Run the pixel half of the effects chain, returning the layer to composite.
 * May throw when the source canvas is tainted (cross-origin without CORS);
 * callers must fall back to the raw crop. See tests/media-cors.test.mjs.
 */
function applyFxLayer(lay, sx, sy, sw, sh, fxId, def, fx, local) {
  if (def.custom === "blur") {
    const k = 240 / Math.max(sw, sh);
    const tw = Math.max(24, Math.round(sw * k)), th = Math.max(14, Math.round(sh * k));
    fxTiny.width = tw;
    fxTiny.height = th;
    const tc = fxTiny.getContext("2d");
    tc.drawImage(lay.el, sx, sy, sw, sh, 0, 0, tw, th);
    boxBlur(tc, tw, th, 2, 2);
    if (fx.brightness) applyPixelChain(tc, tw, th, "none", fx.brightness, local);
    return { srcEl: fxTiny, srcX: 0, srcY: 0, srcW: tw, srcH: th, smooth: true };
  }
  if (def.custom === "pixelate") {
    const tw = Math.max(16, Math.round(sw / 16)), th = Math.max(9, Math.round(sh / 16));
    fxTiny.width = tw;
    fxTiny.height = th;
    const tc = fxTiny.getContext("2d");
    tc.drawImage(lay.el, sx, sy, sw, sh, 0, 0, tw, th);
    if (fx.brightness) applyPixelChain(tc, tw, th, "none", fx.brightness, local);
    return { srcEl: fxTiny, srcX: 0, srcY: 0, srcW: tw, srcH: th, smooth: false };
  }
  const k = Math.min(1, 720 / Math.max(sw, sh));
  const tw = Math.max(2, Math.round(sw * k)), th = Math.max(2, Math.round(sh * k));
  fxCanvas.width = tw;
  fxCanvas.height = th;
  const fc = fxCanvas.getContext("2d");
  fc.drawImage(lay.el, sx, sy, sw, sh, 0, 0, tw, th);
  applyPixelChain(fc, tw, th, fxId === "none" ? "none" : fxId, fx.brightness, local);
  if (def.grain) {
    paintGrain(fc, tw, th, local);
    paintScratch(fc, tw, th, local);
  }
  if (def.vignette) paintVignette(fc, tw, th);
  return { srcEl: fxCanvas, srcX: 0, srcY: 0, srcW: tw, srcH: th, smooth: true };
}

/** Resolve a layer's source pixels: media element, or a rendered text card. */
function layerSource(clip, source, local) {
  if (clip.kind === "title" || clip.kind === "credits") {
    renderTextCard(clip, local);
    return { el: textCanvas, w: textCanvas.width, h: textCanvas.height };
  }
  return { el: source, w: source?.videoWidth || source?.naturalWidth || 0, h: source?.videoHeight || source?.naturalHeight || 0 };
}

/**
 * Draw one full-frame layer: crop (Ken Burns) -> effects chain -> rotation.
 * Effect order mirrors buildExportFilter: effect -> brightness -> fades,
 * with letterbox last, so preview and export cannot diverge. No bg fill.
 */
function drawFull(clip, source, local, pzOverride = undefined) {
  const ctx = stageCtx, W = STAGE_W, H = STAGE_H;
  if (!clip.playable) {
    drawPlaceholder(clip);
    return;
  }
  const lay = layerSource(clip, source, local);
  if (!lay.el || lay.w < 1 || lay.h < 1) return; // media not ready; stage stays black
  const r = ((clip.rotation % 360) + 360) % 360;
  const swap = r === 90 || r === 270;
  const dw = swap ? H : W, dh = swap ? W : H;

  let sx = 0, sy = 0, sw = lay.w, sh = lay.h;
  if (clip.kind === "image") {
    const presetId = pzOverride === undefined ? clip.panZoom : pzOverride;
    const preset = presetId ? pzById(presetId) : null;
    if (preset) {
      const kept = keptDuration(clip);
      const q = kept > 0 ? clamp((local - clip.in) / kept, 0, 1) : 0;
      ({ sx, sy, sw, sh } = panZoomSource(lay.w, lay.h, dw / dh, preset, q));
    }
  }
  if (sw < 1 || sh < 1) return;

  const fx = clip.fx || DEFAULT_FX();
  const fxId = hoverFx ?? fx.effect ?? "none";
  const def = fxById(fxId);
  let srcEl = lay.el, srcX = sx, srcY = sy, srcW = sw, srcH = sh;
  let smooth = true;
  if (def && (fxId !== "none" || fx.brightness)) {
    try {
      ({ srcEl, srcX, srcY, srcW, srcH, smooth } =
        applyFxLayer(lay, sx, sy, sw, sh, fxId, def, fx, local));
    } catch {
      // Tainted/unreadable source: composite the raw crop instead of black.
      noteFxFailure(clip);
    }
  }

  const s = Math.min(dw / srcW, dh / srcH);
  const dw2 = srcW * s, dh2 = srcH * s;
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate((r * Math.PI) / 180);
  ctx.imageSmoothingEnabled = smooth;
  ctx.drawImage(srcEl, srcX, srcY, srcW, srcH, -dw2 / 2, -dh2 / 2, dw2, dh2);
  ctx.restore();
  ctx.imageSmoothingEnabled = true;

  const kept = keptDuration(clip);
  const rel = clamp(local - clip.in, 0, kept);
  const fa = fadeAlphas(fx, rel, kept);
  if (fa.inA > 0) {
    ctx.fillStyle = fa.inColor === "white" ? `rgba(255,255,255,${fa.inA})` : `rgba(0,0,0,${fa.inA})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (fa.outA > 0) {
    ctx.fillStyle = fa.outColor === "white" ? `rgba(255,255,255,${fa.outA})` : `rgba(0,0,0,${fa.outA})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (def?.letterbox) paintLetterbox(ctx, W, H);
}

/* ---------------------------------------------------------- text drawing */
function layoutText(ctx, text) {
  const content = String(text.content ?? "");
  const lines = content.split("\n");
  const font = fontOf(text);
  ctx.font = font;
  const lh = text.fontSize * 1.2;
  let w = 0;
  for (const line of lines) w = Math.max(w, ctx.measureText(line || " ").width);
  const padX = 14, padY = 10;
  return { lines, font, lh, w: Math.ceil(w + padX * 2), h: Math.ceil(lines.length * lh + padY * 2), padX, padY };
}

/**
 * Draw a text box with its animation preset. pos = stage-coords center.
 * When record is true, stores the hit box for dragging/double-click.
 */
function drawTextBox(ctx, text, { x, y, elapsed, qSpan, stage, shadow, record }) {
  const content = String(text.content ?? "");
  if (!content.trim()) return null;
  const lay = layoutText(ctx, text);
  const preset = animById(text.anim);
  const q = preset.mode === "span" ? clamp(qSpan, 0, 1) : clamp(elapsed / (preset.enter || 1), 0, 1);
  const p = preset.compute(q, elapsed, { w: lay.w, h: lay.h }, stage, content.length);
  const cx = x + p.dx, cy = y + p.dy;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(p.rot);
  ctx.scale(p.sx * p.scale, p.sy * p.scale);
  ctx.globalAlpha = clamp(p.alpha, 0, 1) * clamp(text.opacity ?? 1, 0, 1);
  ctx.translate(-lay.w / 2, -lay.h / 2);
  if (p.clip) {
    ctx.beginPath();
    if (p.clip.kind === "rect") {
      ctx.rect(p.clip.x, p.clip.y, p.clip.w, p.clip.h);
    } else if (p.clip.kind === "ellipse") {
      ctx.ellipse(p.clip.x, p.clip.y, Math.max(0.1, p.clip.rx), Math.max(0.1, p.clip.ry), 0, 0, Math.PI * 2);
    } else if (p.clip.kind === "drip") {
      const dh = Math.max(0, p.clip.h);
      ctx.moveTo(0, 0);
      ctx.lineTo(lay.w, 0);
      ctx.lineTo(lay.w, dh);
      for (let wx = lay.w; wx >= 0; wx -= 8) {
        ctx.lineTo(wx, dh + Math.sin(wx * 0.045) * 7 + Math.sin(wx * 0.013) * 5);
      }
      ctx.closePath();
    }
    ctx.clip();
  }
  if (p.banner != null) {
    ctx.fillStyle = "rgba(8,18,38,0.88)";
    const bw = lay.w * clamp(p.banner, 0, 1);
    ctx.fillRect(0, 0, bw, lay.h);
    ctx.fillStyle = "#0a84ff";
    ctx.fillRect(0, 0, 6, lay.h);
  }
  const shown = p.chars != null ? content.slice(0, Math.max(0, p.chars)) : content;
  const showLines = shown.split("\n");
  ctx.font = lay.font;
  ctx.fillStyle = text.color || "#fff";
  ctx.textBaseline = "middle";
  if (shadow) {
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = 9;
    ctx.shadowOffsetY = 2;
  }
  const align = text.align || "center";
  ctx.textAlign = align === "left" ? "left" : align === "right" ? "right" : "center";
  const tx = align === "left" ? lay.padX : align === "right" ? lay.w - lay.padX : lay.w / 2;
  showLines.forEach((line, i) => {
    ctx.fillText(line || " ", tx, lay.padY + lay.lh * (i + 0.5));
  });
  if (p.cursor && p.chars != null) {
    const last = showLines[showLines.length - 1] || "";
    const lw = ctx.measureText(last).width;
    const lx = (align === "left" ? lay.padX : align === "right" ? lay.w - lay.padX - lw : lay.w / 2 + lw / 2);
    const ly = lay.padY + lay.lh * (showLines.length - 0.5);
    ctx.shadowColor = "transparent";
    ctx.fillRect(lx + 3, ly - lay.lh * 0.42, Math.max(2, text.fontSize * 0.05), lay.lh * 0.84);
  }
  ctx.restore();

  if (record) {
    const hw = (lay.w * Math.abs(p.sx * p.scale)) / 2;
    const hh = (lay.h * Math.abs(p.sy * p.scale)) / 2;
    lastTextBox = { x: cx - hw, y: cy - hh, w: hw * 2, h: hh * 2 };
  }
  return lay;
}

/** Full-screen card for title/credits clips, with auto-scroll for credits. */
function renderTextCard(clip, local, targetCtx = null) {
  const ctx = targetCtx ?? textCanvas.getContext("2d");
  const W = textCanvas.width, H = textCanvas.height;
  const text = clip.text || makeText(clip.kind);
  ctx.fillStyle = text.bg || "#1f2937";
  ctx.fillRect(0, 0, W, H);
  const kept = keptDuration(clip);
  const rel = clamp(local - clip.in, 0, kept);
  const qSpan = kept > 0 ? rel / kept : 0;
  let y = text.y * H;
  if (clip.kind === "credits") {
    const lay = layoutText(ctx, text);
    y += ((H / 2 + lay.h / 2 + 40) * (1 - 2 * qSpan));
  }
  lastTextBox = null;
  drawTextBox(ctx, text, { x: text.x * W, y, elapsed: rel, qSpan, stage: { W, H }, shadow: false, record: true });
}

function captionWindow(clip) {
  const cap = clip.caption;
  const kept = keptDuration(clip);
  const offset = clamp(cap?.offset || 0, 0, kept);
  const dur = Math.max(0.1, Math.min(cap?.dur || kept, kept - offset));
  return { offset, dur };
}

function drawCaptionOverlay(clip, local, targetCtx = null) {
  const cap = clip?.caption;
  if (!cap || !String(cap.content || "").trim()) return;
  const { offset, dur } = captionWindow(clip);
  const rel = local - clip.in;
  if (rel < offset || rel > offset + dur) return;
  const elapsed = rel - offset;
  drawTextBox(targetCtx ?? stageCtx, cap, {
    x: cap.x * STAGE_W, y: cap.y * STAGE_H,
    elapsed, qSpan: elapsed / dur,
    stage: { W: STAGE_W, H: STAGE_H }, shadow: true, record: true,
  });
}

function drawPlaceholder(clip) {
  const ctx = stageCtx, W = STAGE_W, H = STAGE_H;
  ctx.fillStyle = "#141416";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#8e8e93";
  ctx.font = "20px -apple-system, 'Helvetica Neue', sans-serif";
  ctx.textAlign = "center";
  const name = clip ? (clip.name.length > 42 ? clip.name.slice(0, 41) + "…" : clip.name) : "";
  ctx.fillText(name, W / 2, H / 2 - 8);
  ctx.font = "15px -apple-system, 'Helvetica Neue', sans-serif";
  ctx.fillStyle = "#636366";
  ctx.fillText("Preview unavailable", W / 2, H / 2 + 20);
}

function photoSource(clip) {
  return fullImg(clip) || thumbImg(clip);
}

function videoSource(clip, keepIds) {
  const deck = deckFor(clip, keepIds);
  return deck.el.readyState >= 2 && deck.el.videoWidth > 0 ? deck.el : null;
}

function renderPlayer(loc) {
  const ctx = stageCtx, W = STAGE_W, H = STAGE_H;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  lastTextBox = null;
  if (loc.type === "empty") return;
  if (loc.type === "body") {
    const clip = clips[loc.i];
    drawFull(clip, layerMedia(clip, new Set([clip.id])), loc.local);
  } else {
    // Overlap zone: run the incoming clip's transition.
    const seg = layout.segments[loc.i];
    const incoming = clips[loc.i];
    const render = incoming.transition ? TRANS_RENDER[incoming.transition.id] : null;
    const paintB = () => {
      drawFull(incoming, layerMedia(incoming, new Set([incoming.id, seg.x.fromId])), loc.localB);
    };
    if (!render) {
      paintB();
    } else {
      let paintA;
      if (loc.localA == null) {
        paintA = () => { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); };
      } else {
        const from = clipsById().get(seg.x.fromId);
        paintA = () => {
          drawFull(from, layerMedia(from, new Set([incoming.id, seg.x.fromId])), loc.localA);
        };
      }
      render(ctx, W, H, paintA, paintB, loc.p);
    }
  }
  // Caption overlay for the followed clip (skipped in hover/dialog previews,
  // which bypass renderPlayer).
  const f = followOf(loc);
  if (f?.clip.caption) drawCaptionOverlay(f.clip, f.local);
}

/** Player media element for a clip (text cards render themselves). */
function layerMedia(clip, keepIds) {
  if (clip.kind === "video") return videoSource(clip, keepIds);
  if (clip.kind === "image") return photoSource(clip);
  return null;
}

/* ------------------------------------------------------------ hover preview */
const HOVER_TRANS_MS = 1100;
const HOVER_PZ_MS = 1800;

function waitFor(cond, ms) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const check = () => {
      if (cond() || performance.now() - t0 > ms) resolve();
      else setTimeout(check, 60);
    };
    check();
  });
}

function prepHoverVideo(el, clip, local) {
  if (el.dataset.clip !== String(clip.id)) {
    el.dataset.clip = String(clip.id);
    el.src = clip.url;
  }
  try { el.currentTime = clamp(local, 0, Math.max(0, clip.duration)); } catch { /* not ready */ }
  return waitFor(() => el.readyState >= 2 && Math.abs((el.currentTime || 0) - local) < 0.5, 1500);
}

function prepHoverPhoto(clip) {
  primeImage(clip.url);
  if (clip.thumb) thumbImg(clip); // fallback so we never wait long
  return waitFor(() => fullImg(clip) != null || thumbImg(clip) != null, 1200);
}

async function startTransHover(id) {
  if (id === "none") return;
  const f = playhead();
  if (!f || !f.clip.playable) return;
  pausePlayback();
  const idx = clipIndex(f.clip.id);
  const next = clips[idx + 1] ?? null;
  const h = {
    kind: "trans", id, ready: false, t0: 0,
    A: { clip: f.clip, local: f.local },
    B: next ? { clip: next, local: next.in } : null,
  };
  hover = h;
  const jobs = [];
  for (const [el, side] of [[els.hoverA, h.A], [els.hoverB, h.B]]) {
    if (!side || !side.clip.playable) continue;
    jobs.push(side.clip.kind === "video" ? prepHoverVideo(el, side.clip, side.local) : prepHoverPhoto(side.clip));
  }
  await Promise.race([Promise.allSettled(jobs), waitFor(() => false, 1600)]);
  if (hover !== h) return;
  h.t0 = performance.now();
  h.ready = true;
}

function startPzHover(preset) {
  const clip = selectedClip();
  if (!clip || clip.kind !== "image" || !clip.playable) return;
  pausePlayback();
  primeImage(clip.url);
  hover = { kind: "pz", clip, preset, ready: true, t0: performance.now() };
}

function stopHover() {
  hover = null;
}

function drawHover(now) {
  const ctx = stageCtx, W = STAGE_W, H = STAGE_H;
  const h = hover;
  if (h.kind === "pz") {
    const q = ((now - h.t0) / HOVER_PZ_MS) % 1;
    const kept = keptDuration(h.clip);
    const local = h.clip.in + q * (kept || 0.001);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    drawFull(h.clip, photoSource(h.clip), local, h.preset.id);
    return;
  }
  const p = ((now - h.t0) / HOVER_TRANS_MS) % 1;
  const render = TRANS_RENDER[h.id];
  const paintSide = (el, side) => () => {
    if (!side) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      return;
    }
    const src = side.clip.kind === "video"
      ? (el.readyState >= 2 && el.videoWidth > 0 ? el : null)
      : side.clip.kind === "image" ? photoSource(side.clip) : null;
    drawFull(side.clip, src, side.local);
  };
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  if (render) render(ctx, W, H, paintSide(els.hoverA, h.A), paintSide(els.hoverB, h.B), p);
}

/* --------------------------------------------------------------- main loop */
let lastTick = 0;

function tick(now) {
  requestAnimationFrame(tick);
  if (!lastTick) lastTick = now;
  const dt = Math.min((now - lastTick) / 1000, 0.1);
  lastTick = now;

  if (playing) {
    T += dt;
    if (T >= projectTotal()) {
      T = projectTotal();
      pausePlayback();
    }
  }
  const loc = clips.length ? locAtT(layout, clipsById(), T) : { type: "empty" };

  if (playing && !hover) {
    const f = loc.type === "empty" ? null : followOf(loc);
    const fid = f ? f.clip.id : null;
    if (fid !== selectedId) {
      selectedId = fid;
      syncSelectionUI();
    }
  }

  if (!hover) ensureMedia(loc);
  driveDecks(hover ? { type: "empty" } : loc);
  syncVolumes();
  if (!hover) driveAudio();
  narrMeterTick();

  if (hover?.ready) {
    drawHover(now);
  } else if (dialogAbs != null) {
    const clip = selectedClip();
    stageCtx.fillStyle = "#000";
    stageCtx.fillRect(0, 0, STAGE_W, STAGE_H);
    if (clip) {
      drawFull(clip, layerMedia(clip, new Set([clip.id])), dialogAbs);
    }
  } else {
    renderPlayer(loc);
  }

  updateReadout(loc);
}

/** Majority-side {clip, local} for a location (x-zones split at p=0.5). */
function followOf(loc) {
  if (loc.type === "body") return { clip: clips[loc.i], local: loc.local };
  if (loc.type === "x") {
    const incoming = clips[loc.i];
    if (loc.p >= 0.5 || loc.localA == null) return { clip: incoming, local: loc.localB };
    return { clip: clipsById().get(layout.segments[loc.i].x.fromId), local: loc.localA };
  }
  return null;
}

function updateReadout(loc) {
  if (dialogAbs != null) {
    const clip = selectedClip();
    if (clip && clip.duration > 0) {
      els.scrub.value = Math.round((clamp(dialogAbs, 0, clip.duration) / clip.duration) * 1000);
      els.timeReadout.textContent = `${fmtTime(dialogAbs)}/${fmtTime(clip.duration)}`;
    }
    return;
  }
  const f = loc.type === "empty" ? null : followOf(loc);
  if (!f) {
    els.scrub.value = 0;
    els.timeReadout.textContent = "00:00.00/00:00.00";
    updatePlayheads(null);
    return;
  }
  const total = keptDuration(f.clip);
  const elapsed = clamp(f.local - f.clip.in, 0, total);
  if (!scrubHeld && total > 0) els.scrub.value = Math.round((elapsed / total) * 1000);
  els.timeReadout.textContent = `${fmtTime(elapsed)}/${fmtTime(total)}`;
  updatePlayheads(f);
}

/* -------------------------------------------------------------- playheads */
function updatePlayheads(f) {
  const total = projectTotal();
  const showAudio = total > 0 && (clips.length > 0 || audioClips.length > 0);
  audioPlayhead.hidden = !showAudio;
  if (showAudio) {
    audioPlayhead.style.left = `${audioLaneFraction(T, total) * 100}%`;
  }
  // Scrub indicator parks on the current thumbnail (paused or playing),
  // drawn over the picture area only so it reads as a position marker.
  const btn = f ? els.strip.querySelector(`[data-id="${f.clip.id}"]`) : null;
  const film = btn ? btn.querySelector(".film") : null;
  stripPlayhead.hidden = !film;
  if (btn && film) {
    const kept = Math.max(keptDuration(f.clip), 0.001);
    const frac = clamp((f.local - f.clip.in) / kept, 0, 1);
    const pad = 2;
    stripPlayhead.style.left =
      `${btn.offsetLeft + film.offsetLeft + pad + frac * Math.max(1, film.offsetWidth - pad * 2)}px`;
    stripPlayhead.style.top = `${btn.offsetTop + film.offsetTop}px`;
    stripPlayhead.style.height = `${film.offsetHeight}px`;
    if (playing) btn.scrollIntoView({ block: "nearest" });
  }
}

/* -------------------------------------------------------------- transport */
function isPlaying() {
  return playing;
}

function setPlayIcon(isPlay) {
  const icon = els.btnPlay.querySelector("[data-icon]");
  if (icon) {
    icon.dataset.icon = isPlay ? "pause" : "play";
    icon.innerHTML = ICONS[isPlay ? "pause" : "play"];
  }
  els.btnPlay.setAttribute("aria-label", isPlay ? "Pause" : "Play");
}

function togglePlay() {
  if (playing) { pausePlayback(); return; }
  resumeAudio();
  if (projectTotal() <= 0) return;
  if (T >= projectTotal() - 0.02) {
    const seg = selectedClip() ? segOfClip(selectedClip().id) : layout.segments[0];
    T = seg ? cleanFrameT(seg) : 0;
  }
  playing = true;
  setPlayIcon(true);
}

function pausePlayback() {
  if (!playing) { setPlayIcon(false); return; }
  playing = false;
  setPlayIcon(false);
}

function seekProject(t) {
  T = clamp(t, 0, projectTotal());
  const f = playhead();
  if (f && f.clip.id !== selectedId) {
    selectedId = f.clip.id;
    syncSelectionUI();
  }
}

function stepFrame(dir) {
  const f = playhead();
  if (!f || !f.clip.playable) return;
  const seg = segOfClip(f.clip.id);
  const step = f.clip.kind === "video" ? dir / 30 : dir * 0.1;
  const local = clamp(f.local + step, f.clip.in, f.clip.out);
  T = seg.bodyStart + (local - f.clip.in);
}

/* ------------------------------------------------------------- selection */
function editableClip() {
  const clip = selectedClip();
  if (!clip) { hint("Select a clip first."); return null; }
  if (!clip.playable || keptDuration(clip) <= 0) { hint("That clip can't be edited yet."); return null; }
  return clip;
}

async function afterStructuralChange(regenClip, regenAt) {
  rebuildLayout();
  if (regenClip?.playable) {
    const thumb = await regenThumb(regenClip, regenAt ?? regenClip.in);
    if (thumb) regenClip.thumb = thumb;
  }
  renderStrip();
  refreshEditPanel();
  refreshAnimPanel();
}

function setStartPoint() {
  pausePlayback();
  const clip = editableClip();
  if (!clip) return;
  const f = playhead();
  const at = f && f.clip.id === clip.id ? f.local : clip.in;
  history.push(snapshotState());
  const applied = setInPoint(clip, at);
  rebuildLayout();
  const seg = segOfClip(clip.id);
  if (seg?.x && T < seg.x.end) T = seg.x.end;
  updateUndoButtons();
  afterStructuralChange(clip);
  hint(`Start point ${fmtTime(applied)} — hidden footage can be restored.`);
}

function setEndPoint() {
  pausePlayback();
  const clip = editableClip();
  if (!clip) return;
  const f = playhead();
  const at = f && f.clip.id === clip.id ? f.local : clip.out;
  history.push(snapshotState());
  const applied = setOutPoint(clip, at);
  rebuildLayout();
  updateUndoButtons();
  afterStructuralChange(clip);
  hint(`End point ${fmtTime(applied)} — hidden footage can be restored.`);
}

async function splitSelected() {
  pausePlayback();
  const clip = editableClip();
  if (!clip) return;
  const f = playhead();
  const at = f && f.clip.id === clip.id ? f.local : null;
  if (at == null || !splitPointValid(clip, at)) {
    hint("Move the playhead inside the clip to split there.");
    return;
  }
  history.push(snapshotState());
  const [left, right] = splitClip(clip, at, nextId++);
  right.transition = null; // fresh start; the left half keeps the transition
  const idx = clips.findIndex((c) => c.id === clip.id);
  clips.splice(idx, 1, left, right);
  const thumb = await regenThumb(right, right.in);
  if (thumb) right.thumb = thumb;
  rebuildLayout();
  updateUndoButtons();
  renderStrip();
  selectClip(right.id);
  hint(`Split at ${fmtTime(at)} — both halves stay editable.`);
}

function deleteSelected() {
  pausePlayback();
  const audio = selectedAudio();
  if (audio) {
    history.push(snapshotState());
    audioClips = audioClips.filter((c) => c.id !== audio.id);
    syncAudioElements();
    selectedAudioId = null;
    updateUndoButtons();
    renderAudioLane();
    syncSelectionUI();
    hint(`Removed \u201c${audio.name}\u201d. Undo restores it.`);
    return;
  }
  const clip = selectedClip();
  if (!clip) { hint("Select a clip first."); return; }
  history.push(snapshotState());
  const { clips: rest, selectId } = deleteClip(clips, clip.id);
  clips = rest;
  thumbCache.delete(clip.id);
  rebuildLayout();
  updateUndoButtons();
  renderStrip();
  selectClip(selectId);
  hint(`Removed “${clip.name}”. Undo restores it.`);
}

async function rotateSelected(delta) {
  const clip = selectedClip();
  if (!clip) { hint("Select a clip first."); return; }
  history.push(snapshotState());
  rotateClip(clip, delta);
  updateUndoButtons();
  await afterStructuralChange(clip);
  hint(`Rotated to ${clip.rotation}°.`);
}

function applyVolumeUI(clip) {
  els.volSlider.value = Math.round(clip.volume * 100);
  els.btnMute.setAttribute("aria-pressed", String(clip.muted));
  els.muteLabel.textContent = clip.muted ? "Unmute" : "Mute";
}

function toggleMute() {
  const clip = selectedClip();
  if (!clip || clip.kind !== "video" || !clip.playable) return;
  history.push(snapshotState());
  clip.muted = !clip.muted;
  applyVolumeUI(clip);
  updateUndoButtons();
}

/* ---------------------------------------------------- undo / redo */
function restoreState(state) {
  clips = state.clips;
  nextId = state.nextId;
  audioClips = state.audioClips ?? [];
  nextAudioId = state.nextAudioId ?? 1;
  emphasis = state.emphasis ?? "none";
  aspect = state.aspect ?? "16:9";
  thumbCache.clear(); // ids may be reused; never show a stale thumbnail image
  applyAspect();
  syncAudioElements();
  rebuildLayout();
  renderStrip();
  const aid = state.selectedAudioId;
  if (aid != null && audioClips.some((c) => c.id === aid)) {
    selectedAudioId = aid;
    selectedId = null;
    syncSelectionUI();
  } else {
    const exists = clips.some((c) => c.id === state.selectedId);
    selectClip(exists ? state.selectedId : clips[0]?.id ?? null);
  }
  updateUndoButtons();
}

function doUndo() {
  pausePlayback();
  const state = history.undo(snapshotState());
  if (!state) { hint("Nothing to undo."); return; }
  restoreState(state);
  hint("Undone.");
}

function doRedo() {
  pausePlayback();
  const state = history.redo(snapshotState());
  if (!state) { hint("Nothing to redo."); return; }
  restoreState(state);
  hint("Redone.");
}

function updateUndoButtons() {
  els.btnUndo.disabled = !history.canUndo;
  els.btnRedo.disabled = !history.canRedo;
  markDirty();
}

/* ------------------------------------------------- contextual Edit tab */
function updateEditTab() {
  const show = selectedClip() != null;
  els.tabEdit.hidden = !show;
  if (!show && document.querySelector(".tab.active")?.dataset.tab === "edit") {
    activateTab("home");
  }
}

function refreshEditPanel() {
  const clip = selectedClip();
  const has = !!clip;
  const canTrim = !!clip && clip.playable && clip.duration > 0;
  const canAudio = !!clip && clip.kind === "video" && clip.playable;
  els.btnSetIn.disabled = !canTrim;
  els.btnSetOut.disabled = !canTrim;
  els.btnSplit.disabled = !canTrim;
  els.btnTrimTool.disabled = !canTrim;
  els.btnERotL.disabled = !has;
  els.btnERotR.disabled = !has;
  els.btnRotL.disabled = !has;
  els.btnRotR.disabled = !has;
  els.btnRemove.disabled = !has;
  els.volSlider.disabled = !canAudio;
  els.volRow.classList.toggle("disabled", !canAudio);
  els.btnMute.disabled = !canAudio;
  els.clipDuration.textContent = clip ? `${keptDuration(clip).toFixed(2)} s` : "—";
  if (clip) applyVolumeUI(clip);
}

/* --------------------------------------------------------- trim dialog */
function openTrimTool() {
  const clip = editableClip();
  if (!clip) return;
  pausePlayback();
  trimEntryT = T;
  const f = playhead();
  trimEntryAbs = f && f.clip.id === clip.id ? f.local : clip.in;
  els.trimClipName.textContent = clip.name;
  els.trimStart.min = 0;
  els.trimStart.max = clip.duration;
  els.trimStart.value = clip.in;
  els.trimEnd.min = 0;
  els.trimEnd.max = clip.duration;
  els.trimEnd.value = clip.out;
  dialogAbs = trimEntryAbs;
  updateTrimLabels();
  els.trimOverlay.hidden = false;
  els.trimSave.focus();
}

function updateTrimLabels() {
  const clip = selectedClip();
  if (!clip) return;
  let a = Number(els.trimStart.value);
  let b = Number(els.trimEnd.value);
  if (a > b) { [a, b] = [b, a]; }
  els.trimStartVal.textContent = fmtTime(a);
  els.trimEndVal.textContent = fmtTime(b);
  els.trimKept.textContent = fmtTime(Math.max(0, b - a));
}

function closeTrimTool(save) {
  const clip = selectedClip();
  els.trimOverlay.hidden = true;
  dialogAbs = null;
  els.btnTrimTool.focus();
  if (!save || !clip) {
    T = trimEntryT;
    return;
  }
  let a = Number(els.trimStart.value);
  let b = Number(els.trimEnd.value);
  if (a > b) [a, b] = [b, a];
  if (Math.abs(a - clip.in) < 0.005 && Math.abs(b - clip.out) < 0.005) {
    T = trimEntryT;
    return; // nothing changed — no undo entry
  }
  history.push(snapshotState());
  setInPoint(clip, a);
  setOutPoint(clip, b);
  rebuildLayout();
  const seg = segOfClip(clip.id);
  const local = clamp(trimEntryAbs, clip.in, clip.out);
  T = seg.bodyStart + (local - clip.in);
  if (seg.x && T < seg.x.end) T = seg.x.end;
  updateUndoButtons();
  afterStructuralChange(clip);
  hint(`Trimmed to ${fmtTime(clip.in)}–${fmtTime(clip.out)}.`);
}

/* --------------------------------------------- animations:transitions */
const transButtons = new Map(); // id -> button
const pzButtons = new Map(); // presetId -> button

function buildGalleries() {
  for (const t of TRANSITIONS) {
    const btn = document.createElement("button");
    btn.className = "gthumb";
    btn.title = t.id === "none" ? "None — remove the transition" : t.name;
    btn.setAttribute("role", "option");
    const cv = document.createElement("canvas");
    cv.width = 144;
    cv.height = 80;
    paintTransThumb(cv, t.id);
    const label = document.createElement("span");
    label.textContent = t.name;
    btn.append(cv, label);
    btn.addEventListener("click", () => applyTransition(t.id));
    btn.addEventListener("mouseenter", () => startTransHover(t.id));
    btn.addEventListener("mouseleave", stopHover);
    els.transGallery.appendChild(btn);
    transButtons.set(t.id, btn);
  }
  for (const group of PZ_GROUPS) {
    const wrap = document.createElement("div");
    wrap.className = "pz-group";
    const title = document.createElement("span");
    title.textContent = group;
    const row = document.createElement("div");
    row.className = "pz-row";
    for (const preset of PANZOOM_PRESETS.filter((p) => p.group === group)) {
      const btn = document.createElement("button");
      btn.className = "gthumb";
      btn.title = preset.name;
      btn.setAttribute("role", "option");
      const cv = document.createElement("canvas");
      cv.width = 144;
      cv.height = 80;
      paintPZThumb(cv, preset);
      const label = document.createElement("span");
      label.textContent = preset.name;
      btn.append(cv, label);
      btn.addEventListener("click", () => applyPZ(preset.id));
      btn.addEventListener("mouseenter", () => startPzHover(preset));
      btn.addEventListener("mouseleave", stopHover);
      row.appendChild(btn);
      pzButtons.set(preset.id, btn);
    }
    wrap.append(title, row);
    els.pzGallery.appendChild(wrap);
  }
}

/** Keep the playhead on the selected clip's first clean frame. */
function nudgePastOwnTransition() {
  const clip = selectedClip();
  const seg = clip ? segOfClip(clip.id) : null;
  if (seg?.x && T < seg.x.end) T = seg.x.end;
}

function applyTransition(id) {
  const clip = selectedClip();
  if (!clip) { hint("Select a clip first."); return; }
  if (id === "none" && !clip.transition) { hint("That clip has no transition."); return; }
  history.push(snapshotState());
  if (id === "none") {
    clip.transition = null;
    hint("Transition removed.");
  } else {
    clip.transition = { id, duration: clip.transition?.duration ?? TRANS_DUR_DEFAULT };
    const def = transById(id);
    hint(`Applied “${def ? def.name : id}” at the start of the clip.`);
  }
  rebuildLayout();
  nudgePastOwnTransition();
  renderStrip();
  refreshAnimPanel();
  updateUndoButtons();
}

function applyTransDuration() {
  const clip = selectedClip();
  if (!clip?.transition) return;
  const v = clamp(parseFloat(els.transDuration.value) || TRANS_DUR_DEFAULT, TRANS_DUR_MIN, TRANS_DUR_MAX);
  els.transDuration.value = v;
  if (Math.abs(v - clip.transition.duration) < 0.001) return;
  history.push(snapshotState());
  clip.transition.duration = v;
  rebuildLayout();
  nudgePastOwnTransition();
  renderStrip();
  refreshAnimPanel();
  updateUndoButtons();
}

function applyTransToAll() {
  const src = selectedClip()?.transition;
  if (!src) { hint("Select a clip with a transition first."); return; }
  history.push(snapshotState());
  for (const c of clips) c.transition = { ...src };
  rebuildLayout();
  nudgePastOwnTransition();
  renderStrip();
  refreshAnimPanel();
  updateUndoButtons();
  const def = transById(src.id);
  hint(`Stamped “${def ? def.name : src.id}” on every clip.`);
}

function applyPZ(presetId) {
  const clip = selectedClip();
  if (!clip || clip.kind !== "image") { hint("Select a photo first."); return; }
  if (!clip.playable) { hint("That photo can't be previewed yet."); return; }
  history.push(snapshotState());
  clip.panZoom = presetId;
  renderStrip();
  refreshAnimPanel();
  updateUndoButtons();
  const preset = pzById(presetId);
  hint(`Applied “${preset ? preset.name : presetId}”. Press play to watch it move.`);
}

function applyPZToAll() {
  const src = selectedClip();
  if (!src || src.kind !== "image" || !src.panZoom) {
    hint("Select a photo with a preset first.");
    return;
  }
  history.push(snapshotState());
  for (const c of clips) if (c.kind === "image") c.panZoom = src.panZoom;
  renderStrip();
  refreshAnimPanel();
  updateUndoButtons();
  const preset = pzById(src.panZoom);
  hint(`Stamped “${preset ? preset.name : src.panZoom}” on every photo.`);
}

function refreshAnimPanel() {
  const clip = selectedClip();
  const activeTrans = clip?.transition?.id ?? "none";
  for (const [id, btn] of transButtons) {
    btn.classList.toggle("active", id === activeTrans);
  }
  els.transDuration.disabled = !clip?.transition;
  els.transDuration.value = clip?.transition?.duration ?? TRANS_DUR_DEFAULT;
  els.btnTransAll.disabled = !clip;
  const photoOK = !!clip && clip.kind === "image" && clip.playable;
  for (const [id, btn] of pzButtons) {
    btn.disabled = !photoOK;
    btn.classList.toggle("active", photoOK && clip.panZoom === id);
  }
  els.btnPzAll.disabled = !(photoOK && clip.panZoom);
}

/* ------------------------------------------------- visual effects */
const fxButtons = new Map();
let opSnapshotTaken = false;

function ensureFx(clip) {
  if (!clip.fx) clip.fx = DEFAULT_FX();
  return clip.fx;
}

function buildFxGallery() {
  for (const e of EFFECTS) {
    const btn = document.createElement("button");
    btn.className = "gthumb";
    btn.title = e.name;
    btn.setAttribute("role", "option");
    const cv = document.createElement("canvas");
    cv.width = 144;
    cv.height = 80;
    paintFxThumb(cv, e.id);
    const label = document.createElement("span");
    label.textContent = e.name;
    btn.append(cv, label);
    btn.addEventListener("click", () => applyEffect(e.id));
    btn.addEventListener("mouseenter", () => { if (selectedClip()) hoverFx = e.id; });
    btn.addEventListener("mouseleave", () => { hoverFx = null; });
    els.fxGallery.appendChild(btn);
    fxButtons.set(e.id, btn);
  }
}

function applyEffect(id) {
  const clip = selectedClip();
  if (!clip) { hint("Select a clip first."); return; }
  history.push(snapshotState());
  ensureFx(clip).effect = id;
  updateUndoButtons();
  refreshFxPanel();
  renderStrip();
  const def = fxById(id);
  hint(id === "none" ? "Effect removed." : `Applied “${def ? def.name : id}”.`);
}

function applyFxAll() {
  const src = selectedClip();
  if (!src) { hint("Select a clip first."); return; }
  history.push(snapshotState());
  const fx = { ...ensureFx(src) };
  for (const c of clips) c.fx = { ...fx };
  updateUndoButtons();
  refreshFxPanel();
  renderStrip();
  hint("Stamped this look on every clip.");
}

function toggleFade(which, color) {
  const clip = selectedClip();
  if (!clip) return;
  history.push(snapshotState());
  const fx = ensureFx(clip);
  const key = which === "in" ? "fadeIn" : "fadeOut";
  fx[key] = fx[key] === color ? "none" : color;
  updateUndoButtons();
  refreshFxPanel();
}

function refreshFxPanel() {
  const clip = selectedClip();
  const fx = clip?.fx;
  const active = fx?.effect ?? "none";
  for (const [id, btn] of fxButtons) btn.classList.toggle("active", id === active);
  els.brightSlider.disabled = !clip;
  els.brightRow.classList.toggle("disabled", !clip);
  els.brightSlider.value = Math.round((fx?.brightness || 0) * 100);
  els.brightVal.textContent = String(Math.round((fx?.brightness || 0) * 100));
  els.btnFadeInB.disabled = !clip;
  els.btnFadeOutB.disabled = !clip;
  els.btnFadeInW.disabled = !clip;
  els.btnFadeOutW.disabled = !clip;
  els.btnFadeInB.setAttribute("aria-pressed", String(fx?.fadeIn === "black"));
  els.btnFadeOutB.setAttribute("aria-pressed", String(fx?.fadeOut === "black"));
  els.btnFadeInW.setAttribute("aria-pressed", String(fx?.fadeIn === "white"));
  els.btnFadeOutW.setAttribute("aria-pressed", String(fx?.fadeOut === "white"));
  els.btnFxAll.disabled = !clip;
}

/* ------------------------------------------------- text: clips & captions */
const animButtons = new Map();

function activeText() {
  const clip = selectedClip();
  if (!clip) return null;
  if (clip.kind === "title" || clip.kind === "credits") {
    if (!clip.text) clip.text = makeText(clip.kind);
    return { clip, text: clip.text, scope: "clip" };
  }
  if (clip.caption) return { clip, text: clip.caption, scope: "caption" };
  return null;
}

function updateFormatTab() {
  const show = activeText() != null;
  els.tabFormat.hidden = !show;
  if (!show && document.querySelector(".tab.active")?.dataset.tab === "format") {
    activateTab("home");
  }
}

function insertTextClip(kind) {
  pausePlayback();
  const clip = makeTextClip(kind, kind === "title" ? "Title" : "Credits");
  history.push(snapshotState());
  if (kind === "credits" || !clips.length) {
    clips.push(clip);
  } else {
    const f = playhead();
    clips.splice(f ? clipIndex(f.clip.id) + 1 : clips.length, 0, clip);
  }
  rebuildLayout();
  updateUndoButtons();
  renderStrip();
  selectClip(clip.id);
  hint(kind === "title" ? "Title card inserted — double-click its text to edit." : "Credits card appended at the end.");
}

function addCaption() {
  const clip = selectedClip();
  if (!clip) { hint("Select a video or photo first."); return; }
  if (clip.kind !== "video" && clip.kind !== "image") { hint("Captions go on videos or photos."); return; }
  if (clip.caption) { openTextEditor(); return; }
  pausePlayback();
  const snap = snapshotState();
  clip.caption = makeText("caption");
  clip.caption.dur = Math.min(7, keptDuration(clip));
  renderStrip();
  syncSelectionUI();
  openTextEditor({ preSnap: snap, fresh: true });
  hint("Type your caption, then Save.");
}

function afterTextChange(at) {
  if (!at) return;
  if (at.scope === "clip") {
    regenThumb(at.clip).then((thumb) => {
      if (thumb) at.clip.thumb = thumb;
      renderStrip();
    });
  } else {
    renderStrip();
  }
  refreshFormatPanel();
}

function setTextProp(fn, { thumb = false } = {}) {
  const at = activeText();
  if (!at) return;
  history.push(snapshotState());
  fn(at.text);
  updateUndoButtons();
  if (thumb && at.scope === "clip") {
    regenThumb(at.clip).then((t) => { if (t) at.clip.thumb = t; renderStrip(); });
  }
  refreshFormatPanel();
}

function refreshFormatPanel() {
  const at = activeText();
  if (!at) return;
  const t = at.text;
  els.fmtFamily.value = t.fontFamily;
  els.fmtSize.value = t.fontSize;
  els.fmtBold.setAttribute("aria-pressed", String(!!t.bold));
  els.fmtItalic.setAttribute("aria-pressed", String(!!t.italic));
  els.fmtColor.value = t.color;
  els.fmtOpacity.value = Math.round((t.opacity ?? 1) * 100);
  els.fmtAlignL.setAttribute("aria-pressed", String(t.align === "left"));
  els.fmtAlignC.setAttribute("aria-pressed", String(t.align !== "left" && t.align !== "right"));
  els.fmtAlignR.setAttribute("aria-pressed", String(t.align === "right"));
  const isCard = at.scope === "clip";
  els.fmtBg.value = t.bg || "#1f2937";
  els.fmtBg.disabled = !isCard;
  els.fmtBgRow.classList.toggle("disabled", !isCard);
  els.fmtDuration.value = Math.round((isCard ? keptDuration(at.clip) : captionWindow(at.clip).dur) * 100) / 100;
  els.fmtRemoveCaption.style.display = isCard ? "none" : "";
  for (const [id, btn] of animButtons) btn.classList.toggle("active", t.anim === id);
}

function buildAnimGallery() {
  for (const p of TEXT_ANIMS) {
    const btn = document.createElement("button");
    btn.className = "gthumb";
    btn.title = p.name;
    btn.setAttribute("role", "option");
    const cv = document.createElement("canvas");
    cv.width = 144;
    cv.height = 80;
    paintAnimThumb(cv, p);
    const label = document.createElement("span");
    label.textContent = p.name;
    btn.append(cv, label);
    btn.addEventListener("click", () => {
      const at = activeText();
      if (!at) return;
      history.push(snapshotState());
      at.text.anim = p.id;
      updateUndoButtons();
      refreshFormatPanel();
    });
    els.animGallery.appendChild(btn);
    animButtons.set(p.id, btn);
  }
}

/* ------------------------------------------------- text editor overlay */
let editorPreSnap = null;
let editorFreshCaption = false;

function openTextEditor(opts = {}) {
  const at = activeText();
  if (!at) return;
  pausePlayback();
  editorPreSnap = opts.preSnap || snapshotState();
  editorFreshCaption = !!opts.fresh;
  els.textEditArea.value = at.text.content || "";
  els.textEditor.hidden = false;
  els.textEditArea.focus();
  els.textEditArea.select();
}

function closeTextEditor(save) {
  const at = activeText();
  els.textEditor.hidden = true;
  els.textEditArea.blur();
  if (!save || !at) {
    if (!save && editorFreshCaption && at && at.scope === "caption") {
      at.clip.caption = null; // discard the just-created empty caption
      renderStrip();
      syncSelectionUI();
    }
    editorPreSnap = null;
    editorFreshCaption = false;
    return;
  }
  const next = els.textEditArea.value;
  if (next === (at.text.content || "")) {
    editorPreSnap = null;
    editorFreshCaption = false;
    return;
  }
  history.push(editorPreSnap || snapshotState());
  at.text.content = next;
  editorPreSnap = null;
  editorFreshCaption = false;
  updateUndoButtons();
  afterTextChange(at);
  hint("Text saved — drag it in the monitor to reposition.");
}

/* ------------------------------------------------- text dragging */
function stagePoint(e) {
  const rect = els.stage.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * STAGE_W,
    y: ((e.clientY - rect.top) / rect.height) * STAGE_H,
  };
}

function textAtPoint(pt) {
  if (!lastTextBox) return null;
  const pad = 10;
  const b = lastTextBox;
  if (pt.x < b.x - pad || pt.x > b.x + b.w + pad || pt.y < b.y - pad || pt.y > b.y + b.h + pad) return null;
  return activeText();
}

/* ------------------------------------------------- audio engine */
function initAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = new AC();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 1;
    masterGain.connect(audioCtx.destination);
    for (const deck of decks) {
      deck.el.volume = 1;
      deck.el.muted = false;
      const src = audioCtx.createMediaElementSource(deck.el);
      const g = audioCtx.createGain();
      g.gain.value = 0;
      src.connect(g);
      g.connect(masterGain);
      deckGains.set(deck.el, g);
    }
  } catch {
    audioCtx = null; // fall back to element volumes
  }
}

function resumeAudio() {
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
}

function ensureAudioEl(clip) {
  let node = audioNodes.get(clip.id);
  if (!node) {
    const el = new Audio();
    el.crossOrigin = "anonymous";
    el.preload = "auto";
    el.volume = 1;
    el.src = clip.url;
    let gain = null;
    if (audioCtx) {
      try {
        const src = audioCtx.createMediaElementSource(el);
        gain = audioCtx.createGain();
        src.connect(gain);
        gain.connect(masterGain);
      } catch {
        gain = null;
      }
    }
    node = { el, gain };
    audioNodes.set(clip.id, node);
  }
  return node;
}

function syncAudioElements() {
  const alive = new Set(audioClips.map((c) => c.id));
  for (const [id, node] of audioNodes) {
    if (!alive.has(id)) {
      try {
        node.el.pause();
      } catch {}
      node.el.removeAttribute("src");
      audioNodes.delete(id);
    }
  }
}

const audioEnd = (clip) => clip.offset + Math.max(0, clip.out - clip.in);

function projectTotal() {
  let total = layout.total;
  for (const c of audioClips) total = Math.max(total, audioEnd(c));
  return total;
}

function driveAudio() {
  for (const clip of audioClips) {
    const node = ensureAudioEl(clip);
    const kept = Math.max(0, clip.out - clip.in);
    const start = clip.offset;
    const end = clip.offset + kept;
    const live = playing && T >= start && T < end && kept > 0 && clip.duration > 0;
    if (live) {
      const local = clip.in + (T - start);
      if (node.el.paused) node.el.play().catch(() => {});
      if (Math.abs((node.el.currentTime || 0) - local) > 0.4) {
        try {
          node.el.currentTime = clamp(local, 0, Math.max(0, clip.duration));
        } catch {}
      }
      const level =
        clip.volume *
        fadeEnvelope(clip.fadeIn, clip.fadeOut, local - clip.in, kept) *
        emphasisFactor(emphasis, clip.kind);
      if (node.gain) node.gain.gain.value = level;
      else node.el.volume = level;
    } else if (!node.el.paused) {
      node.el.pause();
    }
  }
}

/* ------------------------------------------------- music intake */
function probeAudioClip(url) {
  return new Promise((resolve) => {
    const el = new Audio();
    el.crossOrigin = "anonymous";
    el.preload = "metadata";
    const timer = setTimeout(() => resolve({ ok: false }), 10000);
    el.onloadedmetadata = () => {
      clearTimeout(timer);
      const d = Number.isFinite(el.duration) ? el.duration : 0;
      resolve(d > 0 ? { ok: true, duration: d } : { ok: false });
    };
    el.onerror = () => {
      clearTimeout(timer);
      resolve({ ok: false });
    };
    el.src = url;
  });
}

async function decodePeaks(clip) {
  try {
    const buf = await (await fetch(clip.url)).arrayBuffer();
    const offline = new OfflineAudioContext(2, 44100, 44100);
    const audio = await offline.decodeAudioData(buf);
    const ch = audio.getChannelData(0);
    const N = 120;
    const peaks = [];
    const step = Math.max(1, Math.floor(ch.length / N));
    for (let i = 0; i < N; i++) {
      let m = 0;
      const s = i * step;
      for (let j = s; j < Math.min(s + step, ch.length); j += 7) {
        m = Math.max(m, Math.abs(ch[j]));
      }
      peaks.push(m);
    }
    clip.peaks = peaks;
    paintAudioBar(clip.id);
  } catch {
    clip.peaks = null; // flat bar fallback
  }
}

async function addMusicFiles(sources, offset) {
  let added = 0;
  let failed = 0;
  for (const s of sources) {
    const name = nameOf(s);
    if (!AUDIO_EXTS.includes(extOf(name))) {
      failed++;
      continue;
    }
    const url = toSrc(s);
    const probe = await probeAudioClip(url);
    if (!probe.ok) {
      failed++;
      continue;
    }
    history.push(snapshotState());
    // One music clip at a time: a newcomer replaces the old take.
    const oldIdx = audioClips.findIndex((c) => c.kind === "music");
    if (oldIdx >= 0) {
      const [old] = audioClips.splice(oldIdx, 1);
      const node = audioNodes.get(old.id);
      if (node) {
        try {
          node.el.pause();
        } catch {}
        audioNodes.delete(old.id);
      }
      hint("Replaced the previous music.");
    }
    const clip = {
      id: nextAudioId++,
      kind: "music",
      name,
      url,
      offset: Math.max(0, offset),
      in: 0,
      out: probe.duration,
      duration: probe.duration,
      volume: 1,
      fadeIn: "none",
      fadeOut: "none",
      peaks: null,
      file: typeof s === "string" ? s : "",
    };
    audioClips.push(clip);
    added++;
    updateUndoButtons();
    renderAudioLane();
    selectAudio(clip.id);
    decodePeaks(clip);
  }
  if (failed) hint(`${failed} file${failed > 1 ? "s" : ""} couldn't be read as audio.`);
  else if (added && offset <= 0) hint("Music added from the beginning.");
  else if (added) hint(`Music placed at ${fmtTime(offset)}.`);
}

async function pickMusicFile() {
  if (isTauri) {
    const picked = await open({
      multiple: false,
      title: "Add music",
      filters: [{ name: "Audio", extensions: AUDIO_EXTS }],
    });
    return picked || null;
  }
  return new Promise((resolve) => {
    const input = els.browserAudioInput;
    let done = false;
    const finish = (f) => {
      if (done) return;
      done = true;
      input.removeEventListener("change", onChange);
      window.removeEventListener("focus", onFocus);
      resolve(f);
    };
    const onChange = () => {
      const f = input.files[0] || null;
      input.value = "";
      finish(f);
    };
    const onFocus = () => setTimeout(() => finish(input.files[0] || null), 400);
    input.addEventListener("change", onChange);
    window.addEventListener("focus", onFocus);
    input.click();
    setTimeout(() => finish(null), 120000);
  });
}

async function addMusicFlow(atPoint) {
  const picked = await pickMusicFile();
  if (!picked) return;
  await addMusicFiles([picked], atPoint ? T : 0);
}

/* ------------------------------------------------- audio lane */
function selectedAudio() {
  return audioClips.find((c) => c.id === selectedAudioId) ?? null;
}

function selectAudio(id) {
  selectedAudioId = id;
  selectedId = null;
  syncSelectionUI();
}

function renderAudioLane() {
  const bars = els.audioBars;
  bars.innerHTML = "";
  els.audioEmpty.hidden = audioClips.length > 0;
  const total = Math.max(projectTotal(), 0.001);
  for (const clip of audioClips) {
    const kept = Math.max(0, clip.out - clip.in);
    const b = document.createElement("button");
    b.className =
      "audio-bar" +
      (clip.kind === "narration" ? " narration" : "") +
      (clip.id === selectedAudioId ? " selected" : "");
    b.style.left = `${(clip.offset / total) * 100}%`;
    b.style.width = `${Math.max(1.5, (kept / total) * 100)}%`;
    b.title = `${clip.name} — drag middle to move, drag edges to trim, Del to remove`;
    b.dataset.id = clip.id;
    const cv = document.createElement("canvas");
    cv.width = 300;
    cv.height = 40;
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = `${clip.kind === "music" ? "Music" : "Narr."} · ${clip.name}`;
    b.append(cv, tag);
    b.addEventListener("pointerdown", (e) => beginAudioDrag(e, clip.id));
    b.addEventListener("click", () => selectAudio(clip.id));
    for (const side of ["in", "out"]) {
      const h = document.createElement("div");
      h.className = `trim-handle ${side === "in" ? "left" : "right"}`;
      h.title = side === "in" ? "Drag to trim the start" : "Drag to trim the end";
      h.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        beginAudioTrim(e, clip.id, side);
      });
      b.appendChild(h);
    }
    bars.appendChild(b);
    paintAudioBar(clip.id);
  }
  bars.appendChild(audioPlayhead);
}

function paintAudioBar(id) {
  const bar = els.audioBars.querySelector(`[data-id="${id}"]`);
  const clip = audioClips.find((c) => c.id === id);
  if (!bar || !clip) return;
  const cv = bar.querySelector("canvas");
  const ctx = cv.getContext("2d");
  const w = cv.width;
  const h = cv.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(23,69,31,0.55)";
  const peaks = clip.peaks;
  const n = 90;
  const bw = w / n;
  for (let i = 0; i < n; i++) {
    const v = peaks ? peaks[Math.floor((i / n) * peaks.length)] || 0 : 0.18;
    const bh = Math.max(2, v * (h - 8));
    ctx.fillRect(i * bw + 1, (h - bh) / 2, Math.max(1, bw - 2), bh);
  }
}

function startAudioGesture(e, id, mode) {
  if (e.button !== 0) return;
  const clip = audioClips.find((c) => c.id === id);
  if (!clip) return;
  pausePlayback();
  // Select without rebuilding: the pressed node must stay alive until
  // release or the engine may drop the drag. Total is frozen so the
  // mapping can't shift under the pointer mid-gesture.
  laneRenderSuppressed = true;
  selectAudio(id);
  els.audioBars.querySelectorAll(".audio-bar").forEach((b) =>
    b.classList.toggle("selected", Number(b.dataset.id) === id));
  refreshMusicPanel();
  const lane = els.audioBars.getBoundingClientRect();
  audioDrag = {
    mode,
    clip,
    startX: e.clientX,
    laneW: Math.max(1, lane.width),
    total: Math.max(projectTotal(), 0.001),
    startOffset: clip.offset,
    startIn: clip.in,
    startOut: clip.out,
    moved: false,
  };
  try {
    els.audioBars.setPointerCapture(e.pointerId);
  } catch {
    /* older engines: window mousemove still tracks */
  }
  e.preventDefault();
}

function endAudioGesture() {
  if (!audioDrag) return;
  audioDrag = null;
  // Pointer capture retargets the release click at the lane: swallow it
  // so a drag never ends in an accidental seek.
  justDraggedAudio = true;
  setTimeout(() => {
    justDraggedAudio = false;
  }, 0);
  laneRenderSuppressed = false;
  renderAudioLane();
  refreshMusicPanel();
}

function beginAudioDrag(e, id) {
  startAudioGesture(e, id, "move");
}

function beginAudioTrim(e, id, side) {
  startAudioGesture(e, id, side === "in" ? "trim-in" : "trim-out");
}

function setAudioProp(fn) {
  const clip = selectedAudio();
  if (!clip) return;
  history.push(snapshotState());
  fn(clip);
  updateUndoButtons();
  renderAudioLane();
  refreshMusicPanel();
}

/* ------------------------------------------------- music tools tab */
function updateMusicTab() {
  const show = selectedAudio() != null;
  els.tabMusic.hidden = !show;
  if (!show && document.querySelector(".tab.active")?.dataset.tab === "options") {
    activateTab("home");
  }
}

function refreshMusicPanel() {
  const clip = selectedAudio();
  if (!clip) return;
  els.musicVol.value = Math.round(clip.volume * 100);
  els.musicFadeIn.value = clip.fadeIn;
  els.musicFadeOut.value = clip.fadeOut;
  els.musicOffset.value = Math.round(clip.offset * 100) / 100;
  els.musicIn.value = Math.round(clip.in * 100) / 100;
  els.musicOut.value = Math.round(clip.out * 100) / 100;
}

/* ------------------------------------------------- narration record */
const narrStatus = (m) => {
  els.narrStatus.textContent = m;
};

function updateRecordTab() {
  els.tabRecord.hidden = !recordOpen;
  if (!recordOpen && document.querySelector(".tab.active")?.dataset.tab === "record") {
    activateTab("home");
  }
}

function openRecordTab() {
  recordOpen = true;
  updateRecordTab();
  activateTab("record");
  narrStatus("Ready — press Record.");
  els.narrLevel.style.width = "0%";
}

function closeRecordTab() {
  recordOpen = false;
  updateRecordTab();
  activateTab("home");
}

async function narrRecord() {
  if (narr?.recording) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    narrStatus("No microphone API in this browser.");
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime =
      ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/wav"].find((m) => {
        try {
          return window.MediaRecorder && MediaRecorder.isTypeSupported(m);
        } catch {
          return false;
        }
      }) || "";
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };
    let analyser = null;
    let micBuf = null;
    if (audioCtx) {
      try {
        const msrc = audioCtx.createMediaStreamSource(stream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        msrc.connect(analyser);
        micBuf = new Uint8Array(analyser.fftSize);
      } catch {
        analyser = null;
      }
    }
    resumeAudio();
    narr = {
      recording: true,
      stream,
      rec,
      chunks,
      analyser,
      micBuf,
      mime: rec.mimeType || mime,
      startT: T,
      startWall: performance.now(),
    };
    rec.start(250);
    if (!playing && projectTotal() > 0) togglePlay();
    els.btnNarrRecord.disabled = true;
    els.btnNarrStop.disabled = false;
    narrStatus("Recording…");
  } catch {
    narrStatus("Microphone blocked — allow access and try again.");
    hint("Microphone access was denied.");
  }
}

function narrMeterTick() {
  if (!narr?.recording) return;
  let peak = 0;
  if (narr.analyser && narr.micBuf) {
    narr.analyser.getByteTimeDomainData(narr.micBuf);
    for (let i = 0; i < narr.micBuf.length; i += 2) {
      peak = Math.max(peak, Math.abs(narr.micBuf[i] - 128) / 128);
    }
  }
  els.narrLevel.style.width = `${Math.round(Math.min(1, peak * 1.4) * 100)}%`;
  const secs = (performance.now() - narr.startWall) / 1000;
  els.narrStatus.textContent = `Recording ${fmtTime(secs)} — press Stop to keep it.`;
}

async function narrStop(save) {
  if (!narr?.recording) {
    closeRecordTab();
    return;
  }
  narr.recording = false;
  els.btnNarrRecord.disabled = false;
  els.btnNarrStop.disabled = true;
  els.narrLevel.style.width = "0%";
  const take = narr;
  narr = null;
  const blob = await new Promise((resolve) => {
    const done = () => resolve(new Blob(take.chunks, { type: take.mime || "audio/mp4" }));
    take.rec.onstop = done;
    try {
      take.rec.stop();
    } catch {
      done();
    }
    setTimeout(done, 3000);
  });
  for (const tr of take.stream.getTracks()) tr.stop();
  if (!save) {
    narrStatus("Ready — press Record.");
    closeRecordTab();
    hint("Narration discarded.");
    return;
  }
  if (!blob.size) {
    narrStatus("Ready — press Record.");
    closeRecordTab();
    hint("The recording was empty — nothing saved.");
    return;
  }
  const url = URL.createObjectURL(blob);
  const probe = await probeAudioClip(url);
  history.push(snapshotState());
  const clip = {
    id: nextAudioId++,
    kind: "narration",
    name: `Narration ${audioClips.filter((c) => c.kind === "narration").length + 1}`,
    url,
    file: "", // filled in once the take is saved below
    offset: Math.max(0, take.startT),
    in: 0,
    out: probe.ok ? probe.duration : 0,
    duration: probe.ok ? probe.duration : 0,
    volume: 1,
    fadeIn: "none",
    fadeOut: "none",
    peaks: null,
  };
  audioClips.push(clip);
  updateUndoButtons();
  renderAudioLane();
  selectAudio(clip.id);
  if (probe.ok) decodePeaks(clip);
  closeRecordTab();
  const savedPath = await saveNarrationFile(blob, take.mime);
  if (savedPath) {
    clip.file = savedPath;
    hint(`Narration placed at ${fmtTime(clip.offset)} and saved (${savedPath.split("/").pop()}).`);
  } else {
    hint(`Narration placed at ${fmtTime(clip.offset)}.`);
  }
}

async function saveNarrationFile(blob, mime) {
  if (!isTauri) return null;
  try {
    const buf = await blob.arrayBuffer();
    const dir = await join(await audioDir(), "MacMovieMaker", "Narration");
    await mkdir(dir, { recursive: true });
    const fname = narrationFileName(new Date(), mime);
    const full = await join(dir, fname);
    await writeFile(full, new Uint8Array(buf));
    return full;
  } catch {
    return null;
  }
}

/* ------------------------------------------------- project tab */
function refreshProjectPanel() {
  document.querySelectorAll(".mix-btn").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.emphasis === emphasis))
  );
  document.querySelectorAll(".aspect-btn").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.aspect === aspect))
  );
}

function applyAspect() {
  const wide = aspect !== "4:3";
  els.stage.width = wide ? 960 : 720;
  els.stage.height = 540;
  textCanvas.width = els.stage.width;
  textCanvas.height = els.stage.height;
  els.screen.style.aspectRatio = wide ? "16 / 9" : "4 / 3";
  syncStageSize();
}

function setAspect(a) {
  if (aspect === a) return;
  history.push(snapshotState());
  aspect = a;
  applyAspect();
  updateUndoButtons();
  refreshProjectPanel();
  hint(a === "16:9" ? "Widescreen project (16:9)." : "Standard project (4:3).");
}

function setEmphasis(mode) {
  if (emphasis === mode) return;
  history.push(snapshotState());
  emphasis = mode;
  updateUndoButtons();
  refreshProjectPanel();
  hint(
    mode === "none"
      ? "Mixing all tracks at full level."
      : `Emphasizing ${mode}; other tracks duck underneath.`
  );
}

function fitToMusic() {
  const music = audioClips.find((c) => c.kind === "music");
  if (!music || !(music.duration > 0)) {
    hint("Add music first.");
    return;
  }
  const photos = clips.filter((c) => c.kind === "image" && c.playable);
  if (!photos.length) {
    hint("Fit to music needs photos in the storyboard.");
    return;
  }
  const musicEnd = audioEnd(music);
  const kepts = photos.map((p) => keptDuration(p));
  const target = musicEnd - (layout.total - kepts.reduce((a, k) => a + k, 0));
  const scaled = scaleSpans(kepts, target);
  if (!scaled) {
    hint("The music is shorter than the video clips — can't fit.");
    return;
  }
  history.push(snapshotState());
  photos.forEach((p, i) => {
    p.out = p.in + scaled[i];
  });
  rebuildLayout();
  // One refinement pass absorbs transition-overlap drift.
  const kepts2 = photos.map((p) => keptDuration(p));
  const scaled2 = scaleSpans(kepts2, target - (layout.total - musicEnd));
  if (scaled2) {
    photos.forEach((p, i) => {
      p.out = p.in + scaled2[i];
    });
    rebuildLayout();
  }
  updateUndoButtons();
  renderStrip();
  refreshEditPanel();
  const err = Math.abs(layout.total - musicEnd);
  hint(
    err < 0.05
      ? `Photos fit the music exactly (${fmtTime(musicEnd)}).`
      : `Close as possible — off by ${err.toFixed(2)}s.`
  );
}

/* ------------------------------------------------- automovie themes */
function makeTextClip(kind, name) {
  const n = clips.filter((c) => c.kind === kind).length + 1;
  const clip = createClip({
    id: nextId++,
    name: n > 1 ? `${name} ${n}` : name,
    kind,
    url: "",
    duration: 7,
    playable: true,
  });
  clip.text = makeText(kind);
  clip.file = "";
  const cv = document.createElement("canvas");
  cv.width = 192;
  cv.height = 108;
  try {
    clip.thumb = paintTextThumb(cv, clip);
  } catch {
    clip.thumb = null;
  }
  return clip;
}

async function applyTheme(id) {
  const theme = themeById(id);
  if (!theme) return;
  if (!clips.length) {
    hint("Add some clips first, then pick a theme.");
    return;
  }
  if (!audioClips.some((c) => c.kind === "music")) {
    try {
      if (window.confirm("Add music to your movie first?")) {
        const picked = await pickMusicFile();
        if (picked) await addMusicFiles([picked], 0);
      }
    } catch {
      /* dialogs unavailable: carry on without music */
    }
  }
  history.push(snapshotState());
  for (const c of clips) {
    c.transition = { id: theme.trans, duration: theme.transDur };
    c.fx = { ...ensureFx(c), effect: theme.fx };
  }
  const photos = clips.filter((c) => c.kind === "image" && c.playable);
  photos.forEach((p, i) => {
    p.panZoom = theme.pz[i % theme.pz.length];
  });
  if (theme.fades && clips.length) {
    ensureFx(clips[0]).fadeIn = "black";
    ensureFx(clips[clips.length - 1]).fadeOut = "black";
  }
  if (theme.titles) {
    if (clips[0].kind !== "title") clips.unshift(makeTextClip("title", "My Movie"));
    if (clips[clips.length - 1].kind !== "credits") clips.push(makeTextClip("credits", "Credits"));
  }
  rebuildLayout();
  updateUndoButtons();
  renderStrip();
  syncSelectionUI();
  hint(`Applied “${theme.name}” — ${theme.blurb}`);
}

/* ------------------------------------------------- snapshot */
function takeSnapshot() {
  const f = playhead();
  if (!f) {
    hint("Add a clip first.");
    return;
  }
  pausePlayback();
  const cv = document.createElement("canvas");
  cv.width = els.stage.width;
  cv.height = els.stage.height;
  try {
    cv.getContext("2d").drawImage(els.stage, 0, 0, cv.width, cv.height);
  } catch {
    hint("That frame can't be captured.");
    return;
  }
  const url = cv.toDataURL("image/png");
  const tc = document.createElement("canvas");
  tc.width = 192;
  tc.height = 108;
  const tctx = tc.getContext("2d");
  tctx.fillStyle = "#000";
  tctx.fillRect(0, 0, 192, 108);
  const s = Math.min(192 / cv.width, 108 / cv.height);
  tctx.drawImage(cv, (192 - cv.width * s) / 2, (108 - cv.height * s) / 2, cv.width * s, cv.height * s);
  history.push(snapshotState());
  snapCount += 1;
  const clip = createClip({
    id: nextId++,
    name: `Snapshot ${snapCount}`,
    kind: "image",
    url,
    duration: PHOTO_DURATION,
    thumb: tc.toDataURL("image/jpeg", 0.72),
    playable: true,
  });
  clip.file = "";
  primeImage(url);
  clips.splice(clipIndex(f.clip.id) + 1, 0, clip);
  rebuildLayout();
  updateUndoButtons();
  renderStrip();
  selectClip(clip.id);
  hint("Snapshot added as a photo clip.");
}

/* ------------------------------------------------- M5 control wiring */
function wireM5Controls() {
  els.btnAddMusic.addEventListener("click", (e) => {
    e.stopPropagation();
    els.musicMenu.hidden = !els.musicMenu.hidden;
  });
  els.btnMusicStart.addEventListener("click", () => {
    els.musicMenu.hidden = true;
    addMusicFlow(false);
  });
  els.btnMusicPoint.addEventListener("click", () => {
    els.musicMenu.hidden = true;
    addMusicFlow(true);
  });
  document.addEventListener("click", (e) => {
    if (!els.musicMenu.hidden && !e.target.closest(".dropdown")) els.musicMenu.hidden = true;
  });
  document.addEventListener("keydown", (e) => {
    if (e.code === "Escape" && !els.musicMenu.hidden) els.musicMenu.hidden = true;
  });

  els.musicVol.addEventListener("input", () => {
    const clip = selectedAudio();
    if (!clip) return;
    if (!musicVolSnapshotTaken) {
      history.push(snapshotState());
      musicVolSnapshotTaken = true;
      updateUndoButtons();
    }
    clip.volume = clamp(Number(els.musicVol.value) / 100, 0, 1);
  });
  els.musicVol.addEventListener("change", () => {
    musicVolSnapshotTaken = false;
  });
  els.musicFadeIn.addEventListener("change", () => setAudioProp((c) => {
    c.fadeIn = els.musicFadeIn.value;
  }));
  els.musicFadeOut.addEventListener("change", () => setAudioProp((c) => {
    c.fadeOut = els.musicFadeOut.value;
  }));
  els.musicOffset.addEventListener("change", () =>
    setAudioProp((c) => {
      c.offset = Math.max(0, Number(els.musicOffset.value) || 0);
    })
  );
  els.musicIn.addEventListener("change", () =>
    setAudioProp((c) => {
      c.in = clamp(Number(els.musicIn.value) || 0, 0, Math.max(0, c.out - 0.1));
    })
  );
  els.musicOut.addEventListener("change", () =>
    setAudioProp((c) => {
      c.out = clamp(Number(els.musicOut.value) || 0, c.in + 0.1, Math.max(c.in + 0.1, c.duration));
    })
  );

  els.audioBars.addEventListener("click", (e) => {
    if (justDraggedAudio || e.target.closest(".audio-bar")) return;
    const rect = els.audioBars.getBoundingClientRect();
    const frac = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
    seekProject(frac * projectTotal());
  });
  els.btnRecordNarration.addEventListener("click", openRecordTab);
  els.btnNarrRecord.addEventListener("click", narrRecord);
  els.btnNarrStop.addEventListener("click", () => narrStop(true));
  els.btnNarrCancel.addEventListener("click", () => narrStop(false));

  document.querySelectorAll(".mix-btn").forEach((b) =>
    b.addEventListener("click", () => setEmphasis(b.dataset.emphasis))
  );
  document.querySelectorAll(".aspect-btn").forEach((b) =>
    b.addEventListener("click", () => setAspect(b.dataset.aspect))
  );
  els.btnFitMusic.addEventListener("click", fitToMusic);

  document.querySelectorAll(".theme[data-theme]").forEach((b) =>
    b.addEventListener("click", () => applyTheme(b.dataset.theme))
  );
  els.btnSnapshot.addEventListener("click", takeSnapshot);
}

/* ================================================== M6: export, project, share */

/* ------------------------------------------------- dirty tracking */
function markDirty() {
  projectDirty = true;
  updateTitle();
}

function updateTitle() {
  const base = currentProjectPath
    ? currentProjectPath.split("/").pop().replace(/\.mmproj$/i, "")
    : "Untitled Project";
  document.title = `${projectDirty ? "• " : ""}${base} — MacMovieMaker`;
}

/* ------------------------------------------------- recent projects */
const RECENT_KEY = "mmm.recentProjects.v1";

function loadRecents() {
  try {
    const arr = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(arr) ? arr.filter((r) => r?.path) : [];
  } catch {
    return [];
  }
}

function pushRecent(path) {
  try {
    const list = loadRecents().filter((r) => r.path !== path);
    list.unshift({ path, name: path.split("/").pop(), ts: Date.now() });
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 6)));
  } catch { /* private mode */ }
  renderRecentList();
}

function renderRecentList() {
  const box = els.fileRecentList;
  box.innerHTML = "";
  const recents = loadRecents();
  if (!recents.length) {
    box.innerHTML = `<div class="file-note">Nothing yet.</div>`;
    return;
  }
  for (const r of recents) {
    const b = document.createElement("button");
    b.className = "file-item";
    b.title = r.path;
    b.innerHTML = `<span class="ic" data-icon="file-open"></span><span>${escapeHtml(r.name)}</span>`;
    b.addEventListener("click", () => openProject(r.path));
    box.appendChild(b);
  }
  injectIcons(box);
}

/* ------------------------------------------------- save-movie + share menus */
const allPresets = () => [...SAVE_PRESETS, ...loadCustomPresets()];

function findPreset(id) {
  return allPresets().find((p) => p.id === id) ?? null;
}

function presetButton(preset, cls) {
  const b = document.createElement("button");
  b.className = cls;
  const resolved = resolvePreset(preset, aspect);
  const mb = estimateMBPerMin(resolved);
  b.innerHTML = `<span>${escapeHtml(preset.name)}<span class="preset-blurb">${escapeHtml(presetBlurb(resolved))} · ~${mb.toFixed(0)} MB/min</span></span>`;
  b.title = `Save movie — ${preset.name} (${presetBlurb(resolved)})`;
  b.addEventListener("click", () => {
    els.saveMovieMenu.hidden = true;
    if (document.querySelector(".tab.active")?.dataset.tab === "file") activateTab("home");
    exportMovieFlow(preset.id);
  });
  return b;
}

function refreshSaveMenus() {
  const groups = ["Recommended", "Recent settings", "Common settings", "Phone and device settings"];
  els.saveMovieMenu.innerHTML = "";
  els.filePresetList.innerHTML = "";
  for (const g of groups) {
    const inGroup = allPresets().filter((p) => p.group === g);
    if (!inGroup.length) continue;
    const head = document.createElement("div");
    head.className = "menu-head";
    head.textContent = g;
    els.saveMovieMenu.appendChild(head);
    for (const p of inGroup) els.saveMovieMenu.appendChild(presetButton(p, ""));
    for (const p of inGroup) els.filePresetList.appendChild(presetButton(p, "file-item"));
  }
  const mkShare = (svc, cls) => {
    const b = document.createElement("button");
    b.className = cls;
    b.title = `Publish with ${svc.name}: saves the movie, then opens ${svc.name} upload`;
    b.innerHTML = `<span class="ic" data-icon="upload"></span><span>${escapeHtml(svc.name)}</span>`;
    b.addEventListener("click", () => shareFlow(svc.id));
    return b;
  };
  els.shareCol.innerHTML = "";
  els.fileShareList.innerHTML = "";
  for (const svc of SHARE_SERVICES) {
    els.shareCol.appendChild(mkShare(svc, "rbtn-sm"));
    els.fileShareList.appendChild(mkShare(svc, "file-item"));
  }
  injectIcons(els.shareCol);
  injectIcons(els.fileShareList);
}

/* ------------------------------------------------- export dialog */
function openExportDialog(presetName) {
  els.expTitle.textContent = `Saving movie — ${presetName}`;
  els.expPhase.textContent = "Preparing…";
  els.expFill.style.width = "0%";
  els.expStats.textContent = "";
  els.expWarnings.hidden = true;
  els.expWarnings.innerHTML = "";
  els.expCancel.hidden = false;
  els.expCancel.disabled = false;
  els.expClose.hidden = true;
  els.exportOverlay.hidden = false;
}

function closeExportDialog() {
  els.exportOverlay.hidden = true;
}

function setExpPhase(m) {
  els.expPhase.textContent = m;
}

function setExpProgress(frac, stats = "") {
  els.expFill.style.width = `${Math.round(Math.min(1, Math.max(0, frac)) * 100)}%`;
  els.expStats.textContent = stats;
}

function expWarn(list) {
  if (!list?.length) return;
  els.expWarnings.hidden = false;
  els.expWarnings.innerHTML = list.map((w) => `<div>⚠ ${escapeHtml(w)}</div>`).join("");
}

function finishExport(kind, msg) {
  els.expCancel.hidden = true;
  els.expClose.hidden = false;
  if (kind === "ok") {
    els.expTitle.textContent = "Movie saved";
    setExpPhase(msg);
    setExpProgress(1, "");
  } else if (kind === "cancel") {
    els.expTitle.textContent = "Export cancelled";
    setExpPhase(msg || "Cancelled.");
  } else {
    els.expTitle.textContent = "Export failed";
    setExpPhase(msg || "Something went wrong.");
  }
}

function cancelExport() {
  if (exportRun && !exportRun.finished) {
    exportRun.cancelled = true;
    setExpPhase("Cancelling…");
    els.expCancel.disabled = true;
    invoke("export_cancel", { id: exportRun.id }).catch(() => {});
  }
}

/* ------------------------------------------------- custom-setting dialog */
function openCustomDialog() {
  els.custName.value = `Custom ${loadCustomPresets().length + 1}`;
  updateCustEst();
  els.customOverlay.hidden = false;
  els.custName.focus();
  els.custName.select();
}

function closeCustomDialog() {
  els.customOverlay.hidden = true;
}

function customFromDialog() {
  const evenize = (v, dflt, lo, hi) => {
    let n = Math.round(Number(v) || dflt);
    n = Math.min(hi, Math.max(lo, n));
    return n % 2 ? n - 1 : n;
  };
  return {
    id: `custom-${Date.now()}`,
    name: els.custName.value.trim() || "Custom setting",
    w: evenize(els.custW.value, 1280, 160, 3840),
    h: evenize(els.custH.value, 720, 120, 2160),
    fps: [24, 25, 30, 50, 60].includes(Number(els.custFps.value)) ? Number(els.custFps.value) : 30,
    vbr: `${Math.min(50, Math.max(0.5, Number(els.custVbr.value) || 8))}M`,
    abr: "128k",
  };
}

function updateCustEst() {
  const p = customFromDialog();
  els.custEst.textContent = `${presetBlurb(p)} · ~${estimateMBPerMin(p).toFixed(0)} MB/min`;
}

function saveCustomFlow() {
  const customs = saveCustomPreset(null, customFromDialog());
  closeCustomDialog();
  refreshSaveMenus();
  hint(`“${customs[0].name}” saved under Recent settings.`);
}

/* ------------------------------------------------- text prerender
   Titles, credits, and captions are painted by the preview's own painters
   onto export-sized frames, so the render matches the monitor exactly. */
function dataUrlToBytes(url) {
  const bin = atob(url.split(",")[1] || "");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Project-time caption window, mirroring the preview's follow rule. */
function captionExportWindow(clip, seg, nextSeg) {
  const cap = clip.caption;
  const kept = keptDuration(clip);
  const offset = Math.min(Math.max(cap.offset || 0, 0), kept);
  const cdur = Math.max(0.1, Math.min(cap.dur || kept, kept - offset));
  let visStart = seg.bodyStart;
  if (seg.x && seg.x.fromId != null) visStart = seg.x.start + seg.x.dur / 2;
  let visEnd = seg.end;
  if (nextSeg?.x) visEnd = Math.min(visEnd, nextSeg.x.start + nextSeg.x.dur / 2);
  const start = Math.max(seg.bodyStart + offset, visStart);
  const end = Math.min(seg.bodyStart + offset + cdur, visEnd);
  return end - start >= 0.1 ? { start, dur: end - start } : null;
}

async function prerenderTextFrames({ W, H, fps, dir, onTick }) {
  const cardSeq = new Map();
  const captionSeq = new Map();
  const jobs = [];
  layout.segments.forEach((seg, i) => {
    const clip = clips[i];
    if (!clip) return;
    if (clip.kind === "title" || clip.kind === "credits") {
      jobs.push({ kind: "card", clip, seg, start: seg.bodyStart, dur: keptDuration(clip) });
    } else if (clip.caption && String(clip.caption.content ?? "").trim()) {
      const win = captionExportWindow(clip, seg, layout.segments[i + 1]);
      if (win) jobs.push({ kind: "cap", clip, seg, start: win.start, dur: win.dur });
    }
  });
  if (!jobs.length) return { cardSeq, captionSeq };
  const sw = textCanvas.width, sh = textCanvas.height;
  const s = Math.min(W / sw, H / sh);
  const ox = (W - sw * s) / 2, oy = (H - sh * s) / 2;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d");
  let done = 0;
  const totalFrames = jobs.reduce((a, j) => a + Math.max(1, Math.round(j.dur * fps)), 0);
  for (const job of jobs) {
    const n = Math.max(1, Math.round(job.dur * fps));
    const prefix = job.kind === "card" ? `card${job.clip.id}_` : `cap${job.clip.id}_`;
    for (let i = 0; i < n; i++) {
      const t = (i / fps);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (job.kind === "card") {
        ctx.fillStyle = job.clip.text?.bg || "#1f2937";
        ctx.fillRect(0, 0, W, H);
      } else {
        ctx.clearRect(0, 0, W, H);
      }
      ctx.setTransform(s, 0, 0, s, ox, oy);
      if (job.kind === "card") {
        renderTextCard(job.clip, job.clip.in + t, ctx);
      } else {
        drawCaptionOverlay(job.clip, job.clip.in + (job.start - job.seg.bodyStart) + t, ctx);
      }
      const bytes = dataUrlToBytes(cv.toDataURL("image/png"));
      await writeFile(await join(dir, `${prefix}${String(i).padStart(4, "0")}.png`), bytes);
      done++;
      if (done % 12 === 0) {
        onTick?.(done, totalFrames);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    const pattern = await join(dir, `${prefix}%04d.png`);
    (job.kind === "card" ? cardSeq : captionSeq).set(job.clip.id, { pattern, start: job.start, dur: job.dur });
  }
  onTick?.(totalFrames, totalFrames);
  return { cardSeq, captionSeq };
}

/* ------------------------------------------------- export resolution */
async function resolveExportInputs(preset, jobDir, pre, onPhase) {
  const warnings = [];
  const clipInput = new Map();
  const audioInput = new Map();
  const hasAudio = new Map();
  const usable = clips.filter((c) => keptDuration(c) > 0.01);
  let i = 0;
  for (const clip of usable) {
    i++;
    onPhase?.(`Probing media ${i}/${usable.length}…`);
    if (clip.kind === "title" || clip.kind === "credits") {
      clipInput.set(clip.id, pre.cardSeq.has(clip.id) ? { kind: "seq", pattern: pre.cardSeq.get(clip.id).pattern } : null);
      continue;
    }
    if (clip.url && clip.url.startsWith("data:")) {
      const p = await join(jobDir, `still${clip.id}.png`);
      await writeFile(p, dataUrlToBytes(clip.url));
      clipInput.set(clip.id, { kind: "file", path: p });
      continue;
    }
    if (!clip.file) {
      clipInput.set(clip.id, null);
      continue;
    }
    if (clip.kind === "video") {
      try {
        const probe = await invoke("probe_media", { path: clip.file });
        if (!probe.has_video) {
          clipInput.set(clip.id, null);
          warnings.push(`“${clip.name}” has no readable video — placeholder.`);
        } else {
          clipInput.set(clip.id, { kind: "file", path: clip.file });
          hasAudio.set(clip.id, probe.has_audio === true);
        }
      } catch {
        let there = false;
        try {
          there = await exists(clip.file);
        } catch { /* assume present; the render surfaces real errors */ }
        if (!there) {
          clipInput.set(clip.id, null);
        } else {
          clipInput.set(clip.id, { kind: "file", path: clip.file });
          hasAudio.set(clip.id, true);
        }
      }
    } else {
      let there = false;
      try {
        there = await exists(clip.file);
      } catch { /* fall through to placeholder */ }
      clipInput.set(clip.id, there ? { kind: "file", path: clip.file } : null);
    }
  }
  for (const ac of audioClips) {
    if (!ac.file) {
      audioInput.set(ac.id, null);
      continue;
    }
    try {
      audioInput.set(ac.id, (await exists(ac.file)) ? ac.file : null);
    } catch {
      audioInput.set(ac.id, null);
    }
  }
  return { resolved: { clipInput, audioInput, captionSeq: pre.captionSeq, hasAudio }, warnings };
}

/* ------------------------------------------------- export flow */
async function exportMovieFlow(presetId, opts = {}) {
  if (narr?.recording) {
    hint("Stop the narration recording first.");
    return;
  }
  if (!isTauri) {
    hint("Saving movies needs the Mac app — this browser preview can't run FFmpeg.");
    return;
  }
  if (!clips.length) {
    hint("Add some clips first, then save your movie.");
    return;
  }
  if (exportRun) {
    hint("An export is already running — wait or cancel it first.");
    return;
  }
  const base = findPreset(presetId) ?? SAVE_PRESETS[0];
  const preset = resolvePreset(base, aspect);
  pausePlayback();
  let outDir = "";
  try {
    outDir = await videoDir();
  } catch { /* defaultPath falls back below */ }
  const out = await save({
    title: `Save movie — ${base.name}`,
    defaultPath: outDir ? await join(outDir, "Movie.mp4") : "Movie.mp4",
    filters: [{ name: "Movie", extensions: ["mp4"] }],
  }).catch(() => null);
  if (!out) return;
  openExportDialog(base.name);
  const jobDir = await join(await tempDir(), `mmm-exp-${Date.now()}`);
  try {
    await mkdir(jobDir, { recursive: true });
  } catch { /* exists */ }
  const cleanup = () => remove(jobDir, { recursive: true }).catch(() => {});
  try {
    setExpPhase("Rendering titles…");
    const pre = await prerenderTextFrames({
      W: preset.w, H: preset.h, fps: preset.fps, dir: jobDir,
      onTick: (d, t) => setExpProgress(t ? (d / t) * 0.1 : 0, t ? `Titles ${d}/${t}` : ""),
    });
    const { resolved, warnings } = await resolveExportInputs(preset, jobDir, pre, (m) => setExpPhase(m));
    const plan = buildExportPlan({
      clips, audioClips, emphasis, preset, total: projectTotal(), resolved,
    });
    expWarn([...warnings, ...plan.warnings]);
    const j = plan.stats.joins;
    const summary = `${plan.stats.clips} clips · ${j.xfade + j.custom} transitions · ${plan.stats.captions} captions · ${plan.stats.audioLegs} audio`;
    setExpPhase(`Rendering with ${base.name}…`);
    setExpProgress(0.1, summary);
    const id = `exp-${Date.now()}`;
    const argv = [...plan.argvHead, "-filter_complex_script", "{FILTER_SCRIPT}", ...plan.maps, ...plan.outArgs, out];
    let resolveDone;
    const doneP = new Promise((r) => {
      resolveDone = r;
    });
    const unProgP = listen("export-progress", (e) => {
      if (e.payload?.id !== id || !exportRun) return;
      const frac = 0.1 + 0.9 * Math.min(1, e.payload.out_us / Math.max(1, plan.totalUs));
      setExpProgress(frac, `${summary} · ${Math.round((frac * 100))}%`);
    });
    const unDoneP = listen("export-done", (e) => {
      if (e.payload?.id === id) resolveDone(e.payload);
    });
    exportRun = { id, finished: false, cancelled: false };
    const started = await invoke("export_movie", { req: { id, argv, filter_script: plan.script } });
    setExpPhase(`Rendering (${started.ffmpeg === "sidecar" ? "bundled" : "system"} FFmpeg)…`);
    const done = await doneP;
    exportRun.finished = true;
    const wasCancel = exportRun.cancelled;
    exportRun = null;
    (await unProgP)();
    (await unDoneP)();
    if (done.ok) {
      finishExport("ok", `Saved to ${out}`);
      hint(`Movie saved (${out.split("/").pop()}).`);
      if (opts.share) await doShareOpen(opts.share, out);
    } else if (wasCancel) {
      finishExport("cancel");
    } else {
      finishExport("error", done.error || "FFmpeg reported a failure.");
    }
  } catch (err) {
    exportRun = null;
    finishExport("error", err?.message || String(err));
  } finally {
    await cleanup();
  }
}

/* ------------------------------------------------- share v1 */
async function shareFlow(serviceId) {
  const svc = SHARE_SERVICES.find((s) => s.id === serviceId);
  if (!svc) return;
  if (!isTauri) {
    window.open(svc.url, "_blank");
    return;
  }
  await exportMovieFlow("recommended", { share: svc });
}

async function doShareOpen(svc, outPath) {
  hint(`Movie ready (${outPath.split("/").pop()}) — opening ${svc.name} upload…`);
  try {
    await invoke("open_external", { url: svc.url });
  } catch {
    window.open(svc.url, "_blank");
  }
}

/* ------------------------------------------------- project flows */
const projectState = () => ({
  clips, audioClips, selectedId, selectedAudioId, nextId, nextAudioId, emphasis, aspect,
});

async function removeAutosave() {
  if (!isTauri) return;
  try {
    await remove(await join(await tempDir(), "mmm-autosave.mmproj"));
  } catch { /* absent */ }
}

async function saveProject(saveAs) {
  if (!isTauri) {
    const blob = new Blob([JSON.stringify(serializeProject(projectState()), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "project.mmproj";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    hint("Project downloaded as a .mmproj file.");
    return;
  }
  let path = saveAs ? null : currentProjectPath;
  if (!path) {
    path = await save({
      title: "Save project",
      defaultPath: "Untitled.mmproj",
      filters: [{ name: "MacMovieMaker project", extensions: PROJECT_EXTENSIONS }],
    }).catch(() => null);
    if (!path) return;
  }
  try {
    await writeTextFile(path, JSON.stringify(serializeProject(projectState())));
  } catch (err) {
    hint(`Couldn't save: ${err?.message || err}`);
    return;
  }
  currentProjectPath = path;
  projectDirty = false;
  updateTitle();
  pushRecent(path);
  await removeAutosave();
  hint(`Project saved (${path.split("/").pop()}).`);
}

async function openProject(givenPath = null) {
  if (narr?.recording) {
    hint("Stop the narration recording first.");
    return;
  }
  if (projectDirty && !window.confirm("Discard unsaved changes?")) return;
  if (!isTauri) {
    hint("Project files open in the Mac app.");
    return;
  }
  const path = givenPath ?? (await open({
    title: "Open project",
    multiple: false,
    filters: [{ name: "MacMovieMaker project", extensions: PROJECT_EXTENSIONS }],
  }).catch(() => null));
  if (!path) return;
  let doc;
  try {
    doc = JSON.parse(await readTextFile(path));
  } catch {
    hint("That file couldn't be read as a project.");
    return;
  }
  let parsed;
  try {
    parsed = deserializeProject(doc);
  } catch (err) {
    hint(err?.message || "That project couldn't be opened.");
    return;
  }
  await applyLoadedState(parsed.state, parsed.warnings, path);
}

async function applyLoadedState(state, warnings, path) {
  pausePlayback();
  if (narr?.recording) return;
  clips = state.clips;
  audioClips = state.audioClips;
  nextId = state.nextId;
  nextAudioId = state.nextAudioId;
  selectedId = state.selectedId;
  selectedAudioId = state.selectedAudioId;
  emphasis = state.emphasis;
  aspect = state.aspect;
  T = 0;
  currentProjectPath = path;
  applyAspect();
  refreshProjectPanel();
  let missing = 0;
  for (const clip of clips) {
    if (clip.file && isTauri) {
      clip.url = toSrc(clip.file);
      let there = true;
      try {
        there = await exists(clip.file);
      } catch { /* keep stored state */ }
      if (!there) {
        clip.playable = false;
        missing++;
      }
    } else if (!clip.url && (clip.kind === "video" || clip.kind === "image")) {
      clip.playable = false;
      missing++;
    }
    if (clip.kind === "image" && clip.url) primeImage(clip.url);
  }
  const keptAudio = [];
  for (const ac of audioClips) {
    if (!ac.file) {
      if (!ac.url) {
        missing++;
        continue;
      }
    } else if (isTauri) {
      let there = true;
      try {
        there = await exists(ac.file);
      } catch { /* keep stored state */ }
      if (!there) {
        missing++;
        continue;
      }
      ac.url = toSrc(ac.file);
    }
    if (!ac.peaks) decodePeaks(ac);
    keptAudio.push(ac);
  }
  audioClips = keptAudio;
  syncAudioElements();
  rebuildLayout();
  renderStrip();
  syncSelectionUI();
  history.past.length = 0;
  history.future.length = 0;
  updateUndoButtons();
  projectDirty = false;
  updateTitle();
  if (path) pushRecent(path);
  const notes = [...warnings];
  if (missing) notes.push(`${missing} file${missing > 1 ? "s" : ""} couldn't be found — affected clips are marked unavailable.`);
  hint(notes.length ? notes[0] + (notes.length > 1 ? ` (+${notes.length - 1} more)` : "") : "Project opened.");
}

async function newProject() {
  if (narr?.recording) {
    hint("Stop the narration recording first.");
    return;
  }
  if (projectDirty && !window.confirm("Discard unsaved changes?")) return;
  pausePlayback();
  clips = [];
  audioClips = [];
  T = 0;
  nextId = 1;
  nextAudioId = 1;
  selectedId = null;
  selectedAudioId = null;
  emphasis = "none";
  aspect = "16:9";
  snapCount = 0;
  currentProjectPath = null;
  applyAspect();
  refreshProjectPanel();
  syncAudioElements();
  rebuildLayout();
  renderStrip();
  syncSelectionUI();
  history.past.length = 0;
  history.future.length = 0;
  updateUndoButtons();
  projectDirty = false;
  updateTitle();
  hint("New project.");
}

/* ------------------------------------------------- autosave */
async function autosaveTick() {
  if (!isTauri || !projectDirty) return;
  if (!clips.length && !audioClips.length) return;
  try {
    await writeTextFile(await join(await tempDir(), "mmm-autosave.mmproj"), JSON.stringify(serializeProject(projectState())));
  } catch { /* next minute */ }
}

async function checkAutosave() {
  if (!isTauri) return;
  try {
    const p = await join(await tempDir(), "mmm-autosave.mmproj");
    if (!(await exists(p))) return;
    if (window.confirm("Recover the autosaved project from your last session?")) {
      const { state, warnings } = deserializeProject(JSON.parse(await readTextFile(p)));
      await applyLoadedState(state, warnings, null);
      projectDirty = true;
      updateTitle();
      hint("Autosave recovered — save it to keep it.");
    } else {
      await remove(p).catch(() => {});
    }
  } catch { /* corrupt autosave: leave it alone */ }
}

/* ------------------------------------------------- M6 control wiring */
function wireM6Controls() {
  els.btnSave.addEventListener("click", () => saveProject(false));
  els.fileNew.addEventListener("click", newProject);
  els.fileOpen.addEventListener("click", () => openProject());
  els.fileSave.addEventListener("click", () => saveProject(false));
  els.fileSaveAs.addEventListener("click", () => saveProject(true));
  els.fileCustom.addEventListener("click", openCustomDialog);
  els.btnSaveMovie.addEventListener("click", (e) => {
    e.stopPropagation();
    els.saveMovieMenu.hidden = !els.saveMovieMenu.hidden;
    if (!els.saveMovieMenu.hidden) {
      // The Share group sits at the ribbon's right edge: right-align the
      // menu when it would run past the viewport instead of clipping options.
      els.saveMovieMenu.style.left = "";
      els.saveMovieMenu.style.right = "";
      if (els.saveMovieMenu.getBoundingClientRect().right > window.innerWidth - 8) {
        els.saveMovieMenu.style.left = "auto";
        els.saveMovieMenu.style.right = "0";
      }
    }
  });
  document.addEventListener("click", (e) => {
    if (!els.saveMovieMenu.hidden && !e.target.closest(".dropdown")) els.saveMovieMenu.hidden = true;
  });
  document.addEventListener("keydown", (e) => {
    if (e.code === "Escape" && !els.saveMovieMenu.hidden) els.saveMovieMenu.hidden = true;
  });
  els.expCancel.addEventListener("click", cancelExport);
  els.expClose.addEventListener("click", closeExportDialog);
  els.custCancel.addEventListener("click", closeCustomDialog);
  els.custSave.addEventListener("click", saveCustomFlow);
  for (const id of ["custName", "custW", "custH", "custVbr", "custFps"]) {
    els[id].addEventListener("input", updateCustEst);
  }
  refreshSaveMenus();
  renderRecentList();
}

/* ------------------------------------------------- x-ray inspector (F9) */
let xrayOn = false;
let xrayTip = null;

function toggleXray() {
  xrayOn = !xrayOn;
  if (xrayOn && !xrayTip) {
    xrayTip = document.createElement("div");
    xrayTip.id = "xrayTip";
    xrayTip.hidden = true;
    document.body.appendChild(xrayTip);
    document.addEventListener("mousemove", xrayHover);
  }
  if (xrayTip) xrayTip.hidden = !xrayOn;
  hint(xrayOn ? "X-ray on: hover the storyboard to identify elements (F9 quits)." : "X-ray off.");
}

function xrayHover(e) {
  if (!xrayOn || !xrayTip) return;
  const t = e.target;
  if (!(t instanceof Element) || !els.strip.contains(t)) {
    xrayTip.hidden = true;
    return;
  }
  const cs = getComputedStyle(t);
  const cls = t.className?.baseVal !== undefined ? t.className.baseVal : String(t.className || "");
  const r = t.getBoundingClientRect();
  xrayTip.innerHTML =
    `<b>${t.tagName.toLowerCase()}${t.id ? "#" + t.id : ""}.${String(cls).trim().split(/\s+/).join(".") || "(no class)"}</b><br>` +
    `rect ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}<br>` +
    `border-left: ${cs.borderLeftWidth} ${cs.borderLeftStyle} ${cs.borderLeftColor}<br>` +
    `appearance: ${cs.appearance} · outline: ${cs.outlineWidth} ${cs.outlineStyle}<br>` +
    `shadow: ${String(cs.boxShadow).slice(0, 64)}`;
  xrayTip.style.left = `${Math.min(window.innerWidth - 360, e.clientX + 14)}px`;
  xrayTip.style.top = `${e.clientY + 14}px`;
  xrayTip.hidden = false;
}

/* ------------------------------------------------------------------ zoom */
function applyZoom() {
  const v = Number(els.zoom.value); // 0..100
  const w = Math.round(120 + (v / 100) * (280 - 120));
  document.documentElement.style.setProperty("--chip-w", `${w}px`);
}

/* ----------------------------------------------------------------- events */
function activateTab(name) {
  document.querySelectorAll(".tab").forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", String(on));
  });
  for (const panel of document.querySelectorAll(".ribbon-body .panel")) {
    panel.hidden = panel.id !== `panel-${name}`;
  }
}

function wireEvents() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => activateTab(tab.dataset.tab));
  });

  // Keep Space for transport: don't leave focus on clicked buttons.
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (btn && btn.id !== "trimSave" && btn.id !== "trimCancel") btn.blur();
  });

  els.btnAddMedia.addEventListener("click", browseForMedia);
  els.btnTitle.addEventListener("click", () => insertTextClip("title"));
  els.btnCaption.addEventListener("click", addCaption);
  els.btnCredits.addEventListener("click", () => insertTextClip("credits"));
  els.dropzone.addEventListener("click", browseForMedia);
  els.browserFallbackInput.addEventListener("change", async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    if (files.length) await addSources(files);
  });

  // Finder / Explorer file drops
  if (isTauri) {
    getCurrentWebviewWindow().onDragDropEvent((event) => {
      const { type, paths } = event.payload;
      if (type === "drop" && paths?.length) {
        els.boardPane.classList.remove("dragging");
        addSources(paths);
      } else {
        els.boardPane.classList.toggle("dragging", type !== "leave");
      }
    });
  } else {
    window.addEventListener("dragover", (e) => e.preventDefault());
    window.addEventListener("drop", (e) => e.preventDefault());
    els.boardPane.addEventListener("dragover", (e) => {
      if ([...e.dataTransfer.types].includes("Files")) {
        e.preventDefault();
        els.boardPane.classList.add("dragging");
      }
    });
    els.boardPane.addEventListener("dragleave", () => els.boardPane.classList.remove("dragging"));
    els.boardPane.addEventListener("drop", (e) => {
      els.boardPane.classList.remove("dragging");
      const files = [...(e.dataTransfer.files || [])];
      if (files.length) { e.preventDefault(); addSources(files); }
    });
  }

  // Transport
  els.btnPlay.addEventListener("click", togglePlay);
  els.btnPrevFrame.addEventListener("click", () => stepFrame(-1));
  els.btnNextFrame.addEventListener("click", () => stepFrame(1));
  els.btnFullscreen.addEventListener("click", toggleFullscreen);

  // Refine durations once decks load real metadata.
  for (const deck of decks) {
    deck.el.addEventListener("loadedmetadata", () => {
      const clip = deck.clipId != null ? clipsById().get(deck.clipId) : null;
      if (clip?.kind === "video" && Number.isFinite(deck.el.duration)) {
        const d = deck.el.duration;
        if (d > 0 && Math.abs(d - clip.duration) > 0.01) {
          const atEnd = clip.out >= clip.duration - 0.05;
          clip.duration = d;
          if (atEnd) clip.out = d;
          rebuildLayout();
          renderStrip();
          refreshEditPanel();
        }
      }
    });
  }

  els.scrub.addEventListener("pointerdown", () => { scrubHeld = true; });
  window.addEventListener("pointerup", () => { scrubHeld = false; });
  els.scrub.addEventListener("input", () => {
    const clip = selectedClip();
    if (!clip) return;
    const seg = segOfClip(clip.id);
    if (!seg) return;
    T = seg.start + (Number(els.scrub.value) / 1000) * (seg.end - seg.start);
    const f = playhead();
    if (f && f.clip.id !== selectedId) {
      selectedId = f.clip.id;
      syncSelectionUI();
    }
  });

  // Editing controls
  els.btnSetIn.addEventListener("click", setStartPoint);
  els.btnSetOut.addEventListener("click", setEndPoint);
  els.btnSplit.addEventListener("click", splitSelected);
  els.btnTrimTool.addEventListener("click", openTrimTool);
  els.btnRemove.addEventListener("click", deleteSelected);
  els.btnRotL.addEventListener("click", () => rotateSelected(-90));
  els.btnRotR.addEventListener("click", () => rotateSelected(90));
  els.btnERotL.addEventListener("click", () => rotateSelected(-90));
  els.btnERotR.addEventListener("click", () => rotateSelected(90));
  els.btnUndo.addEventListener("click", doUndo);
  els.btnRedo.addEventListener("click", doRedo);
  els.btnMute.addEventListener("click", toggleMute);
  els.volSlider.addEventListener("input", () => {
    const clip = selectedClip();
    if (!clip || clip.kind !== "video") return;
    if (!volSnapshotTaken) { history.push(snapshotState()); volSnapshotTaken = true; updateUndoButtons(); }
    clip.volume = Number(els.volSlider.value) / 100;
    if (clip.volume > 0) clip.muted = false;
    applyVolumeUI(clip);
  });
  els.volSlider.addEventListener("change", () => { volSnapshotTaken = false; });

  // Visual effects controls
  els.brightSlider.addEventListener("input", () => {
    const clip = selectedClip();
    if (!clip) return;
    if (!brightSnapshotTaken) { history.push(snapshotState()); brightSnapshotTaken = true; updateUndoButtons(); }
    ensureFx(clip).brightness = clamp(Number(els.brightSlider.value) / 100, -1, 1);
    els.brightVal.textContent = els.brightSlider.value;
  });
  els.brightSlider.addEventListener("change", () => { brightSnapshotTaken = false; renderStrip(); });
  els.btnFadeInB.addEventListener("click", () => toggleFade("in", "black"));
  els.btnFadeOutB.addEventListener("click", () => toggleFade("out", "black"));
  els.btnFadeInW.addEventListener("click", () => toggleFade("in", "white"));
  els.btnFadeOutW.addEventListener("click", () => toggleFade("out", "white"));
  els.btnFxAll.addEventListener("click", applyFxAll);

  // Animations controls
  els.transDuration.addEventListener("change", applyTransDuration);
  els.btnTransAll.addEventListener("click", applyTransToAll);
  els.btnPzAll.addEventListener("click", applyPZToAll);

  // Format tab controls
  els.fmtFamily.addEventListener("change", () => setTextProp((t) => { t.fontFamily = els.fmtFamily.value; }));
  els.fmtSize.addEventListener("change", () => setTextProp((t) => {
    t.fontSize = clamp(Math.round(Number(els.fmtSize.value) || 48), 8, 160);
  }, { thumb: true }));
  els.fmtBold.addEventListener("click", () => setTextProp((t) => { t.bold = !t.bold; }));
  els.fmtItalic.addEventListener("click", () => setTextProp((t) => { t.italic = !t.italic; }));
  els.fmtColor.addEventListener("change", () => setTextProp((t) => { t.color = els.fmtColor.value; }, { thumb: true }));
  els.fmtOpacity.addEventListener("input", () => {
    const at = activeText();
    if (!at) return;
    if (!opSnapshotTaken) { history.push(snapshotState()); opSnapshotTaken = true; updateUndoButtons(); }
    at.text.opacity = clamp(Number(els.fmtOpacity.value) / 100, 0.1, 1);
  });
  els.fmtOpacity.addEventListener("change", () => { opSnapshotTaken = false; });
  els.fmtAlignL.addEventListener("click", () => setTextProp((t) => { t.align = "left"; }));
  els.fmtAlignC.addEventListener("click", () => setTextProp((t) => { t.align = "center"; }));
  els.fmtAlignR.addEventListener("click", () => setTextProp((t) => { t.align = "right"; }));
  els.fmtEditText.addEventListener("click", () => openTextEditor());
  els.fmtBg.addEventListener("change", () => setTextProp((t) => { t.bg = els.fmtBg.value; }, { thumb: true }));
  els.fmtDuration.addEventListener("change", () => {
    const at = activeText();
    if (!at) return;
    const d = clamp(Number(els.fmtDuration.value) || 7, 0.5, 60);
    history.push(snapshotState());
    if (at.scope === "clip") {
      at.clip.out = at.clip.in + d;
      at.clip.duration = Math.max(at.clip.duration, at.clip.out);
      rebuildLayout();
    } else {
      at.text.dur = Math.min(d, keptDuration(at.clip));
    }
    updateUndoButtons();
    renderStrip();
    refreshFormatPanel();
    refreshEditPanel();
  });
  els.fmtRemoveCaption.addEventListener("click", () => {
    const at = activeText();
    if (!at || at.scope !== "caption") return;
    history.push(snapshotState());
    at.clip.caption = null;
    updateUndoButtons();
    renderStrip();
    syncSelectionUI();
    hint("Caption removed.");
  });

  // Trim dialog
  els.trimStart.addEventListener("input", () => {
    updateTrimLabels();
    dialogAbs = Number(els.trimStart.value);
  });
  els.trimEnd.addEventListener("input", () => {
    updateTrimLabels();
    dialogAbs = Number(els.trimEnd.value);
  });
  els.trimSave.addEventListener("click", () => closeTrimTool(true));
  els.trimCancel.addEventListener("click", () => closeTrimTool(false));

  // Text editor overlay
  els.textEditSave.addEventListener("click", () => closeTextEditor(true));
  els.textEditCancel.addEventListener("click", () => closeTextEditor(false));
  els.textEditArea.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.code === "Enter") {
      e.preventDefault();
      closeTextEditor(true);
    } else if (e.code === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeTextEditor(false);
    }
  });

  // Drag text boxes directly on the monitor; double-click to edit.
  els.stage.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const at = textAtPoint(stagePoint(e));
    if (!at) return;
    stopHover();
    pausePlayback();
    const pt = stagePoint(e);
    dragging = { text: at.text, dx: at.text.x * STAGE_W - pt.x, dy: at.text.y * STAGE_H - pt.y, moved: false };
    els.stage.classList.add("dragging-text");
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (audioDrag) {
      if (!audioDrag.moved) {
        audioDrag.moved = true;
        history.push(snapshotState());
        updateUndoButtons();
      }
      const total = audioDrag.total;
      const dt = ((e.clientX - audioDrag.startX) / audioDrag.laneW) * total;
      const c = audioDrag.clip;
      if (audioDrag.mode === "trim-out") {
        c.out = clamp(audioDrag.startOut + dt, audioDrag.startIn + 0.1, Math.max(c.duration, audioDrag.startIn + 0.1));
      } else if (audioDrag.mode === "trim-in") {
        const nextIn = clamp(audioDrag.startIn + dt, 0, audioDrag.startOut - 0.1);
        c.offset = Math.max(0, audioDrag.startOffset + (nextIn - audioDrag.startIn));
        c.in = nextIn;
      } else {
        c.offset = clamp(audioDrag.startOffset + dt, 0, total);
      }
      const bar = els.audioBars.querySelector(`[data-id="${c.id}"]`);
      if (bar) {
        bar.style.left = `${(c.offset / total) * 100}%`;
        bar.style.width = `${Math.max(1.5, ((c.out - c.in) / total) * 100)}%`;
      }
      refreshMusicPanel();
      return;
    }
    if (dragging) {
      if (!dragging.moved) {
        dragging.moved = true;
        history.push(snapshotState());
        updateUndoButtons();
      }
      const pt = stagePoint(e);
      dragging.text.x = clamp((pt.x + dragging.dx) / STAGE_W, 0, 1);
      dragging.text.y = clamp((pt.y + dragging.dy) / STAGE_H, 0, 1);
      return;
    }
    els.stage.classList.toggle("over-text", e.target === els.stage && !!textAtPoint(stagePoint(e)));
  });
  window.addEventListener("pointerup", endAudioGesture);
  window.addEventListener("pointercancel", endAudioGesture);
  window.addEventListener("mouseup", () => {
    endAudioGesture();
    if (!dragging) return;
    dragging = null;
    els.stage.classList.remove("dragging-text");
  });
  els.stage.addEventListener("dblclick", (e) => {
    if (textAtPoint(stagePoint(e))) openTextEditor();
  });

  wireM5Controls();
  wireM6Controls();

  // Zoom
  els.zoom.addEventListener("input", applyZoom);
  els.btnZoomIn.addEventListener("click", () => { els.zoom.value = clamp(Number(els.zoom.value) + 10, 0, 100); applyZoom(); });
  els.btnZoomOut.addEventListener("click", () => { els.zoom.value = clamp(Number(els.zoom.value) - 10, 0, 100); applyZoom(); });
  els.btnFit.addEventListener("click", () => { els.zoom.value = 35; applyZoom(); });

  // Keyboard
  window.addEventListener("keydown", (e) => {
    if (!els.textEditor.hidden) {
      if (e.code === "Escape") { e.preventDefault(); closeTextEditor(false); }
      return; // let the textarea own every other key
    }
    if (!els.trimOverlay.hidden) {
      if (e.code === "Escape") { e.preventDefault(); closeTrimTool(false); }
      else if (e.code === "Enter") { e.preventDefault(); closeTrimTool(true); }
      return;
    }
    const tag = (e.target.tagName || "").toUpperCase();
    if (tag === "INPUT" && e.target.type !== "range") return;
    if (tag === "TEXTAREA" || tag === "SELECT") return;
    if ((e.metaKey || e.ctrlKey) && e.code === "KeyZ") {
      e.preventDefault();
      if (e.shiftKey) doRedo(); else doUndo();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.code === "KeyS") {
      e.preventDefault();
      saveProject(false);
      return;
    }
    if (e.code === "F9" || ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === "KeyX")) {
      e.preventDefault();
      toggleXray();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.code) {
      case "Space":
        e.preventDefault();
        togglePlay();
        break;
      case "KeyK": pausePlayback(); break; // K pauses; Space toggles
      case "KeyJ": seekProject(T - 2); break;
      case "KeyL": seekProject(T + 2); break;
      case "KeyI": setStartPoint(); break;
      case "KeyO": setEndPoint(); break;
      case "KeyM": splitSelected(); break;
      case "Delete":
      case "Backspace": deleteSelected(); break;
      case "F11":
        e.preventDefault();
        toggleFullscreen();
        break;
      case "Equal":
      case "NumpadAdd":
        els.zoom.value = clamp(Number(els.zoom.value) + 10, 0, 100); applyZoom();
        break;
      case "Minus":
      case "NumpadSubtract":
        els.zoom.value = clamp(Number(els.zoom.value) - 10, 0, 100); applyZoom();
        break;
    }
  });
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else els.monitorPane.requestFullscreen?.().catch(() => {});
}

/* ------------------------------------------------------------------- init */
injectIcons();
buildGalleries();
buildFxGallery();
buildAnimGallery();
initAudio();
wireEvents();
refreshProjectPanel();
applyZoom();
rebuildLayout();
renderStrip();
syncSelectionUI();
updateUndoButtons();
projectDirty = false;
updateTitle();
checkAutosave();
setInterval(autosaveTick, 60000);
requestAnimationFrame(tick);
