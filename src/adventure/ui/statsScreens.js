import { escapeHtml, menuHtml, clampIndex, shortName, cardPanelHtml } from "./helpers.js?v=20260713-j";
import { trainerById } from "../region.js?v=20260713-j";
import { cardById } from "../packs.js?v=20260713-j";
import { seasonHitters, seasonPitchers, ensureSeasonStats, ensureAlmanac, ensureTrophies, recordGameStats } from "../state.js?v=20260713-j";

// ---- Formatting --------------------------------------------------------------

export function ipText(outs) {
  return `${Math.floor(outs / 3)}.${outs % 3}`;
}

// Batting-average style: .273, 1.043 for OPS-like values over 1.
export function rateText(value) {
  return value >= 1 ? value.toFixed(3) : value.toFixed(3).replace(/^0/, "");
}

// A compact game line: "2-4, HR, 3 RBI, SB". Only the parts that happened.
export function hitterGameLine(line) {
  const parts = [`${line.h}-${line.ab}`];
  if (line.hr) parts.push(line.hr > 1 ? `${line.hr} HR` : "HR");
  else if (line.t) parts.push(line.t > 1 ? `${line.t} 3B` : "3B");
  else if (line.d) parts.push(line.d > 1 ? `${line.d} 2B` : "2B");
  if (line.rbi) parts.push(`${line.rbi} RBI`);
  if (line.r) parts.push(`${line.r} R`);
  if (line.bb) parts.push(`${line.bb} BB`);
  if (line.sb) parts.push(line.sb > 1 ? `${line.sb} SB` : "SB");
  return parts.join(", ");
}

export function pitcherGameLine(line) {
  return `${ipText(line.outs)} IP, ${line.h} H, ${line.bb} BB, ${line.so} K, ${line.r} R`;
}

// Signed whole-percent WPA: the number the recap ranks everything by.
export function wpaText(wpa) {
  const percent = Math.round((wpa ?? 0) * 100);
  return `${percent >= 0 ? "+" : ""}${percent}%`;
}

// Big swings (|WPA| >= 10%) read bold; the rest stay quiet.
export function wpaHtml(wpa) {
  const text = wpaText(wpa);
  return Math.abs(wpa ?? 0) >= 0.1 ? `<b>${text}</b>` : `<span class="gq-dim">${text}</span>`;
}

// ---- Game log ------------------------------------------------------------------

// The scorebook situation a play happened in: outs and occupied bases
// BEFORE the pitch, compact ("0o 1-3" = nobody out, first and third).
function situationTag(event) {
  if (!Array.isArray(event.basesBefore) || typeof event.outsBefore !== "number") return "";
  const bases = event.basesBefore.map((runner, at) => (runner ? String(at + 1) : "-")).join("");
  return `<span class="gq-dim">${event.outsBefore}o ${bases}</span> `;
}

// One play-by-play row: inning, the base-out situation, actor, result, score
// when it changed, and the play's WPA from the PLAYER'S side (a big opponent
// rally reads negative).
export function gameLogLine(event, playerSide) {
  const inning = `${event.half === "top" ? "T" : "B"}${event.inning}`;
  if (event.type === "pitching-change") {
    return `<span class="gq-dim">${inning} &middot; ${escapeHtml(shortName(event.team))} GO TO THE PEN: ${escapeHtml(shortName(event.pitcher))}</span>`;
  }
  const actor = event.type === "steal"
    ? event.playDetails?.stealAttempt?.runner ?? event.batter
    : event.batter;
  const battingSide = event.half === "top" ? "away" : "home";
  const wpa = battingSide === playerSide ? event.wpa : -(event.wpa ?? 0);
  // Every row carries the score, read from the player's side; scoring plays
  // show it bold.
  const npcSide = playerSide === "home" ? "away" : "home";
  const scoreText = event.scoreAfter ? `${event.scoreAfter[playerSide]}-${event.scoreAfter[npcSide]}` : "";
  const score = scoreText ? (event.runs > 0 ? ` <b>${scoreText}</b>` : ` <span class="gq-dim">${scoreText}</span>`) : "";
  return `${inning} ${situationTag(event)}${escapeHtml(shortName(actor))} <b>${escapeHtml(event.result)}</b>${score} ${wpaHtml(wpa)}`;
}

