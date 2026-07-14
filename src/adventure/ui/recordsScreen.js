import { escapeHtml, clampIndex } from "./helpers.js?v=20260714-c";
import { sectionedMenu } from "./statsScreens.js?v=20260714-c";
import {
  RECORDS,
  leaderboard,
  cachedGlobalRecords,
  fetchGlobalRecords,
  submitRecords
} from "../records.js?v=20260714-c";

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
  return `${value} ${record.unit.toUpperCase()}`;
}

// The rows: every record, whether or not anybody has set it.
function recordRows(app) {
  const globals = cachedGlobalRecords();
  return RECORDS.map((record) => {
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
          ? `<b>${valueText(record, holder.value)}</b> <span class="gq-dim">${escapeHtml(holder.name)}</span>`
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
function boardHtml(row) {
  const { record, board } = row;
  if (!board.top.length) {
    return `<div class="gq-frame">
      <h3>${escapeHtml(record.title)}</h3>
      <p class="gq-dim">NOBODY HAS DONE IT YET. THE FIRST MANAGER TO DO IT OWNS IT.</p>
    </div>`;
  }
  const lines = board.top.map((entry, place) => `<p class="${entry.you ? "" : "gq-dim"}">${place + 1}. ${
    `<b>${valueText(record, entry.value)}</b>`
  } ${escapeHtml(entry.name)}${entry.you ? " &#9664; YOU" : ""}${
    entry.day ? ` <span class="gq-dim">DAY ${entry.day}${entry.opponent ? ` VS ${escapeHtml(entry.opponent)}` : ""}</span>` : ""
  }</p>`).join("");
  // You, when the top five does not reach you.
  const below = board.you && !board.top.some((entry) => entry.you)
    ? `<p>${board.yourRank ? `${board.yourRank}.` : ""} <b>${valueText(record, board.you.value)}</b> ${escapeHtml(board.you.name)} &#9664; YOU</p>`
    : "";
  const yourNone = !board.you ? `<p class="gq-dim">YOU HAVE NOT SET THIS ONE.</p>` : "";
  return `<div class="gq-frame">
    <h3>${escapeHtml(record.title)}</h3>
    ${lines}${below}${yourNone}
  </div>`;
}

export const recordsScreen = {
  render(app) {
    const rows = recordRows(app);
    const index = clampIndex(app.screen.index ?? 0, rows.length);
    const selected = rows[index];
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>WORLD RECORDS</span><span>${statusLabel()}</span></div>
      <div class="gq-body"><div class="gq-columns gq-columns-records">
        <div class="gq-frame gq-scroll">${sectionedMenu(rows, index)}</div>
        <div class="gq-scroll">${boardHtml(selected)}</div>
      </div></div>
      <div class="gq-textbox"><p class="gq-dim">${
        app.save
          ? "Every manager, everywhere. Your own marks go up when you open the book. X to leave."
          : "Every manager, everywhere. Start a game and your marks join them. X to leave."
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
    const rows = recordRows(app);
    if (key === "up" || key === "down") {
      app.screen.index = clampIndex((app.screen.index ?? 0) + (key === "down" ? 1 : -1), rows.length);
    } else if (key === "b") {
      app.go("title", { menuIndex: 0 });
    } else {
      return;
    }
    app.rerender();
  }
};
