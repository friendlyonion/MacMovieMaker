Movie Maker for Mac — Clean-Room UI/Behavior Spec
Target reference: Windows Movie Maker 2012 (v16.4, last release; discontinued by Microsoft 2017).
Method: Spec derived SOLELY from observed behavior — public screenshots, tutorial videos, and documentation. No decompilation. No Microsoft artwork, icons, logos, or brand names are reproduced here or permitted in the build.
How to use this doc: Each section names its reference screenshot in screenshots/, describes layout/controls, then gives the interaction workflow. Build ORIGINAL icons/art for every control. Functional labels (Save movie, Split, Trim) may be reused as plain functional descriptions; they are not trademarked phrases in this context.

1. Main window — Home tab
Screenshot: home-tab.png, home-tab-titles.png
Layout (left → right, top → bottom):
Title bar: [Project name] - [App name], standard macOS window controls (replacing Windows min/max/close).
Ribbon with tabs: File | Home | Animations | Visual Effects | Project | View. Contextual tabs appear when relevant: Video Tools > Edit, Music Tools > Options, Text Tools > Format.
Quick-access toolbar (top-left): Save, Undo, Redo.
Left pane — Preview monitor: large black 16:9 preview area; below it a time readout 00:00.00/00:00.00, a seek/scrub bar, and transport buttons (previous-frame | play/pause | next-frame). Fullscreen-preview button at the time readout's right edge.
Right pane — Storyboard/timeline: horizontally wrapping strip of clip thumbnails (filmstrip style with sprocket-hole borders). Empty state shows dashed drop zone: "Click here to browse for videos and photos" (reword as needed).
Status bar (bottom): left shows Item N of N (selected clip position); right has storyboard-zoom slider with - / + buttons and a fit-width button.
Home tab ribbon groups:
Group
Controls
Clipboard
Paste, Cut, Copy
Add
Add videos and photos (multi-select file picker; also accepts drag-drop onto storyboard), Add music (dropdown: "Add music…" / "Add music at the current point"), Record narration, Webcam video, Snapshot
(titles)
Title, Caption, Credits (each with dropdown for placement variants)
AutoMovie themes
7-theme gallery (see §9)
Editing
Rotate left, Rotate right, Remove, Select all
Share
OneDrive, Facebook, YouTube, Vimeo, Flickr buttons (share-group.png); Save movie split-button; Sign in
Workflow — starting a project: Click "Add videos and photos" (or drag files onto the storyboard) → thumbnails appear in storyboard order → drag thumbnails to reorder → press Space to preview.

2. Animations tab — Transitions
Screenshots: animations-tab.png, animations-tab-transitions.png
Layout: Ribbon shows a horizontally scrolling Transitions gallery (thumbnail per transition; hover shows animated preview in the monitor), a Duration field (default ~1.0s; adjustable, documented range 0.25–2s), an Apply to all checkbox/button, then the Pan and zoom gallery (§3).
Workflow: Select a clip in the storyboard → Animations tab → click a transition thumbnail → a small gray triangle indicator appears at the START of that clip in the storyboard → adjust Duration → optionally "Apply to all" to stamp it on every clip. Select the transition indicator and choose "None" (first gallery item) to remove.
Verified 2012 transition names (from tutorial text sources; gallery order approximate):
None, Fade, Dissolve/Crossfade, Wipe variants, Diagonal, Reveal, Pattern, Shape
[UNVERIFIED — visible as thumbnails in animations-tab.png but names not legible; the 2012 gallery holds roughly 20 items including 3D-style moves] Additional 3D-style transitions are present (flip/slide/roll/spin/page-curl family). Builder instruction: implement ~20 transitions covering four families — fades/dissolves, directional wipes, geometric patterns (diagonal, diamond, shape reveals), and 3D moves (flip, slide, roll, spin, page curl). Give them ORIGINAL names; do not copy Microsoft's exact naming beyond generic descriptive words (Fade, Wipe, Dissolve are generic).

