import { escapeHtml, menuHtml, clampIndex, cardPanelHtml, cardLine, rarityTag, shortName } from "./helpers.js";
import { PACKS, RARITIES, openPack, shopStock, cardById, adventurePool } from "../packs.js";
import { packEggs } from "../feats.js";
import {
  persistSave,
  deriveSeed,
  spendCoins,
  grantCoins,
  addCardToCollection,
  removeCardFromCollection,
  collectionCards,
  ownedCount,
  rosterCards,
  rosterPoints,
  pointCap,
  setRoster,
  setBattingOrder,
  managerFor,
  addLog
} from "../state.js";
import { validateRoster, buildTeam, assignLineupSlots, canPlayerFillLineupSlot } from "../../rules/draft.js";

// ---- Shop ------------------------------------------------------------------

function shopItems(app) {
  const save = app.save;
  const stock = shopStock(save.saveSeed, "cedar-yards", save.progress.counters.battlesWon);
  const items = [];
  const pack = PACKS.booster;
  items.push({
    html: `${escapeHtml(pack.name.toUpperCase())} <span class="gq-dim">&#9679; ${pack.price}</span>`,
    disabled: save.player.coins < pack.price,
    run: (a) => buyPack(a, pack)
  });
  for (const card of stock) {
    const price = RARITIES[card.rarity].singlePrice;
    items.push({
      html: `${cardLine(card)} <span class="gq-dim">&#9679; ${price}</span>`,
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

function searchLine(query) {
  return query
    ? `<p>SEARCH: <b>${escapeHtml(query)}</b>_ <span class="gq-dim">X CLEARS</span></p>`
    : "";
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
        <div>${a ? cardPanelHtml(a, { count: owned(a) }) : ""}</div>
        <div>${b ? cardPanelHtml(b, { count: owned(b) }) : ""}</div>
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
  const cards = filter === "ALL"
    ? pool
    : filter === "SP" || filter === "RP"
      ? pool.filter((card) => card.role === filter)
      : pool.filter((card) => card.kind === "hitter" && card.position === filter);
  const rows = [...cards].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  catalogCache = { pool, filter, rows };
  return rows;
}

function catalogVisibleRows(app) {
  return applyQuery(catalogRows(app.screen.filter ?? "ALL"), app.screen.query, (card) => card.name);
}

export const catalogScreen = {
  render(app) {
    const filter = app.screen.filter ?? "ALL";
    const rows = catalogVisibleRows(app);
    const index = clampIndex(app.screen.index ?? 0, rows.length);
    const start = Math.max(0, Math.min(index - Math.floor(CATALOG_WINDOW / 2), rows.length - CATALOG_WINDOW));
    const visible = rows.slice(start, start + CATALOG_WINDOW);
    const selected = rows[index];
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>CARD CATALOG &middot; ${escapeHtml(filter)}</span><span>${rows.length ? index + 1 : 0}/${rows.length}</span></div>
      <div class="gq-body"><div class="gq-columns">
        <div class="gq-frame gq-scroll">${
          rows.length
            ? menuHtml(
                visible.map((card) => {
                  const owned = ownedCount(app.save, card.id);
                  return { html: `${cardLine(card)}${owned ? ` <span class="gq-dim">&#9670;x${owned}</span>` : ""}${pinMark(app, card)}` };
                }),
                index - start,
                { offset: start }
              )
            : `<p class="gq-dim">NO CARD ANSWERS TO "${escapeHtml(app.screen.query ?? "")}".</p>`
        }</div>
        <div>${selected ? cardPanelHtml(selected, { count: ownedCount(app.save, selected.id) || null }) : ""}</div>
      </div></div>
      <div class="gq-textbox">${pinnedLine(app)}${searchLine(app.screen.query)}<p class="gq-dim">Every card in this league, best first. Type a name to search &middot; &#9664;/&#9654; page by position &middot; &#9670; = owned &middot; Z pins to compare. X to leave.</p></div>
    </div>`;
  },
  hoverCard(app, index) {
    return catalogVisibleRows(app)[index] ?? null;
  },
  typed: typeIntoQuery,
  key(app, key) {
    const rows = catalogVisibleRows(app);
    if (key === "left" || key === "right") {
      const at = BINDER_FILTERS.indexOf(app.screen.filter ?? "ALL");
      app.screen.filter = BINDER_FILTERS[(at + (key === "right" ? 1 : -1) + BINDER_FILTERS.length) % BINDER_FILTERS.length];
      app.screen.index = 0;
    } else if (key === "up" || key === "down") {
      app.screen.index = clampIndex((app.screen.index ?? 0) + (key === "down" ? 1 : -1), rows.length);
    } else if (key === "a") {
      pinOrCompare(app, rows[clampIndex(app.screen.index ?? 0, rows.length)], "catalog");
    } else if (key === "b") {
      if (app.screen.query) {
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
      <div class="gq-topbar"><span>CEDAR YARDS CARD SHOP</span><span>&#9679; ${app.save.player.coins}</span></div>
      <div class="gq-body">
        <div class="gq-frame">${menuHtml(
          items.map((item) => ({ label: item.label, html: item.html, disabled: item.disabled })),
          app.screen.menuIndex ?? 0
        )}</div>
        ${selected?.card ? cardPanelHtml(selected.card, { count: ownedCount(app.save, selected.card.id) || null }) : ""}
      </div>
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
    .map(({ card, count }) => {
      const locked = save.roster.cardIds.includes(card.id) ? 1 : 0;
      return { card, count: count - locked, locked: locked > 0 };
    })
    .filter(({ count }) => count > 0);
}

// Everything past the first copy of each card (roster copies always kept).
// Returns coins earned. Exported for tests.
export function sellAllDuplicates(save) {
  let coins = 0;
  for (const { card, count } of collectionCards(save)) {
    const keep = 1;
    for (let extra = count; extra > keep; extra -= 1) {
      if (!removeCardFromCollection(save, card.id)) break;
      coins += RARITIES[card.rarity].sellValue;
    }
  }
  grantCoins(save, coins);
  return coins;
}

// The nuclear option: every sellable copy goes — non-roster cards to zero,
// rostered cards down to their roster copy. Returns coins earned. Exported
// for tests.
export function sellAllCards(save) {
  let coins = 0;
  for (const { card, count } of sellableCards(save)) {
    for (let copy = 0; copy < count; copy += 1) {
      if (!removeCardFromCollection(save, card.id)) break;
      coins += RARITIES[card.rarity].sellValue;
    }
  }
  grantCoins(save, coins);
  return coins;
}

// Menu-label hauls: duplicates keep one of each card, sell-all keeps only
// roster copies.
function duplicateHaul(save) {
  return sellableCards(save).reduce(
    (coins, { card, count, locked }) => coins + RARITIES[card.rarity].sellValue * (locked ? count : count - 1),
    0
  );
}

function fullHaul(save) {
  return sellableCards(save).reduce(
    (coins, { card, count }) => coins + RARITIES[card.rarity].sellValue * count,
    0
  );
}

export const sellScreen = {
  render(app) {
    const rows = sellableCards(app.save);
    const index = clampIndex(app.screen.index ?? 0, rows.length + (rows.length ? 2 : 0) + 1);
    const selected = rows[index]?.card ?? null;
    const confirming = Boolean(app.screen.confirmSellAll);
    const items = [
      ...rows.map(({ card, count, locked }) => ({
        html: `${cardLine(card)} <span class="gq-dim">x${count}${locked ? " SPARE" : ""} &#8594; &#9679; ${RARITIES[card.rarity].sellValue}</span>`
      })),
      ...(rows.length
        ? [
            { html: `SELL ALL DUPLICATES <span class="gq-dim">&#8594; &#9679; ${duplicateHaul(app.save)}</span>` },
            { html: `SELL ALL CARDS <span class="gq-dim">&#8594; &#9679; ${fullHaul(app.save)}</span>` }
          ]
        : []),
      { label: "DONE SELLING" }
    ];
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>SELL TO THE SHOP</span><span>&#9679; ${app.save.player.coins}</span></div>
      <div class="gq-body"><div class="gq-columns">
        <div class="gq-frame gq-scroll">${
          rows.length ? "" : `<p class="gq-dim">NOTHING SPARE TO SELL.</p>`
        }${menuHtml(items, index)}</div>
        <div>${selected ? cardPanelHtml(selected, { count: ownedCount(app.save, selected.id) }) : ""}</div>
      </div></div>
      <div class="gq-textbox">${
        confirming
          ? `<p class="gq-blink"><b>SELL THE WHOLE BINDER? Z again to confirm. X keeps it.</b></p>`
          : `<p>Z sells one copy. Roster cards are never for sale — only their spares list here.</p>`
      }</div>
    </div>`;
  },
  hoverCard(app, index) {
    return sellableCards(app.save)[index]?.card ?? null;
  },
  key(app, key) {
    const rows = sellableCards(app.save);
    const extras = rows.length ? 2 : 0;
    const total = rows.length + extras + 1;
    const sellAllIndex = rows.length + 1;
    const wasConfirming = Boolean(app.screen.confirmSellAll);
    if (key !== "a") app.screen.confirmSellAll = false;
    if (key === "up" || key === "down") {
      app.screen.index = clampIndex((app.screen.index ?? 0) + (key === "down" ? 1 : -1), total);
    } else if (key === "a") {
      const index = clampIndex(app.screen.index ?? 0, total);
      if (index !== sellAllIndex || !extras) app.screen.confirmSellAll = false;
      if (index < rows.length) {
        const { card } = rows[index];
        if (removeCardFromCollection(app.save, card.id)) {
          grantCoins(app.save, RARITIES[card.rarity].sellValue);
          persistSave(app.save);
        }
      } else if (extras && index === rows.length) {
        const coins = sellAllDuplicates(app.save);
        addLog(app.save, `Sold the duplicate pile (+${coins} coins).`);
        persistSave(app.save);
        app.screen.index = 0;
      } else if (extras && index === sellAllIndex) {
        // The whole binder wants a second Z: too much to lose to a slip.
        if (!app.screen.confirmSellAll) {
          app.screen.confirmSellAll = true;
        } else {
          app.screen.confirmSellAll = false;
          const coins = sellAllCards(app.save);
          addLog(app.save, `Sold the whole binder (+${coins} coins).`);
          persistSave(app.save);
          app.screen.index = 0;
        }
      } else {
        app.go("shop", { menuIndex: 0 });
      }
    } else if (key === "b") {
      // X cancels a pending sell-all confirm; otherwise it leaves the shop.
      if (!wasConfirming) app.go("shop", { menuIndex: 0 });
    }
    app.rerender();
  }
};

// ---- Binder ----------------------------------------------------------------

// The binder pages by slot: left/right walks ALL -> each position -> the two
// pitching roles. Exported for tests.
export const BINDER_FILTERS = ["ALL", "C", "1B", "2B", "3B", "SS", "LF/RF", "CF", "DH", "SP", "RP"];

export function binderRows(save, filter = "ALL") {
  const rows = collectionCards(save);
  if (!filter || filter === "ALL") return rows;
  if (filter === "SP" || filter === "RP") return rows.filter(({ card }) => card.role === filter);
  return rows.filter(({ card }) => card.kind === "hitter" && card.position === filter);
}

function binderVisibleRows(app) {
  return applyQuery(binderRows(app.save, app.screen.filter ?? "ALL"), app.screen.query, ({ card }) => card.name);
}

export const binderScreen = {
  render(app) {
    const filter = app.screen.filter ?? "ALL";
    const rows = binderVisibleRows(app);
    const index = clampIndex(app.screen.index ?? 0, rows.length);
    const selected = rows[index];
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>BINDER &middot; ${escapeHtml(filter)}</span><span>${rows.length} CARDS &middot; ${rows.reduce((sum, row) => sum + row.count, 0)} TOTAL</span></div>
      <div class="gq-body"><div class="gq-columns">
        <div class="gq-frame gq-scroll">${
          rows.length
            ? menuHtml(
                rows.map(({ card, count }) => ({
                  html: `${cardLine(card)}${count > 1 ? ` <span class="gq-dim">x${count}</span>` : ""}${
                    app.save.roster.cardIds.includes(card.id) ? " &#9670;" : ""
                  }${pinMark(app, card)}`
                })),
                index
              )
            : `<p class="gq-dim">NO ${escapeHtml(filter)} CARDS${app.screen.query ? ` NAMED "${escapeHtml(app.screen.query)}"` : ""} YET.</p>`
        }</div>
        <div>${selected ? cardPanelHtml(selected.card, { count: selected.count }) : ""}</div>
      </div></div>
      <div class="gq-textbox">${pinnedLine(app)}${searchLine(app.screen.query)}<p class="gq-dim">Type a name to search &middot; &#9664;/&#9654; page by position &middot; &#9670; = in roster &middot; Z pins to compare. X to leave.</p></div>
    </div>`;
  },
  hoverCard(app, index) {
    return binderVisibleRows(app)[index]?.card ?? null;
  },
  typed: typeIntoQuery,
  key(app, key) {
    if (key === "left" || key === "right") {
      const at = BINDER_FILTERS.indexOf(app.screen.filter ?? "ALL");
      const next = (at + (key === "right" ? 1 : -1) + BINDER_FILTERS.length) % BINDER_FILTERS.length;
      app.screen.filter = BINDER_FILTERS[next];
      app.screen.index = 0;
    } else if (key === "up" || key === "down") {
      const rows = binderVisibleRows(app);
      app.screen.index = clampIndex((app.screen.index ?? 0) + (key === "down" ? 1 : -1), rows.length);
    } else if (key === "a") {
      const rows = binderVisibleRows(app);
      pinOrCompare(app, rows[clampIndex(app.screen.index ?? 0, rows.length)]?.card, "binder");
    } else if (key === "b") {
      if (app.screen.query) {
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
  const ids = [...save.roster.cardIds];
  const a = ids.indexOf(first.id);
  const b = ids.indexOf(second.id);
  [ids[a], ids[b]] = [ids[b], ids[a]];
  setRoster(save, ids);
  return true;
}

function lineupSlots(save) {
  return assignLineupSlots(rosterCards(save), save.roster.lineupAssignments).slots;
}

// Legal DH flips: any occupied slot the current DH could actually field.
// Anyone can DH, so the other half of the flip is always legal; 1B is open
// to every glove (at -1 out of position), the rest need the printed
// position. Exported for tests.
export function dhFlipOptions(save) {
  const slots = lineupSlots(save);
  const dh = slots.find((slot) => slot.label === "DH")?.player;
  if (!dh) return [];
  return slots
    .filter((slot) => slot.label !== "DH" && slot.player && canPlayerFillLineupSlot(dh, slot.label))
    .map((slot) => ({ label: slot.label, player: slot.player, dh }));
}

// Send the DH out to `label` and sit that slot's occupant at DH. Persists as
// slot assignments, so it holds for every future game.
export function flipDhWith(save, label) {
  const option = dhFlipOptions(save).find((item) => item.label === label);
  if (!option) return false;
  save.roster.lineupAssignments = {
    ...save.roster.lineupAssignments,
    DH: option.player.id,
    [label]: option.dh.id
  };
  return true;
}

function flipLine(option) {
  const outOfPosition = option.label === "1B" && option.dh.position !== "1B";
  return `${escapeHtml(option.label)} ${escapeHtml(shortName(option.player.name))} &#8644; DH ${escapeHtml(shortName(option.dh.name))}${
    outOfPosition ? ` <span class="gq-dim">FLD -1 OUT OF POSITION</span>` : ""
  }`;
}

// The Team menu's action rows, after the 13 cards.
function teamActions(save) {
  const rotation = rotationCards(save);
  const flips = dhFlipOptions(save);
  return [
    {
      html: rotation.length >= 2
        ? `&#8645; SWAP ROTATION <span class="gq-dim">${escapeHtml(shortName(rotation[0].name))} &#8644; ${escapeHtml(shortName(rotation[1].name))}</span>`
        : `&#8645; SWAP ROTATION <span class="gq-dim">NEEDS TWO STARTERS</span>`,
      disabled: rotation.length < 2,
      preview: rotation[0] ?? null,
      run: (a) => {
        if (!swapRotation(a.save)) return;
        const [first] = rotationCards(a.save);
        addLog(a.save, `${first.name} takes game 1.`);
        persistSave(a.save);
      }
    },
    {
      html: flips.length
        ? `&#8644; FLIP THE DH <span class="gq-dim">DH NOW: ${escapeHtml(shortName(flips[0].dh.name))}</span>`
        : `&#8644; FLIP THE DH <span class="gq-dim">NO LEGAL FLIP</span>`,
      disabled: !flips.length,
      preview: flips[0]?.dh ?? null,
      run: (a) => {
        a.screen.mode = "dhFlip";
        a.screen.pickIndex = 0;
      }
    }
  ];
}

// ---- Team (roster editing) -------------------------------------------------

// Replacement candidates for a roster card. The default view sticks to the
// outgoing card's own position (role for pitchers); "all" widens to every
// unrostered card of the same kind. Exported for tests.
export function benchCards(save, anchor, filter = "position") {
  const spares = collectionCards(save)
    .map(({ card }) => card)
    .filter((card) => card.kind === anchor.kind && !save.roster.cardIds.includes(card.id));
  if (filter === "all") return spares;
  return spares.filter((card) =>
    anchor.kind === "pitcher" ? card.role === anchor.role : card.position === anchor.position
  );
}

function benchLabel(anchor, filter) {
  const slot = anchor.kind === "pitcher" ? anchor.role : anchor.position;
  return filter === "all" ? `ALL SPARE ${anchor.kind === "pitcher" ? "ARMS" : "BATS"}` : `SPARE ${slot} ONLY`;
}

export const teamScreen = {
  render(app) {
    const save = app.save;
    const roster = rosterCards(save);
    const actions = teamActions(save);
    const issues = validateRoster(managerFor(save));
    const points = rosterPoints(save);
    const cap = pointCap(save);
    if (points > cap) issues.push(`over cap by ${points - cap}`);
    const picking = app.screen.mode === "pick";
    const flipping = app.screen.mode === "dhFlip";
    const rosterIndex = clampIndex(app.screen.index ?? 0, roster.length + actions.length);
    const filter = app.screen.pickFilter ?? "position";
    const bench = picking ? benchCards(save, roster[rosterIndex], filter) : [];
    const flips = flipping ? dhFlipOptions(save) : [];
    // The pick list leads with the man being replaced, diamond-marked like
    // the binder — picking him keeps him.
    const pickRows = picking ? [roster[rosterIndex], ...bench] : [];
    const pickIndex = clampIndex(app.screen.pickIndex ?? 0, (picking ? pickRows.length : flips.length) + 1);
    const preview = picking
      ? pickRows[pickIndex] ?? null
      : flipping
        ? flips[pickIndex]?.player ?? null
        : rosterIndex < roster.length
          ? roster[rosterIndex]
          : actions[rosterIndex - roster.length]?.preview ?? null;
    let list;
    if (picking) {
      list = `<h3>${benchLabel(roster[rosterIndex], filter)}</h3>${menuHtml(
        [
          ...pickRows.map((card, rowIndex) => ({ html: `${cardLine(card)}${rowIndex === 0 ? " &#9670;" : ""}` })),
          { label: "CANCEL" }
        ],
        pickIndex
      )}`;
    } else if (flipping) {
      list = `<h3>FLIP THE DH</h3>${menuHtml(
        [...flips.map((option) => ({ html: flipLine(option) })), { label: "CANCEL" }],
        pickIndex
      )}`;
    } else {
      list = menuHtml(
        [
          ...roster.map((card) => ({ html: cardLine(card) })),
          ...actions.map((action) => ({ html: action.html, disabled: action.disabled }))
        ],
        rosterIndex
      );
    }
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>TEAM &middot; ${escapeHtml(save.player.name)}</span><span>${Number.isFinite(cap) ? `${points}/${cap} PT` : `${points} PT &middot; UNCAPPED`}</span></div>
      <div class="gq-body"><div class="gq-columns">
        <div class="gq-frame gq-scroll">${list}</div>
        <div>${preview ? cardPanelHtml(preview, { count: ownedCount(save, preview.id) || null }) : `<p class="gq-dim">NO SWAP AVAILABLE.</p>`}</div>
      </div></div>
      <div class="gq-textbox">
        ${issues.length ? `<p>! ${escapeHtml(issues.join(", "))}</p>` : `<p>ROSTER IS GAME-READY.</p>`}
        <p class="gq-dim">${
          picking
            ? "Pick a replacement. &#9664;/&#9654; position only &middot; everyone. X cancels."
            : flipping
              ? "Z sends the DH out there; the fielder DHs instead. X cancels."
              : save.activeSeries
                ? "SERIES IN PROGRESS — the roster is locked until it ends. Rotation, DH, and batting order stay yours."
                : "Z swaps a card. Rotation and DH tools live below the roster. X to leave."
        }</p>
      </div>
    </div>`;
  },
  hoverCard(app, index) {
    const roster = rosterCards(app.save);
    if (app.screen.mode === "pick") {
      const anchor = roster[clampIndex(app.screen.index ?? 0, roster.length)];
      if (!anchor) return null;
      if (index === 0) return anchor;
      return benchCards(app.save, anchor, app.screen.pickFilter ?? "position")[index - 1] ?? null;
    }
    if (app.screen.mode === "dhFlip") {
      return dhFlipOptions(app.save)[index]?.player ?? null;
    }
    if (index < roster.length) return roster[index] ?? null;
    return teamActions(app.save)[index - roster.length]?.preview ?? null;
  },
  key(app, key) {
    const save = app.save;
    const roster = rosterCards(save);
    const actions = teamActions(save);
    if (app.screen.mode === "pick") {
      const anchor = roster[clampIndex(app.screen.index ?? 0, roster.length)];
      const bench = benchCards(save, anchor, app.screen.pickFilter ?? "position");
      // Row 0 is the incumbent himself; picking him keeps him.
      const total = bench.length + 2;
      if (key === "left" || key === "right") {
        app.screen.pickFilter = (app.screen.pickFilter ?? "position") === "position" ? "all" : "position";
        app.screen.pickIndex = 0;
      } else if (key === "up" || key === "down") {
        app.screen.pickIndex = clampIndex((app.screen.pickIndex ?? 0) + (key === "down" ? 1 : -1), total);
      } else if (key === "a") {
        const pickIndex = app.screen.pickIndex ?? 0;
        if (pickIndex > 0 && pickIndex <= bench.length) {
          const cardIds = save.roster.cardIds.map((id) => (id === anchor.id ? bench[pickIndex - 1].id : id));
          setRoster(save, cardIds);
          persistSave(save);
        }
        app.screen.mode = "roster";
      } else if (key === "b") {
        app.screen.mode = "roster";
      }
    } else if (app.screen.mode === "dhFlip") {
      const flips = dhFlipOptions(save);
      if (key === "up" || key === "down") {
        app.screen.pickIndex = clampIndex((app.screen.pickIndex ?? 0) + (key === "down" ? 1 : -1), flips.length + 1);
      } else if (key === "a") {
        const pickIndex = app.screen.pickIndex ?? 0;
        const option = flips[pickIndex];
        if (option && flipDhWith(save, option.label)) {
          addLog(save, `${option.dh.name} takes ${option.label}; ${option.player.name} DHs.`);
          persistSave(save);
        }
        app.screen.mode = "roster";
      } else if (key === "b") {
        app.screen.mode = "roster";
      }
    } else if (key === "up" || key === "down") {
      app.screen.index = clampIndex((app.screen.index ?? 0) + (key === "down" ? 1 : -1), roster.length + actions.length);
    } else if (key === "a") {
      const index = clampIndex(app.screen.index ?? 0, roster.length + actions.length);
      if (index < roster.length) {
        // No re-tooling the squad mid-series: card swaps wait until it ends.
        // Rotation, the DH flip, and batting order stay adjustable.
        if (save.activeSeries) return;
        app.screen.mode = "pick";
        app.screen.pickIndex = 0;
        app.screen.pickFilter = "position";
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
        <div>${selected ? cardPanelHtml(selected) : ""}</div>
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
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>${escapeHtml(PACKS[pending.packId].name.toUpperCase())}</span><span>${revealed}/${cards.length}</span></div>
      <div class="gq-pack-stage">
        <p class="gq-pack-count">${revealed === 0 ? "&#9993; RIP IT OPEN!" : `${rarityTag(current)}${rewound ? ` <span class="gq-dim">CARD ${viewing} OF ${revealed}</span>` : ""}`}</p>
        ${current ? `<div class="gq-pack-reveal">${cardPanelHtml(current, { count: ownedCount(save, current.id) })}</div>` : ""}
      </div>
      <div class="gq-textbox">
        ${revealed === cards.length && !rewound
          ? packEggs(cards, (id) => ownedCount(save, id)).map((egg) => `<p><b>${egg}</b></p>`).join("")
          : ""}
        ${revealed > 1 ? `<p class="gq-dim">&#9664;/&#9654; LOOK BACK THROUGH THE PULLS</p>` : ""}
        <p class="gq-blink">${rewound ? "Z — FORWARD" : revealed < cards.length ? "Z — NEXT CARD" : "Z — DONE"}</p>
      </div>
    </div>`;
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
    if (key === "left") {
      if (viewing > 1) app.screen.viewing = viewing - 1;
    } else if (key === "right") {
      if (viewing < revealed) app.screen.viewing = viewing + 1;
    } else if (key === "a" || key === "b") {
      if (viewing < revealed) {
        app.screen.viewing = viewing + 1;
      } else if (revealed < cards.length) {
        addCardToCollection(save, cards[revealed].id);
        app.screen.revealed = revealed + 1;
        app.screen.viewing = revealed + 1;
        persistSave(save);
      } else {
        save.pendingPacks.shift();
        persistSave(save);
        if (save.pendingPacks.length) {
          app.screen.revealed = 0;
          app.screen.viewing = 0;
        } else {
          app.go(app.screen.returnTo ?? "map");
        }
      }
    } else {
      return;
    }
    app.rerender();
  }
};
