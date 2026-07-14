import { escapeHtml, menuHtml, clampIndex, cardPanelHtml, cardLine, rarityTag, shortName } from "./helpers.js?v=20260714-h";
import { PACKS, RARITIES, openPack, shopStock, cardById, adventurePool, dualPartnerCard, dualPrimaryId } from "../packs.js?v=20260714-h";
import { packEggs } from "../feats.js?v=20260714-h";
import {
  persistSave,
  deriveSeed,
  spendCoins,
  grantCoins,
  addCardToCollection,
  removeCardFromCollection,
  collectionCards,
  ownedCount,
  catalogProgress,
  isStarred,
  toggleStar,
  rosterCards,
  rosterPoints,
  pointCap,
  setRoster,
  setBattingOrder,
  managerFor,
  addLog
} from "../state.js?v=20260714-h";
import { validateRoster, buildTeam, assignLineupSlots, canPlayerFillLineupSlot } from "../../rules/draft.js?v=20260714-h";
import { hitterPositions, personConflict, playsPosition, positionsLabel, positionsOverlap } from "../../rules/cards.js?v=20260714-h";
import { rateText, ipText, wpaHtml } from "./statsScreens.js?v=20260714-h";
import { seasonHitters, seasonPitchers } from "../state.js?v=20260714-h";
import { playLegend } from "../../ui/sounds.js?v=20260714-h";

// ---- Two-way pairs -----------------------------------------------------------

// A simultaneous two-way player (an Ohtani-like) is one owned card: the
// stronger half fronts every browse list, the weaker "shadow" half folds in
// behind it, and sales price the pair together (state.js removes both).
// Roster screens still see both halves — playing both roles costs both slots.
function ownedPartner(save, card) {
  const partner = dualPartnerCard(card.id);
  return partner && ownedCount(save, partner.id) > 0 ? partner : null;
}

function isShadowHalf(save, card) {
  return Boolean(ownedPartner(save, card)) && dualPrimaryId(card.id) !== card.id;
}

// Pawn value, pair-priced when the partner sells along with it. Compute
// BEFORE the removal — the partner leaves in the same transaction.
function sellValueOf(save, card) {
  const partner = ownedPartner(save, card);
  return RARITIES[card.rarity].sellValue + (partner ? RARITIES[partner.rarity].sellValue : 0);
}

// Either half's last roster copy locks the whole pair.
function pairRosterLocked(save, card) {
  return [card, ownedPartner(save, card)].filter(Boolean)
    .some((half) => save.roster.cardIds.includes(half.id) && ownedCount(save, half.id) <= 1);
}

// ---- Shop ------------------------------------------------------------------

function shopItems(app) {
  const save = app.save;
  const stock = shopStock(save.saveSeed, "cedar-yards", save.progress.counters.battlesWon);
  const items = [];
  const pack = PACKS.booster;
  items.push({
    html: `${escapeHtml(pack.name.toUpperCase())} <span class="gq-dim">$${pack.price}</span>`,
    disabled: save.player.coins < pack.price,
    run: (a) => buyPack(a, pack)
  });
  // A rolled two-way half sells as its whole pair: one shelf line, the
  // stronger face, both halves' prices combined, both granted on purchase.
  const seen = new Set();
  for (const rolled of stock) {
    const card = cardById(dualPrimaryId(rolled.id)) ?? rolled;
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    const partner = dualPartnerCard(card.id);
    const price = RARITIES[card.rarity].singlePrice + (partner ? RARITIES[partner.rarity].singlePrice : 0);
    // Condensed row — the card panel beside the list shows the full stats.
    items.push({
      html: `${escapeHtml(shortName(card.name))} <span class="gq-dim">${card.points}PT &middot; $${price}</span>`,
      card,
      disabled: save.player.coins < price,
      run: (a) => buySingle(a, card, price)
    });
  }
  items.push({ label: "SELL CARDS", run: (a) => a.go("sell", { index: 0 }) });
  items.push({ label: "CARD CATALOG", run: (a) => a.go("catalog", { index: 0, filter: "ALL" }) });
  items.push({ label: "LEAVE SHOP", run: (a) => a.go("map") });
  return items;
}

// ---- Type-to-search ----------------------------------------------------------

// 10k-card pools need more than position paging: on searchable screens every
// printable key builds a query that narrows the list by name ("\b" is the
// backspace signal from main.js). X clears the query before it leaves the
// screen, so search never traps the player.
export function applyQuery(rows, query, nameOf) {
  const needle = (query ?? "").trim().toUpperCase();
  if (!needle) return rows;
  return rows.filter((row) => nameOf(row).toUpperCase().includes(needle));
}

function typeIntoQuery(app, char) {
  const query = app.screen.query ?? "";
  app.screen.query = char === "\b" ? query.slice(0, -1) : (query + char).slice(0, 24);
  app.screen.index = 0;
  app.rerender();
}

// Binder/catalog typing: letters are inert until F ("find") opens search
// mode (they then type into the query). Every card ACTION lives in the
// Z/ENTER action menu — no letter shortcuts.
function searchableTyped(app, char) {
  if (app.screen.searching || char === "\b") {
    typeIntoQuery(app, char);
    return;
  }
  app.screen.notice = null;
  if (char.toLowerCase() === "f") {
    app.screen.searching = true;
    app.rerender();
  }
}

function starMark(save, card) {
  return isStarred(save, card.id) ? " &#9733;" : "";
}

function searchLine(query, searching = false) {
  if (!query && !searching) return "";
  return `<p>SEARCH: <b>${escapeHtml(query ?? "")}</b>_ <span class="gq-dim">${searching ? "ENTER DONE &middot; X CLEARS" : "X CLEARS"}</span></p>`;
}

// ---- Compare mode --------------------------------------------------------------

// Z pins a card; Z on a second card lays the two out side by side, claim-
// screen style. Z on the pinned card itself unpins it.
function pinOrCompare(app, card, returnTo) {
  if (!card) return;
  const pinned = app.screen.pinnedId;
  if (!pinned || pinned === card.id) {
    app.screen.pinnedId = pinned === card.id ? null : card.id;
    return;
  }
  const returnData = { ...app.screen, pinnedId: null };
  delete returnData.name;
  app.go("compare", { aId: pinned, bId: card.id, returnTo, returnData });
}

function pinMark(app, card) {
  return app.screen.pinnedId === card.id ? " &#9873;" : "";
}

function pinnedLine(app) {
  const pinned = app.screen.pinnedId ? cardById(app.screen.pinnedId) : null;
  return pinned
    ? `<p>&#9873; PINNED: <b>${escapeHtml(shortName(pinned.name))}</b> — Z another card to compare.</p>`
    : "";
}

export const compareScreen = {
  render(app) {
    const a = cardById(app.screen.aId);
    const b = cardById(app.screen.bId);
    const owned = (card) => ownedCount(app.save, card.id) || null;
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>COMPARE</span><span>${escapeHtml(shortName(a?.name ?? "?"))} &middot; ${escapeHtml(shortName(b?.name ?? "?"))}</span></div>
      <div class="gq-body"><div class="gq-columns">
        <div class="gq-compare-side">${a ? cardPanelHtml(a, { count: owned(a) }) : ""}</div>
        <div class="gq-compare-side">${b ? cardPanelHtml(b, { count: owned(b) }) : ""}</div>
      </div></div>
      <div class="gq-textbox"><p class="gq-dim">Side by side, warts and all. Z or X to go back.</p></div>
    </div>`;
  },
  key(app, key) {
    if (key !== "a" && key !== "b") return;
    app.go(app.screen.returnTo ?? "map", app.screen.returnData ?? {});
    app.rerender();
  }
};

// ---- Catalog: every card in this universe ------------------------------------

// The full pool is big (up to ~10k cards), so rows sort once per filter and
// the list renders a window around the cursor instead of the whole thing.
const CATALOG_WINDOW = 25;
let catalogCache = { pool: null, filter: null, rows: null };

export function catalogRows(filter = "ALL") {
  const pool = adventurePool();
  if (catalogCache.pool === pool && catalogCache.filter === filter) return catalogCache.rows;
  // Two-way pairs list once, fronted by the stronger half, answering to
  // both halves' position pages.
  const matches = (card) => (filter === "SP" || filter === "RP")
    ? card.role === filter
    : card.kind === "hitter" && playsPosition(card, filter);
  const cards = pool.filter((card) => {
    if (dualPrimaryId(card.id) !== card.id) return false;
    if (filter === "ALL") return true;
    const partner = dualPartnerCard(card.id);
    return matches(card) || (partner && matches(partner));
  });
  const rows = [...cards].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  catalogCache = { pool, filter, rows };
  return rows;
}

function catalogVisibleRows(app) {
  return applyQuery(catalogRows(app.screen.filter ?? "ALL"), app.screen.query, (card) => card.name);
}

// ---- The card action menu ------------------------------------------------
//
// One driving scheme everywhere: Z/ENTER (or a tap) on a card opens its
// actions, arrows move, Z runs, X closes. The binder, catalog, and team
// screens all speak it; each supplies its own list from the shared entries
// below. No letter keys required anywhere (F still finds, for keyboards).
function actionMenuHtml(title, actions, actionIndex) {
  return `<h3>${escapeHtml(title)}</h3>${menuHtml(
    actions.map((action) => ({ html: action.label, disabled: action.disabled })),
    clampIndex(actionIndex ?? 0, actions.length)
  )}`;
}

function actionMenuKey(app, key, actions) {
  if (key === "up" || key === "down") {
    app.screen.actionIndex = clampIndex((app.screen.actionIndex ?? 0) + (key === "down" ? 1 : -1), actions.length);
  } else if (key === "a") {
    const action = actions[clampIndex(app.screen.actionIndex ?? 0, actions.length)];
    if (!action.disabled) {
      app.screen.actionMenu = false;
      action.run();
    }
  } else if (key === "b") {
    app.screen.actionMenu = false;
    app.screen.confirmSell = null;
  }
}

function openActionMenu(app) {
  app.screen.actionMenu = true;
  app.screen.actionIndex = 0;
}

function starAction(app, card) {
  return {
    label: isStarred(app.save, card.id) ? "&#9733; UNSTAR KEEPER" : "&#9733; STAR AS KEEPER",
    run: () => { toggleStar(app.save, card.id); persistSave(app.save); }
  };
}

function compareAction(app, card, returnTo) {
  return {
    label: app.screen.pinnedId === card.id ? "UNPIN" : app.screen.pinnedId ? "COMPARE WITH PINNED" : "PIN TO COMPARE",
    run: () => pinOrCompare(app, card, returnTo)
  };
}

// Selling a copy at the pair-priced pawn rate; the roster's last copy
// stays, visibly. Null when the player owns none. Choosing it arms an
// are-you-sure — the menu re-opens as the confirm.
function sellAction(app, card) {
  if (ownedCount(app.save, card.id) <= 0) return null;
  const locked = pairRosterLocked(app.save, card);
  const value = sellValueOf(app.save, card);
  return {
    label: locked
      ? `SELL A COPY <span class="gq-dim">ROSTER COPY &mdash; NOT FOR SALE</span>`
      : `SELL A COPY <span class="gq-dim">&#8594; $${value}</span>`,
    disabled: locked,
    run: () => {
      openActionMenu(app);
      app.screen.confirmSell = card.id;
    }
  };
}

