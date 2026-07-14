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

// The disc both managers stand in, the man who stands in it, and the near-black
// everything drawn on it is ruled in. All three are fixed, and none of them are
// the club's — the disc is the one surface a club does not tint, which is what
// lets the cap on top of it be the club's actual color instead of a version of it
// dragged bright enough to survive a club-colored ground.
//
// ONE grey for all thirty, not one each. It was solved per club for a while — the
// darkest grey each club's own colors could stand on — and the honest cost of that
// was thirty discs of thirty different brightnesses, which reads as thirty
// different screens rather than one league. A single grey is the simpler object,
// and the price is paid by two clubs: Philadelphia's bright red crown sits at
// 1.75:1 on it (the crown is the one piece with no rule around it, so it is
// carried by chroma — a saturated red on a neutral grey — rather than by
// lightness), and Kansas City's tan gold bill lands at 1.00:1, the same luminance
// as the ground exactly, and is held apart from it by its rule alone.
// Kept in step with --gq-cap-ground, --gq-figure and --gq-cap-ink in
// adventure/styles.css.
export const CAP_GROUND = "#a0a0a0";
export const CAP_FIGURE = "#6f737a";
export const CAP_INK = "#1b1d21";

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

export function derivePalette({ ink, accent, extras = [] }) {
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
    // The cap: the only two colors on the site that are not solved against
    // anything, bent toward nothing, and taken exactly as the club publishes them.
    // They can be, because the grey they stand on is not the club's — see
    // CAP_GROUND, which is the same grey for all thirty.
    capCrown: ink,
    capBill: accent,
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
    shellDark: mix("#948b7a", strongInk, 0.10),

    // The board gets the club's colors as printed, not the sheet's deepened
    // versions: the sheet had to deepen them so cream could be read on them, and
    // the board's problem is the opposite one.
    ...darkRoom(ink, accent, paper),
    ...bold(ink, accent, extras)
  };
}

// The club, loud.
//
// The enamel sheet was the house style and a club was a tint on it — which is
// why every league came out some shade of tan with the club's ink on top, and
// why the Pirates read as "the usual page, in black" rather than as the Pirates.
// A club is not a tint. Pittsburgh is black and gold, and it is mostly gold.
//
// So in a franchise league the sheet goes away. The ground is the club's darker
// color taken most of the way to black, the text is white on top of it, and the
// club's brighter color does all the work the navy rules and the red bars used
// to do: it is the rule, the header, the button, the chip. Same split as the
// board — the DARKER color grounds and the BRIGHTER one is spent — which is what
// makes Pittsburgh black-and-gold, Cincinnati black-and-red, Oakland green-and-
// gold, and the Dodgers blue-and-red without anyone choosing per club.
// The house red, and the color a run scores in when a club has not given us one.
const HOUSE_FLARE = "#b8352e";

// The FLARE: the color an event is announced in — a run crossing the plate, a
// man cut down on the bases. It is the one color on the screen that has to be
// LOUD, and the one that must not be the club's lead.
//
// That is the whole reason it exists. --accent-bright was doing this job, and in
// a franchise league --accent-bright and --gq-lead are set to the same value:
// the club's pop. So a run scored in Seattle flashed teal on a teal banner and
// simply vanished. A flare is not the club's lead by definition — it is what
// interrupts it.
//
// A club may name its own (the third color in its palette, if it has one). If it
// does not, the house red stands in; and where the house red would itself be
// lost — a club whose lead IS a red — the flare goes to the club's light tone,
// which reads on anything. It is checked against BOTH the banner it flashes on
// and the ground it flashes over, because it appears on both.
// Two colors separate if their HUES separate or their LIGHTNESSES do. Contrast
// alone is the wrong test here and rejects the obvious answer: the house red on
// Seattle's teal is 2.5:1, under AA, and about as invisible as a fire engine.
// WCAG measures luminance, and a red and a teal of the same luminance are the
// most distinguishable pair on the wheel. So: a wide hue apart, OR bright enough
// apart. A red on a red fails both, and should.
// A hue argument only counts if there is a hue to argue with. A near-white with
// a breath of navy in it reports a saturation of 0.15 in HSL and a hue of 205
// degrees, and would "separate" from a pink banner on hue alone at 2.1:1 — which
// is how the Angels nearly got an invisible flare. Pale is not a color: it has
// to have real chroma, and it has to be neither near-white nor near-black,
// before its hue is allowed to carry the argument.
function hasHue([, s, l]) {
  return s > 0.25 && l > 0.18 && l < 0.82;
}

