// MacMovieMaker — Milestone 4 visual effects.
// SINGLE SOURCE OF TRUTH for looks: every effect declares its canvas preview
// implementation AND its FFmpeg export filter template side by side, applied
// in the same documented order (effect -> brightness -> fades -> letterbox).
// buildExportFilter() is already used by tests and will drive the M5 exporter,
// so preview and export cannot diverge.
// Node-safe: canvas is only touched inside functions that receive one.

import { paintSceneThumb } from "./gallery.js";
import { DEFAULT_FX } from "./clipops.js"; // re-exported for convenience

export { DEFAULT_FX };
export const FADE_DUR = 0.75; // seconds per fade, clamped to half the kept range

export const fxNeedsPixels = (fx) =>
  !!fx && (fx.effect !== "none" && fx.effect !== undefined || !!fx.brightness);

/* ------------------------------------------------------- point operations
   Each mutates one RGBA pixel in place (d = Uint8ClampedArray, so no manual
   clamping needed). t = absolute local seconds, for deterministic shimmer. */

export const POINT_OPS = {
  bw(d, i) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = g;
  },
  sepia(d, i) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    d[i] = r * 0.393 + g * 0.769 + b * 0.189;
    d[i + 1] = r * 0.349 + g * 0.686 + b * 0.168;
    d[i + 2] = r * 0.272 + g * 0.534 + b * 0.131;
  },
  cinematic(d, i) {
    let r = d[i], g = d[i + 1], b = d[i + 2];
    const m = (r + g + b) / 3;
    r = (r - m) * 1.15 + m; // saturation
    g = (g - m) * 1.15 + m;
    b = (b - m) * 1.15 + m;
    r = (r - 128) * 1.05 + 128; // contrast
    g = (g - 128) * 1.05 + 128;
    b = (b - 128) * 1.05 + 128;
    d[i] = r * 1.06 + 6; // warm highlights, cool shadows
    d[i + 1] = g + 2;
    d[i + 2] = b * 0.92 - 4;
  },
  posterize(d, i) {
    d[i] = (((d[i] / 64) | 0) * 64) + 32;
    d[i + 1] = (((d[i + 1] / 64) | 0) * 64) + 32;
    d[i + 2] = (((d[i + 2] / 64) | 0) * 64) + 32;
  },
  oldfilm(d, i, t = 0) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const f = 1 + 0.035 * Math.sin(t * 31) + 0.02 * Math.sin(t * 57); // projector flicker
    d[i] = (r * 0.38 + g * 0.7 + b * 0.2) * f;
    d[i + 1] = (r * 0.3 + g * 0.65 + b * 0.15) * f;
    d[i + 2] = (r * 0.25 + g * 0.55 + b * 0.12) * f;
  },
  invert(d, i) {
    d[i] = 255 - d[i];
    d[i + 1] = 255 - d[i + 1];
    d[i + 2] = 255 - d[i + 2];
  },
  threshold(d, i) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = g > 128 ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  },
};

export const brightnessOp = (v) => (d, i) => {
  const add = v * 255;
  d[i] += add;
  d[i + 1] += add;
  d[i + 2] += add;
};

/** Run the pixel half of the chain on a context's current bitmap. */
export function applyPixelChain(ctx, w, h, effectId, brightness, t = 0) {
  const op = POINT_OPS[effectId];
  const bop = brightness ? brightnessOp(brightness) : null;
  if (!op && !bop) return;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (op) op(d, i, t);
    if (bop) bop(d, i);
  }
  ctx.putImageData(img, 0, 0);
}

