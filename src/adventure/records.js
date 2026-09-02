import { almanacGames, seasonHitters, seasonPitchers } from "./state.js?v=20260716-records";
import { loadHallOfFame } from "./hallOfFame.js?v=20260716-records";

// The record book, and it is the whole league's, not yours.
//
// The trophy room is a display case for the things YOU did. This is the other
// thing: the number to beat. Every record here is read back out of the almanac —
// the box score of every game you have ever played is already sitting in the
// save — so most of them light up the moment you open the screen, with the
// history you already have behind them.
//
// The exception is the hit streak, which needs the play-by-play and not the box
// score, and the play-by-play is not kept. So it is measured at the final out
// and filed on the almanac page (see recordFinishedGame). Games played before
// today have no streak on them and simply do not compete for it: an empty record
// is honest, and a fabricated one is not.
//
// The book has two halves, because it is keeping two different kinds of score.
// A MANAGER record is a thing you did on an afternoon: nine runs, a two-hit
// shutout, six in a row. A PLAYER record is a thing one of your men did over a
// whole campaign, and it belongs to HIM — the manager who owned him goes on the
// line too, the way a record is always read out. They rank separately, because
// ranking them together would be asking whether a slugger beat a Tuesday.

const HIT_RESULTS = new Set(["1B", "1B+", "2B", "3B", "HR"]);

