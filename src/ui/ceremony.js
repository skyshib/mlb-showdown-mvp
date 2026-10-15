// The reveal ceremony's screen. Every beat is drawn once when it opens and
// then PATCHED in place while it is up — the figures on it are still being
// simulated, and re-rendering the whole thing twice a second would restart
// every animation on the page and throw away the dice mid-tumble.
//
// Nothing here reaches into a batch state: it takes a plain snapshot and a way
// to look a card up by id, so the same frame can be drawn by the browser that
// ran the season and by the five watching it over the room's relay.
import { cardPanelHtml } from "./cardFace.js?v=20260716-records";
import { escapeHtml, shortName, stripCardYear } from "./cardFace.js?v=20260716-records";
import { raceColor } from "./render.js?v=20260725-prep-tiers";
import { storyAdvantage } from "./gameStory.js?v=20260725-throw-labels";

const EYEBROWS = {
  traits: "Who leads what",
  leaders: "League leaders",
  mvp: "And the award goes to",
  cy: "And the award goes to",
  reckoning: "The draft, judged",
  countdown: "Final standings",
  finalists: "The last two",
  game: "The championship game",
  epilogue: "The season in one line"
};

export function ceremonyHtml(state, options = {}) {
  const beat = state.beat ?? "traits";
  return `<section class="panel ceremony" data-beat="${beat}">
    ${railHtml(state)}
    <div class="ceremony-stage" data-ceremony-stage>${beatHtml(state, options)}</div>
    <div class="ceremony-foot">
      <p class="ceremony-sample" data-live="sample">${sampleText(state)}</p>
      <button type="button" class="small ceremony-skip" data-action="ceremony-skip">Skip the ceremony</button>
    </div>
  </section>`;
}

// The sim, running across the top of every frame. It is the only chrome the
// wait gets: a rule crossing the screen and a count that keeps moving.
function railHtml(state) {
  const share = state.total ? Math.min(1, state.completed / state.total) : 0;
  const done = share >= 1;
  return `<div class="ceremony-rail${done ? " complete" : ""}">
    <span class="rail-tag" data-live="rail-tag">${done ? "Season complete" : "Simulating"}</span>
    <span class="rail-bar"><i data-live="rail-fill" style="width:${(share * 100).toFixed(1)}%"></i></span>
    <span class="rail-count" data-live="rail-count">${countText(state)}</span>
  </div>`;
}

function countText(state) {
  return `${Number(state.completed ?? 0).toLocaleString("en-US")} of ${Number(state.total ?? 0).toLocaleString("en-US")}`;
}

// Each beat says what it was measured over, so an early plaque that the final
// table later contradicts reads as a moment in the season and not a mistake.
function sampleText(state) {
  if (state.beat === "game" || state.beat === "epilogue") return "";
  const share = state.total ? state.completed / state.total : 0;
  if (share >= 1) return `Through all ${Number(state.total ?? 0).toLocaleString("en-US")} games.`;
  return `Through ${Number(state.completed ?? 0).toLocaleString("en-US")} games — still being played.`;
}

function beatHtml(state, options) {
  switch (state.beat) {
    case "traits": return traitsHtml(state);
    case "leaders": return leadersHtml(state, options);
    case "mvp":
    case "cy": return awardHtml(state, options);
    case "reckoning": return reckoningHtml(state, options);
    case "countdown": return countdownHtml(state);
    case "finalists": return finalistsHtml(state);
    case "game": return replayHtml(state, options);
    case "epilogue": return epilogueHtml(state, options);
    default: return "";
  }
}

function head(beat, title) {
  return `<header class="ceremony-head">
    <p class="eyebrow">${escapeHtml(EYEBROWS[beat] ?? "")}</p>
    <h1>${escapeHtml(title)}</h1>
  </header>`;
}

// ---- the beats ---------------------------------------------------------------

function traitsHtml(state) {
  const plaques = (state.traits ?? []).map((trait, index) => `
    <div class="plaque" data-plaque="${index}" style="--plaque-color:${raceColor(teamIndex(state, trait.team))}">
      <span class="plaque-cat">${escapeHtml(trait.label)}</span>
      <span class="plaque-who" data-live="trait-team-${trait.key}">${escapeHtml(trait.team)}</span>
      <span class="plaque-val" data-live="trait-value-${trait.key}">${escapeHtml(trait.value)}</span>
    </div>`).join("");
  return `${head("traits", "The room so far")}<div class="plaque-grid">${plaques}</div>`;
}