3. Animations tab — Pan and zoom (photos)
Screenshot: pan-zoom-gallery.png (expanded gallery)
Layout: Gallery grouped into four labeled sections: Automatic, Pan only, Zoom in, Zoom out. Each preset is a thumbnail showing the motion path (arrows/rectangles indicating start→end framing). An "Apply to all" button stamps the chosen preset on every photo.
Behavior: Applies ONLY to still photos (Ken Burns effect) — pans/zooms across the photo for its duration. Video clips ignore these.
Builder instruction: implement ~25 presets: 8-directional pans, zoom-in-to-center/corners, zoom-out-from-center/corners, plus combined pan+zoom moves. Names: use descriptive originals ("Pan left", "Zoom in from top-right", etc.).

4. Visual Effects tab
Screenshot: visual-effects-tab.png
Layout: Ribbon shows an Effects gallery (thumbnail per filter; hover previews in monitor), a Brightness slider control, and an Apply to all button.
Workflow: Select clip → Visual Effects tab → hover thumbnails to preview → click to apply (one effect per clip; clicking another replaces it; "None" removes). Brightness slider adjusts the selected clip.
Verified effect names: None, Black and White, Sepia, Cinematic (+ artistic filters visible as thumbnails).
[UNVERIFIED — full 2012 list not legible in sources; gallery shows ~10 items] Builder instruction: implement ~10 filters: B&W, sepia, cinematic (teal-orange grade + letterbox), plus generic artistic ones (blur, pixelate, posterize, old-film grain, invert, threshold). Original names. Also include Fade in from black / Fade out to black / Fade in from white / Fade out to white as clip-level options (these live under Visual Effects in the original per tutorial sources).

