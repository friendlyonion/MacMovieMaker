// MacMovieMaker — Milestone 2 clip-state operations.
// DOM-free and Tauri-free so the editing model stays unit-testable.
// The UI layer (main.js) owns rendering; this module owns the rules.

export const PHOTO_DURATION = 7; // seconds shown per still photo
export const MIN_RANGE = 0.1; // minimum kept trim range, seconds
export const SPLIT_MARGIN = 0.05; // playhead must clear clip edges by this much to split

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function createClip({ id, name, kind, url, duration, thumb = null, playable = true }) {
  const d = Math.max(0, duration || 0);
  return {
    id, name, kind, url,
    duration: d, // full media length (photos: PHOTO_DURATION)
    in: 0, // trim start, seconds into media (non-destructive)
    out: d, // trim end, seconds into media
    rotation: 0, // 0 | 90 | 180 | 270
    volume: 1, // 0..1
    muted: false,
    transition: null, // { id, duration } at the clip's START, or null
    panZoom: null, // preset id for photos, or null
    fx: DEFAULT_FX(), // visual-effect chain state (see effects.js)
    text: null, // title/credits card state, or null
    caption: null, // caption overlay state, or null
    thumb, // data-URL thumbnail or null
    playable,
  };
}

/** Length of the kept range after trimming. */
export const keptDuration = (clip) => Math.max(0, clip.out - clip.in);

/** Move the trim start point. Returns the applied value. */
export function setInPoint(clip, t) {
  const maxIn = Math.max(0, clip.out - MIN_RANGE);
  clip.in = clamp(t, 0, maxIn);
  return clip.in;
}

/** Move the trim end point. Returns the applied value. */
export function setOutPoint(clip, t) {
  const floor = clip.in + MIN_RANGE;
  clip.out = clamp(t, floor, Math.max(floor, clip.duration));
  return clip.out;
}

export const PHOTO_DUR_MIN = 0.5; // shortest a still may show, seconds
export const PHOTO_DUR_MAX = 60; // sanity cap for photo durations

/* --------------------------------- timeline axis: one linear project-time
   scale shared by the video strip and the audio lane, so music lines up
   under the clips it plays over and one playhead serves both lanes. */
export const LANE_PX_MIN = 6; // px per project-second at zoom 0
export const LANE_PX_MAX = 90; // px per project-second at zoom 100
export const NARROW_CHIP_PX = 92; // chips below this width hide their pills

/** Zoom slider 0..100 -> px per project-second. */
export const pxPerSecForZoom = (v) =>
  LANE_PX_MIN + (clamp(v, 0, 100) / 100) * (LANE_PX_MAX - LANE_PX_MIN);

/** Inverse map, so Fit can park the slider where the project fits. */
export const zoomForPxPerSec = (pps) =>
  clamp(((pps - LANE_PX_MIN) / (LANE_PX_MAX - LANE_PX_MIN)) * 100, 0, 100);

/** True when a kept range renders too narrow for its badge pills. */
export const isNarrowChip = (kept, pps) => kept * pps < NARROW_CHIP_PX;

/**
 * Pack time spans into wrapped timeline rows.
 * spans: [{ id, w, t0, t1, splitOk }] in time order (w = px at scale).
 * A row breaks before span j when it would overflow maxW — except a span
 * carrying a transition (splitOk=false) stays with its outgoing partner
 * unless the row is already overfull, so blends never straddle rows.
 * Returns rows: [{ ids, t0, t1 }] with contiguous spans (t1[i] = t0[i+1]).
 */
export function packTimelineRows(spans, maxW) {
  const rows = [];
  let cur = null;
  for (const sp of spans) {
    const w = Math.max(0, sp.w);
    if (cur && cur.w + w > maxW && (sp.splitOk !== false || cur.w > maxW)) {
      rows.push(cur);
      cur = null;
    }
    if (!cur) cur = { ids: [], t0: sp.t0, t1: sp.t1, w: 0 };
    cur.ids.push(sp.id);
    cur.w += w;
    cur.t1 = sp.t1;
  }
  if (cur) rows.push(cur);
  rows.forEach((r, i) => {
    if (i + 1 < rows.length) r.t1 = rows[i + 1].t0;
    delete r.w;
  });
  return rows;
}

