import { test } from "node:test";
import assert from "node:assert/strict";
import { FRANCHISE_COLORS, franchiseCode } from "../src/data/franchiseColors.js";
import { contrast, derivePalette, franchisePalette, luminance } from "../src/ui/franchisePalette.js";

// The sheet every club prints on, and the text color that sits on every accent
// fill in the draft (--sheet).
const CREAM = "#f0e7d2";
const AA = 4.5;

// The whole reason the ramp is solved rather than hand-picked. A club's colors
// are the club's; whether you can read the screen is not up to the club.
test("every franchise stays legible on its own palette", () => {
  for (const [code, colors] of Object.entries(FRANCHISE_COLORS)) {
    const p = derivePalette(colors);
    const pairs = {
      "ink on paper": contrast(p.ink, p.paper),
      "dim on paper": contrast(p.dim, p.paper),
      "accent on paper": contrast(p.accent, p.paper),
      "cream on ink": contrast(CREAM, p.ink),
      // --accent is a fill with cream text on it in a dozen places. A club whose
      // gold went out undarkened would put cream on gold, and nobody reads that.
      "cream on accent": contrast(CREAM, p.accent)
    };
    for (const [what, ratio] of Object.entries(pairs)) {
      assert.ok(ratio >= AA, `${code}: ${what} is ${ratio.toFixed(2)}:1, under AA`);
    }
  }
});

// Body text at 9:1 and dim text at 8:1 are both just "text". The DMG's dim tone
// falls to about half its ink's contrast, and that gap is the whole reason a
// four-tone screen has four tones.
test("dim text actually reads as dimmer than ink", () => {
  for (const [code, colors] of Object.entries(FRANCHISE_COLORS)) {
    const p = derivePalette(colors);
    const ink = contrast(p.ink, p.paper);
    const dim = contrast(p.dim, p.paper);
    assert.ok(dim < ink * 0.75, `${code}: dim (${dim.toFixed(2)}) is not clearly under ink (${ink.toFixed(2)})`);
  }
});

test("ink clears AAA, because most of the screen is body text", () => {
  for (const [code, colors] of Object.entries(FRANCHISE_COLORS)) {
    const p = derivePalette(colors);
    const ratio = contrast(p.ink, p.paper);
    assert.ok(ratio >= 7, `${code}: ink is ${ratio.toFixed(2)}:1, under AAA`);
  }
});

test("a franchise universe resolves; anything else leaves the sign alone", () => {
  assert.equal(franchiseCode("franchise-SEA"), "SEA");
  assert.equal(franchiseCode("franchise-ZZZ"), null);
  assert.equal(franchiseCode("classic"), null);
  assert.equal(franchiseCode("decade-1990"), null);
  assert.equal(franchiseCode(null), null);

  assert.ok(franchisePalette("franchise-SEA"));
  assert.equal(franchisePalette("classic"), null);
});

// The Orioles are an orange team whose ink is black, on purpose: orange cannot
// carry a lineup card. If someone "fixes" that, this is the test that argues.
test("clubs whose famous color is too light keep it as the accent, not the ink", () => {
  for (const code of ["BAL", "SFG", "PIT", "OAK", "SDP"]) {
    const p = derivePalette(FRANCHISE_COLORS[code]);
    assert.ok(contrast(p.ink, p.paper) >= 7, `${code}: ink must still carry text`);
    assert.ok(contrast(CREAM, p.accent) >= AA, `${code}: accent must still hold cream text`);
  }
});

// The button is the one place a club gets to be the color it actually is, so
// whatever ends up on it has to be readable — that is the price of the brightness.
test("every club's button can be read", () => {
  for (const [code, colors] of Object.entries(FRANCHISE_COLORS)) {
    const p = derivePalette(colors);
    const ratio = contrast(p.accentInk, p.accentBright);
    assert.ok(ratio >= AA, `${code}: button text is ${ratio.toFixed(2)}:1 on the fill, under AA`);
  }
});

// The whole point of the exercise. Pittsburgh is a gold team; a Pittsburgh that
// renders brown is a bug, however legible the brown is. The button fill must
// stay recognisably the club's color — near it in hue, and nowhere near as dark
// as the text-safe accent it used to be forced into.
test("the golds and the oranges actually come out gold and orange", () => {
  const vivid = { PIT: "#FDB827", OAK: "#EFB21E", SDP: "#FFC425", MIL: "#FFC52F", BAL: "#DF4601", SFG: "#FD5A1E" };
  for (const [code, want] of Object.entries(vivid)) {
    const p = derivePalette(FRANCHISE_COLORS[code]);
    // Luminance is the tell: the deepened accent is dark enough to read as text
    // on cream, so anything that bright is a fill that never got flattened.
    const flattened = luminance(p.accent);
    const onButton = luminance(p.accentBright);
    assert.ok(
      onButton > flattened * 2,
      `${code}: the button fill (${p.accentBright}) is no brighter than the text-safe accent (${p.accent}) — the club lost its color`
    );
    assert.ok(luminance(want) / onButton < 1.6 && onButton / luminance(want) < 1.6,
      `${code}: the button fill (${p.accentBright}) has drifted too far from the club's ${want}`);
  }
});