// The longest run of hits, back to back, with nothing in between. A walk is not
// a hit and it breaks the run — these are CONSECUTIVE HITS, not a hitting
// streak, and the difference is the point of the record.
export function longestHitStreak(events, teamName) {
  let best = 0;
  let run = 0;
  for (const event of events ?? []) {
    // Steals and extra-base attempts are not plate appearances; they have no
    // result and they neither make nor break a run of hits.
    if (!event?.result || event.battingTeam !== teamName) continue;
    run = HIT_RESULTS.has(event.result) ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

const sum = (lines, field) => (lines ?? []).reduce((total, line) => total + (Number(line[field]) || 0), 0);

// The two halves of the book, in the order you page through them.
export const RECORD_PAGES = [
  { key: "manager", title: "MANAGER RECORDS" },
  { key: "player", title: "PLAYER RECORDS" }
];

// A rate is not a count, and printing it as one ("0.8421052631578947 OPS") is
// how you lose a reader. Three ways to print one, and they are the three ways
// they are printed on the back of the card: an average drops its leading nought,
// an earned-run figure keeps it, and a per-nine gets the one decimal it deserves.
const rate = (value) => value.toFixed(3).replace(/^0\./, ".");
const era = (value) => value.toFixed(2);
const perNine = (value) => value.toFixed(1);

// A man has to have played enough to have a rate at all. One perfect afternoon
// is not a season, and a board that cannot tell the difference belongs to
// whoever went 1-for-1 in September. The same is true of a club: a manager who
// has won his only game has not got the best record in the league.
const QUALIFIED_PA = 40;
const QUALIFIED_OUTS = 45; // fifteen innings
const QUALIFIED_GAMES = 20;

// Every record: what it is called, which half of the book it is in, which way is
// better, and how to read it out of a save. `read` returns the best mark for it,
// or null when the save has never done the thing.
//
// `opens` marks the records whose mark points at ONE AFTERNOON — a day and an
// opponent you can go and look at. A campaign total does not, and neither does a
// finished run, so those do not pretend to: see openable() in the screen.
export const RECORDS = [
  {
    key: "runs-game",
    page: "manager",
    group: "AT THE PLATE",
    title: "MOST RUNS IN A GAME",
    better: "max",
    atLeastOne: true,
    unit: "runs",
    opens: true,
    read: (save) => bestGame(save, "max", (game) => game.score?.[game.playerSide])
  },
  {
    key: "margin-game",
    page: "manager",
    group: "AT THE PLATE",
    title: "BIGGEST WIN MARGIN",
    better: "max",
    unit: "runs",
    opens: true,
    read: (save) => bestGame(save, "max", (game) => {
      if (!game.won) return null;
      const theirs = game.playerSide === "away" ? "home" : "away";
      return game.score[game.playerSide] - game.score[theirs];
    })
  },
  {
    key: "homers-game",
    page: "manager",
    group: "AT THE PLATE",
    // The club's nine, not one man's afternoon — that is on the other page now,
    // and two records called the same thing are two records nobody trusts.
    title: "MOST HOMERS IN A GAME (CLUB)",
    better: "max",
    atLeastOne: true,
    unit: "HR",
    opens: true,
    read: (save) => bestGame(save, "max", (game) => sum(mine(game)?.hitters, "hr"))
  },
  {
    key: "steals-game",
    page: "manager",
    group: "AT THE PLATE",
    title: "MOST STEALS IN A GAME (CLUB)",
    better: "max",
    atLeastOne: true,
    unit: "SB",
    opens: true,
    read: (save) => bestGame(save, "max", (game) => sum(mine(game)?.hitters, "sb"))
  },
  {
    key: "advances-game",
    page: "manager",
    group: "AT THE PLATE",
    // An advancement is an extra base taken on the bases — first to third, second
    // home — beyond the base the hit itself was worth.
    title: "MOST EXTRA BASES TAKEN IN A GAME (CLUB)",
    better: "max",
    atLeastOne: true,
    unit: "XBT",
    opens: true,
    read: (save) => bestGame(save, "max", (game) => sum(mine(game)?.hitters, "adv"))
  },
  {
    key: "comeback",
    page: "manager",
    group: "AT THE PLATE",
    title: "BIGGEST COMEBACK",
    better: "max",
    unit: "runs",
    opens: true,
    read: (save) => bestGame(save, "max", comeback)
  },
  {
    key: "inning-runs",
    page: "manager",
    group: "AT THE PLATE",
    title: "MOST RUNS IN AN INNING",
    better: "max",
    unit: "runs",
    opens: true,
    read: (save) => bestGame(save, "max", biggestInning)
  },
  {
    key: "strikeouts-game",
    page: "manager",
    group: "ON THE MOUND",
    // The whole staff. One arm's own board is on the player page.
    title: "MOST STRIKEOUTS IN A GAME (STAFF)",
    better: "max",
    atLeastOne: true,
    unit: "K",
    opens: true,
    read: (save) => bestGame(save, "max", (game) => sum(mine(game)?.pitchers, "so"))
  },
  {
    key: "caught-stealing-game",
    page: "manager",
    group: "ON THE MOUND",
    // A caught stealing is charged to the runner, so YOUR defense's throw-outs are
    // read off the other dugout's line — the runners they lost on the bases to you.
    title: "MOST RUNNERS CAUGHT STEALING IN A GAME (CLUB)",
    better: "max",
    atLeastOne: true,
    unit: "CS",
    opens: true,
    read: (save) => bestGame(save, "max", (game) => sum(game.boxScore?.[theirSide(game)]?.hitters, "cs"))
  },
  {
    key: "caught-advancing-game",
    page: "manager",
    group: "ON THE MOUND",
    // Charged to the runner, like a caught stealing, so your defense's throw-outs
    // are the extra bases the OTHER dugout's runners tried for and lost.
    title: "MOST RUNNERS THROWN OUT ADVANCING IN A GAME (CLUB)",
    better: "max",
    atLeastOne: true,
    unit: "outs",
    opens: true,
    read: (save) => bestGame(save, "max", (game) => sum(game.boxScore?.[theirSide(game)]?.hitters, "advOut"))
  },
  {
    key: "hits-allowed-win",
    page: "manager",
    group: "ON THE MOUND",
    title: "FEWEST HITS ALLOWED IN A WIN",
    better: "min",
    unit: "hits",
    opens: true,
    // Nine innings or it is not a pitching record, it is a short game.
    read: (save) => bestGame(save, "min", (game) => {
      if (!game.won || (game.innings ?? 0) < 9) return null;
      return sum(mine(game)?.pitchers, "h");
    })
  },
  {
    key: "shutouts",
    page: "manager",
    group: "ON THE MOUND",
    title: "MOST SHUTOUTS IN A CAMPAIGN",
    better: "max",
    unit: "shutouts",
    read: (save) => countGames(save, (game) => game.score?.[theirSide(game)] === 0)
  },
  {
    key: "hit-streak",
    page: "manager",
    group: "STREAKS",
    title: "MOST CONSECUTIVE HITS",
    better: "max",
    atLeastOne: true,
    unit: "hits",
    opens: true,
    read: (save) => bestGame(save, "max", (game) => game.hitStreak ?? null)
  },
  {
    key: "win-streak",
    page: "manager",
    group: "STREAKS",
    title: "LONGEST WINNING STREAK",
    better: "max",
    unit: "wins",
    opens: true,
    read: (save) => longestWinStreak(save)
  },
  {
    key: "scoreless-streak",
    page: "manager",
    group: "STREAKS",
    title: "LONGEST SCORELESS STREAK",
    better: "max",
    unit: "innings",
    opens: true,
    read: (save) => scorelessStreak(save)
  },
  {
    key: "longest-game",
    page: "manager",
    group: "THE LONG HAUL",
    title: "LONGEST GAME",
    better: "max",
    unit: "innings",
    opens: true,
    read: (save) => bestGame(save, "max", (game) => ((game.innings ?? 0) > 9 ? game.innings : null))
  },
  {
    key: "win-pct",
    page: "manager",
    group: "THE LONG HAUL",
    title: `BEST WIN RATE (${QUALIFIED_GAMES} GP)`,
    better: "max",
    unit: "",
    format: rate,
    read: (save) => winRate(save)
  },
  {
    key: "catalog-days",
    page: "manager",
    group: "THE LONG HAUL",
    title: "FASTEST FULL CATALOG",
    better: "min",
    unit: "days",
    read: (save) => catalogDays(save)
  },
  {
    key: "fewest-losses-title",
    page: "manager",
    group: "THE LONG HAUL",
    title: "FEWEST LOSSES IN A TITLE RUN",
    better: "min",
    unit: "losses",
    fromRun: true,
    read: () => fewestTitleLosses()
  },
  // Two boards, not one. A pennant bought with an uncapped chequebook and a
  // pennant built inside the budget are not the same feat, and the clock does not
  // know the difference — so ranking them against each other only ever tells you
  // which manager was allowed to spend more. One book each; they are not rivals.
  {
    key: "fastest-title-budget",
    page: "manager",
    group: "THE LONG HAUL",
    title: "FASTEST CHAMPIONSHIP (BUDGET)",
    better: "min",
    unit: "days",
    fromRun: true,
    read: () => fastestTitle("budget")
  },
  {
    key: "fastest-title-uncapped",
    page: "manager",
    group: "THE LONG HAUL",
    title: "FASTEST CHAMPIONSHIP (UNCAPPED)",
    better: "min",
    unit: "days",
    fromRun: true,
    read: () => fastestTitle("uncapped")
  },
  // Three boards, for the same reason the championship has two: six clubs built
  // a shade over your budget and six built at the World Series budget are not the
  // same six clubs, and ranking a CONTENDER run against an IMMORTAL one only ever
  // says which wall was shorter. A gauntlet run's score is how far it got.
  {
    key: "deepest-gauntlet-contender",
    page: "manager",
    group: "THE LONG HAUL",
    title: "DEEPEST GAUNTLET RUN (CONTENDER)",
    better: "max",
    unit: "cleared",
    fromRun: true,
    read: () => deepestGauntlet("contender")
  },
  {
    key: "deepest-gauntlet-elite",
    page: "manager",
    group: "THE LONG HAUL",
    title: "DEEPEST GAUNTLET RUN (ELITE)",
    better: "max",
    unit: "cleared",
    fromRun: true,
    read: () => deepestGauntlet("elite")
  },
  {
    key: "deepest-gauntlet-immortal",
    page: "manager",
    group: "THE LONG HAUL",
    title: "DEEPEST GAUNTLET RUN (IMMORTAL)",
    better: "max",
    unit: "cleared",
    fromRun: true,
    read: () => deepestGauntlet("immortal")
  },
  {
    key: "twenties-game",
    page: "manager",
    group: "AT THE TABLE",
    // The dice, not the diamond. Every d20 the game throws — pitch, swing, throw
    // to a base, either dugout — and how many came up 20 on the luckiest afternoon.
    // Only games played since the count existed compete; older ones never rolled
    // a tracked die and simply do not.
    title: "MOST 20s ROLLED IN A GAME",
    better: "max",
    unit: "",
    opens: true,
    read: (save) => bestGame(save, "max", (game) => game.twenties || null)
  },

  // The other half. Every one of these belongs to ONE man, and he is named on the
  // line — the manager is only the club he did it for.
  //
  // First the afternoons. These have a day and an opponent behind them, so they
  // open into the box score the way a manager's record does: you can go and watch
  // the game the man had.
  {
    key: "player-hr-game",
    page: "player",
    group: "AT THE PLATE",
    title: "MOST HOMERS IN A GAME (ONE MAN)",
    better: "max",
    unit: "HR",
    opens: true,
    // side + measure let the board read EVERY man tied at the top, not just the
    // first (see coLeaders); read is the same measure, single best.
    side: "hitters",
    measure: (line) => line.hr || null,
    read: (save) => bestPlayerGame(save, "max", "hitters", (line) => line.hr || null)
  },
  {
    key: "player-rbi-game",
    page: "player",
    group: "AT THE PLATE",
    title: "MOST RBI IN A GAME",
    better: "max",
    unit: "RBI",
    opens: true,
    side: "hitters",
    measure: (line) => line.rbi || null,
    read: (save) => bestPlayerGame(save, "max", "hitters", (line) => line.rbi || null)
  },
  {
    key: "player-hits-game",
    page: "player",
    group: "AT THE PLATE",
    title: "MOST HITS IN A GAME",
    better: "max",
    unit: "hits",
    opens: true,
    side: "hitters",
    measure: (line) => line.h || null,
    read: (save) => bestPlayerGame(save, "max", "hitters", (line) => line.h || null)
  },
  {
    key: "player-sb-game",
    page: "player",
    group: "AT THE PLATE",
    title: "MOST STEALS IN A GAME (ONE MAN)",
    better: "max",
    unit: "SB",
    opens: true,
    side: "hitters",
    measure: (line) => line.sb || null,
    read: (save) => bestPlayerGame(save, "max", "hitters", (line) => line.sb || null)
  },
  {
    key: "player-adv-game",
    page: "player",
    group: "AT THE PLATE",
    title: "MOST EXTRA BASES TAKEN IN A GAME (ONE MAN)",
    better: "max",
    unit: "XBT",
    opens: true,
    side: "hitters",
    measure: (line) => line.adv || null,
    read: (save) => bestPlayerGame(save, "max", "hitters", (line) => line.adv || null)
  },
  // Then the careers: a whole campaign in one man's hands. (The sections have to
  // stay in one piece — the menu prints a header every time the group changes, so
  // a plate record filed after a mound one would print AT THE PLATE twice.)
  {
    key: "player-homers",
    page: "player",
    group: "AT THE PLATE",
    title: "MOST HOMERS, CAREER",
    better: "max",
    unit: "HR",
    read: (save) => bestPlayer(seasonHitters(save), "max", (line) => line.hr || null)
  },
  {
    key: "player-hits",
    page: "player",
    group: "AT THE PLATE",
    title: "MOST HITS, CAREER",
    better: "max",
    unit: "hits",
    read: (save) => bestPlayer(seasonHitters(save), "max", (line) => line.h || null)
  },
  {
    key: "player-rbi",
    page: "player",
    group: "AT THE PLATE",
    title: "MOST RBI, CAREER",
    better: "max",
    unit: "RBI",
    read: (save) => bestPlayer(seasonHitters(save), "max", (line) => line.rbi || null)
  },
  {
    key: "player-steals",
    page: "player",
    group: "AT THE PLATE",
    title: "MOST STOLEN BASES, CAREER",
    better: "max",
    unit: "SB",
    read: (save) => bestPlayer(seasonHitters(save), "max", (line) => line.sb || null)
  },
  {
    key: "player-avg",
    page: "player",
    group: "AT THE PLATE",
    title: `BEST AVERAGE (${QUALIFIED_PA} PA)`,
    better: "max",
    unit: "",
    format: rate,
    read: (save) => bestPlayer(seasonHitters(save), "max", (line) => (line.pa >= QUALIFIED_PA ? line.avg : null))
  },
  {
    key: "player-ops",
    page: "player",
    group: "AT THE PLATE",
    title: `BEST OPS (${QUALIFIED_PA} PA)`,
    better: "max",
    unit: "OPS",
    format: rate,
    read: (save) => bestPlayer(seasonHitters(save), "max", (line) => (line.pa >= QUALIFIED_PA ? line.ops : null))
  },
  {
    key: "player-k-game",
    page: "player",
    group: "ON THE MOUND",
    title: "MOST STRIKEOUTS IN A GAME (ONE ARM)",
    better: "max",
    unit: "K",
    opens: true,
    side: "pitchers",
    measure: (line) => line.so || null,
    read: (save) => bestPlayerGame(save, "max", "pitchers", (line) => line.so || null)
  },
  {
    key: "player-no-hitter",
    page: "player",
    group: "ON THE MOUND",
    // The no-hitter board. A man who went the distance and gave up nothing reads
    // 0 HITS, which is the whole point of it — so, again: never a truthiness test.
    // He has to have gone the distance, too: three innings of hitless relief is a
    // fine evening, and it is not this record.
    title: "FEWEST HITS, COMPLETE GAME",
    better: "min",
    unit: "hits",
    opens: true,
    side: "pitchers",
    measure: (line) => (line.outs >= 27 ? line.h : null),
    read: (save) => bestPlayerGame(save, "min", "pitchers", (line) => (line.outs >= 27 ? line.h : null))
  },
  {
    key: "player-strikeouts",
    page: "player",
    group: "ON THE MOUND",
    title: "MOST STRIKEOUTS, CAREER",
    better: "max",
    unit: "K",
    read: (save) => bestPlayer(seasonPitchers(save), "max", (line) => line.so || null)
  },
  {
    key: "player-ra9",
    page: "player",
    group: "ON THE MOUND",
    // A shutout arm reads 0.00 here, and that is a real number, not a missing
    // one — so this measure must never be filtered on truthiness.
    title: `LOWEST RUNS PER 9 (${QUALIFIED_OUTS / 3} IP)`,
    better: "min",
    unit: "RA9",
    format: era,
    read: (save) => bestPlayer(seasonPitchers(save), "min", (line) => (line.outs >= QUALIFIED_OUTS ? line.runsPerNine : null))
  },
  {
    key: "player-whip",
    page: "player",
    group: "ON THE MOUND",
    title: `LOWEST WHIP (${QUALIFIED_OUTS / 3} IP)`,
    better: "min",
    unit: "WHIP",
    format: era,
    read: (save) => bestPlayer(seasonPitchers(save), "min", (line) => (line.outs >= QUALIFIED_OUTS ? whip(line) : null))
  },
  {
    key: "player-k9",
    page: "player",
    group: "ON THE MOUND",
    title: `MOST K PER 9 (${QUALIFIED_OUTS / 3} IP)`,
    better: "max",
    unit: "K/9",
    format: perNine,
    read: (save) => bestPlayer(seasonPitchers(save), "max", (line) => (line.outs >= QUALIFIED_OUTS ? line.strikeoutsPerNine : null))
  },
  // Neither at the plate nor on the mound: the one fielder a record knows by name.
  // A caught stealing is charged to the runner, but the throw-out is this man's, and
  // it is credited to him behind the plate (see performStealAttempt).
  {
    key: "player-caught-stealing-game",
    page: "player",
    group: "BEHIND THE PLATE",
    title: "MOST RUNNERS CAUGHT STEALING IN A GAME (ONE MAN)",
    better: "max",
    unit: "CS",
    opens: true,
    side: "hitters",
    measure: (line) => line.csCaught || null,
    read: (save) => bestPlayerGame(save, "max", "hitters", (line) => line.csCaught || null)
  },
  {
    key: "player-wpa162",
    page: "player",
    group: "THE LONG HAUL",
    // The most valuable man anybody has ever owned, bat or arm — WPA is the one
    // currency they are both paid in. A man who cost his club games has a negative
    // one, and that is not a record, it is a warning: the board takes the men who
    // won games, and lets the rest go unremarked.
    title: "MOST VALUABLE MAN (WPA/162)",
    better: "max",
    unit: "WPA",
    format: perNine,
    read: (save) => mostValuable(save)
  }
];

export const RECORD_KEYS = RECORDS.map((record) => record.key);

// The records that are not about the save in your hands but about a run you have
// already finished — read out of the hall of fame, not the almanac. They are filed
// when the run ends, each under the manager who set it, so the active save never
// claims another run's title (see submitRunRecords / personalBests).
const RUN_RECORD_KEYS = RECORDS.filter((record) => record.fromRun).map((record) => record.key);

const RECORD_BY_KEY = new Map(RECORDS.map((record) => [record.key, record]));

// A count of nought is not a record; it is an afternoon on which nobody did the
// thing. MOST STEALS IN A GAME belongs to whoever stole one, and a club that has
// never stolen a base sitting on that board at nought is the board saying it did.
// Those records are marked `atLeastOne` and the gate is here, where every mark the
// save produces passes through. The LOW records are the other way round and are
// not gated: nought hits allowed in a win is the best afternoon a staff can have.
function readRecord(record, save) {
  const best = record.read(save);
  if (!best) return null;
  return record.atLeastOne && !(best.value > 0) ? null : best;
}

// The records whose board line opens onto a single afternoon (see `opens` and
// openBoardGame). A game that sets one of these is worth uploading, so the box
// score is there to open on the shared board; a season or career total is not.
const OPENABLE_RECORD_KEYS = new Set(RECORDS.filter((record) => record.opens).map((record) => record.key));

export function recordsOnPage(page) {
  return RECORDS.filter((record) => record.page === page);
}

function mine(game) {
  return game?.boxScore?.[game.playerSide] ?? null;
}

function theirSide(game) {
  return game?.playerSide === "away" ? "home" : "away";
}

const whip = (line) => (line.outs ? ((line.h + line.bb) * 3) / line.outs : null);

// How many games in this campaign answer to something. A count of nought is not a
// record — it is a campaign that never did the thing — so it does not go up.
function countGames(save, matches) {
  const count = almanacGames(save).filter((game) => matches(game)).length;
  return count > 0 ? { value: count } : null;
}

// The deepest hole a win was climbed out of. The line score is the only thing that
// remembers a deficit: a box score knows the final and nothing about the shape of
// the afternoon. The order the halves are batted in matters — a home side trails
// only after the visitors have hit — so the deficit is measured after each half,
// not each inning. Games from before the board existed have no line score, and
// sit this one out rather than invent a comeback.
function comeback(game) {
  if (!game.won || !game.lineScore) return null;
  const ours = game.lineScore[game.playerSide] ?? [];
  const theirs = game.lineScore[theirSide(game)] ?? [];
  const first = game.playerSide === "away" ? ours : theirs;
  const second = game.playerSide === "away" ? theirs : ours;
  let ourRuns = 0;
  let theirRuns = 0;
  let worst = 0;
  for (let inning = 0; inning < Math.max(first.length, second.length); inning += 1) {
    for (const half of [first, second]) {
      const runs = half[inning] ?? 0;
      if (half === ours) ourRuns += runs; else theirRuns += runs;
      worst = Math.max(worst, theirRuns - ourRuns);
    }
  }
  return worst > 0 ? worst : null;
}

// The biggest frame you ever put up. Also the line score's business.
function biggestInning(game) {
  const frames = game.lineScore?.[game.playerSide];
  if (!Array.isArray(frames) || !frames.length) return null;
  const best = Math.max(...frames.map((runs) => Number(runs) || 0));
  return best > 0 ? best : null;
}

// Zeroes in a row, across games, in the order they were pitched — the line score
// read end to end. A game with no line score cannot be vouched for, so it BREAKS
// the streak rather than extending it through a gap nobody can see: an honest
// twelve beats a fabricated thirty. The streak is filed on the day it reached its
// length, which is the afternoon worth opening.
function scorelessStreak(save) {
  let best = null;
  let run = 0;
  for (const game of almanacGames(save)) {
    const frames = game.lineScore?.[theirSide(game)];
    if (!Array.isArray(frames)) {
      run = 0;
      continue;
    }
    for (const runs of frames) {
      if ((Number(runs) || 0) > 0) {
        run = 0;
        continue;
      }
      run += 1;
      if (!best || run > best.value) best = { value: run, day: game.day, opponent: game.opponent };
    }
  }
  return best;
}

// Games won over games played, once there are enough of them to mean anything.
function winRate(save) {
  const games = almanacGames(save);
  if (games.length < QUALIFIED_GAMES) return null;
  return { value: games.filter((game) => game.won).length / games.length };
}

// The day the catalog closed. The save has kept it since the day it happened.
function catalogDays(save) {
  const day = Number(save?.progress?.catalogCompletedOn);
  return Number.isFinite(day) && day > 0 ? { value: day } : null;
}

// The cleanest title run on this machine. Nought losses is the best mark there is
// and it is a real number: no truthiness test here either.
function fewestTitleLosses() {
  let best = null;
  for (const run of loadHallOfFame()) {
    if ((run.mode ?? "budget") === "gauntlet") continue;
    const losses = Number(run.losses);
    if (!Number.isFinite(losses) || losses < 0) continue;
    if (!best || losses < best.value) best = { value: losses, opponent: run.name };
  }
  return best;
}

// Bat or arm, whoever swung the most games. Each is held to his own qualifier,
// because an innings and a plate appearance are not the same unit of having
// turned up.
function mostValuable(save) {
  const bats = bestPlayer(seasonHitters(save), "max", (line) => (line.pa >= QUALIFIED_PA ? line.wpa162 : null));
  const arms = bestPlayer(seasonPitchers(save), "max", (line) => (line.outs >= QUALIFIED_OUTS ? line.wpa162 : null));
  const best = [bats, arms].filter(Boolean).sort((a, b) => b.value - a.value)[0] ?? null;
  return best && best.value > 0 ? best : null;
}

// The best single game for one measure, and the page it happened on.
function bestGame(save, better, measure) {
  let best = null;
  for (const game of almanacGames(save)) {
    const value = measure(game);
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    if (!best || (better === "max" ? value > best.value : value < best.value)) {
      best = { value, day: game.day, opponent: game.opponent };
    }
  }
  return best;
}

// The best man on the club for one measure, and his name, which is the whole
// point of this half of the book.
//
// Every line in the season stats is a man who has actually played FOR you — that
// is the only way a line gets written (see recordGameStats) — so "a player you
// own" needs no further test. He is not filtered against the roster you happen
// to be carrying today, either: a man you cut in August still hit the homers he
// hit in July, and a record book that forgets them the moment he clears waivers
// is not a record book.
// One man, one afternoon: the best single game any of your men ever had. Unlike a
// career, this HAS a day and an opponent behind it, so the board can open the game
// and show you him doing it.
function bestPlayerGame(save, better, side, measure) {
  let best = null;
  for (const game of almanacGames(save)) {
    for (const line of mine(game)?.[side] ?? []) {
      const value = measure(line);
      if (value === null || value === undefined || !Number.isFinite(value)) continue;
      if (!best || (better === "max" ? value > best.value : value < best.value)) {
        best = { value, player: line.name, day: game.day, opponent: game.opponent };
      }
    }
  }
  return best;
}

// A record can be TIED — two men each with three homers in a game — and the board
// must name them both, not just whoever did it first. So for a player single-game
// record this returns EVERY man who holds the mark, each with his best afternoon:
// first each man's own best game for the measure, then the men whose best equals the
// best of all. One line per man, so a slugger's two big days are still one record.
function coLeaders(save, better, side, measure) {
  const byMan = new Map();
  for (const game of almanacGames(save)) {
    for (const line of mine(game)?.[side] ?? []) {
      const value = measure(line);
      if (value === null || value === undefined || !Number.isFinite(value)) continue;
      const prev = byMan.get(line.name);
      if (!prev || (better === "max" ? value > prev.value : value < prev.value)) {
        byMan.set(line.name, { value, player: line.name, day: game.day, opponent: game.opponent });
      }
    }
  }
  const marks = [...byMan.values()];
  if (!marks.length) return [];
  const top = marks.reduce((best, mark) => (better === "max" ? Math.max(best, mark.value) : Math.min(best, mark.value)), marks[0].value);
  return marks.filter((mark) => mark.value === top);
}

function bestPlayer(lines, better, measure) {
  let best = null;
  for (const line of lines ?? []) {
    const value = measure(line);
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    if (!best || (better === "max" ? value > best.value : value < best.value)) {
      best = { value, player: line.name };
    }
  }
  return best;
}

// Wins in a row, in the order they were played. The streak is reported with the
// day it REACHED its length — the game that made it what it is.
function longestWinStreak(save) {
  let best = null;
  let run = 0;
  for (const game of almanacGames(save)) {
    run = game.won ? run + 1 : 0;
    if (run > 0 && (!best || run > best.value)) {
      best = { value: run, day: game.day, opponent: game.opponent };
    }
  }
  return best;
}

// The one record that does not live in the almanac: a finished run, and how many
// days it took. The hall of fame already keeps them, and it keeps the mode each
// was won in — so each board only ever counts the runs that were actually playing
// its game. A run predating the field is a budget run, which is what the league
// was before the cheques were uncapped.
// The deepest run one tier has seen, out of the plaques this machine holds.
// A run that cleared nobody is not a mark — it is a run that turned up — so the
// board starts at one club put away.
function deepestGauntlet(tier) {
  let best = null;
  for (const run of loadHallOfFame()) {
    if (run.gauntletTier !== tier) continue;
    const cleared = Number(run.gauntletCleared);
    if (!Number.isFinite(cleared) || cleared <= 0) continue;
    if (!best || cleared > best.value) best = { value: cleared, opponent: run.name };
  }
  return best;
}

function fastestTitle(mode) {
  let best = null;
  for (const run of loadHallOfFame()) {
    if ((run.mode ?? "budget") !== mode) continue;
    const days = Number(run.days);
    if (!Number.isFinite(days) || days <= 0) continue;
    if (!best || days < best.value) best = { value: days, day: days, opponent: run.name };
  }
  return best;
}

// One finished run's mark for one run record, or null if the run did not set it.
// A fastest-championship board only counts runs won under its own rule set; the
// fewest-losses board counts them all, whichever league they were won in.
function runRecordValue(key, run) {
  const gauntlet = /^deepest-gauntlet-(.+)$/.exec(key);
  if (gauntlet) {
    if (run.gauntletTier !== gauntlet[1]) return null;
    const cleared = Number(run.gauntletCleared);
    return Number.isFinite(cleared) && cleared > 0 ? cleared : null;
  }
  // The title boards are for title runs. A gauntlet run is six best-of-threes
  // and would walk onto FEWEST LOSSES with three of them, which is not the same
  // achievement as losing three games across a whole campaign.
  if ((run.mode ?? "budget") === "gauntlet") return null;
  if (key === "fewest-losses-title") {
    const losses = Number(run.losses);
    return Number.isFinite(losses) && losses >= 0 ? losses : null;
  }
  const mode = key === "fastest-title-uncapped" ? "uncapped" : "budget";
  if ((run.mode ?? "budget") !== mode) return null;
  const days = Number(run.days);
  return Number.isFinite(days) && days > 0 ? days : null;
}

// Everything this save has to submit: one line per record it has actually set.
export function personalBests(save) {
  if (!save) return {};
  const bests = {};
  for (const record of RECORDS) {
    // The title-run records belong to finished runs, not to the campaign in your
    // hands: they go up under their own manager when the run ends, not filed under
    // whoever happens to be playing when the book is opened. See submitRunRecords.
    if (record.fromRun) continue;
    // Player single-game records can be co-held, so a single best would hide a tie:
    // they go up per man through submitCoHolders, not one-per-save through the book.
    if (record.measure) continue;
    const best = readRecord(record, save);
    if (best) bests[record.key] = best;
  }
  return bests;
}

// ---- Your book, across every run ---------------------------------------------
//
// A save is one run, and a run ends: start another and the almanac and the season
// stats are wiped clean (see createSave). The manager and player records are read
// out of that save, so without help they would only ever remember the run in your
// hands — and a brilliant afternoon in a run that never won a title, or a run you
// walked away from, would count for nothing.
//
// So the best of each is also kept here, in its own storage key, updated the moment
// a game is filed (see updatePersonalRecords, called from recordFinishedGame). Any
// game you play can set a world record, whether or not its run ends in a trophy,
// and it goes on standing after you have moved on. Each mark remembers the run that
// set it, so the shared board credits that run and files it under no other.
//
// One shelf per record, and one line per RUN on the shelf. It used to be one line
// per record — your best, from whichever campaign managed it — and that is the
// right thing to show YOU and the wrong thing to send the league. A campaign whose
// twelve-steal afternoon was second in the world never went up at all, because a
// campaign of your own had once managed thirteen, and only the better of the two
// was ever in the book to send. The league board files a line per campaign and has
// room for twenty-five of them; the book that feeds it now keeps them the same way.

const PERSONAL_KEY = "showdown-quest-records-local";

// How many runs' marks one shelf holds. The league's own board keeps twenty-five a
// record (see RECORDS_MAX_PER_KEY in online-server.js), so the twenty-sixth cannot
// reach it however long it is carried.
const PERSONAL_MAX_PER_KEY = 25;

// Same care as the hall of fame: ask for the method, not the name (see there).
function personalStorage() {
  const store = typeof localStorage === "undefined" ? null : localStorage;
  return typeof store?.getItem === "function" ? store : null;
}

export function loadPersonalRecords(storage = personalStorage()) {
  const raw = storage?.getItem(PERSONAL_KEY);
  if (!raw) return {};
  let stored;
  try {
    stored = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  const book = {};
  for (const [key, value] of Object.entries(stored)) {
    // A book written before the shelf held more than one run is a single mark per
    // record. It becomes a shelf of one and goes on standing.
    const marks = (Array.isArray(value) ? value : [value]).filter(shelvable(key));
    if (marks.length) book[key] = marks;
  }
  return book;
}

// What belongs on a shelf: a mark with a number and the run that set it. Marks of
// nought filed before the gate existed are dropped on the way in, so an old book
// cannot go on putting a club that never stole a base on the steals board (see
// readRecord).
function shelvable(key) {
  const record = RECORD_BY_KEY.get(key);
  return (mark) => Boolean(mark)
    && typeof mark === "object"
    && Number.isFinite(mark.value)
    && Boolean(mark.saveSeed)
    && !(record?.atLeastOne && !(mark.value > 0));
}

// Fold this save's current bests into the book, keeping whichever is better for
// each record THIS RUN has done. The kept mark is stamped with who set it — this
// save — so from now on it is shown and filed under his name, on a shelf beside
// whatever his other campaigns managed. Persisted only when something actually
// moved; returns the keys that moved, so the caller can tell whether this game just
// set a record (see recordFinishedGame).
export function updatePersonalRecords(save, storage = personalStorage()) {
  if (!save) return [];
  const book = loadPersonalRecords(storage);
  const changed = [];
  for (const [key, mark] of Object.entries(personalBests(save))) {
    const record = RECORD_BY_KEY.get(key);
    const marks = book[key] ?? [];
    // Measured against THIS run's own line, not against the best you have ever
    // done. Every campaign keeps its own record and the league ranks them against
    // each other; a run is not kept off the board by an older run of yours.
    const previous = marks.find((line) => line.saveSeed === save.saveSeed);
    const better = !previous || (record.better === "max" ? mark.value > previous.value : mark.value < previous.value);
    if (!better) continue;
    // Stamped with the day it was set, not the day it is next read: this line only
    // moves when the mark is actually beaten, so the date on it is the date of the
    // afternoon that put it there, and it goes up to the league with it.
    const line = { ...mark, name: save.player.name, saveSeed: save.saveSeed, mode: save.mode ?? "budget", at: Date.now() };
    book[key] = shelve(record, marks.filter((other) => other.saveSeed !== save.saveSeed), line);
    changed.push(key);
  }
  if (changed.length) storage?.setItem(PERSONAL_KEY, JSON.stringify(book));
  return changed;
}

// One shelf, best first, no deeper than the league will hold. The line just set is
// never the one trimmed off the end: it has not been sent up yet, and a mark
// dropped before it is sent is a mark nobody ever hears about.
function shelve(record, others, line) {
  const marks = [...others, line].sort(
    (a, b) => (record.better === "max" ? b.value - a.value : a.value - b.value)
  );
  if (marks.length <= PERSONAL_MAX_PER_KEY) return marks;
  const kept = marks.slice(0, PERSONAL_MAX_PER_KEY);
  return kept.includes(line) ? kept : [...kept.slice(0, -1), line];
}

// Of the records this game just moved, did any open onto a single afternoon whose
// box score the shared board would open — and is that afternoon THIS one, filed on
// `day`? That is exactly when the game is worth uploading (see recordFinishedGame):
// so a mark set in a run that never wins a title can still be opened by the league.
export function setsOpenableGameRecord(changedKeys, day, saveSeed) {
  const book = loadPersonalRecords();
  return changedKeys.some((key) => OPENABLE_RECORD_KEYS.has(key)
    && (book[key] ?? []).some((mark) => mark.saveSeed === saveSeed && mark.day === day));
}

// Your own marks for one record, one row per run that set one, each under the run
// that set it. This is the twin of localRunMarks for the save-derived records: it
// is every campaign you have played folded onto the board, not only the run in
// your hands and not only your best.
function personalRecordMarks(record) {
  return (loadPersonalRecords()[record.key] ?? []).map((mark) => ({ ...mark, you: true }));
}

// ---- The shared board -------------------------------------------------------
//
// Same shape as the hall of fame: the server keeps the league's book at
// /api/records, your own bests are computed locally, and the screen shows both.
// Offline, you still see your own — the board is simply empty behind you.

let globalRecords = null;

function inBrowser() {
  return typeof document !== "undefined" && typeof fetch === "function";
}

export function cachedGlobalRecords() {
  return globalRecords;
}

export async function fetchGlobalRecords() {
  const response = await fetch("/api/records");
  if (!response.ok) throw new Error(`Records fetch failed (${response.status})`);
  const data = await response.json();
  globalRecords = data.records && typeof data.records === "object" ? data.records : {};
  return globalRecords;
}

// One line per campaign per record, filed under whoever set it. A save that beats
// its own old mark overwrites it, so a long run cannot fill the board with its own
// history; the server keeps whichever is better (see fileRecord).
function postRecordBook(name, saveSeed, mode, records) {
  if (!inBrowser() || !name || !saveSeed) return Promise.resolve(false);
  if (!Object.keys(records).length) return Promise.resolve(false);
  return fetch("/api/records", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, saveSeed, mode: mode ?? "budget", records })
  }).then((response) => response.ok, () => false);
}

