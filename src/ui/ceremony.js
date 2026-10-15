// The reveal ceremony's screen.
//
// The beats STACK. Each one is appended below the last and keeps updating for
// the rest of the run, so by the end the whole season is on one page and
// nothing that was revealed has been thrown away. That rules out redrawing: a
// module is written once and then patched in place, and when a rank changes
// hands only the row that changed is turned over. Re-rendering a beat would
// restart every animation above it and throw the dice away mid-tumble.
//
// Nothing here reaches into a batch state: it takes a plain snapshot and a way
// to look a card up by id, so the same frame can be drawn by the browser that
// ran the season and by the five watching it over the room's relay.
import { cardPanelHtml, escapeHtml, shortName, stripCardYear } from "./cardFace.js?v=20260716-records";
import { raceColor } from "./render.js?v=20260725-prep-tiers";
import { storyAdvantage } from "./gameStory.js?v=20260725-throw-labels";

const MODULE_TITLES = {
  traits: ["Who leads what", "The room so far"],
  leaders: ["League leaders", "Nobody is safe yet"],
  mvp: ["And the award goes to", "Sim MVP"],
  cy: ["And the award goes to", "Cy Young"],
  reckoning: ["The draft, judged", "What the room actually got"],
  countdown: ["Final standings", "Counting down"],
  finalists: ["The last two", "Two left"],
  game: ["The championship game", "One meeting of the two"],
  epilogue: ["The season in one line", "How it unfolded"]
};

// ---- the shell ---------------------------------------------------------------

export function ceremonyShellHtml() {
  return `<section class="panel ceremony">
    <div class="ceremony-rail">
      <span class="rail-tag" data-rail="tag">Simulating</span>
      <span class="rail-bar"><i data-rail="fill"></i></span>
      <span class="rail-count" data-rail="count">0</span>
    </div>
    <div class="ceremony-feed" data-feed></div>
    <div class="ceremony-foot">
      <p class="ceremony-sample" data-rail="sample"></p>
      <button type="button" class="small ceremony-skip" data-action="ceremony-skip">Skip the ceremony</button>
    </div>
  </section>`;
}

// Appends whatever is new, patches whatever is already there. The only thing
// ever replaced is a row whose man has changed.
export function syncCeremony(root, state, options = {}) {
  const feed = root.querySelector("[data-feed]");
  if (!feed) return;
  paintRail(root, state);
  for (const key of state.opened ?? []) {
    let module = feed.querySelector(`[data-module="${key}"]`);
    if (!module) {
      feed.insertAdjacentHTML("beforeend", moduleHtml(key, state, options));
      module = feed.lastElementChild;
      const landing = module;
      requestAnimationFrame(() => {
        landing.classList.add("arrived");
        // The page follows the ceremony down: the newest beat is on screen and
        // everything before it is still there, above, still moving.
        landing.scrollIntoView({ behavior: "smooth", block: "end" });
      });
    }
    // A beat opens before its figures exist — the first one opens before a
    // single game has been summarised, and the championship game opens before
    // the search for one has finished. When what the module is MADE of changes
    // (no rows to six rows, no game to a game) its body is written again;
    // anything smaller than that is patched, never redrawn.
    const shape = moduleShape(key, state);
    if (module.dataset.shape !== shape) {
      module.dataset.shape = shape;
      const body = module.querySelector(".module-body");
      if (body) body.innerHTML = bodyHtml(key, state, options);
    }
    patchModule(module, key, state, options);
  }
}

function paintRail(root, state) {
  const share = state.total ? Math.min(1, state.completed / state.total) : 0;
  const done = share >= 1;
  const set = (key, text) => {
    const node = root.querySelector(`[data-rail="${key}"]`);
    if (node && node.textContent !== text) node.textContent = text;
  };
  const fill = root.querySelector('[data-rail="fill"]');
  if (fill) fill.style.width = `${(share * 100).toFixed(1)}%`;
  set("tag", done ? "Season complete" : "Simulating");
  set("count", `${num(state.completed)} of ${num(state.total)}`);
  set("sample", done
    ? `All ${num(state.total)} games played.`
    : `Everything here is still being simulated — ${num(state.completed)} games in.`);
  root.querySelector(".ceremony-rail")?.classList.toggle("complete", done);
}

