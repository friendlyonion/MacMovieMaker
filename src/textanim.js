// MacMovieMaker — Milestone 4 title-animation presets.
// Every preset is a pure param function: compute(q, t, box, stage) -> params.
//   q     = progress 0..1 (entrance fraction for enter-mode, span fraction
//           for span-mode)
//   t     = absolute seconds, for deterministic blink/flicker
//   box   = text box {w,h} in px (for clip paths)
//   stage = {W,H} in px (for off-screen fly distances)
// Params: {dx,dy,scale,sx,sy,rot,alpha,clip,chars,cursor,banner}
//   clip  = null | {kind:'rect',x,y,w,h} | {kind:'ellipse',x,y,rx,ry}
//           | {kind:'drip',h}   (box-relative coords, origin = box top-left)
//   chars = null | char count to reveal (typewriter); cursor = caret bar
//   banner= null | 0..1 bar wipe fraction (news banner)
// Node-safe: canvas is only touched inside paintAnimThumb.

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const easeOut = (q) => 1 - Math.pow(1 - q, 3);
const easeOutBack = (q) => 1 + 2.2 * Math.pow(q - 1, 3) + 1.2 * Math.pow(q - 1, 2);

const base = (over = {}) => ({
  dx: 0, dy: 0, scale: 1, sx: 1, sy: 1, rot: 0, alpha: 1,
  clip: null, chars: null, cursor: false, banner: null, ...over,
});

export const TEXT_ANIMS = [
  { id: "ta-basic", name: "Basic title", mode: "enter", enter: 0.01, glyph: "still",
    compute: () => base() },
  { id: "ta-fade", name: "Fade in", mode: "enter", enter: 1.2, glyph: "fade",
    compute: (q) => base({ alpha: easeOut(q) }) },
  { id: "ta-fly-l", name: "Fly in from left", mode: "enter", enter: 1.1, glyph: "arrow-l",
    compute: (q, _t, box, stage) => base({ dx: -(1 - easeOut(q)) * (stage.W / 2 + box.w / 2), alpha: clamp01(q * 3) }) },
  { id: "ta-fly-r", name: "Fly in from right", mode: "enter", enter: 1.1, glyph: "arrow-r",
    compute: (q, _t, box, stage) => base({ dx: (1 - easeOut(q)) * (stage.W / 2 + box.w / 2), alpha: clamp01(q * 3) }) },
  { id: "ta-fly-t", name: "Fly in from top", mode: "enter", enter: 1.1, glyph: "arrow-u",
    compute: (q, _t, box, stage) => base({ dy: -(1 - easeOut(q)) * (stage.H / 2 + box.h / 2), alpha: clamp01(q * 3) }) },
  { id: "ta-fly-b", name: "Fly in from bottom", mode: "enter", enter: 1.1, glyph: "arrow-d",
    compute: (q, _t, box, stage) => base({ dy: (1 - easeOut(q)) * (stage.H / 2 + box.h / 2), alpha: clamp01(q * 3) }) },
  { id: "ta-zoom-in", name: "Zoom in", mode: "enter", enter: 1.2, glyph: "zoom-in",
    compute: (q) => base({ scale: 0.3 + 0.7 * easeOut(q), alpha: easeOut(q) }) },
  { id: "ta-zoom-out", name: "Zoom out", mode: "enter", enter: 1.2, glyph: "zoom-out",
    compute: (q) => base({ scale: 2 - easeOut(q), alpha: clamp01(q * 2.5) }) },
  { id: "ta-fade-zoom", name: "Fade and zoom", mode: "enter", enter: 1.4, glyph: "zoom-in",
    compute: (q) => base({ scale: 1.3 - 0.3 * easeOut(q), alpha: easeOut(q) }) },
  { id: "ta-spin-in", name: "Spin in", mode: "enter", enter: 1.3, glyph: "spin",
    compute: (q) => base({ rot: (-180 * (1 - easeOut(q)) * Math.PI) / 180, scale: 0.5 + 0.5 * easeOut(q), alpha: easeOut(q) }) },
  { id: "ta-twirl", name: "Twirl", mode: "enter", enter: 1.5, glyph: "spin",
    compute: (q) => base({ rot: (360 * (1 - easeOut(q)) * Math.PI) / 180, alpha: clamp01(q * 2) }) },
  { id: "ta-stretch", name: "Stretch in", mode: "enter", enter: 1.0, glyph: "stretch",
    compute: (q) => base({ sx: Math.max(0.001, easeOut(q)), alpha: clamp01(q * 2) }) },
  { id: "ta-mirror", name: "Mirror", mode: "enter", enter: 1.2, glyph: "mirror",
    compute: (q) => base({ sx: -1 + 2 * easeOut(q), alpha: clamp01(0.25 + q) }) },
  { id: "ta-wipe", name: "Wipe reveal", mode: "enter", enter: 1.2, glyph: "wipe",
    compute: (q, _t, box) => base({ clip: { kind: "rect", x: 0, y: 0, w: box.w * easeOut(q), h: box.h } }) },
  { id: "ta-wipe-bounce", name: "Bounce wipe", mode: "enter", enter: 1.3, glyph: "wipe",
    compute: (q, _t, box) => base({ clip: { kind: "rect", x: 0, y: 0, w: box.w * Math.max(0, easeOutBack(q)), h: box.h } }) },
  { id: "ta-ellipse-wipe", name: "Ellipse wipe", mode: "enter", enter: 1.3, glyph: "ellipse",
    compute: (q, _t, box) => base({
      clip: { kind: "ellipse", x: box.w / 2, y: box.h / 2, rx: (box.w / 2) * easeOut(q), ry: (box.h / 2) * easeOut(q) },
    }) },
  { id: "ta-flash", name: "Flash in", mode: "enter", enter: 1.2, glyph: "flash",
    compute: (q, t) => {
      if (q >= 1) return base({ alpha: 1 });
      const blinks = Math.floor(t * 9);
      return base({ alpha: blinks % 2 === 0 ? 1 : 0.15 });
    } },
  { id: "ta-drip", name: "Paint drip", mode: "enter", enter: 1.6, glyph: "drip",
    compute: (q, _t, box) => base({ clip: { kind: "drip", h: box.h * easeOut(q) } }) },
  { id: "ta-news", name: "News banner", mode: "enter", enter: 1.0, glyph: "banner",
    compute: (q) => base({ banner: easeOut(q), alpha: clamp01(q * 3) }) },
  // Span-mode: progress runs across the whole text duration.
  { id: "ta-typewriter", name: "Typewriter", mode: "span", glyph: "type",
    compute: (q, t, box, _stage, len = 0) => base({ chars: Math.floor(clamp01(q) * len), cursor: Math.floor(t * 2.5) % 2 === 0 }) },
  { id: "ta-ticker", name: "Ticker tape", mode: "span", glyph: "ticker",
    compute: (q, _t, box, stage) => base({ dx: (stage.W / 2 + box.w / 2) * (1 - 2 * q) }) },
  { id: "ta-scroll-up", name: "Scroll up", mode: "span", glyph: "arrow-u",
    compute: (q, _t, box, stage) => base({ dy: (stage.H / 2 + box.h / 2) * (1 - 2 * q) }) },
  { id: "ta-scroll-down", name: "Scroll down", mode: "span", glyph: "arrow-d",
    compute: (q, _t, box, stage) => base({ dy: (stage.H / 2 + box.h / 2) * (2 * q - 1) }) },
];

