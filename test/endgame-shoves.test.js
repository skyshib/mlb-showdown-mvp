import test from "node:test";
import assert from "node:assert/strict";
import { ENDGAME_SHOVE_ROUNDS, endgameShoves } from "../src/rules/endgameShoves.js";
import { computeAwards } from "../src/rules/awards.js";
import { valuePicks } from "../src/rules/ceremony.js";

// Twelve cards bought in twelve lots. Price and worth run together — $100 buys
// one win — so the fit through the cloud is a known line, and three cards are
// placed deliberately off it.
const CARDS = [
  { id: "a", lot: 1, price: 100, worth: 1 },
  { id: "b", lot: 2, price: 900, worth: 0 }, // an early overpay: his own fault
  { id: "c", lot: 3, price: 300, worth: 3 },
  { id: "d", lot: 4, price: 400, worth: 4 },
  { id: "e", lot: 5, price: 500, worth: 5 },
  { id: "f", lot: 6, price: 600, worth: 6 },
  { id: "g", lot: 7, price: 200, worth: 2 },
  { id: "h", lot: 8, price: 800, worth: 8 },
  { id: "i", lot: 9, price: 700, worth: 7 },
  { id: "j", lot: 10, price: 600, worth: 0 }, // the closing shove
  { id: "k", lot: 11, price: 100, worth: 6 }, // a closing buy that produced
  { id: "l", lot: 12, price: 1000, worth: 10 }
];

function shoveArgs(overrides = {}) {
  const half = Math.ceil(CARDS.length / 2);
  return {
    summary: {
      attribution: true,
      hitters: CARDS.slice(0, half).map((card) => ({ id: card.id, warPer162: { total: card.worth } })),
      pitchers: CARDS.slice(half).map((card) => ({ id: card.id, warPer162: { total: card.worth } }))
    },
    options: {
      prices: Object.fromEntries(CARDS.map((card) => [card.id, card.price])),
      order: Object.fromEntries(CARDS.map((card) => [card.id, card.lot])),
      // Two managers, two rounds: the closing phase is the last four lots.
      perRound: 2,
      rounds: 2,
      ...overrides
    }
  };
}

test("a closing buy right of the trend line is a shove; one left of it is not", () => {
  const { summary, options } = shoveArgs();
  const shoves = endgameShoves(summary, options);
  assert.deepEqual([...shoves], ["j"], "only the closing lot that underpaid its price");
  assert.ok(!shoves.has("b"), "an overpay in the second lot is a judgment, not a shove");
  assert.ok(!shoves.has("k"), "a closing buy that beat the line was a good buy");
  assert.ok(!shoves.has("l"), "a closing buy on the line is not off it");
});

test("the closing phase is the last five rounds unless told otherwise", () => {
  const { summary, options } = shoveArgs();
  assert.equal(ENDGAME_SHOVE_ROUNDS, 5);
  const { rounds, ...rest } = options;
  // Five rounds of two managers reaches back to the third lot, so the overpay in
  // the second is still judged — and the shove is still caught.
  const wide = endgameShoves(summary, rest);
  assert.ok(wide.has("j"));
  assert.ok(!wide.has("b"), "lot 2 is outside even a ten-lot window");
  // A window of one round only reaches the last two lots, and neither of those
  // is off the line on the low side.
  assert.deepEqual([...endgameShoves(summary, { ...rest, rounds: 1 })], []);
});

test("a room that paid no money has no shoves", () => {
  const { summary, options } = shoveArgs();
  assert.deepEqual([...endgameShoves(summary, { ...options, prices: null })], []);
  assert.deepEqual([...endgameShoves(summary, { ...options, order: null })], []);
  assert.deepEqual([...endgameShoves(summary, { ...options, perRound: 0 })], []);
  // Nothing to fit a line through.
  assert.deepEqual([...endgameShoves({ hitters: [], pitchers: [] }, options)], []);
});

// ---- what the boards do with them -------------------------------------------

function line(id, worth, extra = {}) {
  return {
    id,
    name: id.toUpperCase(),
    team: "Team 1",
    pa: 600,
    outs: 600,
    bf: 900,
    role: "SP",
    obp: 0.33,
    avg: 0.27,
    bb: 50,
    hr: 10,
    hrPer162: 10,
    r: 60,
    rPer162: 60,
    sb: 2,
    sbPer162: 2,
    cs: 1,
    ipPer162: 200,
    teamGames: 162,
    runsPerNine: 4,
    strikeoutsPerNine: 8,
    wpaPerSeason: worth / 100,
    wpaPer162: worth,
    warPer162: { total: worth },
    ...extra
  };
}

const BOARD = {
  runs: 100,
  attribution: true,
  teams: [{ team: "Team 1" }, { team: "Team 2" }],
  hitters: [line("h1", 6), line("h2", 4), line("h3", 2), line("h4", -3), line("h5", -4)],
  pitchers: [line("p1", 5), line("p2", 3), line("p3", 1), line("p4", -2)]
};
const BOARD_PRICES = { h1: 600, h2: 400, h3: 200, h4: 900, h5: 150, p1: 500, p2: 300, p3: 100, p4: 800 };
const BOARD_PICKS = { h1: 1, h2: 3, h3: 5, h4: 7, h5: 9, p1: 2, p2: 4, p3: 6, p4: 8 };

test("a closing shove cannot win the bust", () => {
  const named = (shoves) => Object.fromEntries(
    computeAwards(BOARD, BOARD_PICKS, BOARD_PRICES, {}, { shoves }).map((item) => [item.key, item.name])
  );
  // $900 for the second-worst bat in the room is the bust of the auction — until
  // the $900 turns out to have been the last of a purse with nowhere to go.
  assert.equal(named(null)["bust-hitter"], "H4");
  assert.equal(named(new Set(["h4"]))["bust-hitter"], undefined, "and no other premium bat beat his price");
  assert.equal(named(new Set(["h4"]))["bust-pitcher"], "P4", "the arms are judged as they were");
  // The steal is untouched: a shove that produced is still a bargain.
  assert.equal(named(new Set(["h4"]))["steal-hitter"], named(null)["steal-hitter"]);
});

test("the ceremony's worst-value board leaves a shove off, and keeps it on the best", () => {
  const worst = (shoves) => valuePicks(BOARD, BOARD_PRICES, { byMoney: true, shoves })
    .hitters.worst.map((row) => row.id);
  const best = (shoves) => valuePicks(BOARD, BOARD_PRICES, { byMoney: true, shoves })
    .hitters.best.map((row) => row.id);
  assert.equal(worst(null)[0], "h4");
  assert.ok(!worst(new Set(["h4"])).includes("h4"));
  assert.equal(worst(new Set(["h4"])).length, 3, "the board still runs three deep");
  assert.deepEqual(best(new Set(["h4"])), best(null), "the best end is unchanged");
});
