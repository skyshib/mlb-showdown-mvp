// Retry the missing FanGraphs fielding windows in decade-sized chunks with
// backoff; merge with the rows already saved.
import { readFile, writeFile } from "node:fs/promises";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" };
const existing = JSON.parse(await readFile(new URL("./fg-defense-raw.json", import.meta.url), "utf8"));
const have = new Set(existing.map((r) => r.window));

const WINDOWS = [];
for (let start = 1871; start <= 2021; start += 10) {
  const from = start === 1871 ? 1871 : start;
  const to = Math.min(from + 9, 2025);
  if (from >= 2000 && to <= 2010) continue; // covered by the 2000-2010 pull
  WINDOWS.push([from, to]);
}

const rows = existing;
for (const [from, to] of WINDOWS) {
  const tag = `${from}-${to}`;
  if (have.has(tag)) continue;
  let ok = false;
  for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    const url = `https://www.fangraphs.com/api/leaders/major-league/data?age=&pos=all&stats=fld&lg=all&qual=0&season=${to}&season1=${from}&startdate=&enddate=&month=0&hand=&team=0&pageitems=10000&pagenum=1&ind=0&rost=0&players=&type=1&postseason=&sortdir=default&sortstat=Defense`;
    try {
      const response = await fetch(url, { headers: UA });
      if (response.ok) {
        const payload = await response.json();
        for (const r of payload.data ?? []) {
          rows.push({ fg: r.playerid, name: r.PlayerName, pos: r.Pos ?? r.Position, inn: r.Inn ?? (r.G ? r.G * 8 : 0), def: r.Defense ?? 0, window: tag });
        }
        console.log(`${tag}: ${payload.data?.length ?? 0} rows`);
        ok = true;
      } else {
        console.log(`${tag}: HTTP ${response.status} (attempt ${attempt})`);
        await delay(2500 * attempt);
      }
    } catch (error) {
      console.log(`${tag}: ${error.message} (attempt ${attempt})`);
      await delay(2500 * attempt);
    }
  }
  await delay(1500);
}
await writeFile(new URL("./fg-defense-raw.json", import.meta.url), JSON.stringify(rows));
console.log("total rows now:", rows.length);