export function flareSeparates(a, b) {
  const hslA = toHsl(a);
  const hslB = toHsl(b);
  const gap = Math.abs(hslA[0] - hslB[0]);
  const hueDegrees = Math.min(gap, 1 - gap) * 360;
  const ratio = contrast(a, b);
  // 30 degrees, not 40: a red and a gold sit 39 apart, and a red button on a
  // gold banner is not a subtle thing. A red and an ORANGE sit 16 apart and are
  // a smudge — the line belongs between those two, not above both.
  //
  // And a hue argument still needs SOME light behind it. Minnesota's gold on
  // its red lands 55 degrees apart at 1.1:1 — all but the same brightness, and
  // a flash that only changes hue at identical luminance is a flash you have to
  // look for. 1.8 is the floor; Seattle's red on its teal clears it at 1.9,
  // which is the case this whole token exists for.
  const byHue = hasHue(hslA) && hasHue(hslB) && hueDegrees >= 30 && ratio >= 1.8;
  return byHue || ratio >= 3;
}

// The flare's ONE job is to be seen on the banner, because the banner is where
// it flashes: the bases live in it. It was briefly asked to read on the dark
// board as well, and that is unsatisfiable — Baltimore's lead is a bright orange,
// the only thing that separates from a bright orange is something dark, and
// something dark is exactly what a near-black board swallows. Two backgrounds,
// two jobs; the board's cursor takes the club's lead instead.
//
// Candidates, in order of how much they belong to the club:
//   its own third and fourth colors, novel ones first
//   the house red
//   the light tone — white on a red banner is not subtle, which is the job
//   its OTHER color, the one the lead is not
//
// The last is what rescues the Angels: their lead is a light red, so the house
// red is the same hue and the light tone is 1.6:1 against it — both invisible.
// Their other color is navy, and a blue flash on a red banner is unmistakable.
// A club always has a second color, and it is always the one the lead is not.
function flareColor(extras, lead, light, other) {
  for (const candidate of [...extras, HOUSE_FLARE, light, other].filter(Boolean)) {
    if (flareSeparates(candidate, lead)) return candidate;
  }
  return light;
}

// The club's extra colors, most NOVEL first — furthest from the two it already
// spends. The Yankees list a blue and a red past their navy and grey, and the
// blue is very nearly the navy again: it would flare navy-on-grey, which is a
// club announcing a run in a color it is already wearing. The red is the color
// that is not yet on the screen, so the red goes first. Same reason Arizona
// leads with its turquoise rather than its black.
function byNovelty(extras, ink, accent) {
  const distance = (a, b) => {
    const [ra, rb] = [toRgb(a), toRgb(b)];
    return Math.hypot(...ra.map((v, i) => v - rb[i]));
  };
  return [...(extras ?? [])]
    .map((color) => ({ color, novelty: Math.min(distance(color, ink), distance(color, accent)) }))
    .sort((a, b) => b.novelty - a.novelty)
    .map((entry) => entry.color);
}

function bold(rawInk, rawAccent, extras) {
  const ground = luminance(rawInk) <= luminance(rawAccent) ? rawInk : rawAccent;
  const pop = ground === rawInk ? rawAccent : rawInk;

  const base = mix("#0b0b0b", ground, 0.62);
  const up = (t) => mix(base, "#ffffff", t);
  const white = "#f7f5f0";

  // The pop has to be legible on its own ground, and the ground is dark, so a
  // dark club color has to come up to meet it. HSL, not a mix toward white, or
  // Cincinnati's red arrives pink. A gold is already there and is not touched.
  const spend = liftUntil(pop, up(0.06), 4.6);

  return {
    boldBg: base,
    boldSheet: up(0.05),
    boldPanel: up(0.09),
    boldHairline: up(0.18),
    boldInk: white,
    boldMuted: up(0.62),
    // The club's color IS the rule now — the thing the old navy was.
    boldLine: spend,
    boldAccent: spend,
    // A gold button wants black on it, not white. Whichever reads.
    boldAccentInk: contrast(base, spend) >= contrast(white, spend) ? base : white,
    boldAccentDark: mix(spend, "#000000", 0.30),
    // The handheld's case goes dark with the rest of it. A cream plastic shell
    // around a black screen is the old palette refusing to leave.
    boldShell: up(0.16),
    boldShellDark: up(0.08),
    // The card surfaces. A shade up from the sheet so a card still reads as a
    // card sitting ON the page rather than a hole cut in it.
    boldCard: up(0.13),
    boldCard2: up(0.10),
    // The color a run is announced in, checked against the banner it flashes on.
    // `ground` is the club's other color — whichever one the lead is not.
    boldFlare: flareColor(byNovelty(extras, rawInk, rawAccent), spend, up(0.85), ground)
  };
}

