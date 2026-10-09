// Maintained M4 tests: effect point-ops, fade math, and FFmpeg export parity.
// Runs with node's built-in runner, no dependencies:  npm test
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FX,
  POINT_OPS,
  brightnessOp,
  applyPixelChain,
  EFFECTS,
  fxById,
  buildExportFilter,
  fadeAlphas,
  FADE_DUR,
} from "../src/effects.js";

const px = (r, g, b) => new Uint8ClampedArray([r, g, b, 255]);

describe("effect table", () => {
  it("holds None plus 9 effects with unique ids", () => {
    assert.equal(EFFECTS.length, 10);
    assert.equal(EFFECTS[0].id, "none");
    const ids = EFFECTS.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length);
  });
  it("declares an export template for every real effect", () => {
    for (const e of EFFECTS) {
      if (e.id === "none") continue;
      assert.equal(typeof e.export, "function", e.id);
      assert.ok(e.export({ W: 1920, H: 1080 }).length > 0, e.id);
    }
  });
});

describe("point operations", () => {
  it("grayscale equalizes channels", () => {
    const d = px(200, 100, 50);
    POINT_OPS.bw(d, 0);
    assert.equal(d[0], d[1]);
    assert.equal(d[1], d[2]);
  });
  it("invert is an involution", () => {
    const d = px(10, 200, 90);
    POINT_OPS.invert(d, 0);
    POINT_OPS.invert(d, 0);
    assert.deepEqual([...d], [10, 200, 90, 255]);
  });
  it("threshold yields pure black or white", () => {
    const dark = px(10, 10, 10), light = px(250, 250, 250);
    POINT_OPS.threshold(dark, 0);
    POINT_OPS.threshold(light, 0);
    assert.deepEqual([...dark.slice(0, 3)], [0, 0, 0]);
    assert.deepEqual([...light.slice(0, 3)], [255, 255, 255]);
  });
  it("posterize allows at most 4 levels per channel", () => {
    const seen = new Set();
    for (let v = 0; v < 256; v++) {
      const d = px(v, v, v);
      POINT_OPS.posterize(d, 0);
      seen.add(d[0]);
    }
    assert.equal(seen.size, 4);
  });
  it("sepia, cinematic, and old film transform without throwing", () => {
    for (const id of ["sepia", "cinematic", "oldfilm"]) {
      const d = px(120, 130, 140);
      POINT_OPS[id](d, 0, 1.7);
      assert.ok(Number.isFinite(d[0]) && Number.isFinite(d[1]) && Number.isFinite(d[2]));
      assert.ok(d[0] !== 120 || d[1] !== 130 || d[2] !== 140);
    }
  });
  it("brightness shifts channels linearly", () => {
    const d = px(100, 100, 100);
    brightnessOp(0.5)(d, 0);
    assert.ok(Math.abs(d[0] - 227.5) < 1);
    const e = px(100, 100, 100);
    brightnessOp(-1)(e, 0);
    assert.deepEqual([...e.slice(0, 3)], [0, 0, 0]);
  });
  it("pixel chain is a no-op when inert", () => {
    let touched = false;
    const ctx = { getImageData: () => { touched = true; return { data: px(1, 2, 3) }; }, putImageData: () => {} };
    applyPixelChain(ctx, 1, 1, "none", 0);
    assert.equal(touched, false);
  });
  it("pixel chain applies effect then brightness", () => {
    const d = px(100, 100, 100);
    const ctx = { getImageData: () => ({ data: d }), putImageData: () => {} };
    applyPixelChain(ctx, 1, 1, "invert", 0);
    assert.deepEqual([...d.slice(0, 3)], [155, 155, 155]);
  });
});

describe("fades", () => {
  it("ramps in from full and out to full", () => {
    const fx = { ...DEFAULT_FX(), fadeIn: "black", fadeOut: "white" };
    assert.deepEqual(fadeAlphas(fx, 0, 10), { inA: 1, inColor: "black", outA: 0, outColor: "white" });
    assert.equal(fadeAlphas(fx, FADE_DUR / 2, 10).inA, 0.5);
    assert.equal(fadeAlphas(fx, 5, 10).inA + fadeAlphas(fx, 5, 10).outA, 0);
    assert.equal(fadeAlphas(fx, 10, 10).outA, 1);
  });
  it("clamps fades to half of short ranges", () => {
    const fx = { ...DEFAULT_FX(), fadeIn: "black", fadeOut: "black" };
    assert.equal(fadeAlphas(fx, 0.25, 1).inA, 0.5); // fd = 0.5
    assert.equal(fadeAlphas(fx, 0.75, 1).outA, 0.5);
  });
  it("stays inert when fades are off", () => {
    assert.deepEqual(fadeAlphas(DEFAULT_FX(), 0, 10).inA, 0);
  });
});

describe("export filter parity", () => {
  const geo = { W: 1920, H: 1080, kept: 10 };
  it("emits nothing for a default chain", () => {
    assert.equal(buildExportFilter(DEFAULT_FX(), geo), "");
    assert.equal(buildExportFilter(null, geo), "");
  });
  it("orders effect, brightness, fades, letterbox like the preview", () => {
    const fx = { effect: "cinematic", brightness: 0.2, fadeIn: "black", fadeOut: "white" };
    const chain = buildExportFilter(fx, geo);
    const order = ["colorbalance", "eq=brightness=0.2", "fade=t=in", "fade=t=out", "drawbox"];
    let at = -1;
    for (const piece of order) {
      const idx = chain.indexOf(piece);
      assert.ok(idx > at, `${piece} out of order in: ${chain}`);
      at = idx;
    }
  });
  it("carries fade colors and clamped durations", () => {
    const chain = buildExportFilter({ ...DEFAULT_FX(), fadeIn: "white" }, { ...geo, kept: 1 });
    assert.ok(chain.includes("color=white"));
    assert.ok(chain.includes("d=0.5"));
  });
  it("clamps to zero-length-safe output on degenerate ranges", () => {
    const chain = buildExportFilter({ ...DEFAULT_FX(), fadeOut: "black" }, { W: 640, H: 360, kept: 0 });
    assert.ok(chain.includes("fade=t=out"));
  });
  it("renders pixelate at the export frame size", () => {
    const chain = buildExportFilter({ ...DEFAULT_FX(), effect: "pixelate" }, geo);
    assert.ok(chain.includes("1920:1080"));
  });
  it("matches preview posterize bins", () => {
    const chain = buildExportFilter({ ...DEFAULT_FX(), effect: "posterize" }, geo);
    assert.ok(chain.includes("/64)*64+32")); // same 4 bins, centered
  });
});
