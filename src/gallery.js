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

/* ------------------------------------------- geometric painter machinery
   paintLayer interprets one GEOM layer on canvas; paintGeom runs a whole
   GEOM spec. Export's stage-chain codegen interprets the same spec with
   crop/scale/rotate/overlay, so both engines match by construction. */

function paintLayer(ctx, W, H, layer, paint) {
  const [cx0, cy0, cw0, ch0] = layer.crop ?? [0, 0, W, H];
  const [sx, sy] = layer.scale ?? [1, 1];
  const [px, py] = layer.pos ?? [0, 0];
  ctx.save();
  if (layer.alpha != null && layer.alpha < 1) ctx.globalAlpha = Math.max(layer.alpha, 0);
  ctx.translate(px, py);
  ctx.translate((cw0 * sx) / 2, (ch0 * sy) / 2);
  ctx.rotate(layer.rotate || 0);
  ctx.scale(Math.max(sx, 1e-4), Math.max(sy, 1e-4));
  ctx.translate(-cx0 - cw0 / 2, -cy0 - ch0 / 2);
  ctx.beginPath();
  ctx.rect(cx0, cy0, cw0, ch0);
  ctx.clip();
  paint();
  ctx.restore();
}

function paintGeom(ctx, W, H, paintA, paintB, p, kind) {
  const g = GEOM[kind](p, W, H);
  if (g.base === "black") {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
  } else if (g.base === "a") {
    paintA();
  } else {
    paintB();
  }
  for (const layer of g.layers) {
    paintLayer(ctx, W, H, layer, layer.src === "a" ? paintA : paintB);
  }
}

/* Readback mosaic for the pixelate painter. Falls back to a block-wave
   reveal when pixels are unreadable (node tests) or tainted (CORS video). */
const mosaicDead = new WeakSet();
function mosaicBlocks(ctx, W, H, blocks) {
  if (typeof ctx.getImageData !== "function" || mosaicDead.has(ctx)) return false;
  let img;
  try {
    img = ctx.getImageData(0, 0, Math.max(1, Math.round(W)), Math.max(1, Math.round(H)));
  } catch {
    mosaicDead.add(ctx);
    return false;
  }
  const d = img.data, w = img.width, h = img.height;
  const nx = Math.max(1, Math.round(blocks)), ny = Math.max(1, Math.round((blocks * h) / w));
  const cw = w / nx, ch = h / ny;
  ctx.save();
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x0 = Math.floor(i * cw), x1 = Math.min(w, Math.ceil((i + 1) * cw));
      const y0 = Math.floor(j * ch), y1 = Math.min(h, Math.ceil((j + 1) * ch));
      let r = 0, g = 0, b = 0, m = 0;
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const k = (y * w + x) * 4;
          r += d[k]; g += d[k + 1]; b += d[k + 2]; m++;
        }
      }
      if (!m) continue;
      ctx.fillStyle = `rgb(${(r / m) | 0},${(g / m) | 0},${(b / m) | 0})`;
      ctx.fillRect((i * W) / nx, (j * H) / ny, W / nx + 0.5, H / ny + 0.5);
    }
  }
  ctx.restore();
  return true;
}