function sellConfirmActions(app, card) {
  const value = sellValueOf(app.save, card);
  return [
    {
      label: `YES &mdash; SELL FOR $${value}`,
      run: () => {
        app.screen.confirmSell = null;
        if (removeCardFromCollection(app.save, card.id)) {
          grantCoins(app.save, value);
          addLog(app.save, `Sold ${card.name} (+${value} coins).`);
          persistSave(app.save);
        }
      }
    },
    { label: "NO &mdash; KEEP HIM", run: () => { app.screen.confirmSell = null; } }
  ];
}

// The screen's action list, unless a sale is waiting on its are-you-sure.
function menuActions(app, card, builder) {
  if (card && app.screen.confirmSell === card.id) return sellConfirmActions(app, card);
  return builder(app, card);
}

function actionMenuTitle(app, card) {
  if (!card) return "";
  return app.screen.confirmSell === card.id ? `SELL ${card.name.toUpperCase()}?` : card.name.toUpperCase();
}

function catalogActions(app, card) {
  if (!card) return [{ label: "CANCEL", run: () => {} }];
  const actions = [starAction(app, card), compareAction(app, card, "catalog")];
  const sell = sellAction(app, card);
  if (sell) actions.push(sell);
  actions.push({ label: "CANCEL", run: () => {} });
  return actions;
}

export const catalogScreen = {
  render(app) {
    const filter = app.screen.filter ?? "ALL";
    const rows = catalogVisibleRows(app);
    const index = clampIndex(app.screen.index ?? 0, rows.length);
    const start = Math.max(0, Math.min(index - Math.floor(CATALOG_WINDOW / 2), rows.length - CATALOG_WINDOW));
    const visible = rows.slice(start, start + CATALOG_WINDOW);
    const selected = rows[index];
    const list = app.screen.actionMenu
      ? actionMenuHtml(actionMenuTitle(app, selected), menuActions(app, selected, catalogActions), app.screen.actionIndex)
      : rows.length
        ? menuHtml(
            visible.map((card) => {
              const owned = ownedCount(app.save, card.id);
              const rostered = app.save.roster.cardIds.includes(card.id);
              return { html: `${cardLine(card)}${owned ? ` <span class="gq-dim">*x${owned}</span>` : ""}${rostered ? " &#9679;" : ""}${starMark(app.save, card)}${pinMark(app, card)}` };
            }),
            index - start,
            { offset: start }
          )
        : `<p class="gq-dim">NO CARD ANSWERS TO "${escapeHtml(app.screen.query ?? "")}".</p>`;
    // How much of this page you actually have. Counted over the FILTER's cards,
    // not the search's — the answer to "how many catchers do I own" must not
    // change while you are typing a name into the box.
    const page = catalogRows(filter);
    const owned = page.filter((card) => ownedCount(app.save, card.id) > 0).length;
    // The whole league, not just this page — the thing you are actually chasing.
    const all = catalogProgress(app.save);
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>CARD CATALOG &middot; ${escapeHtml(filter)} &middot; OWNED ${owned}/${page.length}</span><span>${
        all.complete ? "&#9733; COMPLETE" : `${all.owned}/${all.total} IN ALL`
      }</span></div>
      <div class="gq-body"><div class="gq-columns">
        <div class="gq-frame gq-scroll">${list}</div>
        <div class="gq-card-side gq-card-side-sm">${selected ? cardPanelHtml(selected, { count: ownedCount(app.save, selected.id) || null }) : ""}</div>
      </div></div>
      <div class="gq-textbox">${pinnedLine(app)}${searchLine(app.screen.query, app.screen.searching)}<p class="gq-dim">${
        app.screen.actionMenu
          ? "Z picks an action. X closes."
          : "Every card in this league, best first. Z/ENTER opens card actions &middot; F finds &middot; &#9664;/&#9654; page by position &middot; * = owned &middot; &#9679; = on roster &middot; &#9733; = keeper. X to leave."
      }</p></div>
    </div>`;
  },
  hoverCard(app, index) {
    if (app.screen.actionMenu) return null;
    return catalogVisibleRows(app)[index] ?? null;
  },
  typed(app, char) {
    if (app.screen.actionMenu) return;
    searchableTyped(app, char);
  },
  key(app, key) {
    const rows = catalogVisibleRows(app);
    if (app.screen.actionMenu) {
      const selected = rows[clampIndex(app.screen.index ?? 0, rows.length)] ?? null;
      actionMenuKey(app, key, menuActions(app, selected, catalogActions));
      app.rerender();
      return;
    }
    if (key === "left" || key === "right") {
      const at = BINDER_FILTERS.indexOf(app.screen.filter ?? "ALL");
      app.screen.filter = BINDER_FILTERS[(at + (key === "right" ? 1 : -1) + BINDER_FILTERS.length) % BINDER_FILTERS.length];
      app.screen.index = 0;
    } else if (key === "up" || key === "down") {
      app.screen.index = clampIndex((app.screen.index ?? 0) + (key === "down" ? 1 : -1), rows.length);
    } else if (key === "a") {
      if (app.screen.searching) {
        app.screen.searching = false;
      } else if (rows.length) {
        openActionMenu(app);
      }
    } else if (key === "b") {
      if (app.screen.searching || app.screen.query) {
        app.screen.searching = false;
        app.screen.query = "";
        app.screen.index = 0;
      } else if (app.screen.pinnedId) {
        app.screen.pinnedId = null;
      } else {
        app.go("shop", { menuIndex: 0 });
      }
    }
    app.rerender();
  }
};

function buyPack(app, pack) {
  const save = app.save;
  if (!spendCoins(save, pack.price)) return;
  save.progress.counters.packsOpened += 1;
  save.pendingPacks.push({ packId: pack.id, seed: deriveSeed(save, "pack", save.progress.counters.packsOpened) });
  persistSave(save);
  app.go("packOpen", { revealed: 0, returnTo: "shop" });
}

function buySingle(app, card, price) {
  const save = app.save;
  if (!spendCoins(save, price)) return;
  addCardToCollection(save, card.id);
  addLog(save, `Bought ${card.name}.`);
  persistSave(save);
}

export const shopScreen = {
  render(app) {
    const items = shopItems(app);
    const selected = items[app.screen.menuIndex ?? 0];
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>CEDAR YARDS CARD SHOP</span><span>$${app.save.player.coins}</span></div>
      <div class="gq-body"><div class="gq-columns">
        <div class="gq-frame gq-scroll">${menuHtml(
          items.map((item) => ({ label: item.label, html: item.html, disabled: item.disabled })),
          app.screen.menuIndex ?? 0
        )}</div>
        <div class="gq-card-side">${selected?.card ? cardPanelHtml(selected.card, { count: ownedCount(app.save, selected.card.id) || null }) : ""}</div>
      </div></div>
      <div class="gq-textbox"><p>Singles restock every time you win a battle.</p></div>
    </div>`;
  },
  hoverCard(app, index) {
    return shopItems(app)[index]?.card ?? null;
  },
  key(app, key) {
    const items = shopItems(app);
    if (key === "up" || key === "down") {
      app.screen.menuIndex = clampIndex((app.screen.menuIndex ?? 0) + (key === "down" ? 1 : -1), items.length);
    } else if (key === "a") {
      const item = items[app.screen.menuIndex ?? 0];
      if (item && !item.disabled) item.run(app);
    } else if (key === "b") {
      app.go("map");
    }
    app.rerender();
  }
};

// ---- Sell to the shop --------------------------------------------------------

