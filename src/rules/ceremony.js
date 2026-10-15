// The reveal ceremony: what to say about a season, in what order, and when it
// is safe to say it.
//
// A sim used to be thirty seconds of a chart that stopped being interesting
// after the first three, because the winner is settled by about the ten
// thousandth game and the line never moves again. The ceremony spends those
// thirty seconds on everything else the run knows — who leads what, who won the
// awards, which pick stole the draft — and saves the standings for the end.
//
// The order is not arbitrary. A team's runs scored settles after a few thousand
// games; a batting title takes longer; first place takes all hundred thousand.
// That is a ladder of CONFIDENCE, and it happens to be the same shape as a
// ladder of DRAMA, so each beat is gated on how much of the sim has run and the
// gates rise. Everything on screen before its gate is still moving, and says so.
import { eventLeverage } from "./game.js?v=20260717-draft-wpa";
import { scheduleMatchups } from "./batch.js?v=20260725-starter-matchups";

// Matches HIGH_LEVERAGE in ui/render.js: the spot was worth at least twice an
// average plate appearance before the pitch was thrown. Deliberately NOT a
// win-probability threshold — a bases-loaded jam escaped on one pitch is
// terrifying and moves the game six points, and selecting on the swing would
// throw it away while keeping a three-run homer in a blowout.
export const LEVERAGE_FLOOR = 2;
export const LEVERAGE_MOMENT_CAP = 6;

// gate: the share of the sim that must be done before the beat may open.
// min:   the shortest it may ever be on screen, so nothing flashes past.
// dwell: what it gets when the sim is not the thing holding us up.
export const CEREMONY_BEATS = [
  { key: "traits", gate: 0.03, min: 3600, dwell: 6000 },
  { key: "leaders", gate: 0.12, min: 3400, dwell: 5000 },
  { key: "mvp", gate: 0.40, min: 4000, dwell: 6000 },
  { key: "cy", gate: 0.55, min: 4000, dwell: 6000 },
  { key: "reckoning", gate: 0.75, min: 6000, dwell: 9000 },
  { key: "countdown", gate: 1, min: 5200, dwell: 7000 },
  { key: "finalists", gate: 1, min: 3200, dwell: 3800 },
  // The replay runs itself and says when it is done.
  { key: "game", gate: 1, min: 0, dwell: 0 },
  { key: "epilogue", gate: 1, min: 3200, dwell: 4000 }
];

export function beatIndex(key) {
  return CEREMONY_BEATS.findIndex((beat) => beat.key === key);
}

// Whether the ceremony may move on. Elastic in both directions: a fast machine
// finishes the season around the fifth beat and the rest play at their minimum,
// while a slow one holds the beat it is on — with its figures still climbing —
// rather than stalling on a screen that has stopped moving.
export function readyForNextBeat(index, { progress, heldMs, skipping = false }) {
  const current = CEREMONY_BEATS[index];
  const next = CEREMONY_BEATS[index + 1];
  if (!current || !next) return false;
  if (skipping) return true;
  if (heldMs < current.min) return false;
  if (progress + 1e-9 < next.gate) return false;
  return heldMs >= Math.min(current.dwell, current.min) || progress >= 1;
}

// ---- the figures -------------------------------------------------------------

function per(total, games) {
  return games > 0 ? total / games : 0;
}

function per162(total, games) {
  return games > 0 ? (total * 162) / games : 0;
}

function best(rows, value, { lowest = false } = {}) {
  let winner = null;
  let mark = null;
  for (const row of rows) {
    const score = value(row);
    if (!Number.isFinite(score)) continue;
    if (mark === null || (lowest ? score < mark : score > mark)) {
      mark = score;
      winner = row;
    }
  }
  return winner === null ? null : { row: winner, value: mark };
}

function teamTotals(lines, team, field) {
  let total = 0;
  for (const line of lines) {
    if (line.team === team) total += Number(line[field]) || 0;
  }
  return total;
}

function warTotals(lines, team, part) {
  let total = 0;
  for (const line of lines) {
    if (line.team === team) total += Number(line.warPer162?.[part]) || 0;
  }
  return total;
}

// The room's two halves, three categories each. What a club does with the bat
// on top, what it does to the other club's bat underneath — so the board reads
// down a column as well as across a row, and a manager who leads on-base and
// gives up the fewest home runs is visibly doing both.
//
// Three a side rather than seven: average, OPS and extra bases all move with
// on-base and home runs, so the long row was the same story told four more
// times. The one that is not is the double play, which is why each side keeps
// its own — staying out of it, and turning it.
//
// Everything here is a club total rather than a rate off one card: the hitters
// are summed for the offence, and the arms for the defence. Slugging against
// is why pitcher lines carry doubles and triples at all.
export const TEAM_OFFENSE_KEYS = ["obp", "hr", "sb"];
export const TEAM_DEFENSE_KEYS = ["obp", "hr", "gidp"];