// ---- Stars of the game -------------------------------------------------------

// Hockey-style three stars: everyone from both box scores, ranked by WPA.
export function gameStars(boxScore, playerSide) {
  const pool = [];
  for (const side of ["away", "home"]) {
    const yours = side === playerSide;
    for (const line of boxScore[side].hitters) {
      pool.push({ id: line.id, name: line.name, yours, wpa: line.wpa ?? 0, summary: hitterGameLine(line) });
    }
    for (const line of boxScore[side].pitchers) {
      pool.push({ id: line.id, name: line.name, yours, wpa: line.wpa ?? 0, summary: pitcherGameLine(line) });
    }
  }
  return pool.sort((a, b) => b.wpa - a.wpa).slice(0, 3);
}

// ---- Post-game stats screen ----------------------------------------------------

// Every row the screen shows, sections included, so the cursor can walk (and
// hover can read) the whole box score.
function gameStatRows(app) {
  const { boxScore, stars, playerSide } = app.screen;
  const npcSide = playerSide === "away" ? "home" : "away";
  const rows = [];
  // Rare feats lead the recap — they're the reason you tell the story later.
  for (const feat of app.screen.feats ?? []) {
    rows.push({
      section: "&#9733;&#9733; RARE FEAT &#9733;&#9733;",
      id: feat.cardId ?? null,
      html: `<b>${escapeHtml(feat.title)}</b> <span class="gq-dim">${escapeHtml(feat.blurb)}</span>`
    });
  }
  stars.forEach((star, index) => rows.push({
    section: "STARS OF THE GAME",
    id: star.id,
    html: `${"&#9733;".repeat(3 - index)} ${escapeHtml(shortName(star.name))}${star.yours ? "" : " (THEM)"} ${wpaHtml(star.wpa)} <span class="gq-dim">${escapeHtml(star.summary)}</span>`
  }));
  const sides = [
    { box: boxScore[playerSide], tag: "YOUR" },
    { box: boxScore[npcSide], tag: "THEIR" }
  ];
  for (const { box, tag } of sides) {
    for (const line of box.hitters) {
      rows.push({
        section: `${tag} BATS`,
        id: line.id,
        html: `${escapeHtml(shortName(line.name))} ${wpaHtml(line.wpa)} <span class="gq-dim">${escapeHtml(hitterGameLine(line))}</span>`
      });
    }
    for (const line of box.pitchers) {
      rows.push({
        section: `${tag} ARMS`,
        id: line.id,
        html: `${escapeHtml(shortName(line.name))} ${wpaHtml(line.wpa)} <span class="gq-dim">${escapeHtml(pitcherGameLine(line))}</span>`
      });
    }
  }
  return rows;
}

export function sectionedMenu(rows, index) {
  const sections = [];
  rows.forEach((row, rowIndex) => {
    if (row.section !== rows[rowIndex - 1]?.section) sections.push({ header: row.section, start: rowIndex });
  });
  let html = "";
  for (const [sectionIndex, section] of sections.entries()) {
    const end = sections[sectionIndex + 1]?.start ?? rows.length;
    html += `<h3>${section.header}</h3>${menuHtml(
      rows.slice(section.start, end).map((row) => ({ html: row.html })),
      index - section.start,
      { offset: section.start }
    )}`;
  }
  return html;
}

function gameLogMenuRows(app) {
  return (app.screen.events ?? []).map((event) => ({ html: gameLogLine(event, app.screen.playerSide) }));
}