/** Cheap separable box blur (meant for small canvases). radius in px. */
export function boxBlur(ctx, w, h, radius = 2, passes = 2) {
  const src = ctx.getImageData(0, 0, w, h);
  const tmp = new Uint8ClampedArray(src.data);
  const data = src.data;
  const r = Math.max(1, Math.round(radius));
  for (let p = 0; p < passes; p++) {
    for (let c = 0; c < 3; c++) {
      // horizontal
      for (let y = 0; y < h; y++) {
        let acc = 0;
        for (let x = -r; x <= r; x++) acc += tmp[(y * w + Math.min(w - 1, Math.max(0, x))) * 4 + c];
        for (let x = 0; x < w; x++) {
          data[(y * w + x) * 4 + c] = acc / (2 * r + 1);
          const xOut = Math.min(w - 1, Math.max(0, x - r));
          const xIn = Math.min(w - 1, Math.max(0, x + r + 1));
          acc += tmp[(y * w + xIn) * 4 + c] - tmp[(y * w + xOut) * 4 + c];
        }
      }
      tmp.set(data);
      // vertical
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let y = -r; y <= r; y++) acc += tmp[(Math.min(h - 1, Math.max(0, y)) * w + x) * 4 + c];
        for (let y = 0; y < h; y++) {
          data[(y * w + x) * 4 + c] = acc / (2 * r + 1);
          const yOut = Math.min(h - 1, Math.max(0, y - r));
          const yIn = Math.min(h - 1, Math.max(0, y + r + 1));
          acc += tmp[(yIn * w + x) * 4 + c] - tmp[(yOut * w + x) * 4 + c];
        }
      }
      tmp.set(data);
    }
  }
  ctx.putImageData(src, 0, 0);
}

/* ------------------------------------------------------------- overlays */
const vignetteCache = new Map(); // "WxH" -> canvas

function vignetteCanvas(w, h) {
  const key = `${w}x${h}`;
  let cv = vignetteCache.get(key);
  if (!cv) {
    cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const c = cv.getContext("2d");
    const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.36, w / 2, h / 2, Math.hypot(w, h) * 0.52);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.42)");
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    if (vignetteCache.size > 8) vignetteCache.delete(vignetteCache.keys().next().value);
    vignetteCache.set(key, cv);
  }
  return cv;
}

export function paintVignette(ctx, w, h) {
  ctx.drawImage(vignetteCanvas(w, h), 0, 0, w, h);
}

let noiseTile = null;
function getNoiseTile() {
  if (!noiseTile) {
    noiseTile = document.createElement("canvas");
    noiseTile.width = 160;
    noiseTile.height = 90;
    const c = noiseTile.getContext("2d");
    const img = c.createImageData(160, 90);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
  }
  return noiseTile;
}

/** Animated film grain: dancing noise tile, deterministic in t. */
export function paintGrain(ctx, w, h, t = 0) {
  const tile = getNoiseTile();
  const step = Math.floor(t * 12);
  const ox = ((step * 37) % 97) / 97 - 0.5;
  const oy = ((step * 61) % 89) / 89 - 0.5;
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.globalCompositeOperation = "overlay";
  ctx.drawImage(tile, ox * w * 0.1, oy * h * 0.1, w * 1.1, h * 1.1);
  ctx.restore();
}

/** Occasional vertical scratch for old film, deterministic in t. */
export function paintScratch(ctx, w, h, t = 0) {
  const slot = Math.floor(t * 3);
  if (slot % 3 === 2) return; // scratch visible ~2/3 of the time
  const x = ((slot * 53) % 100) / 100;
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "#fff";
  ctx.fillRect(x * w, 0, Math.max(1, w * 0.0015), h);
  ctx.restore();
}

export function paintLetterbox(ctx, w, h) {
  const bar = Math.round(h * 0.12);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, bar);
  ctx.fillRect(0, h - bar, w, bar);
}

/* ---------------------------------------------------------- effect table */
const num = (v) => String(Number(Number(v).toFixed(3)));

export const EFFECTS = [
  { id: "none", name: "None" },
  { id: "bw", name: "Black and white", export: () => "hue=s=0" },
  { id: "sepia", name: "Sepia tone", export: () => "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131" },
  {
    id: "cinematic", name: "Cinematic", vignette: true, letterbox: true,
    export: () => "eq=saturation=1.15:contrast=1.05,colorbalance=rs=.06:gs=-.02:bs=-.08,vignette=PI/4.5",
  },
  { id: "blur", name: "Soft blur", custom: "blur", export: () => "gblur=sigma=6" },
  {
    id: "pixelate", name: "Pixelate", custom: "pixelate",
    export: ({ W, H }) => `scale=${Math.max(8, W >> 4)}:${Math.max(8, H >> 4)}:flags=neighbor,scale=${W}:${H}:flags=neighbor`,
  },
  {
    id: "posterize", name: "Posterize",
    export: () => "geq=r='floor(r(X,Y)/64)*64+32':g='floor(g(X,Y)/64)*64+32':b='floor(b(X,Y)/64)*64+32'",
  },
  {
    id: "oldfilm", name: "Old film", vignette: true, grain: true,
    export: () => "colorchannelmixer=.38:.7:.2:0:.3:.65:.15:0:.25:.55:.12,noise=alls=9:allf=t,vignette=PI/5",
  },
  { id: "invert", name: "Invert", export: () => "negate" },
  {
    id: "threshold", name: "Threshold",
    export: () => "format=gray,geq='if(gt(lum(X,Y),128),255,0)',format=yuv420p",
  },
];

