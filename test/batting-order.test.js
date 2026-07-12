import test from "node:test";
import assert from "node:assert/strict";
import { hitterRates, orderBattingLineup } from "../src/rules/battingOrder.js";
import { buildTeam } from "../src/rules/draft.js";
import { RESULTS } from "../src/rules/cards.js";

// Builds a 20-face chart from result counts listed worst-to-best.
function chart(counts) {
  const order = [RESULTS.SO, RESULTS.GB, RESULTS.FB, RESULTS.BB, RESULTS.SINGLE, RESULTS.DOUBLE, RESULTS.TRIPLE, RESULTS.HR];
  const entries = [];
  let from = 1;
  order.forEach((result, index) => {
    const count = counts[index] ?? 0;
    if (!count) return;
    entries.push({ from, to: from + count - 1, result });
    from += count;
  });
  assert.equal(from, 21, "test chart must cover exactly 20 faces");
  return entries;
}

//                                SO GB FB BB 1B 2B 3B HR
const franchise = hitter("The Franchise", "CF", 14, 10, [3, 2, 1, 4, 6, 2, 0, 2]); // best overall
const slugger = hitter("Big Bopper", "1B", 12, 6, [6, 2, 1, 2, 3, 1, 0, 5]); // most power
const tableSetter = hitter("Table Setter", "2B", 13, 12, [3, 2, 1, 6, 6, 2, 0, 0]); // on-base, no power
const solidPro = hitter("Solid Pro", "3B", 11, 9, [5, 3, 2, 2, 4, 2, 0, 2]); // 4th best
const steadyVet = hitter("Steady Vet", "SS", 11, 9, [6, 3, 2, 2, 4, 1, 0, 2]); // 5th best
const sixthMan = hitter("Sixth Man", "C", 10, 8, [6, 3, 2, 2, 4, 1, 0, 2]);
const fastScrub = hitter("Fast Scrub", "LF/RF", 9, 18, [7, 4, 2, 2, 3, 1, 0, 1]);
const midScrub = hitter("Mid Scrub", "LF/RF", 9, 12, [7, 4, 2, 2, 3, 1, 0, 1]);
const slowScrub = hitter("Slow Scrub", "DH", 9, 8, [7, 4, 2, 2, 3, 1, 0, 1]);

const nine = [franchise, slugger, tableSetter, solidPro, steadyVet, sixthMan, fastScrub, midScrub, slowScrub];

function hitter(name, position, onBase, speed, counts) {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    kind: "hitter",
    name,
    position,
    bats: "R",
    onBase,
    speed,
    fielding: 3,
    chart: chart(counts)
  };
}

test("hitterRates separates on-base skill from power", () => {
  const setter = hitterRates(tableSetter);
  const bopper = hitterRates(slugger);
  assert.ok(setter.onBase > bopper.onBase, "table setter should reach base more often");
  assert.ok(bopper.extraBases > setter.extraBases, "slugger should collect more extra bases");
  assert.ok(hitterRates(franchise).quality > bopper.quality, "franchise hitter should rate best overall");
});

test("orderBattingLineup follows The Book's slot priorities", () => {
  const order = orderBattingLineup(nine);
  const names = order.map((player) => player.name);
  assert.equal(names[0], "Table Setter", "leadoff goes to the remaining top-three hitter");
  assert.equal(names[1], "The Franchise", "best hitter bats second");
  assert.equal(names[3], "Big Bopper", "biggest slugger of the top three bats cleanup");
  assert.equal(names[4], "Solid Pro", "fourth-best hitter bats fifth");
  assert.equal(names[2], "Steady Vet", "fifth-best hitter bats third");
  assert.equal(names[5], "Sixth Man");
  assert.deepEqual(names.slice(6), ["Fast Scrub", "Mid Scrub", "Slow Scrub"], "equal scrubs order fastest first");
});

test("orderBattingLineup keeps every player and stays deterministic", () => {
  const first = orderBattingLineup(nine);
  const second = orderBattingLineup([...nine]);
  assert.deepEqual(first.map((p) => p.id).sort(), nine.map((p) => p.id).sort());
  assert.deepEqual(first.map((p) => p.id), second.map((p) => p.id));
});

test("orderBattingLineup falls back to quality order for short lineups", () => {
  const order = orderBattingLineup([slowScrub, franchise, slugger]);
  assert.deepEqual(order.map((p) => p.name), ["The Franchise", "Big Bopper", "Slow Scrub"]);
});

test("buildTeam bats the assigned lineup in Tango order with defense intact", () => {
  const manager = {
    id: "team-1",
    name: "Testers",
    roster: [
      ...nine,
      { id: "sp-1", kind: "pitcher", name: "Ace", role: "SP", control: 5, ip: 6, chart: [{ from: 1, to: 20, result: RESULTS.SO }] },
      { id: "rp-1", kind: "pitcher", name: "Closer", role: "RP", control: 4, ip: 1, chart: [{ from: 1, to: 20, result: RESULTS.SO }] }
    ]
  };
  const team = buildTeam(manager);
  assert.equal(team.lineup.length, 9);
  assert.equal(team.lineup[1].name, "The Franchise");
  assert.equal(team.lineup[3].name, "Big Bopper");
  const positions = team.lineup.map((player) => player.defensivePosition).sort();
  assert.deepEqual(positions, ["1B", "2B", "3B", "C", "CF", "DH", "LF", "RF", "SS"].sort());
});
