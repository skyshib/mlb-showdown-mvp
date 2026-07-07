import { escapeHtml, menuHtml, clampIndex, cardPanelHtml, cardLine, rarityTag } from "./helpers.js";
import { PACKS, RARITIES, openPack, shopStock, cardById } from "../packs.js";
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
import { validateRoster, buildTeam } from "../../rules/draft.js";

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
  items.push({ label: "SELL DUPLICATES", run: (a) => a.go("sell", { index: 0 }) });
  items.push({ label: "LEAVE SHOP", run: (a) => a.go("map") });
  return items;
}

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

// ---- Sell duplicates -------------------------------------------------------

function sellableCards(save) {
  return collectionCards(save).filter(({ card, count }) => {
    const lockedForRoster = save.roster.cardIds.includes(card.id) ? 1 : 0;
    return count > lockedForRoster;
  });
}

export const sellScreen = {
  render(app) {
    const rows = sellableCards(app.save);
    const items = [
      ...rows.map(({ card, count }) => ({
        html: `${cardLine(card)} <span class="gq-dim">x${count} &#8594; &#9679; ${RARITIES[card.rarity].sellValue}</span>`
      })),
      { label: "DONE SELLING" }
    ];
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>SELL TO THE SHOP</span><span>&#9679; ${app.save.player.coins}</span></div>
      <div class="gq-body"><div class="gq-frame">${
        rows.length ? "" : `<p class="gq-dim">NOTHING SPARE TO SELL.</p>`
      }${menuHtml(items, app.screen.index ?? 0)}</div></div>
      <div class="gq-textbox"><p>Z sells one copy. Cards in your roster keep their last copy.</p></div>
    </div>`;
  },
  key(app, key) {
    const rows = sellableCards(app.save);
    const total = rows.length + 1;
    if (key === "up" || key === "down") {
      app.screen.index = clampIndex((app.screen.index ?? 0) + (key === "down" ? 1 : -1), total);
    } else if (key === "a") {
      const index = app.screen.index ?? 0;
      if (index >= rows.length) {
        app.go("shop", { menuIndex: 0 });
      } else {
        const { card } = rows[index];
        if (removeCardFromCollection(app.save, card.id)) {
          grantCoins(app.save, RARITIES[card.rarity].sellValue);
          persistSave(app.save);
        }
      }
    } else if (key === "b") {
      app.go("shop", { menuIndex: 0 });
    }
    app.rerender();
  }
};

// ---- Binder ----------------------------------------------------------------

export const binderScreen = {
  render(app) {
    const rows = collectionCards(app.save);
    const index = clampIndex(app.screen.index ?? 0, rows.length);
    const selected = rows[index];
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>BINDER</span><span>${rows.length} CARDS &middot; ${rows.reduce((sum, row) => sum + row.count, 0)} TOTAL</span></div>
      <div class="gq-body"><div class="gq-columns">
        <div class="gq-frame gq-scroll">${menuHtml(
          rows.map(({ card, count }) => ({
            html: `${cardLine(card)}${count > 1 ? ` <span class="gq-dim">x${count}</span>` : ""}${
              app.save.roster.cardIds.includes(card.id) ? " &#9670;" : ""
            }`
          })),
          index
        )}</div>
        <div>${selected ? cardPanelHtml(selected.card, { count: selected.count }) : ""}</div>
      </div></div>
      <div class="gq-textbox"><p>&#9670; = in roster. X to leave.</p></div>
    </div>`;
  },
  hoverCard(app, index) {
    return collectionCards(app.save)[index]?.card ?? null;
  },
  key(app, key) {
    const rows = collectionCards(app.save);
    if (key === "up" || key === "down") {
      app.screen.index = clampIndex((app.screen.index ?? 0) + (key === "down" ? 1 : -1), rows.length);
    } else if (key === "b" || key === "a") {
      app.go("map");
    }
    app.rerender();
  }
};

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
    const issues = validateRoster(managerFor(save));
    const points = rosterPoints(save);
    const cap = pointCap(save);
    if (points > cap) issues.push(`over cap by ${points - cap}`);
    const picking = app.screen.mode === "pick";
    const rosterIndex = clampIndex(app.screen.index ?? 0, roster.length);
    const filter = app.screen.pickFilter ?? "position";
    const bench = picking ? benchCards(save, roster[rosterIndex], filter) : [];
    const pickIndex = clampIndex(app.screen.pickIndex ?? 0, bench.length + 1);
    const preview = picking
      ? bench[pickIndex] ?? null
      : roster[rosterIndex] ?? null;
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>TEAM &middot; ${escapeHtml(save.player.name)}</span><span>${points}/${cap} PT</span></div>
      <div class="gq-body"><div class="gq-columns">
        <div class="gq-frame gq-scroll">${
          picking
            ? `<h3>${benchLabel(roster[rosterIndex], filter)}</h3>${menuHtml(
                [
                  ...bench.map((card) => ({ html: cardLine(card) })),
                  { label: "CANCEL" }
                ],
                pickIndex
              )}`
            : menuHtml(roster.map((card) => ({ html: cardLine(card) })), rosterIndex)
        }</div>
        <div>${preview ? cardPanelHtml(preview, { count: ownedCount(save, preview.id) || null }) : `<p class="gq-dim">NO SWAP AVAILABLE.</p>`}</div>
      </div></div>
      <div class="gq-textbox">
        ${issues.length ? `<p>! ${escapeHtml(issues.join(", "))}</p>` : `<p>ROSTER IS GAME-READY.</p>`}
        <p class="gq-dim">${picking ? "Pick a replacement. &#9664;/&#9654; position only &middot; everyone. X cancels." : "Z swaps a card. Lineup slots fill automatically. X to leave."}</p>
      </div>
    </div>`;
  },
  hoverCard(app, index) {
    const roster = rosterCards(app.save);
    if (app.screen.mode === "pick") {
      const anchor = roster[clampIndex(app.screen.index ?? 0, roster.length)];
      return anchor ? benchCards(app.save, anchor, app.screen.pickFilter ?? "position")[index] ?? null : null;
    }
    return roster[index] ?? null;
  },
  key(app, key) {
    const save = app.save;
    const roster = rosterCards(save);
    if (app.screen.mode === "pick") {
      const anchor = roster[clampIndex(app.screen.index ?? 0, roster.length)];
      const bench = benchCards(save, anchor, app.screen.pickFilter ?? "position");
      const total = bench.length + 1;
      if (key === "left" || key === "right") {
        app.screen.pickFilter = (app.screen.pickFilter ?? "position") === "position" ? "all" : "position";
        app.screen.pickIndex = 0;
      } else if (key === "up" || key === "down") {
        app.screen.pickIndex = clampIndex((app.screen.pickIndex ?? 0) + (key === "down" ? 1 : -1), total);
      } else if (key === "a") {
        const pickIndex = app.screen.pickIndex ?? 0;
        if (pickIndex < bench.length) {
          const cardIds = save.roster.cardIds.map((id) => (id === anchor.id ? bench[pickIndex].id : id));
          setRoster(save, cardIds);
          persistSave(save);
        }
        app.screen.mode = "roster";
      } else if (key === "b") {
        app.screen.mode = "roster";
      }
    } else if (key === "up" || key === "down") {
      app.screen.index = clampIndex((app.screen.index ?? 0) + (key === "down" ? 1 : -1), roster.length);
    } else if (key === "a") {
      app.screen.mode = "pick";
      app.screen.pickIndex = 0;
      app.screen.pickFilter = "position";
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
