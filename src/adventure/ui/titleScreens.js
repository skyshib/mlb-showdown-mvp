import { escapeHtml, menuHtml, clampIndex, cardPanelHtml, rarityTag } from "./helpers.js";
import { starterPack, setUniverseSeed, UNIVERSES, DECADES, FRANCHISES, universeConfig } from "../packs.js";
import {
  createSave,
  persistSave,
  clearSave,
  addCardToCollection,
  setRoster,
  rosterCards,
  grantCoins,
  addLog
} from "../state.js";

const INTRO_PAGES = [
  ["Welcome to the CASCADE LEAGUE!", "I'm PROF. OAKMONT, the region's official scorekeeper."],
  ["Out here, managers settle everything the right way:", "nine innings of SHOWDOWN cards."],
  ["Every rookie gets a sealed STARTER PACK.", "Thirteen cards. Two rares. The rest... character."],
  ["Mind the sticker prices — the printers had a rough year.", "Some cards cost twice what they're worth.", "Some are steals. A sharp eye builds a cheap pennant."],
  ["Win games, claim cards off the managers you beat,", "and climb the routes to the summit."],
  ["One bit of league paperwork:", "player photos come courtesy of Wikipedia,", "and the record books from the Baseball Databank (CC BY-SA).", "Now — what's your name, rookie?"]
];

const STARTING_COINS = 250;

export const titleScreen = {
  render(app) {
    const items = titleItems(app);
    return `<div class="gq-screen">
      <div class="gq-body gq-center">
        <h1 class="gq-logo">SHOWDOWN<br>QUEST</h1>
        <p class="gq-sub">CASCADE LEAGUE &middot; SERIES 2</p>
        <div class="gq-mt" style="max-width:60%;margin:4cqw auto 0;text-align:left">
          ${menuHtml(items.map((item) => ({ label: item.label })), app.screen.menuIndex ?? 0)}
        </div>
      </div>
      <div class="gq-textbox"><p>&#9654; ARROWS move &middot; Z/ENTER confirm &middot; X/ESC back</p></div>
    </div>`;
  },
  key(app, key) {
    const items = titleItems(app);
    if (key === "up" || key === "down") {
      app.screen.menuIndex = clampIndex((app.screen.menuIndex ?? 0) + (key === "down" ? 1 : -1), items.length);
    } else if (key === "a") {
      items[app.screen.menuIndex ?? 0].run(app);
    }
    app.rerender();
  }
};

function titleItems(app) {
  const items = [];
  if (app.save) items.push({ label: "CONTINUE", run: (a) => a.go("map") });
  items.push({ label: "NEW GAME", run: (a) => a.go("intro", { page: 0 }) });
  if (app.save) {
    items.push({
      label: "DELETE SAVE",
      run: (a) => {
        clearSave();
        a.save = null;
        a.screen.menuIndex = 0;
      }
    });
  }
  return items;
}

export const introScreen = {
  render(app) {
    const page = INTRO_PAGES[app.screen.page];
    return `<div class="gq-screen">
      <div class="gq-body">
        <div class="gq-frame gq-title-frame">
          <b>PROF. OAKMONT</b><br><span class="gq-dim">[  bespectacled scorekeeper  ]</span>
        </div>
      </div>
      <div class="gq-textbox">
        ${page.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
        <p class="gq-blink gq-right">&#9660;</p>
      </div>
    </div>`;
  },
  key(app, key) {
    if (key === "a") {
      if (app.screen.page + 1 < INTRO_PAGES.length) app.screen.page += 1;
      else app.go("nameEntry");
    } else if (key === "b" && app.screen.page === 0) {
      app.go("title");
    } else if (key === "b") {
      app.screen.page -= 1;
    }
    app.rerender();
  }
};

export const nameEntryScreen = {
  render() {
    return `<div class="gq-screen">
      <div class="gq-body gq-center">
        <div class="gq-frame gq-mt" style="margin-top:10cqw">
          <p>YOUR NAME, ROOKIE?</p>
          <p class="gq-mt"><input id="gq-name" maxlength="10" autocomplete="off" spellcheck="false"
            style="font:inherit;text-transform:uppercase;background:var(--gb-light);border:0.5cqw solid var(--gb-darkest);padding:0.5cqw 1cqw;width:60%"></p>
        </div>
      </div>
      <div class="gq-textbox"><p>TYPE A NAME &middot; ENTER to continue</p></div>
    </div>`;
  },
  mounted() {
    const input = document.getElementById("gq-name");
    if (input) {
      input.value = "SKY";
      input.focus();
      input.select();
    }
  },
  key(app, key) {
    if (key === "a") {
      const value = document.getElementById("gq-name")?.value.trim().toUpperCase() || "ROOKIE";
      app.go("leagueSelect", { playerName: value, menuIndex: 0 });
    } else if (key === "b") {
      app.go("intro", { page: INTRO_PAGES.length - 1 });
    }
    app.rerender();
  }
};

