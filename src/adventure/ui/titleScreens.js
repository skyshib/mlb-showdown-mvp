import { escapeHtml, menuHtml, clampIndex, cardPanelHtml, rarityTag } from "./helpers.js?v=20260716-records";
import { resumeBattle } from "./battleScreen.js?v=20260716-records";
import { starterPack, UNIVERSES, DECADES, EARLIEST_DECADE, decadeLabel, FRANCHISES, universeConfig, canFieldFullRoster, setUniverseSeed } from "../packs.js?v=20260716-records";
import { GAUNTLET_TIERS } from "../region.js?v=20260716-records";
import {
  createSave,
  hydrateUniverse,
  persistSave,
  addCardToCollection,
  setRoster,
  rosterCards,
  grantCoins,
  addLog,
  exportSaveCode,
  importSaveCode,
  saveFileName
} from "../state.js?v=20260716-records";

const INTRO_PAGES = [
  ["Welcome to the CASCADE LEAGUE!", "I'm PROF. OAKMONT, the region's official scorekeeper."],
  ["Out here, managers settle everything the right way:", "nine innings of SHOWDOWN cards."],
  ["Every rookie gets a sealed STARTER PACK.", "A couple of rares. The rest... character."],
  ["Mind the sticker prices — the printers had a rough year.", "Some cards cost twice what they're worth.", "Some are steals. A sharp eye builds a cheap pennant."],
  ["Win games, claim cards off the managers you beat,", "and climb the routes to the summit."],
  ["One bit of league paperwork:", "card scans appear courtesy of ShowdownCards.com,", "player photos come courtesy of Wikipedia,", "and the record books from the Baseball Databank (CC BY-SA).", "Now — what's your name, rookie?"]
];

const STARTING_COINS = 250;

export const titleScreen = {
  render(app) {
    const items = titleItems(app);
    // The menu grew — a hall, a record book — and grew straight off the bottom of
    // the screen: DELETE SAVE went under the fold and WORLD RECORDS was sliced in
    // half by the edge of it. The front door has to show every door it opens, so
    // the spacing is the title screen's own (gq-title-screen) and it is measured
    // against the longest menu the screen can have.
    return `<div class="gq-screen gq-title-screen">
      <div class="gq-body gq-center">
        <h1 class="gq-logo">SHOWDOWN<br>QUEST</h1>
        <p class="gq-sub">CASCADE LEAGUE &middot; SERIES 2</p>
        <div class="gq-title-menu">
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

// CONTINUE means continue — not "go to the map". A game left on the books is a
// game you are still in the middle of, and the front door has to hand you back
// the one you walked out of: the same inning, the same arm, the same men on. It
// is the same recording a reloaded tab comes back to (see resumeBattle), so
// leaving through the MAIN MENU button costs a manager exactly what closing the
// tab costs him, which is nothing. With no game on the books, the map it is.
function continueGame(app) {
  const resumed = resumeBattle(app);
  if (resumed) app.screen = resumed;
  else app.go("map");
}

function titleItems(app) {
  const items = [];
  if (app.save) items.push({ label: "CONTINUE", run: continueGame });
  items.push({ label: "NEW GAME", run: (a) => a.go("intro", { page: 0 }) });
  if (app.save) items.push({ label: "EXPORT SAVE", run: (a) => a.go("exportSave") });
  items.push({ label: "IMPORT SAVE", run: (a) => a.go("importSave") });
  items.push({ label: "HALL OF FAME", run: (a) => a.go("hallOfFame", { index: 0 }) });
  // The hall ranks finished RUNS. The book ranks single feats, and it is the
  // whole league's — so it stands next to the hall, where the global things are.
  items.push({ label: "WORLD RECORDS", run: (a) => a.go("records", { index: 0 }) });
  // There is no DELETE SAVE. There was, and it wiped a campaign on ONE keypress
  // with nothing asked and nothing to undo — in a game where the shop will not
  // sell a single card without checking you meant it. It was not even a way out
  // of anything: NEW GAME already replaces the save, and EXPORT SAVE means a run
  // you are done with can be kept rather than shot.
  return items;
}

// ---- Save backup -----------------------------------------------------------------

// The whole save is one base64 code, but nobody should have to shepherd that
// much text around: it downloads as a small file instead, and IMPORT SAVE
// reads the file straight back.
function downloadSave(save) {
  const blob = new Blob([exportSaveCode(save)], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = saveFileName(save);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const exportSaveScreen = {
  render(app) {
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>EXPORT SAVE</span><span>BACKUP</span></div>
      <div class="gq-body gq-center">
        <div class="gq-frame" style="text-align:left">
          <p>YOUR SAVE FILE:</p>
          <p class="gq-mt"><b>${escapeHtml(saveFileName(app.save))}</b></p>
          <p class="gq-dim gq-mt">${app.screen.downloaded ? "SAVED TO YOUR DOWNLOADS." : "STARTING THE DOWNLOAD&hellip;"}</p>
        </div>
      </div>
      <div class="gq-textbox"><p>Keep it somewhere safe, then feed it to IMPORT SAVE on any device to pick the season back up. Z downloads it again &middot; X goes back.</p></div>
    </div>`;
  },
  mounted(app) {
    if (app.screen.downloaded) return;
    downloadSave(app.save);
    app.screen.downloaded = true;
    app.rerender();
  },
  key(app, key) {
    if (key === "a") downloadSave(app.save);
    else if (key === "b") return app.go("title", { menuIndex: 0 });
    app.rerender();
  }
};

