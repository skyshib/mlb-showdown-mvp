#!/usr/bin/env node
// Every bid and every pick a room of computers makes, hashed.
//
// This is the refactor check. Threading a knob through the bidder must not
// change what the bidder DOES when the knob sits at its shipped value, and
// "the win% looks about the same" is not evidence of that — a sweep's noise
// floor is wider than most real effects. So: drive a fixed set of rooms, write
// down every bid amount by every manager on every lot (auction) and every pick
// in order (snake), and hash the lot. Two trees that agree card for card and
// dollar for dollar are the same drafter.
//
// Usage: node scripts/cpu-fingerprint.mjs [--tree PATH] [--seeds N] [--verbose]
//
//   git worktree add --detach /tmp/base HEAD
//   node scripts/cpu-fingerprint.mjs --tree /tmp/base > /tmp/before.txt
//   ...edit the bidder...
//   node scripts/cpu-fingerprint.mjs | diff /tmp/before.txt -
//
// The cells cover both draft types, both nomination rules, both pricing rules,
// capped and uncapped pens, three board sizes and three card sets, because a
// knob can be dead on one path and live on another.

import crypto from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = Object.fromEntries(process.argv.slice(2).join(" ").split("--").filter(Boolean)
  .map((s) => s.trim().split(/\s+/)).map(([k, v]) => [k, v ?? "1"]));

const HERE = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const TREE = path.resolve(args.tree ?? HERE);
const SEEDS = Number(args.seeds ?? 4);
const VERBOSE = args.verbose != null;

const load = (file) => import(pathToFileURL(path.join(TREE, "src", file)).href);
const D = await load("rules/draft.js");
const { buildDraftPool } = await load("data/universes.js");

const CELLS = [
  { tag: "auc-c4-rand", type: "auction", teams: 4, universe: "classic", nomination: "random", pen: "all", penMin: 2, sp: 4, roster: 15 },
  { tag: "auc-c4-man", type: "auction", teams: 4, universe: "classic", nomination: "manual", pen: 2, penMin: 2, sp: 4, roster: 15 },
  { tag: "auc-c4-first", type: "auction", teams: 4, universe: "classic", nomination: "random", pen: "all", penMin: 2, sp: 4, roster: 15, pricing: "first" },
  { tag: "auc-c8-rand", type: "auction", teams: 8, universe: "classic", nomination: "random", pen: 3, penMin: 2, sp: 4, roster: 15 },
  { tag: "auc-f3-rand", type: "auction", teams: 3, universe: "fictional", nomination: "random", pen: "all", penMin: 2, sp: 2, roster: 13 },
  { tag: "auc-h4-man", type: "auction", teams: 4, universe: "mlb-history", nomination: "manual", pen: 2, penMin: 2, sp: 4, roster: 15 },
  { tag: "snk-c4", type: "snake", teams: 4, universe: "classic", sp: 4, roster: 15 },
  { tag: "snk-f6", type: "snake", teams: 6, universe: "fictional", sp: 2, roster: 13 },
  { tag: "snk-h4", type: "snake", teams: 4, universe: "mlb-history", sp: 5, roster: 16 }
];

// One room, computers in every chair, driven exactly the way the app drives a
// table of computers: autopick runs a whole auction lot or one snake turn.
function runRoom(cell, seed) {
  const pen = cell.type === "auction" ? { bullpenSlots: cell.pen, bullpenMin: cell.penMin } : {};
  const pool = buildDraftPool(cell.universe, seed, {
    nomination: cell.nomination, managerCount: cell.teams, startingPitchers: cell.sp, ...pen
  });
  const draft = D.createDraft(
    Array.from({ length: cell.teams }, (unused, i) => ({ name: `T${i}`, cpu: true })),
    pool, cell.roster, seed,
    {
      draftType: cell.type, nomination: cell.nomination, startingPitchers: cell.sp,
      budget: 1500, timer: false, snakeTimer: false, auctionPricing: cell.pricing ?? null, ...pen
    }
  );
  D.completeAuctionReview?.(draft, 0);
  let guard = 40000;
  while (!draft.complete && guard-- > 0) D.autopick(draft, 0);
  D.repairDraftRosters?.(draft);

  const lines = [];
  for (const lot of draft.auction?.history ?? []) {
    const bids = Object.entries(lot.bids ?? {}).sort(([a], [b]) => a.localeCompare(b))
      .map(([id, amount]) => `${id}=${amount}`).join(",");
    lines.push(`lot ${lot.playerId} -> ${lot.managerId ?? "passed"} $${lot.price} nom=${lot.nominatorId ?? "-"} [${bids}]`);
  }
  for (const manager of draft.managers) {
    lines.push(`roster ${manager.id} ${manager.roster.map((card) => card.id).join(" ")}`);
  }
  return lines;
}

const digest = (lines) => crypto.createHash("sha1").update(lines.join("\n")).digest("hex").slice(0, 12);

console.log(`cpu fingerprint — ${TREE}`);
let all = [];
for (const cell of CELLS) {
  const lines = [];
  for (let s = 0; s < SEEDS; s += 1) lines.push(...runRoom(cell, `fp-${cell.tag}-${s}`));
  all = all.concat(lines);
  console.log(`  ${cell.tag.padEnd(14)} ${digest(lines)}  ${lines.length} lines`);
  if (VERBOSE) for (const line of lines) console.log(`      ${line}`);
}
console.log(`  ${"ALL".padEnd(14)} ${digest(all)}  ${all.length} lines`);
