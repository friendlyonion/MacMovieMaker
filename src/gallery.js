// MacMovieMaker — Milestone 3 gallery data and renderers.
// Transition list/shape/art are all original work: names are descriptive
// originals and every thumbnail is painted at runtime by the code below.
// Node-safe: canvas is only touched inside functions that receive one.

/* ------------------------------------------------------------ transitions
   render(ctx, W, H, paintA, paintB, p): paintA/paintB draw their full-frame
   layer (already rotated/framed by the caller). p goes 0 (all A) -> 1 (all B).
   paintA may be null (transition from black). */

function withB(ctx, p, paintB, clipFn) {
  ctx.save();
  ctx.beginPath();
  clipFn();
  ctx.clip();
  paintB();
  ctx.restore();
}

const R = {
  "fade-black"(ctx, W, H, paintA, paintB, p) {
    if (p < 0.5) {
      paintA();
      ctx.fillStyle = `rgba(0,0,0,${(p * 2).toFixed(3)})`;
    } else {
      paintB();
      ctx.fillStyle = `rgba(0,0,0,${((1 - p) * 2).toFixed(3)})`;
    }
    ctx.fillRect(0, 0, W, H);
  },
  "dip-white"(ctx, W, H, paintA, paintB, p) {
    if (p < 0.5) {
      paintA();
      ctx.fillStyle = `rgba(255,255,255,${(p * 2).toFixed(3)})`;
    } else {
      paintB();
      ctx.fillStyle = `rgba(255,255,255,${((1 - p) * 2).toFixed(3)})`;
    }
    ctx.fillRect(0, 0, W, H);
  },
  dissolve(ctx, W, H, paintA, paintB, p) {
    paintA();
    ctx.save();
    ctx.globalAlpha = p;
    paintB();
    ctx.restore();
  },
  "wipe-right"(ctx, W, H, paintA, paintB, p) {
    paintA();
    withB(ctx, p, paintB, () => ctx.rect(0, 0, W * p, H));
  },
  "wipe-left"(ctx, W, H, paintA, paintB, p) {
    paintA();
    withB(ctx, p, paintB, () => ctx.rect(W * (1 - p), 0, W * p, H));
  },
  "wipe-up"(ctx, W, H, paintA, paintB, p) {
    paintA();
    withB(ctx, p, paintB, () => ctx.rect(0, H * (1 - p), W, H * p));
  },
  "wipe-down"(ctx, W, H, paintA, paintB, p) {
    paintA();
    withB(ctx, p, paintB, () => ctx.rect(0, 0, W, H * p));
  },
  "wipe-diagonal"(ctx, W, H, paintA, paintB, p) {
    paintA();
    const x = W * p * 2 - H * 0.5;
    withB(ctx, p, paintB, () => {
      ctx.moveTo(0, 0);
      ctx.lineTo(x, 0);
      ctx.lineTo(x - H * 0.5, H);
      ctx.lineTo(0, H);
      ctx.closePath();
    });
  },
  "iris-circle"(ctx, W, H, paintA, paintB, p) {
    paintA();
    withB(ctx, p, paintB, () => ctx.arc(W / 2, H / 2, (p * Math.hypot(W, H)) / 2, 0, Math.PI * 2));
  },
  "iris-diamond"(ctx, W, H, paintA, paintB, p) {
    paintA();
    const rx = (W / 2) * p, ry = (H / 2) * p;
    withB(ctx, p, paintB, () => {
      ctx.moveTo(W / 2, H / 2 - ry);
      ctx.lineTo(W / 2 + rx, H / 2);
      ctx.lineTo(W / 2, H / 2 + ry);
      ctx.lineTo(W / 2 - rx, H / 2);
      ctx.closePath();
    });
  },
  "box-reveal"(ctx, W, H, paintA, paintB, p) {
    paintA();
    withB(ctx, p, paintB, () => ctx.rect((W * (1 - p)) / 2, (H * (1 - p)) / 2, W * p, H * p));
  },
  blinds(ctx, W, H, paintA, paintB, p) {
    paintA();
    const slats = 8;
    withB(ctx, p, paintB, () => {
      for (let i = 0; i < slats; i++) ctx.rect(0, (i * H) / slats, W * p, H / slats);
    });
  },
  checker(ctx, W, H, paintA, paintB, p) {
    paintA();
    const nx = 12, ny = 7, cw = W / nx, ch = H / ny;
    withB(ctx, p, paintB, () => {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          if (((i * 7 + j * 13) % 16) / 16 < p) ctx.rect(i * cw, j * ch, cw + 0.5, ch + 0.5);
        }
      }
    });
  },
  "push-left"(ctx, W, H, paintA, paintB, p) {
    ctx.save(); ctx.translate(-W * p, 0); paintA(); ctx.restore();
    ctx.save(); ctx.translate(W * (1 - p), 0); paintB(); ctx.restore();
  },
  "push-right"(ctx, W, H, paintA, paintB, p) {
    ctx.save(); ctx.translate(W * p, 0); paintA(); ctx.restore();
    ctx.save(); ctx.translate(-W * (1 - p), 0); paintB(); ctx.restore();
  },
  "push-up"(ctx, W, H, paintA, paintB, p) {
    ctx.save(); ctx.translate(0, -H * p); paintA(); ctx.restore();
    ctx.save(); ctx.translate(0, H * (1 - p)); paintB(); ctx.restore();
  },
  /* --- 2D approximations of 3D-style moves (documented in the M3 report) --- */
  flip(ctx, W, H, paintA, paintB, p) {
    // Page-flip feel via horizontal squeeze + center shading.
    const a = p * Math.PI;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const paint = p < 0.5 ? paintA : paintB;
    const sx = Math.abs(Math.cos(a));
    ctx.save();
    ctx.translate(W / 2, 0);
    ctx.scale(Math.max(sx, 0.001), 1);
    ctx.translate(-W / 2, 0);
    paint();
    ctx.restore();
    ctx.fillStyle = `rgba(0,0,0,${(Math.abs(Math.sin(a)) * 0.35).toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);
  },
  spin(ctx, W, H, paintA, paintB, p) {
    // Spin feel via rotate + shrink/grow.
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const first = p < 0.5;
    const t = first ? p * 2 : (p - 0.5) * 2;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate((first ? t : t - 1) * Math.PI * 0.75);
    const s = first ? 1 - t * 0.6 : 0.4 + t * 0.6;
    ctx.scale(s, s);
    ctx.globalAlpha = first ? 1 - t * 0.7 : 0.3 + t * 0.7;
    ctx.translate(-W / 2, -H / 2);
    (first ? paintA : paintB)();
    ctx.restore();
  },
  roll(ctx, W, H, paintA, paintB, p) {
    // Vertical roll feel: push with a sinusoidal bow.
    const bow = 1 - Math.sin(p * Math.PI) * 0.18;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(0, H / 2);
    ctx.scale(1, bow);
    ctx.translate(0, -H / 2 - H * p);
    paintA();
    ctx.restore();
    ctx.save();
    ctx.translate(0, H / 2);
    ctx.scale(1, bow);
    ctx.translate(0, -H / 2 + H * (1 - p));
    paintB();
    ctx.restore();
  },
  "page-turn"(ctx, W, H, paintA, paintB, p) {
    // Page-curl feel: diagonal reveal with a soft shade band at the edge.
    paintA();
    const edge = W * p * 1.35;
    withB(ctx, p, paintB, () => {
      ctx.moveTo(0, 0);
      ctx.lineTo(edge, 0);
      ctx.lineTo(edge - W * 0.3, H);
      ctx.lineTo(0, H);
      ctx.closePath();
    });
    const grad = ctx.createLinearGradient(edge - 46, 0, edge, 0);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.38)");
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(Math.max(edge - 46, 0), 0);
    ctx.lineTo(edge, 0);
    ctx.lineTo(edge - W * 0.3, H);
    ctx.lineTo(Math.max(edge - 46 - W * 0.3, 0), H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  },
};

export const TRANSITIONS = [
  { id: "none", name: "None", family: "none" },
  { id: "fade-black", name: "Fade through black", family: "fade" },
  { id: "dissolve", name: "Cross dissolve", family: "fade" },
  { id: "dip-white", name: "Dip to white", family: "fade" },
  { id: "wipe-right", name: "Wipe right", family: "wipe" },
  { id: "wipe-left", name: "Wipe left", family: "wipe" },
  { id: "wipe-up", name: "Wipe up", family: "wipe" },
  { id: "wipe-down", name: "Wipe down", family: "wipe" },
  { id: "wipe-diagonal", name: "Diagonal wipe", family: "wipe" },
  { id: "iris-circle", name: "Circle iris", family: "pattern" },
  { id: "iris-diamond", name: "Diamond iris", family: "pattern" },
  { id: "box-reveal", name: "Box reveal", family: "pattern" },
  { id: "blinds", name: "Blinds", family: "pattern" },
  { id: "checker", name: "Checkerboard", family: "pattern" },
  { id: "push-left", name: "Push left", family: "push" },
  { id: "push-right", name: "Push right", family: "push" },
  { id: "push-up", name: "Push up", family: "push" },
  { id: "flip", name: "Flip over", family: "dimensional" },
  { id: "spin", name: "Spin around", family: "dimensional" },
  { id: "roll", name: "Roll over", family: "dimensional" },
  { id: "page-turn", name: "Page turn", family: "dimensional" },
];

export const TRANS_RENDER = R;
export const transById = (id) => TRANSITIONS.find((t) => t.id === id) ?? null;

/* ------------------------------------------------- pan & zoom presets
   from/to: normalized center (cx, cy) + zoom z (1 = whole image). */

const C = 0.5, L = 0.36, RGT = 0.64, T = 0.32, B = 0.68;

export const PZ_GROUPS = ["Automatic", "Pan only", "Zoom in", "Zoom out"];

export const PANZOOM_PRESETS = [
  // Automatic — curated gentle moves.
  { id: "pz-drift", name: "Gentle drift", group: "Automatic", from: { cx: C, cy: C, z: 1 }, to: { cx: 0.56, cy: C, z: 1.22 } },
  { id: "pz-sweep", name: "Wide sweep", group: "Automatic", from: { cx: L, cy: C, z: 1.3 }, to: { cx: RGT, cy: C, z: 1.3 } },
  { id: "pz-approach", name: "Slow approach", group: "Automatic", from: { cx: C, cy: C, z: 1.3 }, to: { cx: C, cy: C, z: 1 } },
  { id: "pz-pullback", name: "Pull back", group: "Automatic", from: { cx: C, cy: 0.46, z: 1.45 }, to: { cx: C, cy: C, z: 1 } },
  // Pan only — constant zoom, straight moves.
  { id: "pz-pan-l", name: "Pan left", group: "Pan only", from: { cx: RGT, cy: C, z: 1.35 }, to: { cx: L, cy: C, z: 1.35 } },
  { id: "pz-pan-r", name: "Pan right", group: "Pan only", from: { cx: L, cy: C, z: 1.35 }, to: { cx: RGT, cy: C, z: 1.35 } },
  { id: "pz-pan-u", name: "Pan up", group: "Pan only", from: { cx: C, cy: B, z: 1.35 }, to: { cx: C, cy: T, z: 1.35 } },
  { id: "pz-pan-d", name: "Pan down", group: "Pan only", from: { cx: C, cy: T, z: 1.35 }, to: { cx: C, cy: B, z: 1.35 } },
  { id: "pz-pan-tl", name: "Pan to top-left", group: "Pan only", from: { cx: RGT, cy: B, z: 1.35 }, to: { cx: L, cy: T, z: 1.35 } },
  { id: "pz-pan-tr", name: "Pan to top-right", group: "Pan only", from: { cx: L, cy: B, z: 1.35 }, to: { cx: RGT, cy: T, z: 1.35 } },
  { id: "pz-pan-bl", name: "Pan to bottom-left", group: "Pan only", from: { cx: RGT, cy: T, z: 1.35 }, to: { cx: L, cy: B, z: 1.35 } },
  { id: "pz-pan-br", name: "Pan to bottom-right", group: "Pan only", from: { cx: L, cy: T, z: 1.35 }, to: { cx: RGT, cy: B, z: 1.35 } },
  // Zoom in.
  { id: "pz-zin-c", name: "Zoom in", group: "Zoom in", from: { cx: C, cy: C, z: 1 }, to: { cx: C, cy: C, z: 1.45 } },
  { id: "pz-zin-tl", name: "Zoom in to top-left", group: "Zoom in", from: { cx: C, cy: C, z: 1 }, to: { cx: L, cy: T, z: 1.45 } },
  { id: "pz-zin-tr", name: "Zoom in to top-right", group: "Zoom in", from: { cx: C, cy: C, z: 1 }, to: { cx: RGT, cy: T, z: 1.45 } },
  { id: "pz-zin-bl", name: "Zoom in to bottom-left", group: "Zoom in", from: { cx: C, cy: C, z: 1 }, to: { cx: L, cy: B, z: 1.45 } },
  { id: "pz-zin-br", name: "Zoom in to bottom-right", group: "Zoom in", from: { cx: C, cy: C, z: 1 }, to: { cx: RGT, cy: B, z: 1.45 } },
  { id: "pz-zin-t", name: "Zoom in to top", group: "Zoom in", from: { cx: C, cy: C, z: 1 }, to: { cx: C, cy: T, z: 1.45 } },
  { id: "pz-zin-b", name: "Zoom in to bottom", group: "Zoom in", from: { cx: C, cy: C, z: 1 }, to: { cx: C, cy: B, z: 1.45 } },
  // Zoom out.
  { id: "pz-zout-c", name: "Zoom out", group: "Zoom out", from: { cx: C, cy: C, z: 1.45 }, to: { cx: C, cy: C, z: 1 } },
  { id: "pz-zout-tl", name: "Zoom out from top-left", group: "Zoom out", from: { cx: L, cy: T, z: 1.45 }, to: { cx: C, cy: C, z: 1 } },
  { id: "pz-zout-tr", name: "Zoom out from top-right", group: "Zoom out", from: { cx: RGT, cy: T, z: 1.45 }, to: { cx: C, cy: C, z: 1 } },
  { id: "pz-zout-bl", name: "Zoom out from bottom-left", group: "Zoom out", from: { cx: L, cy: B, z: 1.45 }, to: { cx: C, cy: C, z: 1 } },
  { id: "pz-zout-br", name: "Zoom out from bottom-right", group: "Zoom out", from: { cx: RGT, cy: B, z: 1.45 }, to: { cx: C, cy: C, z: 1 } },
  { id: "pz-zout-t", name: "Zoom out from top", group: "Zoom out", from: { cx: C, cy: T, z: 1.45 }, to: { cx: C, cy: C, z: 1 } },
  { id: "pz-zout-b", name: "Zoom out from bottom", group: "Zoom out", from: { cx: C, cy: B, z: 1.45 }, to: { cx: C, cy: C, z: 1 } },
];

export const pzById = (id) => PANZOOM_PRESETS.find((p) => p.id === id) ?? null;

const lerp = (a, b, q) => a + (b - a) * q;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Interpolated view {cx, cy, z} at progress q in [0,1]. */
export function lerpPreset(preset, q) {
  const t = clamp01(q);
  return {
    cx: lerp(preset.from.cx, preset.to.cx, t),
    cy: lerp(preset.from.cy, preset.to.cy, t),
    z: lerp(preset.from.z, preset.to.z, t),
  };
}

/**
 * Source rectangle (image pixels) for a Ken Burns frame.
 * Always canvasAspect-proportioned and fully inside the image.
 */
export function panZoomSource(imgW, imgH, canvasAspect, preset, q) {
  if (!imgW || !imgH || !canvasAspect) return { sx: 0, sy: 0, sw: 0, sh: 0 };
  const v = lerpPreset(preset, q);
  const z = Math.max(v.z, 1);
  let sw = imgW / z;
  let sh = sw / canvasAspect;
  if (sh > imgH) { sh = imgH; sw = sh * canvasAspect; }
  sw = Math.min(sw, imgW);
  sh = Math.min(sh, imgH);
  const cx = Math.min(Math.max(v.cx * imgW, sw / 2), imgW - sw / 2);
  const cy = Math.min(Math.max(v.cy * imgH, sh / 2), imgH - sh / 2);
  return { sx: cx - sw / 2, sy: cy - sh / 2, sw, sh };
}

/* ----------------------------------------------- original thumbnail art
   Transition thumbs render the real effect at p=0.5 between two abstract
   gradient scenes painted below. Pan/zoom thumbs diagram the motion path. */

function sceneA(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#8ecae6");
  g.addColorStop(0.62, "#3a86ff");
  g.addColorStop(1, "#1d3557");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.arc(w * 0.72, h * 0.3, h * 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(29,53,87,0.55)";
  ctx.beginPath();
  ctx.moveTo(0, h * 0.78);
  ctx.quadraticCurveTo(w * 0.3, h * 0.62, w * 0.55, h * 0.78);
  ctx.quadraticCurveTo(w * 0.8, h * 0.94, w, h * 0.8);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();
}

function sceneB(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#ffd166");
  g.addColorStop(0.6, "#ef8354");
  g.addColorStop(1, "#9d0208");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fillRect(w * 0.14, h * 0.2, w * 0.2, h * 0.34);
  ctx.fillStyle = "rgba(120,20,20,0.5)";
  ctx.beginPath();
  ctx.moveTo(0, h * 0.7);
  ctx.lineTo(w * 0.4, h * 0.86);
  ctx.lineTo(w * 0.7, h * 0.7);
  ctx.lineTo(w, h * 0.88);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();
}

/** Paint one of the abstract reference scenes (shared with FX thumbnails). */
export function paintSceneThumb(canvas, variant = 0) {
  const ctx = canvas.getContext("2d");
  if (variant === 1) sceneB(ctx, canvas.width, canvas.height);
  else sceneA(ctx, canvas.width, canvas.height);
}

/** Paint a transition thumbnail (effect midpoint) into a canvas. */
export function paintTransThumb(canvas, id) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  if (id === "none") {
    sceneA(ctx, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = Math.max(2, w * 0.03);
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, h * 0.3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(w / 2 - h * 0.2, h / 2 + h * 0.2);
    ctx.lineTo(w / 2 + h * 0.2, h / 2 - h * 0.2);
    ctx.stroke();
    return;
  }
  const render = R[id];
  if (!render) { sceneA(ctx, w, h); return; }
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  render(ctx, w, h, () => sceneA(ctx, w, h), () => sceneB(ctx, w, h), 0.5);
}

/** Paint a pan/zoom path diagram into a canvas. */
export function paintPZThumb(canvas, preset) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#5c6b5c");
  g.addColorStop(1, "#2f3a2f");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const rect = (v, zoom) => {
    const rw = (w * 0.86) / zoom, rh = (h * 0.86) / zoom;
    return { x: v.cx * w - rw / 2, y: v.cy * h - rh / 2, w: rw, h: rh };
  };
  const a = rect(preset.from, preset.from.z), b = rect(preset.to, preset.to.z);
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(a.x, a.y, a.w, a.h);
  ctx.setLineDash([]);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  const x0 = preset.from.cx * w, y0 = preset.from.cy * h;
  const x1 = preset.to.cx * w, y1 = preset.to.cy * h;
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
  if (len > 3) {
    ctx.strokeStyle = "#ffd166";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    const s = 5, ux = dx / len, uy = dy / len;
    ctx.fillStyle = "#ffd166";
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - ux * s - uy * s * 0.55, y1 - uy * s + ux * s * 0.55);
    ctx.lineTo(x1 - ux * s + uy * s * 0.55, y1 - uy * s - ux * s * 0.55);
    ctx.closePath();
    ctx.fill();
  } else if (Math.abs(preset.from.z - preset.to.z) > 0.01) {
    // Pure zoom: draw a magnifier tick at the center.
    ctx.strokeStyle = "#ffd166";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x1, y1, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x1 + 4.5, y1 + 4.5);
    ctx.lineTo(x1 + 9, y1 + 9);
    ctx.stroke();
  }
}
