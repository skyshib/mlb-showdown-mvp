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

// Six plaques, every manager named at least once if the room allows it. Runs
// and home runs are always there; baserunning and defence come as WPAR when the
// room was dealt standing replacement cards and as raw counting stats when it
// was not, because a room without replacements has no WPAR to show.
export function traitLeaders(summary) {
  const teams = summary?.teams ?? [];
  if (!teams.length) return [];
  const hitters = summary.hitters ?? [];
  const pitchers = summary.pitchers ?? [];
  const byWpar = Boolean(summary.attribution);

  const plaques = [
    {
      key: "rs",
      label: "Runs scored",
      pick: best(teams, (row) => row.runsFor?.mean ?? 0),
      format: (value) => `${value.toFixed(2)} per game`
    },
    {
      key: "ra",
      label: "Runs allowed",
      pick: best(teams, (row) => row.runsAgainst?.mean ?? 99, { lowest: true }),
      format: (value) => `${value.toFixed(2)} per game`
    },
    {
      key: "hr",
      label: "Home runs",
      pick: best(teams, (row) => per162(teamTotals(hitters, row.team, "hr"), row.games)),
      format: (value) => `${Math.round(value)} per 162`
    },
    {
      key: "sb",
      label: "Stolen bases",
      pick: best(teams, (row) => per162(row.steals ?? 0, row.games)),
      format: (value) => `${Math.round(value)} per 162`
    },
    byWpar
      ? {
        key: "bsr",
        label: "Baserunning",
        pick: best(teams, (row) => warTotals(hitters, row.team, "baserunning")),
        format: (value) => `${signed(value, 1)} WPAR`
      }
      : {
        key: "bsr",
        label: "Baserunning",
        pick: best(teams, (row) => row.baserunningWpa ?? 0),
        format: (value) => `${signed(value, 2)} WPA`
      },
    byWpar
      ? {
        key: "def",
        label: "Defense",
        pick: best(teams, (row) => warTotals([...hitters, ...pitchers], row.team, "defense")),
        format: (value) => `${signed(value, 1)} WPAR`
      }
      : {
        key: "def",
        label: "Double plays",
        pick: best(teams, (row) => per162(row.doublePlays ?? 0, row.games)),
        format: (value) => `${Math.round(value)} per 162`
      }
  ];

  return plaques
    .filter((plaque) => plaque.pick)
    .map((plaque) => ({
      key: plaque.key,
      label: plaque.label,
      team: plaque.pick.row.team,
      value: plaque.format(plaque.pick.value)
    }));
}

function signed(value, places) {
  const text = Math.abs(value).toFixed(places);
  return `${value < 0 ? "−" : "+"}${text}`;
}

// Four counting-stat leaders with a card each. These settle early, which is why
// they sit at the second gate — and when one changes hands the panel changes
// with it, because a leader is a rank, not a name.
export function leagueLeaders(summary) {
  const hitters = summary?.hitters ?? [];
  const pitchers = summary?.pitchers ?? [];
  if (!hitters.length || !pitchers.length) return [];
  const qualified = hitters.filter((line) => line.pa >= Math.max(20, line.teamGames * 2));
  const bats = qualified.length ? qualified : hitters;
  const arms = pitchers.filter((line) => line.outs >= Math.max(30, line.teamGames));
  const staff = arms.length ? arms : pitchers;

  const picks = [
    { key: "hr", label: "Home runs", pick: best(bats, (line) => line.hrPer162 ?? 0), format: (v) => `${Math.round(v)}` },
    { key: "obp", label: "On base", pick: best(bats, (line) => line.obp ?? 0), format: (v) => v.toFixed(3).replace(/^0/, "") },
    { key: "sb", label: "Stolen bases", pick: best(bats, (line) => line.sbPer162 ?? 0), format: (v) => `${Math.round(v)}` },
    { key: "era", label: "Earned runs", pick: best(staff, (line) => line.runsPerNine ?? 99, { lowest: true }), format: (v) => v.toFixed(2) }
  ];

  return picks
    .filter((entry) => entry.pick)
    .map((entry) => ({
      key: entry.key,
      label: entry.label,
      id: entry.pick.row.id,
      name: entry.pick.row.name,
      team: entry.pick.row.team,
      value: entry.format(entry.pick.value)
    }));
}

// What a card was worth against what it cost, best three of each kind. The
// first beat that is about the managers rather than the players.
export function reckoning(summary, costs, { byMoney = false, count = 3 } = {}) {
  const value = valueReader(summary);
  const rank = (lines) => [...lines]
    .filter((line) => Number.isFinite(value(line)))
    .sort((a, b) => value(b) - value(a))
    .slice(0, count)
    .map((line, index) => ({
      rank: index + 1,
      id: line.id,
      name: line.name,
      team: line.team,
      value: signed(value(line), 1),
      cost: costs ? costs[line.id] ?? null : null
    }));

  const hitters = rank(summary?.hitters ?? []);
  const pitchers = rank(summary?.pitchers ?? []);
  // A bargain is a card that finished in the top three having cost near the
  // bottom: the cheapest third of what the room spent.
  const spent = costs ? Object.values(costs).map(Number).filter(Number.isFinite).sort((a, b) => a - b) : [];
  const cheap = spent.length ? spent[Math.floor(spent.length / 3)] : null;
  const flag = (entry) => ({
    ...entry,
    steal: cheap !== null && Number.isFinite(Number(entry.cost))
      && (byMoney ? Number(entry.cost) <= cheap : Number(entry.cost) >= spent[spent.length - 1 - Math.floor(spent.length / 3)])
  });

  return { hitters: hitters.map(flag), pitchers: pitchers.map(flag), byMoney };
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

// Every plate appearance the game itself thought was dangerous. If more than
// the cap clear the floor, raise the floor until the cap is met and keep them
// in the order they happened — the rule stays honest and the replay stays
// inside half a minute.
export function leverageMoments(game, { floor = LEVERAGE_FLOOR, cap = LEVERAGE_MOMENT_CAP } = {}) {
  const scored = (game?.events ?? [])
    .map((event, index) => ({ event, index, leverage: eventLeverage(event) ?? 0 }))
    // A plate appearance, not a trot around on somebody else's hit: the duel is
    // what the breakdown is about.
    .filter((entry) => entry.leverage >= floor && Number.isFinite(entry.event.controlRoll));
  if (scored.length <= cap) return scored;
  const cutoff = [...scored].sort((a, b) => b.leverage - a.leverage)[cap - 1].leverage;
  return scored.filter((entry) => entry.leverage >= cutoff).slice(0, cap);
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
