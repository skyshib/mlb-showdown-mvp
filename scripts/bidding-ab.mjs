#!/usr/bin/env node
// A/B harness: pre-retune vs post-retune CPU auction bidding.
//
// OLD is imported from draft.old.mjs (a snapshot of a chosen commit's draft.js);
// NEW is the working-tree draft.js. Both draft the SAME seeded pool per league,
// so the only thing that varies is the willingness function. Each drafted
// league is then simulated head-to-head and scored for competitive balance and
// pitching investment.
//
// Usage: node scripts/bidding-ab.mjs [--leagues N] [--runs N] [--teams N] [--budget N]

import * as NEW from "../src/rules/draft.js";
import * as OLD from "../src/rules/draft.old.mjs";
import { buildDraftPool } from "../src/data/universes.js";
import { simulateBatch } from "../src/rules/batch.js";

const args = Object.fromEntries(
  process.argv.slice(2).join(" ").split("--").filter(Boolean)
    .map((s) => s.trim().split(/\s+/)).map(([k, v]) => [k, v])
);
const LEAGUES = Number(args.leagues ?? 30);
const RUNS = Number(args.runs ?? 1500);
const TEAMS = Number(args.teams ?? 4);
const BUDGET = Number(args.budget ?? 1000);
const ROSTER = 13;
const UNIVERSE = "mlb-history";

function draftLeague(mod, pool, seed) {
  const managers = Array.from({ length: TEAMS }, (_, i) => ({ name: `T${i + 1}`, cpu: true }));
  const draft = mod.createDraft(managers, pool, ROSTER, seed, {
    draftType: "auction", nomination: "random", budget: BUDGET, timer: false, snakeTimer: false
  });
  if (mod.completeAuctionReview) mod.completeAuctionReview(draft, 0);
  let guard = 5000;
  while (!draft.complete && guard-- > 0) mod.autopick(draft, 0);
  if (mod.repairDraftRosters) mod.repairDraftRosters(draft);
  const price = new Map();
  for (const p of mod.draftHistory(draft)) price.set(p.player.id, p.price ?? 0);
  return { draft, price };
}

const isSP = (p) => p.slot === "SP" || (p.kind === "pitcher" && p.slot !== "RP" && p.position === "SP");

function scoreLeague(mod, draft, price, seed) {
  const teams = draft.managers.map((m) => mod.buildTeam(m, { optimize: true }));
  const summary = simulateBatch(teams, { runs: RUNS, seed: seed + "-sim" });
  const winByTeam = new Map(summary.teams.map((t) => [t.team, t.winPct]));
  const rows = draft.managers.map((m) => {
    const roster = m.roster ?? [];
    const sp = roster.filter(isSP);
    return {
      team: m.name,
      win: winByTeam.get(m.name) ?? 0,
      spPoints: sp.reduce((s, p) => s + (p.points || 0), 0),
      spSpend: sp.reduce((s, p) => s + (price.get(p.id) || 0), 0),
      points: roster.reduce((s, p) => s + (p.points || 0), 0)
    };
  });
  // The single best starter in this league's deck that got drafted, and its price.
  let topAce = null;
  for (const m of draft.managers) for (const p of (m.roster ?? [])) {
    if (isSP(p) && (!topAce || p.points > topAce.points)) topAce = { points: p.points, price: price.get(p.id) || 0 };
  }
  const wins = rows.map((r) => r.win);
  const worstSP = Math.min(...rows.map((r) => r.spPoints));
  return {
    rows,
    winSpread: Math.max(...wins) - Math.min(...wins),
    winStd: std(wins),
    topAcePrice: topAce?.price ?? 0,
    worstTeamSP: worstSP,
    // does the team that bought the best pitching also win the league?
    bestSPwins: argmax(rows, (r) => r.spPoints) === argmax(rows, (r) => r.win)
  };
}

function argmax(arr, f) { let bi = 0; for (let i = 1; i < arr.length; i++) if (f(arr[i]) > f(arr[bi])) bi = i; return bi; }
function mean(a) { return a.reduce((s, x) => s + x, 0) / a.length; }
function std(a) { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); }
function pearson(xs, ys) {
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  return num / (Math.sqrt(dx * dy) || 1);
}

function run(label, mod) {
  const agg = { spread: [], std: [], acePrice: [], worstSP: [], bestSPwins: 0, spAll: [], winAll: [] };
  for (let i = 0; i < LEAGUES; i++) {
    const seed = `ab-${i}`;
    const pool = buildDraftPool(UNIVERSE, seed, { nomination: "random", managerCount: TEAMS });
    const { draft, price } = draftLeague(mod, pool, seed);
    const s = scoreLeague(mod, draft, price, seed);
    agg.spread.push(s.winSpread); agg.std.push(s.winStd);
    agg.acePrice.push(s.topAcePrice); agg.worstSP.push(s.worstTeamSP);
    if (s.bestSPwins) agg.bestSPwins++;
    for (const r of s.rows) { agg.spAll.push(r.spPoints); agg.winAll.push(r.win); }
  }
  return {
    label,
    winSpread: mean(agg.spread),
    winStd: mean(agg.std),
    acePrice: mean(agg.acePrice),
    worstTeamSP: mean(agg.worstSP),
    bestSPwinsPct: agg.bestSPwins / LEAGUES,
    spVsWin_r: pearson(agg.spAll, agg.winAll)
  };
}

console.log(`Leagues: ${LEAGUES}  Sim games/league: ${RUNS}  Teams: ${TEAMS}  Budget: $${BUDGET}  Pool: ${UNIVERSE}\n`);
const oldR = run("OLD (pre-retune a5d3224)", OLD);
const newR = run("NEW (post-retune HEAD)", NEW);

const fmt = (r) => [
  r.label.padEnd(26),
  `spread ${(r.winSpread * 100).toFixed(1)}%`,
  `std ${(r.winStd * 100).toFixed(1)}%`,
  `acePrice $${r.acePrice.toFixed(0)}`,
  `worstTeamSP ${r.worstTeamSP.toFixed(0)}pt`,
  `bestSP→wins ${(r.bestSPwinsPct * 100).toFixed(0)}%`,
  `r(SP,win) ${r.spVsWin_r.toFixed(2)}`
].join("  |  ");
console.log(fmt(oldR));
console.log(fmt(newR));
console.log("\nLower spread/std = tighter balance. Higher acePrice = pays up for the ace.");
console.log("Higher worstTeamSP = fewer teams shut out of pitching. Higher r(SP,win) = pitching more decisive/rewarded.");
