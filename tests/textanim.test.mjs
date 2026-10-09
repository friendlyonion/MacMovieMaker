// Maintained M4 tests: title-animation preset envelopes and defaults.
// Runs with node's built-in runner, no dependencies:  npm test
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TEXT_ANIMS, animById, makeText, fontOf } from "../src/textanim.js";

const BOX = { w: 300, h: 80 };
const STAGE = { W: 960, H: 540 };

describe("animation presets", () => {
  it("holds 23 presets with unique ids and valid modes", () => {
    assert.equal(TEXT_ANIMS.length, 23);
    const ids = TEXT_ANIMS.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const p of TEXT_ANIMS) {
      assert.ok(["enter", "span"].includes(p.mode), p.id);
      if (p.mode === "enter") assert.ok(p.enter > 0, p.id);
    }
  });
  it("falls back to Basic for unknown ids", () => {
    assert.equal(animById("nope").id, "ta-basic");
  });
  it("returns finite, sane params across the envelope", () => {
    for (const p of TEXT_ANIMS) {
      for (const q of [0, 0.25, 0.5, 0.75, 1]) {
        const r = p.compute(q, 1.7, BOX, STAGE, 12);
        for (const k of ["dx", "dy", "scale", "sx", "sy", "rot", "alpha"]) {
          assert.ok(Number.isFinite(r[k]), `${p.id}.${k} at q=${q}`);
        }
        assert.ok(r.alpha >= 0 && r.alpha <= 1, `${p.id}.alpha at q=${q}`);
        if (r.chars != null) assert.ok(Number.isInteger(r.chars) && r.chars >= 0, p.id);
        if (r.clip?.kind === "rect") assert.ok(r.clip.w >= 0 && r.clip.h >= 0, p.id);
        if (r.clip?.kind === "ellipse") assert.ok(r.clip.rx >= 0 && r.clip.ry >= 0, p.id);
        if (r.clip?.kind === "drip") assert.ok(r.clip.h >= 0 && r.clip.h <= BOX.h + 1e-6, p.id);
      }
    }
  });
  it("settles enter-mode presets to identity at q=1", () => {
    for (const p of TEXT_ANIMS.filter((a) => a.mode === "enter")) {
      const r = p.compute(1, 9.9, BOX, STAGE, 12);
      assert.ok(r.dx === 0, p.id); // === tolerates -0; strictEqual does not
      assert.ok(r.dy === 0, p.id);
      assert.equal(r.scale, 1, p.id);
      assert.equal(r.sx, 1, p.id);
      assert.equal(r.sy, 1, p.id);
      assert.ok(Math.abs(r.rot % (Math.PI * 2)) < 1e-9, p.id);
      assert.equal(r.alpha, 1, p.id);
    }
  });
  it("starts entrances visibly offset or transparent", () => {
    for (const p of TEXT_ANIMS.filter((a) => a.mode === "enter" && a.id !== "ta-basic" && a.id !== "ta-news")) {
      const r = p.compute(0, 0.12, BOX, STAGE, 12); // t=0.12 catches flash mid-blink
      const moved = r.dx !== 0 || r.dy !== 0 || r.scale !== 1 || r.sx !== 1 || r.rot !== 0;
      assert.ok(moved || r.alpha < 1 || r.clip, `${p.id} has no entrance`);
    }
  });
  it("reveals typewriter text monotonically with a blinking cursor", () => {
    const tw = animById("ta-typewriter");
    assert.equal(tw.compute(0, 0, BOX, STAGE, 10).chars, 0);
    assert.equal(tw.compute(1, 0, BOX, STAGE, 10).chars, 10);
    assert.equal(tw.compute(0.45, 0, BOX, STAGE, 10).chars, 4);
    assert.equal(typeof tw.compute(0.5, 1, BOX, STAGE, 10).cursor, "boolean");
  });
  it("travels span presets across the stage", () => {
    const tick = animById("ta-ticker");
    assert.ok(tick.compute(0, 0, BOX, STAGE).dx > tick.compute(1, 0, BOX, STAGE).dx);
    const up = animById("ta-scroll-up");
    assert.ok(up.compute(0, 0, BOX, STAGE).dy > up.compute(1, 0, BOX, STAGE).dy);
    const down = animById("ta-scroll-down");
    assert.ok(down.compute(0, 0, BOX, STAGE).dy < down.compute(1, 0, BOX, STAGE).dy);
  });
});

describe("text defaults", () => {
  it("seeds sensible per-kind state", () => {
    assert.equal(makeText("title").content, "My Movie");
    assert.equal(makeText("caption").content, "");
    assert.equal(makeText("caption").y, 0.85);
    assert.ok(makeText("credits").content.includes("\n"));
    assert.equal(makeText("title").anim, "ta-basic");
  });
  it("builds font strings with style flags", () => {
    const t = makeText("title");
    assert.ok(fontOf(t).includes("48px"));
    t.bold = true;
    t.italic = true;
    assert.ok(fontOf(t).startsWith("italic bold"));
  });
});