// What the shop will take: every copy EXCEPT roster copies — the active
// thirteen are never for sale. A rostered card with spares lists only the
// spares; a rostered card with one copy doesn't list at all.
function sellableCards(save) {
  return collectionCards(save)
    .filter(({ card }) => !isShadowHalf(save, card))
    .map(({ card, count }) => {
      const locked = save.roster.cardIds.includes(card.id) ? 1 : 0;
      // A pair sells as one unit: spares exist only where BOTH halves have
      // an unlocked copy, and the line prices the pair together.
      const partner = ownedPartner(save, card);
      const spare = partner
        ? Math.min(count - locked, ownedCount(save, partner.id) - (save.roster.cardIds.includes(partner.id) ? 1 : 0))
        : count - locked;
      return {
        card,
        count: spare,
        locked: locked > 0 || Boolean(partner && save.roster.cardIds.includes(partner.id)),
        value: sellValueOf(save, card)
      };
    })
    .filter(({ count }) => count > 0);
}

// Everything past the first copy of each card (roster copies always kept;
// spareStarred also skips the player's starred keepers). Returns coins
// earned. Exported for tests.
export function sellAllDuplicates(save, { spareStarred = false } = {}) {
  let coins = 0;
  for (const { card, count } of collectionCards(save)) {
    if (isShadowHalf(save, card)) continue; // the pair sells via its primary
    if (spareStarred && isStarred(save, card.id)) continue;
    const keep = 1;
    for (let extra = count; extra > keep; extra -= 1) {
      const value = sellValueOf(save, card);
      if (!removeCardFromCollection(save, card.id)) break;
      coins += value;
    }
  }
  grantCoins(save, coins);
  return coins;
}

// The nuclear option: every sellable copy goes — non-roster cards to zero,
// rostered cards down to their roster copy, starred keepers spared when
// asked. Returns coins earned. Exported for tests.
export function sellAllCards(save, { spareStarred = false } = {}) {
  let coins = 0;
  for (const { card, count } of sellableCards(save)) {
    if (spareStarred && isStarred(save, card.id)) continue;
    for (let copy = 0; copy < count; copy += 1) {
      const value = sellValueOf(save, card);
      if (!removeCardFromCollection(save, card.id)) break;
      coins += value;
    }
  }
  grantCoins(save, coins);
  return coins;
}

// Menu-label hauls: duplicates keep one of each card, sell-all keeps only
// roster copies. Both respect the starred shield when it's up.
function duplicateHaul(save, spareStarred) {
  return sellableCards(save).reduce(
    (coins, { card, count, locked, value }) => coins + (spareStarred && isStarred(save, card.id)
      ? 0
      : value * (locked ? count : count - 1)),
    0
  );
}

function fullHaul(save, spareStarred) {
  return sellableCards(save).reduce(
    (coins, { card, count, value }) => coins + (spareStarred && isStarred(save, card.id) ? 0 : value * count),
    0
  );
}

// What is about to be sold, said out loud with the money on it. A confirm that
// does not name what it is confirming is a confirm nobody reads.
function sellPrompt(app, pending) {
  if (pending.kind === "card") {
    const card = cardById(pending.id);
    return `SELL ${escapeHtml(shortName(card?.name ?? "THIS CARD"))} FOR $${pending.value}?`;
  }
  if (pending.kind === "duplicates") return `SELL EVERY SPARE COPY FOR $${pending.value}?`;
  return `SELL THE WHOLE BINDER FOR $${pending.value}?`;
}

