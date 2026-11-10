#!/usr/bin/env node
// What changes when a snake room's WPAR is measured against the Nth-best card
// at the position instead of the board's floor.
//
// Both baselines are run over the IDENTICAL season: one draft, one set of
// rosters, one seed. Attribution never touches the dice (see batch.js), so the
// two passes play the same games pitch for pitch and the only difference is the
// card each player is replayed against. Anything that moves is the baseline.
//
// Usage: node scripts/replacement-baseline.mjs [--universe U] [--teams N]
//        [--roster N] [--runs N] [--seed S] [--sp N] [--pen N|all]
//        [--rooms N] [--type snake|auction] [--players]

import { autopick, buildTeam, createDraft, repairDraftRosters, standingReplacements } from "../src/rules/draft.js";
import { rankedReplacements, replacementSeats } from "../src/rules/replacementLevel.js";
import { buildDraftPool } from "../src/data/universes.js";
import { simulateBatch } from "../src/rules/batch.js";

const args = Object.fromEntries(
  process.argv.slice(2).join(" ").split("--").filter(Boolean)
    .map((s) => s.trim().split(/\s+/)).map(([k, v]) => [k, v ?? "1"])
);
const UNIVERSE = args.universe ?? "fictional";
const TEAMS = Number(args.teams ?? 6);
const ROSTER = Number(args.roster ?? 15);
const RUNS = Number(args.runs ?? 300);
const SEED = args.seed ?? "repl-baseline";
const SP = Number(args.sp ?? 4);
const ROOMS = Number(args.rooms ?? 1);
const TYPE = args.type ?? "snake";
const SHOW_PLAYERS = args.players != null;
const PEN = args.pen == null ? {} : { bullpenSlots: args.pen === "all" ? "all" : Number(args.pen) };

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const fmt = (x, n = 2) => (x >= 0 ? "+" : "") + x.toFixed(n);

// Spearman: rank both lists, correlate the ranks.
function spearman(pairs) {
  if (pairs.length < 3) return NaN;
  const rank = (values) => {
    const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const out = new Array(values.length);
    for (let i = 0; i < order.length;) {
      let j = i;
      while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j += 1;
      const r = (i + j) / 2 + 1;
      for (let k = i; k <= j; k += 1) out[order[k][1]] = r;
      i = j + 1;
    }
    return out;
  };
  const a = rank(pairs.map((p) => p[0]));
  const b = rank(pairs.map((p) => p[1]));
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i += 1) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

function driveRoom(seed) {
  const pool = buildDraftPool(UNIVERSE, seed, {
    managerCount: TEAMS, startingPitchers: SP, temperature: 0, ...PEN
  });
  const managers = Array.from({ length: TEAMS }, (unused, i) => ({ name: `T${i + 1}`, cpu: true }));
  const draft = createDraft(managers, pool, ROSTER, seed, {
    draftType: TYPE, startingPitchers: SP, timer: false, snakeTimer: false, ...PEN
  });
  let guard = 20000;
  while (!draft.complete && guard-- > 0) autopick(draft);
  repairDraftRosters(draft);
  return draft;
}

// One season, scored twice.
function measure(draft, baseline) {
  const teams = draft.managers.map((m) => ({ ...buildTeam(m, { optimize: true }), replacements: baseline }));
  const summary = simulateBatch(teams, { runs: RUNS, seed: `${SEED}-season` });
  const rows = new Map();
  for (const line of summary.hitters) {
    const w = line.warPer162 ?? {};
    rows.set(line.id, {
      name: line.name, team: line.team, kind: "hitter", wpar: w.total ?? 0,
      parts: { hitting: w.hitting ?? 0, baserunning: w.baserunning ?? 0, defense: w.defense ?? 0, pitching: 0 }
    });
  }
  for (const line of summary.pitchers) {
    const pitching = line.warPer162?.pitching ?? 0;
    const prior = rows.get(line.id);
    if (prior) { prior.wpar += pitching; prior.parts.pitching += pitching; }
    else {
      rows.set(line.id, {
        name: line.name, team: line.team, kind: "pitcher", wpar: pitching,
        parts: { hitting: 0, baserunning: 0, defense: 0, pitching }
      });
    }
  }
  return { rows, summary };
}

