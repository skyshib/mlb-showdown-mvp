// CROWNING A WINNER, WITHOUT A HUMAN IN THE LOOP.
//
// Skylar's standard is that an accepted candidate is implemented immediately.
// That was a rule somebody had to remember, and it was missed three times in one
// day: the run accepts in a detached process, nobody is watching the log, and by
// the time the verdict is noticed the bench has spent an hour measuring every
// other candidate against a bidder that should already have changed.
//
// So the run loop does it. On an accept it writes the value into
// src/rules/cpuTunables.js, records a generation holding the whole knob set,
// re-records the fingerprint and marks the candidate settled — then stops,
// because every reading it could still take would be against a baseline that no
// longer matches the defaults.
//
// WHAT IT DELIBERATELY DOES NOT DO: commit. The edit is mechanical and verified,
// but the note explaining WHY a knob moved is editorial, and a commit is the
// right place for a human to add it. `git status` after a crown is the handoff.
//
// SAFETY, because this edits the source the live site runs:
//   - a lock file, so two runs accepting at once cannot both write
//   - a .bak of every file touched, restored if anything fails
//   - the module is re-imported in a CHILD process afterwards, and the crown is
//     rolled back unless it parses and baselineKey() reports the new generation
//   - it refuses unless it can re-derive the accept from the record itself
import { readFileSync, writeFileSync, copyFileSync, existsSync, unlinkSync, openSync, closeSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const TUNABLES = join(ROOT, "src", "rules", "cpuTunables.js");
const TWEAKS_FILE = join(ROOT, "scripts", "cpu-lab-tweaks.mjs");
const FINGERPRINT = join(ROOT, "test", "fixtures", "cpu-fingerprint.txt");
const LOCK = join(ROOT, "data", "cpu-lab", "crown.lock");

const show = (value) => JSON.stringify(value);

// One crown at a time. O_EXCL is the whole mechanism: whichever process creates
// the file wins, and the loser carries on measuring rather than racing it.
function takeLock() {
  try {
    closeSync(openSync(LOCK, "wx"));
    return true;
  } catch {
    return false;
  }
}
const dropLock = () => { try { unlinkSync(LOCK); } catch { /* already gone */ } };

// The next free name for today. A fourth ship on one date is `-d`, which is also
// how the lineage reads in order.
function nextName(source, today) {
  const taken = new Set([...source.matchAll(/"(tuned-[0-9-]+[a-z]?)":/g)].map((m) => m[1]));
  if (!taken.has(`tuned-${today}`)) return `tuned-${today}`;
  for (const letter of "bcdefghijklmnopqrstuvwxyz") {
    if (!taken.has(`tuned-${today}${letter}`)) return `tuned-${today}${letter}`;
  }
  return null;
}

const nextSeq = (source) =>
  Math.max(0, ...[...source.matchAll(/^\s*seq:\s*(\d+),/gm)].map((m) => Number(m[1]))) + 1;

// Set a knob inside the DEFAULTS block only. Scoped to that block because the
// same `knob: value,` line appears in every frozen generation below it, and a
// global replace would rewrite history as well as the present.
function setDefault(source, knob, value) {
  const open = source.indexOf("export const CPU_TUNABLE_DEFAULTS = Object.freeze({");
  if (open < 0) return null;
  const close = source.indexOf("\n});", open);
  if (close < 0) return null;
  const block = source.slice(open, close);
  const pattern = new RegExp(`^(\\s*)${knob}:\\s*([^,\\n]+),`, "m");
  if (!pattern.test(block)) return null;
  const next = block.replace(pattern, (line, indent) => {
    const trailing = line.match(/,\s*(\/\/.*)$/);
    return `${indent}${knob}: ${show(value)},${trailing ? ` ${trailing[1]}` : ""}`;
  });
  return source.slice(0, open) + next + source.slice(close);
}

// The generation entry: every knob at the value it holds AFTER the change, read
// back out of the edited source so it cannot drift from what actually ships.
function generationBlock({ name, seq, git, note, knobs, order }) {
  const lines = order.map((knob) => `      ${knob}: ${show(knobs[knob])}`).join(",\n");
  return `  "${name}": Object.freeze({
    seq: ${seq},
    at: "${new Date().toISOString().slice(0, 10)}",
    git: "${git}",
    fingerprint: "PENDING",
    // Crowned automatically by the bench the moment the stopping rule accepted
    // it. The reading is in the candidate's \`settled\` line in
    // scripts/cpu-lab-tweaks.mjs; WHY the knob wants to be here is not something
    // the bench can write, and belongs in the commit that follows.
    note: ${show(note)},
    knobs: Object.freeze({
${lines}
    })
  }),
`;
}

function markSettled(id, line) {
  const source = readFileSync(TWEAKS_FILE, "utf8");
  const anchor = `    id: "${id}",\n`;
  if (!source.includes(anchor)) return { ok: false, reason: `no queued entry for "${id}"` };
  const at = source.indexOf(anchor);
  const params = source.indexOf("    params: {", at);
  if (params < 0) return { ok: false, reason: `no params line after "${id}"` };
  if (source.slice(at, params).includes("settled:")) return { ok: true, already: true };
  const next = `${source.slice(0, params)}    settled: ${show(line)},\n${source.slice(params)}`;
  writeFileSync(TWEAKS_FILE, next);
  return { ok: true };
}

// A candidate out of the ideas inbox has no entry in the hand-written queue, so
// there is nothing to mark. Give it one, carrying the reading, the way a human
// would have.
function adoptIdea(tweak, settledLine) {
  const source = readFileSync(TWEAKS_FILE, "utf8");
  if (source.includes(`    id: "${tweak.id}",\n`)) return markSettled(tweak.id, settledLine);
  const anchor = "const QUEUED = [\n";
  if (!source.includes(anchor)) return { ok: false, reason: "cannot find the queue array" };
  const entry = `  {
    id: ${show(tweak.id)},
    note: ${show(tweak.note)},
    // Came in through the ideas inbox and was crowned by the bench itself.
    settled: ${show(settledLine)},
    params: ${JSON.stringify(tweak.params)}
  },
`;
  writeFileSync(TWEAKS_FILE, source.replace(anchor, anchor + entry, 1));
  return { ok: true };
}

/**
 * Write an accepted candidate into the bidder. `verify` is called with no
 * arguments and must re-derive the accept from the record on disk; the crown is
 * refused if it returns anything but true, so a caller cannot talk the bench
 * into shipping something the rule did not accept.
 */
export function crownTheWinner({ tweak, reading, verify, git = "unknown", log = console.log }) {
  if (typeof verify === "function" && verify() !== true) {
    return { ok: false, reason: "the record does not show this candidate as accepted" };
  }
  const numeric = Object.entries(tweak.params ?? {});
  if (!numeric.length) return { ok: false, reason: "a candidate with no knobs cannot be crowned" };
  if (!takeLock()) return { ok: false, reason: "another process is crowning a winner right now" };

  const touched = [TUNABLES, TWEAKS_FILE, FINGERPRINT];
  for (const file of touched) if (existsSync(file)) copyFileSync(file, `${file}.bak`);
  const restore = () => {
    for (const file of touched) if (existsSync(`${file}.bak`)) copyFileSync(`${file}.bak`, file);
  };
  const cleanup = () => {
    for (const file of touched) { try { unlinkSync(`${file}.bak`); } catch { /* fine */ } }
    dropLock();
  };

  try {
    let source = readFileSync(TUNABLES, "utf8");
    for (const [knob, value] of numeric) {
      const next = setDefault(source, knob, value);
      if (!next) return (restore(), cleanup(), { ok: false, reason: `cannot place ${knob} in the defaults block` });
      source = next;
    }
    const today = new Date().toISOString().slice(0, 10);
    const name = nextName(source, today);
    if (!name) return (restore(), cleanup(), { ok: false, reason: "no free generation name left for today" });

    const note = `${numeric.map(([k, v]) => `${k} ${show(v)}`).join(", ")} — crowned by the bench on ${tweak.id}`;
    writeFileSync(TUNABLES, source);

    // The knob is in place, so the fingerprint can be taken. It has to happen
    // between the knob edit and the generation entry, because the entry records
    // the digest of the tree the knob change produced.
    const printed = execFileSync(process.execPath,
      [join(HERE, "cpu-fingerprint.mjs"), "--seeds", "1"], { encoding: "utf8", cwd: ROOT })
      .split("\n").filter((line) => line && !line.startsWith("cpu fingerprint")).join("\n");
    const digest = printed.match(/^\s*ALL\s+([0-9a-f]+)/m)?.[1];
    if (!digest) return (restore(), cleanup(), { ok: false, reason: "the fingerprint did not produce a digest" });
    writeFileSync(FINGERPRINT, `${printed}\n`);

    // Read the knobs back out of the edited module so the generation records
    // what the bidder actually holds, not what we meant to write.
    const live = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e",
      `import { CPU_TUNABLE_DEFAULTS } from ${show(TUNABLES)};`
      + `process.stdout.write(JSON.stringify(CPU_TUNABLE_DEFAULTS));`], { encoding: "utf8", cwd: ROOT }));

    // THE KNOB LIST COMES FROM THE MODULE, never from reading the source. Scraping
    // the defaults block for `knob: value,` lines missed snakeScarcityCap, which
    // is last and therefore has no trailing comma — so the generation recorded 34
    // of 35 knobs and baselineKey could not match it. The verify step caught that
    // and rolled the whole crown back, which is exactly what it is for, but the
    // lesson is to stop parsing a file we can simply import.
    const order = Object.keys(live);

    source = readFileSync(TUNABLES, "utf8");
    const open = source.indexOf("export const CPU_KNOB_GENERATIONS = Object.freeze({");
    if (open < 0) return (restore(), cleanup(), { ok: false, reason: "cannot find the generations block" });
    const after = source.indexOf("\n", open) + 1;
    const block = generationBlock({ name, seq: nextSeq(source), git, note, knobs: live, order })
      .replace('fingerprint: "PENDING"', `fingerprint: ${show(digest)}`);
    writeFileSync(TUNABLES, source.slice(0, after) + block + source.slice(after));

    const settledLine = `SHIPPED ${name} — ${reading} accepted; crowned by the bench, holdout and `
      + `head-to-head still outstanding`;
    const marked = tweak.idea ? adoptIdea(tweak, settledLine) : markSettled(tweak.id, settledLine);
    if (!marked.ok) return (restore(), cleanup(), { ok: false, reason: marked.reason });

    // THE CHECK THAT MATTERS: does the edited module still parse, and does it now
    // name the new generation as the shipped one? A child process, because this
    // one already has the old module cached.
    const check = execFileSync(process.execPath, ["--input-type=module", "-e",
      `import { baselineKey } from ${show(TUNABLES)}; process.stdout.write(baselineKey());`],
      { encoding: "utf8", cwd: ROOT }).trim();
    if (check !== name) {
      restore();
      cleanup();
      return { ok: false, reason: `the edited module reports "${check}" as the shipped bidder, not "${name}"` };
    }

    cleanup();
    log(`  CROWNED ${name} — ${numeric.map(([k, v]) => `${k}=${show(v)}`).join(" ")}`);
    log(`    fingerprint ${digest}, ${tweak.id} marked settled`);
    log(`    the run stops here: every reading from now on would be against a bidder that has changed.`);
    log(`    REVIEW AND COMMIT — the bench wrote the value, not the reason.`);
    return { ok: true, generation: name, fingerprint: digest };
  } catch (error) {
    restore();
    cleanup();
    return { ok: false, reason: String(error?.message ?? error) };
  }
}
