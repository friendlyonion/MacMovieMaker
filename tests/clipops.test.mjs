// Maintained M2 regression tests: trim / split / delete / rotate / undo.
// Runs with node's built-in runner, no dependencies:  npm test
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  moveClipIn,
  insertionGap,
  reorderChanged,
  PHOTO_DURATION,
  createClip,
  keptDuration,
  setInPoint,
  setOutPoint,
  splitPointValid,
  splitClip,
  deleteClip,
  rotateClip,
  History,
  computeLayout,
  locAtT,
} from "../src/clipops.js";

const vid = (over = {}) =>
  createClip({ id: 1, name: "a.mp4", kind: "video", url: "asset://x", duration: 10, ...over });

describe("storyboard pointer reorder", () => {
  const row = [
    { id: 1, left: 0, right: 100, top: 0, bottom: 80 },
    { id: 2, left: 112, right: 212, top: 0, bottom: 80 },
    { id: 3, left: 224, right: 324, top: 0, bottom: 80 },
  ];
  it("hits the gap left/right of each chip's midpoint", () => {
    assert.deepEqual(insertionGap(row, 10, 40), { id: 1, before: true });
    assert.deepEqual(insertionGap(row, 90, 40), { id: 2, before: true });
    assert.deepEqual(insertionGap(row, 200, 40), { id: 3, before: true });
    assert.deepEqual(insertionGap(row, 320, 40), { id: 3, before: false });
  });
  it("prefers the pointer's row and clamps above/below", () => {
    const two = [...row, { id: 4, left: 0, right: 100, top: 92, bottom: 172 }];
    assert.deepEqual(insertionGap(two, 500, 130), { id: 4, before: false });
    assert.deepEqual(insertionGap(two, 10, -50), { id: 1, before: true });
    assert.deepEqual(insertionGap(two, 10, 500), { id: 4, before: false });
  });
  it("returns null with no chips", () => {
    assert.equal(insertionGap([], 0, 0), null);
  });
  it("detects real moves and adjacent no-ops", () => {
    assert.equal(reorderChanged([1, 2, 3], 1, 3, false), true);
    assert.equal(reorderChanged([1, 2, 3], 3, 1, true), true);
    assert.equal(reorderChanged([1, 2, 3], 2, 2, true), false);
    assert.equal(reorderChanged([1, 2, 3], 1, 2, true), false); // before immediate successor
    assert.equal(reorderChanged([1, 2, 3], 2, 1, false), false); // after immediate predecessor
    assert.equal(reorderChanged([1, 2, 3], 9, 1, true), false); // unknown id
  });
});

describe("trim (non-destructive hide, not delete)", () => {
  it("keeps the full range by default", () => {
    const c = vid();
    assert.equal(c.in, 0);
    assert.equal(c.out, 10);
    assert.equal(keptDuration(c), 10);
  });
  it("I/O points narrow the kept range without touching duration", () => {
    const c = vid();
    setInPoint(c, 2.5);
    setOutPoint(c, 7.5);
    assert.equal(keptDuration(c), 5);
    assert.equal(c.duration, 10); // hidden footage still there
  });
  it("clamps the start point inside [0, out - min]", () => {
    const c = vid();
    setOutPoint(c, 4);
    assert.equal(setInPoint(c, 9), 3.9);
    assert.equal(setInPoint(c, -2), 0);
  });
  it("clamps the end point inside [in + min, duration]", () => {
    const c = vid();
    setInPoint(c, 3);
    assert.equal(setOutPoint(c, 1), 3.1);
    assert.equal(setOutPoint(c, 99), 10);
  });
  it("restores footage when points move back out", () => {
    const c = vid();
    setInPoint(c, 5);
    setOutPoint(c, 6);
    setInPoint(c, 0);
    setOutPoint(c, 10);
    assert.equal(keptDuration(c), 10);
  });
  it("photos trim within their default duration", () => {
    const c = createClip({ id: 2, name: "p.png", kind: "image", url: "u", duration: PHOTO_DURATION });
    setInPoint(c, 1);
    setOutPoint(c, 6);
    assert.equal(keptDuration(c), 5);
  });
});

