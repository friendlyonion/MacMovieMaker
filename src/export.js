// MacMovieMaker — Milestone 6 export plan builder.
// Pure, DOM-free: turns project state + a save preset into an ffmpeg
// invocation (inputs, -filter_complex script, output args). Node-safe.
//
// Preview parity is structural, not aspirational: effects reuse
// buildExportFilter, pan/zoom reuses the preset from/to views, transitions
// reuse the transition ids, and text arrives as prerendered canvas frames
// painted by the preview's own drawTextBox.

import { buildExportFilter } from "./effects.js";
import { transById, pzById, GEOM } from "./gallery.js";
import { computeLayout, keptDuration } from "./clipops.js";
import { FADE_SECONDS, emphasisFactor } from "./audio.js";

/* ------------------------------------------------------------ save presets
   SPEC §12 verified list. Everything renders mp4 (H.264 + AAC). */

export const SAVE_PRESETS = [
  { id: "recommended", name: "Recommended for this project", group: "Recommended", adapt: true, fps: 30, vbr: "12M", abr: "128k" },
  { id: "hd", name: "For high-definition display", group: "Common settings", w: 1920, h: 1080, fps: 30, vbr: "12M", abr: "128k" },
  { id: "computer", name: "For computer", group: "Common settings", w: 1280, h: 720, fps: 30, vbr: "8M", abr: "128k" },
  { id: "email", name: "For email", group: "Common settings", w: 640, h: 360, fps: 30, vbr: "1.5M", abr: "96k" },
  { id: "android-large", name: "Android Phone (large)", group: "Phone and device settings", w: 1280, h: 720, fps: 30, vbr: "5M", abr: "128k" },
  { id: "android-medium", name: "Android Phone (medium)", group: "Phone and device settings", w: 848, h: 480, fps: 30, vbr: "2.5M", abr: "128k" },
  { id: "iphone", name: "Apple iPhone", group: "Phone and device settings", w: 1280, h: 720, fps: 30, vbr: "10.8M", abr: "128k" },
  { id: "winphone-large", name: "Windows Phone (large)", group: "Phone and device settings", w: 1280, h: 720, fps: 30, vbr: "5M", abr: "128k" },
  { id: "winphone-small", name: "Windows Phone (small)", group: "Phone and device settings", w: 640, h: 360, fps: 30, vbr: "1.5M", abr: "96k" },
  { id: "zune-720p", name: "Zune HD (for 720p display)", group: "Phone and device settings", w: 1280, h: 720, fps: 30, vbr: "8M", abr: "128k" },
  { id: "zune-device", name: "Zune HD (for device)", group: "Phone and device settings", w: 480, h: 272, fps: 30, vbr: "1M", abr: "96k" },
];

/** Recommended adapts to the project aspect; every other preset is fixed. */
export function resolvePreset(preset, aspect = "16:9") {
  if (preset.adapt) {
    return aspect === "4:3"
      ? { ...preset, w: 1440, h: 1080 }
      : { ...preset, w: 1920, h: 1080 };
  }
  return { ...preset };
}

export function parseBitrate(s) {
  const m = /^([\d.]+)\s*([kM])$/i.exec(String(s || "").trim());
  if (!m) return 0;
  return Number(m[1]) * (m[2].toLowerCase() === "m" ? 1_000_000 : 1_000);
}

/** Estimated megabytes per minute of rendered movie. */
export function estimateMBPerMin(preset) {
  const bits = parseBitrate(preset.vbr) + parseBitrate(preset.abr);
  return (bits / 8) * 60 / 1_000_000;
}

export function presetBlurb(preset) {
  return `${preset.w}×${preset.h} · ${preset.fps} fps · ${preset.vbr} video`;
}

/* ------------------------------------------------------- custom settings */

const CUSTOM_KEY = "mmm.customPresets.v1";

const storeOf = () =>
  typeof localStorage !== "undefined" ? localStorage : null;

const validCustom = (p) =>
  p && typeof p === "object" &&
  typeof p.id === "string" && typeof p.name === "string" &&
  Number.isFinite(p.w) && Number.isFinite(p.h) && Number.isFinite(p.fps) &&
  typeof p.vbr === "string" && typeof p.abr === "string";

