import { escapeHtml, menuHtml, clampIndex, cardPanelHtml } from "./helpers.js";
import { starterChoices, starterRosterWith } from "../packs.js";
import {
  createSave,
  persistSave,
  clearSave,
  addCardToCollection,
  setRoster,
  grantCoins,
  addLog
} from "../state.js";

const INTRO_PAGES = [
  ["Welcome to the CASCADE LEAGUE!", "I'm PROF. OAKMONT, the region's official scorekeeper."],
  ["Out here, managers settle everything the right way:", "nine innings of SHOWDOWN cards."],
  ["Every kid gets a farm team to start.", "Cheap cards. Big hearts. Terrible charts."],
  ["But you also get to choose ONE franchise star.", "Choose well. Your rival gets the one that beats it."],
  ["Win games, earn coins, rip open booster packs,", "and take the IRONWOOD GYM's badge.", "Now — what's your name, rookie?"]
];

const STARTING_COINS = 250;

export const titleScreen = {
  render(app) {
    const items = titleItems(app);
    return `<div class="gq-screen">
      <div class="gq-body gq-center">
        <h1 class="gq-logo">SHOWDOWN<br>QUEST</h1>
        <p class="gq-sub">CASCADE LEAGUE &middot; SERIES 1</p>
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
      app.go("starterPick", { playerName: value, index: 0, confirming: false });
    } else if (key === "b") {
      app.go("intro", { page: INTRO_PAGES.length - 1 });
    }
    app.rerender();
  }
};

export const starterPickScreen = {
  render(app) {
    const choices = starterChoices();
    const choice = choices[app.screen.index];
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>CHOOSE YOUR FRANCHISE STAR</span><span>${app.screen.index + 1}/3</span></div>
      <div class="gq-body">
        <p class="gq-center">&#9664; <b>${escapeHtml(choice.title.toUpperCase())}</b> &#9654;</p>
        <p class="gq-center gq-dim">${escapeHtml(choice.blurb)}</p>
        <div class="gq-mt">${cardPanelHtml(choice.card)}</div>
      </div>
      <div class="gq-textbox">
        ${app.screen.confirming
          ? `<p>Take ${escapeHtml(choice.card.name.toUpperCase())}?</p>${menuHtml(
              [{ label: "YES — SIGN THEM" }, { label: "KEEP LOOKING" }],
              app.screen.confirmIndex ?? 0
            )}`
          : `<p>&#9664;/&#9654; browse &middot; Z choose</p>`}
      </div>
    </div>`;
  },
  key(app, key) {
    const choices = starterChoices();
    if (app.screen.confirming) {
      if (key === "up" || key === "down") {
        app.screen.confirmIndex = clampIndex((app.screen.confirmIndex ?? 0) + 1, 2);
      } else if (key === "a") {
        if ((app.screen.confirmIndex ?? 0) === 0) return finishNewGame(app, choices[app.screen.index]);
        app.screen.confirming = false;
      } else if (key === "b") {
        app.screen.confirming = false;
      }
    } else if (key === "left" || key === "right") {
      app.screen.index = clampIndex(app.screen.index + (key === "right" ? 1 : -1), choices.length);
    } else if (key === "a") {
      app.screen.confirming = true;
      app.screen.confirmIndex = 0;
    } else if (key === "b") {
      app.go("nameEntry");
    }
    app.rerender();
  }
};

function finishNewGame(app, choice) {
  const saveSeed = `sq-${Date.now().toString(36)}-${Math.floor(Math.random() * 46656).toString(36)}`;
  const save = createSave({ name: app.screen.playerName, saveSeed });
  const roster = starterRosterWith(choice.card);
  for (const card of roster) addCardToCollection(save, card.id);
  setRoster(save, roster.map((card) => card.id));
  grantCoins(save, STARTING_COINS);
  addLog(save, `Signed ${choice.card.name} as the franchise star.`);
  app.save = persistSave(save);
  app.go("map");
  app.rerender();
}