export const gameStatsScreen = {
  render(app) {
    // Almanac reopens can outlive a trainer id; the entry's own opponent
    // name is the fallback.
    const trainer = trainerById(app.screen.trainerId) ?? { name: app.screen.opponent ?? "?" };
    const logView = app.screen.view === "log";
    const hasLog = (app.screen.events ?? []).length > 0;
    let body;
    if (logView) {
      const rows = gameLogMenuRows(app);
      body = menuHtml(rows, clampIndex(app.screen.index ?? 0, rows.length));
    } else {
      const rows = gameStatRows(app);
      body = sectionedMenu(rows, clampIndex(app.screen.index ?? 0, rows.length));
    }
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>FINAL ${app.screen.score[app.screen.playerSide]}-${app.screen.score[app.screen.playerSide === "home" ? "away" : "home"]} VS ${escapeHtml(trainer.name)}</span><span>${logView ? "GAME LOG" : "BOX SCORE"}</span></div>
      <div class="gq-body"><div class="gq-frame gq-scroll gq-map-node">${body}</div></div>
      <div class="gq-textbox"><p class="gq-dim">% IS WPA${logView ? " FOR YOUR SIDE" : " — WIN PROBABILITY ADDED"}. 10%+ SWINGS READ BOLD.${hasLog ? ` &#8592;/&#8594; ${logView ? "BOX SCORE" : "GAME LOG"}.` : ""}</p><p class="gq-blink">Z — CONTINUE</p></div>
    </div>`;
  },
  hoverCard(app, index) {
    if (app.screen.view === "log") return null;
    return cardById(gameStatRows(app)[index]?.id) ?? null;
  },
  key(app, key) {
    const logView = app.screen.view === "log";
    if ((key === "left" || key === "right") && (app.screen.events ?? []).length) {
      app.screen.view = logView ? "box" : "log";
      app.screen.index = 0;
    } else if (key === "up" || key === "down") {
      const rows = logView ? gameLogMenuRows(app) : gameStatRows(app);
      app.screen.index = clampIndex((app.screen.index ?? 0) + (key === "down" ? 1 : -1), rows.length);
    } else if (key === "a" || key === "b") {
      const next = app.screen.next;
      return app.go(next.name, next.data);
    }
    app.rerender();
  }
};

// ---- Campaign almanac ------------------------------------------------------------

// Every game ever played, newest first: day, opponent, score, and a star for
// any game that made the trophy case. Z reopens the full box score through
// the regular post-game screen, which routes back here.
function almanacRows(save) {
  return [...ensureAlmanac(save)].reverse();
}

function almanacLine(entry) {
  const you = entry.score[entry.playerSide];
  const them = entry.score[entry.playerSide === "home" ? "away" : "home"];
  return `DAY ${entry.day} &middot; ${entry.won ? "<b>W</b>" : "L"} ${you}-${them} VS ${escapeHtml(entry.opponent.toUpperCase())}${
    entry.innings !== 9 ? ` <span class="gq-dim">(${entry.innings})</span>` : ""
  }${entry.feats?.length ? " &#9733;" : ""}`;
}

export const almanacScreen = {
  render(app) {
    const rows = almanacRows(app.save);
    const index = clampIndex(app.screen.index ?? 0, rows.length);
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>CAMPAIGN ALMANAC</span><span>${rows.length} GAME${rows.length === 1 ? "" : "S"}</span></div>
      <div class="gq-body"><div class="gq-frame gq-scroll">${
        rows.length
          ? menuHtml(rows.map((entry) => ({ html: almanacLine(entry) })), index)
          : `<p class="gq-dim">NO GAMES ON RECORD YET. HISTORY STARTS WITH THE FIRST PITCH.</p>`
      }</div></div>
      <div class="gq-textbox"><p class="gq-dim">Newest first &middot; &#9733; = a rare feat lives in the trophy room. Z opens the box score. X to leave.</p></div>
    </div>`;
  },
  key(app, key) {
    const rows = almanacRows(app.save);
    if (key === "up" || key === "down") {
      app.screen.index = clampIndex((app.screen.index ?? 0) + (key === "down" ? 1 : -1), rows.length);
    } else if (key === "a" && rows.length) {
      const index = clampIndex(app.screen.index ?? 0, rows.length);
      const entry = rows[index];
      return app.go("gameStats", {
        trainerId: entry.trainerId,
        opponent: entry.opponent,
        boxScore: entry.boxScore,
        stars: gameStars(entry.boxScore, entry.playerSide),
        feats: entry.feats ?? [],
        events: [],
        score: entry.score,
        playerSide: entry.playerSide,
        index: 0,
        next: { name: "almanac", data: { index } }
      });
    } else if (key === "b") {
      return app.go("map");
    }
    app.rerender();
  }
};

