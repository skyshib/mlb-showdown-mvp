import test from "node:test";
import assert from "node:assert/strict";
import { buildEqualWorkGap, dominatedPicks } from "../src/rules/pickDominance.js";
import { reachAwards } from "../src/rules/awards.js";

const ALPHA = { id: "m-alpha", name: "Alpha" };
const BETA = { id: "m-beta", name: "Beta" };

function pick(pickNumber, manager, id, { price = null, slot = "SS", round = 1, ...rest } = {}) {
  return {
    pickNumber,
    round,
    manager,
    price,
    player: { id, name: id, kind: "hitter", position: slot, ...rest }
  };
}

// Every test hands the finder the slot each card filled and the WPAR it earned,
// which is exactly what the batch recap has on hand.
function run(picks, wpars, { auction = false, slots = {}, volumes = {} } = {}) {
  // Everyone works the same amount unless a case says otherwise, which makes the
  // workload-corrected gap equal to the plain difference in WPAR.
  const volumeById = new Map(Object.keys(wpars).map((id) => [id, volumes[id] ?? 100]));
  return dominatedPicks(picks, {
    auction,
    wparById: new Map(Object.entries(wpars)),
    volumeById,
    slotOf: (player) => slots[player.id] ?? player.position ?? player.role ?? null
  });
}

test("a snake pick is dominated by a better card at the same slot taken later", () => {
  const picks = [pick(1, ALPHA, "early-ss"), pick(2, BETA, "late-ss")];
  const result = run(picks, { "early-ss": 1.5, "late-ss": 4 });
  assert.equal(result.rows.length, 1);
  const [row] = result.rows;
  assert.equal(row.id, "early-ss");
  assert.equal(row.best.id, "late-ss");
  assert.equal(row.gap.toFixed(1), "2.5");
  assert.equal(row.waited, 1);
});

test("a card taken earlier was not on the board, however good he turned out", () => {
  const picks = [pick(1, BETA, "great-ss"), pick(2, ALPHA, "weak-ss")];
  const result = run(picks, { "great-ss": 6, "weak-ss": 1 });
  assert.deepEqual(result.rows, []);
  assert.equal(result.considered, 2);
});

test("a better card at a different slot is no alternative", () => {
  const picks = [pick(1, ALPHA, "ss", { slot: "SS" }), pick(2, BETA, "first", { slot: "1B" })];
  const result = run(picks, { ss: 1, first: 9 });
  assert.deepEqual(result.rows, []);
});

test("an SP is never allowed to dominate an RP", () => {
  const picks = [
    pick(1, ALPHA, "closer", { slot: "RP", role: "RP" }),
    pick(2, BETA, "ace", { slot: "SP", role: "SP" })
  ];
  const result = run(picks, { closer: 2, ace: 8 }, { slots: { closer: "RP", ace: "SP" } });
  assert.deepEqual(result.rows, []);
});

test("a manager's own later pick is not held against his earlier one", () => {
  const picks = [pick(1, ALPHA, "first-ss"), pick(2, ALPHA, "second-ss")];
  const result = run(picks, { "first-ss": 1, "second-ss": 5 });
  assert.deepEqual(result.rows, []);
});

test("a snake alternative still unsold at the manager's next turn is flagged as one he could have waited for", () => {
  const picks = [
    pick(1, ALPHA, "early-ss"),
    pick(2, BETA, "beta-ss"),
    pick(3, ALPHA, "alpha-second", { slot: "1B" }),
    pick(4, BETA, "later-ss")
  ];
  const result = run(picks, { "early-ss": 1, "beta-ss": 2, "alpha-second": 1, "later-ss": 3 });
  const row = result.rows.find((item) => item.id === "early-ss");
  assert.ok(row, "the early pick is flagged");
  assert.equal(row.stillThereNextTurn, true, "a shortstop was still there after Alpha's next turn");
  const beta = row.alternatives.find((item) => item.id === "beta-ss");
  assert.equal(beta.stillThereNextTurn, false, "the one taken before that turn was not");
});