// A save file is the code as text, so the same reader takes either one: the
// downloaded .sav, or a code pasted from an older backup.
function restoreSave(app, code) {
  const save = importSaveCode(code ?? "");
  if (!save) {
    app.screen.error = true;
    app.rerender();
    return;
  }
  // Install the imported save's own cards; an older backup with none freezes the
  // pool its seed builds now. Persist after, so a just-frozen import keeps them.
  hydrateUniverse(save);
  app.save = persistSave(save);
  app.go("map");
}

export const importSaveScreen = {
  render(app) {
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>IMPORT SAVE</span><span>RESTORE</span></div>
      <div class="gq-body gq-center">
        <div class="gq-frame" style="text-align:left">
          <p>CHOOSE A SAVE FILE:</p>
          <p class="gq-mt"><input type="file" id="gq-import-file" accept=".sav,.txt,text/plain"
            style="font:inherit;width:100%"></p>
          <p class="gq-dim gq-mt">OR PASTE A SAVE CODE:</p>
          <p class="gq-mt"><input id="gq-import-code" autocomplete="off" spellcheck="false"
            style="font:inherit;background:var(--gb-light);border:0.5cqw solid var(--gb-darkest);padding:0.5cqw 1cqw;width:100%"></p>
          ${app.screen.error ? `<p class="gq-mt"><b>THAT SAVE DIDN'T TAKE. CHECK THE FILE AND TRY AGAIN.</b></p>` : ""}
        </div>
      </div>
      <div class="gq-textbox"><p>${app.save ? "! THIS REPLACES YOUR CURRENT SAVE. " : ""}A save file imports the moment you pick it &middot; ENTER imports a pasted code &middot; ESC backs out.</p></div>
    </div>`;
  },
  mounted(app) {
    const file = document.getElementById("gq-import-file");
    if (file) {
      file.addEventListener("change", () => {
        const chosen = file.files?.[0];
        if (!chosen) return;
        chosen.text().then(
          (text) => restoreSave(app, text.trim()),
          () => {
            app.screen.error = true;
            app.rerender();
          }
        );
      });
    }
    document.getElementById("gq-import-code")?.focus();
  },
  key(app, key) {
    if (key === "a") {
      restoreSave(app, document.getElementById("gq-import-code")?.value.trim());
    } else if (key === "b") {
      return app.go("title", { menuIndex: 0 });
    } else {
      app.rerender();
    }
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
    // Empty, and waiting. A name typed over a name somebody else left in the box
    // is not the same gesture as a name typed into nothing.
    document.getElementById("gq-name")?.focus();
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
  },
  {
    key: "gauntlet",
    label: "THE GAUNTLET",
    blurb: "Every card in the league is yours on day one. No shops, no packs, no coins — just your cap, one team you build and never change, and six elite clubs in a row. Lose a series and the run is over."
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
      app.go("formatSelect", { playerName: app.screen.playerName, universe: app.screen.universe, mode: mode.key, menuIndex: 0 });
    } else if (key === "b") {
      app.go("leagueSelect", { playerName: app.screen.playerName, menuIndex: 0 });
    }
    app.rerender();
  }
};

// How big is a team? CLASSIC is the thirteen the adventure has always dealt.
// FULL ROSTER is the real product's twenty: a bench, a four-man rotation the
// dice pick from, and a pen as deep as you choose to make it.
const FORMATS = [
  {
    key: "classic",
    label: "CLASSIC · 13 CARDS",
    blurb: "Nine bats who play all nine innings, two starters who alternate, two relievers. No bench — the men you field are the men you finish with."
  },
  {
    key: "full",
    label: "FULL ROSTER · 20 CARDS",
    blurb: "Nine starting bats plus a bench, a four-man rotation drawn at random each game, and seven flex seats split any way between relievers and reserve bats. Bench bats count a fifth of their price — and from the 7th inning they can enter the game."
  }
];

export const formatSelectScreen = {
  mounted(app) {
    // Can this league even stock a twenty-man roster? Build its pool once to
    // ask. The probe clobbers the active pool, so a loaded save's frozen
    // universe is reinstalled behind it before anything else reads a card.
    if (app.screen.fullAvailable == null) {
      setUniverseSeed(`format-probe:${app.screen.universe}`, app.screen.universe, { priceNoise: false });
      app.screen.fullAvailable = canFieldFullRoster();
      if (app.save) hydrateUniverse(app.save);
      app.rerender();
    }
  },
  render(app) {
    const index = clampIndex(app.screen.menuIndex ?? 0, FORMATS.length);
    const format = FORMATS[index];
    const thin = format.key === "full" && app.screen.fullAvailable === false;
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>CHOOSE YOUR ROSTER</span><span>${index + 1}/${FORMATS.length}</span></div>
      <div class="gq-body">
        <div class="gq-frame">${menuHtml(FORMATS.map((entry) => ({ label: entry.label + (entry.key === "full" && app.screen.fullAvailable === false ? " — TOO THIN" : "") })), index)}</div>
        <div class="gq-frame"><p class="gq-dim">${escapeHtml(thin ? "This league cannot stock twenty distinct men — pick CLASSIC, or a deeper league." : format.blurb)}</p></div>
      </div>
      <div class="gq-textbox"><p>Z picks. X backs out to the rules.</p></div>
    </div>`;
  },
  key(app, key) {
    if (key === "up" || key === "down") {
      app.screen.menuIndex = clampIndex((app.screen.menuIndex ?? 0) + (key === "down" ? 1 : -1), FORMATS.length);
    } else if (key === "a") {
      const format = FORMATS[clampIndex(app.screen.menuIndex ?? 0, FORMATS.length)];
      if (format.key === "full" && app.screen.fullAvailable === false) return;
      if (app.screen.mode === "gauntlet") {
        app.go("tierSelect", {
          playerName: app.screen.playerName,
          universe: app.screen.universe,
          mode: app.screen.mode,
          rosterFormat: format.key,
          menuIndex: 1
        });
        app.rerender();
        return;
      }
      finishNewGame(app, app.screen.playerName, app.screen.universe, app.screen.mode, format.key);
    } else if (key === "b") {
      app.go("modeSelect", { playerName: app.screen.playerName, universe: app.screen.universe, menuIndex: 0 });
    }
    app.rerender();
  }
};

