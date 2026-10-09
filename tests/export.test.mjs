// Maintained M6 tests: save presets, custom settings, and the ffmpeg
// export-plan builder (golden graph checks against fixture projects).
// Runs with node's built-in runner, no dependencies:  npm test
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SAVE_PRESETS,
  SHARE_SERVICES,
  XFADE_OF,
  MASK_KIND,
  buildExportPlan,
  estimateMBPerMin,
  loadCustomPresets,
  saveCustomPreset,
  maskExpr,
  parseBitrate,
  pzChain,
  resolvePreset,
} from "../src/export.js";
import { TRANSITIONS } from "../src/gallery.js";
import { createClip } from "../src/clipops.js";
import { DEFAULT_FX } from "../src/effects.js";

const PRESET = { w: 1280, h: 720, fps: 30, vbr: "8M", abr: "128k" };

function videoClip(over = {}) {
  return {
    ...createClip({ id: 1, name: "a.mp4", kind: "video", url: "", duration: 10 }),
    in: 1,
    out: 4,
    volume: 0.5,
    fx: { ...DEFAULT_FX(), effect: "sepia" },
    ...over,
  };
}

function photoClip(over = {}) {
  return {
    ...createClip({ id: 2, name: "b.png", kind: "image", url: "", duration: 7 }),
    panZoom: "pz-pan-r",
    transition: { id: "dissolve", duration: 1 },
    caption: {
      content: "Hello", x: 0.5, y: 0.85, offset: 0, dur: 3,
      fontFamily: "system", fontSize: 48, color: "#ffffff", opacity: 1,
      bold: false, italic: false, align: "center", anim: "basic",
    },
    ...over,
  };
}

const RESOLVED = {
  clipInput: new Map([
    [1, { kind: "file", path: "/media/a.mp4" }],
    [2, { kind: "file", path: "/media/b.png" }],
  ]),
  audioInput: new Map([
    [11, "/media/music.mp3"],
    [12, "/media/narr.m4a"],
  ]),
  captionSeq: new Map([[2, { pattern: "/tmp/cap_%04d.png", start: 2, dur: 3 }]]),
  hasAudio: new Map([[1, true]]),
};

const MUSIC = {
  id: 11, kind: "music", name: "music.mp3", url: "", offset: 0,
  in: 0, out: 8, duration: 120, volume: 0.8, fadeIn: "medium", fadeOut: "none",
};
const NARR = {
  id: 12, kind: "narration", name: "narr.m4a", url: "", offset: 2,
  in: 0, out: 5, duration: 5, volume: 1, fadeIn: "none", fadeOut: "fast",
};

function plan(over = {}) {
  return buildExportPlan({
    clips: [videoClip(), photoClip()],
    audioClips: [MUSIC, NARR],
    emphasis: "narration",
    preset: PRESET,
    total: 9,
    resolved: RESOLVED,
    ...over,
  });
}

describe("save presets", () => {
  it("ships the SPEC §12 list with groups", () => {
    assert.equal(SAVE_PRESETS.length, 11);
    assert.equal(SAVE_PRESETS[0].id, "recommended");
    const names = SAVE_PRESETS.map((p) => p.name);
    for (const n of ["For high-definition display", "For computer", "For email", "Apple iPhone"]) {
      assert.ok(names.includes(n), n);
    }
  });
  it("adapts Recommended to the project aspect", () => {
    assert.deepEqual([resolvePreset(SAVE_PRESETS[0], "16:9").w, resolvePreset(SAVE_PRESETS[0], "16:9").h], [1920, 1080]);
    assert.deepEqual([resolvePreset(SAVE_PRESETS[0], "4:3").w, resolvePreset(SAVE_PRESETS[0], "4:3").h], [1440, 1080]);
    assert.equal(resolvePreset(SAVE_PRESETS[1], "4:3").w, 1920); // fixed presets ignore aspect
  });
  it("estimates MB/min near the SPEC's iPhone example (~77)", () => {
    const iphone = SAVE_PRESETS.find((p) => p.id === "iphone");
    const est = estimateMBPerMin(iphone);
    assert.ok(est > 60 && est < 95, `got ${est}`);
  });
  it("parses bitrate strings", () => {
    assert.equal(parseBitrate("12M"), 12_000_000);
    assert.equal(parseBitrate("128k"), 128_000);
    assert.equal(parseBitrate("bogus"), 0);
  });
  it("round-trips custom settings through injected storage", () => {
    const mem = new Map();
    const storage = {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, v),
    };
    assert.deepEqual(loadCustomPresets(storage), []);
    const custom = { id: "c1", name: "Mine", w: 640, h: 480, fps: 24, vbr: "2M", abr: "96k" };
    const list = saveCustomPreset(storage, custom);
    assert.equal(list.length, 1);
    assert.equal(list[0].group, "Recent settings");
    assert.deepEqual(loadCustomPresets(storage), list);
  });
  it("lists the five v1 share targets with upload URLs", () => {
    assert.deepEqual(SHARE_SERVICES.map((s) => s.id), ["youtube", "facebook", "vimeo", "flickr", "onedrive"]);
    for (const s of SHARE_SERVICES) assert.match(s.url, /^https:\/\//);
  });
});

describe("transition coverage", () => {
  it("maps every catalogued transition to xfade or a mask join", () => {
    const unmapped = TRANSITIONS.map((t) => t.id).filter(
      (id) => id !== "none" && !XFADE_OF[id] && !MASK_KIND[id]
    );
    assert.deepEqual(unmapped, []);
  });
  it("builds mask expressions without spaces (filter-script safe)", () => {
    for (const kind of ["wdiag", "diamond", "checker", "pageturn"]) {
      const e = maskExpr(kind, 1920, 1080, 30);
      assert.ok(!e.includes(" "), kind);
    }
    assert.ok(maskExpr("diamond", 1920, 1080, 30).includes("abs("));
    assert.ok(maskExpr("checker", 1920, 1080, 30).includes("mod("));
  });
});

