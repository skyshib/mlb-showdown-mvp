import { escapeHtml, clampIndex } from "./helpers.js?v=20260714-h";
import { sectionedMenu, statLineHtml, gameStars } from "./statsScreens.js?v=20260714-h";
import { cachedGames, fetchGames, opponentsOf, opposingLines } from "../gameArchive.js?v=20260714-h";
import { universeConfig } from "../packs.js?v=20260714-h";
import {
  loadHallOfFame,
  hallOfFameByMode,
  MODE_LABELS,
  cachedGlobalEntries,
  fetchGlobalEntries,
  submitRun,
  syncRunProgress,
  mergeEntries
} from "../hallOfFame.js?v=20260714-h";

// ---- Hall of fame ----------------------------------------------------------
//
// Every finished campaign — everyone's, everywhere — grouped by rule set and
// ranked by fewest days to the trophy. The shared board comes from the rooms
// server; local plaques render immediately and the global list merges in when
// the fetch lands. Z opens the champion's team page; the roster and its
// season numbers were snapshotted at the final out, so old universes stay
// readable.

let syncStatus = "idle"; // idle | syncing | online | offline
let gamesStatus = "idle"; // idle | loading | ready

async function syncGlobal(app) {
  syncStatus = "syncing";
  try {
    const entries = await fetchGlobalEntries();
    // Runs finished while offline only exist locally: push them up, re-read.
    const known = new Set(entries.map((entry) => entry.saveSeed));
    const missing = loadHallOfFame().filter((entry) => !known.has(entry.saveSeed));
    if (missing.length) {
      for (const entry of missing) await submitRun(entry);
      await fetchGlobalEntries();
    }
    syncStatus = "online";
  } catch {
    syncStatus = "offline";
  }
  if (app.screen.name === "hallOfFame" || app.screen.name === "hofTeam") app.rerender();
}

function statusLabel() {
  if (syncStatus === "syncing") return "SYNCING&#8230;";
  if (syncStatus === "online") return "GLOBAL";
  if (syncStatus === "offline") return "LOCAL &middot; OFFLINE";
  return "LOCAL";
}

function leagueName(entry) {
  return universeConfig(entry.universe)?.name ?? entry.universe.toUpperCase();
}

// What this champion has collected. Plaques from before the catalog was counted
// simply do not say — better a quiet plaque than a lie about a zero.
function collectionTag(entry) {
  if (!entry.cardsTotal) return "&#8212;";
  if (entry.catalogComplete) return "FULL CATALOG";
  return `${entry.cardsOwned}/${entry.cardsTotal} CARDS`;
}

function leaderboardRows() {
  const rows = [];
  const entries = mergeEntries(loadHallOfFame(), cachedGlobalEntries());
  for (const { mode, entries: modeEntries } of hallOfFameByMode(entries)) {
    modeEntries.forEach((entry, place) => rows.push({
      section: MODE_LABELS[mode] ?? mode.toUpperCase(),
      entry,
      html: `${place + 1}. ${escapeHtml(entry.name)}${entry.catalogComplete ? " &#9733;" : ""} — <b>${entry.days} DAY${entry.days === 1 ? "" : "S"}</b> <span class="gq-dim">${entry.wins}-${entry.losses} &middot; ${collectionTag(entry)} &middot; ${escapeHtml(leagueName(entry))}</span>`
    }));
  }
  return rows;
}