function num(value) {
  return Number(value ?? 0).toLocaleString("en-US");
}

// What a module is made of, as opposed to what it currently says. The names
// and numbers inside are patched; this only changes when the module's frame
// does.
function moduleShape(key, state) {
  switch (key) {
    case "traits": return (state.traits ?? []).map((trait) => trait.key).join(",");
    case "leaders": return (state.leaders ?? []).map((leader) => leader.key).join(",");
    case "mvp": return state.mvp ? "award" : "";
    case "cy": return state.cy ? "award" : "";
    case "reckoning": return [
      (state.reckoning?.hitters ?? []).length,
      (state.reckoning?.pitchers ?? []).length
    ].join(",");
    case "countdown": return (state.counted ?? []).map((row) => row.place).join(",");
    case "finalists": return (state.finalists ?? []).length ? "pair" : "";
    case "game": return `game:${state.game?.index ?? "none"}`;
    case "epilogue": return "chart";
    default: return "";
  }
}

function moduleHtml(key, state, options) {
  const [eyebrow, title] = MODULE_TITLES[key] ?? ["", ""];
  return `<section class="ceremony-module" data-module="${key}">
    <header class="module-head">
      <p class="eyebrow">${escapeHtml(eyebrow)}</p>
      <h2>${escapeHtml(title)}</h2>
    </header>
    <div class="module-body">${bodyHtml(key, state, options)}</div>
  </section>`;
}

function bodyHtml(key, state, options) {
  switch (key) {
    case "traits": return traitsHtml(state);
    case "leaders": return leadersHtml(state, options);
    case "mvp": return awardHtml(state.mvp, state, options);
    case "cy": return awardHtml(state.cy, state, options);
    case "reckoning": return reckoningHtml(state, options);
    case "countdown": return countdownHtml(state);
    case "finalists": return finalistsHtml(state);
    case "game": return gameHtml(state, options);
    case "epilogue": return `<div class="epilogue-chart">${options.raceChart ?? ""}</div>`;
    default: return "";
  }
}

// ---- the manager, said loudly ------------------------------------------------
//
// Every card on this screen belongs to somebody, and whose it is matters as
// much as the card. The chip wears the manager's own colour from the race
// chart, so a club reads the same here as it does everywhere else.
function manager(state, team, extra = "") {
  const index = (state.teamNames ?? []).indexOf(team);
  const color = raceColor(index >= 0 ? index : 0);
  return `<span class="manager-chip${extra ? ` ${extra}` : ""}" style="--chip:${color}">${escapeHtml(team ?? "")}</span>`;
}

// ---- the beats ---------------------------------------------------------------

function traitsHtml(state) {
  return `<div class="plaque-grid">${(state.traits ?? []).map((trait) => `
    <div class="plaque" data-row="${trait.key}" data-id="${escapeHtml(trait.team)}">
      <div data-swap>${plaqueInner(state, trait)}</div>
    </div>`).join("")}</div>`;
}

function plaqueInner(state, trait) {
  return `<span class="plaque-cat">${escapeHtml(trait.label)}</span>
    ${manager(state, trait.team, "big")}
    <span class="plaque-val" data-val="${trait.key}">${escapeHtml(trait.value)}</span>`;
}

function leadersHtml(state, options) {
  return `<div class="leader-list">${(state.leaders ?? []).map((leader) => `
    <div class="leader-row" data-row="${leader.key}" data-id="${escapeHtml(leader.id)}">
      <div data-swap>${leaderInner(state, leader, options)}</div>
    </div>`).join("")}</div>`;
}

function leaderInner(state, leader, options) {
  return `<span class="cer-leader-card">${miniCard(leader.id, options)}</span>
    <span class="leader-who">
      <b>${escapeHtml(shortName(stripCardYear(leader.name)))}</b>
      <em>${escapeHtml(leader.label)}</em>
    </span>
    ${manager(state, leader.team)}
    <span class="leader-value" data-val="${leader.key}">${escapeHtml(leader.value)}</span>`;
}

