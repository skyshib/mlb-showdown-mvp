import { loadSave } from "./state.js?v=20260716-records";
import { setUniverseSeed, cardById } from "./packs.js?v=20260716-records";
import { hydratePhotos } from "../ui/photos.js?v=20260716-records";
import { applyFranchisePalette } from "../ui/franchisePalette.js?v=20260716-records";
import { cardPanelHtml, escapeHtml } from "./ui/helpers.js?v=20260716-records";
import { titleScreen, introScreen, nameEntryScreen, leagueSelectScreen, modeSelectScreen, starterRevealScreen, exportSaveScreen, importSaveScreen } from "./ui/titleScreens.js?v=20260716-records";
import { mapScreen, trainerIntroScreen, ambushScreen } from "./ui/mapScreen.js?v=20260716-records";
import { battleScreen, gameOverScreen, seriesBreakScreen, battleResultScreen, simSeriesScreen, claimCardScreen, resumeBattle } from "./ui/battleScreen.js?v=20260716-records";
import { shopScreen, sellScreen, binderScreen, teamScreen, lineupScreen, packOpenScreen, catalogScreen, compareScreen } from "./ui/collectionScreens.js?v=20260716-records";
import { gameStatsScreen, seasonStatsScreen, championshipScreen, almanacScreen, trophyScreen } from "./ui/statsScreens.js?v=20260716-records";
import { hallOfFameScreen, hofTeamScreen } from "./ui/hallOfFameScreen.js?v=20260716-records";
import { recordsScreen } from "./ui/recordsScreen.js?v=20260716-records";
import { unlockSounds, soundsUnlocked, isMuted } from "../ui/sounds.js?v=20260716-records";

// A browser will not let a page make a noise until the person has touched it, so
// the adventure buys the right on the first button pressed — the one that opens
// the save, long before anything has anything to say. Without this the whole kit
// is silent here and the sounds look broken rather than absent.
//
// It asks again on every gesture until it works, rather than asking once and
// latching: a first attempt can be refused (a tab that is not visible, a resume
// the browser simply never answers), and a page that gave up after one try would
// be silent for the rest of the session with nothing to show for it. Once the
// context is running, this costs a boolean check per keypress.
//
// The draft room's mute switch is honoured — it is one setting, in one place,
// for one site.
function askForSound() {
  if (isMuted() || soundsUnlocked()) return;
  unlockSounds().catch(() => {});
}
document.addEventListener("keydown", askForSound);
document.addEventListener("pointerdown", askForSound);

const SCREENS = {
  title: titleScreen,
  intro: introScreen,
  nameEntry: nameEntryScreen,
  leagueSelect: leagueSelectScreen,
  modeSelect: modeSelectScreen,
  starterReveal: starterRevealScreen,
  exportSave: exportSaveScreen,
  importSave: importSaveScreen,
  map: mapScreen,
  trainerIntro: trainerIntroScreen,
  ambush: ambushScreen,
  battle: battleScreen,
  gameOver: gameOverScreen,
  seriesBreak: seriesBreakScreen,
  battleResult: battleResultScreen,
  simSeries: simSeriesScreen,
  claimCard: claimCardScreen,
  shop: shopScreen,
  sell: sellScreen,
  catalog: catalogScreen,
  binder: binderScreen,
  compare: compareScreen,
  almanac: almanacScreen,
  trophies: trophyScreen,
  team: teamScreen,
  lineup: lineupScreen,
  packOpen: packOpenScreen,
  gameStats: gameStatsScreen,
  seasonStats: seasonStatsScreen,
  championship: championshipScreen,
  hallOfFame: hallOfFameScreen,
  hofTeam: hofTeamScreen,
  records: recordsScreen
};

const KEY_MAP = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Enter: "a",
  z: "a",
  Z: "a",
  Escape: "b",
  x: "b",
  X: "b",
  Backspace: "b"
};

// Setting up a new game belongs to no club: the old save is still loaded until
// the new league is picked, and these are the screens where you pick it.
const SETUP_SCREENS = new Set(["intro", "nameEntry", "leagueSelect", "modeSelect"]);