/**
 * Set the kept length directly (photo duration control). Stills have no real
 * media end, so the photo's duration extends to fit; anything else clamps to
 * its media length. Returns the applied kept seconds.
 */
export function setKeptDuration(clip, seconds) {
  const lo = Math.max(MIN_RANGE, PHOTO_DUR_MIN);
  let want = clamp(Number(seconds) || 0, lo, PHOTO_DUR_MAX);
  if (clip.kind !== "image") {
    want = Math.min(want, Math.max(lo, clip.duration - clip.in));
  } else {
    clip.duration = Math.max(clip.duration, clip.in + want);
  }
  clip.out = clip.in + want;
  return keptDuration(clip);
}

/** True when the playhead is far enough inside the kept range to split. */
export function splitPointValid(clip, t) {
  return t > clip.in + SPLIT_MARGIN && t < clip.out - SPLIT_MARGIN;
}

/**
 * Split a clip at absolute media time t.
 * Returns [left, right] (right carries newId) or null when invalid.
 * Both halves keep rotation/volume/mute; thumbnails are refreshed by the UI.
 */
export function splitClip(clip, t, newId) {
  if (!splitPointValid(clip, t)) return null;
  const left = { ...clip, out: t };
  const right = { ...clip, id: newId, in: t };
  // Nested state must not be shared: each half owns its copy.
  for (const half of [left, right]) {
    if (half.transition) half.transition = { ...half.transition };
    if (half.fx) half.fx = { ...half.fx };
    if (half.text) half.text = structuredClone(half.text);
    if (half.caption) half.caption = structuredClone(half.caption);
  }
  return [left, right];
}

/** Remove a clip; reports which clip should be selected next. */
export function deleteClip(clips, id) {
  const idx = clips.findIndex((c) => c.id === id);
  if (idx < 0) return { clips, selectId: null };
  const rest = clips.filter((c) => c.id !== id);
  const next = rest[Math.min(idx, rest.length - 1)] ?? null;
  return { clips: rest, selectId: next ? next.id : null };
}

/** Rotate in 90° steps. Returns the new rotation. */
export function rotateClip(clip, delta) {
  clip.rotation = (((clip.rotation + delta) % 360) + 360) % 360;
  return clip.rotation;
}

export const DEFAULT_FX = () => ({ effect: "none", brightness: 0, fadeIn: "none", fadeOut: "none" });

/* ------------------------------------------------------- sequence layout
   Transitions OVERLAP: a D-second transition on clip i blends the last D
   seconds of clip i-1 with the first D of clip i, so the project shortens
   by D. A transition on the first clip blends up from black (no time cost).
   clip.transition = { id, duration } | null/undefined. */

export const TRANS_DUR_MIN = 0.25;
export const TRANS_DUR_MAX = 2;
export const TRANS_DUR_DEFAULT = 1;

export function effTransDur(clip) {
  if (!clip?.transition) return 0;
  return clamp(clip.transition.duration, TRANS_DUR_MIN, TRANS_DUR_MAX);
}

/**
 * segments[i] = { clipId, start, end, bodyStart, kept,
 *                 x: null | { start, end, dur, fromId: number|null } }
 */
export function computeLayout(clips) {
  const segments = [];
  let cursor = 0;
  clips.forEach((clip, i) => {
    const kept = keptDuration(clip);
    let dur = 0;
    const want = effTransDur(clip);
    if (want > 0 && kept > 0) {
      dur = Math.min(want, kept);
      if (i > 0) dur = Math.min(dur, keptDuration(clips[i - 1]));
    }
    if (dur < 0.01) dur = 0;
    const bodyStart = i === 0 ? 0 : cursor - dur;
    const end = bodyStart + kept;
    segments.push({
      clipId: clip.id, start: bodyStart, end, bodyStart, kept,
      x: dur > 0 ? { start: bodyStart, end: bodyStart + dur, dur, fromId: i === 0 ? null : clips[i - 1].id } : null,
    });
    cursor = end;
  });
  return { segments, total: cursor };
}