export const fxById = (id) => EFFECTS.find((e) => e.id === id) ?? null;

/**
 * Compose the FFmpeg -vf filter chain for a clip's fx state, in preview order:
 * effect -> brightness -> fades -> letterbox. Returns '' when inert.
 * {W,H} = export frame size; kept = kept-range seconds (for fade timing).
 */
export function buildExportFilter(fx, { W, H, kept }) {
  if (!fx) return "";
  const parts = [];
  const def = fxById(fx.effect);
  if (def?.export) parts.push(def.export({ W, H }));
  if (fx.brightness) parts.push(`eq=brightness=${num(fx.brightness)}`);
  const k = kept && kept > 0 ? kept : FADE_DUR * 2;
  const fd = num(Math.min(FADE_DUR, k / 2));
  if (fx.fadeIn && fx.fadeIn !== "none") parts.push(`fade=t=in:st=0:d=${fd}:color=${fx.fadeIn}`);
  if (fx.fadeOut && fx.fadeOut !== "none") {
    parts.push(`fade=t=out:st=${num(Math.max(0, k - Math.min(FADE_DUR, k / 2)))}:d=${fd}:color=${fx.fadeOut}`);
  }
  if (def?.letterbox) {
    const bar = Math.round(H * 0.12);
    parts.push(`drawbox=x=0:y=0:w=iw:h=${bar}:c=black:t=fill`);
    parts.push(`drawbox=x=0:y=${H - bar}:w=iw:h=${bar}:c=black:t=fill`);
  }
  return parts.join(",");
}

/** Fade overlay alphas (0..1). local = seconds into the KEPT range. */
export function fadeAlphas(fx, local, kept) {
  const out = {
    inA: 0, inColor: fx?.fadeIn && fx.fadeIn !== "none" ? fx.fadeIn : "black",
    outA: 0, outColor: fx?.fadeOut && fx.fadeOut !== "none" ? fx.fadeOut : "black",
  };
  if (!fx || kept <= 0) return out;
  const fd = Math.min(FADE_DUR, kept / 2);
  const rel = Math.min(Math.max(local, 0), kept);
  if (fx.fadeIn && fx.fadeIn !== "none" && rel < fd) out.inA = 1 - rel / fd;
  if (fx.fadeOut && fx.fadeOut !== "none" && rel > kept - fd) {
    out.outA = (rel - (kept - fd)) / fd;
  }
  return out;
}

/* ------------------------------------------------------- thumbnail art */
export function paintFxThumb(canvas, effectId) {
  paintSceneThumb(canvas, 0);
  if (!effectId || effectId === "none") return;
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext("2d");
  const def = fxById(effectId);
  if (def?.custom === "blur") {
    const small = document.createElement("canvas");
    small.width = Math.max(24, w >> 2);
    small.height = Math.max(14, h >> 2);
    const sc = small.getContext("2d");
    sc.drawImage(canvas, 0, 0, small.width, small.height);
    boxBlur(sc, small.width, small.height, 2, 2);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(small, 0, 0, w, h);
    return;
  }
  if (def?.custom === "pixelate") {
    const tw = Math.max(8, Math.round(w / 16)), th = Math.max(5, Math.round(h / 16));
    const small = document.createElement("canvas");
    small.width = tw;
    small.height = th;
    small.getContext("2d").drawImage(canvas, 0, 0, tw, th);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    return;
  }
  applyPixelChain(ctx, w, h, effectId, 0, 1.3);
  if (def?.grain) {
    paintGrain(ctx, w, h, 1.3);
    paintScratch(ctx, w, h, 1.3);
  }
  if (def?.vignette) paintVignette(ctx, w, h);
  if (def?.letterbox) paintLetterbox(ctx, w, h);
}