export const sellScreen = {
  render(app) {
    const rows = sellableCards(app.save);
    const spare = app.screen.spareStarred ?? true;
    const index = clampIndex(app.screen.index ?? 0, rows.length + (rows.length ? 3 : 0) + 1);
    const selected = rows[index]?.card ?? null;
    // NOTHING on this screen sells on one keypress. A card sold is gone — the
    // shop pays pawn rates and will not sell it back — and the cursor sits on a
    // row you may only have been reading. The whole binder always asked; a single
    // card, which is the thing you actually lose by accident, did not.
    const pending = app.screen.confirmSell ?? null;
    const items = [
      ...rows.map(({ card, count, locked, value }) => ({
        html: `${cardLine(card)} <span class="gq-dim">x${count}${locked ? " SPARE" : ""} &#8594; $${value}</span>${starMark(app.save, card)}`
      })),
      ...(rows.length
        ? [
            { html: `SELL ALL DUPLICATES <span class="gq-dim">&#8594; $${duplicateHaul(app.save, spare)}</span>` },
            { html: `SELL ALL CARDS <span class="gq-dim">&#8594; $${fullHaul(app.save, spare)}</span>` },
            { html: `&#9733; PROTECT STARRED <span class="gq-dim">${spare ? "ON — sweeps spare them" : "OFF — everything goes"}</span>` }
          ]
        : []),
      { label: "DONE SELLING" }
    ];
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>SELL TO THE SHOP</span><span>$${app.save.player.coins}</span></div>
      <div class="gq-body"><div class="gq-columns">
        <div class="gq-frame gq-scroll">${
          rows.length ? "" : `<p class="gq-dim">NOTHING SPARE TO SELL.</p>`
        }${menuHtml(items, index)}</div>
        <div class="gq-card-side">${selected ? cardPanelHtml(selected, { count: ownedCount(app.save, selected.id) }) : ""}</div>
      </div></div>
      <div class="gq-textbox">${
        pending
          ? `<p class="gq-blink"><b>${sellPrompt(app, pending)}</b></p><p class="gq-dim">Z AGAIN TO SELL &middot; X KEEPS IT.</p>`
          : `<p>Z sells one copy. Roster cards are never for sale — only their spares list here. &#9733; keepers dodge the sweeps while PROTECT is on.</p>`
      }</div>
    </div>`;
  },
  hoverCard(app, index) {
    return sellableCards(app.save)[index]?.card ?? null;
  },
  key(app, key) {
    const rows = sellableCards(app.save);
    const extras = rows.length ? 3 : 0;
    const total = rows.length + extras + 1;
    const sellAllIndex = rows.length + 1;
    const protectIndex = rows.length + 2;
    const spare = app.screen.spareStarred ?? true;
    const pending = app.screen.confirmSell ?? null;
    // Moving off the row you were asked about drops the question with it.
    if (key !== "a") app.screen.confirmSell = null;
    if (key === "up" || key === "down") {
      app.screen.index = clampIndex((app.screen.index ?? 0) + (key === "down" ? 1 : -1), total);
    } else if (key === "a") {
      const index = clampIndex(app.screen.index ?? 0, total);
      // The second Z, on the row that was asked about, is the one that sells.
      if (pending && pending.index === index) {
        app.screen.confirmSell = null;
        if (pending.kind === "card") {
          const row = rows[index];
          if (row && removeCardFromCollection(app.save, row.card.id)) {
            grantCoins(app.save, row.value);
            addLog(app.save, `Sold ${row.card.name} (+$${row.value}).`);
            persistSave(app.save);
          }
        } else if (pending.kind === "duplicates") {
          const coins = sellAllDuplicates(app.save, { spareStarred: spare });
          addLog(app.save, `Sold the duplicate pile (+$${coins}).`);
          persistSave(app.save);
          app.screen.index = 0;
        } else {
          const coins = sellAllCards(app.save, { spareStarred: spare });
          addLog(app.save, `Sold the whole binder (+$${coins}).`);
          persistSave(app.save);
          app.screen.index = 0;
        }
        app.rerender();
        return;
      }
      app.screen.confirmSell = null;
      // The first Z on anything that sells only ASKS. A card is gone once it is
      // gone — the shop pays pawn rates and will not sell it back — and the
      // cursor is often sitting on a row you were only reading.
      if (index < rows.length) {
        app.screen.confirmSell = { kind: "card", index, id: rows[index].card.id, value: rows[index].value };
      } else if (extras && index === rows.length) {
        app.screen.confirmSell = { kind: "duplicates", index, value: duplicateHaul(app.save, spare) };
      } else if (extras && index === sellAllIndex) {
        app.screen.confirmSell = { kind: "binder", index, value: fullHaul(app.save, spare) };
      } else if (extras && index === protectIndex) {
        app.screen.spareStarred = !spare;
      } else {
        app.go("shop", { menuIndex: 0 });
      }
    } else if (key === "b") {
      // X takes back the question; with nothing pending it leaves the shop.
      if (!pending) app.go("shop", { menuIndex: 0 });
    }
    app.rerender();
  }
};

// ---- Binder ----------------------------------------------------------------

// The binder pages by slot: left/right walks ALL -> each position -> the two
// pitching roles. Exported for tests.
export const BINDER_FILTERS = ["ALL", "C", "1B", "2B", "3B", "SS", "LF/RF", "CF", "DH", "SP", "RP"];

export function binderRows(save, filter = "ALL") {
  // Two-way pairs page as one entry that answers to BOTH halves' slots:
  // the combined card shows under DH and under SP alike.
  const rows = collectionCards(save).filter(({ card }) => !isShadowHalf(save, card));
  if (!filter || filter === "ALL") return rows;
  const matches = (card) => (filter === "SP" || filter === "RP")
    ? card.role === filter
    : card.kind === "hitter" && playsPosition(card, filter);
  return rows.filter(({ card }) => {
    const partner = ownedPartner(save, card);
    return matches(card) || (partner && matches(partner));
  });
}

function binderVisibleRows(app) {
  return applyQuery(binderRows(app.save, app.screen.filter ?? "ALL"), app.screen.query, ({ card }) => card.name);
}

// Roster spots this card could take: same kind, and not a second era of
// someone already on the team (unless he's the one sitting down).
// Whose spot the incoming card is really after: his OWN primary position — the
// first one printed on him, which is the one he plays best — or, for an arm, the
// same job. If nobody on the roster is standing there (you are adding a catcher
// to a club whose catcher is somehow not a catcher), fall back to the first man
// he could legally replace, and only then to the top of the list.
function defaultSwapIndex(save, incoming, targets) {
  const spotOf = (target) => currentSpot(save, target);
  if (incoming.kind === "pitcher") {
    const sameJob = targets.findIndex((target) => target.role === incoming.role);
    return sameJob >= 0 ? sameJob : 0;
  }
  const primary = hitterPositions(incoming)[0]?.pos ?? null;
  const atHisSpot = primary === null ? -1 : targets.findIndex((target) => spotOf(target) === primary);
  if (atHisSpot >= 0) return atHisSpot;
  const anySpotHeCanFill = targets.findIndex((target) => {
    const slot = lineupSlotOf(save, target);
    return slot ? canPlayerFillLineupSlot(incoming, slot) : false;
  });
  return anySpotHeCanFill >= 0 ? anySpotHeCanFill : 0;
}

// Where a rostered man is standing right now: the position a bat is playing (the
// LF/RF man in left reads LF, the DH reads DH), or the game an arm is taking. A
// bat the lineup could not seat falls back to what is printed on his card.
function currentSpot(save, card) {
  if (card.kind === "pitcher") {
    return rotationSlotOf(save, card) ?? card.role;
  }
  return lineupSlotOf(save, card) ?? positionsLabel(card);
}

function swapTargets(save, card) {
  const roster = rosterCards(save);
  return roster.filter((target) =>
    target.kind === card.kind && target.id !== card.id && !personConflict(roster, card, target.id));
}

function binderActions(app, card) {
  if (!card) return [{ label: "CANCEL", run: () => {} }];
  const rostered = app.save.roster.cardIds.includes(card.id);
  const targets = swapTargets(app.save, card);
  const blocked = rostered ? "ALREADY ON THE TEAM"
    : app.save.activeSeries ? "SERIES IN PROGRESS"
    : targets.length === 0 ? "NO LEGAL SPOT"
    : null;
  const actions = [
    {
      label: blocked ? `ADD TO TEAM <span class="gq-dim">${blocked}</span>` : "ADD TO TEAM &#8594; PICK WHO SITS",
      disabled: Boolean(blocked),
      run: () => {
        app.screen.mode = "team-swap";
        // The cursor opens on the man he is HERE TO REPLACE. A shortstop is
        // being added to play shortstop; asking who sits and then pointing at
        // the catcher makes you walk down the list every single time to answer
        // the question you already answered by choosing the card.
        app.screen.pickIndex = defaultSwapIndex(app.save, card, targets);
      }
    }
  ];
  const sell = sellAction(app, card);
  if (sell) actions.push(sell);
  actions.push(starAction(app, card), compareAction(app, card, "binder"), { label: "CANCEL", run: () => {} });
  return actions;
}

// The binder is where the cap gets spent, so the cap comes with it: the question
// you are answering here is who to add, and the number that says whether you can
// afford him was only ever on the team screen.
//
// Written the way the map bar writes it — bare, no TEAM in front of it. The word
// does not fit: the bar is one nowrap line, and with a filter as wide as LF/RF on
// the left it pushes the title into an ellipsis.
function teamPointsLabel(save) {
  const points = rosterPoints(save);
  const cap = pointCap(save);
  return Number.isFinite(cap) ? `${points}/${cap} PT` : `${points} PT`;
}

export const binderScreen = {
  render(app) {
    const filter = app.screen.filter ?? "ALL";
    const rows = binderVisibleRows(app);
    const index = clampIndex(app.screen.index ?? 0, rows.length);
    const selected = rows[index];
    // Benching a man for another man is a comparison, and it was being asked
    // with only ONE of them on the screen — and the one it showed was the card
    // you had already chosen. Both go up, side by side, the way the compare
    // window does it: the man who sits, and the man he sits for.
    const swapping = app.screen.mode === "team-swap" && Boolean(selected);
    const targets = swapping ? swapTargets(app.save, selected.card) : [];
    const pickIndex = swapping ? clampIndex(app.screen.pickIndex ?? 0, targets.length + 1) : 0;
    const outgoing = swapping ? targets[pickIndex] ?? null : null;
    let list;
    if (app.screen.actionMenu) {
      list = actionMenuHtml(actionMenuTitle(app, selected?.card), menuActions(app, selected?.card, binderActions), app.screen.actionIndex);
    } else if (swapping) {
      // The spot LEADS, then the man in it. Which man to bench is a question about
      // WHERE they play — you are looking for the hole your card fills, not
      // scanning for points — so the thing you are scanning for is what the eye
      // hits first, in a column, the way a lineup card is written.
      list = `<h3>WHO SITS FOR ${escapeHtml(shortName(selected.card.name))}?</h3>${menuHtml(
        [
          ...targets.map((target) => ({
            html: `<span class="gq-swap-spot">${escapeHtml(currentSpot(app.save, target))}</span>${escapeHtml(shortName(target.name))}`
          })),
          { label: "CANCEL" }
        ],
        pickIndex
      )}`;
    } else {
      list = rows.length
        ? menuHtml(
            rows.map(({ card, count }) => ({
              html: `${cardLine(card)}${count > 1 ? ` <span class="gq-dim">x${count}</span>` : ""}${
                app.save.roster.cardIds.includes(card.id) ? " &#9670;" : ""
              }${starMark(app.save, card)}${pinMark(app, card)}`
            })),
            index
          )
        : `<p class="gq-dim">NO ${escapeHtml(filter)} CARDS${app.screen.query ? ` NAMED "${escapeHtml(app.screen.query)}"` : ""} YET.</p>`;
    }
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>BINDER &middot; ${escapeHtml(filter)}</span><span>${rows.length} CARDS &middot; ${rows.reduce((sum, row) => sum + row.count, 0)} TOTAL</span><span>${teamPointsLabel(app.save)}</span></div>
      <div class="gq-body"><div class="gq-columns${swapping ? " gq-columns-swap" : ""}">
        <div class="gq-frame gq-scroll">${list}</div>
        ${swapping
          ? `<div class="gq-card-side">
              <p class="gq-dim">${outgoing ? "SITS" : "&nbsp;"}</p>
              ${outgoing ? cardPanelHtml(outgoing) : ""}
            </div>
            <div class="gq-card-side">
              <p class="gq-dim">STARTS</p>
              ${cardPanelHtml(selected.card, { count: selected.count })}
            </div>`
          : `<div class="gq-card-side gq-card-side-sm">${selected ? cardPanelHtml(selected.card, { count: selected.count }) : ""}</div>`}
      </div></div>
      <div class="gq-textbox">${app.screen.notice ? `<p><b>${app.screen.notice}</b></p>` : ""}${pinnedLine(app)}${searchLine(app.screen.query, app.screen.searching)}<p class="gq-dim">${
        app.screen.actionMenu ? "Z picks an action. X closes."
          : swapping ? "Z benches him for your card. X cancels."
          : "Z/ENTER opens card actions &middot; F finds &middot; &#9664;/&#9654; page by position &middot; &#9670; = on team &middot; &#9733; = keeper. X to leave."
      }</p></div>
    </div>`;
  },
  hoverCard(app, index) {
    if (app.screen.actionMenu || app.screen.mode === "team-swap") return null;
    return binderVisibleRows(app)[index]?.card ?? null;
  },
  typed(app, char) {
    if (app.screen.actionMenu || app.screen.mode === "team-swap") return;
    searchableTyped(app, char);
  },
  key(app, key) {
    const rows = binderVisibleRows(app);
    const selected = rows[clampIndex(app.screen.index ?? 0, rows.length)] ?? null;
    if (app.screen.actionMenu) {
      actionMenuKey(app, key, menuActions(app, selected?.card, binderActions));
      app.rerender();
      return;
    }
    if (app.screen.mode === "team-swap") {
      const targets = selected ? swapTargets(app.save, selected.card) : [];
      if (key === "up" || key === "down") {
        app.screen.pickIndex = clampIndex((app.screen.pickIndex ?? 0) + (key === "down" ? 1 : -1), targets.length + 1);
      } else if (key === "a") {
        const target = targets[clampIndex(app.screen.pickIndex ?? 0, targets.length + 1)];
        if (target && selected) {
          setRoster(app.save, app.save.roster.cardIds.map((id) => (id === target.id ? selected.card.id : id)));
          addLog(app.save, `${selected.card.name} takes ${target.name}'s roster spot.`);
          persistSave(app.save);
        }
        app.screen.mode = null;
      } else if (key === "b") {
        app.screen.mode = null;
      }
      app.rerender();
      return;
    }
    if (key === "left" || key === "right") {
      const at = BINDER_FILTERS.indexOf(app.screen.filter ?? "ALL");
      const next = (at + (key === "right" ? 1 : -1) + BINDER_FILTERS.length) % BINDER_FILTERS.length;
      app.screen.filter = BINDER_FILTERS[next];
      app.screen.index = 0;
    } else if (key === "up" || key === "down") {
      app.screen.index = clampIndex((app.screen.index ?? 0) + (key === "down" ? 1 : -1), rows.length);
    } else if (key === "a") {
      if (app.screen.searching) {
        app.screen.searching = false;
      } else if (rows.length) {
        openActionMenu(app);
      }
    } else if (key === "b") {
      if (app.screen.searching || app.screen.query) {
        app.screen.searching = false;
        app.screen.query = "";
        app.screen.index = 0;
      } else if (app.screen.pinnedId) {
        app.screen.pinnedId = null;
      } else {
        app.go("map");
      }
    }
    app.rerender();
  }
};