/**
 * Map project time to a location. clipsById: Map(id -> clip).
 * Returns {type:'empty'} | {type:'body',i,local} | {type:'x',i,p,localA,localB}
 * where locals are ABSOLUTE media seconds. localA is null for from-black.
 */
export function locAtT(layout, clipsById, T) {
  const segs = layout.segments;
  if (!segs.length) return { type: "empty" };
  const t = clamp(T, 0, layout.total);
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.x && t >= s.x.start && t < s.x.end) {
      const clipB = clipsById.get(s.clipId);
      const localB = clipB.in + (t - s.x.start);
      let localA = null;
      if (s.x.fromId != null) {
        const clipA = clipsById.get(s.x.fromId);
        localA = clipA.out - (s.x.end - t);
      }
      return { type: "x", i, p: clamp((t - s.x.start) / s.x.dur, 0, 1), localA, localB };
    }
  }
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (t < s.end || i === segs.length - 1) {
      const clip = clipsById.get(s.clipId);
      return { type: "body", i, local: clip.in + (t - s.bodyStart) };
    }
  }
  return { type: "empty" }; // unreachable
}

/** Bounded snapshot undo/redo stack. States must be structured-cloneable. */
export class History {
  constructor(limit = 50) {
    this.limit = limit;
    this.past = [];
    this.future = [];
  }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  /** Record the state BEFORE a mutation; clears the redo stack. */
  push(state) {
    this.past.push(structuredClone(state));
    if (this.past.length > this.limit) this.past.shift();
    this.future.length = 0;
  }
  /** Returns the state to restore, or null. */
  undo(current) {
    if (!this.canUndo) return null;
    this.future.push(structuredClone(current));
    return this.past.pop();
  }
  /** Returns the state to restore, or null. */
  redo(current) {
    if (!this.canRedo) return null;
    this.past.push(structuredClone(current));
    return this.future.pop();
  }
}

/** Reorder helper: moves fromId before/after toId in place. False = no-op. */
export function moveClipIn(list, fromId, toId, before) {
  const from = list.findIndex((c) => c.id === fromId);
  const to = list.findIndex((c) => c.id === toId);
  if (from < 0 || to < 0 || from === to) return false;
  const [moved] = list.splice(from, 1);
  const at = list.findIndex((c) => c.id === toId) + (before ? 0 : 1);
  list.splice(at, 0, moved);
  return true;
}

/**
 * Pointer-reorder hit test: given chip rects [{id,left,right,top,bottom}] in
 * strip order and a pointer point, returns {id, before} naming the insertion
 * gap. Multi-row aware: the pointer's row wins; above all rows inserts before
 * the first chip, below all rows after the last. DOM-free; the UI layer
 * supplies rects from getBoundingClientRect.
 */
export function insertionGap(rects, x, y) {
  if (!rects.length) return null;
  const ROW_PAD = 6;
  let row = rects.filter((r) => y >= r.top - ROW_PAD && y <= r.bottom + ROW_PAD);
  if (!row.length) {
    if (y < rects[0].top) return { id: rects[0].id, before: true };
    const last = rects[rects.length - 1];
    return { id: last.id, before: false };
  }
  row = [...row].sort((a, b) => a.left - b.left);
  for (const r of row) {
    if (x < (r.left + r.right) / 2) return { id: r.id, before: true };
  }
  return { id: row[row.length - 1].id, before: false };
}

/** True when moving fromId before/after toId would change the id order. */
export function reorderChanged(ids, fromId, toId, before) {
  if (fromId === toId) return false;
  const list = ids.map((id) => ({ id }));
  if (!moveClipIn(list, fromId, toId, before)) return false;
  return list.some((c, i) => c.id !== ids[i]);
}