// Which baseball do you want? A fresh fictional league, the real 2000-2005
// Showdown card set, real players (all time, any decade, or any franchise).
// DECADE and FRANCHISE open sub-lists.
function leagueOptions(app) {
  if (app.screen.picker === "decade") {
    return DECADES.map((start) => ({
      label: `THE ${start}s`,
      universe: `decade-${start}`
    }));
  }
  if (app.screen.picker === "franchise") {
    return FRANCHISES.map((franchise) => ({
      label: franchise.name.toUpperCase(),
      universe: `franchise-${franchise.id}`
    }));
  }
  return [
    ...Object.values(UNIVERSES).map((league) => ({ label: league.name, universe: league.key })),
    { label: "MLB: DECADE", picker: "decade", blurb: "Pick any decade from the 1910s on — players rated on those ten years." },
    { label: "MLB: FRANCHISE", picker: "franchise", blurb: "Pick a club and play its all-time roster — every player rated on their years there." }
  ];
}

export const leagueSelectScreen = {
  render(app) {
    const options = leagueOptions(app);
    const index = clampIndex(app.screen.menuIndex ?? 0, options.length);
    const selected = options[index];
    const blurb = selected.blurb ?? universeConfig(selected.universe)?.blurb ?? "";
    const title = app.screen.picker === "decade" ? "PICK A DECADE" : app.screen.picker === "franchise" ? "PICK A FRANCHISE" : "CHOOSE YOUR LEAGUE";
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>${title}</span><span>${index + 1}/${options.length}</span></div>
      <div class="gq-body">
        <div class="gq-frame gq-scroll" style="max-height:62%">${menuHtml(options.map((option) => ({ label: option.label })), index)}</div>
        ${blurb ? `<div class="gq-frame"><p class="gq-dim">${escapeHtml(blurb)}</p></div>` : ""}
      </div>
      <div class="gq-textbox"><p>Z picks. ${app.screen.picker ? "X backs out." : "Your starter pack comes from the league you choose."}</p></div>
    </div>`;
  },
  key(app, key) {
    const options = leagueOptions(app);
    if (key === "up" || key === "down") {
      app.screen.menuIndex = clampIndex((app.screen.menuIndex ?? 0) + (key === "down" ? 1 : -1), options.length);
    } else if (key === "a") {
      const choice = options[clampIndex(app.screen.menuIndex ?? 0, options.length)];
      if (choice.picker) {
        app.screen.picker = choice.picker;
        app.screen.menuIndex = 0;
      } else {
        finishNewGame(app, app.screen.playerName, choice.universe);
      }
    } else if (key === "b") {
      if (app.screen.picker) {
        app.screen.picker = null;
        app.screen.menuIndex = 0;
      } else {
        app.go("nameEntry");
      }
    }
    app.rerender();
  }
};

// A new save is a whole new universe: fresh seed, the chosen league's card
// pool, fresh sealed starter pack. Nothing carries over but the player's wits.
function finishNewGame(app, playerName, universe) {
  const saveSeed = `sq-${Date.now().toString(36)}-${Math.floor(Math.random() * 46656).toString(36)}`;
  const save = createSave({ name: playerName, saveSeed, universe });
  setUniverseSeed(saveSeed, universe);
  const roster = starterPack(saveSeed);
  for (const card of roster) addCardToCollection(save, card.id);
  setRoster(save, roster.map((card) => card.id));
  grantCoins(save, STARTING_COINS);
  addLog(save, "Opened the starter pack.");
  app.save = persistSave(save);
  app.go("starterReveal", { revealed: 0 });
  app.rerender();
}

// Rip the starter pack open card by card, packOpen-style, then hit the map.
// The left arrow rewinds through cards already revealed; Z walks forward and
// only flips a new card once the view is back at the front.
export const starterRevealScreen = {
  render(app) {
    const cards = rosterCards(app.save);
    const revealed = app.screen.revealed ?? 0;
    const viewing = Math.min(app.screen.viewing ?? revealed, revealed);
    const current = viewing > 0 ? cards[viewing - 1] : null;
    const rewound = viewing < revealed;
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>STARTER PACK</span><span>${revealed}/${cards.length}</span></div>
      <div class="gq-pack-stage">
        <p class="gq-pack-count">${revealed === 0 ? "&#9993; YOUR SEALED STARTER PACK. RIP IT OPEN!" : `${rarityTag(current)}${rewound ? ` <span class="gq-dim">CARD ${viewing} OF ${revealed}</span>` : ""}`}</p>
        ${current ? `<div class="gq-pack-reveal">${cardPanelHtml(current)}</div>` : ""}
      </div>
      <div class="gq-textbox">
        ${revealed > 1 ? `<p class="gq-dim">&#9664;/&#9654; LOOK BACK THROUGH THE PACK</p>` : ""}
        <p class="gq-blink">${rewound ? "Z — FORWARD" : revealed < cards.length ? "Z — NEXT CARD" : "Z — PLAY BALL"}</p>
      </div>
    </div>`;
  },
  key(app, key) {
    const cards = rosterCards(app.save);
    const revealed = app.screen.revealed ?? 0;
    const viewing = Math.min(app.screen.viewing ?? revealed, revealed);
    if (key === "left") {
      if (viewing > 1) app.screen.viewing = viewing - 1;
    } else if (key === "right") {
      if (viewing < revealed) app.screen.viewing = viewing + 1;
    } else if (key === "a" || key === "b") {
      if (viewing < revealed) app.screen.viewing = viewing + 1;
      else if (revealed < cards.length) {
        app.screen.revealed = revealed + 1;
        app.screen.viewing = revealed + 1;
      } else {
        return app.go("map");
      }
    } else {
      return;
    }
    app.rerender();
  }
};