// ---- Rotation and DH management ----------------------------------------------

// The starting rotation is the roster's SP order: the first arm takes game 1
// (and odd games of a series). Exported for tests.
export function rotationCards(save) {
  return rosterCards(save).filter((card) => card.kind === "pitcher" && card.role === "SP");
}

// Swap the first two starters: the other arm takes game 1 now.
export function swapRotation(save) {
  const [first, second] = rotationCards(save);
  if (!first || !second) return false;
  return switchRotationTo(save, first, rotationSlotOf(save, second));
}

// An arm's place in the rotation, said the way the roster row says it. Null for
// a bat, or for a reliever — the pen has no order to be in.
export function rotationSlotOf(save, card) {
  if (card?.kind !== "pitcher" || card.role !== "SP") return null;
  const index = rotationCards(save).findIndex((arm) => arm.id === card.id);
  return index < 0 ? null : `GAME ${index + 1}`;
}

// Every other start this arm could take. A rotation is just an order, so there
// is nothing to check: any starter can take any game, and the man who had it
// takes the one being vacated. It is the same trade a position switch is.
export function rotationSwitchOptions(save, card) {
  const rotation = rotationCards(save);
  const from = rotation.findIndex((arm) => arm.id === card.id);
  if (from < 0) return [];
  return rotation
    .map((arm, index) => ({ label: `GAME ${index + 1}`, player: arm, card, from: `GAME ${from + 1}` }))
    .filter((option, index) => index !== from);
}

// The rotation IS the order of the SP cards on the roster, so moving an arm is
// swapping two ids in that list.
export function switchRotationTo(save, card, label) {
  const option = rotationSwitchOptions(save, card).find((item) => item.label === label);
  if (!option) return false;
  const ids = [...save.roster.cardIds];
  const a = ids.indexOf(card.id);
  const b = ids.indexOf(option.player.id);
  if (a < 0 || b < 0) return false;
  [ids[a], ids[b]] = [ids[b], ids[a]];
  setRoster(save, ids);
  return true;
}

// A hitter switches the position he plays; a starter switches the game he
// takes. Same gesture, same menu, same trade — so the screen asks once and the
// card answers for itself.
export function slotSwitchOptions(save, card) {
  return card?.kind === "pitcher" ? rotationSwitchOptions(save, card) : positionSwitchOptions(save, card);
}

export function switchSlotTo(save, card, label) {
  return card?.kind === "pitcher" ? switchRotationTo(save, card, label) : switchPositionTo(save, card, label);
}

function lineupSlots(save) {
  return assignLineupSlots(rosterCards(save), save.roster.lineupAssignments).slots;
}

// The slot a rostered hitter actually fills. Null for an arm, or for a bat
// the lineup couldn't seat.
export function lineupSlotOf(save, card) {
  if (card?.kind !== "hitter") return null;
  return lineupSlots(save).find((slot) => slot.player?.id === card.id)?.label ?? null;
}

// Legal position switches for a seated hitter: every other slot he could
// field, provided the man already there can cover the slot he vacates —
// a switch trades two men, so it has to work both ways. Anyone can DH and 1B
// takes any glove (at -1 out of position); the rest need the printed
// position. Exported for tests.
export function positionSwitchOptions(save, card) {
  if (card?.kind !== "hitter") return [];
  const slots = lineupSlots(save);
  const from = slots.find((slot) => slot.player?.id === card.id);
  if (!from) return [];
  return slots
    .filter((slot) => slot.label !== from.label)
    .filter((slot) => canPlayerFillLineupSlot(card, slot.label))
    .filter((slot) => !slot.player || canPlayerFillLineupSlot(slot.player, from.label))
    .map((slot) => ({ label: slot.label, player: slot.player, card, from: from.label }));
}

// Send `card` out to `label` and bring that slot's occupant back to the one he
// vacates. Both men were pinned at the slots they're leaving (or weren't
// pinned at all), so writing the two keys can't strand a stale assignment.
// Persists as slot assignments, so it holds for every future game.
export function switchPositionTo(save, card, label) {
  const option = positionSwitchOptions(save, card).find((item) => item.label === label);
  if (!option) return false;
  const assignments = { ...save.roster.lineupAssignments, [label]: card.id };
  if (option.player) assignments[option.from] = option.player.id;
  else delete assignments[option.from];
  save.roster.lineupAssignments = assignments;
  return true;
}

function switchLine(option) {
  // The note stays terse: the Game Boy column is narrow, and a long line
  // wraps into the card panel.
  const outOfPosition = option.label === "1B" && !playsPosition(option.card, "1B");
  return `${escapeHtml(option.label)}${outOfPosition ? ` <span class="gq-dim">FLD -1</span>` : ""}${
    option.player
      ? ` <span class="gq-dim">${escapeHtml(shortName(option.player.name))} TAKES ${escapeHtml(option.from)}</span>`
      : ""
  }`;
}

// The Team menu's action rows, after the 13 cards. There are none: everything a
// man's place on this team can be changed to is asked of the MAN, on his own
// card. The rotation used to be the exception — a SWAP ROTATION row hanging
// under the roster that could only ever trade the first two arms, and never said
// which arm you were trading. Now a starter changes his start the way a hitter
// changes his position, which is the same question and deserves the same menu.
function teamActions() {
  return [];
}

// ---- Team (roster editing) -------------------------------------------------

// The roster read as a LINEUP CARD: down the diamond (C, 1B, 2B, ...), then the
// bats the lineup couldn't seat, then the rotation in start order, then the pen.
//
// The stored order is arrival order, and a swap puts the incoming man in the
// OUTGOING man's slot in the array — so adding a third baseman over your first
// baseman filed the 3B under 1B, and the list read C, 3B, 2B, 1B, SS. The list
// is a view; this sorts the view and leaves the save alone. It has to: the
// rotation IS the roster's SP order (see rotationCards), so reordering
// roster.cardIds to make this screen read nicely would silently reshuffle who
// starts game 1.
function teamRosterCards(save) {
  const seat = new Map();
  lineupSlots(save).forEach((slot, index) => {
    if (slot.player) seat.set(slot.player.id, index);
  });
  const rotation = new Map(rotationCards(save).map((arm, index) => [arm.id, index]));
  // [group, place-within-group]; ties hold their roster order, since sort is stable.
  const rank = (card) => {
    if (card.kind === "hitter") {
      const seated = seat.get(card.id);
      return seated === undefined ? [1, 0] : [0, seated];
    }
    if (card.role === "SP") return [2, rotation.get(card.id) ?? Number.MAX_SAFE_INTEGER];
    return [3, 0];
  };
  return [...rosterCards(save)].sort((a, b) => {
    const left = rank(a);
    const right = rank(b);
    return left[0] - right[0] || left[1] - right[1];
  });
}

// The club reads as two pages, and left/right turns between them.
//
// Thirteen men in one column meant the arms lived below the fold: to change who
// starts game 1 you scrolled past nine bats to get to him. They are two
// different jobs asked in two different vocabularies — a bat has a POSITION and a
// spot in the order, an arm has a ROLE and a start — and the roster is really a
// lineup card stapled to a staff. So it is filed that way.
const TEAM_PAGES = ["bats", "arms"];

function teamPageCards(save, page) {
  const wanted = page === "arms" ? "pitcher" : "hitter";
  return teamRosterCards(save).filter((card) => card.kind === wanted);
}

function teamPageLabel(page, count) {
  return `${count} ${page === "arms" ? "ARM" : "BAT"}${count === 1 ? "" : "S"}`;
}

// Replacement candidates for a roster card. The default view sticks to the
// outgoing card's own position (role for pitchers); "all" widens to every
// unrostered card of the same kind. Cards that would put a second era of a
// rostered player on the team don't list — unless the anchor IS the other
// era, in which case the swap is exactly how you change decades. Exported
// for tests.
export function benchCards(save, anchor, filter = "position") {
  const roster = rosterCards(save);
  const spares = collectionCards(save)
    .map(({ card }) => card)
    .filter((card) => card.kind === anchor.kind && !save.roster.cardIds.includes(card.id))
    .filter((card) => !personConflict(roster, card, anchor.id));
  if (filter === "all") return spares;
  if (anchor.kind === "pitcher") return spares.filter((card) => card.role === anchor.role);
  // A hitter's replacement is judged by the slot he actually fills, not by
  // everything printed on his card: the 1B/LF-RF man playing left is replaced
  // by someone who can play left. A bat the lineup never seated has no slot to
  // measure against, so he falls back to his own printed positions.
  const slot = lineupSlotOf(save, anchor);
  if (!slot) return spares.filter((card) => positionsOverlap(card, anchor));
  return spares.filter((card) => canPlayerFillLineupSlot(card, slot));
}