function awardHtml(award, state, options) {
  if (!award) return `<p class="lede">Still being decided.</p>`;
  return `<div class="award-stage" data-row="award" data-id="${escapeHtml(award.id)}">
    <div data-swap>${awardInner(award, state, options)}</div>
  </div>`;
}

function awardInner(award, state, options) {
  const card = options.cardFor?.(award.id) ?? null;
  return `<div class="cer-award-card">${card ? cardPanelHtml(card) : ""}</div>
    <div class="award-copy">
      <p class="award-name">${escapeHtml(stripCardYear(award.name))}</p>
      <p class="award-owner">${manager(state, award.team, "big")}<span>drafted him</span></p>
      <p class="award-headline" data-val="headline">${escapeHtml(award.headline)}</p>
      ${award.split ? splitHtml(award.split) : ""}
      <p class="award-lines" data-val="detail">${escapeHtml(award.detail ?? "")}</p>
    </div>`;
}

// WPAR the way the engine stores it. Zero sits in the middle of each track,
// because a component can be negative and a glove that costs you games should
// look like it costs you.
function splitHtml(split) {
  const rows = [["hitting", "Hitting"], ["baserunning", "Baserunning"], ["defense", "Defense"], ["pitching", "Pitching"]]
    .filter(([key]) => Number.isFinite(split[key]) && Math.abs(split[key]) >= 0.05);
  if (!rows.length) return "";
  return `<div class="wpar-split">${rows.map(([key, label]) => `
    <div class="split-row" data-split="${key}">
      <span class="split-key">${label}</span>
      <span class="split-track"><i></i></span>
      <span class="split-value"></span>
    </div>`).join("")}</div>`;
}

function reckoningHtml(state, options) {
  const board = state.reckoning;
  if (!board) return "";
  const column = (title, rows, side) => `<div class="reckon-side">
    <p class="reckon-head">${title}</p>
    ${rows.map((entry) => `
      <div class="reckon-row${entry.steal ? " bargain" : ""}" data-row="${side}${entry.rank}" data-id="${escapeHtml(entry.id)}">
        <div data-swap>${reckonInner(state, entry, board, options)}</div>
      </div>`).join("")}
  </div>`;
  return `<div class="reckon-board">
    ${column("Top three hitters", board.hitters ?? [], "h")}
    ${column("Top three pitchers", board.pitchers ?? [], "p")}
  </div>`;
}

function reckonInner(state, entry, board, options) {
  return `<span class="reckon-rank">${entry.rank}</span>
    <span class="reckon-card">${miniCard(entry.id, options)}</span>
    <span class="reckon-who">
      <b>${escapeHtml(shortName(stripCardYear(entry.name)))}</b>
      <em><span data-val="v-${escapeHtml(entry.id)}">${escapeHtml(entry.value)}</span> ${board.byWpar ? "WPAR" : "WPA"}</em>
    </span>
    ${manager(state, entry.team)}
    <span class="reckon-cost">${costLabel(entry.cost, board.byMoney)}</span>`;
}

function costLabel(cost, byMoney) {
  if (cost === null || cost === undefined) return "";
  return byMoney ? `<em>Paid</em><b>$${num(cost)}</b>` : `<em>Pick</em><b>#${cost}</b>`;
}

function countdownHtml(state) {
  return `<div class="placard-stack">${(state.counted ?? []).map((row) => `
    <div class="placard" data-row="p${row.place}" data-id="${escapeHtml(row.team)}">
      <div data-swap>
        <span class="placard-pos">${row.place}</span>
        ${manager(state, row.team, "big")}
        <span class="placard-record">${row.wins}&ndash;${row.losses}</span>
        <span class="placard-pct">${formatPct(row.winPct)}</span>
      </div>
    </div>`).join("")}</div>`;
}

function finalistsHtml(state) {
  const [first, second] = state.finalists ?? [];
  if (!first || !second) return "";
  return `<div class="finalists">
      ${manager(state, first.team, "huge")}
      <span class="finalist-and">and</span>
      ${manager(state, second.team, "huge")}
    </div>
    <p class="finalists-note">One of them won the room. They met ${num(state.meetings)} times. Here is one of them.</p>`;
}

