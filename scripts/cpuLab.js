// What the CPU lab has measured, for cpu-lab.html to read.
//
// The bench (scripts/cpu-lab.mjs) appends one line per measurement to
// data/cpu-lab/results.jsonl and keeps a small heartbeat file per running
// process beside it. This reads both and hands them over raw: the page pools
// the numbers itself, because which rows belong together changes with every
// filter the reader touches, and a server that pooled them would have to be
// asked the same question again on every click.
//
// Nothing here writes. A night's run and a page watching it are a writer and a
// reader of the same append-only file, which is the whole reason the record is
// append-only.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CPU_KNOB_GENERATIONS, CPU_TUNABLE_DEFAULTS, CPU_TUNABLE_NOTES, cpuTunables, baselineKey } from "../src/rules/cpuTunables.js";
import { CELLS } from "./cpu-lab-cells.mjs";
import { IDEA_REJECTS, TWEAKS } from "./cpu-lab-tweaks.mjs";

// A process that has not touched its heartbeat in this long is gone — killed,
// crashed, or the machine slept. It is not "running" on anybody's screen.
const STALE_MS = 120_000;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function cpuLabDir(root) {
  return process.env.CPU_LAB_DIR ?? join(root, "data", "cpu-lab");
}

function readRows(dir) {
  let text = "";
  try {
    text = readFileSync(join(dir, "results.jsonl"), "utf8");
  } catch {
    return [];
  }
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // A line half-written at the moment of the read. The next poll gets it.
    }
  }
  return rows;
}

function readRunning(dir) {
  let files = [];
  try {
    files = readdirSync(dir).filter((name) => name.startsWith("progress-") && name.endsWith(".json"));
  } catch {
    return [];
  }
  const live = [];
  for (const name of files) {
    const file = join(dir, name);
    try {
      if (Date.now() - statSync(file).mtimeMs > STALE_MS) continue;
      live.push(JSON.parse(readFileSync(file, "utf8")));
    } catch {
      // Being written, or gone between the listing and the read.
    }
  }
  return live.sort((a, b) => String(a.startedAt ?? "").localeCompare(String(b.startedAt ?? "")));
}

// WHAT COMMIT THIS SERVER IS RUNNING, captured once, because that is exactly
// what node module caching freezes. Everything this file serves — the shipped
// knob values, which bidder is current, the list of rooms — is read from
// modules imported at start-up, so an edit on disk does not reach a running
// server. That is not cosmetic here: the page's job is to say WHICH bidder a
// number was measured against, and after a revert it went on naming the
// reverted one and telling the reader to switch to it.
//
// So the page is given both commits and can say when it is looking at a ghost.
function gitOnDisk() {
  try { return execSync("git rev-parse --short HEAD", { encoding: "utf8", cwd: ROOT }).trim(); } catch { return null; }
}

const STARTED_AT_GIT = gitOnDisk();

export function readCpuLab(root) {
  const dir = cpuLabDir(root);
  const rows = readRows(dir);
  let updated = null;
  try {
    updated = new Date(statSync(join(dir, "results.jsonl")).mtimeMs).toISOString();
  } catch { /* nothing measured yet */ }
  return {
    updated,
    rows,
    running: readRunning(dir),
    cells: CELLS,
    tweaks: TWEAKS.map((tweak) => ({
      id: tweak.id,
      note: tweak.note,
      fixture: Boolean(tweak.fixture),
      params: tweak.params,
      // Where a candidate came from. A proposal out of the ideas inbox carries
      // the room that prompted it and the observation behind it, which is the
      // only place that evidence survives — the measurement itself cannot say
      // why anyone thought to take it.
      idea: Boolean(tweak.idea),
      // A candidate the bench has finished with, and the answer in one line.
      // Served so the page can say a question is CLOSED rather than showing it
      // as a row that stopped filling up for no visible reason.
      settled: tweak.settled ?? null,
      room: tweak.room ?? null,
      why: tweak.why ?? null,
      by: tweak.by ?? null
    })),
    // Proposals in the inbox that could not be used. Served so a typo is
    // visible on the page rather than silently dropped.
    rejects: IDEA_REJECTS,
    // A generation whose knobs are all live values is the one you are running
    // now, which is the only way the page can say what "defaults" means today.
    generations: Object.entries(CPU_KNOB_GENERATIONS).map(([name, generation]) => ({
      name,
      at: generation.at,
      git: generation.git,
      fingerprint: generation.fingerprint,
      note: generation.note,
      knobs: generation.knobs,
      isLive: cpuTunables(generation.knobs).key === ""
    })),
    defaults: CPU_TUNABLE_DEFAULTS,
    // Both commits, so the page can tell the reader its numbers are a ghost.
    serverGit: STARTED_AT_GIT,
    diskGit: gitOnDisk(),
    // WHO THE CONTROL CHAIRS ARE RIGHT NOW. The page needs this to tell a
    // current reading from one taken against a bidder that has since been
    // changed — ship a knob and every earlier row answers a question about an
    // opponent that no longer exists.
    baseline: baselineKey(),
    notes: CPU_TUNABLE_NOTES
  };
}