// Your record book goes up whenever the world-records screen is opened — every run
// of yours that ever set a mark, each filed under the run that actually set it, so
// the board keeps them apart the way it keeps everyone apart, by saveSeed. A record
// you set two runs ago goes up under that run, never under whoever you are playing
// now, so it is neither double-counted nor lost when you start over. It is one
// request per campaign, which is the price of the campaigns being told apart at
// all — so only the campaigns with something to say send one (see alreadyFiled).
// The title-run records are not here — they belong to finished runs (see
// submitRunRecords).
// A mark the board already holds, at a number this one cannot improve on, does not
// need sending again: the server would only file it back exactly as it stands. With
// no board to compare against — a first visit, or one made offline — everything
// goes, the way it always did.
function alreadyFiled(record, board, mark) {
  const filed = (board ?? []).find((row) =>
    row.saveSeed === mark.saveSeed && (row.player ?? "") === (mark.player ?? ""));
  if (!filed) return false;
  return record.better === "max" ? filed.value >= mark.value : filed.value <= mark.value;
}

export function submitPersonalRecords(globals) {
  if (!inBrowser()) return Promise.resolve(false);
  const bySeed = new Map();
  for (const [key, marks] of Object.entries(loadPersonalRecords())) {
    const record = RECORD_BY_KEY.get(key);
    if (!record) continue;
    for (const mark of marks) {
      if (!mark.name || alreadyFiled(record, globals?.[key], mark)) continue;
      const group = bySeed.get(mark.saveSeed) ?? { name: mark.name, mode: mark.mode ?? "budget", records: {} };
      group.records[key] = { value: mark.value, player: mark.player, day: mark.day, opponent: mark.opponent, at: mark.at };
      bySeed.set(mark.saveSeed, group);
    }
  }
  const posts = [...bySeed.entries()].map(([saveSeed, group]) =>
    postRecordBook(group.name, saveSeed, group.mode, group.records));
  return Promise.all(posts).then((results) => results.some(Boolean), () => false);
}

