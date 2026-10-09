// Maintained M6 tests: .mmproj project save format — round-trip fidelity,
// validation warnings, and rejection of foreign/corrupt files.
// Runs with node's built-in runner, no dependencies:  npm test
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  serializeProject,
  deserializeProject,
} from "../src/project.js";
import { createClip } from "../src/clipops.js";
import { DEFAULT_FX } from "../src/effects.js";

function fullState() {
  const v = {
    ...createClip({ id: 1, name: "a.mp4", kind: "video", url: "asset://x", duration: 10 }),
    file: "/media/a.mp4",
    in: 1,
    out: 4,
    rotation: 90,
    volume: 0.5,
    muted: true,
    transition: { id: "dissolve", duration: 1.5 },
    fx: { ...DEFAULT_FX(), effect: "sepia", brightness: 0.2, fadeIn: "black", fadeOut: "none" },
    caption: {
      content: "Hi", x: 0.5, y: 0.8, offset: 0, dur: 3, fontFamily: "system",
      fontSize: 48, color: "#fff", opacity: 1, bold: true, italic: false,
      align: "center", bg: "#000", anim: "ta-basic",
    },
    thumb: "data:image/jpeg;base64,AAA",
    playable: true,
  };
  const img = {
    ...createClip({ id: 2, name: "b.png", kind: "image", url: "asset://y", duration: 7 }),
    file: "/media/b.png",
    panZoom: "pz-pan-r",
    thumb: null,
    playable: true,
  };
  const snap = {
    ...createClip({ id: 3, name: "Snapshot 1", kind: "image", url: "data:image/png;base64,BBB", duration: 7 }),
    file: "",
    playable: true,
  };
  return {
    aspect: "4:3",
    emphasis: "music",
    clips: [v, img, snap],
    audioClips: [
      {
        id: 11, kind: "music", name: "m.mp3", file: "/media/m.mp3", url: "asset://z",
        offset: 2, in: 1, out: 9, duration: 120, volume: 0.8,
        fadeIn: "medium", fadeOut: "fast", peaks: [0.1, 0.5, 0.9],
      },
    ],
    nextId: 4,
    nextAudioId: 12,
    selectedId: 2,
    selectedAudioId: null,
  };
}

describe("project round-trip", () => {
  it("serializes the persistent state with format markers", () => {
    const doc = serializeProject(fullState());
    assert.equal(doc.app, "MacMovieMaker");
    assert.equal(doc.format, PROJECT_FORMAT);
    assert.equal(doc.version, PROJECT_VERSION);
    assert.equal(doc.clips.length, 3);
    assert.equal(doc.clips[0].transition.id, "dissolve");
  });
  it("keeps data-URLs but drops session blob/asset URLs", () => {
    const doc = serializeProject(fullState());
    assert.equal(doc.clips[0].url, ""); // asset:// dies with the session
    assert.equal(doc.clips[0].file, "/media/a.mp4");
    assert.ok(doc.clips[2].url.startsWith("data:")); // snapshots persist
    assert.equal(doc.audioClips[0].url, "");
  });
  it("round-trips through JSON without loss or warnings", () => {
    const doc = JSON.parse(JSON.stringify(serializeProject(fullState())));
    const { state, warnings } = deserializeProject(doc);
    assert.deepEqual(warnings, []);
    assert.equal(state.aspect, "4:3");
    assert.equal(state.emphasis, "music");
    assert.equal(state.clips.length, 3);
    assert.equal(state.clips[0].rotation, 90);
    assert.equal(state.clips[0].fx.effect, "sepia");
    assert.equal(state.clips[0].caption.content, "Hi");
    assert.equal(state.clips[1].panZoom, "pz-pan-r");
    assert.equal(state.clips[2].url.slice(0, 15), "data:image/png;");
    assert.equal(state.audioClips[0].peaks.length, 3);
    assert.equal(state.selectedId, 2);
    assert.equal(state.nextId, 4);
    assert.equal(state.nextAudioId, 12);
  });
});

describe("project validation", () => {
  it("rejects foreign and corrupt files", () => {
    assert.throws(() => deserializeProject(null), /isn't a project/);
    assert.throws(() => deserializeProject({ app: "X" }), /isn't a MacMovieMaker/);
    assert.throws(
      () => deserializeProject({ app: "MacMovieMaker", format: PROJECT_FORMAT, version: 99 }),
      /newer MacMovieMaker/
    );
  });
  it("sanitizes bad values with warnings instead of failing", () => {
    const doc = serializeProject(fullState());
    doc.clips[0].transition = { id: "nope", duration: 99 };
    doc.clips[0].fx.effect = "nope";
    doc.clips[0].rotation = 45;
    doc.clips[0].volume = 9;
    doc.clips[1].panZoom = "nope";
    doc.clips.push({ id: 9, name: "weird", kind: "hologram" });
    doc.audioClips[0].fadeIn = "nope";
    doc.emphasis = "nope";
    const { state, warnings } = deserializeProject(doc);
    assert.equal(state.clips[0].transition, null);
    assert.equal(state.clips[0].fx.effect, "none");
    assert.equal(state.clips[0].rotation, 0);
    assert.equal(state.clips[0].volume, 1);
    assert.equal(state.clips[1].panZoom, null);
    assert.equal(state.clips.length, 3); // hologram dropped
    assert.equal(state.audioClips[0].fadeIn, "none");
    assert.equal(state.emphasis, "none");
    // Dropped features warn; plain range clamps (rotation, volume, fades) stay silent.
    assert.equal(warnings.length, 4);
    for (const needle of ["unknown transition", "unknown effect", "unknown pan/zoom", "unknown clip kind"]) {
      assert.ok(warnings.some((w) => w.includes(needle)), needle);
    }
  });
  it("repairs broken trim ranges and id counters", () => {
    const doc = serializeProject(fullState());
    doc.clips[0].in = 9;
    doc.clips[0].out = 2;
    doc.nextId = 2; // stale: below the max clip id
    doc.selectedId = 999; // dangling selection
    const { state, warnings } = deserializeProject(doc);
    assert.equal(state.clips[0].in, 0);
    assert.equal(state.clips[0].out, 10);
    assert.ok(state.nextId >= 4);
    assert.equal(state.selectedId, null);
    assert.ok(warnings.length >= 1);
  });
});
