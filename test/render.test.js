import test from "node:test";
import assert from "node:assert/strict";
import { renderBoxScore, renderDraftHistoryTable, renderLineScore, renderPlayerTable, renderWinProbabilityChart, topSwingRanks } from "../src/ui/render.js";
import { cardPanelHtml } from "../src/ui/cardFace.js";

const hitter = {
  id: "h-1",
  kind: "hitter",
  name: "Preview Hitter",
  position: "CF",
  bats: "R",
  onBase: 10,
  speed: 14,
  fielding: 2,
  points: 320,
  chart: [{ from: 1, to: 20, result: "1B" }]
};

const pitcher = {
  id: "p-1",
  kind: "pitcher",
  name: "Preview Pitcher",
  role: "SP",
  throws: "R",
  control: 5,
  ip: 6,
  points: 300,
  chart: [{ from: 1, to: 20, result: "SO" }]
};

const game = {
  boxScore: {
    away: {
      team: "Away",
      hitters: [{ id: "h-1", name: "Preview Hitter", ab: 3, r: 1, h: 2, bb: 1, so: 0, hr: 1, sb: 1, cs: 1, rbi: 3 }],
      pitchers: [{ id: "p-1", name: "Preview Pitcher", outs: 18, h: 4, bb: 2, so: 7, hr: 1, r: 2 }]
    },
    home: {
      team: "Home",
      hitters: [{ name: "Fallback Hitter", ab: 4, r: 0, h: 1, bb: 0, so: 1, hr: 0, sb: 0, cs: 0, rbi: 0 }],
      pitchers: [{ name: "Unknown Pitcher", outs: 15, h: 5, bb: 1, so: 3, hr: 0, r: 1 }]
    }
  }
};

test("renderBoxScore adds hover previews when player cards can be resolved", () => {
  const players = new Map([
    [hitter.id, hitter],
    [pitcher.id, pitcher],
    ["Home::Fallback Hitter", { ...hitter, id: "h-2", name: "Fallback Hitter" }]
  ]);

  const html = renderBoxScore(game, players);

  assert.equal((html.match(/class="player-name-preview box-score-player-name"/g) ?? []).length, 3);
  assert.ok(html.includes('data-preview-id="h-1"'));
  assert.ok(html.includes('data-preview-id="p-1"'));
  assert.ok(html.includes('data-preview-id="h-2"'));
  assert.ok(html.includes('<th class="num">CS</th>'));
  assert.ok(html.includes("Unknown Pitcher"));
});

test("the game box score opens with an inning line score and R/H totals", () => {
  const lineGame = {
    away: { name: "Visitors", runs: 3 },
    home: { name: "Hosts", runs: 2 },
    innings: 9,
    lineScore: {
      away: [1, 0, 0, 0, 2],
      home: [0, 1, 0, 1]
    },
    events: [
      { inning: 1, half: "top", runs: 1 },
      { inning: 1, half: "bottom", runs: 0 },
      ...Array.from({ length: 7 }, (unused, index) => ([
        { inning: index + 2, half: "top", runs: index === 3 ? 2 : 0 },
        { inning: index + 2, half: "bottom", runs: index === 0 || index === 2 ? 1 : 0 }
      ])).flat(),
      { inning: 9, half: "top", runs: 0 }
    ],
    boxScore: {
      away: { team: "Visitors", hitters: [{ h: 2 }, { h: 4 }], pitchers: [] },
      home: { team: "Hosts", hitters: [{ h: 3 }, { h: 2 }], pitchers: [] }
    }
  };

  const html = renderLineScore(lineGame);
  assert.match(html, /aria-label="Inning-by-inning line score"/);
  assert.match(html, /<th scope="row">Visitors<\/th>/);
  assert.match(html, /<th scope="row">Hosts<\/th>/);
  assert.match(html, /title="Did not bat">—<\/td>/);
  assert.match(html, /<td class="line-score-total">3<\/td>\s*<td class="line-score-total">6<\/td>/);
  assert.match(html, /<td class="line-score-total">2<\/td>\s*<td class="line-score-total">5<\/td>/);
  assert.ok(renderBoxScore(lineGame).indexOf("game-line-score") < renderBoxScore(lineGame).indexOf("Visitors hitters"));
});