// The player single-game records the save in your hands is holding or tying — every
// co-holder, one man per request (the server files a player row per saveSeed+player,
// so two of your men both land). This is how a tie reaches the league board, not
// just your own screen. Sent every visit alongside submitPersonalRecords.
export function submitCoHolders(save) {
  if (!inBrowser() || !save) return Promise.resolve(false);
  const posts = [];
  for (const record of RECORDS) {
    if (!record.measure) continue;
    for (const mark of coLeaders(save, record.better, record.side, record.measure)) {
      posts.push(postRecordBook(save.player.name, save.saveSeed, save.mode ?? "budget", {
        [record.key]: { value: mark.value, player: mark.player, day: mark.day, opponent: mark.opponent }
      }));
    }
  }
  return Promise.all(posts).then((results) => results.some(Boolean), () => false);
}

// A finished run's own title marks, sent to the book under the manager who set
// them — the record-book twin of the hall-of-fame plaque, submitted the moment the
// run ends (see recordCompletedRun). Because each is filed under the run's own
// saveSeed, the board credits the run that made the number, not whatever save is
// open when the book is next read.
export function submitRunRecords(run) {
  if (!run) return Promise.resolve(false);
  const records = {};
  for (const key of RUN_RECORD_KEYS) {
    const value = runRecordValue(key, run);
    // A title-run record was set on the day the run ended, whenever the book gets
    // to hear about it — which for a run finished offline can be weeks later.
    if (value !== null) records[key] = { value, at: run.finishedAt };
  }
  return postRecordBook(run.name, run.saveSeed, run.mode ?? "budget", records);
}