// ---- Trophy room ------------------------------------------------------------------

// The display case: every rare feat ever earned, newest first, each plaque
// with its day, opponent, and — when a single hero owns the feat — the hero's
// card alongside.
function trophyRows(save) {
  return [...ensureTrophies(save)].reverse();
}

export const trophyScreen = {
  render(app) {
    const rows = trophyRows(app.save);
    const index = clampIndex(app.screen.index ?? 0, rows.length);
    const selected = rows[index];
    const hero = selected?.cardId ? cardById(selected.cardId) : null;
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>TROPHY ROOM</span><span>${rows.length} TROPH${rows.length === 1 ? "Y" : "IES"}</span></div>
      <div class="gq-body"><div class="gq-columns">
        <div class="gq-frame gq-scroll">${
          rows.length
            ? menuHtml(
                rows.map((trophy) => ({ html: `<span class="gq-dim">DAY ${trophy.day}</span> <b>${escapeHtml(trophy.title)}</b>` })),
                index
              )
            : `<p class="gq-dim">THE CASE IS EMPTY. PERFECT GAMES, CYCLES, AND SLAMS EARN THEIR PLAQUES HERE.</p>`
        }</div>
        <div>${
          selected
            ? `<div class="gq-frame gq-trophy-plaque">&#127942; <b>${escapeHtml(selected.title)}</b><br>
                <span class="gq-dim">${escapeHtml(selected.blurb)}</span><br>
                <span class="gq-dim">DAY ${selected.day} &middot; VS ${escapeHtml(selected.opponent.toUpperCase())}</span></div>${
                hero ? cardPanelHtml(hero) : ""
              }`
            : ""
        }</div>
      </div></div>
      <div class="gq-textbox"><p class="gq-dim">Feats framed forever, hero card attached. X to leave.</p></div>
    </div>`;
  },
  hoverCard(app, index) {
    return cardById(trophyRows(app.save)[index]?.cardId) ?? null;
  },
  key(app, key) {
    if (key === "up" || key === "down") {
      app.screen.index = clampIndex((app.screen.index ?? 0) + (key === "down" ? 1 : -1), trophyRows(app.save).length);
    } else if (key === "a" || key === "b") {
      return app.go("map");
    }
    app.rerender();
  }
};

// ---- Championship review -------------------------------------------------------

// The World Series victory lap: every game played was one day of the season,
// so the run's length is its headline stat, followed by the season MVPs.
export const championshipScreen = {
  render(app) {
    const save = app.save;
    const days = ensureSeasonStats(save).games;
    const counters = save.progress.counters;
    const rows = championshipRows(save);
    const index = clampIndex(app.screen.index ?? 0, rows.length);
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>CASCADE LEAGUE CHAMPION</span><span>DAY ${days}</span></div>
      <div class="gq-body">
        <div class="gq-frame gq-title-frame">
          <b style="font-size:5cqw">&#9733; WORLD SERIES CHAMPION &#9733;</b>
          <p class="gq-mt">THE SEASON TOOK <b>${days} DAY${days === 1 ? "" : "S"}</b> — ONE GAME A DAY.</p>
          <p class="gq-dim">BATTLES ${counters.battlesWon}-${counters.battlesLost} &middot; ${counters.packsOpened} PACK${counters.packsOpened === 1 ? "" : "S"} RIPPED &middot; ${save.player.badges.length} BADGES</p>
        </div>
        <div class="gq-frame gq-scroll gq-map-node">${sectionedMenu(rows, index)}</div>
      </div>
      <div class="gq-textbox"><p class="gq-dim">% IS SEASON WPA. Hover a row to read the card.</p><p class="gq-blink">Z — BACK TO THE LEAGUE</p></div>
    </div>`;
  },
  hoverCard(app, index) {
    return cardById(championshipRows(app.save)[index]?.id) ?? null;
  },
  key(app, key) {
    if (key === "up" || key === "down") {
      const rows = championshipRows(app.save);
      app.screen.index = clampIndex((app.screen.index ?? 0) + (key === "down" ? 1 : -1), rows.length);
    } else if (key === "a" || key === "b") {
      return app.go("map");
    }
    app.rerender();
  }
};