export function loadCustomPresets(storage = storeOf()) {
  try {
    const raw = storage?.getItem(CUSTOM_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(validCustom).map((p) => ({ ...p, group: "Recent settings", custom: true }));
  } catch {
    return [];
  }
}

export function saveCustomPreset(storage, preset) {
  const s = storage ?? storeOf();
  const list = loadCustomPresets(s).filter((p) => p.id !== preset.id);
  list.unshift({ ...preset, group: "Recent settings", custom: true });
  try {
    s?.setItem(CUSTOM_KEY, JSON.stringify(list.slice(0, 12)));
  } catch { /* private mode: session-only */ }
  return list.slice(0, 12);
}

/* ------------------------------------------------- transition mapping
   Preview semantics (gallery.js TRANS_RENDER) drive the choice:
   - native xfade where the shape matches (wipe/push directions verified
     against rendered fixture frames),
   - alphamerge+overlay with an animated geq mask where no xfade shape fits,
   - nearest xfade for the dimensional moves (already 2D-approximated
     in the preview; see the M3 report). */

export const XFADE_OF = {
  "fade-black": "fadeblack",
  dissolve: "fade",
  "dip-white": "fadewhite",
  "wipe-right": "wiperight",
  "wipe-left": "wipeleft",
  "wipe-up": "wipeup",
  "wipe-down": "wipedown",
  "push-left": "slideleft",
  "push-right": "slideright",
  "push-up": "slideup",
  "push-down": "slidedown",
  pixelate: "pixelize",
  "shatter-in": "pixelize", // preview reuses the pixelate painter: exact
  "shatter-out": "dissolve", // preview noise-block dissolve: same look family
  "soft-r": "smoothright",
  "soft-l": "smoothleft",
  "soft-d": "smoothdown",
  "soft-u": "smoothup",
};

export const MASK_KIND = {
  "wipe-diagonal": "wdiag",
  "wipe-diagonal-tr": "wdiagTR",
  "iris-circle": "icircle",
  "iris-diamond": "diamond",
  "iris-close": "iclose",
  clock: "clock",
  pinwheel: "pin2",
  whirl: "pin3", // 3-arm radial sweep in both engines (no swirl distortion)
  "bowtie-h": "bowtie",
  "bowtie-v": "vbow",
  checker: "checker",
  "page-turn": "pageturn",
  "page-roll": "pageroll",
  "curl-1": "curl1",
  "curl-2": "curl2",
};

// Transition ids rendered as keyframed geometric joins (shared GEOM
// definitions with the canvas preview — exact by construction).
// Documented approximations across both engines: flip = flat scaleX
// collapse/expand (no 3D perspective); doors = flat meeting panels;
// shatter-in = pixelize; shatter-out = noise-block dissolve (export:
// xfade dissolve); whirl = 3-arm radial sweep; pixelate block counts
// differ slightly between engines; soft-wipe ramp curves differ
// slightly (canvas multi-slice vs xfade smooth*).
export const GEOM_KIND = {
  flip: "flip", spin: "spin", "spin-orbit": "spinorbit", roll: "roll",
  doors: "doors", "zoom-out": "zoomout", "zoom-in": "zoomin",
  "squeeze-h": "squeeze", "stretch-in": "stretch",
  "fly-bl": "flybl", "fly-br": "flybr", "fly-tl": "flytl", "fly-tr": "flytr",
  "box-reveal": "inset", "split-h": "splith", "split-v": "splitv",
  blinds: "bars", shred: "shred",
};

// Mask kinds with a traveling shade band (see shadeExpr).
export const SHADE_KIND = { pageturn: 1, pageroll: 1, curl1: 1, curl2: 1 };

/** Animated luma-mask expressions mirroring the preview painters. P = N/NF. */
export function maskExpr(kind, W, H, NF) {
  const P = `(N/${NF})`;
  if (kind === "wdiag") {
    // Preview: top boundary x=W*p*2-H/2, sloping down H/2 over the frame.
    return `if(lt(X,${W}*${P}*2-${H}*0.5-Y*0.5),255,0)`;
  }
  if (kind === "diamond") {
    // x2.01 overgrowth fills the corners exactly at p=1, like the painter.
    return `if(lt(abs(X-${W}/2)/(${W}/2)+abs(Y-${H}/2)/(${H}/2),${P}*2.01),255,0)`;
  }
  if (kind === "icircle") {
    // B inside the opening circle (radius P*hypot/2, like the painter).
    const DC = Math.hypot(W, H).toFixed(3);
    return `if(lt(hypot(X-${W}/2,Y-${H}/2),${P}*${DC}/2),255,0)`;
  }
  if (kind === "checker") {
    const cw = (W / 12).toFixed(4);
    const ch = (H / 7).toFixed(4);
    return `if(lt(mod(floor(X/${cw})*7+floor(Y/${ch})*13,16)/16,${P}),255,0)`;
  }
  if (kind === "pageturn") {
    return `if(lt(X,${W}*${P}*1.35-Y/${H}*${W}*0.3),255,0)`;
  }
  if (kind === "wdiagTR") {
    // Mirror of wdiag: sweeps from the top-right to bottom-left.
    return `if(gt(X,${W}-(${W}*${P}*2-${H}*0.5)+Y*0.5),255,0)`;
  }
  if (kind === "iclose") {
    // B outside the shrinking circle (evenodd painter equivalent).
    const D = Math.hypot(W, H).toFixed(3);
    return `if(gt(hypot(X-${W}/2,Y-${H}/2),(1-${P})*${D}/2),255,0)`;
  }
  if (kind === "clock") {
    // Radial sweep from 12 o'clock, one full clockwise rotation.
    return `if(lt(mod(atan2(X-${W}/2,-(Y-${H}/2))+2*PI,2*PI),2*PI*${P}),255,0)`;
  }
  if (kind === "pin2") {
    // 2-arm pinwheel: each arm sweeps half the frame.
    return `if(lt(mod(atan2(X-${W}/2,-(Y-${H}/2))+2*PI,PI),PI*${P}),255,0)`;
  }
  if (kind === "pin3") {
    // 3-arm sweep shared by the whirl painter (no swirl distortion).
    return `if(lt(mod(atan2(X-${W}/2,-(Y-${H}/2))+2*PI,2*PI/3),2*PI/3*${P}),255,0)`;
  }
  if (kind === "bowtie") {
    // Angle-growing triangles; same tan curve as the painter.
    return `if(lte(abs(Y-${H}/2),abs(X-${W}/2)*${H}/${W}*tan(${P}*PI/2)),255,0)`;
  }
  if (kind === "vbow") {
    return `if(lte(abs(X-${W}/2),abs(Y-${H}/2)*${W}/${H}*tan(${P}*PI/2)),255,0)`;
  }
  if (kind === "pageroll") {
    // B revealed beneath the roll edge rising from the bottom.
    return `if(gt(Y,${H}*(1-${P})),255,0)`;
  }
  if (kind === "curl1") {
    // Single corner peel: B where X+Y sits past the fold line.
    return `if(gte(X+Y,(${W}+${H})*(1-1.3*${P})),255,0)`;
  }
  if (kind === "curl2") {
    // Opposite corners peel simultaneously.
    return `if(lte(X+Y,(${W}+${H})*1.3*${P})+gte(X+Y,(${W}+${H})*(1-1.3*${P})),255,0)`;
  }
  throw new Error(`unknown mask kind ${kind}`);
}

/** Traveling shade-band multipliers mirroring the painters (1 = no shade).
 * P = N/NF. Applied in yuv444p so the geometry stays full-resolution. */
export function shadeExpr(kind, W, H, NF) {
  const P = `(N/${NF})`;
  if (kind === "pageturn") {
    // 46px horizontal ramp on the B side of the diagonal edge.
    const E1 = `${W}*${P}*1.35`;
    const EY = `${E1}-0.3*${W}*Y/${H}`;
    return `(1-(0.38*min(max((X-(${E1}-46))/46,0),1)*lte(X,${EY})*gte(X,${EY}-46)))`;
  }
  if (kind === "pageroll") {
    // 36px vertical ramp above the rising roll edge.
    const E = `${H}*(1-${P})`;
    const TOP = `max(${E}-36,0)`;
    return `(1-0.4*min(max((Y-${TOP})/max(${E}-${TOP},0.001),0),1)*lte(Y,${E}))`;
  }
  if (kind === "curl1") {
    // 46px band (65.05 along X+Y) on the A side of the fold line.
    const C = `(${W}+${H})*(1-1.3*${P})`;
    const D = `${C}-(X+Y)`;
    return `(1-0.38*min(max(1-(${D})/65.0538,0),1)*gte(${D},0))`;
  }
  if (kind === "curl2") {
    const C1 = `(${W}+${H})*1.3*${P}`;
    const C2 = `(${W}+${H})*(1-1.3*${P})`;
    const D1 = `(X+Y)-${C1}`, D2 = `${C2}-(X+Y)`;
    return `((1-0.38*min(max(1-(${D1})/65.0538,0),1)*gte(${D1},0))*(1-0.38*min(max(1-(${D2})/65.0538,0),1)*gte(${D2},0)))`;
  }
  if (kind === "flipd") {
    // Card-turn shading dip at mid-flip (0.35, like the painter).
    return `(1-0.35*abs(sin(PI*${P})))`;
  }
  throw new Error(`unknown shade kind ${kind}`);
}

/* ---------------------------------------------------------- plan builder */

const f3 = (v) => Number(v).toFixed(3);
const f6 = (v) => Number(v).toFixed(6);
const even = (v) => Math.max(2, Math.ceil(v / 2) * 2);

const TRANSPOSE_OF = { 90: "transpose=1", 180: "transpose=1,transpose=1", 270: "transpose=2" };
const transposeOf = (clip) => TRANSPOSE_OF[((clip.rotation % 360) + 360) % 360] || "";

/** Ken Burns zoompan chain reusing the preset's from/to views (linear, like the preview). */
export function pzChain(presetId, W, H, fps, kept) {
  const preset = pzById(presetId);
  const cover = (w, h) =>
    `scale=w='if(gt(iw/ih,${W}/${H}),-1,${w})':h='if(gt(iw/ih,${W}/${H}),${h},-1)'`;
  // No pan/zoom: contain-fit with black bars, exactly like the preview
  // (drawFull scales by min() and centers on a black stage). Photos with a
  // preset take the zoompan path below and fill the frame.
  if (!preset) {
    return `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
      `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`;
  }
  const N = Math.max(1, Math.round(kept * fps));
  const PW = even(W * 1.5);
  const PH = even(H * 1.5);
  const { from, to } = preset;
  const z = `${f6(from.z)}+(${(to.z - from.z).toFixed(6)})*on/${N}`;
  const x = `min(max((${f6(from.cx)}+(${(to.cx - from.cx).toFixed(6)})*on/${N})*in_w-(in_w/zoom/2),0),in_w-in_w/zoom)`;
  const y = `min(max((${f6(from.cy)}+(${(to.cy - from.cy).toFixed(6)})*on/${N})*in_h-(in_h/zoom/2),0),in_h-in_h/zoom)`;
  return `${cover(PW, PH)},format=yuv420p,zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${W}x${H}:fps=${fps}`;
}

/**
 * Build the full ffmpeg plan.
 *
 * clips/audioClips: project state (clips carry transition/fx/text/caption).
 * resolved: {
 *   clipInput: Map<clipId, {kind:'file',path}|{kind:'seq',pattern}|null>,
 *   audioInput: Map<audioId, path|null>,
 *   captionSeq: Map<clipId, {pattern,start,dur}|null>,
 *   hasAudio: Map<clipId, bool>,   // video stream probe
 * }
 * preset: resolved {w,h,fps,vbr,abr}; total: project seconds incl. audio.
 */
export function buildExportPlan({ clips, audioClips, emphasis = "none", preset, total, resolved }) {
  const warnings = [];
  const stats = { clips: 0, joins: { xfade: 0, custom: 0, geo: 0, concat: 0 }, captions: 0, cards: 0, audioLegs: 0 };
  const { W, H, fps } = { W: preset.w, H: preset.h, fps: preset.fps };
  const usable = clips.filter((c) => keptDuration(c) > 0.01);
  for (const c of clips) {
    if (keptDuration(c) <= 0.01) warnings.push(`“${c.name}” has no kept range — left out of the export.`);
  }
  if (!usable.length) throw new Error("Nothing to export: the storyboard is empty.");
  const layout = computeLayout(usable);

  const inputs = []; // {path, args[]}
  const chains = []; // filterchains joined with ';'
  const addInput = (path, args) => {
    inputs.push({ path, args });
    return inputs.length - 1;
  };

  /* ---- per-clip legs (fps FIRST: fps after a spatial/format filter
         drops the final frame — measured 44f vs 45f) ---- */
  const legOf = new Map(); // clipId -> label
  const inputOf = new Map(); // clipId -> ffmpeg input index
  usable.forEach((clip, i) => {
    const kept = keptDuration(clip);
    const tag = `leg${i}`;
    const fx = buildExportFilter(clip.fx, { W, H, kept });
    const fxTail = fx ? `,${fx}` : "";
    const rot = transposeOf(clip);
    const rotHead = rot ? `${rot},` : "";
    const res = resolved.clipInput.get(clip.id) ?? null;

    if (clip.kind === "title" || clip.kind === "credits") {
      stats.cards++;
      if (res?.kind === "seq") {
        const k = addInput(res.pattern, ["-framerate", String(fps)]);
        chains.push(`[${k}:v]fps=${fps},format=yuv420p,setsar=1${fxTail}[${tag}]`);
      } else {
        warnings.push(`“${clip.name}”: title frames unavailable — rendering its card color.`);
        const bg = ((clip.text?.bg || "#1f2937").replace("#", "0x")).slice(0, 8);
        chains.push(`color=c=${bg}:s=${W}x${H}:d=${f3(kept)}:r=${fps},fps=${fps},format=yuv420p[${tag}]`);
      }
    } else if (!res) {
      warnings.push(`“${clip.name}” is missing its media file — rendering a placeholder.`);
      chains.push(`color=c=0x141416:s=${W}x${H}:d=${f3(kept)}:r=${fps},fps=${fps},format=yuv420p[${tag}]`);
    } else if (clip.kind === "image") {
      const k = addInput(res.path, ["-loop", "1", "-framerate", String(fps), "-t", f3(kept)]);
      inputOf.set(clip.id, k);
      chains.push(`[${k}:v]setpts=PTS-STARTPTS,fps=${fps},${rotHead}${pzChain(clip.panZoom, W, H, fps, kept)},setsar=1,format=yuv420p${fxTail}[${tag}]`);
    } else {
      const k = addInput(res.path, ["-ss", f6(clip.in), "-t", f3(kept)]);
      inputOf.set(clip.id, k);
      chains.push(
        `[${k}:v]setpts=PTS-STARTPTS,fps=${fps},${rotHead}scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p${fxTail}[${tag}]`
      );
    }
    legOf.set(clip.id, tag);
  });
  stats.clips = usable.length;

  /* ---- joins ---- */
  let joinN = 0;
  const customJoin = (aLabel, bLabel, kind, dur, off, keptB) => {
    dur = Math.max(1 / fps, Math.round(dur * fps) / fps);
    off = Math.round(off * fps) / fps;
    const j = joinN++;
    const NF = Math.max(1, Math.round(dur * fps));
    const needPre = off > 0.5 / fps;
    const needPost = keptB - dur > 0.5 / fps;
    if (needPre) {
      chains.push(`[${aLabel}]split=2[apre${j}][amd${j}]`);
      chains.push(`[amd${j}]trim=start=${f6(off)}:end=${f6(off + dur)},setpts=PTS-STARTPTS[aw${j}]`);
      chains.push(`[apre${j}]trim=start=0:end=${f6(off)},setpts=PTS-STARTPTS[pre${j}]`);
    } else {
      chains.push(`[${aLabel}]trim=start=${f6(off)}:end=${f6(off + dur)},setpts=PTS-STARTPTS[aw${j}]`);
    }
    if (needPost) {
      chains.push(`[${bLabel}]split=2[bmd${j}][bpost${j}]`);
      chains.push(`[bpost${j}]trim=start=${f6(dur)},setpts=PTS-STARTPTS[post${j}]`);
    } else {
      chains.push(`[${bLabel}]trim=start=0:end=${f6(dur)},setpts=PTS-STARTPTS[bw${j}]`);
    }
    if (needPost) {
      // (split declared above; bw branch after post for readability)
      chains.push(`[bmd${j}]trim=start=0:end=${f6(dur)},setpts=PTS-STARTPTS[bw${j}]`);
    }
    chains.push(
      `color=c=white:s=${W}x${H}:d=${f3(dur + 0.25)}:r=${fps},fps=${fps},format=gray,` +
      `geq=lum='${maskExpr(kind, W, H, NF)}'[mask${j}]`
    );
    // NB: maskedmerge only masks luma (chroma averages) — alpha
    // compositing switches all planes.
    chains.push(`[bw${j}]format=yuva420p[bwf${j}]`);
    chains.push(`[bwf${j}][mask${j}]alphamerge[fg${j}]`);
    chains.push(`[aw${j}][fg${j}]overlay=0:0:eof_action=pass[mg${j}]`);
    // Traveling shade band (yuv444p keeps the geometry full-resolution).
    let mOut = `mg${j}`;
    if (SHADE_KIND[kind]) {
      const S = shadeExpr(kind, W, H, NF);
      chains.push(
        `[mg${j}]format=yuv444p,` +
        `geq=lum='p(X,Y)*${S}':cb='128+(cb(X,Y)-128)*${S}':cr='128+(cr(X,Y)-128)*${S}',` +
        `format=yuv420p[mgs${j}]`
      );
      mOut = `mgs${j}`;
    }
    const order = [];
    if (needPre) order.push(`pre${j}`);
    order.push(mOut);
    if (needPost) order.push(`post${j}`);
    if (order.length === 1) return mOut;
    const out = `vj${j}`;
    // concat emits microsecond timebase with unknown rate; xfade needs
    // matching timebases and known CFR downstream, so every join output
    // is reclocked here (lossless: concat preserves durations).
    chains.push(`[${order.join("][")}]concat=n=${order.length}:v=1:a=0[vcj${j}]`);
    chains.push(`[vcj${j}]fps=${fps}[${out}]`);
    return out;
  };

  // Keyframed geometric join: the transition window is sliced into
  // per-frame stages; each stage is a static crop/scale/rotate/overlay
  // chain evaluating the shared GEOM kind (the same spec the canvas
  // preview's paintGeom draws), so export matches preview by
  // construction.
  const geomJoin = (aLabel, bLabel, kind, dur, off, keptB) => {
    dur = Math.max(1 / fps, Math.round(dur * fps) / fps);
    off = Math.round(off * fps) / fps;
    const j = joinN++;
    const NF = Math.max(1, Math.round(dur * fps));
    const needPre = off > 0.5 / fps;
    const needPost = keptB - dur > 0.5 / fps;
    if (needPre) {
      chains.push(`[${aLabel}]split=2[apreg${j}][amdg${j}]`);
      chains.push(`[amdg${j}]trim=start=${f6(off)}:end=${f6(off + dur)},setpts=PTS-STARTPTS[awg${j}]`);
      chains.push(`[apreg${j}]trim=start=0:end=${f6(off)},setpts=PTS-STARTPTS[preg${j}]`);
    } else {
      chains.push(`[${aLabel}]trim=start=${f6(off)}:end=${f6(off + dur)},setpts=PTS-STARTPTS[awg${j}]`);
    }
    if (needPost) {
      chains.push(`[${bLabel}]split=2[bmdg${j}][bpostg${j}]`);
      chains.push(`[bpostg${j}]trim=start=${f6(dur)},setpts=PTS-STARTPTS[postg${j}]`);
      chains.push(`[bmdg${j}]trim=start=0:end=${f6(dur)},setpts=PTS-STARTPTS[bwg${j}]`);
    } else {
      chains.push(`[${bLabel}]trim=start=0:end=${f6(dur)},setpts=PTS-STARTPTS[bwg${j}]`);
    }
    const ev0 = (v) => Math.max(0, Math.round(v / 2) * 2);
    const stages = [];
    for (let k = 0; k < NF; k++) {
      // Windows share exact seam values (t0[k+1] === t1[k] bit-for-bit):
      // between() is inclusive, so a frame starting exactly on a seam
      // matches both stages and the later one wins. The -1e-4 keeps every
      // window start strictly below its first frame's timestamp, immune
      // to decimal rounding of the bound (a rounded-up t0 would orphan
      // the frame onto the bare base).
      const t0 = (k * dur) / NF - 1e-4;
      const t1 = k < NF - 1 ? ((k + 1) * dur) / NF - 1e-4 : dur + 1;
      const spec = GEOM[kind]((k + 0.5) / NF, W, H);
      // Drop empty and sub-pixel layers: canvas renders them as invisible
      // slivers, while a 2px-minimum scale would paint a visible line.
      spec.layers = spec.layers.filter((l) => {
        const cw = l.crop ? l.crop[2] : W, ch = l.crop ? l.crop[3] : H;
        const sx = l.scale ? l.scale[0] : 1, sy = l.scale ? l.scale[1] : 1;
        return cw > 0 && ch > 0 && cw * sx >= 1 && ch * sy >= 1;
      });
      stages.push({ spec, t0, t1 });
    }
    // Branch taps, in the same order the stage loop below consumes them.
    // Every split output must be consumed exactly once (ffmpeg rejects
    // unconnected pads), so sources feed the base and/or taps only.
    const tapsA = [], tapsB = [];
    stages.forEach((s, k) => s.spec.layers.forEach((l, li) => {
      (l.src === "a" ? tapsA : tapsB).push([k, li]);
    }));
    const tapOf = new Map();
    const wireSrc = (trimLbl, baseLbl, tapPfx, tag, taps, isBase) => {
      const T = taps.length;
      if (T === 0) return isBase ? trimLbl : null;
      if (T === 1 && !isBase) {
        tapOf.set(`${tag}${taps[0][0]}.${taps[0][1]}`, trimLbl);
        return null;
      }
      let chain = `[${trimLbl}]split=${T + (isBase ? 1 : 0)}`;
      if (isBase) chain += `[${baseLbl}]`;
      taps.forEach(([k, li], i) => {
        chain += `[${tapPfx}${i}]`;
        tapOf.set(`${tag}${k}.${li}`, `${tapPfx}${i}`);
      });
      chains.push(chain);
      return isBase ? baseLbl : null;
    };
    const base0 = stages[0].spec.base;
    const baseA = wireSrc(`awg${j}`, `awgb${j}`, `ga${j}_`, "a", tapsA, base0 === "a");
    const baseB = wireSrc(`bwg${j}`, `bwgb${j}`, `gb${j}_`, "b", tapsB, base0 === "b");
    let curLbl;
    if (base0 === "black") {
      chains.push(`color=c=black:s=${W}x${H}:d=${f3(dur)}:r=${fps},fps=${fps},format=yuv420p[bbg${j}]`);
      curLbl = `bbg${j}`;
    } else {
      curLbl = base0 === "a" ? baseA : baseB;
    }
    // Oversize rotated layers so corners stay covered (rotate keeps dims).
    const K = 1.42;
    let on = 0;
    stages.forEach((s, k) => {
      s.spec.layers.forEach((l, li) => {
        let lbl = tapOf.get(`${l.src}${k}.${li}`);
        const cw = l.crop ? l.crop[2] : W, ch = l.crop ? l.crop[3] : H;
        if (l.crop) {
          const [cx, cy, cww, chh] = l.crop;
          const nl = `gt${j}_${on++}`;
          chains.push(`[${lbl}]crop=${even(cww)}:${even(chh)}:${ev0(cx)}:${ev0(cy)}[${nl}]`);
          lbl = nl;
        }
        const sx = l.scale ? l.scale[0] : 1, sy = l.scale ? l.scale[1] : 1;
        const rot = l.rotate || 0;
        const kk = rot ? K : 1;
        if (sx !== 1 || sy !== 1 || rot) {
          const nl = `gs${j}_${on++}`;
          chains.push(`[${lbl}]scale=${even(cw * sx * kk)}:${even(ch * sy * kk)}[${nl}]`);
          lbl = nl;
        }
        // Rotated and translucent layers composite via alpha so corners
        // stay transparent and blends match the canvas globalAlpha math.
        if (rot || (l.alpha != null && l.alpha < 1)) {
          const nl = `gm${j}_${on++}`;
          let expr = `[${lbl}]format=yuva420p`;
          if (rot) expr += `,rotate=${f6(rot)}:fillcolor=black@0`;
          if (l.alpha != null && l.alpha < 1) expr += `,colorchannelmixer=aa=${f6(Math.max(l.alpha, 0))}`;
          chains.push(`${expr}[${nl}]`);
          lbl = nl;
        }
        let ox = l.pos[0], oy = l.pos[1];
        if (rot) {
          ox -= ((kk - 1) * cw * sx) / 2;
          oy -= ((kk - 1) * ch * sy) / 2;
        }
        const nl = `gc${j}_${on++}`;
        chains.push(`[${curLbl}][${lbl}]overlay=x=${f6(ox)}:y=${f6(oy)}:enable='between(t,${f6(s.t0)},${f6(s.t1)})':eof_action=pass[${nl}]`);
        curLbl = nl;
      });
    });
    if (kind === "flip") {
      // Card-turn shading dip at mid-flip, matching the canvas painter.
      const S = shadeExpr("flipd", W, H, NF);
      const nl = `gf${j}`;
      chains.push(
        `[${curLbl}]format=yuv444p,` +
        `geq=lum='p(X,Y)*${S}':cb='128+(cb(X,Y)-128)*${S}':cr='128+(cr(X,Y)-128)*${S}',` +
        `format=yuv420p[${nl}]`
      );
      curLbl = nl;
    }
    const order = [];
    if (needPre) order.push(`preg${j}`);
    order.push(curLbl);
    if (needPost) order.push(`postg${j}`);
    if (order.length === 1) return curLbl;
    const out = `vj${j}`;
    // concat emits microsecond timebase with unknown rate; xfade needs
    // matching timebases and known CFR downstream, so every join output
    // is reclocked here (lossless: concat preserves durations).
    chains.push(`[${order.join("][")}]concat=n=${order.length}:v=1:a=0[vcj${j}]`);
    chains.push(`[vcj${j}]fps=${fps}[${out}]`);
    return out;
  };

  let cur = legOf.get(usable[0].id);
  const firstX = layout.segments[0].x;
  if (firstX) {
    const t = usable[0].transition;
    const id = t?.id;
    if (id && id !== "none" && transById(id)) {
      const dur = firstX.dur;
      chains.push(`color=c=black:s=${W}x${H}:d=${f3(dur)}:r=${fps},fps=${fps},format=yuv420p[blk0]`);
      if (XFADE_OF[id]) {
        chains.push(`[blk0][${cur}]xfade=transition=${XFADE_OF[id]}:duration=${f3(dur)}:offset=0[vjlead]`);
        stats.joins.xfade++;
        cur = "vjlead";
      } else if (MASK_KIND[id]) {
        cur = customJoin("blk0", cur, MASK_KIND[id], dur, 0, keptDuration(usable[0]));
        stats.joins.custom++;
      } else if (GEOM_KIND[id]) {
        cur = geomJoin("blk0", cur, GEOM_KIND[id], dur, 0, keptDuration(usable[0]));
        stats.joins.geo++;
      }
    }
  }
  usable.forEach((clip, i) => {
    if (i === 0) return;
    const seg = layout.segments[i];
    const leg = legOf.get(clip.id);
    const t = clip.transition;
    const id = t?.id;
    const dur = seg.x?.dur ?? 0;
    if (!id || id === "none" || dur <= 0 || !transById(id)) {
      if (id && id !== "none" && !transById(id)) warnings.push(`Unknown transition “${id}” — joined with a cut.`);
      const out = `vc${i}`;
      chains.push(`[${cur}][${leg}]concat=n=2:v=1:a=0[vcp${i}]`);
      chains.push(`[vcp${i}]fps=${fps}[${out}]`);
      stats.joins.concat++;
      cur = out;
      return;
    }
    const off = layout.segments[i - 1].end - dur;
    if (XFADE_OF[id]) {
      const out = `vx${i}`;
      chains.push(`[${cur}][${leg}]xfade=transition=${XFADE_OF[id]}:duration=${f3(dur)}:offset=${f6(Math.max(0, off))}[${out}]`);
      stats.joins.xfade++;
      cur = out;
    } else if (MASK_KIND[id]) {
      cur = customJoin(cur, leg, MASK_KIND[id], dur, Math.max(0, off), keptDuration(clip));
      stats.joins.custom++;
    } else if (GEOM_KIND[id]) {
      cur = geomJoin(cur, leg, GEOM_KIND[id], dur, Math.max(0, off), keptDuration(clip));
      stats.joins.geo++;
    } else {
      warnings.push(`Transition “${id}” has no export mapping — joined with a cut.`);
      const out = `vc${i}`;
      chains.push(`[${cur}][${leg}]concat=n=2:v=1:a=0[vcp${i}]`);
      chains.push(`[vcp${i}]fps=${fps}[${out}]`);
      stats.joins.concat++;
      cur = out;
    }
  });

  /* ---- black tail when audio outruns the picture (the preview shows black) ---- */
  const tail = total - layout.total;
  if (tail > 0.05) {
    const k = `btail`;
    chains.push(`color=c=black:s=${W}x${H}:d=${f3(tail)}:r=${fps},fps=${fps},format=yuv420p[${k}]`);
    chains.push(`[${cur}][${k}]concat=n=2:v=1:a=0[vctb]`);
    chains.push(`[vctb]fps=${fps}[vcat]`);
    cur = "vcat";
  }

  /* ---- caption overlays (follow windows match the preview's majority rule) ---- */
  let ovN = 0;
  usable.forEach((clip, i) => {
    const cap = clip.caption;
    if (!cap || !String(cap.content ?? "").trim()) return;
    const seg = layout.segments[i];
    const kept = keptDuration(clip);
    const offset = Math.min(Math.max(cap.offset || 0, 0), kept);
    const cdur = Math.max(0.1, Math.min(cap.dur || kept, kept - offset));
    let visStart = seg.bodyStart;
    if (seg.x && seg.x.fromId != null) visStart = seg.x.start + seg.x.dur / 2;
    let visEnd = seg.end;
    const next = layout.segments[i + 1];
    if (next?.x) visEnd = Math.min(visEnd, next.x.start + next.x.dur / 2);
    const cs = Math.max(seg.bodyStart + offset, visStart);
    const ce = Math.min(seg.bodyStart + offset + cdur, visEnd);
    if (ce - cs < 0.1) return;
    const job = resolved.captionSeq.get(clip.id) ?? null;
    if (!job) {
      warnings.push(`Caption on “${clip.name}” has no rendered frames — skipped.`);
      return;
    }
    const k = addInput(job.pattern, ["-framerate", String(fps)]);
    const o = ovN++;
    chains.push(`[${k}:v]format=yuva420p,setpts=PTS-STARTPTS+${f6(cs)}/TB[ov${o}]`);
    chains.push(`[${cur}][ov${o}]overlay=0:0:enable='between(t,${f6(cs)},${f6(ce)})':eof_action=pass[vo${o}]`);
    cur = `vo${o}`;
    stats.captions++;
  });
  chains.push(`[${cur}]null[vout]`);

  /* ---- audio mix (same static levels as the preview) ---- */
  const aLegs = [];
  usable.forEach((clip) => {
    if (clip.kind !== "video") return;
    if (!resolved.hasAudio.get(clip.id)) return;
    const seg = layout.segments.find((s) => s.clipId === clip.id);
    const k = inputOf.get(clip.id) ?? null;
    if (k == null || !seg) return;
    const v = clip.volume * (clip.muted ? 0 : 1) * emphasisFactor(emphasis, "video");
    const ms = Math.max(0, Math.round(seg.bodyStart * 1000));
    const tag = `a${aLegs.length}`;
    chains.push(`[${k}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${f6(v)},adelay=${ms}|${ms}[${tag}]`);
    aLegs.push(tag);
    stats.audioLegs++;
  });
  for (const ac of audioClips) {
    const kept = Math.max(0, ac.out - ac.in);
    if (kept <= 0.01) {
      warnings.push(`“${ac.name}” has no kept range — left out of the mix.`);
      continue;
    }
    const path = resolved.audioInput.get(ac.id) ?? null;
    if (!path) {
      warnings.push(`“${ac.name}” is missing its audio file — left out of the mix.`);
      continue;
    }
    const k = addInput(path, ["-ss", f6(ac.in), "-t", f3(kept)]);
    const v = ac.volume * emphasisFactor(emphasis, ac.kind);
    const fdi = Math.min(FADE_SECONDS[ac.fadeIn] ?? 0, kept);
    const fdo = Math.min(FADE_SECONDS[ac.fadeOut] ?? 0, kept);
    let chain = `[${k}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${f6(v)}`;
    if (fdi > 0) chain += `,afade=t=in:st=0:d=${f3(fdi)}`;
    if (fdo > 0) chain += `,afade=t=out:st=${f3(Math.max(0, kept - fdo))}:d=${f3(fdo)}`;
    const ms = Math.max(0, Math.round(ac.offset * 1000));
    const tag = `a${aLegs.length}`;
    chain += `,adelay=${ms}|${ms}[${tag}]`;
    chains.push(chain);
    aLegs.push(tag);
    stats.audioLegs++;
  }
  if (aLegs.length === 1) {
    chains.push(`[${aLegs[0]}]alimiter=limit=0.95,apad,aformat=sample_fmts=fltp:channel_layouts=stereo[aout]`);
  } else if (aLegs.length > 1) {
    chains.push(
      `[${aLegs.join("][")}]amix=inputs=${aLegs.length}:duration=longest:dropout_transition=0:normalize=0,` +
      `alimiter=limit=0.95,apad,aformat=sample_fmts=fltp:channel_layouts=stereo[aout]`
    );
  }

  /* ---- argv ---- */
  const argvHead = ["-hide_banner", "-nostats"];
  for (const inp of inputs) argvHead.push(...inp.args, "-i", inp.path);
  const maps = ["-map", "[vout]"];
  if (aLegs.length) maps.push("-map", "[aout]");
  const outArgs = [
    "-c:v", "libx264", "-preset", "medium", "-b:v", preset.vbr, "-pix_fmt", "yuv420p",
    ...(aLegs.length ? ["-c:a", "aac", "-b:a", preset.abr, "-ar", "44100", "-ac", "2"] : []),
    "-movflags", "+faststart",
    "-t", String(Math.round(total * 1000) / 1000),
    "-progress", "pipe:2",
    "-y",
  ];
  return {
    inputs,
    script: chains.join(";"),
    maps,
    argvHead,
    outArgs,
    total,
    totalUs: Math.round(total * 1_000_000),
    warnings,
    stats,
  };
}