function softWipe(ctx, W, H, paintA, paintB, p, dir) {
  // Feathered wipe: hard reveal plus a trailing alpha ramp (export uses
  // xfade smooth*; ramp curves differ slightly — same look family).
  paintA();
  const f = Math.min(W, H) * 0.18, N = 24;
  const horiz = dir === "r" || dir === "l";
  const L = horiz ? W : H;
  // Frontier position; B fills behind it, feather band trails by f.
  const e = (dir === "r" || dir === "d") ? L * p : L * (1 - p);
  const hard = (x, y, w, h) => {
    if (w <= 0 || h <= 0) return;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); paintB(); ctx.restore();
  };
  const slice = (x, y, w, h, a) => {
    if (w <= 0 || h <= 0 || a <= 0.004) return;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.globalAlpha = Math.min(a, 1); paintB(); ctx.restore();
  };
  if (dir === "r") {
    hard(0, 0, e - f, H);
    for (let k = 0; k < N; k++) slice(e - f + (f * k) / N, 0, f / N + 0.5, H, (k + 0.5) / N);
  } else if (dir === "l") {
    hard(e + f, 0, W - e - f, H);
    for (let k = 0; k < N; k++) slice(e + (f * k) / N, 0, f / N + 0.5, H, 1 - (k + 0.5) / N);
  } else if (dir === "d") {
    hard(0, 0, W, e - f);
    for (let k = 0; k < N; k++) slice(0, e - f + (f * k) / N, W, f / N + 0.5, (k + 0.5) / N);
  } else {
    hard(0, e + f, W, H - e - f);
    for (let k = 0; k < N; k++) slice(0, e + (f * k) / N, W, f / N + 0.5, 1 - (k + 0.5) / N);
  }
}