describe("split", () => {
  it("rejects boundary and outside points", () => {
    const c = vid();
    assert.equal(splitPointValid(c, 0), false);
    assert.equal(splitPointValid(c, 10), false);
    assert.equal(splitPointValid(c, -1), false);
    assert.equal(splitPointValid(c, 11), false);
    assert.equal(splitClip(c, 0, 2), null);
  });
  it("cuts an interior point into two independently trimmable halves", () => {
    const c = vid();
    const [a, b] = splitClip(c, 4, 2);
    assert.equal(a.id, 1);
    assert.equal(b.id, 2);
    assert.deepEqual([a.in, a.out], [0, 4]);
    assert.deepEqual([b.in, b.out], [4, 10]);
    setOutPoint(a, 2);
    setInPoint(b, 9);
    assert.equal(keptDuration(a), 2);
    assert.equal(keptDuration(b), 1);
  });
  it("carries rotation/volume/mute to both halves", () => {
    const c = vid();
    rotateClip(c, 90);
    c.volume = 0.5;
    c.muted = true;
    const [a, b] = splitClip(c, 5, 2);
    for (const h of [a, b]) {
      assert.equal(h.rotation, 90);
      assert.equal(h.volume, 0.5);
      assert.equal(h.muted, true);
    }
  });
});

describe("delete", () => {
  const three = () => [vid({ id: 1 }), vid({ id: 2 }), vid({ id: 3 })];
  it("selects the next clip when deleting from the middle", () => {
    const { clips, selectId } = deleteClip(three(), 2);
    assert.deepEqual(clips.map((c) => c.id), [1, 3]);
    assert.equal(selectId, 3);
  });
  it("selects the previous clip when deleting the last one", () => {
    const { clips, selectId } = deleteClip(three(), 3);
    assert.deepEqual(clips.map((c) => c.id), [1, 2]);
    assert.equal(selectId, 2);
  });
  it("selects nothing when deleting the only clip", () => {
    const { clips, selectId } = deleteClip([vid({ id: 7 })], 7);
    assert.deepEqual(clips, []);
    assert.equal(selectId, null);
  });
  it("leaves state untouched for an unknown id", () => {
    const before = three();
    const { clips, selectId } = deleteClip(before, 99);
    assert.equal(clips, before);
    assert.equal(selectId, null);
  });
});

describe("rotate", () => {
  it("steps through 0/90/180/270 and wraps", () => {
    const c = vid();
    assert.equal(rotateClip(c, 90), 90);
    assert.equal(rotateClip(c, 90), 180);
    assert.equal(rotateClip(c, 180), 0);
    assert.equal(rotateClip(c, -90), 270);
  });
});

describe("history", () => {
  const snap = (n) => ({ clips: [{ id: n }], selectedId: n });
  it("undoes then redoes a mutation", () => {
    const h = new History();
    h.push(snap(1));
    assert.equal(h.canUndo, true);
    assert.deepEqual(h.undo(snap(2)), snap(1));
    assert.equal(h.canRedo, true);
    assert.deepEqual(h.redo(snap(1)), snap(2));
    assert.equal(h.canRedo, false);
  });
  it("clears redo on a new action", () => {
    const h = new History();
    h.push(snap(1));
    h.undo(snap(2));
    h.push(snap(1));
    assert.equal(h.canRedo, false);
  });
  it("returns null when the stack is empty", () => {
    const h = new History();
    assert.equal(h.undo(snap(1)), null);
    assert.equal(h.redo(snap(1)), null);
  });
  it("snapshots are detached from later mutation", () => {
    const h = new History();
    const s = snap(1);
    h.push(s);
    s.clips[0].id = 999;
    assert.deepEqual(h.undo(snap(2)), snap(1));
  });
  it("enforces the depth limit", () => {
    const h = new History(3);
    for (let i = 0; i < 5; i++) h.push(snap(i));
    assert.equal(h.past.length, 3);
    assert.deepEqual(h.undo(snap(9)).clips[0].id, 4);
  });
});