test("an auction pick is dominated only by a card that was both unsold and no dearer", () => {
  const picks = [
    pick(1, ALPHA, "pricey", { price: 200 }),
    pick(2, BETA, "cheap-better", { price: 80 }),
    pick(3, BETA, "dear-better", { price: 400 })
  ];
  const result = run(picks, { pricey: 2, "cheap-better": 5, "dear-better": 9 }, { auction: true });
  assert.equal(result.rows.length, 1);
  const [row] = result.rows;
  assert.equal(row.id, "pricey");
  assert.deepEqual(row.alternatives.map((item) => item.id), ["cheap-better"]);
  assert.equal(row.saved, 120);
  assert.equal(row.gap.toFixed(1), "3.0");
});

test("an equal card for less money is dominance too, and an equal card for the same money is not", () => {
  const picks = [
    pick(1, ALPHA, "paid-up", { price: 150 }),
    pick(2, BETA, "same-price", { price: 150 }),
    pick(3, BETA, "less-money", { price: 90 })
  ];
  const result = run(picks, { "paid-up": 3, "same-price": 3, "less-money": 3 }, { auction: true });
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0].alternatives.map((item) => item.id), ["less-money"]);
  assert.equal(result.rows[0].gap.toFixed(1), "0.0");
  assert.equal(result.rows[0].saved, 60);
});

test("the best card and the biggest saving are reported separately", () => {
  const picks = [
    pick(1, ALPHA, "pricey", { price: 300 }),
    pick(2, BETA, "best-card", { price: 250 }),
    pick(3, BETA, "biggest-saving", { price: 20 })
  ];
  const result = run(picks, { pricey: 1, "best-card": 7, "biggest-saving": 2 }, { auction: true });
  const [row] = result.rows;
  assert.equal(row.best.id, "best-card");
  assert.equal(row.cheapest.id, "biggest-saving");
  assert.equal(row.saved, 50, "the headline saving is the best card's");
  const alpha = result.byManager.find((item) => item.managerId === ALPHA.id);
  assert.equal(alpha.savings, 280, "the manager's savings read off the cheapest alternative");
});

test("coaches, swept replacements and unmeasured cards are left out of the test", () => {
  const picks = [
    pick(1, ALPHA, "coach", { kind: "coach" }),
    pick(2, ALPHA, "swept", { replacement: true }),
    pick(3, ALPHA, "no-stats"),
    pick(4, BETA, "measured")
  ];
  const result = run(picks, { coach: 0, swept: 9, measured: 9 });
  assert.equal(result.considered, 1, "only the one measured, chosen card counts");
  assert.deepEqual(result.rows, []);
});

test("every manager gets a line, dominated or not", () => {
  const picks = [pick(1, ALPHA, "early-ss"), pick(2, BETA, "late-ss")];
  const result = run(picks, { "early-ss": 1, "late-ss": 4 });
  assert.deepEqual(
    result.byManager.map((row) => [row.name, row.picks, row.dominated]),
    [["Alpha", 1, 1], ["Beta", 1, 0]]
  );
  assert.equal(result.byManager[0].wparLeftBehind.toFixed(1), "3.0");
});

// The reach award reads straight off the dominance rows, so it is tested beside
// them rather than with the awards that are computed from a batch summary.
function reachRow(slot, gap, { name = "Taken", bestName = "Left", order = 9, price = 20, waited = 4 } = {}) {
  return {
    id: name,
    name,
    managerName: "Alpha",
    slot,
    gap,
    waited,
    best: { name: bestName, order, price }
  };
}

test("the reach award names the best bat and the best arm left on the board", () => {
  const rows = [
    reachRow("SS", 1.2, { name: "Small Miss", bestName: "Better SS" }),
    reachRow("1B", 4.5, { name: "Big Miss", bestName: "Better 1B", order: 31 }),
    reachRow("SP", 9.9, { name: "Arm Miss", bestName: "Better SP", order: 44 })
  ];
  const awards = reachAwards(rows);
  assert.deepEqual(awards.map((item) => item.key), ["reach-hitter", "reach-pitcher"]);
  assert.equal(awards[0].name, "Big Miss", "the biggest bat gap wins the hitter award");
  assert.match(awards[0].stat, /\+4\.5 WPAR\/162 left at 1B/);
  assert.match(awards[0].note, /Better 1B was still on the board, and went at pick 31/);
  assert.equal(awards[1].name, "Arm Miss", "arms are ranked among themselves");
});

