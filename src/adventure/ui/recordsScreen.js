import { escapeHtml, clampIndex } from "./helpers.js?v=20260714-h";
import { sectionedMenu, gameStars } from "./statsScreens.js?v=20260714-h";
import { ensureAlmanac } from "../state.js?v=20260714-h";
import { expandGame } from "../gameLog.js?v=20260714-h";
import { fetchGames } from "../gameArchive.js?v=20260714-h";
import {
  RECORD_PAGES,
  recordsOnPage,
  leaderboard,
  cachedGlobalRecords,
  fetchGlobalRecords,
  submitRecords
} from "../records.js?v=20260714-h";

// ---- World records ----------------------------------------------------------
//
// The league's book. One row per record, YOUR mark on the same line, and the top
// five behind it when you stop on one — so the screen answers the two questions
// you actually have, in the order you have them: what is the number, and how far
// off it am I?
//
// A record you have never set reads as a dash rather than a zero. Nought runs in
// a game is a thing that can happen; never having played a game is not the same
// thing, and a leaderboard that cannot tell them apart is lying.
//
// The book has two pages and &#9664;/&#9654; turns them: the MANAGER records, which are
// afternoons you had, and the PLAYER records, which are campaigns your men had.
// A player's line names him first and his manager after, because that is whose
// record it is — the manager only signed the cheque.

let syncStatus = "idle"; // idle | syncing | online | offline

async function syncGlobal(app) {
  syncStatus = "syncing";
  try {
    // Yours go up, the league's come down. Both, every visit — a save that beat
    // its own mark since last time is exactly the case worth pushing.
    await submitRecords(app.save);
    await fetchGlobalRecords();
    syncStatus = "online";
  } catch {
    // No server, no problem: your own bests still stand, alone.
    syncStatus = "offline";
  }
  app.rerender();
}

function statusLabel() {
  if (syncStatus === "syncing") return "CALLING THE LEAGUE OFFICE&#8230;";
  if (syncStatus === "offline") return "OFFLINE &middot; YOUR MARKS ONLY";
  return "THE LEAGUE";
}

function valueText(record, value) {
  const number = record.format ? record.format(value) : value;
  return `${number} ${record.unit.toUpperCase()}`;
}

// Whose record it is. On the manager page that is one name. On the player page it
// is two, and the order matters: the man who did it, then the club he did it for.
function holderText(record, entry) {
  const manager = escapeHtml(entry.name);
  if (record.page !== "player" || !entry.player) return manager;
  return `${escapeHtml(entry.player)} <span class="gq-dim">&middot; ${manager}</span>`;
}

// The current page of the book, and the records on it.
function currentPage(app) {
  return RECORD_PAGES[clampIndex(app.screen.pageIndex ?? 0, RECORD_PAGES.length)];
}

// The rows: every record on this page, whether or not anybody has set it.
function recordRows(app) {
  const globals = cachedGlobalRecords();
  return recordsOnPage(currentPage(app).key).map((record) => {
    const board = leaderboard(record, globals, app.save);
    const holder = board.top[0] ?? null;
    const mine = board.you ?? null;
    const standing = !mine
      ? `<span class="gq-dim">&mdash;</span>`
      : board.yourRank === 1
        ? `<b>YOURS</b>`
        : `<span class="gq-dim">YOU ${valueText(record, mine.value)}${board.yourRank ? ` &middot; ${ordinal(board.yourRank)}` : ""}</span>`;
    return {
      section: record.group,
      record,
      board,
      html: `${escapeHtml(record.title)} &mdash; ${
        holder
          ? `<b>${valueText(record, holder.value)}</b> <span class="gq-dim">${holderText(record, holder)}</span>`
          : `<span class="gq-dim">UNSET</span>`
      } ${standing}`
    };
  });
}

function ordinal(place) {
  const suffix = place % 100 >= 11 && place % 100 <= 13 ? "TH"
    : place % 10 === 1 ? "ST"
      : place % 10 === 2 ? "ND"
        : place % 10 === 3 ? "RD"
          : "TH";
  return `${place}${suffix}`;
}

// The top five for the record under the cursor, with you marked wherever you
// stand in it — and appended below if you are not in it at all.
//
// It is a MENU when you step into it (Z), because every line of it is an
// afternoon somebody had, and an afternoon you cannot open is just a number with
// a name stuck to it. Yours open out of your own almanac, with the play-by-play.
// A stranger's opens out of the copy they sent up when they finished — the box
// score and the players who won it, which is what they sent.
function boardHtml(row, app, active) {
  const { record, board } = row;
  if (!board.top.length) {
    return `<div class="gq-frame">
      <h3>${escapeHtml(record.title)}</h3>
      <p class="gq-dim">NOBODY HAS DONE IT YET. THE FIRST MANAGER TO DO IT OWNS IT.</p>
    </div>`;
  }
  const cursor = clampIndex(app.screen.boardIndex ?? 0, board.top.length);
  const lines = board.top.map((entry, place) => {
    const text = `${place + 1}. <b>${valueText(record, entry.value)}</b> ${holderText(record, entry)}`;
    if (!active) return `<p class="${entry.you ? "" : "gq-dim"}">${text}</p>`;
    return `<p class="gq-board-row${place === cursor ? " gq-cursor" : ""}" data-menu-index="${place}">${
      place === cursor ? "&#9654; " : "&nbsp;&nbsp;"
    }${text}</p>`;
  }).join("");
  const below = board.you && !board.top.some((entry) => entry.you)
    ? `<p>${board.yourRank ? `${board.yourRank}.` : ""} <b>${valueText(record, board.you.value)}</b> ${holderText(record, board.you)} &#9664; YOU</p>`
    : "";
  const yourNone = !board.you ? `<p class="gq-dim">YOU HAVE NOT SET THIS ONE.</p>` : "";
  return `<div class="gq-frame">
    <h3>${escapeHtml(record.title)}</h3>
    ${lines}${below}${yourNone}
  </div>`;
}