function offenseTotals(summary, team) {
  const totals = { ab: 0, h: 0, d: 0, t: 0, hr: 0, bb: 0, sb: 0, gidp: 0 };
  for (const line of summary.hitters ?? []) {
    if (line.team !== team) continue;
    totals.ab += line.ab ?? 0;
    totals.h += line.h ?? 0;
    totals.d += line.d ?? 0;
    totals.t += line.t ?? 0;
    totals.hr += line.hr ?? 0;
    totals.bb += line.bb ?? 0;
    totals.sb += line.sb ?? 0;
    totals.gidp += line.gidp ?? 0;
  }
  return totals;
}

function defenseTotals(summary, team) {
  const totals = { bf: 0, h: 0, d: 0, t: 0, hr: 0, bb: 0 };
  for (const line of summary.pitchers ?? []) {
    if (line.team !== team) continue;
    totals.bf += line.bf ?? 0;
    totals.h += line.h ?? 0;
    totals.d += line.d ?? 0;
    totals.t += line.t ?? 0;
    totals.hr += line.hr ?? 0;
    totals.bb += line.bb ?? 0;
  }
  return totals;
}

function rate(top, bottom) {
  return bottom > 0 ? top / bottom : 0;
}

function bases(totals) {
  // Singles are what is left when the extra-base hits are taken out.
  return totals.h + totals.d + (totals.t * 2) + (totals.hr * 3);
}

function three(value) {
  return value.toFixed(3).replace(/^0/, "");
}

export function teamStatBoard(summary) {
  const teams = summary?.teams ?? [];
  if (!teams.length) return { offense: [], defense: [] };
  const offense = new Map(teams.map((row) => [row.team, offenseTotals(summary, row.team)]));
  const defense = new Map(teams.map((row) => [row.team, defenseTotals(summary, row.team)]));

  const plaque = (key, label, side, value, format, lowest = false) => {
    const pick = best(teams, value, { lowest });
    if (!pick) return null;
    return { key: `${side}-${key}`, stat: key, label, side, team: pick.row.team, value: format(pick.value) };
  };

  const bat = (row) => offense.get(row.team) ?? {};
  const arm = (row) => defense.get(row.team) ?? {};

  const offenseRow = [
    plaque("obp", "On base", "offense", (row) => rate(bat(row).h + bat(row).bb, bat(row).ab + bat(row).bb), three),
    plaque("hr", "Home runs", "offense", (row) => per162(bat(row).hr, row.games), (v) => `${Math.round(v)} per 162`),
    plaque("sb", "Stolen bases", "offense", (row) => per162(row.steals ?? 0, row.games), (v) => `${Math.round(v)} per 162`)
  ];

  const defenseRow = [
    plaque("obp", "On base", "defense", (row) => rate(arm(row).h + arm(row).bb, arm(row).bf), three, true),
    plaque("hr", "Home runs", "defense", (row) => per162(arm(row).hr, row.games), (v) => `${Math.round(v)} per 162`, true),
    // The club that turns the most of them.
    plaque("gidp", "Turned two", "defense", (row) => per162(row.doublePlays ?? 0, row.games), (v) => `${Math.round(v)} per 162`)
  ];

  return { offense: offenseRow.filter(Boolean), defense: defenseRow.filter(Boolean) };
}

function signed(value, places) {
  const text = Math.abs(value).toFixed(places);
  return `${value < 0 ? "−" : "+"}${text}`;
}

// The same seven categories the club board runs, read one player at a time,
// three deep — plus the one thing a pitcher is judged on. A leader is a rank,
// so the board changes under you while the season is still being played.
//
// Qualifying is deliberately gentle: a tenth of the club's plate appearances
// keeps a pinch hitter with four at-bats off the batting title without
// throwing out a platoon bat who genuinely led it.
function qualified(lines, teamGames, share = 2) {
  const bar = Math.max(20, teamGames * share);
  const kept = lines.filter((line) => (line.pa ?? 0) >= bar);
  return kept.length >= 3 ? kept : lines;
}

function topThree(lines, value, { lowest = false } = {}) {
  return [...lines]
    .filter((line) => Number.isFinite(value(line)))
    .sort((a, b) => (lowest ? value(a) - value(b) : value(b) - value(a)))
    .slice(0, 3)
    .map((line, index) => ({ rank: index + 1, id: line.id, name: line.name, team: line.team, raw: value(line) }));
}