function waveBlocks(ctx, W, H, paintA, paintB, p) {
  // Diagonal block-wave reveal (pixelate fallback path).
  paintA();
  const nx = 12, ny = 7;
  withB(ctx, p, paintB, () => {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if ((i + j) / (nx + ny) < p) ctx.rect((i * W) / nx, (j * H) / ny, W / nx + 0.5, H / ny + 0.5);
      }
    }
  });
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
    // ×2.01 so the frame corners fill exactly at p=1 (the old inscribed
    // diamond popped in the corners on the final frame, in both engines).
    const rx = (W / 2) * p * 2.01, ry = (H / 2) * p * 2.01;
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
    // Staggered bars: each slat wipes left-to-right in turn, top to bottom.
    paintA();
    const slats = 8;
    withB(ctx, p, paintB, () => {
      for (let i = 0; i < slats; i++) {
        const f = Math.min(1, Math.max(0, p * slats - i));
        if (f > 0) ctx.rect(0, (i * H) / slats, W * f, H / slats + 0.5);
      }
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
  /* --- Geometric moves: preview and export share GEOM (below), so both
         engines evaluate identical transforms. --- */
  flip(ctx, W, H, paintA, paintB, p) {
    // Card flip around the vertical axis (flat scaleX collapse, no 3D
    // perspective) with center shading at the thin point.
    paintGeom(ctx, W, H, paintA, paintB, p, "flip");
    const a = 0.35 * Math.abs(Math.sin(Math.PI * p));
    if (a > 0.002) {
      ctx.fillStyle = `rgba(0,0,0,${a.toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
  },
  spin(ctx, W, H, paintA, paintB, p) {
    // Full-turn spin: outgoing shrinks while rotating once, incoming grows
    // from center with a slight counter-rotating settle.
    paintGeom(ctx, W, H, paintA, paintB, p, "spin");
  },
  roll(ctx, W, H, paintA, paintB, p) {
    // Vertical roll: push with a sinusoidal bow (shared with export).
    paintGeom(ctx, W, H, paintA, paintB, p, "roll");
  },
  "spin-orbit"(ctx, W, H, paintA, paintB, p) {
    // Outgoing orbits out along an arc while shrinking; incoming settles
    // in from the opposite arc.
    paintGeom(ctx, W, H, paintA, paintB, p, "spinorbit");
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
  "wipe-diagonal-tr"(ctx, W, H, paintA, paintB, p) {
    // Mirror of wipe-diagonal: sweeps from the top-right to bottom-left.
    paintA();
    const x = W * p * 2 - H * 0.5;
    withB(ctx, p, paintB, () => {
      ctx.moveTo(W, 0);
      ctx.lineTo(W - x, 0);
      ctx.lineTo(W - x + H * 0.5, H);
      ctx.lineTo(W, H);
      ctx.closePath();
    });
  },
  "push-down"(ctx, W, H, paintA, paintB, p) {
    ctx.save(); ctx.translate(0, H * p); paintA(); ctx.restore();
    ctx.save(); ctx.translate(0, -H * (1 - p)); paintB(); ctx.restore();
  },
  "iris-close"(ctx, W, H, paintA, paintB, p) {
    // Circular mask shrinks to center on the outgoing clip.
    paintA();
    const r = ((1 - p) * Math.hypot(W, H)) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.arc(W / 2, H / 2, Math.max(r, 0.001), 0, Math.PI * 2, true);
    ctx.clip("evenodd");
    paintB();
    ctx.restore();
  },
  clock(ctx, W, H, paintA, paintB, p) {
    // Radial sweep from 12 o'clock, one full clockwise rotation.
    paintA();
    withB(ctx, p, paintB, () => {
      ctx.moveTo(W / 2, H / 2);
      ctx.arc(W / 2, H / 2, Math.hypot(W, H) / 2, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
      ctx.closePath();
    });
  },
  pinwheel(ctx, W, H, paintA, paintB, p) {
    // Clock wipe with 2 arms sweeping simultaneously.
    paintA();
    withB(ctx, p, paintB, () => {
      for (let k = 0; k < 2; k++) {
        ctx.moveTo(W / 2, H / 2);
        ctx.arc(W / 2, H / 2, Math.hypot(W, H) / 2, -Math.PI / 2 + k * Math.PI, -Math.PI / 2 + k * Math.PI + p * Math.PI);
        ctx.closePath();
      }
    });
  },
  whirl(ctx, W, H, paintA, paintB, p) {
    // Vortex approximated as a 3-arm radial sweep (a true swirl distortion
    // has no FFmpeg equivalent; both engines share this reveal).
    paintA();
    withB(ctx, p, paintB, () => {
      for (let k = 0; k < 3; k++) {
        ctx.moveTo(W / 2, H / 2);
        ctx.arc(W / 2, H / 2, Math.hypot(W, H) / 2, -Math.PI / 2 + (k * Math.PI * 2) / 3, -Math.PI / 2 + (k * Math.PI * 2) / 3 + (p * Math.PI * 2) / 3);
        ctx.closePath();
      }
    });
  },
  "bowtie-h"(ctx, W, H, paintA, paintB, p) {
    // Two triangles expand left/right from center, widening in angle so
    // corners AND edges fill exactly at p=1 (same tan curve in the
    // export mask; fixed-angle triangles could never cover the
    // top/bottom wedges).
    paintA();
    const t = Math.tan(Math.min(Math.max(p, 0), 0.9999) * Math.PI / 2) * (H / W);
    const dy = (W / 2) * t, cx = W / 2, cy = H / 2;
    withB(ctx, p, paintB, () => {
      ctx.moveTo(cx, cy);
      ctx.lineTo(W, cy - dy);
      ctx.lineTo(W, cy + dy);
      ctx.closePath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(0, cy - dy);
      ctx.lineTo(0, cy + dy);
      ctx.closePath();
    });
  },
  "bowtie-v"(ctx, W, H, paintA, paintB, p) {
    // Transpose of bowtie-h: triangles expand up/down from center.
    paintA();
    const t = Math.tan(Math.min(Math.max(p, 0), 0.9999) * Math.PI / 2) * (W / H);
    const dx = (H / 2) * t, cx = W / 2, cy = H / 2;
    withB(ctx, p, paintB, () => {
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx - dx, H);
      ctx.lineTo(cx + dx, H);
      ctx.closePath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx - dx, 0);
      ctx.lineTo(cx + dx, 0);
      ctx.closePath();
    });
  },
  pixelate(ctx, W, H, paintA, paintB, p) {
    // True block coarsening via readback (export uses xfade pixelize; block
    // counts differ slightly between engines — same look family).
    if (p < 0.5) {
      paintA();
      const px = 1 + p * 2 * 30;
      if (px > 1.5 && !mosaicBlocks(ctx, W, H, W / px)) waveBlocks(ctx, W, H, paintA, paintB, p);
    } else {
      paintB();
      const px = 1 + (1 - (p - 0.5) * 2) * 30;
      if (px > 1.5 && !mosaicBlocks(ctx, W, H, W / px)) waveBlocks(ctx, W, H, paintA, paintB, p);
    }
  },
  "shatter-out"(ctx, W, H, paintA, paintB, p) {
    // Noise-block dissolve (export uses xfade dissolve; block patterns
    // differ — same look family). Deterministic per-block hash.
    paintA();
    const nx = 16, ny = 9, cw = W / nx, ch = H / ny;
    withB(ctx, p, paintB, () => {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const h = Math.abs(Math.sin(i * 127.1 + j * 311.7) * 43758.5453) % 1;
          if (h < p) ctx.rect(i * cw, j * ch, cw + 0.5, ch + 0.5);
        }
      }
    });
  },
  doors(ctx, W, H, paintA, paintB, p) {
    // Flat approximation: halves squeeze toward the outer edges like doors
    // swinging open (no 3D perspective in either engine).
    paintGeom(ctx, W, H, paintA, paintB, p, "doors");
  },
  "split-h"(ctx, W, H, paintA, paintB, p) {
    // Outgoing splits into top/bottom halves sliding apart vertically.
    paintB();
    const off = (H / 2) * p, hh = Math.max((H / 2) * (1 - p), 0);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, hh); ctx.clip(); ctx.translate(0, -off); paintA(); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(0, H - hh, W, hh); ctx.clip(); ctx.translate(0, off); paintA(); ctx.restore();
  },
  "split-v"(ctx, W, H, paintA, paintB, p) {
    // Outgoing splits into left/right halves sliding apart horizontally.
    paintB();
    const off = (W / 2) * p, ww = Math.max((W / 2) * (1 - p), 0);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, ww, H); ctx.clip(); ctx.translate(-off, 0); paintA(); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(W - ww, 0, ww, H); ctx.clip(); ctx.translate(off, 0); paintA(); ctx.restore();
  },
  "page-roll"(ctx, W, H, paintA, paintB, p) {
    // Outgoing rolls up like a scroll from the bottom; incoming revealed
    // beneath with a shade band tracking the roll edge.
    paintB();
    const edge = H * (1 - p);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, Math.max(edge, 0)); ctx.clip(); paintA(); ctx.restore();
    if (p > 0 && p < 1) {
      const top = Math.max(edge - 36, 0);
      const g = ctx.createLinearGradient(0, top, 0, edge);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.4)");
      ctx.fillStyle = g;
      ctx.fillRect(0, top, W, edge - top);
    }
  },
  "curl-1"(ctx, W, H, paintA, paintB, p) {
    // Single corner peel from the bottom-right (page-turn peels from the
    // top-left). True mesh-warp curl approximated as a shaded triangle peel.
    paintA();
    const c = (W + H) * (1 - p * 1.3);
    withB(ctx, p, paintB, () => {
      ctx.moveTo(W, H);
      ctx.lineTo(c - H, H);
      ctx.lineTo(W, c - W);
      ctx.closePath();
    });
    if (p > 0 && p < 1) {
      const fx = (W * c) / (W + H), fy = (H * c) / (W + H);
      ctx.save();
      ctx.translate(fx, fy);
      ctx.rotate(-Math.PI / 4);
      const g = ctx.createLinearGradient(0, -46, 0, 0);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.38)");
      ctx.fillStyle = g;
      ctx.fillRect(-W - H, -46, (W + H) * 2, 46);
      ctx.restore();
    }
  },
  "curl-2"(ctx, W, H, paintA, paintB, p) {
    // Two opposite corners (top-left + bottom-right) peel simultaneously.
    paintA();
    const c1 = (W + H) * p * 1.3, c2 = (W + H) * (1 - p * 1.3);
    withB(ctx, p, paintB, () => {
      ctx.moveTo(0, 0); ctx.lineTo(c1, 0); ctx.lineTo(0, c1); ctx.closePath();
      ctx.moveTo(W, H); ctx.lineTo(c2 - H, H); ctx.lineTo(W, c2 - W); ctx.closePath();
    });
    if (p > 0 && p < 1) {
      for (const [c, y0, y1] of [[c1, 46, 0], [c2, -46, 0]]) {
        const fx = (W * c) / (W + H), fy = (H * c) / (W + H);
        ctx.save();
        ctx.translate(fx, fy);
        ctx.rotate(-Math.PI / 4);
        const g = ctx.createLinearGradient(0, y0, 0, y1);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, "rgba(0,0,0,0.38)");
        ctx.fillStyle = g;
        ctx.fillRect(-W - H, Math.min(y0, y1), (W + H) * 2, 46);
        ctx.restore();
      }
    }
  },
  "zoom-out"(ctx, W, H, paintA, paintB, p) {
    // Outgoing shrinks toward center, revealing incoming beneath at full frame.
    paintGeom(ctx, W, H, paintA, paintB, p, "zoomout");
  },
  "zoom-in"(ctx, W, H, paintA, paintB, p) {
    // Incoming starts small at center and grows to full frame over outgoing.
    paintGeom(ctx, W, H, paintA, paintB, p, "zoomin");
  },
  "squeeze-h"(ctx, W, H, paintA, paintB, p) {
    // Outgoing squeezes vertically to a line and vanishes; incoming expands.
    paintGeom(ctx, W, H, paintA, paintB, p, "squeeze");
  },
  "stretch-in"(ctx, W, H, paintA, paintB, p) {
    // Incoming stretches from a thin horizontal line to full frame.
    paintGeom(ctx, W, H, paintA, paintB, p, "stretch");
  },
  "fly-bl"(ctx, W, H, paintA, paintB, p) {
    paintGeom(ctx, W, H, paintA, paintB, p, "flybl");
  },
  "fly-br"(ctx, W, H, paintA, paintB, p) {
    paintGeom(ctx, W, H, paintA, paintB, p, "flybr");
  },
  "fly-tl"(ctx, W, H, paintA, paintB, p) {
    paintGeom(ctx, W, H, paintA, paintB, p, "flytl");
  },
  "fly-tr"(ctx, W, H, paintA, paintB, p) {
    paintGeom(ctx, W, H, paintA, paintB, p, "flytr");
  },
  shred(ctx, W, H, paintA, paintB, p) {
    // Vertical strips peel top-to-bottom in turn, left to right.
    paintA();
    const strips = 10;
    withB(ctx, p, paintB, () => {
      for (let j = 0; j < strips; j++) {
        const f = Math.min(1, Math.max(0, p * strips - j));
        if (f > 0) ctx.rect((j * W) / strips, 0, W / strips + 0.5, H * f);
      }
    });
  },
  "soft-r"(ctx, W, H, paintA, paintB, p) {
    // Wipe right with a feathered gradient edge (multi-slice alpha ramp).
    softWipe(ctx, W, H, paintA, paintB, p, "r");
  },
  "soft-l"(ctx, W, H, paintA, paintB, p) {
    softWipe(ctx, W, H, paintA, paintB, p, "l");
  },
  "soft-d"(ctx, W, H, paintA, paintB, p) {
    softWipe(ctx, W, H, paintA, paintB, p, "d");
  },
  "soft-u"(ctx, W, H, paintA, paintB, p) {
    softWipe(ctx, W, H, paintA, paintB, p, "u");
  },
};

export const TRANSITIONS = [
  { id: "none", name: "None", family: "none" },
  { id: "fade-black", name: "Dip to black", family: "fade" },
  { id: "dissolve", name: "Cross dissolve", family: "fade" },
  { id: "dip-white", name: "Dip to white", family: "fade" },
  { id: "wipe-right", name: "Wipe right", family: "wipe" },
  { id: "wipe-left", name: "Wipe left", family: "wipe" },
  { id: "wipe-down", name: "Wipe down", family: "wipe" },
  { id: "wipe-up", name: "Wipe up", family: "wipe" },
  { id: "wipe-diagonal", name: "Diagonal wipe ↘", family: "wipe" },
  { id: "wipe-diagonal-tr", name: "Diagonal wipe ↙", family: "wipe" },
  { id: "push-left", name: "Push left", family: "push" },
  { id: "push-right", name: "Push right", family: "push" },
  { id: "push-up", name: "Push up", family: "push" },
  { id: "push-down", name: "Push down", family: "push" },
  { id: "iris-circle", name: "Iris circle", family: "pattern" },
  { id: "iris-close", name: "Iris close", family: "pattern" },
  { id: "iris-diamond", name: "Diamond", family: "pattern" },
  { id: "clock", name: "Clock wipe", family: "pattern" },
  { id: "pinwheel", name: "Pinwheel", family: "pattern" },
  { id: "bowtie-h", name: "Bow tie horizontal", family: "pattern" },
  { id: "bowtie-v", name: "Bow tie vertical", family: "pattern" },
  { id: "checker", name: "Checkerboard", family: "pattern" },
  { id: "blinds", name: "Bars", family: "pattern" },
  { id: "box-reveal", name: "Inset", family: "pattern" },
  { id: "pixelate", name: "Pixelate", family: "pattern" },
  { id: "doors", name: "Doors", family: "pattern" },
  { id: "split-h", name: "Split horizontal", family: "pattern" },
  { id: "split-v", name: "Split vertical", family: "pattern" },
  { id: "flip", name: "Flip over", family: "dimensional" },
  { id: "spin", name: "Spin", family: "dimensional" },
  { id: "spin-orbit", name: "Spin around", family: "dimensional" },
  { id: "roll", name: "Roll over", family: "dimensional" },
  { id: "page-roll", name: "Page roll", family: "dimensional" },
  { id: "page-turn", name: "Page turn", family: "dimensional" },
  { id: "curl-1", name: "Page curl single", family: "dimensional" },
  { id: "curl-2", name: "Page curl double", family: "dimensional" },
  { id: "zoom-out", name: "Zoom out", family: "dimensional" },
  { id: "zoom-in", name: "Zoom in", family: "dimensional" },
  { id: "squeeze-h", name: "Squeeze horizontal", family: "dimensional" },
  { id: "stretch-in", name: "Stretch in", family: "dimensional" },
  { id: "fly-bl", name: "Fly in from bottom-left", family: "dimensional" },
  { id: "fly-br", name: "Fly in from bottom-right", family: "dimensional" },
  { id: "fly-tl", name: "Fly in from top-left", family: "dimensional" },
  { id: "fly-tr", name: "Fly in from top-right", family: "dimensional" },
  { id: "shatter-in", name: "Shatter in", family: "shatter" },
  { id: "shatter-out", name: "Shatter out", family: "shatter" },
  { id: "shred", name: "Shred in", family: "shatter" },
  { id: "whirl", name: "Whirlwind", family: "shatter" },
  { id: "soft-r", name: "Soft wipe right", family: "soft" },
  { id: "soft-l", name: "Soft wipe left", family: "soft" },
  { id: "soft-d", name: "Soft wipe down", family: "soft" },
  { id: "soft-u", name: "Soft wipe up", family: "soft" },
];

export const TRANS_RENDER = R;
export const transById = (id) => TRANSITIONS.find((t) => t.id === id) ?? null;

export const TRANS_FAMILIES = [
  { id: "fade", name: "Fades & dissolves" },
  { id: "wipe", name: "Wipes" },
  { id: "push", name: "Push / slide" },
  { id: "pattern", name: "Shape & pattern" },
  { id: "dimensional", name: "3D & motion" },
  { id: "shatter", name: "Shatter & particles" },
  { id: "soft", name: "Soft wipes" },
];

/* ------------------------------------------------------- shared geometry
   GEOM[kind](q, W, H) describes one progress sample of a geometric move:
   { base: 'black'|'a'|'b', layers: [{ src, crop, scale, rotate, alpha, pos }] }
   pos = top-left placement of the scaled layer box; rotate is about the
   layer center. Canvas painters (paintGeom) and the export stage chains
   evaluate the same functions, so preview and export match by construction.
   Node-safe pure math (no canvas/DOM). */

function flyGeom(q, W, H, sxn, syn) {
  const s = 0.85 + q * 0.15, w = W * s, h = H * s;
  const x0 = sxn < 0 ? -w : W, x1 = (W - w) / 2;
  const y0 = syn < 0 ? -h : H, y1 = (H - h) / 2;
  return { base: "a", layers: [{ src: "b", crop: null, scale: [s, s], rotate: 0, alpha: 1, pos: [x0 + (x1 - x0) * q, y0 + (y1 - y0) * q] }] };
}

export const GEOM = {
  flip(q, W, H) {
    const sx = Math.abs(Math.cos(Math.PI * q));
    return {
      base: "black",
      layers: [{ src: q < 0.5 ? "a" : "b", crop: null, scale: [sx, 1], rotate: 0, alpha: 1, pos: [(W - W * sx) / 2, 0] }],
    };
  },
  spin(q, W, H) {
    if (q < 0.5) {
      const t = q * 2, s = 1 - t * 0.6;
      return { base: "black", layers: [{ src: "a", crop: null, scale: [s, s], rotate: t * Math.PI * 2, alpha: 1 - t * 0.7, pos: [(W - W * s) / 2, (H - H * s) / 2] }] };
    }
    const t = (q - 0.5) * 2, s = 0.4 + t * 0.6;
    return { base: "black", layers: [{ src: "b", crop: null, scale: [s, s], rotate: (-Math.PI / 2) * (1 - t), alpha: 0.3 + t * 0.7, pos: [(W - W * s) / 2, (H - H * s) / 2] }] };
  },
  spinorbit(q, W, H) {
    const D = Math.hypot(W, H) * 0.75;
    const sa = 1 - q * 0.8, sb = 0.2 + q * 0.8;
    const aa = -Math.PI / 2 + (q * Math.PI) / 2;
    const ax = W / 2 + D * q * Math.cos(aa), ay = H / 2 + D * q * Math.sin(aa);
    const bx = W / 2 + D * (1 - q) * Math.cos((3 * Math.PI) / 4);
    const by = H / 2 + D * (1 - q) * Math.sin((3 * Math.PI) / 4);
    return {
      base: "black",
      layers: [
        { src: "a", crop: null, scale: [sa, sa], rotate: 0, alpha: 1, pos: [ax - (W * sa) / 2, ay - (H * sa) / 2] },
        { src: "b", crop: null, scale: [sb, sb], rotate: 0, alpha: 1, pos: [bx - (W * sb) / 2, by - (H * sb) / 2] },
      ],
    };
  },
  roll(q, W, H) {
    const bow = 1 - Math.sin(q * Math.PI) * 0.18;
    return {
      base: "black",
      layers: [
        { src: "a", crop: null, scale: [1, bow], rotate: 0, alpha: 1, pos: [0, (H / 2) * (1 - bow) - bow * H * q] },
        { src: "b", crop: null, scale: [1, bow], rotate: 0, alpha: 1, pos: [0, (H / 2) * (1 - bow) + bow * H * (1 - q)] },
      ],
    };
  },
  doors(q, W, H) {
    const s = Math.max(1 - q, 0.001), w = (W / 2) * s;
    return {
      base: "b",
      layers: [
        { src: "a", crop: [0, 0, W / 2, H], scale: [s, 1], rotate: 0, alpha: 1, pos: [0, 0] },
        { src: "a", crop: [W / 2, 0, W / 2, H], scale: [s, 1], rotate: 0, alpha: 1, pos: [W - w, 0] },
      ],
    };
  },
  zoomin(q, W, H) {
    const s = 0.15 + q * 0.85;
    return { base: "a", layers: [{ src: "b", crop: null, scale: [s, s], rotate: 0, alpha: 1, pos: [(W - W * s) / 2, (H - H * s) / 2] }] };
  },
  zoomout(q, W, H) {
    const s = 1 - q * 0.85;
    return { base: "b", layers: [{ src: "a", crop: null, scale: [s, s], rotate: 0, alpha: 1, pos: [(W - W * s) / 2, (H - H * s) / 2] }] };
  },
  squeeze(q, W, H) {
    if (q < 0.5) {
      const sy = Math.max(1 - q * 2, 0.001);
      return { base: "black", layers: [{ src: "a", crop: null, scale: [1, sy], rotate: 0, alpha: 1, pos: [0, (H - H * sy) / 2] }] };
    }
    const sy = Math.max((q - 0.5) * 2, 0.001);
    return { base: "black", layers: [{ src: "b", crop: null, scale: [1, sy], rotate: 0, alpha: 1, pos: [0, (H - H * sy) / 2] }] };
  },
  stretch(q, W, H) {
    const sy = Math.max(q, 0.001);
    return { base: "a", layers: [{ src: "b", crop: null, scale: [1, sy], rotate: 0, alpha: 1, pos: [0, (H - H * sy) / 2] }] };
  },
  inset(q, W, H) {
    // box-reveal: the incoming window grows centered over outgoing.
    const w = W * q, h = H * q;
    return { base: "a", layers: [{ src: "b", crop: [(W - w) / 2, (H - h) / 2, w, h], scale: [1, 1], rotate: 0, alpha: 1, pos: [(W - w) / 2, (H - h) / 2] }] };
  },
  splith(q, W, H) {
    // split-h: outgoing halves slide apart vertically over incoming.
    const off = (H / 2) * q;
    return {
      base: "b",
      layers: [
        { src: "a", crop: [0, 0, W, H / 2], scale: [1, 1], rotate: 0, alpha: 1, pos: [0, -off] },
        { src: "a", crop: [0, H / 2, W, H / 2], scale: [1, 1], rotate: 0, alpha: 1, pos: [0, H / 2 + off] },
      ],
    };
  },
  splitv(q, W, H) {
    // split-v: outgoing halves slide apart horizontally over incoming.
    const off = (W / 2) * q;
    return {
      base: "b",
      layers: [
        { src: "a", crop: [0, 0, W / 2, H], scale: [1, 1], rotate: 0, alpha: 1, pos: [-off, 0] },
        { src: "a", crop: [W / 2, 0, W / 2, H], scale: [1, 1], rotate: 0, alpha: 1, pos: [W / 2 + off, 0] },
      ],
    };
  },
  bars(q, W, H) {
    // blinds: 8 slats wipe left-to-right in turn, top to bottom.
    const layers = [];
    for (let i = 0; i < 8; i++) {
      const f = Math.min(1, Math.max(0, q * 8 - i));
      if (f > 0) layers.push({ src: "b", crop: [0, (i * H) / 8, W * f, H / 8], scale: [1, 1], rotate: 0, alpha: 1, pos: [0, (i * H) / 8] });
    }
    return { base: "a", layers };
  },
  shred(q, W, H) {
    // shred: 10 vertical strips peel top-to-bottom in turn, left to right.
    const layers = [];
    for (let j = 0; j < 10; j++) {
      const f = Math.min(1, Math.max(0, q * 10 - j));
      if (f > 0) layers.push({ src: "b", crop: [(j * W) / 10, 0, W / 10, H * f], scale: [1, 1], rotate: 0, alpha: 1, pos: [(j * W) / 10, 0] });
    }
    return { base: "a", layers };
  },
  flybl: (q, W, H) => flyGeom(q, W, H, -1, 1),
  flybr: (q, W, H) => flyGeom(q, W, H, 1, 1),
  flytl: (q, W, H) => flyGeom(q, W, H, -1, -1),
  flytr: (q, W, H) => flyGeom(q, W, H, 1, -1),
};

// shatter-in shares the pixelize look (documented approximation).
R["shatter-in"] = R.pixelate;

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
