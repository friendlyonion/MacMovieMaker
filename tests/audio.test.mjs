// Maintained M5 tests: audio envelopes, emphasis, span fitting, MIME maps.
// Runs with node's built-in runner, no dependencies:  npm test
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FADE_SECONDS,
  DUCK_LEVEL,
  fadeEnvelope,
  emphasisFactor,
  scaleSpans,
  mimeForExt,
  extForMime,
  narrationFileName,
  audioLaneFraction,
} from "../src/audio.js";

describe("fade envelopes", () => {
  it("ramps linearly in and out", () => {
    assert.equal(fadeEnvelope("fast", "none", 0, 10), 0);
    assert.equal(fadeEnvelope("fast", "none", FADE_SECONDS.fast / 2, 10), 0.5);
    assert.equal(fadeEnvelope("fast", "none", 5, 10), 1);
    assert.equal(fadeEnvelope("none", "medium", 10, 10), 0);
    assert.equal(fadeEnvelope("none", "medium", 10 - FADE_SECONDS.medium / 2, 10), 0.5);
  });
  it("stays at full gain when fades are off", () => {
    assert.equal(fadeEnvelope("none", "none", 0, 10), 1);
    assert.equal(fadeEnvelope("none", "none", 9.9, 10), 1);
  });
  it("clamps fades into short spans", () => {
    assert.equal(fadeEnvelope("slow", "none", 0.5, 1), 0.5); // 3s fade in a 1s span
    assert.equal(fadeEnvelope("none", "slow", 0.5, 1), 0.5);
  });
  it("returns silence for empty spans", () => {
    assert.equal(fadeEnvelope("fast", "fast", 0, 0), 0);
  });
});

describe("emphasis ducking", () => {
  it("passes everything at unity with no emphasis", () => {
    for (const kind of ["music", "narration", "video"]) {
      assert.equal(emphasisFactor("none", kind), 1);
      assert.equal(emphasisFactor(undefined, kind), 1);
    }
  });
  it("ducks every track except the emphasized one", () => {
    assert.equal(emphasisFactor("music", "music"), 1);
    assert.equal(emphasisFactor("music", "narration"), DUCK_LEVEL);
    assert.equal(emphasisFactor("music", "video"), DUCK_LEVEL);
    assert.equal(emphasisFactor("narration", "video"), DUCK_LEVEL);
    assert.ok(DUCK_LEVEL > 0 && DUCK_LEVEL < 1);
  });
});

describe("span fitting (Fit to music)", () => {
  it("scales spans to hit the target exactly", () => {
    const out = scaleSpans([7, 7, 7], 30);
    assert.equal(out.length, 3);
    assert.ok(Math.abs(out.reduce((a, k) => a + k, 0) - 30) < 1e-9);
    assert.ok(out.every((k) => k >= 0.5));
  });
  it("shrinks as well as grows", () => {
    const out = scaleSpans([10, 10], 8);
    assert.deepEqual(out.map((k) => Math.round(k * 100) / 100), [4, 4]);
  });
  it("refuses infeasible targets", () => {
    assert.equal(scaleSpans([1, 1], 0.5), null);
    assert.equal(scaleSpans([], 10), null);
  });
});

describe("MIME maps and filenames", () => {
  it("maps common audio extensions", () => {
    assert.equal(mimeForExt("mp3"), "audio/mpeg");
    assert.equal(mimeForExt("M4A"), "audio/mp4");
    assert.equal(mimeForExt("wav"), "audio/wav");
    assert.equal(mimeForExt("unknown"), "audio/mpeg");
  });
  it("derives extensions from recorder MIME types", () => {
    assert.equal(extForMime("audio/mp4"), "m4a");
    assert.equal(extForMime("audio/webm;codecs=opus"), "webm");
    assert.equal(extForMime(""), "m4a");
  });
  it("stamps narration filenames with date and time", () => {
    const name = narrationFileName(new Date(2026, 9, 9, 14, 30, 22), "audio/mp4");
    assert.equal(name, "narration-20261009-143022.m4a");
  });
});

describe("audio lane playhead", () => {
  it("maps project time onto 0..1, clamped", () => {
    assert.equal(audioLaneFraction(0, 100), 0);
    assert.equal(audioLaneFraction(25, 100), 0.25);
    assert.equal(audioLaneFraction(100, 100), 1);
    assert.equal(audioLaneFraction(150, 100), 1);
    assert.equal(audioLaneFraction(-5, 100), 0);
  });
  it("parks at zero when the project has no length", () => {
    assert.equal(audioLaneFraction(0, 0), 0);
    assert.equal(audioLaneFraction(5, 0), 0);
  });
});
