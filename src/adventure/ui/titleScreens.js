import { escapeHtml, menuHtml, clampIndex, cardPanelHtml, rarityTag } from "./helpers.js?v=20260713-m";
import { starterPack, setUniverseSeed, UNIVERSES, DECADES, EARLIEST_DECADE, decadeLabel, FRANCHISES, universeConfig } from "../packs.js?v=20260713-m";
import {
  createSave,
  persistSave,
  clearSave,
  addCardToCollection,
  setRoster,
  rosterCards,
  grantCoins,
  addLog,
  exportSaveCode,
  importSaveCode
} from "../state.js?v=20260713-m";

const INTRO_PAGES = [
  ["Welcome to the CASCADE LEAGUE!", "I'm PROF. OAKMONT, the region's official scorekeeper."],
  ["Out here, managers settle everything the right way:", "nine innings of SHOWDOWN cards."],
  ["Every rookie gets a sealed STARTER PACK.", "Thirteen cards. Two rares. The rest... character."],
  ["Mind the sticker prices — the printers had a rough year.", "Some cards cost twice what they're worth.", "Some are steals. A sharp eye builds a cheap pennant."],
  ["Win games, claim cards off the managers you beat,", "and climb the routes to the summit."],
  ["One bit of league paperwork:", "card scans appear courtesy of ShowdownCards.com,", "player photos come courtesy of Wikipedia,", "and the record books from the Baseball Databank (CC BY-SA).", "Now — what's your name, rookie?"]
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
  if (app.save) items.push({ label: "EXPORT SAVE", run: (a) => a.go("exportSave") });
  items.push({ label: "IMPORT SAVE", run: (a) => a.go("importSave") });
  items.push({ label: "HALL OF FAME", run: (a) => a.go("hallOfFame", { index: 0 }) });
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

// ---- Save backup -----------------------------------------------------------------

// The whole save as one base64 code: auto-copied to the clipboard where the
// browser allows, and left selected in the box for a manual copy either way.
export const exportSaveScreen = {
  render() {
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>EXPORT SAVE</span><span>BACKUP</span></div>
      <div class="gq-body gq-center">
        <div class="gq-frame" style="text-align:left">
          <p>YOUR SAVE CODE:</p>
          <p class="gq-mt"><input id="gq-save-code" readonly spellcheck="false"
            style="font:inherit;background:var(--gb-light);border:0.5cqw solid var(--gb-darkest);padding:0.5cqw 1cqw;width:100%"></p>
          <p class="gq-dim gq-mt" id="gq-copy-note">SELECT AND COPY IT SOMEWHERE SAFE.</p>
        </div>
      </div>
      <div class="gq-textbox"><p>Paste it into IMPORT SAVE on any device to pick the season back up. Z/X to go back.</p></div>
    </div>`;
  },
  mounted(app) {
    const input = document.getElementById("gq-save-code");
    if (!input) return;
    input.value = exportSaveCode(app.save);
    input.focus();
    input.select();
    navigator.clipboard?.writeText(input.value).then(
      () => {
        const note = document.getElementById("gq-copy-note");
        if (note) note.textContent = "COPIED TO YOUR CLIPBOARD.";
      },
      () => {}
    );
  },
  key(app, key) {
    if (key === "a" || key === "b") app.go("title", { menuIndex: 0 });
    app.rerender();
  }
};

export const importSaveScreen = {
  render(app) {
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>IMPORT SAVE</span><span>RESTORE</span></div>
      <div class="gq-body gq-center">
        <div class="gq-frame" style="text-align:left">
          <p>PASTE A SAVE CODE:</p>
          <p class="gq-mt"><input id="gq-import-code" autocomplete="off" spellcheck="false"
            style="font:inherit;background:var(--gb-light);border:0.5cqw solid var(--gb-darkest);padding:0.5cqw 1cqw;width:100%"></p>
          ${app.screen.error ? `<p class="gq-mt"><b>THAT CODE DIDN'T TAKE. CHECK THE PASTE AND TRY AGAIN.</b></p>` : ""}
        </div>
      </div>
      <div class="gq-textbox"><p>${app.save ? "! THIS REPLACES YOUR CURRENT SAVE. " : ""}ENTER imports &middot; ESC backs out.</p></div>
    </div>`;
  },
  mounted() {
    document.getElementById("gq-import-code")?.focus();
  },
  key(app, key) {
    if (key === "a") {
      const code = document.getElementById("gq-import-code")?.value.trim() ?? "";
      const save = importSaveCode(code);
      if (!save) {
        app.screen.error = true;
      } else {
        app.save = persistSave(save);
        setUniverseSeed(save.saveSeed, save.universe ?? "fictional", { priceNoise: save.mode !== "uncapped" });
        return app.go("map");
      }
    } else if (key === "b") {
      return app.go("title", { menuIndex: 0 });
    }
    app.rerender();
  }
};

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

// Which baseball do you want? The real 2000-2005 Showdown card set, real
// players three ways — ALL TIME (career ratings, one card per player ever),
// BY DECADE (check the decades you want in the pool — all of them by
// default, one card per player per decade), or BY FRANCHISE — or a fresh
// FICTIONAL PLAYERS league, last on the list. The BY pickers open
// sub-screens.
function checkedDecades(app) {
  if (!app.screen.checkedDecades) app.screen.checkedDecades = [...DECADES];
  return app.screen.checkedDecades;
}

function leagueOptions(app) {
  if (app.screen.picker === "decades") {
    const checked = checkedDecades(app);
    const allChecked = checked.length === DECADES.length;
    return [
      {
        label: `${allChecked ? "[X]" : "[ ]"} EVERY DECADE`,
        toggleAll: true,
        blurb: allChecked ? "Uncheck all, then pick just the eras you want." : "Check every era at once."
      },
      ...DECADES.map((start) => ({
        label: `${checked.includes(start) ? "[X]" : "[ ]"} THE ${decadeLabel(start)}`,
        toggle: start,
        blurb: start === EARLIEST_DECADE
          ? `Real big leaguers rated on their numbers through ${start + 9} — the dead-ball era and everything before it, one pool.`
          : `Real big leaguers rated on their ${start}-${start + 9} numbers.`
      })),
      {
        label: "PLAY BALL",
        confirm: true,
        blurb: checked.length
          ? `Start with ${checked.length === DECADES.length ? "every decade" : `${checked.length} decade${checked.length === 1 ? "" : "s"}`} in the pool — one card per player per decade.`
          : "Check at least one decade first."
      }
    ];
  }
  if (app.screen.picker === "franchise") {
    return FRANCHISES.map((franchise) => ({
      label: franchise.name.toUpperCase(),
      universe: `franchise-${franchise.id}`
    }));
  }
  return [
    { label: UNIVERSES.classic.name, universe: "classic" },
    { label: UNIVERSES["mlb-history"].name, universe: "mlb-history" },
    { label: "MLB: BY DECADE", picker: "decades", blurb: "Real players from every team — check the decades you want in the pool." },
    { label: "MLB: BY FRANCHISE", picker: "franchise", blurb: "Pick a club and play its all-time roster — every player rated on their years there." },
    { label: UNIVERSES.fictional.name, universe: "fictional" }
  ];
}

export const leagueSelectScreen = {
  render(app) {
    const options = leagueOptions(app);
    const index = clampIndex(app.screen.menuIndex ?? 0, options.length);
    const selected = options[index];
    const blurb = selected.blurb ?? universeConfig(selected.universe)?.blurb ?? "";
    const title = app.screen.picker === "decades" ? "CHECK YOUR DECADES" : app.screen.picker === "franchise" ? "PICK A FRANCHISE" : "CHOOSE YOUR LEAGUE";
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>${title}</span><span>${index + 1}/${options.length}</span></div>
      <div class="gq-body">
        <div class="gq-frame gq-scroll" style="max-height:62%">${menuHtml(options.map((option) => ({ label: option.label })), index)}</div>
        ${blurb ? `<div class="gq-frame"><p class="gq-dim">${escapeHtml(blurb)}</p></div>` : ""}
      </div>
      <div class="gq-textbox"><p>${app.screen.picker === "decades" ? "Z toggles a decade. PLAY BALL starts. X backs out." : `Z picks. ${app.screen.picker ? "X backs out." : "Your starter pack comes from the league you choose."}`}</p></div>
    </div>`;
  },
  key(app, key) {
    const options = leagueOptions(app);
    if (key === "up" || key === "down") {
      app.screen.menuIndex = clampIndex((app.screen.menuIndex ?? 0) + (key === "down" ? 1 : -1), options.length);
    } else if (key === "a") {
      const choice = options[clampIndex(app.screen.menuIndex ?? 0, options.length)];
      if (choice.toggleAll) {
        app.screen.checkedDecades = checkedDecades(app).length === DECADES.length ? [] : [...DECADES];
      } else if (choice.toggle != null) {
        const checked = checkedDecades(app);
        app.screen.checkedDecades = checked.includes(choice.toggle)
          ? checked.filter((start) => start !== choice.toggle)
          : [...checked, choice.toggle];
      } else if (choice.confirm) {
        const picked = DECADES.filter((start) => checkedDecades(app).includes(start));
        if (picked.length) {
          app.go("modeSelect", { playerName: app.screen.playerName, universe: `decades-${picked.join(",")}`, menuIndex: 0 });
        }
      } else if (choice.picker) {
        app.screen.picker = choice.picker;
        app.screen.menuIndex = 0;
      } else {
        app.go("modeSelect", { playerName: app.screen.playerName, universe: choice.universe, menuIndex: 0 });
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

// How hard should money matter? Budget is the classic game: a roster budget
// sized to the pool (3500 in the fictional reference league), where
// bargains win pennants. Uncapped drops the limit entirely — and the bosses
// scale up much harder to match.
const MODES = [
  {
    key: "budget",
    label: "BUDGET LEAGUE",
    blurb: "Every manager fields a budget sized to this league's pool. Sticker prices lie — sharp scouting beats deep pockets."
  },
  {
    key: "uncapped",
    label: "UNCAPPED",
    blurb: "No roster limit, and sticker prices tell the truth. Stack every legend you can afford — the bosses' checkbooks grow a lot faster out here."
  }
];

export const modeSelectScreen = {
  render(app) {
    const index = clampIndex(app.screen.menuIndex ?? 0, MODES.length);
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>CHOOSE YOUR RULES</span><span>${index + 1}/${MODES.length}</span></div>
      <div class="gq-body">
        <div class="gq-frame">${menuHtml(MODES.map((mode) => ({ label: mode.label })), index)}</div>
        <div class="gq-frame"><p class="gq-dim">${escapeHtml(MODES[index].blurb)}</p></div>
      </div>
      <div class="gq-textbox"><p>Z picks. X backs out to the league list.</p></div>
    </div>`;
  },
  key(app, key) {
    if (key === "up" || key === "down") {
      app.screen.menuIndex = clampIndex((app.screen.menuIndex ?? 0) + (key === "down" ? 1 : -1), MODES.length);
    } else if (key === "a") {
      const mode = MODES[clampIndex(app.screen.menuIndex ?? 0, MODES.length)];
      finishNewGame(app, app.screen.playerName, app.screen.universe, mode.key);
    } else if (key === "b") {
      app.go("leagueSelect", { playerName: app.screen.playerName, menuIndex: 0 });
    }
    app.rerender();
  }
};

// A new save is a whole new universe: fresh seed, the chosen league's card
// pool, fresh sealed starter pack. Nothing carries over but the player's wits.
function finishNewGame(app, playerName, universe, mode = "budget") {
  const saveSeed = `sq-${Date.now().toString(36)}-${Math.floor(Math.random() * 46656).toString(36)}`;
  const save = createSave({ name: playerName, saveSeed, universe, mode });
  setUniverseSeed(saveSeed, universe, { priceNoise: mode !== "uncapped" });
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
        ${revealed === 0 ? `<p class="gq-pack-count">&#9993; YOUR SEALED STARTER PACK. RIP IT OPEN!</p>` : rewound ? `<p class="gq-pack-count"><span class="gq-dim">CARD ${viewing} OF ${revealed}</span></p>` : ""}
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
