import { cardPanelHtml, escapeHtml } from "./helpers.js?v=20260716-records";
import { hydratePhotos } from "../../ui/photos.js?v=20260716-records";
import { unlockSounds, soundsUnlocked, isMuted } from "../../ui/sounds.js?v=20260716-records";

// The handheld itself — everything around the screen rather than on it: the
// buttons (keyboard, and the D-pad drawn for a thumb), the cursor a click moves,
// and the card that floats under a hovered row.
//
// It is the console, not the campaign, so it belongs to neither page that runs
// one. The adventure boots it with its own shelf of screens and its own card
// pool; the draft room's exhibition game boots the same console with two screens
// and the rosters that are playing. One set of controls, so a button that works
// in one place cannot stop working in the other.

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

// A browser will not let a page make a noise until the person has touched it, so
// the console buys the right on the first button pressed — long before anything
// has anything to say. Without this the whole kit is silent and the sounds look
// broken rather than absent.
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

// `screens` is how the console finds the screen it is standing on; `cardById`
// is how it turns a tagged element into a card to float. Both differ by page,
// and nothing else here does.
export function mountConsole({ app, screens, cardById }) {
  const screenFor = () => screens[app.screen.name];

  document.addEventListener("keydown", askForSound);
  document.addEventListener("pointerdown", askForSound);

  document.addEventListener("keydown", (event) => {
    const inInput = event.target instanceof HTMLInputElement;
    if (inInput && event.key !== "Enter" && event.key !== "Escape") return;
    // ENTER is the A button — but not while the shelf's own button has the focus,
    // where it is the button being pressed. Swallowing it there (A is preventDefault'd
    // below) would leave a control you can tab to and never fire.
    if (event.key === "Enter" && event.target.closest?.(".gq-corner")) return;
    const screen = screenFor();
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
    const screen = screenFor();
    if (!screen?.key) return;
    const field = clickCursorField(app.screen);
    if (app.screen[field] === index) {
      screen.key(app, "a");
    } else {
      app.screen[field] = index;
      app.rerender();
    }
  });

  mountControls({ app, screenFor });
  mountTooltip({ app, screens, cardById });
}

function clickCursorField(screen) {
  if (screen.actionMenu) return "actionIndex";
  if (screen.mode === "team-swap") return "pickIndex";
  // The record book's top-five board is its own cursor while you are standing in it.
  if (screen.mode === "board") return "boardIndex";
  if (screen.mode === "approve") return "approveIndex";
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
function mountControls({ app, screenFor }) {
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
  const stopRepeat = () => {
    clearTimeout(repeatTimer);
    clearInterval(repeatTimer);
    repeatTimer = null;
  };

  controls.addEventListener("pointerdown", (event) => {
    const key = event.target.closest("[data-gq-key]")?.dataset.gqKey;
    if (!key) return;
    event.preventDefault();
    const press = () => screenFor()?.key?.(app, key);
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
}

// Hovering a row that maps to a card (screens expose hoverCard) floats the
// full card panel next to the cursor — the quickest way to read a chart.
// Any element can also opt in directly with data-card-id (batter and pitcher
// names in the matchup, runners on the base icons).
function mountTooltip({ app, screens, cardById }) {
  const tooltip = document.createElement("div");
  tooltip.className = "gq-tooltip";
  tooltip.hidden = true;
  document.body.appendChild(tooltip);

  const hoveredCard = (target) => {
    const tagged = target.closest?.("[data-card-id]");
    if (tagged) return cardById(tagged.dataset.cardId);
    const row = target.closest?.("[data-menu-index]");
    return row ? screens[app.screen.name]?.hoverCard?.(app, Number(row.dataset.menuIndex)) : null;
  };

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