// The finished runs the book has not heard of yet — an offline finish, or a run
// from before this board existed — sent up each under its own manager. "Not heard
// of" means the board has no row under that run's saveSeed for a record it holds.
// Mirrors the hall of fame catching up its missing plaques on every visit; returns
// whether anything went up, so the screen only re-reads when it is worth it.
export async function submitMissingRunRecords(globals) {
  if (!inBrowser()) return false;
  const missing = loadHallOfFame().filter((run) => runNeedsFiling(run, globals));
  for (const run of missing) await submitRunRecords(run);
  return missing.length > 0;
}

function runNeedsFiling(run, globals) {
  return RUN_RECORD_KEYS.some((key) => {
    if (runRecordValue(key, run) === null) return false;
    return !(globals?.[key] ?? []).some((row) => row.saveSeed === run.saveSeed);
  });
}

// Your mark for a save record, as a board row — the campaign in your hands, or
// nothing if it has not set this record.
function saveMark(record, save) {
  const best = save ? readRecord(record, save) : null;
  return best ? [{ ...best, name: save.player.name, saveSeed: save.saveSeed, you: true }] : [];
}

// The current save's co-holders for a player single-game record: one board row per
// man tied at the top, so a tie names them all (see coLeaders).
function coHolderMarks(record, save) {
  if (!save) return [];
  return coLeaders(save, record.better, record.side, record.measure)
    .map((mark) => ({ ...mark, name: save.player.name, saveSeed: save.saveSeed, you: true }));
}