test("an auction reach is worded in lots and dollars", () => {
  const awards = reachAwards([reachRow("CF", 3, { name: "Overpaid", bestName: "Cheaper CF", price: 45, waited: 1 })], { byMoney: true });
  assert.equal(awards.length, 1);
  assert.equal(awards[0].label, "Reach of the auction (hitter)");
  assert.match(awards[0].note, /Cheaper CF went 1 lot later for \$45/);
});

test("no reach award is given where nothing was beaten", () => {
  assert.deepEqual(reachAwards([]), []);
  assert.deepEqual(reachAwards([reachRow("SS", 0)]), [], "a zero gap is not a reach");
});

// ---- workload ----------------------------------------------------------------
//
// An arm's WPAR total is mostly a statement about the staff around him: the
// engine rides whoever is best in the pen, and a starter in front of a thin
// rotation takes the ball far more often. These cases pin the correction.

test("an arm who only out-totals the pick by facing more batters does not beat him", () => {
  const picks = [
    pick(1, ALPHA, "sharp", { slot: "SP", role: "SP" }),
    pick(2, BETA, "bulk", { slot: "SP", role: "SP" })
  ];
  // Bulk wins on the total (14.4 to 12.4) and loses badly per batter faced.
  const result = run(picks, { sharp: 12.4, bulk: 14.4 }, {
    slots: { sharp: "SP", bulk: "SP" },
    volumes: { sharp: 1021, bulk: 2546 }
  });
  assert.deepEqual(result.rows, [], "the bigger total is all workload");
});

test("a better rate over far less work is not a swap either — the workhorse keeps his credit", () => {
  const picks = [
    pick(1, ALPHA, "workhorse", { slot: "SP", role: "SP" }),
    pick(2, BETA, "efficient", { slot: "SP", role: "SP" })
  ];
  // Efficient is twice the arm per batter faced and still trails on the season,
  // because he was only given 800 batters against the workhorse's 2000.
  const result = run(picks, { workhorse: 10, efficient: 8 }, {
    slots: { workhorse: "SP", efficient: "SP" },
    volumes: { workhorse: 2000, efficient: 800 }
  });
  assert.deepEqual(result.rows, [], "beating one of the two counts is not beating the pick");
});

test("an arm who clears the pick on both counts is a swap, and the gap is bracketed", () => {
  const picks = [
    pick(1, ALPHA, "taken", { slot: "SP", role: "SP" }),
    pick(2, BETA, "better", { slot: "SP", role: "SP" })
  ];
  // 0.01 a batter over 1200 against 0.008 over 1000: ahead on the season (12 to
  // 8) and ahead per batter faced.
  const result = run(picks, { taken: 8, better: 12 }, {
    slots: { taken: "SP", better: "SP" },
    volumes: { taken: 1000, better: 1200 }
  });
  assert.equal(result.rows.length, 1);
  const [row] = result.rows;
  assert.equal(row.gap.toFixed(1), "2.0", "the floor: his rate over the work that was there");
  assert.equal(row.rawGap.toFixed(1), "4.0", "the ceiling: the plain difference in totals");
  assert.equal(row.fromVolume.toFixed(1), "2.0", "the rest is work the pick was never offered");
  assert.ok(row.gap > 0 && row.rawGap > 0, "both readings are positive for a surviving row");
});

test("the rate gap and the work gap add back to the raw difference", () => {
  const picks = [
    pick(1, ALPHA, "taken", { slot: "SP", role: "SP" }),
    pick(2, BETA, "left", { slot: "SP", role: "SP" })
  ];
  const result = run(picks, { taken: 5.6, left: 14.4 }, {
    slots: { taken: "SP", left: "SP" },
    volumes: { taken: 486, left: 900 }
  });
  assert.equal(result.rows.length, 1);
  const [row] = result.rows;
  assert.equal((row.gap + row.fromVolume).toFixed(6), (row.rawGap).toFixed(6));
  assert.ok(row.fromVolume > row.gap, "most of this one is workload");
});