export function leagueLeaderBoard(summary) {
  const hitters = summary?.hitters ?? [];
  const pitchers = summary?.pitchers ?? [];
  if (!hitters.length || !pitchers.length) return [];
  const games = hitters[0]?.teamGames ?? 0;
  const bats = qualified(hitters, games);
  const arms = pitchers.filter((line) => (line.outs ?? 0) >= Math.max(30, games));
  const staff = arms.length >= 3 ? arms : pitchers;

  const three = (value) => value.toFixed(3).replace(/^0/, "");
  const whole = (value) => String(Math.round(value));

  // Five, not eight: average is on-base without the walks, and extra bases and
  // the double play are footnotes next to who got on and who went deep. What is
  // left is the back of a baseball card.
  const categories = [
    { key: "ops", label: "OPS", lines: bats, value: (line) => line.ops, format: three },
    { key: "obp", label: "On base", lines: bats, value: (line) => line.obp, format: three },
    { key: "hr", label: "Home runs", lines: bats, value: (line) => line.hrPer162, format: whole },
    { key: "sb", label: "Stolen bases", lines: bats, value: (line) => line.sbPer162, format: whole },
    { key: "era", label: "Earned runs", lines: staff, value: (line) => line.runsPerNine, format: (value) => value.toFixed(2), lowest: true }
  ];

  return categories.map((category) => ({
    key: category.key,
    label: category.label,
    entries: topThree(category.lines, category.value, { lowest: category.lowest })
      .map((entry) => ({ ...entry, value: category.format(entry.raw) }))
  })).filter((category) => category.entries.length);
}

// What a card was worth against what it cost — the best three of each kind and
// the worst three, which is the only beat in the ceremony that is about the
// managers rather than the players.
//
// Value is a rank against a rank, not a number against a number: where a card
// finished among its own kind, against where it was taken or what it cost. A
// card that finished third among hitters having been the twentieth most
// expensive is +17 and the steal of the draft; the other way round is the bust.
export function valuePicks(summary, costs, { byMoney = false, count = 3 } = {}) {
  const value = valueReader(summary);
  const board = (lines) => {
    const ranked = [...lines]
      .filter((line) => Number.isFinite(value(line)) && Number.isFinite(Number(costs?.[line.id])))
      .sort((a, b) => value(b) - value(a))
      .map((line, index) => ({ line, production: index + 1 }));
    if (!ranked.length) return { best: [], worst: [] };
    // Dearest first in an auction, earliest pick first in a snake draft: both
    // are "what the room spent on him", counted the same way.
    const byCost = [...ranked].sort((a, b) => (byMoney
      ? Number(costs[b.line.id]) - Number(costs[a.line.id])
      : Number(costs[a.line.id]) - Number(costs[b.line.id])));
    const costRank = new Map(byCost.map((entry, index) => [entry.line.id, index + 1]));
    const scored = ranked.map((entry) => ({
      id: entry.line.id,
      name: entry.line.name,
      team: entry.line.team,
      value: signed(value(entry.line), 1),
      cost: Number(costs[entry.line.id]),
      production: entry.production,
      surplus: costRank.get(entry.line.id) - entry.production
    }));
    const high = [...scored].sort((a, b) => b.surplus - a.surplus);
    const low = [...scored].sort((a, b) => a.surplus - b.surplus);
    const take = (rows) => rows.slice(0, count).map((row, index) => ({ ...row, rank: index + 1 }));
    return { best: take(high), worst: take(low) };
  };
  return {
    hitters: board(summary?.hitters ?? []),
    pitchers: board(summary?.pitchers ?? []),
    byMoney
  };
}

function valueReader(summary) {
  return summary?.attribution
    ? (line) => line.warPer162?.total
    : (line) => line.wpaPerSeason;
}

// The standings, and how much of them may be shown. Counting down to second
// place names the champion by elimination, so the countdown stops at third and
// the last two are shown as a pair with no order between them.
export function countdownRows(summary) {
  const rows = [...(summary?.teams ?? [])].sort((a, b) => b.winPct - a.winPct);
  return {
    counted: rows.slice(2).reverse(),
    finalists: rows.slice(0, 2),
    all: rows
  };
}

// ---- the championship game ---------------------------------------------------

// Every index in the season where these two met. The schedule is a fixed round
// robin, so this is arithmetic rather than a search.
export function meetingIndices(teams, totalGames, away, home, scheduleVersion) {
  const matchups = scheduleMatchups(teams, scheduleVersion);
  if (!matchups.length) return [];
  const slots = [];
  matchups.forEach((matchup, slot) => {
    const pair = (matchup.away === away && matchup.home === home)
      || (matchup.away === home && matchup.home === away);
    if (pair) slots.push(slot);
  });
  const indices = [];
  for (let cycle = 0; cycle * matchups.length < totalGames; cycle += 1) {
    for (const slot of slots) {
      const index = cycle * matchups.length + slot;
      if (index < totalGames) indices.push(index);
    }
  }
  return indices.sort((a, b) => a - b);
}