// Open the afternoon behind one line of the board. Yours comes out of the
// almanac, whole, with the play-by-play. Somebody else's is fetched — they are
// not on this machine — and comes back as the box score they sent up.
async function openBoardGame(app, record, entry, back) {
  const save = app.save;
  const mine = save && entry.saveSeed === save.saveSeed;
  const game = mine
    ? ensureAlmanac(save).find((played) => played.day === entry.day && played.opponent === entry.opponent)
    : (await fetchGames(entry.saveSeed)).find((played) => played.day === entry.day);
  if (!game) {
    app.screen.missing = true;
    app.rerender();
    return;
  }
  app.go("gameStats", {
    trainerId: game.trainerId,
    opponent: game.opponent,
    boxScore: game.boxScore,
    stars: gameStars(game.boxScore, game.playerSide),
    feats: game.feats ?? [],
    events: mine ? expandGame(game.events) : [],
    score: game.score,
    lineScore: game.lineScore ?? null,
    playerSide: game.playerSide,
    index: 0,
    next: { name: "records", data: back }
  });
}

// A manager record is an afternoon and you can open it. A player record is a
// campaign — five months in one man's hands, and no single box score behind it —
// so there is nothing to step into, and the screen does not pretend there is.
function openable(record) {
  return record?.page !== "player";
}

export const recordsScreen = {
  render(app) {
    const page = currentPage(app);
    const rows = recordRows(app);
    const index = clampIndex(app.screen.index ?? 0, rows.length);
    const selected = rows[index];
    const inBoard = app.screen.mode === "board" && selected?.board.top.length;
    const turn = "&#9664;/&#9654; turns the book";
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>WORLD RECORDS &middot; ${page.title}</span><span>${statusLabel()}</span></div>
      <div class="gq-body"><div class="gq-columns gq-columns-records">
        <div class="gq-frame gq-scroll">${sectionedMenu(rows, index)}</div>
        <div class="gq-scroll">${boardHtml(selected, app, Boolean(inBoard))}</div>
      </div></div>
      <div class="gq-textbox"><p class="gq-dim">${
        app.screen.missing
          ? "THAT GAME NEVER CAME UP FROM THAT MANAGER'S MACHINE. THE NUMBER STANDS; THE AFTERNOON IS GONE."
          : inBoard
            ? "&#9650;/&#9660; walks the board &middot; Z opens that afternoon &mdash; the box score, and the men who won it. X backs out."
            : !openable(selected?.record)
              ? `&#9650;/&#9660; moves &middot; ${turn}. A season is not an afternoon: there is no one game to open. X to leave.`
              : selected?.board.top.length
                ? `&#9650;/&#9660; moves &middot; ${turn} &middot; Z steps into the board and opens the games behind it. X to leave.`
                : `&#9650;/&#9660; moves &middot; ${turn}. Nobody has set this one yet. X to leave.`
      }</p></div>
    </div>`;
  },
  mounted(app) {
    // One sync per visit. The flag lives on the screen object, which survives
    // rerenders and is thrown away by the next go().
    if (app.screen.synced) return;
    app.screen.synced = true;
    syncGlobal(app);
  },
  key(app, key) {
    const pageIndex = clampIndex(app.screen.pageIndex ?? 0, RECORD_PAGES.length);
    const rows = recordRows(app);
    const index = clampIndex(app.screen.index ?? 0, rows.length);
    const selected = rows[index];
    const top = selected?.board.top ?? [];
    app.screen.missing = false;

    // Inside the board: every line is an afternoon, and Z opens it.
    if (app.screen.mode === "board" && top.length) {
      const cursor = clampIndex(app.screen.boardIndex ?? 0, top.length);
      if (key === "up" || key === "down") {
        app.screen.boardIndex = clampIndex(cursor + (key === "down" ? 1 : -1), top.length);
      } else if (key === "a") {
        openBoardGame(app, selected.record, top[cursor], { pageIndex, index, mode: "board", boardIndex: cursor });
        return;
      } else if (key === "b") {
        app.screen.mode = null;
      } else {
        return;
      }
      app.rerender();
      return;
    }

    if (key === "up" || key === "down") {
      app.screen.index = clampIndex(index + (key === "down" ? 1 : -1), rows.length);
    } else if (key === "left" || key === "right") {
      // Turn the page. The other half of the book is a different set of records,
      // so the cursor starts at the top of it rather than wherever this one left
      // off.
      app.screen.pageIndex = clampIndex(pageIndex + (key === "right" ? 1 : -1), RECORD_PAGES.length);
      app.screen.index = 0;
      app.screen.boardIndex = 0;
      app.screen.mode = null;
    } else if (key === "a") {
      // Step into the board. A record with nobody on it has nothing to step into,
      // and neither has a career.
      if (!top.length || !openable(selected.record)) return;
      app.screen.mode = "board";
      // Open on YOUR line if you are on the board — that is the one you came to
      // look at — and on the record holder if you are not.
      app.screen.boardIndex = Math.max(0, top.findIndex((entry) => entry.you));
    } else if (key === "b") {
      app.go("title", { menuIndex: 0 });
    } else {
      return;
    }
    app.rerender();
  }
};
