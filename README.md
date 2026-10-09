# MacMovieMaker

A macOS desktop video editor in the spirit of Windows Movie Maker 2012:
ribbon tabs, a preview monitor, a storyboard strip, and one-click export.
Built with Tauri (Rust + web frontend); FFmpeg does all video work.

- [Screenshots](#screenshots)
- [Features](#features)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Install](#install)
- [Build from source](#build-from-source)
- [Make your first movie](#make-your-first-movie)
- [Project files](#project-files)
- [Export](#export)
- [Tech](#tech)
- [Development](#development)
- [Releases](#releases)
- [Troubleshooting](#troubleshooting)
- [Background](#background)
- [License](#license)

## Screenshots
<img width="1369" height="795" alt="Screenshot 2026-10-09 at 1 10 27 PM" src="https://github.com/user-attachments/assets/f4a32e41-eeef-4e5b-8b62-fbfbc2fa8758" />

### Capturing them (macOS)

The files above don't exist yet — capture them once and the README goes live.
For each shot: set up the state described, press Cmd+Shift+4, then Space,
click the app window, and move the capture into `docs/shots/` with the exact
name below.

1. `main-window.png` — Home tab, 4–6 clips on the storyboard, music on the
   lane, preview parked mid-clip. Full window.
2. `animations.png` — Animations tab open, transitions gallery visible, one
   clip showing the gray transition triangle at its start.
3. `effects.png` — Visual Effects tab open, an effect (e.g. Sepia) applied so
   the monitor shows the graded frame.
4. `audio.png` — storyboard with the green music bar plus one narration take;
   select the music clip so the Music Tools tab is visible.
5. `export-dialog.png` — Save movie menu open, preset list fully visible.

## Features

- **Home** — add videos/photos, rotate, titles/captions/credits, music,
  narration, AutoMovie themes, snapshot, Save movie, share.
- **Import & storyboard** — drag files from Finder; thumbnails, drag-to-reorder
  with insertion indicator, click-to-preview, scrub bar, time readout.
- **Clip editing** — non-destructive trim (I/O keys, trim dialog), split (M),
  delete, 90° rotate, J/K/L shuttle, full undo stack.
- **Animations** — transitions gallery with hover preview, per-clip indicator,
  0.25–2 s duration, None, apply-to-all; Ken Burns pan/zoom presets for photos.
- **Visual Effects** — effects gallery with hover preview, brightness slider,
  fade in/out from black or white; preview and export share one filter chain.
- **Text** — standalone title cards (7 s default), caption overlays with
  storyboard caption bars, auto-scrolling credits; Format tab with font, size,
  color, duration, and animation presets; text drags on the monitor.
- **Audio** — one music track (a newcomer replaces the old take) with volume,
  fades, draggable/retrimmable lane bar; unlimited narration takes recorded
  from the Record tab and saved to a Narration folder; Emphasize ducking
  (music / narration / video); Fit to music stretches photos to the song.
- **AutoMovie** — 7 themes (Default, Sepia, Black and White, Pan and Zoom,
  Fade, Cinematic, Contemporary) that stamp transitions, effects, pan/zoom,
  and titles across the project, with optional music.
- **Project & View** — Emphasize mix options, Fit to music, project settings;
  storyboard zoom.
- **File** — New/Open/Save/Save As, recents with autosave recovery,
  save-movie presets, custom settings, share.

## Keyboard shortcuts

| Keys | Action |
| ---- | ------ |
| Space | Play / pause |
| I / O | Set clip start / end point at the playhead |
| M | Split clip at the playhead |
| Del | Remove selected clip / audio |
| J / K / L | Shuttle reverse / pause / forward |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Esc | Close menus, cancel a strip drag |
| F9 | X-ray inspector (diagnostic overlay) |

## Install

Download the latest DMG from
[Releases](https://github.com/friendlyonion/MacMovieMaker/releases), open it,
and drag MacMovieMaker to Applications. The prebuilt app targets Apple Silicon
Macs. It is currently unsigned, so on first launch right-click it and choose
Open (once) instead of double-clicking.

## Build from source

Prerequisites: macOS, Node 22+, Rust stable via rustup, and cargo on PATH:

```sh
git clone https://github.com/friendlyonion/MacMovieMaker.git
cd MacMovieMaker
export PATH="$HOME/.cargo/bin:$PATH"
npm ci
npx tauri build --bundles dmg
```

The `.app` and `.dmg` land under `src-tauri/target/release/bundle/`.
FFmpeg ships as bundled static sidecars (arm64 + x86_64) — no separate install.

## Make your first movie

1. Drag videos/photos from Finder onto the storyboard.
2. Click a clip to preview; trim with I/O, split with M, delete with Del.
3. Animations tab: stamp transitions; Visual Effects tab: grade the look.
4. Home tab: add a title, a caption, music, narration.
5. Save movie: pick a preset and export.

## Project files

Projects save as `.mmproj` (JSON): clip order, trims, transitions, effects,
text + animations, audio tracks + mix settings, pan/zoom. Missing media is
flagged on load (a relink picker is not implemented yet); autosave recovery
covers crashes.

## Export

Presets: Recommended, For high-definition display, For computer, For email,
plus device presets. "Create custom setting" stores reusable resolution /
bitrate / framerate combos. Every export is one FFmpeg render applying trims,
transitions, pan/zoom, effects, text, and the full audio mix — matching the
preview monitor, with progress and cancel. Share buttons export with the
recommended preset and open the service's upload page.

## Tech

- Tauri 2 (Rust backend + web frontend), vanilla JS, Canvas preview.
- FFmpeg 7.1 static sidecars for macOS arm64 + x86_64, bundled in the app.
- Preview and export share the same filter chains, so WYSIWYG holds.

## Development

- `npm test` runs the 123-test node suite. `tests/` is intentionally
  local-only (not committed) — it runs here, not in CI.
- `./scripts/release.sh X.Y.Z` cuts a release end to end (also local-only):
  version bump, tests, DMG build, tag, push, GitHub Release. Needs
  `gh auth login` once. The repo also excludes `screenshots/` (reference
  material) and `scripts/` — only what's needed to build and run is committed.

## Releases

- **0.1.1** — bigger default window (1440×900), save-menu viewport flip,
  full README.
- **0.1.0** — initial release: the full import-to-export roadmap.

## Troubleshooting

- **"Unverified developer" on first launch** — the app is unsigned;
  right-click → Open once, then it launches normally.
- **A clip can't be previewed** — try export anyway; FFmpeg supports more
  formats than the preview monitor.
- **Adding music removed the old song** — by design: one music track at a
  time (narration takes are unlimited).
- **Release script complains about `gh`** — `brew install gh`, then
  `gh auth login`.

## Background

Clean-room reimplementation from observed behavior: all icons, artwork, and
branding are original. Inspired by the 2012-era movie-maker workflow;
not affiliated with Microsoft.

## License

No license chosen yet.