// Screens in the middle of handing something over. A game in progress is written
// to the save after every decision, so walking out of one costs nothing — but
// these are the screens where the game has ended and the winnings have not all
// landed yet: a card to claim off the roster you just beat, a pack still sealed,
// a box score on its way to either. None of that is in the save, so there is no
// door on these screens; they are a few keypresses long and they end at the map.
const NO_EXIT_SCREENS = new Set([
  "gameStats",
  "seriesBreak",
  "battleResult",
  "simSeries",
  "claimCard",
  "packOpen",
  "starterReveal",
  "championship"
]);

const app = {
  save: loadSave(),
  screen: { name: "title", menuIndex: 0 },
  go(name, data = {}) {
    this.screen = { name, ...data };
    this.rerender();
  },
  rerender() {
    const root = document.getElementById("app");
    // A franchise league plays on the club's colors. Every other league — and
    // the title screen, before there is a save to ask — clears the tokens and
    // gets the stylesheet's own enamel back.
    //
    // Starting a new game is the exception. The old save is still loaded all the
    // way through the setup — the new one is not written until the league has
    // been chosen — so the screens where you choose it would otherwise be dressed
    // in the colors of the club you are leaving, and you would pick the Mets on a
    // Mariners page. Setting up a game belongs to no club, so it is shown in none.
    applyFranchisePalette(SETUP_SCREENS.has(this.screen.name) ? null : this.save?.universe);
    const screen = SCREENS[this.screen.name] ?? titleScreen;
    // Two doors, one shelf. On the title screen the way out is out of the PAGE,
    // back to the draft room — a browser link, which is exactly what it should
    // be there and has no business hanging over a man at the plate. In a game it
    // is the way out of the GAME: back to the front door, with the inning you
    // were in kept in the save and CONTINUE standing ready to put you back in it.
    const inGame = this.screen.name !== "title";
    document.querySelector(".gq-exit:not(.gq-quit)")?.toggleAttribute("hidden", inGame);
    document.querySelector(".gq-quit")?.toggleAttribute("hidden", !inGame);
    document.querySelector(".gq-corner")?.toggleAttribute("hidden", NO_EXIT_SCREENS.has(this.screen.name));
    root.innerHTML = screen.render(this);
    screen.mounted?.(this);
    // Real-player cards get their Wikipedia headshots filled in.
    hydratePhotos(root);
    // Rerendering resets scroll positions; keep the cursor row in view so
    // long lists (rosters, binder) can actually be walked.
    root.querySelector(".gq-cursor")?.scrollIntoView({ block: "nearest" });
  }
};

// Every save lives in its own card universe, keyed by its seed and league.
// Point the pool at the loaded save before anything renders a card.
// Uncapped saves print honest stickers — no bargain noise on points.
if (app.save) {
  setUniverseSeed(app.save.saveSeed, app.save.universe ?? "fictional", {
    priceNoise: app.save.mode !== "uncapped"
  });
  // A game left running is a game you are still in the middle of. Reloading the
  // tab — or closing it and coming back tomorrow — puts you back at the plate,
  // in the same inning, against the same arm, with the same men on.
  const resumed = resumeBattle(app);
  if (resumed) app.screen = resumed;
}

// The way out of a game, from inside it. Nothing is saved on the way through
// because there is nothing left to save: a game in progress is written to the
// save after every decision (see stashBattle), and every other screen writes as
// it changes things. So the front door is one press away, and so is the way back
// — CONTINUE re-deals the exact inning you walked out of.
document.querySelector(".gq-quit")?.addEventListener("click", () => {
  app.go("title", { menuIndex: 0 });
});