export const animById = (id) => TEXT_ANIMS.find((a) => a.id === id) ?? TEXT_ANIMS[0];

/** Default text state for a title, credits card, or caption overlay. */
export function makeText(kind) {
  return {
    content: kind === "credits" ? "Director\n\nStarring\n\nMusic" : kind === "caption" ? "" : "My Movie",
    fontFamily: "system",
    fontSize: 48,
    bold: false,
    italic: false,
    color: "#ffffff",
    opacity: 1,
    align: "center",
    bg: "#1f2937",
    x: 0.5,
    y: kind === "caption" ? 0.85 : 0.5,
    anim: "ta-basic",
    dur: 7, // caption visible span (title/credits use their clip range)
    offset: 0,
  };
}

export const FONT_STACKS = {
  system: "-apple-system, 'Helvetica Neue', Helvetica, sans-serif",
  helvetica: "Helvetica, 'Helvetica Neue', sans-serif",
  georgia: "Georgia, serif",
  times: "'Times New Roman', Times, serif",
  courier: "'Courier New', Courier, monospace",
  verdana: "Verdana, sans-serif",
  trebuchat: "'Trebuchet MS', sans-serif",
  palatino: "Palatino, 'Palatino Linotype', serif",
};

export const fontOf = (text) =>
  `${text.italic ? "italic " : ""}${text.bold ? "bold " : ""}${text.fontSize}px ${FONT_STACKS[text.fontFamily] || FONT_STACKS.system}`;

/* --------------------------------------------- original preset icons
   Small motion glyphs: arrows for flights, lens corners for zooms, an arc
   for spins, a caret for typewriter, bars for wipes, drops for drips. */

function glyphArrow(ctx, w, h, dir) {
  const cx = w / 2, cy = h / 2, L = Math.min(w, h) * 0.3;
  const v = { l: [-1, 0], r: [1, 0], u: [0, -1], d: [0, 1] }[dir];
  ctx.strokeStyle = "#ffd166";
  ctx.fillStyle = "#ffd166";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - v[0] * L, cy - v[1] * L);
  ctx.lineTo(cx + v[0] * L, cy + v[1] * L);
  ctx.stroke();
  const hx = cx + v[0] * L, hy = cy + v[1] * L, s = 6;
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(hx - v[0] * s - v[1] * s * 0.6, hy - v[1] * s + v[0] * s * 0.6);
  ctx.lineTo(hx - v[0] * s + v[1] * s * 0.6, hy - v[1] * s - v[0] * s * 0.6);
  ctx.closePath();
  ctx.fill();
}