function benchLabel(save, anchor, filter) {
  if (filter === "all") return `ALL SPARE ${anchor.kind === "pitcher" ? "ARMS" : "BATS"}`;
  if (anchor.kind === "pitcher") return `SPARE ${anchor.role} ONLY`;
  const slot = lineupSlotOf(save, anchor) ?? anchor.position;
  // Every bat can DH, and any glove covers first — say so rather than promise
  // a filter that isn't filtering.
  if (slot === "DH" || slot === "1B") return `ANY BAT CAN ${slot === "DH" ? "DH" : "PLAY 1B"}`;
  return `SPARE ${slot} ONLY`;
}

// The replacement picker's rows: the bench candidates plus the incumbent
// himself, everyone sorted into point order so he reads at his true rank.
function pickRowsFor(save, anchor, filter) {
  if (!anchor) return [];
  return [...benchCards(save, anchor, filter), anchor]
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

// The previewed card's season line, shown under the card panel on the Team
// screen — how the man is actually hitting, not just what he's rated.
function seasonStatsHtml(save, card) {
  if (!card) return "";
  const isArm = card.kind === "pitcher";
  const line = (isArm ? seasonPitchers(save) : seasonHitters(save)).find((item) => item.id === card.id);
  if (!line) return "";
  const body = isArm
    ? `${ipText(line.outs)} IP &middot; ${line.runsPerNine.toFixed(2)} RA9 &middot; ${line.so} K &middot; ${line.games}G`
    : `${rateText(line.avg)} &middot; ${rateText(line.ops)} OPS &middot; ${line.hr}HR ${line.rbi}RBI ${line.sb}SB &middot; ${line.games}G`;
  return `<div class="gq-frame"><p class="gq-dim">THIS SEASON ${wpaHtml(line.wpa)}</p><p>${body}</p></div>`;
}

// The roster card's action menu: swap him out, jump to the batting order,
// sell a spare copy, star him — all on Z/X/arrows.
function teamCardActions(app, card) {
  if (!card) return [{ label: "CANCEL", run: () => {} }];
  const save = app.save;
  const slot = lineupSlotOf(save, card);
  const actions = [
    {
      label: save.activeSeries ? `SWAP THIS CARD <span class="gq-dim">SERIES IN PROGRESS</span>` : "SWAP THIS CARD",
      disabled: Boolean(save.activeSeries),
      run: () => {
        // "Position" means the slot he actually fills — so the DH opens on
        // every spare bat, and the LF/RF man playing left opens on the
        // corner outfielders. benchCards does the reading.
        app.screen.mode = "pick";
        app.screen.pickFilter = "position";
        const opened = pickRowsFor(save, card, "position");
        app.screen.pickIndex = Math.max(0, opened.findIndex((row) => row.id === card.id));
      }
    }
  ];
  if (card.kind === "hitter") {
    const switches = positionSwitchOptions(save, card);
    actions.push({
      label: switches.length
        ? `SWITCH POSITION <span class="gq-dim">NOW AT ${escapeHtml(slot ?? "&mdash;")}</span>`
        : `SWITCH POSITION <span class="gq-dim">NO LEGAL SWITCH</span>`,
      disabled: !switches.length,
      run: () => {
        app.screen.mode = "switchPos";
        app.screen.pickIndex = 0;
      }
    });
    actions.push({ label: "BATTING ORDER", run: () => app.go("lineup", { returnTo: "team", index: 0 }) });
  }
  // The same move, asked of an arm: which game does he take?
  if (card.role === "SP") {
    const starts = rotationSwitchOptions(save, card);
    const now = rotationSlotOf(save, card);
    actions.push({
      label: starts.length
        ? `CHANGE ROTATION SLOT <span class="gq-dim">NOW ${escapeHtml(now ?? "&mdash;")}</span>`
        : `CHANGE ROTATION SLOT <span class="gq-dim">NO SECOND STARTER</span>`,
      disabled: !starts.length,
      run: () => {
        app.screen.mode = "switchPos";
        app.screen.pickIndex = 0;
      }
    });
  }
  const sell = sellAction(app, card);
  if (sell) actions.push(sell);
  actions.push(starAction(app, card), { label: "CANCEL", run: () => {} });
  return actions;
}

export const teamScreen = {
  render(app) {
    const save = app.save;
    const page = TEAM_PAGES.includes(app.screen.page) ? app.screen.page : "bats";
    const roster = teamPageCards(save, page);
    const actions = teamActions(save);
    const issues = validateRoster(managerFor(save));
    const points = rosterPoints(save);
    const cap = pointCap(save);
    if (points > cap) issues.push(`over cap by ${points - cap}`);
    const picking = app.screen.mode === "pick";
    const switching = app.screen.mode === "switchPos";
    const rosterIndex = clampIndex(app.screen.index ?? 0, roster.length + actions.length);
    const filter = app.screen.pickFilter ?? "position";
    const anchor = roster[rosterIndex] ?? null;
    const switches = switching ? slotSwitchOptions(save, anchor) : [];
    // The pick list holds the man being replaced too, diamond-marked like
    // the binder and sorted into his rightful spot by points — picking him
    // keeps him.
    const pickRows = picking ? pickRowsFor(save, anchor, filter) : [];
    const pickIndex = clampIndex(app.screen.pickIndex ?? 0, (picking ? pickRows.length : switches.length) + 1);
    const preview = picking
      ? pickRows[pickIndex] ?? null
      : switching
        ? switches[pickIndex]?.player ?? anchor
        : rosterIndex < roster.length
          ? roster[rosterIndex]
          : actions[rosterIndex - roster.length]?.preview ?? null;
    // A man in the lineup is listed by the position he is PLAYING, not by
    // everything he could play — the roster is a lineup card, and a lineup card
    // names one spot per man. (Bats the lineup couldn't seat keep their printed
    // eligibility, since there is no spot to name.)
    const slotById = new Map(
      lineupSlots(save).filter((slot) => slot.player).map((slot) => [slot.player.id, slot.label])
    );
    let list;
    if (app.screen.actionMenu && rosterIndex < roster.length) {
      list = actionMenuHtml(actionMenuTitle(app, roster[rosterIndex]), menuActions(app, roster[rosterIndex], teamCardActions), app.screen.actionIndex);
    } else if (picking) {
      const anchorId = anchor?.id;
      list = `<h3>${benchLabel(save, anchor, filter)}</h3>${menuHtml(
        [
          ...pickRows.map((card) => ({ html: `${cardLine(card)}${card.id === anchorId ? " &#9670;" : ""}` })),
          { label: "CANCEL" }
        ],
        pickIndex
      )}`;
    } else if (switching) {
      list = `<h3>${escapeHtml(shortName(anchor?.name ?? ""))} ${anchor?.kind === "pitcher" ? "STARTS" : "PLAYS"}&hellip;</h3>${menuHtml(
        [...switches.map((option) => ({ html: switchLine(option) })), { label: "CANCEL" }],
        pickIndex
      )}`;
    } else {
      list = menuHtml(
        [
          ...roster.map((card) => ({ html: cardLine(card, { slot: slotById.get(card.id) ?? null }) })),
          ...actions.map((action) => ({ html: action.html, disabled: action.disabled }))
        ],
        rosterIndex
      );
    }
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>TEAM &middot; ${escapeHtml(save.player.name)}</span><span>${teamPageLabel(page, roster.length)}</span><span>${Number.isFinite(cap) ? `${points}/${cap} PT` : `${points} PT &middot; UNCAPPED`}</span></div>
      <div class="gq-body"><div class="gq-columns">
        <div class="gq-frame gq-scroll">${list}</div>
        <div class="gq-card-side">${preview ? cardPanelHtml(preview, { count: ownedCount(save, preview.id) || null }) + seasonStatsHtml(save, preview) : `<p class="gq-dim">NO SWAP AVAILABLE.</p>`}</div>
      </div></div>
      <div class="gq-textbox">
        ${issues.length ? `<p>! ${escapeHtml(issues.join(", "))}</p>` : `<p>ROSTER IS GAME-READY.</p>`}
        <p class="gq-dim">${
          picking
            ? "Pick a replacement. &#9664;/&#9654; position only &middot; everyone. X cancels."
            : switching
              ? "Z gives him the spot; the man who had it takes his. X cancels."
              : save.activeSeries
                ? `SERIES IN PROGRESS — swaps wait until it ends. &#9664;/&#9654; ${page === "arms" ? "the bats" : "the arms"}.`
                : `Z opens a card's actions &middot; &#9664;/&#9654; ${page === "arms" ? "THE BATS" : "THE ARMS"}. X to leave.`
        }</p>
      </div>
    </div>`;
  },
  hoverCard(app, index) {
    const roster = teamPageCards(app.save, TEAM_PAGES.includes(app.screen.page) ? app.screen.page : "bats");
    if (app.screen.mode === "pick") {
      const anchor = roster[clampIndex(app.screen.index ?? 0, roster.length)];
      if (!anchor) return null;
      return pickRowsFor(app.save, anchor, app.screen.pickFilter ?? "position")[index] ?? null;
    }
    if (app.screen.mode === "switchPos") {
      const anchor = roster[clampIndex(app.screen.index ?? 0, roster.length)];
      return slotSwitchOptions(app.save, anchor)[index]?.player ?? anchor ?? null;
    }
    if (index < roster.length) return roster[index] ?? null;
    return teamActions(app.save)[index - roster.length]?.preview ?? null;
  },
  key(app, key) {
    const save = app.save;
    const page = TEAM_PAGES.includes(app.screen.page) ? app.screen.page : "bats";
    const roster = teamPageCards(save, page);
    const actions = teamActions(save);
    if (app.screen.actionMenu) {
      const card = roster[clampIndex(app.screen.index ?? 0, roster.length + actions.length)] ?? null;
      actionMenuKey(app, key, menuActions(app, card, teamCardActions));
      app.rerender();
      return;
    }
    if (app.screen.mode === "pick") {
      const anchor = roster[clampIndex(app.screen.index ?? 0, roster.length)];
      const rows = pickRowsFor(save, anchor, app.screen.pickFilter ?? "position");
      const total = rows.length + 1;
      if (key === "left" || key === "right") {
        app.screen.pickFilter = (app.screen.pickFilter ?? "position") === "position" ? "all" : "position";
        const widened = pickRowsFor(save, anchor, app.screen.pickFilter);
        app.screen.pickIndex = Math.max(0, widened.findIndex((card) => card.id === anchor.id));
      } else if (key === "up" || key === "down") {
        app.screen.pickIndex = clampIndex((app.screen.pickIndex ?? 0) + (key === "down" ? 1 : -1), total);
      } else if (key === "a") {
        const pick = rows[app.screen.pickIndex ?? 0];
        // Picking the incumbent (or CANCEL) keeps him; anyone else swaps in.
        if (pick && pick.id !== anchor.id) {
          const cardIds = save.roster.cardIds.map((id) => (id === anchor.id ? pick.id : id));
          setRoster(save, cardIds);
          persistSave(save);
        }
        app.screen.mode = "roster";
      } else if (key === "b") {
        app.screen.mode = "roster";
      }
    } else if (app.screen.mode === "switchPos") {
      const anchor = roster[clampIndex(app.screen.index ?? 0, roster.length)];
      const switches = slotSwitchOptions(save, anchor);
      if (key === "up" || key === "down") {
        app.screen.pickIndex = clampIndex((app.screen.pickIndex ?? 0) + (key === "down" ? 1 : -1), switches.length + 1);
      } else if (key === "a") {
        const option = switches[app.screen.pickIndex ?? 0];
        if (option && switchSlotTo(save, anchor, option.label)) {
          addLog(save, option.player
            ? `${anchor.name} takes ${option.label}; ${option.player.name} moves to ${option.from}.`
            : `${anchor.name} takes ${option.label}.`);
          persistSave(save);
        }
        app.screen.mode = "roster";
      } else if (key === "b") {
        app.screen.mode = "roster";
      }
    } else if (key === "left" || key === "right") {
      // Turn the page: the bats on one side, the arms on the other. The cursor
      // starts at the top of the page you land on — carrying an index across
      // would drop you on the fourth arm because you were on the fourth bat.
      app.screen.page = page === "arms" ? "bats" : "arms";
      app.screen.index = 0;
    } else if (key === "up" || key === "down") {
      app.screen.index = clampIndex((app.screen.index ?? 0) + (key === "down" ? 1 : -1), roster.length + actions.length);
    } else if (key === "a") {
      const index = clampIndex(app.screen.index ?? 0, roster.length + actions.length);
      if (index < roster.length) {
        // The card's actions live in one menu: swap, batting order, sell,
        // star. Mid-series the swap entry is disabled, not the whole menu.
        openActionMenu(app);
      } else {
        const action = actions[index - roster.length];
        if (action && !action.disabled) action.run(app);
      }
    } else if (key === "b") {
      app.go("map");
    }
    app.rerender();
  }
};

// ---- Batting order ----------------------------------------------------------

function currentLineup(save) {
  return buildTeam(managerFor(save)).lineup;
}

// Grab-and-carry reordering: Z picks a hitter up, arrows carry him through
// the order, Z sets him down. The order persists as the default for every
// future game; screens pass returnTo to come back where they were.
export const lineupScreen = {
  render(app) {
    const save = app.save;
    const lineup = currentLineup(save);
    const index = clampIndex(app.screen.index ?? 0, lineup.length);
    const selected = lineup[index];
    const grabbed = Boolean(app.screen.grabbed);
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>BATTING ORDER</span><span>${escapeHtml(save.player.name)}</span></div>
      <div class="gq-body"><div class="gq-columns">
        <div class="gq-frame gq-scroll">${menuHtml(
          lineup.map((player, spot) => ({
            html: `${spot + 1}. ${escapeHtml(player.assignedPosition ?? player.position)} ${escapeHtml(player.name.toUpperCase())}${
              grabbed && spot === index ? " &#9995;" : ""
            } <span class="gq-dim">OB${player.onBase} SPD${player.speed}</span>`
          })),
          index
        )}</div>
        <div class="gq-card-side">${selected ? cardPanelHtml(selected) : ""}</div>
      </div></div>
      <div class="gq-textbox"><p class="gq-dim">${
        grabbed ? "Carry him with the arrows. Z sets him down." : "Z grabs a hitter to move him. X to leave."
      }</p></div>
    </div>`;
  },
  hoverCard(app, index) {
    return currentLineup(app.save)[index] ?? null;
  },
  key(app, key) {
    const save = app.save;
    const lineup = currentLineup(save);
    if (key === "up" || key === "down") {
      const delta = key === "down" ? 1 : -1;
      if (app.screen.grabbed) {
        const order = lineup.map((player) => player.id);
        const from = clampIndex(app.screen.index ?? 0, order.length);
        const to = clampIndex(from + delta, order.length);
        [order[from], order[to]] = [order[to], order[from]];
        setBattingOrder(save, order);
        app.screen.index = to;
      } else {
        app.screen.index = clampIndex((app.screen.index ?? 0) + delta, lineup.length);
      }
    } else if (key === "a") {
      if (app.screen.grabbed) {
        app.screen.grabbed = false;
        persistSave(save);
      } else {
        app.screen.grabbed = true;
      }
    } else if (key === "b") {
      if (app.screen.grabbed) {
        app.screen.grabbed = false;
        persistSave(save);
      } else {
        persistSave(save);
        app.go(app.screen.returnTo ?? "map", app.screen.returnData ?? {});
      }
    }
    app.rerender();
  }
};

// ---- Pack opening ----------------------------------------------------------

// Reveals walk forward with Z; the left arrow rewinds to reread earlier pulls
// (right walks back up). A new card only rips once the view is at the front.
// ---- Legends -----------------------------------------------------------------
//
// A legend does not just turn over. The pack catches the light first — a beat
// where the screen knows what is coming and you don't yet — and then he lands,
// full width, with the rays behind him and his name called out. It is the one
// moment in the game worth stopping for, and it should feel like it is being
// taken away from you if you blink.
//
// Only on the way OUT of the pack: leafing back through the pulls with the arrow
// keys shows the card plainly. The event is the pull, not the card.
const LEGEND_CURTAIN_MS = 1400;

function isLegend(card) {
  return card?.rarity === "legend";
}

// Turning the pack over: forward through the pulls, then out. The one thing the
// pack screen did, and now the first item on its menu.
function advancePack(app, cards) {
  const save = app.save;
  const revealed = app.screen.revealed ?? 0;
  const viewing = Math.min(app.screen.viewing ?? revealed, revealed);
  // The cursor goes home to NEXT CARD on every new face: the next thing you want
  // to do with the next card is almost always look at the one after it.
  app.screen.menuIndex = 0;
  if (viewing < revealed) {
    app.screen.viewing = viewing + 1;
    return;
  }
  if (revealed < cards.length) {
    const pulled = cards[revealed];
    addCardToCollection(save, pulled.id);
    app.screen.revealed = revealed + 1;
    app.screen.viewing = revealed + 1;
    // He is yours already. He is just not on the screen yet.
    if (isLegend(pulled)) app.screen.curtain = (app.screen.curtain ?? 0) + revealed + 1;
    persistSave(save);
    return;
  }
  save.pendingPacks.shift();
  persistSave(save);
  if (save.pendingPacks.length) {
    app.screen.revealed = 0;
    app.screen.viewing = 0;
  } else {
    app.go(app.screen.returnTo ?? "map");
  }
}

// What you can do with the man you just pulled, without leaving the pack.
//
// He is already yours — the card went into the collection the moment it was
// turned over — so this is not a claim. It is the two things you were going to
// walk to another screen to do anyway: sell the duplicate you did not want, and
// put the star you did want straight into the lineup. NEXT CARD leads, and is
// where the cursor sits, because ripping the pack is what you came here for.
function packActions(app, card, cards) {
  const save = app.save;
  const revealed = app.screen.revealed ?? 0;
  const viewing = Math.min(app.screen.viewing ?? revealed, revealed);
  const rewound = viewing < revealed;
  const actions = [{
    label: rewound ? "FORWARD" : revealed < cards.length ? "NEXT CARD" : "DONE",
    run: () => advancePack(app, cards)
  }];
  if (!card) return actions;

  const owned = ownedCount(save, card.id);
  const locked = pairRosterLocked(save, card);
  const value = sellValueOf(save, card);
  const sold = owned <= 0;
  actions.push({
    label: sold ? `SELL <span class="gq-dim">SOLD</span>`
      : locked ? `SELL <span class="gq-dim">ROSTER COPY &mdash; NOT FOR SALE</span>`
      : `SELL <span class="gq-dim">&#8594; $${value}</span>`,
    disabled: sold || locked,
    // Never on one keypress. The shop asks; so does the pack.
    run: () => {
      app.screen.confirmSell = card.id;
      app.screen.menuIndex = 0;
    }
  });

  const rostered = save.roster.cardIds.includes(card.id);
  const targets = swapTargets(save, card);
  const blocked = sold ? "SOLD"
    : rostered ? "ALREADY ON THE TEAM"
    : save.activeSeries ? "SERIES IN PROGRESS"
    : targets.length === 0 ? "NO LEGAL SPOT"
    : null;
  actions.push({
    label: blocked ? `ADD TO TEAM <span class="gq-dim">${blocked}</span>` : "ADD TO TEAM &#8594; PICK WHO SITS",
    disabled: Boolean(blocked),
    run: () => {
      app.screen.mode = "team-swap";
      // Opens on the man he is here to replace, the way the binder does it.
      app.screen.pickIndex = defaultSwapIndex(save, card, targets);
    }
  });
  return actions;
}

// Sell, but say it out loud first. Either way the cursor goes home to NEXT CARD
// afterwards — the question is answered, and the pack is still half unopened.
function packSellActions(app, card) {
  const value = sellValueOf(app.save, card);
  return [
    {
      label: `YES &mdash; SELL FOR $${value}`,
      run: () => {
        app.screen.confirmSell = null;
        app.screen.menuIndex = 0;
        if (removeCardFromCollection(app.save, card.id)) {
          grantCoins(app.save, value);
          addLog(app.save, `Sold ${card.name} (+${value} coins).`);
          persistSave(app.save);
        }
      }
    },
    {
      label: "NO &mdash; KEEP HIM",
      run: () => {
        app.screen.confirmSell = null;
        app.screen.menuIndex = 0;
      }
    }
  ];
}

// Everything under the card: the sealed pack's one instruction before the first
// pull, then the menu, then the who-sits question if you asked it.
function packFooter(app, card, cards) {
  const save = app.save;
  const revealed = app.screen.revealed ?? 0;
  // Nothing has been turned over yet. There is only one thing to do.
  if (revealed === 0) return `<p class="gq-blink">Z — RIP IT OPEN</p>`;

  if (app.screen.mode === "team-swap" && card) {
    const targets = swapTargets(save, card);
    const pickIndex = clampIndex(app.screen.pickIndex ?? 0, targets.length + 1);
    return `<h3>WHO SITS FOR ${escapeHtml(shortName(card.name))}?</h3>${menuHtml(
      [
        ...targets.map((target) => ({
          html: `<span class="gq-swap-spot">${escapeHtml(currentSpot(save, target))}</span>${escapeHtml(shortName(target.name))}`
        })),
        { label: "CANCEL" }
      ],
      pickIndex
    )}<p class="gq-dim">Z benches him for your card. X cancels.</p>`;
  }

  const items = card && app.screen.confirmSell === card.id
    ? packSellActions(app, card)
    : packActions(app, card, cards);
  const index = clampIndex(app.screen.menuIndex ?? 0, items.length);
  // The labels carry their own dim tails ("SELL -> $300"), and menuHtml escapes
  // a plain label — so hand it markup, the way the action menus do.
  const rows = items.map((item) => ({ html: item.label, disabled: item.disabled }));
  return `${menuHtml(rows, index)}<p class="gq-dim">${
    app.screen.confirmSell ? "Z answers. X keeps him."
      : `Z picks &middot; &#9650;/&#9660; moves${revealed > 1 ? " &middot; &#9664;/&#9654; looks back through the pulls" : ""}`
  }</p>`;
}

export const packOpenScreen = {
  render(app) {
    const save = app.save;
    const pending = save.pendingPacks[0];
    if (!pending) return `<div class="gq-screen"><div class="gq-body gq-center"><p>NO PACKS TO OPEN.</p></div></div>`;
    const cards = openPack(pending.packId, pending.seed);
    const revealed = app.screen.revealed ?? 0;
    const viewing = Math.min(app.screen.viewing ?? revealed, revealed);
    const current = viewing > 0 ? cards[viewing - 1] : null;
    const rewound = viewing < revealed;
    // The curtain: he has been pulled, but he has not been shown.
    const curtain = Boolean(app.screen.curtain) && !rewound;
    const landed = isLegend(current) && !rewound && !curtain;
    // A menu is standing under the card, and it needs the room to stand in: the
    // card gives some back rather than pushing the last row off the bottom.
    const menued = revealed > 0 && !curtain;
    return `<div class="gq-screen${landed ? " gq-legend-screen" : ""}${menued ? " gq-pack-menued" : ""}">
      <div class="gq-topbar"><span>${escapeHtml(PACKS[pending.packId].name.toUpperCase())}</span><span>${revealed}/${cards.length}</span></div>
      <div class="gq-pack-stage">
        ${curtain
          ? `<div class="gq-legend-curtain">
              <span class="gq-legend-rays"></span>
              <p class="gq-legend-bang gq-blink">&#9733;</p>
              <p class="gq-pack-count"><b>SOMETHING IN THERE IS GLOWING&hellip;</b></p>
            </div>`
          : `${revealed === 0 ? `<p class="gq-pack-count">&#9993; RIP IT OPEN!</p>` : rewound ? `<p class="gq-pack-count"><span class="gq-dim">CARD ${viewing} OF ${revealed}</span></p>` : ""}
            ${current ? `<div class="gq-pack-reveal${landed ? " gq-legend-reveal" : ""}">${
              landed ? `<span class="gq-legend-rays"></span>` : ""
            }${cardPanelHtml(current, { count: ownedCount(save, current.id) })}</div>` : ""}`}
      </div>
      <div class="gq-textbox">
        ${landed
          ? `<p class="gq-legend-call"><b>&#9733; LEGEND &#9733;</b> ${escapeHtml(current.name.toUpperCase())}</p>`
          : ""}
        ${revealed === cards.length && !rewound && !curtain
          ? packEggs(cards, (id) => ownedCount(save, id)).map((egg) => `<p><b>${egg}</b></p>`).join("")
          : ""}
        ${curtain ? `<p class="gq-blink">&#9733; &#9733; &#9733;</p>` : packFooter(app, current, cards)}
      </div>
    </div>`;
  },
  // The curtain drops on its own. Nothing the player can press hurries it, and
  // nothing it does can be pressed through — the whole point is the wait.
  mounted(app) {
    if (!app.screen.curtain || app.screen.curtainRunning === app.screen.curtain) return;
    app.screen.curtainRunning = app.screen.curtain;
    setTimeout(() => {
      if (app.screen.curtain !== app.screen.curtainRunning) return;
      app.screen.curtain = null;
      // The noise lands with the card, not with the pull: the curtain spends a
      // second promising a legend, and this is the payoff. It fires HERE, on the
      // one frame the man appears, and so it fires once — paging back through the
      // pack to look at him again is looking, not pulling.
      playLegend();
      app.rerender();
    }, LEGEND_CURTAIN_MS);
  },
  key(app, key) {
    const save = app.save;
    const pending = save.pendingPacks[0];
    if (!pending) {
      if (key === "a" || key === "b") app.go(app.screen.returnTo ?? "map");
      app.rerender();
      return;
    }
    const cards = openPack(pending.packId, pending.seed);
    const revealed = app.screen.revealed ?? 0;
    const viewing = Math.min(app.screen.viewing ?? revealed, revealed);
    const current = viewing > 0 ? cards[viewing - 1] : null;
    // While the pack is glowing, the room waits.
    if (app.screen.curtain) return;

    // A sealed pack has no menu. Z opens it.
    if (revealed === 0) {
      if (key === "a" || key === "b") advancePack(app, cards);
      app.rerender();
      return;
    }

    // Who sits for the man you just pulled.
    if (app.screen.mode === "team-swap" && current) {
      const targets = swapTargets(save, current);
      if (key === "up" || key === "down") {
        app.screen.pickIndex = clampIndex((app.screen.pickIndex ?? 0) + (key === "down" ? 1 : -1), targets.length + 1);
      } else if (key === "a") {
        const target = targets[clampIndex(app.screen.pickIndex ?? 0, targets.length + 1)];
        if (target) {
          setRoster(save, save.roster.cardIds.map((id) => (id === target.id ? current.id : id)));
          addLog(save, `${current.name} takes ${target.name}'s roster spot.`);
          persistSave(save);
        }
        app.screen.mode = null;
        // Done with him. The cursor goes home to NEXT CARD rather than resting on
        // an ADD TO TEAM that now reads ALREADY ON THE TEAM — a finished job is
        // not what you want your thumb sitting on.
        app.screen.menuIndex = 0;
      } else if (key === "b") {
        app.screen.mode = null;
        app.screen.menuIndex = 0;
      }
      app.rerender();
      return;
    }

    const items = current && app.screen.confirmSell === current.id
      ? packSellActions(app, current)
      : packActions(app, current, cards);

    if (key === "up" || key === "down") {
      app.screen.menuIndex = clampIndex((app.screen.menuIndex ?? 0) + (key === "down" ? 1 : -1), items.length);
    } else if (key === "left") {
      if (viewing > 1) {
        app.screen.viewing = viewing - 1;
        app.screen.menuIndex = 0;
      }
    } else if (key === "right") {
      if (viewing < revealed) {
        app.screen.viewing = viewing + 1;
        app.screen.menuIndex = 0;
      }
    } else if (key === "a") {
      const item = items[clampIndex(app.screen.menuIndex ?? 0, items.length)];
      if (item && !item.disabled) item.run();
    } else if (key === "b") {
      // X backs out of the question, and otherwise does what it always did on
      // this screen: turns the card over.
      if (app.screen.confirmSell) app.screen.confirmSell = null;
      else advancePack(app, cards);
    } else {
      return;
    }
    app.rerender();
  }
};
