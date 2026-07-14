import { escapeHtml, clampIndex } from "./helpers.js?v=20260714-c";
import { sectionedMenu, statLineHtml } from "./statsScreens.js?v=20260714-c";
import { universeConfig } from "../packs.js?v=20260714-c";
import {
  loadHallOfFame,
  hallOfFameByMode,
  MODE_LABELS,
  cachedGlobalEntries,
  fetchGlobalEntries,
  submitRun,
  syncRunProgress,
  mergeEntries
} from "../hallOfFame.js?v=20260714-c";

// ---- Hall of fame ----------------------------------------------------------
//
// Every finished campaign — everyone's, everywhere — grouped by rule set and
// ranked by fewest days to the trophy. The shared board comes from the rooms
// server; local plaques render immediately and the global list merges in when
// the fetch lands. Z opens the champion's team page; the roster and its
// season numbers were snapshotted at the final out, so old universes stay
// readable.

let syncStatus = "idle"; // idle | syncing | online | offline

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

export const hofTeamScreen = {
  render(app) {
    const entry = app.screen.entry;
    const rows = teamRows(entry);
    const index = clampIndex(app.screen.index ?? 0, rows.length);
    const finished = new Date(entry.finishedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>${escapeHtml(entry.name)} &middot; ${MODE_LABELS[entry.mode] ?? escapeHtml(entry.mode.toUpperCase())}</span><span>DAY ${entry.days}</span></div>
      <div class="gq-body">
        <div class="gq-frame gq-title-frame">
          <b>&#9733; WORLD SERIES CHAMPION &#9733;</b>
          <p class="gq-mt">THE TROPHY IN <b>${entry.days} DAY${entry.days === 1 ? "" : "S"}</b> &middot; WENT <b>${entry.wins}-${entry.losses}</b> ON THE FIELD.</p>
          <p class="gq-dim">BATTLES ${entry.battlesWon}-${entry.battlesLost} &middot; ${entry.badges.length} BADGES &middot; ${entry.rosterPoints} PT ROSTER &middot; ${escapeHtml(leagueName(entry))} &middot; ${escapeHtml(finished.toUpperCase())}</p>
          ${entry.catalogComplete
            ? `<p><b>&#9733; THE COMPLETE CATALOG &#9733;</b><br><span class="gq-dim">EVERY CARD IN THE LEAGUE${entry.catalogCompletedOn ? ` &middot; DAY ${entry.catalogCompletedOn}` : ""}</span></p>`
            : entry.cardsTotal
              ? `<p class="gq-dim">COLLECTED ${entry.cardsOwned}/${entry.cardsTotal} CARDS</p>`
              : ""}
        </div>
        <div class="gq-frame gq-scroll gq-map-node">${sectionedMenu(rows, index)}</div>
      </div>
      <div class="gq-textbox"><p class="gq-dim">% IS SEASON WPA. Hover a row to read the card. X back to the leaderboard.</p></div>
    </div>`;
  },
  hoverCard(app, index) {
    return teamRows(app.screen.entry)[index]?.card ?? null;
  },
  key(app, key) {
    if (key === "up" || key === "down") {
      const rows = teamRows(app.screen.entry);
      app.screen.index = clampIndex((app.screen.index ?? 0) + (key === "down" ? 1 : -1), rows.length);
    } else if (key === "a" || key === "b") {
      return app.go("hallOfFame", { index: app.screen.from ?? 0 });
    }
    app.rerender();
  }
};