// Leverage comes off the MLB table, so these situations carry real numbers: a
// first-inning plate appearance with the bases empty is 0.86, a tie in the
// bottom of the ninth with a man on second is 4.01, and the bases loaded down
// one with two gone is 10.39 — the biggest spot the game has.
const quiet = { inning: 1, half: "top", outsBefore: 0, basesBefore: [null, null, null], scoreBefore: { away: 0, home: 0 } };
const blowout = { inning: 8, half: "top", outsBefore: 0, basesBefore: [null, null, null], scoreBefore: { away: 12, home: 3 } };
const jam = { inning: 9, half: "bottom", outsBefore: 1, basesBefore: [null, "Runner", null], scoreBefore: { away: 3, home: 3 } };
const loaded = { inning: 9, half: "bottom", outsBefore: 2, basesBefore: ["A", "B", "C"], scoreBefore: { away: 4, home: 3 } };
// 1.84: over the shading line, well under the ceiling, so it shades lighter.
const middling = { inning: 6, half: "bottom", outsBefore: 1, basesBefore: ["Runner", null, null], scoreBefore: { away: 2, home: 2 } };

function chartEvent(situation, wpa, wpBefore) {
  return {
    ...situation,
    batter: "Batter",
    pitcher: "Pitcher",
    result: "1B",
    wpa,
    wpBefore,
    wpAfter: wpBefore + wpa
  };
}

// Ordered so the two tense plays are adjacent (they must merge into one band)
// and the third sits apart (it must not).
const chartGame = {
  events: [
    chartEvent(quiet, 0.02, 0.5),
    chartEvent(jam, 0.3, 0.52),
    chartEvent(loaded, -0.3, 0.82),
    chartEvent(blowout, 0.05, 0.52),
    chartEvent(middling, 0.12, 0.57),
    chartEvent(blowout, 0.11, 0.69)
  ]
};

test("the biggest swings are ranked by how far they moved the game, ties by order", () => {
  assert.deepEqual([...topSwingRanks(chartGame.events).entries()], [[1, 1], [2, 2], [4, 3]]);
  assert.equal(topSwingRanks(chartGame.events, 1).size, 1);
  assert.equal(topSwingRanks([]).size, 0);
  // A play the engine never scored can't be ranked against the ones it did.
  assert.equal(topSwingRanks([{ wpa: null }, { wpa: undefined }]).size, 0);
});