function leadersHtml(state, options) {
  const rows = (state.leaders ?? []).map((leader, index) => `
    <div class="leader-row" data-leader="${index}">
      <span class="cer-leader-card">${miniCard(leader.id, options)}</span>
      <span class="leader-who">
        <b data-live="leader-name-${leader.key}">${escapeHtml(shortName(stripCardYear(leader.name)))}</b>
        <em data-live="leader-team-${leader.key}">${escapeHtml(leader.label)} &middot; ${escapeHtml(leader.team)}</em>
      </span>
      <span class="leader-value" data-live="leader-value-${leader.key}">${escapeHtml(leader.value)}</span>
    </div>`).join("");
  return `${head("leaders", "Nobody is safe yet")}<div class="leader-list">${rows}</div>`;
}

// The award beats are the real card face, not a name in a row. The copy sits
// beside it and arrives a beat later.
function awardHtml(state, options) {
  const award = state.award;
  if (!award) return head(state.beat, "—");
  const card = options.cardFor?.(award.id) ?? null;
  return `${head(state.beat, award.label)}
    <div class="award-stage">
      <div class="cer-award-card" data-live="award-card">${card ? cardPanelHtml(card) : ""}</div>
      <div class="award-copy">
        <p class="award-name" data-live="award-name">${escapeHtml(stripCardYear(award.name))}</p>
        <p class="award-headline" data-live="award-headline">${escapeHtml(award.headline)}</p>
        ${award.split ? splitHtml(award.split) : ""}
        <p class="award-lines" data-live="award-lines">${escapeHtml(award.detail ?? "")}</p>
        <p class="award-foot"><span class="chip-team">${escapeHtml(award.team)}</span></p>
      </div>
    </div>`;
}

// WPAR the way the engine stores it. Zero sits in the middle of each track,
// because a component can be negative and a glove that costs you games should
// look like it costs you.
function splitHtml(split) {
  // Only the parts of his game that did anything. An arm's bat and glove are
  // three zeroes on a row of their own, which says nothing about the pitcher.
  const rows = [
    ["hitting", "Hitting"],
    ["baserunning", "Baserunning"],
    ["defense", "Defense"],
    ["pitching", "Pitching"]
  ].filter(([key]) => Number.isFinite(split[key]) && Math.abs(split[key]) >= 0.05);
  if (!rows.length) return "";
  return `<div class="wpar-split">${rows.map(([key, label]) => `
    <div class="split-row" data-split="${key}">
      <span class="split-key">${label}</span>
      <span class="split-track"><i data-live="split-bar-${key}"></i></span>
      <span class="split-value" data-live="split-value-${key}"></span>
    </div>`).join("")}</div>`;
}

function reckoningHtml(state, options) {
  const board = state.reckoning;
  if (!board) return head("reckoning", "—");
  const column = (title, rows, side) => `<div class="reckon-side">
    <p class="reckon-head">${title}</p>
    ${rows.map((entry) => `
      <div class="reckon-row${entry.steal ? " bargain" : ""}" data-reckon="${side}-${entry.id}">
        <span class="reckon-rank" data-live="reckon-rank-${entry.id}">${entry.rank}</span>
        <span class="reckon-card">${miniCard(entry.id, options)}</span>
        <span class="reckon-who">
          <b>${escapeHtml(shortName(stripCardYear(entry.name)))}</b>
          <em><span data-live="reckon-value-${entry.id}">${escapeHtml(entry.value)}</span> ${board.byWpar ? "WPAR" : "WPA"} &middot; ${escapeHtml(entry.team)}</em>
        </span>
        <span class="reckon-cost">${costLabel(entry.cost, board.byMoney)}</span>
      </div>`).join("")}
  </div>`;
  return `${head("reckoning", "What the room actually got")}
    <div class="reckon-board">
      ${column("Top three hitters", board.hitters, "h")}
      ${column("Top three pitchers", board.pitchers, "p")}
    </div>`;
}

function costLabel(cost, byMoney) {
  if (cost === null || cost === undefined) return "";
  return byMoney
    ? `<em>Paid</em><b>$${Number(cost).toLocaleString("en-US")}</b>`
    : `<em>Pick</em><b>#${cost}</b>`;
}

// Sixth place up to third, and there it stops: a fourth placard would name the
// champion by elimination.
function countdownHtml(state) {
  const rows = (state.counted ?? []).map((row, index) => `
    <div class="placard" data-placard="${index}">
      <span class="placard-pos">${row.place}</span>
      <span class="placard-name">${escapeHtml(row.team)}</span>
      <span class="placard-record">${row.wins}&ndash;${row.losses}</span>
      <span class="placard-pct">${formatPct(row.winPct)}</span>
    </div>`).join("");
  return `${head("countdown", "Counting down")}<div class="placard-stack">${rows}</div>`;
}

function finalistsHtml(state) {
  const [first, second] = state.finalists ?? [];
  if (!first || !second) return head("finalists", "—");
  return `${head("finalists", "Two left")}
    <div class="finalists">
      <span class="finalist">${escapeHtml(first.team)}</span>
      <span class="finalist-and">and</span>
      <span class="finalist">${escapeHtml(second.team)}</span>
    </div>
    <p class="finalists-note">One of them won the room. They met ${Number(state.meetings ?? 0).toLocaleString("en-US")} times. Here is one of them.</p>`;
}

