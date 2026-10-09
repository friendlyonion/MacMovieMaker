# MacMovieMaker

A macOS desktop video editor in the spirit of Windows Movie Maker 2012:
ribbon tabs, a preview monitor, a storyboard strip, and one-click export.
Built with Tauri (Rust + web frontend); FFmpeg does all video work.

## Screenshots

![Main window](docs/shots/main-window.png)
*Main window: Home ribbon, preview monitor, storyboard strip, audio lane.*

![Visual Effects tab](docs/shots/effects-tab.png)
*Visual Effects gallery with live preview.*

![Export presets](docs/shots/export-dialog.png)
*Save movie preset menu.*

### Capturing them (macOS)

The files above don't exist yet — capture them once and the README goes live:

1. Open the app with a project loaded (a few clips plus music).
2. Press Cmd+Shift+4, then Space, and click the app window.
3. Move the captures into `docs/shots/` with these exact names:
   - `main-window.png` — full window on the Home tab.
   - `effects-tab.png` — Visual Effects tab with the gallery visible.
   - `export-dialog.png` — Save movie preset menu open.

## Features

- **Import & storyboard** — drag videos/photos from Finder; thumbnails,
  drag-to-reorder, click-to-preview, Space to play/pause, scrub bar.
- **Clip editing** — non-destructive trim (I/O keys, trim dialog), split (M),
  delete, 90° rotate, J/K/L shuttle, full undo stack.
- **Animations** — transitions gallery with per-clip indicator, adjustable
  duration, apply-to-all; Ken Burns pan/zoom presets for photos.
- **Effects & text** — visual-effects gallery, brightness, fades; titles,
  captions, and auto-scrolling credits with animation presets; text drags
  directly on the preview.
- **Audio & AutoMovie** — music tracks with volume/fades/trim, narration
  recording tab, emphasize ducking, fit-to-music, 7 AutoMovie themes,
  frame snapshot.
- **Export & project** — save-movie presets plus custom settings (resolution,
  bitrate, framerate) with progress/cancel; `.mmproj` save/load with autosave
  recovery and recents; one-click share via export + upload page.

## Install

Download the latest DMG from
[Releases](https://github.com/friendlyonion/MacMovieMaker/releases), open it,
and drag MacMovieMaker to Applications. The app is currently unsigned, so on
first launch right-click it and choose Open (once) instead of double-clicking.

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
reported on load; autosave recovery covers crashes.

## Tech

- Tauri 2 (Rust backend + web frontend), vanilla JS, Canvas preview.
- FFmpeg 7.1 static sidecars for macOS arm64 + x86_64, bundled in the app.
- Preview and export share the same filter chains, so WYSIWYG holds.

## Dev notes

- `npm test` runs the 121-test node suite. `tests/` is intentionally
  local-only (not committed) — it runs here, not in CI.
- `./scripts/release.sh X.Y.Z` cuts a release end to end (also local-only):
  version bump, tests, DMG build, tag, push, GitHub Release. Needs
  `gh auth login` once. The repo also excludes `screenshots/` (reference
  material) and `scripts/` — only what's needed to build and run is committed.

## Background

Clean-room reimplementation from observed behavior: all icons, artwork, and
branding are original. Inspired by the 2012-era movie-maker workflow;
not affiliated with Microsoft.

## License

No license chosen yet.
