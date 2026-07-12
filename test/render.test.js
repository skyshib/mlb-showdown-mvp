import test from "node:test";
import assert from "node:assert/strict";
import { renderBoxScore } from "../src/ui/render.js";
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
  assert.ok(html.includes("<th>CS</th>"));
  assert.ok(html.includes("Unknown Pitcher"));
});

test("fictional card backdrops vary by id but remain deterministic", () => {
  const backdrop = (card) => /gq-backdrop-([a-z]+)/.exec(cardPanelHtml(card))?.[1];
  const first = backdrop(hitter);

  assert.equal(backdrop(hitter), first);
  const variants = new Set(
    Array.from({ length: 20 }, (_, index) => backdrop({ ...hitter, id: `fake-${index}` }))
  );
  assert.deepEqual(variants, new Set(["day", "sunset", "night", "ivy", "brick", "dome"]));
  assert.equal(backdrop({ ...hitter, id: "real-hitter", real: true }), undefined);
});

test("fictional hitters and pitchers use the finalized 2005 card template", () => {
  const hitterHtml = cardPanelHtml(hitter);
  const pitcherHtml = cardPanelHtml(pitcher);

  assert.ok(hitterHtml.includes("gq-proto-card gq-proto-hitter"));
  assert.ok(hitterHtml.includes("2004-Hitter-BLUE-NO-FOOTER.png"));
  assert.ok(hitterHtml.includes("api.dicebear.com/9.x/micah/svg"));
  assert.ok(hitterHtml.includes("gq-proto-onbase"));
  assert.ok(hitterHtml.includes("1B+"));

  assert.ok(pitcherHtml.includes("gq-proto-card gq-proto-pitcher"));
  assert.ok(pitcherHtml.includes("2004-Pitcher-BLUE-NO-FOOTER-NO-RIBBON.png"));
  assert.ok(pitcherHtml.includes("gq-proto-baseball"));
  assert.ok(pitcherHtml.includes('class="gq-proto-control-plus">+</span>'));
  assert.ok(pitcherHtml.includes("CONTROL"));
});
