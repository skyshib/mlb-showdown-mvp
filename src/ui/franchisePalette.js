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

// How far a color has to move, in either direction, before `target` clears —
// and which way is nearer. Returned as {color, steps}, so the caller can take
// whichever journey is shorter and keep the club as close to its own color as
// the contrast will allow.
function walkUntil(color, toward, ok) {
  if (ok(color)) return { color, steps: 0 };
  for (let step = 1; step <= 40; step += 1) {
    const candidate = mix(color, toward, step / 40);
    if (ok(candidate)) return { color: candidate, steps: step };
  }
  return { color: toward, steps: Infinity };
}

// What can be read on top of `fill`. Gold takes the ink, navy takes the paper,
// and nobody has to remember which: whichever wins by contrast, wins.
//
// The deep ink earns its place in this list. An orange — Baltimore's, Detroit's,
// Houston's, the Mets' — is the awkward middle: too light for cream to sit on,
// and the club's own near-black lands at 4.2:1, just under the bar. Half a shade
// darker clears it, and that is the whole difference between an orange button
// and a brown one. Without this candidate every orange in the league falls back.
function readableOn(fill, candidates) {
  return candidates.reduce((best, c) => (contrast(c, fill) > contrast(best, fill) ? c : best));
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
  const readable = darkenUntil(accent, paper, 4.6);
  const inkDeep = mix(strongInk, "#000000", 0.25);
  const onButton = [paper, strongInk, inkDeep];

  // The button wears the color the club actually is — but only if something can
  // be read on top of it. A gold takes the ink and a navy takes the paper; the
  // trouble is the middle. An orange is too light for cream to sit on and too
  // dark for black to bite: Baltimore's lands at 4.13:1 under its own near-black,
  // a rounding short of the bar.
  //
  // So the color is allowed to move, and it may move EITHER WAY — because the
  // way to rescue an orange is not to darken it (that is how you get brown) but
  // to LIGHTEN it, which makes it more orange, not less, and gives the black on
  // top of it room to bite. Whichever direction crosses the bar first wins, so
  // the club ends up as close to its own color as the contrast permits: the
  // reds deepen a shade, and the oranges brighten one.
  // 4.6, not 4.5, for the same reason as the accent: the walk stops the moment
  // it clears, so aiming at exactly AA lands somebody exactly on AA.
  const canRead = (c) => contrast(readableOn(c, onButton), c) >= 4.6;
  const lighter = walkUntil(accent, "#ffffff", canRead);
  const darker = walkUntil(accent, "#000000", canRead);
  const bright = lighter.steps <= darker.steps ? lighter.color : darker.color;

  return {
    paper,
    ink: strongInk,
    dim: solveMidtone(paper, strongInk, 4.7),
    tint: mix(paper, strongInk, 0.22),
    // Two accents, because one color cannot do both jobs.
    //
    // --accent is the club's second color deepened until it can be READ: it is
    // set as text on the cream sheet in eight places, and a gold light enough
    // to glow as a button is a gold you cannot read as a word. 4.6 rather than
    // 4.5 because the solver stops the moment it clears the bar, and a color
    // sitting exactly on AA (the Twins landed there) is one rounding under it.
    //
    // --accent-bright is the color the club actually is, spent on the buttons,
    // which is where you look. It never has to be legible itself — it is a
    // fill, it has a dark border around it, and the text on top of it is
    // --accent-ink, chosen below to suit it. That is what buys Pittsburgh a
    // gold button instead of a brown one.
    accent: readable,
    accentBright: bright,
    accentInk: readableOn(bright, onButton),
    accentDark: mix(readable, "#000000", 0.35),
    inkDeep,
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
  "--accent-bright", "--accent-ink",
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
  root.style.setProperty("--accent-bright", palette.accentBright);
  root.style.setProperty("--accent-ink", palette.accentInk);
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
