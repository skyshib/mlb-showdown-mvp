// The two colors each club is known by, keyed by the same franchise codes the
// pools use (MLB_FRANCHISE_NAMES in mlbPools.js).
//
// INK is the dark one — the color the club's cap is, the one you can print a
// name in. ACCENT is the pop: the orange on the black, the gold on the green.
//
// The split is not "primary and secondary" as a club's style guide would have
// it, and for a few clubs it deliberately disagrees with them. The Orioles are
// an orange team, but orange cannot be ink: on a cream sheet it comes in around
// 3:1, and a lineup card set in it is a lineup card nobody can read. So the
// Orioles are black with orange on it, which is also what an Orioles cap looks
// like. Same for the Giants and the Marlins. What matters here is which color
// can carry text and which color is the one you notice.
//
// The accent does NOT have to be dark — derivePalette darkens the golds and
// silvers on its own until they can hold cream text, because --accent is a fill
// under text in a dozen places in the draft. It only has to be the right hue.
//
// EXTRAS are the rest of the club's official palette — the third and fourth
// colors, in the club's own order, minus the two already spent above and minus
// white. They exist for the FLARE: the color a run is announced in, which cannot
// be the club's lead (see franchisePalette.js). Seattle is the case that proves
// the point — navy, Northwest green, silver, AND RED — and the red is what a
// Mariners run now scores in, rather than a teal that vanished into the teal
// banner. A club with no third color simply has none, and the solver falls back.
//
// Sourced from teamcolorcodes.com (which publishes each club's full palette);
// the primaries and secondaries agree with teampalettes.com. Half the league has
// nothing past two colors, and those entries are honestly empty rather than
// padded out with a guess.
export const FRANCHISE_COLORS = {
  ANA: { ink: "#BA0021", accent: "#003263", extras: ["#862633", "#C4CED4"] }, // Angels — red, navy + maroon, silver
  ARI: { ink: "#A71930", accent: "#E3D4AD", extras: ["#30CED8", "#000000"] }, // Diamondbacks — Sedona red, sand + turquoise, black
  ATL: { ink: "#13274F", accent: "#CE1141", extras: ["#EAAA00"] },            // Braves — navy, red + gold
  BAL: { ink: "#27251F", accent: "#DF4601" },                                 // Orioles — black, orange
  BOS: { ink: "#0C2340", accent: "#BD3039" },                                 // Red Sox — navy, red
  CHC: { ink: "#0E3386", accent: "#CC3433" },                                 // Cubs — blue, red
  CHW: { ink: "#27251F", accent: "#C4CED4" },                                 // White Sox — black, silver
  CIN: { ink: "#C6011F", accent: "#000000" },                                 // Reds — red, black
  CLE: { ink: "#0C2340", accent: "#E31937" },                                 // Cleveland — navy, red
  COL: { ink: "#33006F", accent: "#C4CED4", extras: ["#131413"] },            // Rockies — purple, silver + black
  DET: { ink: "#0C2340", accent: "#FA4616" },                                 // Tigers — navy, orange
  FLA: { ink: "#27251F", accent: "#00A3E0", extras: ["#EF3340", "#41748D"] }, // Marlins — black, Miami blue + red, slate
  HOU: { ink: "#002D62", accent: "#EB6E1F", extras: ["#F4911E"] },            // Astros — navy, orange + light orange
  KCR: { ink: "#004687", accent: "#BD9B60" },                                 // Royals — blue, gold
  LAD: { ink: "#005A9C", accent: "#EF3E42", extras: ["#A5ACAF"] },            // Dodgers — blue, red + silver
  MIL: { ink: "#12284B", accent: "#FFC52F" },                                 // Brewers — navy, gold
  MIN: { ink: "#002B5C", accent: "#D31145", extras: ["#B9975B"] },            // Twins — navy, red + gold
  NYM: { ink: "#002D72", accent: "#FF5910" },                                 // Mets — blue, orange
  NYY: { ink: "#0C2340", accent: "#C4CED3", extras: ["#E4002C", "#003087"] }, // Yankees — navy, grey + red, blue
  OAK: { ink: "#003831", accent: "#EFB21E", extras: ["#A2AAAD"] },            // Athletics — green, gold + grey
  PHI: { ink: "#C0102E", accent: "#284898" },                                 // Phillies — red, blue
  PIT: { ink: "#27251F", accent: "#FDB827" },                                 // Pirates — black, gold
  SDP: { ink: "#2F241D", accent: "#FFC425" },                                 // Padres — brown, gold
  SEA: { ink: "#0C2C56", accent: "#005C5C", extras: ["#D50032", "#C4CED4"] }, // Mariners — navy, teal + RED, silver
  SFG: { ink: "#27251F", accent: "#FD5A1E", extras: ["#AE8F6F", "#EFD19F"] }, // Giants — black, orange + bronze, sand
  STL: { ink: "#C41E3A", accent: "#0A2252", extras: ["#FEDB00"] },            // Cardinals — red, navy + yellow
  TBD: { ink: "#092C5C", accent: "#8FBCE6", extras: ["#F5D130"] },            // Rays — navy, columbia blue + yellow
  TEX: { ink: "#003278", accent: "#C0111F" },                                 // Rangers — blue, red
  TOR: { ink: "#134A8E", accent: "#E8291C", extras: ["#1D2D5C"] },            // Blue Jays — blue, red + navy
  WSN: { ink: "#AB0003", accent: "#14225A" }                                  // Nationals — red, navy
};

// The universe key a franchise pool travels under is `franchise-XXX`.
export function franchiseCode(universeKey) {
  const match = /^franchise-([A-Z]{2,3})$/.exec(universeKey ?? "");
  return match && FRANCHISE_COLORS[match[1]] ? match[1] : null;
}
