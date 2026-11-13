// THE IDEAS INBOX — tweak proposals written by somebody who is not this bench.
//
// The bench measures; it does not think of things to measure. The thinking
// happens where the evidence is: an agent reading one finished room, a study of
// one board, a human who noticed a bid that made no sense. This is where that
// work is handed over. An idea appended here becomes a candidate EVERYWHERE —
// `cpu-lab.mjs list` prints it, `run` measures it, the page plots it — with no
// step in between, because scripts/cpu-lab-tweaks.mjs reads this file and
// appends what it finds to the queue.
//
// THE FILE IS APPEND-ONLY JSONL (scripts/cpu-lab-ideas.jsonl), one idea per
// line, so two agents writing at once cannot clobber each other and nothing is
// ever edited away. Blank lines and lines starting with // or # are ignored, so
// the file can carry its own instructions at the top.
//
// WHAT AN IDEA IS:
//
//   { "id": "kebab-case-name",
//     "knobs": { "shareExponent": 1.05 },     // must be real knobs, see cpuTunables.js
//     "note": "what this claims, in one line",
//     "room": "misty-fox-open",               // optional, the evidence
//     "why":  "seat 3 paid $182 for a replacement arm two lots from the end",
//     "by":   "whoever proposed it" }
//
// NOTHING HERE THROWS. A malformed line, a misspelled knob, a name already
// taken — each is collected as a REJECT with a reason and reported, never
// raised. The CLI prints the rejects and the page shows them. That matters
// because the online server imports this path: a bad line in an inbox any agent
// can write to must not be able to take the site down. It also matters because
// a misspelled knob that got silently dropped would read as a perfect null, and
// a null is a believable result.

import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cpuTunables } from "../src/rules/cpuTunables.js";

// Resolved on every call, not once at import, the same way cpuLab.js resolves
// its results directory: a test that points the inbox somewhere else has to be
// able to do it after this module is loaded.
export function ideasFile() {
  return process.env.CPU_LAB_IDEAS
    ?? join(dirname(fileURLToPath(import.meta.url)), "cpu-lab-ideas.jsonl");
}

const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

// A stable spelling of a knob set, so two ideas that say the same thing in a
// different order are caught as the same thing.
export function knobKey(knobs) {
  return Object.keys(knobs).sort()
    .map((knob) => `${knob}=${JSON.stringify(knobs[knob])}`).join("|");
}

// Everything an idea has to be before the bench will spend an hour on it. Takes
// the names and knob sets already spoken for, and returns a reason or null.
export function faultIn(idea, taken = new Map()) {
  if (!idea || typeof idea !== "object" || Array.isArray(idea)) return "not an object";
  const { id, knobs, note } = idea;
  if (typeof id !== "string" || !KEBAB.test(id)) return `id must be kebab-case, got ${JSON.stringify(id)}`;
  if (typeof note !== "string" || note.trim().length < 12) {
    return "note must say in a line what the idea claims";
  }
  if (!knobs || typeof knobs !== "object" || Array.isArray(knobs)) return "knobs must be an object";
  if (!Object.keys(knobs).length) return "knobs is empty — an idea that changes nothing is the null fixture";
  // The knob registry is the validator: it throws on a name it does not know,
  // and it reads back "" for a set that restates the shipped values.
  let tune;
  try {
    tune = cpuTunables(knobs);
  } catch (error) {
    // The registry's message names the knob and then lists all 33 of them. The
    // name is the reason; the list belongs wherever the reason is shown, not
    // inside it — a page banner cannot carry 33 knobs.
    return String(error.message ?? error).replace(/^cpuTunables: /, "").split(". Known knobs")[0];
  }
  if (!tune.key) return "every knob is already the shipped value — this is the null fixture";
  if (taken.has(`id:${id}`)) return `the name "${id}" is already ${taken.get(`id:${id}`)}`;
  const twin = taken.get(`knobs:${knobKey(knobs)}`);
  if (twin) return `the same knobs are already queued as "${twin}"`;
  return null;
}

// Reads the inbox. Never throws: a missing file is an empty inbox, and a line
// that cannot be used comes back in `rejected` with the reason and the raw text.
export function readIdeas(taken = new Map()) {
  let text = "";
  try {
    text = readFileSync(ideasFile(), "utf8");
  } catch {
    return { ideas: [], rejected: [] };
  }
  const seen = new Map(taken);
  const ideas = [];
  const rejected = [];
  text.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#")) return;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      rejected.push({ line: index + 1, reason: `not JSON — ${error.message}`, raw: trimmed.slice(0, 120) });
      return;
    }
    const fault = faultIn(parsed, seen);
    if (fault) {
      rejected.push({ line: index + 1, id: parsed?.id, reason: fault, raw: trimmed.slice(0, 120) });
      return;
    }
    seen.set(`id:${parsed.id}`, "an idea further up the inbox");
    seen.set(`knobs:${knobKey(parsed.knobs)}`, parsed.id);
    ideas.push({
      id: parsed.id,
      note: parsed.note.trim(),
      params: parsed.knobs,
      idea: true,
      line: index + 1,
      room: typeof parsed.room === "string" ? parsed.room : null,
      why: typeof parsed.why === "string" ? parsed.why : null,
      by: typeof parsed.by === "string" ? parsed.by : null,
      at: typeof parsed.at === "string" ? parsed.at : null,
      // THE ACCEPTED CANDIDATE THIS ONE BRACKETS. A value that just won is the
      // first value anybody happened to try, not the best one, so accepting it
      // queues its neighbours — and they go near the front, because the cheapest
      // moment to find out that 50 beats 60 is before 60 has been built on.
      bracketOf: typeof parsed.bracketOf === "string" ? parsed.bracketOf : null
    });
  });
  return { ideas, rejected };
}

// Appends one idea, or says why it cannot. Returns { ok, reason }. The write is
// a single appendFileSync of one line, which is atomic enough for the job: two
// agents proposing at the same moment both land, in whatever order.
export function appendIdea(idea, taken = new Map()) {
  const seen = new Map(taken);
  for (const existing of readIdeas(taken).ideas) {
    seen.set(`id:${existing.id}`, "in the inbox");
    seen.set(`knobs:${knobKey(existing.params)}`, existing.id);
  }
  const fault = faultIn(idea, seen);
  if (fault) return { ok: false, reason: fault };
  const record = {
    id: idea.id,
    knobs: idea.knobs,
    note: idea.note.trim(),
    ...(idea.room ? { room: idea.room } : {}),
    ...(idea.why ? { why: idea.why } : {}),
    ...(idea.by ? { by: idea.by } : {}),
    ...(idea.bracketOf ? { bracketOf: idea.bracketOf } : {}),
    at: idea.at ?? new Date().toISOString().slice(0, 10)
  };
  appendFileSync(ideasFile(), `${JSON.stringify(record)}\n`);
  return { ok: true, record };
}