5. Video Tools > Edit (contextual tab, video/photo selected)
Screenshots: video-tools-edit.png, trim-tool.png
Layout — groups left → right:
Group
Controls
(volume)
Video volume: speaker icon + slider popup; Mute toggle
Audio
Fade in (dropdown: None/Slow/Medium/Fast), Fade out (same)
Adjust
Background color (color picker — fills letterbox/pillarbox areas), Speed (dropdown, e.g. 0.125x–64x; shows 1x), Duration (numeric field, seconds)
Editing
Split (scissors), Trim tool, Set start point, Set end point, Video stabilization (dropdown)
Workflows:
Trim (non-destructive): Move playhead → "Set start point" (or I) hides everything before; "Set end point" (or O) hides everything after. Trimmed media is HIDDEN, not deleted — extending points back restores footage. The Trim tool opens start/end sliders for fine control with Save/Cancel.
Split: Move playhead over a clip → Split (or M) → clip becomes two clips at the playhead. Combine: select two contiguous clips from the same source → N merges them.
Stabilization: dropdown with anti-shake strength options. [UNVERIFIED — exact option labels]
Speed: dropdown multiplier; audio pitch behavior [UNVERIFIED — assume video retimes, audio mutes or pitch-shifts at extremes; builder's choice, document it].

6. Music Tools > Options (contextual tab, audio selected)
Screenshot: music-tools.png
Layout: Ribbon tab labeled Music Tools > Options appears when the audio track is selected. Controls (per documentation; tab strip visible in screenshot, individual labels partially obscured): Start time, Start point, End point (numeric fields positioning/trimming the music against the timeline), Fade in / Fade out (Slow/Medium/Fast/None), Volume slider.
Timeline behavior: Added music appears as a green waveform bar beneath the video/photo clips, spanning its duration. It is draggable along the timeline and its ends are trimmable. "Add music at the current point" drops it at the playhead; default "Add music" pins it to the project start. Only ONE audio track (no multitrack mixing).

7. Text Tools > Format (contextual tab, title/caption/credits selected)
Screenshot: text-tools-format.png
Layout — groups left → right:
Group
Controls
Clipboard
Cut, Copy, Paste
Font
Font family dropdown (default Segoe UI — use system font on Mac), size (default 48), bold/italic, font color, transparency slider
Paragraph
Text alignment (left/center/right), (line spacing per docs [UNVERIFIED])
Adjust
Edit text, Background color, Start time, Text duration (default 7.00s)
Effects
Text-animation preset gallery (thumbnail per animation)
(outline)
Outline text / Outline color toggles
Three text types (Home tab):
Title — standalone full-screen card inserted at the playhead (default 7s). Preview shows centered text over background color.
Caption — text overlaid on the selected clip (subtitle-style, draggable text box in the preview monitor).
Credits — end card with auto-scrolling text (rolls upward like movie credits).
Text animation presets (from a tutorial video cataloguing the 2012-era list — treat as [UNVERIFIED] for exact 2012 membership): Fly In (Top Left etc.), Typewriter, Ticker Tape, News Banner, Scroll, Perspective Scroll, Flashing, Zoom In/Out, Spin In/Out, News Video Inset, Fade + Slow Zoom, Zoom Up and In, Stretch, Subtitle, Basic Title, Video in Text, "Wow!", Fade Wipe / Fade Bounce Wipe / Fade Ellipse Wipe, Mirror, Scroll Banner, Scroll Inverted, Paint Drip.
Builder instruction: implement ~20 text animations across families: fly-ins (4 directions), fades, zooms, spins, typewriter/ticker, banner scrolls, wipe reveals. Original names.
Workflow: Home → Title/Caption/Credits → pink "T" bar appears in storyboard (caption bars sit under their clip; title/credit cards are their own segments, e.g. CREDITS label seen in file-menu.png) → click "Edit text" or double-click the preview text box → type → Format tab adjusts font/animation/duration → drag the text box in the preview to reposition.

8. Project tab
Screenshot: project-tab.png (tutorial composite; ribbon portion is genuine)
Layout — groups left → right:
Group
Controls
Audio mix
Emphasize narration, Emphasize video, Emphasize music, No emphasis (ducking presets — lowers the non-emphasized sources under the chosen one)
(fit)
Fit to music button — trims/extends photo durations so the slideshow ends with the soundtrack
Aspect ratio
Widescreen (16:9), Standard (4:3)
Behavior: Aspect ratio applies project-wide (letterbox/pillarbox filled with the Background color from §5). Switching mid-project reframes the preview.

9. AutoMovie themes
Screenshot: automovie-themes.png (gallery visible in Home tab ribbon)
Layout: Home tab gallery of 7 theme thumbnails.
Verified theme names (from tutorial source): Default, Sepia, Black and White, Pan and Zoom, Fade, Cinematic, Contemporary.
Workflow: Add photos/videos to an empty storyboard → click a theme → app prompts "add music?" → one click applies a coordinated set of transitions + visual effects + pan/zoom + title cards across the whole project. This is the signature one-click-movie feature — prioritize making it feel instant.

10. Storyboard / timeline close-up
Screenshot: timeline.png
Details to replicate:
Clips render as filmstrip thumbnails with sprocket-hole borders and a per-clip audio waveform along the bottom edge.
Selected clip gets a blue highlight border.
Applied transition = small gray triangle at the clip's leading edge.
Applied text (caption) = pink bar with "T" icon under the clip.
Playhead = vertical line with handle; drag to scrub.
Zoom slider (bottom-right) scales thumbnail size; status bar shows Item N of N.
Audio (music) = green waveform bar below clips, independently draggable/trimmable.

11. Preview monitor + transport
Screenshots: home-tab.png, timeline.png (left pane)
16:9 (or 4:3) preview canvas; black when empty.
Below: timecode elapsed / total, scrub bar, transport: |◀ ▶/⏸ ▶| (prev-frame, play/pause, next-frame).
Fullscreen preview button; keyboard F11 toggles fullscreen playback, Space or K plays/pauses.
Snapshot button (Home > Add group): captures the current preview frame as a still image and inserts it at the playhead.

12. File menu + Save movie presets
Screenshots: file-menu-save-movie.png, file-menu.png
File menu items: New project, Open project, Save project (Ctrl+S), Save project as, Publish movie (submenu: OneDrive, Facebook, YouTube, Vimeo, Flickr — uploads rendered file; requires sign-in), Save movie (submenu below), Import from device (webcam/DV import), Options, About, Exit.
Save movie presets (verified from screenshot):
Recommended setting: "Recommended for this project"
Recent settings: (user's last-used customs)
Common settings: "For high-definition display", "For computer", "For email"
Phone and device settings: "Android Phone (large)", "Android Phone (medium)", "Apple iPhone", "Windows Phone (large)", "Windows Phone (small)", "Zune HD (for 720p display)", "Zune HD (for device)"
Create custom setting…: dialog with resolution, bitrate, and framerate controls; saved customs appear under Recent settings. [UNVERIFIED — exact fields; implement resolution/bitrate/fps]
Output formats: renders to video file — original produced .wmv; on macOS ship .mp4 (H.264) as the default. Preset details shown in-app include resolution, aspect, bitrate, and estimated MB-per-minute (e.g. iPhone preset: 1280×720, 16:9, ~10.8 Mbps, ~77 MB/min — from project-tab.png).
Project file: .wlmp — XML-ish project format storing clip references, in/out points, effects, and titles (NOT rendered video). Save/Open project round-trips it. Recent-projects list in File menu. [UNVERIFIED — internal schema; define your own, do not attempt byte-compatibility]

13. Record narration
Screenshot: record-narration.png
Layout: Clicking Home > Record narration opens a dedicated ribbon tab (not a modal dialog) with three large buttons: Record (red dot), Stop (square), Cancel (X), under the group label "Record Narration". Live mic-level feedback adjacent. [UNVERIFIED — exact level-meter design]
Workflow: Record → speak while the project plays in the preview → Stop → the narration is saved as an audio file into a Narration folder and auto-placed on the timeline at the playhead position, where it behaves like any audio clip (trimmable, draggable). Cancel discards.

14. Keyboard shortcuts (verified from tutorial source)
Keys
Action
Ctrl/Cmd+S
Save project
Ctrl/Cmd+Z / Ctrl/Cmd+Y
Undo / Redo
Space or K
Play / pause
I / O
Set start / end trim point
M
Split at playhead
N
Combine selected contiguous clips
Ctrl/Cmd+C
Copy
J / L
Shuttle playhead left / right
+ / -
Storyboard zoom in / out
F11
Fullscreen preview
F12
Save movie (export)

15. Import format support
[UNVERIFIED — from a 2012-era tutorial; Media Foundation on Windows accepted these. On macOS, accept whatever AVFoundation/FFmpeg handles, prioritizing:]
Video: .mp4, .mov, .m4v, .avi, .wmv, .mpg/.mpeg, .asf
Audio: .mp3, .m4a, .wav, .wma, .aif/.aiff, .asf, .wm
Images: .jpg/.jpeg, .png, .bmp, .gif, .tif/.tiff

16. Global behavior notes for the builder
Single video track, single audio track. No multitrack. This constraint IS the product — do not "improve" it into Premiere.
Non-destructive trimming — hidden ranges, restorable.
Hover-to-preview on every gallery (transitions, effects, pan/zoom, text animations, AutoMovie themes).
"Apply to all" on transitions, effects, and pan/zoom.
Empty states: dashed drop zone with "browse for videos and photos" prompt; black preview.
macOS adaptations: native menu bar + ribbon-equivalent toolbar (the ribbon layout above maps 1:1 to a toolbar with tab switcher); AVFoundation or FFmpeg as the render engine; Share sheet for export targets instead of the dead OneDrive/Flickr/Vimeo integrations — keep YouTube upload only if you implement OAuth, otherwise offer "Export file, then upload".
Performance: storyboard thumbnails + waveforms generated lazily; proxy-free since it's a simple editor.

17. Rebuild notes (trademark-safe) — READ BEFORE SHIPPING
Do NOT name the app "Windows Movie Maker", "Movie Maker", or anything containing "Windows". Pick an original name (e.g. "Starwipe Studio", "ReelSimple" — your choice).
Do NOT copy Microsoft's filmstrip logo, ribbon icons, splash art, sounds, or exact UI copy beyond generic functional words. Every icon and asset must be drawn original. Screenshots in screenshots/ are REFERENCE ONLY — never ship them or trace them.
Functional labels are fine: "Save movie", "Split", "Trim", "Add music", "Record narration" are plain functional descriptions, not trademarks. Prefer your own wording where natural.
Marketing copy (nominative fair use): saying "inspired by the discontinued Windows Movie Maker (2012)" or "I recreated Windows Movie Maker for macOS" in a tweet/video/post is nominative fair use — you're naming their product to refer to it. Keep it to descriptive sentences; don't use their logo or imply endorsement.
Do NOT decompile Microsoft's binaries at any point. This spec was built from screenshots and docs; keep the implementation the same way — behavior-compatible, independently written.
Dead integrations: OneDrive/Facebook/Vimeo/Flickr publish paths relied on 2012-era APIs. Reimplement only what you can support (file export + macOS Share sheet); don't fake the others.