test("bats are compared over plate appearances the same way", () => {
  const picks = [pick(1, ALPHA, "thin"), pick(2, BETA, "everyday")];
  // Everyday is ahead on the season and ahead per trip to the plate.
  const result = run(picks, { thin: 4, everyday: 9 }, {
    volumes: { thin: 500, everyday: 700 }
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].gap.toFixed(1), "2.4");

  // The same bat, now ahead per trip but behind on the season, is not a swap.
  const quiet = run(
    [pick(1, ALPHA, "thin"), pick(2, BETA, "cameo")],
    { thin: 4, cameo: 3 },
    { volumes: { thin: 500, cameo: 100 } }
  );
  assert.deepEqual(quiet.rows, []);
});

test("a card with no recorded workload is left out rather than guessed at", () => {
  const picks = [pick(1, ALPHA, "known"), pick(2, BETA, "unmeasured")];
  const result = dominatedPicks(picks, {
    wparById: new Map([["known", 1], ["unmeasured", 9]]),
    volumeById: new Map([["known", 100]]),
    slotOf: (player) => player.position
  });
  assert.equal(result.considered, 1);
  assert.deepEqual(result.rows, []);
});

test("a sim that recorded no workload at all falls back to comparing totals", () => {
  const picks = [pick(1, ALPHA, "early-ss"), pick(2, BETA, "late-ss")];
  const result = dominatedPicks(picks, {
    wparById: new Map([["early-ss", 1.5], ["late-ss", 4]]),
    slotOf: (player) => player.position
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].gap, 2.5);
});

test("an arm must clear the pick on both readings, and the gap quotes the stingier one", () => {
  const picks = [
    pick(1, ALPHA, "workhorse", { slot: "SP", role: "SP" }),
    pick(2, BETA, "rival", { slot: "SP", role: "SP" })
  ];
  const wparById = new Map([["workhorse", 10], ["rival", 12]]);
  const volumeById = new Map([["workhorse", 1000], ["rival", 1000]]);
  const slotOf = () => "SP";

  // Ahead as pitched (0.012 to 0.010) but BEHIND once neither is tired: the
  // workhorse's as-pitched rate was dragged down by innings he did not choose.
  const freshRates = new Map([["workhorse", 0.014], ["rival", 0.013]]);
  const stingier = (other, entry) => Math.min(
    (other.rate - entry.rate) * entry.volume,
    (freshRates.get(other.id) - freshRates.get(entry.id)) * entry.volume
  );
  assert.deepEqual(
    dominatedPicks(picks, { wparById, volumeById, slotOf, equalWorkGap: stingier }).rows,
    [],
    "beating him only as pitched is not beating him"
  );

  // Now ahead on both readings; the gap quotes the smaller edge (0.001 a batter
  // over the pick's own 1000), not the bigger one.
  const bothWays = new Map([["workhorse", 0.013], ["rival", 0.014]]);
  const result = dominatedPicks(picks, {
    wparById,
    volumeById,
    slotOf,
    equalWorkGap: (other, entry) => Math.min(
      (other.rate - entry.rate) * entry.volume,
      (bothWays.get(other.id) - bothWays.get(entry.id)) * entry.volume
    )
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].gap.toFixed(1), "1.0");
  assert.ok(result.rows[0].gap >= 0, "a surviving row can never show a negative floor");
});

test("the floor and the leftover still add back to the raw difference under a stingy edge", () => {
  const picks = [pick(1, ALPHA, "a"), pick(2, BETA, "b")];
  const result = dominatedPicks(picks, {
    wparById: new Map([["a", 4], ["b", 9]]),
    volumeById: new Map([["a", 500], ["b", 700]]),
    slotOf: () => "SS",
    equalWorkGap: (other, entry) => ((other.rate - entry.rate) * entry.volume) / 2
  });
  const [row] = result.rows;
  assert.equal((row.gap + row.fromVolume).toFixed(6), row.rawGap.toFixed(6));
});

// ---- a bat's three clocks ----------------------------------------------------