function formatPct(value) {
  return Number(value ?? 0).toFixed(3).replace(/^0/, "");
}

// ---- the championship game ---------------------------------------------------
//
// The board is the thing: who is batting, what the score is, who is on and how
// many are out, in type big enough to follow from across the room. The duel
// below says what the two men did about it.
function gameHtml(state, options) {
  const game = state.game;
  if (!game) {
    return `<p class="lede">Looking through every meeting of the top two for the one that says what usually happened.</p>`;
  }
  return `<div class="replay" data-row="game" data-id="${game.index}">
    <p class="replay-sub">Game ${num(game.index + 1)} &middot; one of their ${num(game.meetings)} meetings</p>
    <div class="scoreboard">
      <div class="sb-side" data-side="away">
        ${manager(state, game.away, "big")}
        <span class="sb-runs" data-board="runs-away">0</span>
      </div>
      <div class="sb-middle">
        <span class="sb-inning" data-board="inning">&nbsp;</span>
        <span class="sb-diamond" data-board="diamond">
          <i data-base="1"></i><i data-base="2"></i><i data-base="3"></i><i data-base="home"></i>
        </span>
        <span class="sb-outs" data-board="outs"><i></i><i></i><i></i></span>
        <span class="sb-wp" data-board="wp"></span>
      </div>
      <div class="sb-side" data-side="home">
        ${manager(state, game.home, "big")}
        <span class="sb-runs" data-board="runs-home">0</span>
      </div>
    </div>
    <p class="now-batting" data-board="now">&nbsp;</p>
    <div class="line-score-wrap">${lineScoreHtml(game)}</div>
    <div class="replay-duel" data-board="duel"></div>
    <div class="replay-stamp" data-board="stamp" hidden>
      <b data-board="stamp-score"></b>
      <em data-board="stamp-share"></em>
    </div>
  </div>`;
}

function lineScoreHtml(game) {
  const innings = game.innings ?? 9;
  const header = Array.from({ length: innings }, (_, i) => `<th>${i + 1}</th>`).join("");
  const row = (side) => {
    const name = side === "away" ? game.away : game.home;
    const cells = Array.from({ length: innings }, (_, i) => `<td data-ls="${side}-${i}"></td>`).join("");
    return `<tr><td class="ls-team">${escapeHtml(name)}</td>${cells}
      <td class="ls-total" data-ls="${side}-r"></td>
      <td class="ls-total" data-ls="${side}-h"></td></tr>`;
  };
  return `<table class="line-score">
    <thead><tr><th class="ls-team"></th>${header}<th>R</th><th>H</th></tr></thead>
    <tbody>${row("away")}${row("home")}</tbody>
  </table>`;
}

// The two men, their cards, and the dice between them.
export function duelHtml(state, game, options) {
  const moment = game?.moment;
  if (!moment) return "";
  const event = moment.event;
  const batter = options.cardFor?.(event.batterId) ?? null;
  const pitcher = options.cardFor?.(event.pitcherId) ?? null;
  const advantage = storyAdvantage(event);
  return `<div class="duel" data-phase="${moment.phase}">
    <div class="duel-card">
      <p class="duel-role">${manager(state, event.pitchingTeam)}<span>pitching</span></p>
      ${pitcher ? cardPanelHtml(pitcher) : ""}
      <p class="duel-name">${escapeHtml(shortName(stripCardYear(event.pitcher ?? "")))}</p>
    </div>
    <div class="duel-middle">
      <span class="duel-leverage${moment.leverage >= 3 ? " hot" : ""}">Leverage ${moment.leverage.toFixed(1)}</span>
      <div class="duel-roll" data-roll="control">
        <span class="roll-label">Pitch</span>
        <span class="die" data-board="die-control">&middot;</span>
        <span class="roll-math" data-board="math-control"></span>
      </div>
      <p class="duel-advantage ${advantage ? `${advantage.key}-advantage` : ""}">${advantage ? escapeHtml(advantage.label) : ""}</p>
      <div class="duel-roll" data-roll="swing">
        <span class="roll-label">Swing</span>
        <span class="die" data-board="die-swing">&middot;</span>
        <span class="roll-math" data-board="math-swing"></span>
      </div>
      <p class="duel-result" data-board="result"></p>
    </div>
    <div class="duel-card">
      <p class="duel-role">${manager(state, event.battingTeam)}<span>batting</span></p>
      ${batter ? cardPanelHtml(batter) : ""}
      <p class="duel-name">${escapeHtml(shortName(stripCardYear(event.batter ?? "")))}</p>
    </div>
  </div>`;
}

