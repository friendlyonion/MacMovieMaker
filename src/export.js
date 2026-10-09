// MacMovieMaker — Milestone 6 export plan builder.
// Pure, DOM-free: turns project state + a save preset into an ffmpeg
// invocation (inputs, -filter_complex script, output args). Node-safe.
//
// Preview parity is structural, not aspirational: effects reuse
// buildExportFilter, pan/zoom reuses the preset from/to views, transitions
// reuse the transition ids, and text arrives as prerendered canvas frames
// painted by the preview's own drawTextBox.

import { buildExportFilter } from "./effects.js";
import { transById, pzById } from "./gallery.js";
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

/* ------------------------------------------------------------- share v1 */

export const SHARE_SERVICES = [
  { id: "youtube", name: "YouTube", url: "https://www.youtube.com/upload" },
  { id: "facebook", name: "Facebook", url: "https://www.facebook.com/" },
  { id: "vimeo", name: "Vimeo", url: "https://vimeo.com/upload" },
  { id: "flickr", name: "Flickr", url: "https://www.flickr.com/photos/upload/" },
  { id: "onedrive", name: "OneDrive", url: "https://onedrive.live.com/" },
];

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
  "iris-circle": "circlecrop",
  "box-reveal": "rectcrop",
  blinds: "wiperight", // preview blinds tile the full frame: identical to wipe-right
  "push-left": "slideleft",
  "push-right": "slideright",
  "push-up": "slideup",
  flip: "squeezeh",
  spin: "circleopen", // approximation (documented)
  roll: "smoothup", // approximation (documented)
};

export const MASK_KIND = {
  "wipe-diagonal": "wdiag",
  "iris-diamond": "diamond",
  checker: "checker",
  "page-turn": "pageturn",
};

/** Animated luma-mask expressions mirroring the preview painters. P = N/NF. */
export function maskExpr(kind, W, H, NF) {
  const P = `(N/${NF})`;
  if (kind === "wdiag") {
    // Preview: top boundary x=W*p*2-H/2, sloping down H/2 over the frame.
    return `if(lt(X,${W}*${P}*2-${H}*0.5-Y*0.5),255,0)`;
  }
  if (kind === "diamond") {
    return `if(lt(abs(X-${W}/2)/(${W}/2)+abs(Y-${H}/2)/(${H}/2),${P}),255,0)`;
  }
  if (kind === "checker") {
    const cw = (W / 12).toFixed(4);
    const ch = (H / 7).toFixed(4);
    return `if(lt(mod(floor(X/${cw})*7+floor(Y/${ch})*13,16)/16,${P}),255,0)`;
  }
  if (kind === "pageturn") {
    return `if(lt(X,${W}*${P}*1.35-Y/${H}*${W}*0.3),255,0)`;
  }
  throw new Error(`unknown mask kind ${kind}`);
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
  const stats = { clips: 0, joins: { xfade: 0, custom: 0, concat: 0 }, captions: 0, cards: 0, audioLegs: 0 };
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

  /* ---- per-clip legs ---- */
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
        chains.push(`[${k}:v]format=yuv420p,setsar=1,fps=${fps}${fxTail}[${tag}]`);
      } else {
        warnings.push(`“${clip.name}”: title frames unavailable — rendering its card color.`);
        const bg = ((clip.text?.bg || "#1f2937").replace("#", "0x")).slice(0, 8);
        chains.push(`color=c=${bg}:s=${W}x${H}:d=${f3(kept)}:r=${fps},format=yuv420p,fps=${fps}[${tag}]`);
      }
    } else if (!res) {
      warnings.push(`“${clip.name}” is missing its media file — rendering a placeholder.`);
      chains.push(`color=c=0x141416:s=${W}x${H}:d=${f3(kept)}:r=${fps},format=yuv420p,fps=${fps}[${tag}]`);
    } else if (clip.kind === "image") {
      const k = addInput(res.path, ["-loop", "1", "-framerate", String(fps), "-t", f3(kept)]);
      inputOf.set(clip.id, k);
      chains.push(`[${k}:v]setpts=PTS-STARTPTS,${rotHead}${pzChain(clip.panZoom, W, H, fps, kept)},setsar=1,fps=${fps},format=yuv420p${fxTail}[${tag}]`);
    } else {
      const k = addInput(res.path, ["-ss", f6(clip.in), "-t", f3(kept)]);
      inputOf.set(clip.id, k);
      chains.push(
        `[${k}:v]setpts=PTS-STARTPTS,${rotHead}scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p${fxTail}[${tag}]`
      );
    }
    legOf.set(clip.id, tag);
  });
  stats.clips = usable.length;

  /* ---- joins ---- */
  let joinN = 0;
  const customJoin = (aLabel, bLabel, kind, dur, off, keptB) => {
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
      `color=c=white:s=${W}x${H}:d=${f3(dur + 0.25)}:r=${fps},format=gray,fps=${fps},` +
      `geq=lum='${maskExpr(kind, W, H, NF)}'[mask${j}]`
    );
    // NB: maskedmerge only masks luma (chroma averages) — alpha
    // compositing switches all planes.
    chains.push(`[bw${j}]format=yuva420p[bwf${j}]`);
    chains.push(`[bwf${j}][mask${j}]alphamerge[fg${j}]`);
    chains.push(`[aw${j}][fg${j}]overlay=0:0:eof_action=pass[mg${j}]`);
    const order = [];
    if (needPre) order.push(`pre${j}`);
    order.push(`mg${j}`);
    if (needPost) order.push(`post${j}`);
    if (order.length === 1) return `mg${j}`;
    const out = `vj${j}`;
    chains.push(`[${order.join("][")}]concat=n=${order.length}:v=1:a=0[${out}]`);
    return out;
  };

  let cur = legOf.get(usable[0].id);
  const firstX = layout.segments[0].x;
  if (firstX) {
    const t = usable[0].transition;
    const id = t?.id;
    if (id && id !== "none" && transById(id)) {
      const dur = firstX.dur;
      chains.push(`color=c=black:s=${W}x${H}:d=${f3(dur)}:r=${fps},format=yuv420p,fps=${fps}[blk0]`);
      if (XFADE_OF[id]) {
        chains.push(`[blk0][${cur}]xfade=transition=${XFADE_OF[id]}:duration=${f3(dur)}:offset=0[vjlead]`);
        stats.joins.xfade++;
        cur = "vjlead";
      } else if (MASK_KIND[id]) {
        cur = customJoin("blk0", cur, MASK_KIND[id], dur, 0, keptDuration(usable[0]));
        stats.joins.custom++;
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
      chains.push(`[${cur}][${leg}]concat=n=2:v=1:a=0[${out}]`);
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
    } else {
      warnings.push(`Transition “${id}” has no export mapping — joined with a cut.`);
      const out = `vc${i}`;
      chains.push(`[${cur}][${leg}]concat=n=2:v=1:a=0[${out}]`);
      stats.joins.concat++;
      cur = out;
    }
  });

  /* ---- black tail when audio outruns the picture (the preview shows black) ---- */
  const tail = total - layout.total;
  if (tail > 0.05) {
    const k = `btail`;
    chains.push(`color=c=black:s=${W}x${H}:d=${f3(tail)}:r=${fps},format=yuv420p,fps=${fps}[${k}]`);
    chains.push(`[${cur}][${k}]concat=n=2:v=1:a=0[vcat]`);
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