export const hallOfFameScreen = {
  render(app) {
    const rows = leaderboardRows();
    const index = clampIndex(app.screen.index ?? 0, rows.length);
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>HALL OF FAME &middot; ${rows.length} CHAMPION${rows.length === 1 ? "" : "S"}</span><span>${statusLabel()}</span></div>
      <div class="gq-body"><div class="gq-frame gq-scroll gq-map-node">${
        rows.length
          ? sectionedMenu(rows, index)
          : `<p class="gq-dim">${syncStatus === "syncing" ? "CALLING THE LEAGUE OFFICE&#8230;" : "NO CHAMPIONS YET. WIN A WORLD SERIES AND THE FIRST PLAQUE IS YOURS."}</p>`
      }</div></div>
      <div class="gq-textbox"><p class="gq-dim">Fastest seasons first &middot; record is games won-lost. Z opens the team. X to leave.</p></div>
    </div>`;
  },
  mounted(app) {
    // One fetch per visit: the flag lives on the screen object, which survives
    // rerenders and resets on the next go().
    if (app.screen.synced) return;
    app.screen.synced = true;
    // A champion who is still collecting has a plaque that is out of date. Bring
    // it up to what he actually owns before the board is read — and push the
    // amendment up, so the global board sees it too.
    syncRunProgress(app.save);
    syncGlobal(app);
  },
  key(app, key) {
    const rows = leaderboardRows();
    if (key === "up" || key === "down") {
      app.screen.index = clampIndex((app.screen.index ?? 0) + (key === "down" ? 1 : -1), rows.length);
    } else if (key === "a" && rows.length) {
      const index = clampIndex(app.screen.index ?? 0, rows.length);
      return app.go("hofTeam", { entry: rows[index].entry, index: 0, from: index });
    } else if (key === "b") {
      return app.go("title", { menuIndex: 0 });
    }
    app.rerender();
  }
};

// ---- Champion team page ------------------------------------------------------

// The final roster with each player's season line. Hitters lead, arms follow,
// and hovering any row floats the snapshotted card.
function teamRows(entry) {
  const stats = new Map([...entry.hitters ?? [], ...entry.pitchers ?? []].map((line) => [line.id, line]));
  const bats = entry.roster.filter((card) => card.kind !== "pitcher");
  const arms = entry.roster.filter((card) => card.kind === "pitcher");
  const row = (card, section, view) => {
    const line = stats.get(card.id);
    const tag = card.kind === "pitcher" ? card.role : card.position;
    return {
      section,
      card,
      html: `<b>${escapeHtml(tag)}</b> ${line
        ? statLineHtml(line, view)
        : `${escapeHtml(card.name.toUpperCase())} <span class="gq-dim">${card.points}PT &middot; NEVER PLAYED</span>`}`
    };
  };
  return [
    ...bats.map((card) => row(card, "THE BATS", "hitters")),
    ...arms.map((card) => row(card, "THE ARMS", "pitchers"))
  ];
}

// A plaque used to be a roster and a number of days, and it never said the one
// thing you actually want to know about a champion: HOW. Who did they have to
// beat, how close was it, who did the beating.
//
// So the plaque pages sideways. THE CLUB is the champion's team, as before. THE
// LEAGUE is everybody who tried to stop them, folded into one book. And then one
// page per opponent — the club, the record against them, their men, and the
// afternoons themselves, which open into the box score.
//
// The games come off the server (see gameArchive) and none of them are local: a
// stranger's campaign lives on a stranger's machine, and this is the copy they
// sent up when they won. A run finished before the games went up has none, and
// the plaque simply reads as it always did.
function hofPages(app) {
  const entry = app.screen.entry;
  const games = cachedGames(entry.saveSeed) ?? [];
  const pages = [{ key: "club", title: "THE CLUB" }];
  if (games.length) {
    pages.push({ key: "league", title: "THE LEAGUE", games });
    for (const foe of opponentsOf(games)) {
      pages.push({ key: `foe:${foe.trainerId || foe.opponent}`, title: foe.opponent, foe, games: foe.games });
    }
  }
  return pages;
}

// One page's rows. The club page is the roster; every other page is a book of
// somebody else's men and the games they lost.
function pageRows(app, page) {
  if (page.key === "club") return teamRows(app.screen.entry);
  const lines = opposingLines(page.games);
  // The club has a name. On an opponent's page it is theirs; on the league page
  // it is every club at once, which is what the league IS.
  const club = page.foe ? page.foe.opponent.toUpperCase() : "THE LEAGUE";
  const rows = [];
  for (const line of lines.hitters) rows.push({ section: `${escapeHtml(club)} &middot; BATS`, html: statLineHtml(line, "hitters") });
  for (const line of lines.pitchers) rows.push({ section: `${escapeHtml(club)} &middot; ARMS`, html: statLineHtml(line, "pitchers") });
  // The afternoons. These OPEN — a box score and the men who won it.
  for (const game of [...page.games].sort((a, b) => a.day - b.day)) {
    const theirs = game.playerSide === "away" ? "home" : "away";
    rows.push({
      section: "THE GAMES",
      game,
      html: `<span class="gq-dim">DAY ${game.day}</span> <b>${game.won ? "W" : "L"} ${game.score[game.playerSide]}-${game.score[theirs]}</b> <span class="gq-dim">VS ${escapeHtml(game.opponent)}</span>`
    });
  }
  return rows;
}

export const hofTeamScreen = {
  render(app) {
    const entry = app.screen.entry;
    const pages = hofPages(app);
    const pageIndex = clampIndex(app.screen.page ?? 0, pages.length);
    const page = pages[pageIndex];
    const rows = pageRows(app, page);
    const index = clampIndex(app.screen.index ?? 0, rows.length);
    const finished = new Date(entry.finishedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    const foe = page.foe;
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>${escapeHtml(entry.name)} &middot; ${MODE_LABELS[entry.mode] ?? escapeHtml(entry.mode.toUpperCase())}</span><span>${escapeHtml(page.title)}${pages.length > 1 ? ` &middot; ${pageIndex + 1}/${pages.length}` : ""}</span></div>
      <div class="gq-body">
        <div class="gq-frame gq-title-frame">
          ${page.key === "club"
            ? `<b>&#9733; WORLD SERIES CHAMPION &#9733;</b>
              <p class="gq-mt">THE TROPHY IN <b>${entry.days} DAY${entry.days === 1 ? "" : "S"}</b> &middot; WENT <b>${entry.wins}-${entry.losses}</b> ON THE FIELD.</p>
              <p class="gq-dim">BATTLES ${entry.battlesWon}-${entry.battlesLost} &middot; ${entry.badges.length} BADGES &middot; ${entry.rosterPoints} PT ROSTER &middot; ${escapeHtml(leagueName(entry))} &middot; ${escapeHtml(finished.toUpperCase())}</p>
              ${entry.catalogComplete
                ? `<p><b>&#9733; THE COMPLETE CATALOG &#9733;</b><br><span class="gq-dim">EVERY CARD IN THE LEAGUE${entry.catalogCompletedOn ? ` &middot; DAY ${entry.catalogCompletedOn}` : ""}</span></p>`
                : entry.cardsTotal
                  ? `<p class="gq-dim">COLLECTED ${entry.cardsOwned}/${entry.cardsTotal} CARDS</p>`
                  : ""}`
            : foe
              ? `<b>VS ${escapeHtml(foe.opponent)}</b>
                <p class="gq-mt">${escapeHtml(entry.name)} WENT <b>${foe.wins}-${foe.losses}</b> AGAINST THEM &middot; <span class="gq-dim">${foe.runsFor}-${foe.runsAgainst} ON RUNS</span></p>`
              : `<b>THE LEAGUE ${escapeHtml(entry.name)} BEAT</b>
                <p class="gq-mt"><b>${page.games.length} GAME${page.games.length === 1 ? "" : "S"}</b> &middot; <span class="gq-dim">EVERYONE WHO TRIED TO STOP THEM, IN ONE BOOK</span></p>`}
        </div>
        <div class="gq-frame gq-scroll gq-map-node">${
          rows.length
            ? sectionedMenu(rows, index)
            : `<p class="gq-dim">${gamesStatus === "loading" ? "SENDING FOR THE GAMES&#8230;" : "THIS RUN FINISHED BEFORE THE LEAGUE KEPT ITS GAMES."}</p>`
        }</div>
      </div>
      <div class="gq-textbox"><p class="gq-dim">${
        pages.length > 1
          ? `&#9664;/&#9654; ${escapeHtml(pages[(pageIndex + 1) % pages.length].title)} &middot; `
          : ""
      }${page.key === "club" ? "% IS SEASON WPA. Hover a row to read the card." : "Z opens a game. % is WPA against this club."} X back to the leaderboard.</p></div>
    </div>`;
  },
  hoverCard(app, index) {
    const pages = hofPages(app);
    const page = pages[clampIndex(app.screen.page ?? 0, pages.length)];
    return pageRows(app, page)[index]?.card ?? null;
  },
  mounted(app) {
    // The games come down once per plaque, and the plaque redraws when they land.
    const seed = app.screen.entry?.saveSeed;
    if (!seed || app.screen.gamesAsked) return;
    app.screen.gamesAsked = true;
    gamesStatus = "loading";
    fetchGames(seed).then(() => {
      gamesStatus = "ready";
      app.rerender();
    });
  },
  key(app, key) {
    const pages = hofPages(app);
    const pageIndex = clampIndex(app.screen.page ?? 0, pages.length);
    const rows = pageRows(app, pages[pageIndex]);
    if (key === "up" || key === "down") {
      app.screen.index = clampIndex((app.screen.index ?? 0) + (key === "down" ? 1 : -1), rows.length);
    } else if (key === "left" || key === "right") {
      // Sideways through the run: his club, then the league, then the clubs he
      // had to get past, one at a time.
      app.screen.page = clampIndex(pageIndex + (key === "right" ? 1 : -1), pages.length);
      app.screen.index = 0;
    } else if (key === "a") {
      const game = rows[clampIndex(app.screen.index ?? 0, rows.length)]?.game;
      if (!game) return app.go("hallOfFame", { index: app.screen.from ?? 0 });
      // Somebody else's afternoon: the box score and the men who won it. No
      // play-by-play — that stayed on the machine it was played on.
      return app.go("gameStats", {
        trainerId: game.trainerId,
        opponent: game.opponent,
        boxScore: game.boxScore,
        stars: gameStars(game.boxScore, game.playerSide),
        feats: game.feats ?? [],
        events: [],
        score: game.score,
        lineScore: game.lineScore ?? null,
        playerSide: game.playerSide,
        index: 0,
        next: { name: "hofTeam", data: { entry: app.screen.entry, from: app.screen.from ?? 0, page: pageIndex, index: app.screen.index ?? 0 } }
      });
    } else if (key === "b") {
      return app.go("hallOfFame", { index: app.screen.from ?? 0 });
    }
    app.rerender();
  }
};
