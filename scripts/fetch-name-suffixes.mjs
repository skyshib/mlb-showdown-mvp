#!/usr/bin/env node
// Distill the Chadwick register's name suffixes into a small map keyed by
// bbref id (== the databank playerID): {"guerrvl02": "Jr.", ...}. Lahman's
// People.csv has no suffix column, so without this the two Vladimir
// Guerreros collide and the son cards as "Vladimir Guerrero '19".
// Writes scripts/name-suffixes.json (small, committed).
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHARDS = "0123456789abcdef".split("");
const suffixes = {};

// Minimal CSV field splitter that respects quotes.
function fields(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

for (const shard of SHARDS) {
  const url = `https://raw.githubusercontent.com/chadwickbureau/register/master/data/people-${shard}.csv`;
  const text = await (await fetch(url)).text();
  const lines = text.split("\n");
  const header = fields(lines[0]);
  const bbref = header.indexOf("key_bbref");
  const suffix = header.indexOf("name_suffix");
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const row = fields(line);
    if (row[bbref] && row[suffix]) suffixes[row[bbref]] = row[suffix];
  }
  console.error(`people-${shard}: ${Object.keys(suffixes).length} suffixes so far`);
}

// Second source: the MLB StatsAPI, which carries the BRANDED suffix the
// register treats as legalese — the register skips Vladimir Guerrero Jr.
// and Fernando Tatis Jr.; StatsAPI prints them the way the jersey does.
const { default: mlbamMap } = await import("./mlbam-map.json", { with: { type: "json" } });
const byMlbam = new Map(Object.entries(mlbamMap).map(([pid, am]) => [am, pid]));
const ids = [...byMlbam.keys()];
for (let at = 0; at < ids.length; at += 250) {
  const batch = ids.slice(at, at + 250);
  const url = `https://statsapi.mlb.com/api/v1/people?personIds=${batch.join(",")}`;
  const data = await (await fetch(url)).json();
  for (const person of data.people ?? []) {
    if (person.nameSuffix) suffixes[byMlbam.get(person.id)] = person.nameSuffix;
  }
  if (at % 5000 === 0) console.error(`statsapi ${at}/${ids.length}...`);
}

writeFileSync(join(HERE, "name-suffixes.json"), JSON.stringify(suffixes, null, 0) + "\n");
console.error(`wrote scripts/name-suffixes.json (${Object.keys(suffixes).length} players)`);