// One row per record-holder. A manager record is one afternoon per save, so the
// save is the whole key. A player record belongs to a MAN, and two of your men can
// each hold or tie it — so the man is part of the key, and they do not collapse.
function rowKey(row) {
  return row.player ? `${row.saveSeed} ${row.player}` : row.saveSeed;
}

// Every finished run's mark for a title-run record, each as its own row under its
// own name — read straight out of the local hall of fame, the way the run records
// are only ever attributed.
function localRunMarks(record) {
  const marks = [];
  for (const run of loadHallOfFame()) {
    const value = runRecordValue(record.key, run);
    if (value === null) continue;
    marks.push({ value, name: run.name, saveSeed: run.saveSeed, mode: run.mode ?? "budget", at: run.finishedAt, you: true });
  }
  return marks;
}

// The board for one record: the league's top few, with YOUR best folded in even
// when the server has never heard of it (offline, or a board already deeper than
// you are). Ranked the right way round for the record in question.
export function leaderboard(record, globals, save, limit = 5) {
  const rows = [...(globals?.[record.key] ?? [])].map((row) => ({ ...row }));
  // Your own marks, folded onto the board the server sent, each credited to the run
  // that earned it rather than to whoever is playing now. A title-run record has one
  // row per finished run (localRunMarks). A player single-game record folds in ALL
  // of the current save's co-holders, so a tie names both men (coHolderMarks).
  // Everything else folds in one row per run you have played (personalRecordMarks),
  // plus the run in your hands live before the book is next written — same saveSeed
  // simply dedupes below.
  const mine = record.fromRun
    ? localRunMarks(record)
    : record.measure
      ? coHolderMarks(record, save)
      : [...personalRecordMarks(record), ...saveMark(record, save)];
  for (const mark of mine) {
    const already = rows.find((row) => rowKey(row) === rowKey(mark));
    if (already) {
      already.you = true;
      // The board can be behind what has just been done on this machine.
      if (record.better === "max" ? mark.value > already.value : mark.value < already.value) {
        // Your copy is the better number, but it is not always the better DATE: a
        // mark you have held for months carries no stamp of its own if it was set
        // before the book kept them. Keep the league's day rather than losing it.
        Object.assign(already, mark, { at: mark.at ?? already.at });
      }
    } else {
      rows.push(mark);
    }
  }
  rows.sort((a, b) => (record.better === "max" ? b.value - a.value : a.value - b.value));
  const top = rows.slice(0, limit);
  const you = rows.find((row) => row.you) ?? null;
  return {
    top,
    you,
    // Where you stand, even when you are not on the board.
    yourRank: you ? rows.indexOf(you) + 1 : null,
    total: rows.length
  };
}