// The TV board: a dark panel rather than a printed sheet, so it gets its own
// ramp cut from the same club.
//
// The obvious way to build it is to walk the club's ink toward black — and that
// is exactly the way that breaks. Six clubs ink in black already (Pittsburgh,
// the White Sox, the Giants, the Orioles, the Marlins, and the Padres' brown is
// nearly there); mixing black with black gives black, the panels all land on the
// same value, and the borders disappear. The board would render as one flat
// void for a fifth of the league.
//
// So the ramp runs the other way: a near-black room, tinted by the club, and
// every step above it interpolated toward the LIGHT text. That is monotone no
// matter how dark the ink is, so a black club gets the same readable ladder a
// navy one does — it is just tinted less, which is correct, because black is
// what it is.
// The room takes the club's DARKER color and the highlight takes its brighter
// one — never both from the same one, which is the trap. Tint the room red for
// St. Louis and then try to pop Cardinal red against it, and the red has to
// climb so far to be seen that it arrives as pink: a dusty pink board that is
// not a color the Cardinals have ever worn. Their ink is red and their accent is
// navy, so the room goes navy and the red sits on it, which is what a Cardinals
// broadcast has always looked like. Seattle keeps navy under teal, Pittsburgh
// black under gold, and Cincinnati — red ink, black accent — gets the black.
function darkRoom(rawInk, rawAccent, paper) {
  const ground = luminance(rawInk) <= luminance(rawAccent) ? rawInk : rawAccent;
  const pop = ground === rawInk ? rawAccent : rawInk;
  const room = mix("#0d0f0e", ground, 0.35);
  const up = (t) => mix(room, paper, t);
  return {
    tvBg: room,
    tvPanel: up(0.05),
    tvPanel2: up(0.08),
    tvPanel3: up(0.14),
    tvLine: up(0.15),
    tvLineSoft: up(0.13),
    tvLineStrong: up(0.24),
    tvLineHover: up(0.42),
    tvFaint: up(0.28),
    tvDim2: up(0.50),
    tvDim: up(0.58),
    tvTextSoft: up(0.76),
    tvTextStrong: up(0.92),
    tvText: paper,
    // The board is dark, so a club color that is itself dark has to come up to
    // meet it. A gold or an orange is already there and is left exactly alone;
    // Seattle's teal lifts a little. Three rungs, because the board highlights
    // in three weights.
    tvAccent: liftUntil(pop, room, 4.5),
    tvAccentSoft: lift(liftUntil(pop, room, 4.5), 0.10),
    tvAccentPale: lift(liftUntil(pop, room, 4.5), 0.18)
  };
}

// Lift a color until it can be seen on a dark ground — by raising its LIGHTNESS
// and leaving its hue and saturation where they are.
//
// The obvious way is to mix it toward white, and the obvious way turns every red
// in the league pink. White is not a lighter red; it is less of a red. Cardinal
// red mixed pale enough to be seen on a dark board arrives as salmon, which is a
// color the Cardinals have never worn. Raising lightness in HSL instead keeps the
// red red — it just turns the lamp up. Golds and oranges are already bright
// enough to clear the bar and are returned untouched.
function liftUntil(color, bg, target) {
  if (contrast(color, bg) >= target) return color;
  const [h, s, l] = toHsl(color);
  for (let step = 1; step <= 60; step += 1) {
    const candidate = fromHsl(h, s, Math.min(1, l + step / 60));
    if (contrast(candidate, bg) >= target) return candidate;
  }
  return "#ffffff";
}

// A fixed lift, for the board's lighter emphasis weights.
function lift(color, amount) {
  const [h, s, l] = toHsl(color);
  return fromHsl(h, s, Math.min(1, l + amount));
}

