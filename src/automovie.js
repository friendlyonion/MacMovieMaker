// MacMovieMaker — Milestone 5 AutoMovie theme definitions.
// Each theme stamps one transition (+duration), one effect, pan/zoom presets
// (round-robin across photos), and optionally end fades + title cards.
// Names are the spec's plain descriptive words. Node-safe data.

export const THEMES = [
  {
    id: "default", name: "Default",
    trans: "dissolve", transDur: 0.5, fx: "none",
    pz: ["pz-drift"], titles: false, fades: false,
    blurb: "Simple cross-dissolves between every clip.",
  },
  {
    id: "sepia", name: "Sepia",
    trans: "fade-black", transDur: 1, fx: "sepia",
    pz: ["pz-approach"], titles: true, fades: false,
    blurb: "Warm vintage tone with title cards.",
  },
  {
    id: "bw", name: "Black and White",
    trans: "wipe-right", transDur: 0.75, fx: "bw",
    pz: ["pz-sweep"], titles: true, fades: false,
    blurb: "Classic monochrome with wipes and titles.",
  },
  {
    id: "pz", name: "Pan and Zoom",
    trans: "push-left", transDur: 0.75, fx: "none",
    pz: ["pz-sweep", "pz-drift", "pz-zin-c", "pz-zout-c"], titles: false, fades: false,
    blurb: "Photos roam while clips push across.",
  },
  {
    id: "fade", name: "Fade",
    trans: "fade-black", transDur: 1.25, fx: "none",
    pz: ["pz-drift"], titles: true, fades: true,
    blurb: "Slow fades through black, titles included.",
  },
  {
    id: "cinematic", name: "Cinematic",
    trans: "dissolve", transDur: 1.5, fx: "cinematic",
    pz: ["pz-approach", "pz-pullback"], titles: true, fades: false,
    blurb: "Graded film look with slow moves.",
  },
  {
    id: "contemporary", name: "Contemporary",
    trans: "push-right", transDur: 0.75, fx: "none",
    pz: ["pz-zin-c", "pz-zin-tr", "pz-zin-bl"], titles: true, fades: false,
    blurb: "Brisk pushes and punch-ins with titles.",
  },
];

export const themeById = (id) => THEMES.find((t) => t.id === id) ?? null;