test("the win probability chart shades tense stretches and numbers the biggest swings", () => {
  const html = renderWinProbabilityChart(chartGame);

  // Two bands, not three: the adjacent pair is one stretch.
  assert.equal((html.match(/class="wp-leverage-band"/g) ?? []).length, 2);
  // Darker for the bigger jam, and never past the ceiling.
  const opacities = [...html.matchAll(/fill-opacity="([\d.]+)"/g)].map((match) => Number(match[1]));
  assert.equal(opacities.length, 2);
  assert.ok(opacities.every((value) => value >= 0.07 && value <= 0.2), `bands out of range: ${opacities}`);
  assert.ok(opacities[0] > opacities[1], "the ninth-inning jam shades darker than the sixth-inning spot");
  // The ninth-inning pair peaks at 10.39, far past the 4.0 ceiling, and stops
  // there — the darkest band is a fixed shade, not an unbounded one.
  assert.equal(opacities[0], 0.2);

  // Three numbered markers, and the plain dot for the fourth big swing.
  assert.match(html, /class="wp-swing-rank">1</);
  assert.match(html, /class="wp-swing-rank">2</);
  assert.match(html, /class="wp-swing-rank">3</);
  assert.doesNotMatch(html, /class="wp-swing-rank">4</);
  assert.equal((html.match(/class="wp-swing-dot"/g) ?? []).length, 1);

  // Every play is a jump target, markers included, and the markers take focus.
  for (let index = 0; index < chartGame.events.length; index += 1) {
    assert.ok(html.includes(`data-wp-play-index="${index}"`), `play ${index} has no jump target`);
  }
  assert.match(html, /class="wp-swing-marker" tabindex="0" role="button"/);
  assert.match(html, /aria-label="Jump to play 2:/);
});

test("a game with nothing at stake gets no shading", () => {
  const html = renderWinProbabilityChart({
    events: [chartEvent(blowout, 0.01, 0.9), chartEvent(blowout, 0.01, 0.91), chartEvent(quiet, 0.01, 0.92)]
  });
  assert.ok(html.includes("wp-chart"));
  assert.doesNotMatch(html, /wp-leverage-band/);
});

test("draft recap can sort by pick, paid, points, and WPA", () => {
  const picks = [
    { pickNumber: 1, round: 1, manager: { name: "First" }, player: { ...hitter, id: "paid-20", name: "Twenty", points: 200 }, price: 20 },
    { pickNumber: 2, round: 1, manager: { name: "Second" }, player: { ...hitter, id: "paid-100", name: "Hundred", points: 300 }, price: 100 },
    { pickNumber: 3, round: 1, manager: { name: "Third" }, player: { ...hitter, id: "paid-50", name: "Fifty", points: 400 }, price: 50 }
  ];
  const wpaByPlayerId = new Map([
    ["paid-20", 0.1],
    ["paid-100", -0.2],
    ["paid-50", 0.5]
  ]);

  const paid = renderDraftHistoryTable(picks, { sort: "paid", sortDirection: "desc", wpaByPlayerId });
  assert.ok(paid.indexOf("Hundred") < paid.indexOf("Fifty"));
  assert.ok(paid.indexOf("Fifty") < paid.indexOf("Twenty"));
  assert.ok(paid.includes('data-history-sort="paid"'));

  const points = renderDraftHistoryTable(picks, { sort: "points", sortDirection: "desc", wpaByPlayerId });
  assert.ok(points.indexOf("Fifty") < points.indexOf("Hundred"));
  assert.ok(points.indexOf("Hundred") < points.indexOf("Twenty"));

  const wpa = renderDraftHistoryTable(picks, { sort: "wpa", sortDirection: "desc", wpaByPlayerId });
  assert.ok(wpa.indexOf("Fifty") < wpa.indexOf("Twenty"));
  assert.ok(wpa.indexOf("Twenty") < wpa.indexOf("Hundred"));

  const pick = renderDraftHistoryTable(picks, { sort: "pick", direction: "desc", wpaByPlayerId });
  assert.ok(pick.indexOf("Fifty") < pick.indexOf("Hundred"));
  assert.ok(pick.indexOf("Hundred") < pick.indexOf("Twenty"));
  assert.ok(pick.includes('aria-sort="descending"'));

  const hiddenPoints = renderDraftHistoryTable(picks, { sort: "points", sortDirection: "desc", hidePoints: true });
  assert.ok(hiddenPoints.indexOf("Twenty") < hiddenPoints.indexOf("Hundred"));
  assert.ok(hiddenPoints.indexOf("Hundred") < hiddenPoints.indexOf("Fifty"));
  assert.ok(!hiddenPoints.includes('data-history-sort="points"'));
});

test("draft ranking inputs are blank for unranked players and numbered for ranked players", () => {
  const secondHitter = { ...hitter, id: "h-2", name: "Second Hitter" };
  const manualRanking = {
    ids: [secondHitter.id],
    rankById: new Map([[secondHitter.id, 1]]),
    maxRank: 2
  };
  const html = renderPlayerTable([secondHitter, hitter], {
    mode: "hitter",
    manualRanking,
    sort: "primary",
    sortDirection: "desc"
  });

  assert.match(html, /data-ranking-input-id="h-2"[^>]*aria-label="Rank Second Hitter"/);
  assert.match(html, /data-ranking-input-id="h-1"[^>]*aria-label="Rank Preview Hitter"/);
  assert.match(html, /value="1"[\s\S]*data-ranking-input-id="h-2"/);
  assert.match(html, /value=""[\s\S]*data-ranking-input-id="h-1"/);
  assert.match(html, /class="draft-player-row first-unranked-row manual-ranking-row"/);
});

test("replacement-level players are called out in the draft table, naming their groups", () => {
  const html = renderPlayerTable([hitter], {
    mode: "hitter",
    replacementLevels: new Map([[hitter.id, ["C", "DH"]]])
  });

  assert.match(html, /class="draft-player-row replacement-level-row"/);
  assert.match(html, /class="replacement-level-badge"[^>]*>Replacement level<\/span>/);
  assert.match(html, /still available at C and DH/);
  assert.match(html, /current free fallback if a roster finishes with a hole/);
});

test("fictional card backdrops vary by id but remain deterministic", () => {
  const backdrop = (card) => /gq-backdrop-([a-z]+)/.exec(cardPanelHtml(card))?.[1];
  const first = backdrop(hitter);

  assert.equal(backdrop(hitter), first);
  const variants = new Set(
    Array.from({ length: 200 }, (_, index) => backdrop({ ...hitter, id: `fake-${index}` }))
  );
  assert.deepEqual(variants, new Set([
    "day", "sunset", "night", "ivy", "brick", "dome",
    "aqua", "violet", "citrus", "lagoon", "plum", "denim",
    "mint", "berry", "amber", "teal", "orchid", "slate",
    "salmon", "indigo", "jade", "wine", "ice", "peach"
  ]));
  assert.equal(backdrop({ ...hitter, id: "real-hitter", real: true }), undefined);
});

test("fictional hitters and pitchers use the finalized 2005 card template", () => {
  const hitterHtml = cardPanelHtml(hitter);
  const pitcherHtml = cardPanelHtml(pitcher);
  const legendaryHtml = cardPanelHtml({ ...hitter, rarity: "legend" });
  const goldenHtml = cardPanelHtml({ ...hitter, rarity: "legend", egg: "golden" });

  assert.ok(hitterHtml.includes("gq-proto-card gq-proto-hitter"));
  assert.ok(hitterHtml.includes("2004-Hitter-BLUE-NO-FOOTER.png"));
  assert.ok(hitterHtml.includes("api.dicebear.com/10.x/micah/svg"));
  assert.ok(hitterHtml.includes("clothesVariant=crew"));
  assert.ok(hitterHtml.includes("gq-proto-frame-top"));
  assert.ok(hitterHtml.includes("gq-proto-frame-bottom"));
  assert.ok(hitterHtml.includes("gq-proto-onbase"));
  assert.ok(hitterHtml.includes("1B+"));

  assert.ok(pitcherHtml.includes("gq-proto-card gq-proto-pitcher"));
  assert.ok(pitcherHtml.includes("2004-Pitcher-BLUE-NO-FOOTER-NO-RIBBON.png"));
  assert.ok(pitcherHtml.includes("gq-proto-frame-top"));
  assert.ok(pitcherHtml.includes("gq-proto-frame-bottom"));
  assert.ok(pitcherHtml.includes("gq-proto-baseball"));
  assert.ok(pitcherHtml.includes('class="gq-proto-control-plus">+</span>'));
  assert.ok(pitcherHtml.includes("CONTROL"));

  assert.ok(legendaryHtml.includes('class="gq-proto-rainbow-word"'));
  assert.ok(legendaryHtml.includes('aria-label="LEGENDARY"'));
  assert.ok(goldenHtml.includes("gq-proto-rarity-legendary gq-proto-golden"));
  assert.ok(goldenHtml.includes('<span class="gq-proto-rarity-mark">1/1</span>'));
});