function batLine(id, { hitting = 0, baserunning = 0, defense = 0, pa = 600, fieldChances = 300 } = {}) {
  return {
    id,
    name: id,
    warPer162: { hitting, baserunning, defense, total: hitting + baserunning + defense },
    paPer162: pa,
    warInputs: { fieldChancesPer162: fieldChances }
  };
}

test("a bat's glove is read per fielding chance, so a lineup slot never moves it", () => {
  // Same card quality in every respect; the only difference is that the leadoff
  // man comes up 700 times and the number nine hitter 500, while both field the
  // same 300 chances.
  const gap = buildEqualWorkGap({
    hitters: [
      batLine("ninth", { hitting: 5, defense: 3, pa: 500, fieldChances: 300 }),
      batLine("leadoff", { hitting: 7, defense: 3, pa: 700, fieldChances: 300 })
    ],
    pitchers: []
  });
  const entry = { id: "ninth", rate: 8 / 500, volume: 500 };
  const other = { id: "leadoff", rate: 10 / 700, volume: 700 };
  // Identical per-trip bats (0.01) and identical gloves per chance, so holding
  // the job fixed leaves nothing between them.
  assert.equal(gap(other, entry).toFixed(6), "0.000000");
});

test("a better glove still counts in full even when the two bat different amounts", () => {
  const gap = buildEqualWorkGap({
    hitters: [
      batLine("mine", { hitting: 5, defense: 1, pa: 500, fieldChances: 300 }),
      batLine("theirs", { hitting: 7, defense: 4, pa: 700, fieldChances: 300 })
    ],
    pitchers: []
  });
  const entry = { id: "mine", rate: 6 / 500, volume: 500 };
  const other = { id: "theirs", rate: 11 / 700, volume: 700 };
  // Bats are identical per trip; the glove is 3 wins better over the same 300
  // chances, and that is the whole gap.
  assert.equal(gap(other, entry).toFixed(3), "3.000");
});

test("legs ride the plate-appearance clock, so reaching base more is credited not divided out", () => {
  // Same speed, but one of them reaches far more often and so turns his legs
  // into more wins. Per time ON BASE they would look identical; per trip to the
  // plate — the clock the job actually hands out — he is ahead, which is right,
  // because getting on is what gave the legs something to do.
  const gap = buildEqualWorkGap({
    hitters: [
      batLine("seldom-on", { baserunning: 2, pa: 500, fieldChances: 0 }),
      batLine("often-on", { baserunning: 6, pa: 500, fieldChances: 0 })
    ],
    pitchers: []
  });
  const entry = { id: "seldom-on", rate: 2 / 500, volume: 500 };
  const other = { id: "often-on", rate: 6 / 500, volume: 500 };
  assert.equal(gap(other, entry).toFixed(3), "4.000");
});

test("the legs' denominator cannot refund on-base skill the hitting term already paid for", () => {
  // Identical cards in every way except that one bats 700 times and the other
  // 500. Over the pick's own 500 trips there is nothing between them, bat or
  // legs — the extra volume is work, not quality.
  const gap = buildEqualWorkGap({
    hitters: [
      batLine("short", { hitting: 5, baserunning: 1, pa: 500, fieldChances: 300 }),
      batLine("long", { hitting: 7, baserunning: 1.4, pa: 700, fieldChances: 300 })
    ],
    pitchers: []
  });
  const entry = { id: "short", rate: 6 / 500, volume: 500 };
  const other = { id: "long", rate: 8.4 / 700, volume: 700 };
  assert.equal(gap(other, entry).toFixed(6), "0.000000");
});

test("a bat with no fielding chances contributes no defence either way", () => {
  const gap = buildEqualWorkGap({
    hitters: [
      batLine("dh", { hitting: 6, defense: 0, pa: 600, fieldChances: 0 }),
      batLine("gloveman", { hitting: 6, defense: 5, pa: 600, fieldChances: 400 })
    ],
    pitchers: []
  });
  const entry = { id: "dh", rate: 6 / 600, volume: 600 };
  const other = { id: "gloveman", rate: 11 / 600, volume: 600 };
  assert.equal(gap(other, entry).toFixed(6), "0.000000", "no glove was played at that spot");
});