const report = [];
for (let room = 0; room < ROOMS; room += 1) {
  const seed = ROOMS > 1 ? `${SEED}-${room}` : SEED;
  const draft = driveRoom(seed);
  const board = standingReplacements(draft);
  const ranked = rankedReplacements(draft);
  const seats = replacementSeats(draft);

  if (room === 0) {
    console.log(`${UNIVERSE} ${TYPE}, ${TEAMS} teams, roster ${ROSTER} (${SP} SP), ${RUNS} games/season, seed ${seed}`);
    console.log(`\nThe floor at each slot`);
    console.log(`  slot    N   board floor                     ranked floor`);
    const bySlot = (list) => new Map(list.map((c) => [c.slot, c]));
    const b = bySlot(board);
    const r = bySlot(ranked);
    for (const slot of [...new Set([...r.keys(), ...b.keys()])]) {
      const label = (c) => (c ? `${c.name} (${c.points}pt)` : "—");
      console.log(`  ${slot.padEnd(6)} ${String(seats[slot] ?? "").padStart(3)}  ${label(b.get(slot)).padEnd(32)} ${label(r.get(slot))}`);
    }
  }

  const A = measure(draft, board);
  const B = measure(draft, ranked);

  const ids = [...A.rows.keys()].filter((id) => B.rows.has(id));
  const pairs = ids.map((id) => [A.rows.get(id).wpar, B.rows.get(id).wpar]);
  const drafted = new Set(draft.managers.flatMap((m) => m.roster.map((c) => c.id)));

  const PARTS = ["hitting", "baserunning", "defense", "pitching"];
  const teamTotal = (m) => {
    const sum = (rows) => m.roster.reduce((s, c) => s + (rows.get(c.id)?.wpar ?? 0), 0);
    const parts = (rows) => Object.fromEntries(PARTS.map((k) =>
      [k, m.roster.reduce((s, c) => s + (rows.get(c.id)?.parts?.[k] ?? 0), 0)]));
    return { board: sum(A.rows), ranked: sum(B.rows), boardParts: parts(A.rows), rankedParts: parts(B.rows) };
  };
  const totals = draft.managers.map((m) => ({ name: m.name, ...teamTotal(m) }));
  const winPct = new Map(A.summary.teams.map((t) => [t.team, t.winPct]));
  const games = A.summary.teams[0]?.games ?? 162;
  const aboveEven = totals.map((t) => ((winPct.get(t.name) ?? 0.5) - 0.5) * games);

  report.push({
    seed,
    spearmanAll: spearman(pairs),
    spearmanDrafted: spearman(ids.filter((id) => drafted.has(id)).map((id) => [A.rows.get(id).wpar, B.rows.get(id).wpar])),
    levelBoard: mean(totals.map((t) => t.board)),
    levelRanked: mean(totals.map((t) => t.ranked)),
    sdBoard: sd(totals.map((t) => t.board)),
    sdRanked: sd(totals.map((t) => t.ranked)),
    corrBoard: spearman(totals.map((t, i) => [t.board, aboveEven[i]])),
    corrRanked: spearman(totals.map((t, i) => [t.ranked, aboveEven[i]])),
    totals,
    aboveEven,
    A,
    B
  });
}

const first = report[0];
console.log(`\nPlayer rankings (WPAR/162, board floor vs ranked floor)`);
console.log(`  Spearman, every card measured:  ${mean(report.map((r) => r.spearmanAll)).toFixed(4)}`);
console.log(`  Spearman, drafted cards only:   ${mean(report.map((r) => r.spearmanDrafted)).toFixed(4)}`);

console.log(`\nTeam totals (sum of roster WPAR/162)`);
console.log(`  team    board floor   ranked floor   wins above even`);
for (let i = 0; i < first.totals.length; i += 1) {
  const t = first.totals[i];
  console.log(`  ${t.name.padEnd(6)} ${fmt(t.board, 1).padStart(11)} ${fmt(t.ranked, 1).padStart(14)} ${fmt(first.aboveEven[i], 1).padStart(17)}`);
}
console.log(`  mean   ${fmt(mean(report.map((r) => r.levelBoard)), 1).padStart(11)} ${fmt(mean(report.map((r) => r.levelRanked)), 1).padStart(14)}`);
console.log(`  spread ${mean(report.map((r) => r.sdBoard)).toFixed(1).padStart(11)} ${mean(report.map((r) => r.sdRanked)).toFixed(1).padStart(14)}   (sd across teams)`);
const PARTS = ["hitting", "baserunning", "defense", "pitching"];
console.log(`\nWhere the total comes from (mean per team)`);
console.log(`  part          board floor   ranked floor`);
for (const part of PARTS) {
  const b = mean(report.flatMap((r) => r.totals.map((t) => t.boardParts[part])));
  const k = mean(report.flatMap((r) => r.totals.map((t) => t.rankedParts[part])));
  console.log(`  ${part.padEnd(13)} ${fmt(b, 1).padStart(11)} ${fmt(k, 1).padStart(14)}`);
}

// Pooled and centred WITHIN room, so the question is whether the team that
// scored higher than its roommates also won more than them.
const pooled = (key) => {
  const xs = [];
  const ys = [];
  for (const r of report) {
    const vals = r.totals.map((t) => t[key]);
    const mv = mean(vals);
    const mw = mean(r.aboveEven);
    vals.forEach((v, i) => { xs.push(v - mv); ys.push(r.aboveEven[i] - mw); });
  }
  return spearman(xs.map((x, i) => [x, ys[i]]));
};
// A sharper question than rank order: is a WPAR point worth a WIN? Regress wins
// above even on the team total, both centred within room. A baseline in real win
// units reads a slope of 1.
const slope = (key) => {
  const xs = [];
  const ys = [];
  for (const r of report) {
    const vals = r.totals.map((t) => t[key]);
    const mv = mean(vals);
    const mw = mean(r.aboveEven);
    vals.forEach((v, i) => { xs.push(v - mv); ys.push(r.aboveEven[i] - mw); });
  }
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i += 1) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den ? num / den : 0;
};
console.log(`\n  Team total against wins above even, pooled & centred within room (n=${report.length * TEAMS}):`);
console.log(`    board floor:  Spearman ${pooled("board").toFixed(3)}   slope ${slope("board").toFixed(3)} wins per point`);
console.log(`    ranked floor: Spearman ${pooled("ranked").toFixed(3)}   slope ${slope("ranked").toFixed(3)} wins per point`);

if (SHOW_PLAYERS) {
  const rows = [...first.B.rows.entries()]
    .filter(([id]) => first.A.rows.has(id))
    .map(([id, row]) => ({ ...row, board: first.A.rows.get(id).wpar, ranked: row.wpar }))
    .sort((a, b) => b.ranked - a.ranked);
  console.log(`\nEvery measured card, by ranked WPAR`);
  console.log(`  ${"player".padEnd(26)} ${"team".padEnd(5)} board  ranked   shift`);
  for (const row of rows) {
    console.log(`  ${row.name.slice(0, 25).padEnd(26)} ${String(row.team).padEnd(5)} ${fmt(row.board, 1).padStart(5)}  ${fmt(row.ranked, 1).padStart(6)}  ${fmt(row.ranked - row.board, 1).padStart(6)}`);
  }
}
