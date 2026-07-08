// Fetch FanGraphs fielding leaderboards (their exported-data endpoint) in
// era windows — one aggregated request per window, politely spaced — plus the
// Chadwick register shards for FanGraphs-to-Lahman id mapping.
import { writeFile, mkdir, readFile } from "node:fs/promises";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" };

const WINDOWS = [
  [1871, 1899], [1900, 1919], [1920, 1939], [1940, 1959],
  [1960, 1979], [1980, 1999], [2000, 2010], [2011, 2025]
];

const rows = [];
for (const [from, to] of WINDOWS) {
  const url = `https://www.fangraphs.com/api/leaders/major-league/data?age=&pos=all&stats=fld&lg=all&qual=0&season=${to}&season1=${from}&startdate=&enddate=&month=0&hand=&team=0&pageitems=10000&pagenum=1&ind=0&rost=0&players=&type=1&postseason=&sortdir=default&sortstat=Defense`;
  const response = await fetch(url, { headers: UA });
  if (!response.ok) {
    console.log(`window ${from}-${to}: HTTP ${response.status} — skipping`);
    await delay(1200);
    continue;
  }
  const payload = await response.json();
  const data = payload.data ?? [];
  for (const r of data) {
    rows.push({
      fg: r.playerid, name: r.PlayerName, pos: r.Pos ?? r.Position,
      inn: r.Inn ?? (r.G ? r.G * 8 : 0), def: r.Defense ?? 0,
      window: `${from}-${to}`
    });
  }
  console.log(`window ${from}-${to}: ${data.length} rows (total ${payload.totalCount})`);
  await delay(1200);
}
await writeFile(new URL("./fg-defense-raw.json", import.meta.url), JSON.stringify(rows));
console.log("saved", rows.length, "player-window rows");

// Chadwick register shards: fangraphs id -> bbref/lahman id.
await mkdir(new URL("./register/", import.meta.url), { recursive: true });
const map = {};
for (const shard of "0123456789abcdef") {
  const url = `https://raw.githubusercontent.com/chadwickbureau/register/master/data/people-${shard}.csv`;
  const response = await fetch(url, { headers: UA });
  if (!response.ok) { console.log(`register ${shard}: ${response.status}`); continue; }
  const text = await response.text();
  const lines = text.split("\n");
  const header = lines[0].split(",");
  const fgIdx = header.indexOf("key_fangraphs");
  const bbIdx = header.indexOf("key_bbref");
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const fg = cells[fgIdx], bb = cells[bbIdx];
    if (fg && bb) map[fg] = bb;
  }
  console.log(`register ${shard}: ok (${Object.keys(map).length} mapped so far)`);
  await delay(300);
}
await writeFile(new URL("./fg-id-map.json", import.meta.url), JSON.stringify(map));
console.log("id map saved:", Object.keys(map).length);