describe("pan/zoom export", () => {
  it("letterboxes static photos with black bars (preview parity)", () => {
    const c = pzChain(null, 1280, 720, 30, 7);
    assert.ok(c.includes("force_original_aspect_ratio=decrease"));
    assert.ok(c.includes("pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black"));
    assert.ok(!c.includes("crop="));
    assert.ok(!c.includes("zoompan"));
  });
  it("maps presets to linear zoompan moves", () => {
    const c = pzChain("pz-pan-r", 1280, 720, 30, 7);
    assert.ok(c.includes("zoompan="));
    assert.ok(c.includes("s=1280x720"));
    assert.ok(c.includes("on/210")); // 7s @ 30fps
    assert.ok(c.includes("1.35")); // pan zoom level from the preset
  });
});

describe("export plan", () => {
  it("lays out inputs in leg order with trims", () => {
    const p = plan();
    assert.deepEqual(
      p.inputs.map((i) => i.path),
      ["/media/a.mp4", "/media/b.png", "/tmp/cap_%04d.png", "/media/music.mp3", "/media/narr.m4a"]
    );
    assert.ok(p.argvHead.includes("-ss") && p.argvHead.includes("1.000000"));
    assert.ok(p.argvHead.includes("-loop") && p.argvHead.includes("-t"));
  });
  it("normalizes legs and reuses the effects filter chain", () => {
    const p = plan();
    assert.ok(p.script.includes("force_original_aspect_ratio=decrease"));
    assert.ok(p.script.includes("colorchannelmixer=.393")); // sepia via buildExportFilter
    assert.ok(p.script.includes("fps=30"));
  });
  it("joins with xfade at the layout overlap", () => {
    const p = plan();
    // clip1 kept 3s, dissolve 1s -> offset 2
    assert.ok(p.script.includes("xfade=transition=fade:duration=1.000:offset=2.000000"));
    assert.equal(p.stats.joins.xfade, 1);
  });
  it("fades the first clip from black when it carries a transition", () => {
    const c1 = videoClip({ transition: { id: "dissolve", duration: 0.5 } });
    const p = plan({ clips: [c1, photoClip({ transition: null })] });
    assert.ok(p.script.includes("[blk0][leg0]xfade=transition=fade:duration=0.500:offset=0"));
  });
  it("builds alpha-mask joins for pattern transitions", () => {
    const c2 = photoClip({ transition: { id: "checker", duration: 1 } });
    const p = plan({ clips: [videoClip(), c2] });
    assert.ok(p.script.includes("alphamerge"));
    assert.ok(p.script.includes("overlay=0:0"));
    assert.ok(p.script.includes("geq=lum="));
    assert.ok(p.script.includes("concat=n=3:v=1:a=0"));
    assert.equal(p.stats.joins.custom, 1);
  });
  it("overlays captions with project-time alignment", () => {
    const p = plan();
    assert.ok(p.script.includes("format=yuva420p,setpts=PTS-STARTPTS+"));
    assert.ok(p.script.includes("overlay=0:0:enable='between(t,"));
    assert.equal(p.stats.captions, 1);
  });
  it("mixes clip audio, music, and narration with emphasis ducking", () => {
    const p = plan();
    assert.ok(p.script.includes("amix=inputs=3:duration=longest"));
    assert.ok(p.script.includes("adelay="));
    assert.ok(p.script.includes("afade=t=in:st=0:d=1.500")); // music medium fade-in
    assert.ok(p.script.includes("volume=0.125000")); // 0.5 clip vol x 0.25 narration emphasis
    assert.ok(p.maps.includes("[aout]"));
  });
  it("renders cards from sequences and missing media as placeholders", () => {
    const card = {
      ...createClip({ id: 3, name: "Title", kind: "title", url: "", duration: 7 }),
      text: { bg: "#101828", content: "Hi" },
    };
    const ghost = videoClip({ id: 4, name: "gone.mp4" });
    const resolved = {
      ...RESOLVED,
      clipInput: new Map([
        [1, { kind: "file", path: "/media/a.mp4" }],
        [3, { kind: "seq", pattern: "/tmp/card_%04d.png" }],
        [4, null],
      ]),
      captionSeq: new Map(),
      hasAudio: new Map([[1, false]]),
    };
    const p = plan({ clips: [videoClip(), card, ghost], audioClips: [], resolved, total: 20 });
    assert.ok(p.inputs.some((i) => i.path === "/tmp/card_%04d.png"));
    assert.ok(p.argvHead.includes("/tmp/card_%04d.png"));
    assert.ok(p.script.includes("color=c=0x141416"));
    assert.equal(p.stats.cards, 1);
    assert.ok(p.warnings.some((w) => w.includes("gone.mp4")));
    assert.ok(!p.maps.includes("[aout]")); // silent project: video-only
  });
  it("emits encode args with codecs, tail trim, and progress", () => {
    const p = plan();
    const tail = [...p.maps, ...p.outArgs].join(" ");
    assert.ok(tail.includes("-c:v libx264") && tail.includes("-b:v 8M"));
    assert.ok(tail.includes("-c:a aac") && tail.includes("-b:a 128k"));
    assert.ok(tail.includes("-t 9"));
    assert.ok(tail.includes("-progress pipe:2"));
    assert.equal(p.totalUs, 9_000_000);
  });
  it("throws on an empty storyboard", () => {
    assert.throws(() => plan({ clips: [] }), /Nothing to export/);
  });
});
