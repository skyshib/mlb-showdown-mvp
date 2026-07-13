// A club's two colors, turned into the whole palette both halves of the site
// run on.
//
// The point of doing this with a solver instead of thirty hand-picked ramps is
// that thirty hand-picked ramps is thirty chances to ship a screen nobody can
// read. The Padres are brown on gold and the Rockies are purple on silver, and
// a mid tone that looks right against Dodger blue is invisible against Sedona
// red. So the two ends are the club's, and everything between them is solved
// against a contrast target and checked — see test/franchise-palette.test.js,
// which walks all thirty and fails if any tone falls under AA.
//
// The targets, and why:
//   ink    >= 7.0:1 on paper — body text, and most of the screen is body text
//   dim    ~= 4.7:1 on paper — must be legible, and must be CLEARLY under ink,
//                              or "dim" text reads as ordinary text
//   accent >= 4.5:1 on paper — it is a fill with cream text on it in a dozen
//                              places, so the golds and silvers get darkened
//                              until they can hold that text. Hue survives;
//                              lightness is not the club's to decide here.

import { FRANCHISE_COLORS, franchiseCode } from "../data/franchiseColors.js";

// The sheet the whole site is printed on. The club tints it; it never leaves.
const CREAM = "#f0e7d2";

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function toRgb(hex) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function toHex(rgb) {
  return `#${rgb.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

export function luminance(hex) {
  const channels = toRgb(hex)
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Straight sRGB mix. Not perceptually even, but the solver below searches on
// the result rather than trusting the step, so evenness buys nothing.
export function mix(a, b, t) {
  const [ra, rb] = [toRgb(a), toRgb(b)];
  return toHex(ra.map((v, i) => v + (rb[i] - v) * t));
}

// Walk a color toward black until it clears `target` against `bg`. Used on the
// club's own colors, so it stops the moment it is dark enough and a color that
// already clears the bar is returned untouched.
function darkenUntil(color, bg, target) {
  if (contrast(color, bg) >= target) return color;
  for (let step = 1; step <= 40; step += 1) {
    const candidate = mix(color, "#000000", step / 40);
    if (contrast(candidate, bg) >= target) return candidate;
  }
  return "#000000";
}

// Find the tone between paper and ink that lands on `target` against paper.
// Bisection, because contrast is monotone along that line: mixing toward ink
// only ever darkens, so there is exactly one crossing to find.
function solveMidtone(paper, ink, target) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    if (contrast(mix(paper, ink, mid), paper) < target) lo = mid;
    else hi = mid;
  }
  return mix(paper, ink, hi);
}

export function derivePalette({ ink, accent }) {
  // The paper takes a breath of the club and nothing more. Any more and the
  // cream stops being cream, and the sign stops being the same sign.
  const paper = mix(CREAM, ink, 0.05);
  const strongInk = darkenUntil(ink, paper, 7.0);
  return {
    paper,
    ink: strongInk,
    dim: solveMidtone(paper, strongInk, 4.7),
    tint: mix(paper, strongInk, 0.22),
    // 4.6 rather than 4.5: the solver stops the moment it clears the bar, so a
    // target of exactly AA lands some clubs on exactly AA (the Twins did), and
    // a color sitting on the line is one rounding away from under it.
    accent: darkenUntil(accent, paper, 4.6),
    accentDark: mix(darkenUntil(accent, paper, 4.6), "#000000", 0.35),
    inkDeep: mix(strongInk, "#000000", 0.25),
    // The dark room the handheld sits in: the club's ink with the lights off.
    room: mix(strongInk, "#000000", 0.55),
    // The case gets a breath of the club too. Without it the plastic stays the
    // same warm grey for all thirty, which reads fine next to a brown Padres
    // screen and wrong next to a cold Mariners one — a warm shell around a
    // silver screen looks like two different objects.
    shell: mix("#bdb3a0", strongInk, 0.10),
    shellDark: mix("#948b7a", strongInk, 0.10)
  };
}

export function franchisePalette(universeKey) {
  const code = franchiseCode(universeKey);
  return code ? derivePalette(FRANCHISE_COLORS[code]) : null;
}

// Both halves of the site are already written against custom properties, so
// dressing a page in a club's colors is a matter of redefining the tokens
// rather than restyling anything. A universe that is not a franchise clears
// them, and the stylesheet's own defaults — the enamel sign — come back.
const TOKENS = [
  "--navy", "--navy-deep", "--line", "--accent", "--accent-dark",
  "--gb-darkest", "--gb-dark", "--gb-light", "--gb-lightest", "--room",
  "--shell", "--shell-dark"
];

export function applyFranchisePalette(universeKey, root = document.documentElement) {
  const palette = franchisePalette(universeKey);
  if (!palette) {
    for (const token of TOKENS) root.style.removeProperty(token);
    return null;
  }
  // The draft's enamel sign: the club's ink becomes the rule the sheet is
  // ruled with, and the club's accent becomes the red that was never red.
  root.style.setProperty("--navy", palette.ink);
  root.style.setProperty("--navy-deep", palette.inkDeep);
  root.style.setProperty("--line", palette.ink);
  root.style.setProperty("--accent", palette.accent);
  root.style.setProperty("--accent-dark", palette.accentDark);
  // The handheld's four tones.
  root.style.setProperty("--gb-darkest", palette.ink);
  root.style.setProperty("--gb-dark", palette.dim);
  root.style.setProperty("--gb-light", palette.tint);
  root.style.setProperty("--gb-lightest", palette.paper);
  root.style.setProperty("--room", palette.room);
  root.style.setProperty("--shell", palette.shell);
  root.style.setProperty("--shell-dark", palette.shellDark);
  return palette;
}