function formatPct(value) {
  return Number(value ?? 0).toFixed(3).replace(/^0/, "");
}

// ---- the championship game ---------------------------------------------------

function replayHtml(state, options) {
  const game = state.game;
  if (!game) return head("game", "—");
  return `<div class="replay">
    <header class="replay-head">
      <span class="replay-flag">Game ${Number(game.index + 1).toLocaleString("en-US")}</span>
      <span class="replay-sub">${escapeHtml(game.away)} at ${escapeHtml(game.home)} &middot; one of their ${Number(game.meetings ?? 0).toLocaleString("en-US")} meetings</span>
    </header>
    ${wpChartHtml(game)}
    ${lineScoreHtml(game)}
    <div class="replay-duel" data-live="duel">${duelHtml(game, options)}</div>
    <div class="replay-stamp" data-live="stamp" hidden>
      <b data-live="stamp-score"></b>
      <em data-live="stamp-share"></em>
    </div>
  </div>`;
}

function wpChartHtml(game) {
  return `<div class="cer-wp-chart">
    <span class="wp-side top">${escapeHtml(game.championName)}</span>
    <span class="wp-side bottom">${escapeHtml(game.challengerName)}</span>
    <svg viewBox="0 0 400 48" preserveAspectRatio="none" role="img" aria-label="Win probability through the game">
      <line class="wp-mid" x1="0" y1="24" x2="400" y2="24"></line>
      <path class="wp-line" data-live="wp-line" d="M0 24"></path>
    </svg>
    <span class="wp-now" data-live="wp-now">50.0%</span>
  </div>`;
}

function lineScoreHtml(game) {
  const innings = game.innings ?? 9;
  const header = Array.from({ length: innings }, (_, i) => `<th>${i + 1}</th>`).join("");
  const row = (side) => {
    const name = side === "away" ? game.away : game.home;
    const cells = Array.from({ length: innings }, (_, i) =>
      `<td data-live="ls-${side}-${i}"></td>`).join("");
    return `<tr>
      <td class="ls-team">${escapeHtml(name)}</td>${cells}
      <td class="ls-total" data-live="ls-${side}-r"></td>
      <td class="ls-total" data-live="ls-${side}-h"></td>
    </tr>`;
  };
  return `<div class="line-score-wrap"><table class="line-score">
    <thead><tr><th class="ls-team"></th>${header}<th>R</th><th>H</th></tr></thead>
    <tbody>${row("away")}${row("home")}</tbody>
  </table></div>`;
}

