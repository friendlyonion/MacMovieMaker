// Regression test for the M4 black-preview bug: every <video> element whose
// frames reach the canvas compositor must load with CORS enabled, otherwise
// pixel readback (getImageData) throws and effects render black. Tauri's
// asset protocol sends Access-Control-Allow-Origin, so
// crossorigin="anonymous" keeps canvas pixels readable.
// Runs with node's built-in runner, no dependencies:  npm test
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(path.join(root, "index.html"), "utf8");

describe("canvas media sources", () => {
  it("marks every monitor video element for CORS", () => {
    const tags = [...html.matchAll(/<video\b[^>]*>/g)].map((m) => m[0]);
    assert.ok(tags.length >= 4, `expected player decks, found ${tags.length}`);
    for (const tag of tags) {
      assert.ok(/crossorigin="anonymous"/.test(tag), `missing crossorigin: ${tag}`);
    }
  });
});
