// Maintained M3 smoke test: executes every transition renderer and every
// gallery thumbnail painter against a stub 2D context. Catches typos and
// bad references in canvas code that node's runner can't otherwise see.
// Runs with node's built-in runner, no dependencies:  npm test
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TRANSITIONS,
  TRANS_RENDER,
  PANZOOM_PRESETS,
  paintTransThumb,
  paintPZThumb,
} from "../src/gallery.js";
import { EFFECTS, paintFxThumb } from "../src/effects.js";
import { TEXT_ANIMS, paintAnimThumb } from "../src/textanim.js";

// paintFxThumb allocates scratch canvases; stub document for node.
if (typeof document === "undefined") {
  globalThis.document = { createElement: (tag) => (tag === "canvas" ? stubCanvas(160, 90) : {}) };
}

const grad = { addColorStop() {} };
const noop = () => grad;
function stubCtx() {
  return new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => grad;
        if (prop === "measureText") return () => ({ width: 0 });
        if (prop === "getImageData")
          return (...a) => {
            const w = a[2] || 160, h = a[3] || 90;
            return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
          };
        if (prop === "createImageData")
          return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
        if (prop === "canvas") return { width: 144, height: 80 };
        return noop;
      },
      set: () => true,
    }
  );
}
function stubCanvas(w = 144, h = 80) {
  const ctx = stubCtx();
  return { width: w, height: h, getContext: () => ctx };
}

describe("transition renderers", () => {
  it("runs every renderer at p=0, 0.5, and 1 without throwing", () => {
    for (const t of TRANSITIONS) {
      if (t.id === "none") continue;
      const render = TRANS_RENDER[t.id];
      for (const p of [0, 0.5, 1]) {
        render(stubCtx(), 960, 540, noop, noop, p);
      }
    }
    assert.ok(true);
  });
  it("paints every transition thumbnail", () => {
    for (const t of TRANSITIONS) paintTransThumb(stubCanvas(), t.id);
    assert.ok(true);
  });
  it("paints every pan/zoom path diagram", () => {
    for (const p of PANZOOM_PRESETS) paintPZThumb(stubCanvas(), p);
    assert.ok(true);
  });
  it("paints every effect thumbnail", () => {
    for (const e of EFFECTS) paintFxThumb(stubCanvas(), e.id);
    assert.ok(true);
  });
  it("paints every title-animation icon", () => {
    for (const p of TEXT_ANIMS) paintAnimThumb(stubCanvas(), p);
    assert.ok(true);
  });
});