function miniCard(id, options) {
  const card = options.cardFor?.(id) ?? null;
  return card ? `<span class="mini-card">${cardPanelHtml(card)}</span>` : "";
}

// The chart prints codes; the call says what happened.
const RESULT_WORDS = {
  SO: "Strikeout", PU: "Pop out", GB: "Groundout", FB: "Flyout",
  BB: "Walk", HBP: "Hit by pitch", "1B": "Single", "1B+": "Single",
  "2B": "Double", "3B": "Triple", HR: "Home run"
};

export function resultWord(result) {
  return RESULT_WORDS[result] ?? String(result ?? "");
}

// ---- patching ----------------------------------------------------------------

function patchModule(module, key, state, options) {
  switch (key) {
    case "traits":
      for (const trait of state.traits ?? []) {
        swapRow(module, trait.key, trait.team, () => plaqueInner(state, trait));
        setVal(module, trait.key, trait.value);
      }
      return;
    case "leaders":
      for (const leader of state.leaders ?? []) {
        swapRow(module, leader.key, leader.id, () => leaderInner(state, leader, options));
        setVal(module, leader.key, leader.value);
      }
      return;
    case "mvp":
    case "cy": {
      const award = state[key];
      if (!award) return;
      swapRow(module, "award", award.id, () => awardInner(award, state, options));
      setVal(module, "headline", award.headline);
      setVal(module, "detail", award.detail ?? "");
      patchSplit(module, award.split);
      return;
    }
    case "reckoning": {
      const board = state.reckoning;
      if (!board) return;
      const rows = [
        ...(board.hitters ?? []).map((entry) => [`h${entry.rank}`, entry]),
        ...(board.pitchers ?? []).map((entry) => [`p${entry.rank}`, entry])
      ];
      for (const [rowKey, entry] of rows) {
        swapRow(module, rowKey, entry.id, () => reckonInner(state, entry, board, options));
        setVal(module, `v-${entry.id}`, entry.value);
      }
      return;
    }
    default:
  }
}

// A row whose man has changed turns over: the old one leaves, the new one
// arrives, and nothing else on the page moves. This is the whole reason a
// module is never re-rendered.
function swapRow(module, rowKey, id, build) {
  const row = module.querySelector(`[data-row="${rowKey}"]`);
  if (!row || row.dataset.id === String(id)) return row;
  row.dataset.id = String(id);
  const slot = row.querySelector("[data-swap]");
  if (!slot) return row;
  slot.classList.remove("swap-in");
  slot.classList.add("swap-out");
  setTimeout(() => {
    slot.innerHTML = build();
    slot.classList.remove("swap-out");
    slot.classList.add("swap-in");
  }, 220);
  return row;
}

function setVal(module, key, text) {
  const node = module.querySelector(`[data-val="${key}"]`);
  if (node && node.textContent !== text) node.textContent = text;
}

function patchSplit(module, split) {
  if (!split) return;
  const rows = [...module.querySelectorAll(".split-row")];
  const peak = Math.max(0.2, ...rows.map((row) => Math.abs(Number(split[row.dataset.split]) || 0)));
  for (const row of rows) {
    const value = Number(split[row.dataset.split]);
    if (!Number.isFinite(value)) continue;
    const span = (Math.abs(value) / peak) * 45;
    const bar = row.querySelector("i");
    bar.style.left = `${value >= 0 ? 50 : 50 - span}%`;
    bar.style.width = `${span}%`;
    const label = row.querySelector(".split-value");
    if (label) label.textContent = `${value < 0 ? "−" : "+"}${Math.abs(value).toFixed(1)}`;
  }
}

export { manager as managerChip };
