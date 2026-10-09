// Maintained M5 tests: AutoMovie theme data integrity against the real
// transition/effect/pan-zoom catalogs. Runs with node:  npm test
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { THEMES } from "../src/automovie.js";
import { TRANSITIONS } from "../src/gallery.js";
import { EFFECTS } from "../src/effects.js";
import { PANZOOM_PRESETS } from "../src/gallery.js";

const SPEC_NAMES = ["Default", "Sepia", "Black and White", "Pan and Zoom", "Fade", "Cinematic", "Contemporary"];

describe("automovie themes", () => {
  it("covers the seven spec themes in order", () => {
    assert.deepEqual(THEMES.map((t) => t.name), SPEC_NAMES);
    const ids = THEMES.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length);
  });
  it("references only real transitions, effects, and presets", () => {
    const tids = new Set(TRANSITIONS.map((t) => t.id));
    const eids = new Set(EFFECTS.map((e) => e.id));
    const pids = new Set(PANZOOM_PRESETS.map((p) => p.id));
    for (const t of THEMES) {
      assert.ok(tids.has(t.trans) && t.trans !== "none", `${t.id}.trans`);
      assert.ok(t.transDur >= 0.25 && t.transDur <= 2, `${t.id}.transDur`);
      assert.ok(eids.has(t.fx), `${t.id}.fx`);
      assert.ok(t.pz.length > 0, `${t.id}.pz`);
      for (const p of t.pz) assert.ok(pids.has(p), `${t.id}.pz ${p}`);
      assert.equal(typeof t.titles, "boolean");
      assert.ok(t.blurb.length > 0);
    }
  });
});