function championshipRows(save) {
  const bats = [...seasonHitters(save)].sort((a, b) => b.wpa - a.wpa).slice(0, 3);
  const arms = [...seasonPitchers(save)].sort((a, b) => b.wpa - a.wpa).slice(0, 2);
  return [
    ...bats.map((line) => ({
      section: "SEASON MVP BATS",
      id: line.id,
      html: `${escapeHtml(shortName(line.name))} ${wpaHtml(line.wpa)} <span class="gq-dim">${rateText(line.avg)} &middot; ${rateText(line.ops)} OPS &middot; ${line.hr}HR ${line.rbi}RBI &middot; ${line.games}G</span>`
    })),
    ...arms.map((line) => ({
      section: "SEASON MVP ARMS",
      id: line.id,
      html: `${escapeHtml(shortName(line.name))} ${wpaHtml(line.wpa)} <span class="gq-dim">${ipText(line.outs)} IP &middot; ${line.runsPerNine.toFixed(2)} RA9 &middot; ${line.so} K &middot; ${line.games}G</span>`
    }))
  ];
}

// ---- Season stats screen -------------------------------------------------------

// The sortable columns per view, keyed 1-9 on the keyboard. Pressing the
// same number again flips the direction. RA9 defaults ascending (lower is
// better); everything else descending.
const HITTER_SORTS = [
  { key: "wpa", label: "WPA" },
  { key: "avg", label: "AVG" },
  { key: "ops", label: "OPS" },
  { key: "hr", label: "HR" },
  { key: "rbi", label: "RBI" },
  { key: "sb", label: "SB" },
  { key: "games", label: "G" }
];
const PITCHER_SORTS = [
  { key: "wpa", label: "WPA" },
  { key: "runsPerNine", label: "RA9" },
  { key: "so", label: "K" },
  { key: "outs", label: "IP" },
  { key: "games", label: "G" }
];

// The visible stat lines after scope (active roster vs everyone who ever
// suited up), name search, and sort. Exported for tests.
export function seasonLines(app) {
  const view = app.screen.view ?? "hitters";
  const all = view === "pitchers" ? seasonPitchers(app.save) : seasonHitters(app.save);
  const scoped = (app.screen.scope ?? "roster") === "roster"
    ? all.filter((line) => app.save.roster.cardIds.includes(line.id))
    : all;
  const needle = (app.screen.query ?? "").trim().toUpperCase();
  const searched = needle ? scoped.filter((line) => line.name.toUpperCase().includes(needle)) : scoped;
  const sorts = view === "pitchers" ? PITCHER_SORTS : HITTER_SORTS;
  const sort = sorts.find((item) => item.key === app.screen.sortKey) ?? null;
  if (!sort) return { view, sorts, sort, dir: null, lines: searched };
  const dir = app.screen.sortDir ?? "desc";
  const lines = [...searched].sort((a, b) => (dir === "desc" ? b[sort.key] - a[sort.key] : a[sort.key] - b[sort.key]));
  return { view, sorts, sort, dir, lines };
}

export function statLineHtml(line, view) {
  if (view === "pitchers") {
    return `${escapeHtml(shortName(line.name))} ${wpaHtml(line.wpa)} <span class="gq-dim">${ipText(line.outs)} IP &middot; ${line.runsPerNine.toFixed(2)} RA9 &middot; ${line.so} K &middot; ${line.games}G</span>`;
  }
  return `${escapeHtml(shortName(line.name))} ${wpaHtml(line.wpa)} <span class="gq-dim">${rateText(line.avg)} &middot; ${rateText(line.ops)} OPS &middot; ${line.hr}HR ${line.rbi}RBI ${line.sb}SB &middot; ${line.games}G</span>`;
}