// The duel: the two cards that decided the plate appearance, the control battle
// between them, and the swing rolled off whichever chart won it. The panel
// opens on the spot — bases, outs, score, leverage — and holds there before a
// die is thrown, so the room can see what is at stake.
function duelHtml(game, options) {
  const moment = game.moment;
  if (!moment) return "";
  const event = moment.event;
  const batter = options.cardFor?.(event.batterId) ?? null;
  const pitcher = options.cardFor?.(event.pitcherId) ?? null;
  const advantage = storyAdvantage(event);
  return `<div class="duel" data-phase="${moment.phase}">
    <div class="duel-head">
      <span class="duel-inning">${escapeHtml(inningLabel(event))}</span>
      <span class="duel-leverage${moment.leverage >= 3 ? " hot" : ""}">LI ${moment.leverage.toFixed(1)}</span>
      <span class="duel-score">${escapeHtml(scoreLabel(game, event, "scoreBefore"))}</span>
    </div>
    <div class="duel-body">
      <div class="duel-card">
        <p class="duel-role">On the mound</p>
        ${pitcher ? cardPanelHtml(pitcher) : ""}
      </div>
      <div class="duel-middle">
        ${baseStateHtml("Before", event.basesBefore, event.outsBefore)}
        <div class="duel-call">
        <div class="duel-rolls">
          <div class="duel-roll" data-roll="control">
            <span class="roll-label">Pitch</span>
            <span class="die" data-live="die-control">&middot;</span>
            <span class="roll-math" data-live="math-control"></span>
          </div>
          <p class="duel-advantage ${advantage ? `${advantage.key}-advantage` : ""}" data-live="advantage">
            ${advantage ? escapeHtml(advantage.label) : ""}
          </p>
          <div class="duel-roll" data-roll="swing">
            <span class="roll-label">Swing</span>
            <span class="die" data-live="die-swing">&middot;</span>
            <span class="roll-math" data-live="math-swing"></span>
          </div>
        </div>
        <p class="duel-result" data-live="duel-result"></p>
        </div>
        ${baseStateHtml("After", event.basesAfter, event.outsAfter, true)}
      </div>
      <div class="duel-card">
        <p class="duel-role">At the plate</p>
        ${batter ? cardPanelHtml(batter) : ""}
      </div>
    </div>
  </div>`;
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

function inningLabel(event) {
  const half = event.half === "top" ? "Top" : "Bottom";
  return `${half} ${ordinal(event.inning)} · ${event.outsBefore} out`;
}

function ordinal(n) {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

function scoreLabel(game, event, which) {
  const score = event[which] ?? { away: 0, home: 0 };
  return `${game.away} ${score.away}, ${game.home} ${score.home}`;
}

function baseStateHtml(label, bases, outs, after = false) {
  const occupied = (bases ?? []).map((runner) => Boolean(runner));
  const dots = [0, 1, 2].map((i) => `<i class="${i < outs ? "out" : ""}"></i>`).join("");
  return `<div class="base-state${after ? " after" : ""}"${after ? ' data-live="base-after"' : ""}>
    <span class="base-label">${label}</span>
    <svg viewBox="0 0 100 100" aria-hidden="true">
      ${baseSquare(74, 50, occupied[0])}
      ${baseSquare(50, 26, occupied[1])}
      ${baseSquare(26, 50, occupied[2])}
      ${baseSquare(50, 74, false)}
    </svg>
    <span class="base-outs">${dots}</span>
  </div>`;
}

function baseSquare(cx, cy, on) {
  return `<rect x="${cx - 9}" y="${cy - 9}" width="18" height="18" transform="rotate(45 ${cx} ${cy})" class="${on ? "on" : ""}"></rect>`;
}

function epilogueHtml(state, options) {
  return `${head("epilogue", "How it unfolded")}
    <div class="epilogue-chart">${options.raceChart ?? ""}</div>`;
}

// A card at thumbnail size. The face is its own container, so the wrapper's
// width is the only thing that decides how big it draws.
function miniCard(id, options) {
  const card = options.cardFor?.(id) ?? null;
  return card ? `<span class="mini-card">${cardPanelHtml(card)}</span>` : "";
}

function teamIndex(state, team) {
  return (state.teamNames ?? []).indexOf(team);
}

// ---- patching ----------------------------------------------------------------
//
// Everything a running sim changes, written straight into the nodes that hold
// it. No beat is re-rendered while it is on screen.
export function patchCeremony(root, state) {
  if (!root) return;
  const set = (key, text) => {
    const node = root.querySelector(`[data-live="${key}"]`);
    if (node && node.textContent !== text) node.textContent = text;
  };
  const share = state.total ? Math.min(1, state.completed / state.total) : 0;
  const fill = root.querySelector('[data-live="rail-fill"]');
  if (fill) fill.style.width = `${(share * 100).toFixed(1)}%`;
  set("rail-count", countText(state));
  set("rail-tag", share >= 1 ? "Season complete" : "Simulating");
  root.querySelector(".ceremony-rail")?.classList.toggle("complete", share >= 1);
  set("sample", sampleText(state));

  for (const trait of state.traits ?? []) {
    set(`trait-team-${trait.key}`, trait.team);
    set(`trait-value-${trait.key}`, trait.value);
  }
  for (const leader of state.leaders ?? []) {
    set(`leader-name-${leader.key}`, shortName(stripCardYear(leader.name)));
    set(`leader-team-${leader.key}`, `${leader.label} · ${leader.team}`);
    set(`leader-value-${leader.key}`, leader.value);
  }
  if (state.award) {
    set("award-name", stripCardYear(state.award.name));
    set("award-headline", state.award.headline);
    set("award-lines", state.award.detail ?? "");
    patchSplit(root, state.award.split);
  }
  for (const entry of [...(state.reckoning?.hitters ?? []), ...(state.reckoning?.pitchers ?? [])]) {
    set(`reckon-value-${entry.id}`, entry.value);
    set(`reckon-rank-${entry.id}`, String(entry.rank));
  }
}

// Five wins reaches the end of the track; zero is the middle of it.
const SPLIT_SCALE = 45 / 5;

function patchSplit(root, split) {
  if (!split) return;
  for (const key of ["hitting", "baserunning", "defense", "pitching"]) {
    const value = Number(split[key]);
    const bar = root.querySelector(`[data-live="split-bar-${key}"]`);
    const label = root.querySelector(`[data-live="split-value-${key}"]`);
    if (!bar || !Number.isFinite(value)) continue;
    const span = Math.min(45, Math.abs(value) * SPLIT_SCALE);
    bar.style.left = `${value >= 0 ? 50 : 50 - span}%`;
    bar.style.width = `${span}%`;
    if (label) label.textContent = `${value < 0 ? "−" : "+"}${Math.abs(value).toFixed(1)}`;
  }
}

export { duelHtml };