describe("sequence layout (overlapping transitions)", () => {
  const seq = () => {
    const a = vid({ id: 1 });
    const b = vid({ id: 2 });
    b.transition = { id: "dissolve", duration: 1 };
    return [a, b];
  };
  const byId = (clips) => new Map(clips.map((c) => [c.id, clips.find((x) => x.id === c.id)]));
  it("lays clips end to end with no transitions", () => {
    const clips = [vid({ id: 1 }), vid({ id: 2 })];
    const lay = computeLayout(clips);
    assert.equal(lay.total, 20);
    assert.equal(lay.segments[0].x, null);
    assert.equal(lay.segments[1].x, null);
    assert.deepEqual([lay.segments[1].start, lay.segments[1].end], [10, 20]);
  });
  it("overlaps the transition and shortens the project", () => {
    const lay = computeLayout(seq());
    assert.equal(lay.total, 19); // 10 + 10 - 1 overlap
    const x = lay.segments[1].x;
    assert.deepEqual([x.start, x.end, x.dur, x.fromId], [9, 10, 1, 1]);
  });
  it("blends the first clip up from black at no time cost", () => {
    const clips = seq();
    clips[0].transition = { id: "fade-black", duration: 2 };
    const lay = computeLayout(clips);
    assert.equal(lay.total, 19);
    assert.deepEqual([lay.segments[0].x.start, lay.segments[0].x.fromId], [0, null]);
  });
  it("clamps the overlap to the shortest kept range", () => {
    const clips = seq();
    setOutPoint(clips[1], 0.5); // kept 0.5
    const lay = computeLayout(clips);
    assert.equal(lay.segments[1].x.dur, 0.5);
    assert.equal(lay.total, 10 + 0.5 - 0.5);
  });
  it("maps project time to bodies and overlaps", () => {
    const clips = seq();
    const lay = computeLayout(clips);
    const m = byId(clips);
    assert.deepEqual(locAtT(lay, m, 0), { type: "body", i: 0, local: 0 });
    const x = locAtT(lay, m, 9.5);
    assert.equal(x.type, "x");
    assert.equal(x.i, 1);
    assert.equal(x.p, 0.5);
    assert.equal(x.localB, 0.5); // head of clip 2
    assert.equal(x.localA, 9.5); // tail of clip 1
    assert.deepEqual(locAtT(lay, m, 12), { type: "body", i: 1, local: 3 });
    assert.deepEqual(locAtT(lay, m, 999).local, 10); // clamped to project end
  });
  it("honors trim points in the mapping", () => {
    const clips = seq();
    setInPoint(clips[0], 4);
    const lay = computeLayout(clips);
    assert.equal(lay.total, 6 + 10 - 1);
    const m = byId(clips);
    assert.deepEqual(locAtT(lay, m, 0), { type: "body", i: 0, local: 4 });
  });
});

describe("storyboard reorder", () => {
  const ids = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
  it("moves clips before/after the target", () => {
    const l = ids(3);
    assert.equal(moveClipIn(l, 1, 3, true), true);
    assert.deepEqual(l.map((c) => c.id), [2, 1, 3]);
    assert.equal(moveClipIn(l, 2, 3, false), true);
    assert.deepEqual(l.map((c) => c.id), [1, 3, 2]);
  });
  it("no-ops on self, missing, or unknown ids", () => {
    const l = ids(3);
    assert.equal(moveClipIn(l, 2, 2, true), false);
    assert.equal(moveClipIn(l, 9, 1, true), false);
    assert.equal(moveClipIn(l, 1, 9, false), false);
    assert.deepEqual(l.map((c) => c.id), [1, 2, 3]);
  });
});
