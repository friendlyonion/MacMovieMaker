// Maintained M3 tests: gallery data integrity + Ken Burns math invariants.
// Runs with node's built-in runner, no dependencies:  npm test
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TRANSITIONS,
  TRANS_RENDER,
  PANZOOM_PRESETS,
  PZ_GROUPS,
  lerpPreset,
  panZoomSource,
} from "../src/gallery.js";

describe("transitions gallery", () => {
  it("holds None plus 20 named transitions with unique ids", () => {
    assert.equal(TRANSITIONS.length, 21);
    assert.equal(TRANSITIONS[0].id, "none");
    const ids = TRANSITIONS.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const t of TRANSITIONS) assert.ok(t.name.length > 0);
  });
  it("covers the four required families", () => {
    const fams = new Set(TRANSITIONS.map((t) => t.family));
    for (const f of ["fade", "wipe", "pattern", "push", "dimensional"]) {
      assert.ok(fams.has(f), `missing family ${f}`);
    }
  });
  it("has a renderer for every transition except None", () => {
    for (const t of TRANSITIONS) {
      if (t.id === "none") continue;
      assert.equal(typeof TRANS_RENDER[t.id], "function", t.id);
    }
  });
});

describe("pan & zoom presets", () => {
  it("holds 26 presets across the four spec groups", () => {
    assert.equal(PANZOOM_PRESETS.length, 26);
    assert.deepEqual(PZ_GROUPS, ["Automatic", "Pan only", "Zoom in", "Zoom out"]);
    const ids = PANZOOM_PRESETS.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length);
    const counts = {};
    for (const p of PANZOOM_PRESETS) counts[p.group] = (counts[p.group] || 0) + 1;
    assert.deepEqual(counts, { Automatic: 4, "Pan only": 8, "Zoom in": 7, "Zoom out": 7 });
  });
  it("interpolates endpoints exactly", () => {
    for (const p of PANZOOM_PRESETS) {
      assert.deepEqual(lerpPreset(p, 0), p.from);
      assert.deepEqual(lerpPreset(p, 1), p.to);
    }
  });
  it("keeps every source rect inside the image for common aspects", () => {
    const sizes = [[1920, 1080], [1080, 1920], [1000, 1000], [3000, 1000], [640, 480]];
    for (const p of PANZOOM_PRESETS) {
      for (const [w, h] of sizes) {
        for (const q of [0, 0.25, 0.5, 0.75, 1]) {
          const r = panZoomSource(w, h, 16 / 9, p, q);
          assert.ok(r.sw > 0 && r.sh > 0, `${p.id} empty rect`);
          assert.ok(r.sx >= -1e-6 && r.sy >= -1e-6, `${p.id} negative origin`);
          assert.ok(r.sx + r.sw <= w + 1e-6 && r.sy + r.sh <= h + 1e-6, `${p.id} overflows`);
          const aspect = r.sw / r.sh;
          assert.ok(Math.abs(aspect - 16 / 9) < 1e-6, `${p.id} distorts`);
        }
      }
    }
  });
});