// How hard should the six be? The tiers hang off your own cap, and the blurbs
// say what each one actually costs you — measured, not guessed (see
// region.GAUNTLET_TIERS).
const TIER_KEYS = ["contender", "elite", "immortal"];

export const tierSelectScreen = {
  render(app) {
    const index = clampIndex(app.screen.menuIndex ?? 0, TIER_KEYS.length);
    const tier = GAUNTLET_TIERS[TIER_KEYS[index]];
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>HOW ELITE?</span><span>${index + 1}/${TIER_KEYS.length}</span></div>
      <div class="gq-body">
        <div class="gq-frame">${menuHtml(TIER_KEYS.map((key) => ({ label: GAUNTLET_TIERS[key].name })), index)}</div>
        <div class="gq-frame"><p class="gq-dim">${escapeHtml(tier.blurb)}</p></div>
      </div>
      <div class="gq-textbox"><p>Z picks. X backs out to the roster size.</p></div>
    </div>`;
  },
  key(app, key) {
    if (key === "up" || key === "down") {
      app.screen.menuIndex = clampIndex((app.screen.menuIndex ?? 0) + (key === "down" ? 1 : -1), TIER_KEYS.length);
    } else if (key === "a") {
      const tier = TIER_KEYS[clampIndex(app.screen.menuIndex ?? 0, TIER_KEYS.length)];
      finishNewGame(app, app.screen.playerName, app.screen.universe, app.screen.mode, app.screen.rosterFormat, tier);
    } else if (key === "b") {
      app.go("formatSelect", { playerName: app.screen.playerName, universe: app.screen.universe, mode: app.screen.mode, menuIndex: 0 });
    }
    app.rerender();
  }
};

// A new save is a whole new universe: fresh seed, the chosen league's card
// pool, fresh sealed starter pack. Nothing carries over but the player's wits.
function finishNewGame(app, playerName, universe, mode = "budget", rosterFormat = "classic", gauntletTier = "elite") {
  const saveSeed = `sq-${Date.now().toString(36)}-${Math.floor(Math.random() * 46656).toString(36)}`;
  const save = createSave({ name: playerName, saveSeed, universe, mode, rosterFormat, gauntletTier });
  // Build this league's pool and freeze it into the save at birth, so its cards
  // never re-derive as the generators change.
  hydrateUniverse(save);
  const roster = starterPack(saveSeed, rosterFormat);
  for (const card of roster) addCardToCollection(save, card.id);
  setRoster(save, roster.map((card) => card.id));
  if (mode === "gauntlet") {
    // Nothing is opened and nothing is bought here: the whole league is
    // already yours. The dealt roster is only a legal starting point — the
    // team screen is the game until you throw the first pitch.
    addLog(save, "The whole league is yours. Build the club that survives the six.");
    app.save = persistSave(save);
    app.go("map");
    app.rerender();
    return;
  }
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