function toHsl(hex) {
  const [r, g, b] = toRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function fromHsl(h, s, l) {
  if (!s) return toHex([l * 255, l * 255, l * 255]);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return toHex([channel(h + 1 / 3) * 255, channel(h) * 255, channel(h - 1 / 3) * 255]);
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
  "--bg", "--sheet", "--panel", "--ink", "--muted", "--hairline",
  "--card", "--card-2", "--card-sheer",
  "--navy", "--navy-deep", "--line", "--accent", "--accent-dark",
  "--accent-bright", "--accent-ink",
  "--gb-darkest", "--gb-dark", "--gb-light", "--gb-lightest", "--room",
  "--gq-lead", "--gq-lead-ink", "--gq-flare",
  "--gq-cap-crown", "--gq-cap-bill",
  "--shell", "--shell-dark",
  "--tv-bg", "--tv-panel", "--tv-panel-2", "--tv-panel-3",
  "--tv-line", "--tv-line-soft", "--tv-line-strong", "--tv-line-hover",
  "--tv-faint", "--tv-dim-2", "--tv-dim", "--tv-text-soft", "--tv-text-strong",
  "--tv-text", "--tv-accent", "--tv-accent-soft", "--tv-accent-pale"
];

// The board's tokens, paired with the palette keys they take. Spelled out rather
// than derived from the names so that a token added to one list and forgotten in
// the other fails loudly here instead of silently rendering black on black.
const TV_TOKENS = {
  "--tv-bg": "tvBg",
  "--tv-panel": "tvPanel",
  "--tv-panel-2": "tvPanel2",
  "--tv-panel-3": "tvPanel3",
  "--tv-line": "tvLine",
  "--tv-line-soft": "tvLineSoft",
  "--tv-line-strong": "tvLineStrong",
  "--tv-line-hover": "tvLineHover",
  "--tv-faint": "tvFaint",
  "--tv-dim-2": "tvDim2",
  "--tv-dim": "tvDim",
  "--tv-text-soft": "tvTextSoft",
  "--tv-text-strong": "tvTextStrong",
  "--tv-text": "tvText",
  "--tv-accent": "tvAccent",
  "--tv-accent-soft": "tvAccentSoft",
  "--tv-accent-pale": "tvAccentPale"
};

export function applyFranchisePalette(universeKey, root = document.documentElement) {
  const palette = franchisePalette(universeKey);
  if (!palette) {
    for (const token of TOKENS) root.style.removeProperty(token);
    root.style.removeProperty("color-scheme");
    root.classList.remove("club");
    return null;
  }
  // The `club` block at the foot of styles.css hangs off this: the surfaces that
  // were written as literal light colors and cannot be reached by a token.
  root.classList.add("club");
  // The draft page, in the club's colors — dark ground, white text, and the
  // club's bright color doing every job the navy rules and red bars used to do.
  // The form controls have to be told too, or the browser paints its own light
  // dropdowns onto a black page.
  root.style.setProperty("color-scheme", "dark");
  root.style.setProperty("--bg", palette.boldBg);
  root.style.setProperty("--sheet", palette.boldSheet);
  root.style.setProperty("--panel", palette.boldPanel);
  root.style.setProperty("--ink", palette.boldInk);
  root.style.setProperty("--muted", palette.boldMuted);
  root.style.setProperty("--hairline", palette.boldHairline);
  root.style.setProperty("--card", palette.boldCard);
  root.style.setProperty("--card-2", palette.boldCard2);
  root.style.setProperty("--card-sheer", palette.boldCard);
  root.style.setProperty("--navy", palette.boldLine);
  root.style.setProperty("--navy-deep", palette.boldAccentDark);
  root.style.setProperty("--line", palette.boldLine);
  root.style.setProperty("--accent", palette.boldAccent);
  root.style.setProperty("--accent-dark", palette.boldAccentDark);
  root.style.setProperty("--accent-bright", palette.boldAccent);
  root.style.setProperty("--accent-ink", palette.boldAccentInk);
  // The handheld, inverted: the screen is the club's dark ground, the text on it
  // is white, and the bars and the selected row are the club's color. The four
  // tones still hold their four jobs — they are just no longer four greens or
  // four creams, and the fifth tone is what lets the gold lead without dragging
  // the body text gold along with it.
  root.style.setProperty("--gb-lightest", palette.boldSheet);
  root.style.setProperty("--gb-darkest", palette.boldInk);
  root.style.setProperty("--gb-dark", palette.boldMuted);
  root.style.setProperty("--gb-light", palette.boldPanel);
  root.style.setProperty("--gq-lead", palette.boldAccent);
  root.style.setProperty("--gq-lead-ink", palette.boldAccentInk);
  // The flare cannot be the lead, or a run scores in the banner's own color and
  // disappears into it. This is the token that used to be --accent-bright, which
  // in a club league IS the lead.
  root.style.setProperty("--gq-flare", palette.boldFlare);
  // The cap, and the disc both managers stand in. The club's two colors exactly as
  // it publishes them. The disc under them is NOT set here: it is the same grey for
  // all thirty, so it lives in the stylesheet and no club overrides it.
  root.style.setProperty("--gq-cap-crown", palette.capCrown);
  root.style.setProperty("--gq-cap-bill", palette.capBill);
  root.style.setProperty("--room", palette.boldBg);
  root.style.setProperty("--shell", palette.boldShell);
  root.style.setProperty("--shell-dark", palette.boldShellDark);
  // The TV board. Same club, other room.
  for (const [token, key] of Object.entries(TV_TOKENS)) {
    root.style.setProperty(token, palette[key]);
  }
  return palette;
}
