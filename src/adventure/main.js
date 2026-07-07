import { loadSave } from "./state.js";
import { setUniverseSeed, cardById } from "./packs.js";
import { cardPanelHtml } from "./ui/helpers.js";
import { titleScreen, introScreen, nameEntryScreen, starterRevealScreen } from "./ui/titleScreens.js";
import { mapScreen, trainerIntroScreen, ambushScreen } from "./ui/mapScreen.js";
import { battleScreen, seriesBreakScreen, battleResultScreen, simSeriesScreen, claimCardScreen } from "./ui/battleScreen.js";
import { shopScreen, sellScreen, binderScreen, teamScreen, lineupScreen, packOpenScreen } from "./ui/collectionScreens.js";
import { gameStatsScreen, seasonStatsScreen, championshipScreen } from "./ui/statsScreens.js";

const SCREENS = {
  title: titleScreen,
  intro: introScreen,
  nameEntry: nameEntryScreen,
  starterReveal: starterRevealScreen,
  map: mapScreen,
  trainerIntro: trainerIntroScreen,
  ambush: ambushScreen,
  battle: battleScreen,
  seriesBreak: seriesBreakScreen,
  battleResult: battleResultScreen,
  simSeries: simSeriesScreen,
  claimCard: claimCardScreen,
  shop: shopScreen,
  sell: sellScreen,
  binder: binderScreen,
  team: teamScreen,
  lineup: lineupScreen,
  packOpen: packOpenScreen,
  gameStats: gameStatsScreen,
  seasonStats: seasonStatsScreen,
  championship: championshipScreen
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

const app = {
  save: loadSave(),
  screen: { name: "title", menuIndex: 0 },
  go(name, data = {}) {
    this.screen = { name, ...data };
    this.rerender();
  },
  rerender() {
    const root = document.getElementById("app");
    const screen = SCREENS[this.screen.name] ?? titleScreen;
    root.innerHTML = screen.render(this);
    screen.mounted?.(this);
    // Rerendering resets scroll positions; keep the cursor row in view so
    // long lists (rosters, binder) can actually be walked.
    root.querySelector(".gq-cursor")?.scrollIntoView({ block: "nearest" });
  }
};

// Every save lives in its own card universe, keyed by its seed. Point the
// pool at the loaded save before anything renders a card.
if (app.save) setUniverseSeed(app.save.saveSeed);

document.addEventListener("keydown", (event) => {
  const inInput = event.target instanceof HTMLInputElement;
  if (inInput && event.key !== "Enter" && event.key !== "Escape") return;
  const key = KEY_MAP[event.key];
  if (!key) return;
  event.preventDefault();
  SCREENS[app.screen.name]?.key?.(app, key);
});

// Mouse/touch parity: clicking a menu row moves the cursor there; clicking
// the row that is already selected confirms it.
document.addEventListener("click", (event) => {
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
  if (screen.mode === "pen") return "penIndex";
  if (screen.mode === "pick") return "pickIndex";
  if (screen.mode === "rosters") return "rosterIndex";
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

document.addEventListener("mouseover", (event) => {
  const card = hoveredCard(event.target);
  if (!card) {
    tooltip.hidden = true;
    return;
  }
  tooltip.innerHTML = cardPanelHtml(card);
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
  if (!event.relatedTarget || !event.relatedTarget.closest?.("[data-menu-index], [data-card-id]")) {
    tooltip.hidden = true;
  }
});

// Touch has no hover: tapping a card-tagged element (batter, pitcher, a
// runner on a base) toggles the card panel near it instead.
document.addEventListener("click", (event) => {
  const tagged = event.target.closest?.("[data-card-id]");
  if (!tagged) {
    if (!tooltip.hidden && !event.target.closest?.("[data-menu-index]")) tooltip.hidden = true;
    return;
  }
  const card = cardById(tagged.dataset.cardId);
  if (!card) return;
  if (!tooltip.hidden) {
    tooltip.hidden = true;
    return;
  }
  tooltip.innerHTML = cardPanelHtml(card);
  tooltip.hidden = false;
  const anchor = tagged.getBoundingClientRect();
  const pad = 10;
  const rect = tooltip.getBoundingClientRect();
  tooltip.style.left = `${Math.max(pad, Math.min(anchor.left, window.innerWidth - rect.width - pad))}px`;
  tooltip.style.top = `${Math.max(pad, Math.min(anchor.bottom + pad, window.innerHeight - rect.height - pad))}px`;
});

app.rerender();