export function paintAnimThumb(canvas, preset) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = "#23262b";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = `600 ${Math.round(h * 0.42)}px -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const g = preset.glyph;
  if (g === "still") {
    ctx.fillText("Aa", w / 2, h / 2);
  } else if (g === "fade") {
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, "rgba(255,255,255,0.1)");
    grad.addColorStop(1, "rgba(255,255,255,0.95)");
    ctx.fillStyle = grad;
    ctx.fillText("Aa", w / 2, h / 2);
  } else if (g.startsWith("arrow-")) {
    ctx.globalAlpha = 0.35;
    ctx.fillText("Aa", w / 2, h / 2);
    ctx.globalAlpha = 1;
    glyphArrow(ctx, w, h, g.slice(6));
  } else if (g === "zoom-in" || g === "zoom-out") {
    ctx.fillText("A", w / 2, h / 2);
    ctx.strokeStyle = "#ffd166";
    ctx.lineWidth = 2;
    const s = g === "zoom-in" ? 1 : -1;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      ctx.beginPath();
      ctx.moveTo(w / 2 + sx * 8, h / 2 + sy * 8);
      ctx.lineTo(w / 2 + sx * (8 + 7 * s), h / 2 + sy * (8 + 7 * s));
      ctx.stroke();
    }
  } else if (g === "spin") {
    ctx.fillText("A", w / 2, h / 2);
    ctx.strokeStyle = "#ffd166";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.32, -0.4, Math.PI * 1.5);
    ctx.stroke();
    ctx.fillStyle = "#ffd166";
    ctx.beginPath();
    ctx.arc(w / 2 + Math.cos(-0.4) * Math.min(w, h) * 0.32, h / 2 + Math.sin(-0.4) * Math.min(w, h) * 0.32, 3, 0, Math.PI * 2);
    ctx.fill();
  } else if (g === "stretch" || g === "mirror") {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(g === "stretch" ? 0.5 : -0.85, 1);
    ctx.fillText("Aa", 0, 0);
    ctx.restore();
  } else if (g === "wipe" || g === "ellipse") {
    ctx.globalAlpha = 0.3;
    ctx.fillText("Aa", w / 2, h / 2);
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.beginPath();
    if (g === "wipe") ctx.rect(0, 0, w * 0.55, h);
    else ctx.ellipse(w / 2, h / 2, w * 0.28, h * 0.3, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillText("Aa", w / 2, h / 2);
    ctx.restore();
  } else if (g === "flash") {
    ctx.fillText("A", w / 2 - 8, h / 2);
    ctx.fillStyle = "#ffd166";
    ctx.beginPath();
    ctx.moveTo(w / 2 + 14, h * 0.15);
    ctx.lineTo(w / 2 + 4, h / 2);
    ctx.lineTo(w / 2 + 12, h / 2);
    ctx.lineTo(w / 2 + 2, h * 0.85);
    ctx.lineTo(w / 2 + 8, h * 0.52);
    ctx.lineTo(w / 2, h * 0.52);
    ctx.closePath();
    ctx.fill();
  } else if (g === "drip") {
    ctx.fillText("Aa", w / 2, h * 0.32);
    ctx.fillStyle = "#7cc4ff";
    for (const [fx, len] of [[0.35, 0.5], [0.5, 0.72], [0.65, 0.42]]) {
      ctx.fillRect(w * fx - 2, h * 0.5, 4, h * len * 0.5);
      ctx.beginPath();
      ctx.arc(w * fx, h * 0.5 + h * len * 0.5, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (g === "banner") {
    ctx.fillStyle = "#0a84ff";
    ctx.fillRect(w * 0.08, h * 0.28, w * 0.6, h * 0.44);
    ctx.fillStyle = "#fff";
    ctx.font = `600 ${Math.round(h * 0.3)}px -apple-system, sans-serif`;
    ctx.fillText("Aa", w * 0.32, h * 0.52);
  } else if (g === "type") {
    ctx.fillText("A", w / 2 - 6, h / 2);
    ctx.fillStyle = "#ffd166";
    ctx.fillRect(w / 2 + 6, h * 0.28, 3, h * 0.44);
  } else if (g === "ticker") {
    ctx.font = `600 ${Math.round(h * 0.34)}px -apple-system, sans-serif`;
    ctx.fillText("···Aa", w / 2, h / 2);
    glyphArrow(ctx, w * 0.82, h, "l");
  } else {
    ctx.fillText("Aa", w / 2, h / 2);
  }
}