document.addEventListener("keydown", (event) => {
  const inInput = event.target instanceof HTMLInputElement;
  if (inInput && event.key !== "Enter" && event.key !== "Escape") return;
  // ENTER is the A button — but not while the shelf's own button has the focus,
  // where it is the button being pressed. Swallowing it there (A is preventDefault'd
  // below) would leave a control you can tab to and never fire.
  if (event.key === "Enter" && event.target.closest?.(".gq-corner")) return;
  const screen = SCREENS[app.screen.name];
  // Searchable screens (binder, catalog): while the search prompt is OPEN,
  // printable keys type into the name filter — including Z and X, so names
  // spell out; Enter confirms and Escape backs out. Outside search, only F
  // (open find) routes to typing, so Z and X always work as buttons and X
  // cancels menus exactly like Escape and Backspace do.
  if (screen?.typed && !event.ctrlKey && !event.metaKey && !event.altKey) {
    const printable = event.key.length === 1 && /[a-z0-9 .'*-]/i.test(event.key);
    if (printable && (app.screen.searching || event.key.toLowerCase() === "f")) {
      event.preventDefault();
      screen.typed(app, event.key);
      return;
    }
    if (event.key === "Backspace" && app.screen.query) {
      event.preventDefault();
      screen.typed(app, "\b");
      return;
    }
  }
  const key = KEY_MAP[event.key];
  if (!key) return;
  event.preventDefault();
  screen?.key?.(app, key);
});

// Mouse/touch parity: clicking a menu row moves the cursor there; clicking
// the row that is already selected confirms it.
document.addEventListener("click", (event) => {
  // The win-probability chart is the log read sideways: touching a play on the
  // line snaps the list to that row (and rerender scrolls the cursor into view).
  const point = event.target.closest("[data-log-index]");
  if (point) {
    // The chart hangs over two different logs — the live one (logIndex) and the
    // finished one on the box-score screen (index) — so it moves whichever
    // cursor the screen it is standing on actually keeps.
    app.screen[clickCursorField(app.screen)] = Number(point.dataset.logIndex);
    app.rerender();
    return;
  }
  const row = event.target.closest("[data-menu-index]");
  if (!row) return;
  const index = Number(row.dataset.menuIndex);
  const screen = SCREENS[app.screen.name];
  if (!screen?.key) return;
  const field = clickCursorField(app.screen);
  if (app.screen[field] === index) {
    screen.key(app, "a");
  } else {
    app.screen[field] = index;
    app.rerender();
  }
});

function clickCursorField(screen) {
  if (screen.actionMenu) return "actionIndex";
  if (screen.mode === "team-swap") return "pickIndex";
  // The record book's top-five board is its own cursor while you are standing in it.
  if (screen.mode === "board") return "boardIndex";
  if (screen.mode === "pen") return "penIndex";
  if (screen.mode === "pick" || screen.mode === "switchPos") return "pickIndex";
  if (screen.mode === "rosters") return "rosterIndex";
  if (screen.mode === "stats") return "statIndex";
  if (screen.mode === "scout") return "scoutIndex";
  if (screen.mode === "log") return "logIndex";
  if (screen.confirming) return "confirmIndex";
  if (screen.menuIndex !== undefined) return "menuIndex";
  return "index";
}

// The rest of the Game Boy: an on-screen D-pad and A/B buttons for touch
// devices (CSS shows them on coarse pointers / small windows). They feed the
// exact same per-screen key handler as the keyboard, with hold-to-repeat so
// long lists stay walkable.
const controls = document.createElement("div");
controls.className = "gq-controls";
controls.innerHTML = `
  <div class="gq-dpad">
    <button type="button" class="gq-btn gq-dpad-up" data-gq-key="up" aria-label="Up">&#9650;</button>
    <button type="button" class="gq-btn gq-dpad-left" data-gq-key="left" aria-label="Left">&#9664;</button>
    <span class="gq-btn gq-dpad-center" aria-hidden="true"></span>
    <button type="button" class="gq-btn gq-dpad-right" data-gq-key="right" aria-label="Right">&#9654;</button>
    <button type="button" class="gq-btn gq-dpad-down" data-gq-key="down" aria-label="Down">&#9660;</button>
  </div>
  <div class="gq-ab">
    <button type="button" class="gq-btn" data-gq-key="b" aria-label="B — back">B</button>
    <button type="button" class="gq-btn" data-gq-key="a" aria-label="A — confirm">A</button>
  </div>`;
document.body.appendChild(controls);

let repeatTimer = null;
function stopRepeat() {
  clearTimeout(repeatTimer);
  clearInterval(repeatTimer);
  repeatTimer = null;
}

controls.addEventListener("pointerdown", (event) => {
  const key = event.target.closest("[data-gq-key]")?.dataset.gqKey;
  if (!key) return;
  event.preventDefault();
  const press = () => SCREENS[app.screen.name]?.key?.(app, key);
  press();
  stopRepeat();
  if (key === "up" || key === "down") {
    repeatTimer = setTimeout(() => {
      repeatTimer = setInterval(press, 130);
    }, 400);
  }
});
for (const done of ["pointerup", "pointercancel", "pointerleave"]) {
  controls.addEventListener(done, stopRepeat);
}

// Hovering a row that maps to a card (screens expose hoverCard) floats the
// full card panel next to the cursor — the quickest way to read a chart.
// Any element can also opt in directly with data-card-id (batter and pitcher
// names in the matchup, runners on the base icons).
const tooltip = document.createElement("div");
tooltip.className = "gq-tooltip";
tooltip.hidden = true;
document.body.appendChild(tooltip);

function hoveredCard(target) {
  const tagged = target.closest?.("[data-card-id]");
  if (tagged) return cardById(tagged.dataset.cardId);
  const row = target.closest?.("[data-menu-index]");
  return row ? SCREENS[app.screen.name]?.hoverCard?.(app, Number(row.dataset.menuIndex)) : null;
}

// Plain-text hover notes (e.g. the HUD's team defense summary) render as a
// small panel of their own — the card face is a picture card now, not a
// text box.
function notePanelHtml(note) {
  const [title, ...lines] = note.split("\n");
  return `<div class="gq-note-panel"><div class="gq-note-title">${escapeHtml(title)}</div>${lines
    .map((line) => `<div class="gq-note-row">${escapeHtml(line)}</div>`)
    .join("")}</div>`;
}

document.addEventListener("mouseover", (event) => {
  const card = hoveredCard(event.target);
  const note = event.target.closest?.("[data-hover-note]");
  if (card) {
    tooltip.innerHTML = cardPanelHtml(card);
    hydratePhotos(tooltip);
  } else if (note) {
    tooltip.innerHTML = notePanelHtml(note.dataset.hoverNote);
  } else {
    tooltip.hidden = true;
    return;
  }
  tooltip.hidden = false;
});

document.addEventListener("mousemove", (event) => {
  if (tooltip.hidden) return;
  const pad = 14;
  const rect = tooltip.getBoundingClientRect();
  const x = Math.min(event.clientX + pad, window.innerWidth - rect.width - pad);
  const y = Math.min(event.clientY + pad, window.innerHeight - rect.height - pad);
  tooltip.style.left = `${Math.max(pad, x)}px`;
  tooltip.style.top = `${Math.max(pad, y)}px`;
});

document.addEventListener("mouseout", (event) => {
  if (!event.relatedTarget || !event.relatedTarget.closest?.("[data-menu-index], [data-card-id], [data-hover-note]")) {
    tooltip.hidden = true;
  }
});

// Touch has no hover: tapping a tagged element (batter, pitcher, a runner on
// a base, the HUD's team defense) toggles its panel near it instead.
document.addEventListener("click", (event) => {
  const tagged = event.target.closest?.("[data-card-id], [data-hover-note]");
  if (!tagged) {
    if (!tooltip.hidden && !event.target.closest?.("[data-menu-index]")) tooltip.hidden = true;
    return;
  }
  const card = tagged.dataset.cardId ? cardById(tagged.dataset.cardId) : null;
  if (tagged.dataset.cardId && !card) return;
  if (!tooltip.hidden) {
    tooltip.hidden = true;
    return;
  }
  if (card) {
    tooltip.innerHTML = cardPanelHtml(card);
    hydratePhotos(tooltip);
  } else {
    tooltip.innerHTML = notePanelHtml(tagged.dataset.hoverNote);
  }
  tooltip.hidden = false;
  const anchor = tagged.getBoundingClientRect();
  const pad = 10;
  const rect = tooltip.getBoundingClientRect();
  tooltip.style.left = `${Math.max(pad, Math.min(anchor.left, window.innerWidth - rect.width - pad))}px`;
  tooltip.style.top = `${Math.max(pad, Math.min(anchor.bottom + pad, window.innerHeight - rect.height - pad))}px`;
});

app.rerender();