// The game to play back: of the meetings the champion won, the one whose final
// score sits closest to the average of all of them. No other filter — a game
// that was never close is still what usually happened, and screening for lead
// changes would quietly turn "typical" into "exciting", which is a different
// claim. The leverage floor decides what is worth dwelling on inside it.
export function pickRepresentative(meetings, champion) {
  const played = meetings.filter((meeting) => meeting.winner);
  if (!played.length) return null;
  let championRuns = 0;
  let opponentRuns = 0;
  for (const meeting of played) {
    const home = meeting.home === champion;
    championRuns += home ? meeting.homeRuns : meeting.awayRuns;
    opponentRuns += home ? meeting.awayRuns : meeting.homeRuns;
  }
  const meanFor = championRuns / played.length;
  const meanAgainst = opponentRuns / played.length;
  const won = played.filter((meeting) => meeting.winner === champion);
  const pool = won.length ? won : played;
  // Dozens of meetings tie on distance — 4-2 is 4-2 whenever it happened — so
  // the tie goes to the one nearest the middle of the season rather than to
  // whichever came first, which would always hand us a game from the opening
  // cycle and make every room's championship game look like game eight.
  let bestDistance = Infinity;
  let tied = [];
  for (const meeting of pool) {
    const home = meeting.home === champion;
    const scored = home ? meeting.homeRuns : meeting.awayRuns;
    const allowed = home ? meeting.awayRuns : meeting.homeRuns;
    const distance = Math.abs(scored - meanFor) + Math.abs(allowed - meanAgainst);
    if (distance < bestDistance - 1e-9) {
      bestDistance = distance;
      tied = [meeting];
    } else if (Math.abs(distance - bestDistance) <= 1e-9) {
      tied.push(meeting);
    }
  }
  const middle = pool[Math.floor(pool.length / 2)]?.index ?? 0;
  let pick = null;
  for (const meeting of tied) {
    if (!pick || Math.abs(meeting.index - middle) < Math.abs(pick.index - middle)) pick = meeting;
  }
  return pick ? { ...pick, meanFor, meanAgainst, meetings: played.length, won: won.length } : null;
}

// Every plate appearance the game itself thought was dangerous, plus the whole
// of the last inning. If more than the cap clear the floor, raise the floor
// until the cap is met and keep them in the order they happened — the rule
// stays honest and the replay stays inside half a minute.
//
// The closing inning is in whether it was dangerous or not: a championship ends
// on its last out, and cutting away from a 1-2-3 ninth to a loud spot in the
// fourth is the one edit nobody watching would make. It is also why the cap
// bends — the inning is kept whole and the leverage picks take what is left.
export function leverageMoments(game, { floor = LEVERAGE_FLOOR, cap = LEVERAGE_MOMENT_CAP } = {}) {
  // A plate appearance, not a trot around on somebody else's hit: the duel is
  // what the breakdown is about.
  const pitched = (game?.events ?? [])
    .map((event, index) => ({ event, index, leverage: eventLeverage(event) ?? 0 }))
    .filter((entry) => Number.isFinite(entry.event.controlRoll));
  const last = pitched.reduce((high, entry) => Math.max(high, Number(entry.event.inning) || 0), 0);
  const closing = new Set(
    pitched.filter((entry) => (Number(entry.event.inning) || 0) === last).map((entry) => entry.index)
  );
  const scored = pitched.filter((entry) => closing.has(entry.index) || entry.leverage >= floor);
  if (scored.length <= cap) return scored;
  const earlier = scored.filter((entry) => !closing.has(entry.index));
  const room = Math.max(0, cap - closing.size);
  if (earlier.length <= room) return scored;
  if (!room) return scored.filter((entry) => closing.has(entry.index));
  const cutoff = [...earlier].sort((a, b) => b.leverage - a.leverage)[room - 1].leverage;
  const kept = new Set(earlier.filter((entry) => entry.leverage >= cutoff).slice(0, room).map((entry) => entry.index));
  return scored.filter((entry) => closing.has(entry.index) || kept.has(entry.index));
}

// The win probability line, one point per event, read from the champion's side
// so the chart climbs when the team the room is about to meet is winning.
export function winProbabilitySeries(game, championSide) {
  const events = game?.events ?? [];
  const flip = championSide === "away";
  const series = [{ index: 0, wp: 50 }];
  events.forEach((event, index) => {
    const home = Number(event.wpAfter);
    if (!Number.isFinite(home)) return;
    series.push({ index: index + 1, wp: (flip ? 1 - home : home) * 100 });
  });
  return series;
}
