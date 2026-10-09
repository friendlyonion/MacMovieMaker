// Maintained wiring audit: catches "partial patch" breakage where main.js
// references element ids, module exports, or functions that don't exist —
// any of which throws during init and leaves every button dead.
// Runs with node's built-in runner, no dependencies:  npm test
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const main = readFileSync(path.join(root, "src/main.js"), "utf8");
const html = readFileSync(path.join(root, "index.html"), "utf8");

describe("element wiring", () => {
  it("every els id exists in index.html", () => {
    const block = main.match(/for \(const id of \[([\s\S]*?)\]\) \{/)?.[1] ?? "";
    const ids = [...new Set([...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]))];
    assert.ok(ids.length > 50, "expected dozens of element lookups");
    assert.deepEqual(ids.filter((id) => !html.includes(`id="${id}"`)), []);
  });
  it("every els.* use is backed by a looked-up id", () => {
    const block = main.match(/for \(const id of \[([\s\S]*?)\]\) \{/)?.[1] ?? "";
    const ids = new Set([...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
    const used = [...new Set([...main.matchAll(/\bels\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))];
    assert.deepEqual(used.filter((id) => !ids.has(id)), []);
  });
});

describe("storyboard styles", () => {
  it("clips names for ellipsis (block box) and resets native button chrome", () => {
    const css = readFileSync(path.join(root, "src/styles.css"), "utf8");
    const nameRule = css.match(/\.clip-name\s*\{([^}]*)\}/)?.[1] ?? "";
    for (const prop of ["display: block", "white-space: nowrap", "overflow: hidden", "text-overflow: ellipsis"]) {
      assert.ok(nameRule.includes(prop), prop);
    }
    const clipRule = css.match(/\.clip\s*\{([^}]*)\}/)?.[1] ?? "";
    assert.ok(clipRule.includes("appearance: none"), "appearance reset");
  });
  it("gives film/thumb deterministic block boxes so pills cannot escape", () => {
    const css = readFileSync(path.join(root, "src/styles.css"), "utf8");
    const filmRule = css.match(/\.film\s*\{([^}]*)\}/)?.[1] ?? "";
    const thumbRule = css.match(/\.thumb\s*\{([^}]*)\}/)?.[1] ?? "";
    assert.ok(filmRule.includes("display: block"), "film block box");
    assert.ok(thumbRule.includes("display: block"), "thumb block box");
    assert.ok(thumbRule.includes("overflow: hidden"), "thumb clips pills");
  });
  it("keeps the playhead line click-transparent and dims the drag source", () => {
    const css = readFileSync(path.join(root, "src/styles.css"), "utf8");
    const lineRule = css.match(/\.playhead-line\s*\{([^}]*)\}/)?.[1] ?? "";
    assert.ok(lineRule.includes("pointer-events: none"), "playhead never swallows pointer input");
    assert.ok(/\.clip\.drag-src\s*\{[^}]*opacity/.test(css), "drag source dims");
  });
  it("reorders the strip with pointer dragging, not HTML5 DnD", () => {
    assert.ok(main.includes("beginStripDrag"), "pointer drag entry");
    assert.ok(main.includes("insertionGap(stripChipRects()"), "gap hit test wired");
    assert.ok(!main.includes("stripDragId"), "dead DnD flag removed");
  });
});

describe("module imports", () => {
  it("every relative import resolves and exports the named bindings", () => {
    const problems = [];
    for (const m of main.matchAll(/import\s*\{([^}]+)\}\s*from\s*"(\.[^"]+)"/g)) {
      const names = m[1]
        .split(",")
        .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
        .filter(Boolean);
      const file = path.join(root, "src", m[2]);
      if (!existsSync(file)) {
        problems.push(`${m[2]}: file missing`);
        continue;
      }
      const src = readFileSync(file, "utf8");
      const exported = new Set([
        ...[...src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)].map((x) => x[1]),
        ...[...src.matchAll(/export\s*\{([^}]+)\}/g)].flatMap((x) =>
          x[1].split(",").map((s) => s.trim().split(/\s+as\s+/).pop().trim())
        ),
      ]);
      for (const n of names) {
        if (!exported.has(n)) problems.push(`${m[2]}: missing export ${n}`);
      }
    }
    assert.deepEqual(problems, []);
  });
});

describe("init surface", () => {
  // Entry points invoked during startup or from ribbon controls. If any is
  // missing, init throws partway and no button works.
  const SURFACE = [
    "initAudio",
    "refreshProjectPanel",
    "renderAudioLane",
    "paintAudioBar",
    "selectAudio",
    "selectedAudio",
    "projectTotal",
    "driveAudio",
    "ensureAudioEl",
    "syncAudioElements",
    "audioEnd",
    "addMusicFiles",
    "addMusicFlow",
    "pickMusicFile",
    "probeAudioClip",
    "decodePeaks",
    "beginAudioDrag",
    "setAudioProp",
    "updateMusicTab",
    "refreshMusicPanel",
    "updateRecordTab",
    "openRecordTab",
    "closeRecordTab",
    "narrRecord",
    "narrMeterTick",
    "narrStop",
    "saveNarrationFile",
    "applyAspect",
    "setAspect",
    "setEmphasis",
    "fitToMusic",
    "makeTextClip",
    "applyTheme",
    "takeSnapshot",
    "wireM5Controls",
    "updatePlayheads",
    "beginAudioTrim",
    "startAudioGesture",
    "endAudioGesture",
    "exportMovieFlow",
    "shareFlow",
    "saveProject",
    "openProject",
    "newProject",
    "applyLoadedState",
    "prerenderTextFrames",
    "resolveExportInputs",
    "refreshSaveMenus",
    "wireM6Controls",
    "markDirty",
    "updateTitle",
    "moveClip",
    "clearStripDropMarks",
    "toggleXray",
  ];
  it("every audio/automovie entry point is defined in main.js", () => {
    const defined = new Set([
      ...[...main.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]),
      ...[...main.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1]),
    ]);
    assert.deepEqual(SURFACE.filter((n) => !defined.has(n)), []);
  });
});