// Just this series' numbers: the active series' games are the newest almanac
// entries (nothing else can be played mid-series), so fold their box scores
// into a throwaway season book and read the same rate lines from it.
export function seriesStatLines(save) {
  const series = save.activeSeries;
  const played = series ? series.wins + series.losses : 0;
  const temp = { seasonStats: { games: 0, hitters: {}, pitchers: {} } };
  if (played > 0) {
    for (const entry of ensureAlmanac(save).slice(-played)) {
      if (entry.trainerId !== series.trainerId || !entry.boxScore) continue;
      recordGameStats(temp, entry.boxScore[entry.playerSide]);
    }
  }
  return { hitters: seasonHitters(temp), pitchers: seasonPitchers(temp), games: temp.seasonStats.games };
}

export const seasonStatsScreen = {
  render(app) {
    const save = app.save;
    const { view, sorts, sort, dir, lines } = seasonLines(app);
    const scope = app.screen.scope ?? "roster";
    const index = clampIndex(app.screen.index ?? 0, lines.length);
    const games = ensureSeasonStats(save).games;
    const sortBar = sorts
      .map((item, at) => (sort?.key === item.key
        ? `<b>${at + 1} ${item.label}${dir === "desc" ? "&#9660;" : "&#9650;"}</b>`
        : `${at + 1} ${item.label}`))
      .join(" &middot; ");
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>SEASON STATS &middot; ${view === "pitchers" ? "ARMS" : "BATS"} &middot; ${scope === "roster" ? "ACTIVE ROSTER" : "ALL PLAYERS"}</span><span>${games} GAME${games === 1 ? "" : "S"}</span></div>
      <div class="gq-body">
        <p class="gq-dim">SORT: ${sortBar}</p>
        <div class="gq-frame gq-scroll">${
          lines.length
            ? menuHtml(lines.map((line) => ({ html: statLineHtml(line, view) })), index)
            : `<p class="gq-dim">${app.screen.query ? `NOBODY NAMED "${escapeHtml(app.screen.query)}" HERE.` : "NO GAMES ON RECORD YET. GO PLAY SOMEBODY."}</p>`
        }</div>
      </div>
      <div class="gq-textbox">${
        app.screen.query ? `<p>SEARCH: <b>${escapeHtml(app.screen.query)}</b>_ <span class="gq-dim">X CLEARS</span></p>` : ""
      }<p class="gq-dim">&#8592;/&#8594; ROSTER &middot; EVERYONE. Z BATS/ARMS. Type a name to search &middot; 1-${sorts.length} sorts (again flips). X to leave.</p></div>
    </div>`;
  },
  hoverCard(app, index) {
    return cardById(seasonLines(app).lines[index]?.id) ?? null;
  },
  typed(app, char) {
    if (/\d/.test(char)) {
      const { sorts } = seasonLines(app);
      const pick = sorts[Number(char) - 1];
      if (!pick) return;
      if (app.screen.sortKey === pick.key) {
        app.screen.sortDir = (app.screen.sortDir ?? "desc") === "desc" ? "asc" : "desc";
      } else {
        app.screen.sortKey = pick.key;
        app.screen.sortDir = pick.key === "runsPerNine" ? "asc" : "desc";
      }
    } else if (char === "\b") {
      app.screen.query = (app.screen.query ?? "").slice(0, -1);
      app.screen.index = 0;
    } else {
      app.screen.query = ((app.screen.query ?? "") + char).slice(0, 24);
      app.screen.index = 0;
    }
    app.rerender();
  },
  key(app, key) {
    if (key === "left" || key === "right") {
      app.screen.scope = (app.screen.scope ?? "roster") === "roster" ? "all" : "roster";
      app.screen.index = 0;
    } else if (key === "up" || key === "down") {
      const { lines } = seasonLines(app);
      app.screen.index = clampIndex((app.screen.index ?? 0) + (key === "down" ? 1 : -1), lines.length);
    } else if (key === "a") {
      // Different view, different columns: the sort resets with it.
      app.screen.view = (app.screen.view ?? "hitters") === "hitters" ? "pitchers" : "hitters";
      app.screen.sortKey = null;
      app.screen.sortDir = null;
      app.screen.index = 0;
    } else if (key === "b") {
      if (app.screen.query) {
        app.screen.query = "";
        app.screen.index = 0;
      } else {
        return app.go("map");
      }
    }
    app.rerender();
  }
};
