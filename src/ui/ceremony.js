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

// The beats that read "and the award goes to" say it UNDER the award's name,
// the way an announcer does: the name is the thing on screen, and the line is
// what is being said about it.
const EYEBROW_UNDER = new Set(["mvp", "cy"]);

const MODULE_TITLES = {
  traits: ["Who leads what", "The room so far"],
  leaders: ["League leaders", null],
  mvp: ["And the award goes to", "Sim MVP"],
  cy: ["And the award goes to", "Cy Young"],
  reckoning: ["The draft, judged", "Best and Worst Value Picks"],
  countdown: ["Final standings", "Counting down"],
  finalists: ["The last two", "Two left"],
  game: ["The championship game", "One meeting of the two"],
  epilogue: ["The season in one line", "How it unfolded"]
};

// ---- the shell ---------------------------------------------------------------

// `replay` is a rewatch of a season already played: nothing is being waited
// for, so the way out is a way back rather than a way past.
export function ceremonyShellHtml({ replay = false } = {}) {
  return `<section class="panel ceremony${replay ? " ceremony-replay" : ""}">
    <div class="ceremony-rail">
      <span class="rail-tag" data-rail="tag">Simulating</span>
      <span class="rail-bar"><i data-rail="fill"></i></span>
      <span class="rail-count" data-rail="count">0</span>
    </div>
    <div class="ceremony-feed" data-feed></div>
    <div class="ceremony-foot">
      <button type="button" class="small ceremony-skip" data-action="ceremony-skip">${replay ? "Back to the results" : "Skip the ceremony"}</button>
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
    let arriving = false;
    if (!module) {
      feed.insertAdjacentHTML("beforeend", moduleHtml(key, state, options));
      module = feed.lastElementChild;
      arriving = true;
      const landing = module;
      requestAnimationFrame(() => landing.classList.add("arrived"));
    }
    // A beat opens before its figures exist — the first one opens before a
    // single game has been summarised, and the championship game opens before
    // the search for one has finished. When what the module is MADE of changes
    // (no rows to six rows, no game to a game) its body is written again;
    // anything smaller than that is patched, never redrawn.
    const shape = moduleShape(key, state);
    const filling = module.dataset.shape !== shape;
    if (filling) {
      module.dataset.shape = shape;
      const body = module.querySelector(".module-body");
      if (body) body.innerHTML = bodyHtml(key, state, options);
    }
    // The page follows the ceremony down: the newest beat is on screen and
    // everything before it is still there, above, still moving. A rewatch puts
    // every board up in one go, so it stays where the reader is.
    //
    // It lands again when the figures arrive, because a beat opens empty and a
    // scroll aimed at an empty box stops short of the board that fills it.
    if (!options.quiet && (arriving || filling) && module === feed.lastElementChild) {
      const landing = module;
      requestAnimationFrame(() => landOn(landing));
    }
    patchModule(module, key, state, options);
  }
}

// Put the beat where it can be read: centred in what is left of the window
// once the foot is taken off it, or its top near the top when it is taller than
// that. `scrollIntoView` with block:"end" aimed the bottom edge at the bottom of
// the window, which the sticky foot sits on top of.
function landOn(module) {
  const rect = module.getBoundingClientRect();
  const foot = module.closest(".ceremony")?.querySelector(".ceremony-foot");
  const room = window.innerHeight - (foot?.getBoundingClientRect().height ?? 0);
  const slack = rect.height <= room ? Math.max(16, (room - rect.height) / 2) : 16;
  window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - slack), behavior: "smooth" });
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
    case "traits": return [
      ...(state.traits?.offense ?? []).map((plaque) => plaque.key),
      ...(state.traits?.defense ?? []).map((plaque) => plaque.key)
    ].join(",");
    case "leaders": return (state.leaders ?? [])
      .map((category) => `${category.key}:${category.entries.length}`).join(",");
    case "mvp": return awardShape(state.mvp);
    case "cy": return awardShape(state.cy);
    case "reckoning": return [
      (state.reckoning?.hitters?.best ?? []).length,
      (state.reckoning?.hitters?.worst ?? []).length,
      (state.reckoning?.pitchers?.best ?? []).length,
      (state.reckoning?.pitchers?.worst ?? []).length
    ].join(",");
    case "countdown": return (state.counted ?? []).map((row) => row.place).join(",");
    case "finalists": return (state.finalists ?? []).length ? "pair" : "";
    case "game": return `game:${state.game?.index ?? "none"}`;
    case "epilogue": return "chart";
    default: return "";
  }
}

function awardShape(award) {
  if (!award) return "";
  return [award.id, ...(award.boards ?? []).map((board) => `${board.label}:${board.entries.length}`)].join("|");
}

function moduleHtml(key, state, options) {
  const [eyebrow, title] = MODULE_TITLES[key] ?? ["", ""];
  const under = EYEBROW_UNDER.has(key);
  const head = [
    `<p class="eyebrow">${escapeHtml(eyebrow)}</p>`,
    title ? `<h2>${escapeHtml(title)}</h2>` : ""
  ];
  return `<section class="ceremony-module" data-module="${key}">
    <header class="module-head${under ? " head-under" : ""}">
      ${(under ? [head[1], head[0]] : head).join("\n      ")}
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
// A name on this screen reads like a name on the stat tables: hover it, or tab
// to it, and the card it belongs to comes up. The ceremony is built out of
// names a manager has not seen in a while, and half of them have no card next
// to them — the ones that do are left alone, since the card is already there.
function playerName(options, entry, { tag = "span", className = "", short = true } = {}) {
  const text = short ? shortName(stripCardYear(entry.name)) : stripCardYear(entry.name);
  if (options?.nameHtml) return options.nameHtml(entry.id, text, tag, className);
  return `<${tag}${className ? ` class="${className}"` : ""}>${escapeHtml(text)}</${tag}>`;
}

function manager(state, team, extra = "") {
  const index = (state.teamNames ?? []).indexOf(team);
  const color = raceColor(index >= 0 ? index : 0);
  return `<span class="manager-chip${extra ? ` ${extra}` : ""}" style="--chip:${color};--chip-ink:${chipInk(color)}">${escapeHtml(team ?? "")}</span>`;
}

// Clubs pick their own colours and some of them are light, so the chip works
// out what can be read on top of it rather than assuming cream. Rec. 601 luma
// is more than enough for a flat fill with four letters on it.
function chipInk(hex) {
  const value = String(hex).replace("#", "");
  if (value.length < 6) return "#fdfbf4";
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#171310" : "#fdfbf4";
}

// ---- the beats ---------------------------------------------------------------

// Two rows of three: what the club does with the bat, and what it does to the
// other club's. The board is read across and down.
function traitsHtml(state) {
  const row = (side, label, plaques) => `<div class="stat-row" data-side="${side}">
    <span class="stat-row-label">${label}</span>
    <div class="stat-row-plaques">${plaques.map((plaque) => `
      <div class="plaque" data-row="${plaque.key}" data-id="${escapeHtml(plaque.team)}">
        <div data-swap>${plaqueInner(state, plaque)}</div>
      </div>`).join("")}</div>
  </div>`;
  return `<div class="stat-board">
    ${row("offense", "Offense", state.traits?.offense ?? [])}
    ${row("defense", "Defense", state.traits?.defense ?? [])}
  </div>`;
}

function plaqueInner(state, plaque) {
  return `<span class="plaque-cat">${escapeHtml(plaque.label)}</span>
    ${manager(state, plaque.team, "big")}
    <span class="plaque-val" data-val="${plaque.key}">${escapeHtml(plaque.value)}</span>`;
}

// Eight categories, each one built the way an award is: the leader's card at
// a size worth looking at, his name beside it, and the two men who did not
// lead listed underneath. A thumbnail the size of a postage stamp said
// nothing about the card it was a picture of.
function leadersHtml(state, options) {
  return `<div class="leader-board">${(state.leaders ?? []).map((category) => `
    <div class="leader-cat">
      <p class="leader-cat-head">${escapeHtml(category.label)}</p>
      <div class="leader-cat-body">
        ${category.entries.filter((entry) => entry.rank === 1).map((entry) => `
          <div class="leader-spot" data-row="${category.key}${entry.rank}" data-id="${escapeHtml(entry.id)}">
            <div data-swap>${leaderInner(state, category, entry, options)}</div>
          </div>`).join("")}
        <div class="leader-rest">
          ${category.entries.filter((entry) => entry.rank > 1).map((entry) => `
            <div class="leader-row" data-row="${category.key}${entry.rank}" data-id="${escapeHtml(entry.id)}">
              <div data-swap>${leaderInner(state, category, entry, options)}</div>
            </div>`).join("")}
        </div>
      </div>
    </div>`).join("")}</div>`;
}

// One builder for both shapes, so a rank that changes hands is rebuilt by the
// same patch whichever row it lands in.
function leaderInner(state, category, entry, options) {
  if (entry.rank === 1) return leaderSpotInner(state, category, entry, options);
  return `<span class="leader-rank">${entry.rank}</span>
    <span class="leader-who">${playerName(options, entry, { tag: "b" })}</span>
    <span class="leader-value" data-val="${category.key}${entry.rank}">${escapeHtml(entry.value)}</span>
    ${manager(state, entry.team)}`;
}

function leaderSpotInner(state, category, entry, options) {
  return `<span class="leader-spot-card">${miniCard(entry.id, options)}</span>
    <span class="leader-spot-copy">
      <b class="leader-spot-name">${escapeHtml(stripCardYear(entry.name))}</b>
      <span class="leader-spot-line">
        <span class="leader-spot-value" data-val="${category.key}${entry.rank}">${escapeHtml(entry.value)}</span>
        ${category.unit ? `<span class="leader-spot-unit">${escapeHtml(category.unit)}</span>` : ""}
        ${manager(state, entry.team)}
      </span>
    </span>`;
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
      <p class="award-name">${escapeHtml(stripCardYear(award.name))}${awardPrice(award)}</p>
      <p class="award-owner">${manager(state, award.team, "big")}<em>drafted him</em></p>
      <p class="award-headline" data-val="headline">${escapeHtml(award.headline)}</p>
      ${award.split ? splitHtml(award.split, award.pitcher) : ""}
      ${(award.boards ?? []).map((board, index) => rankBoardHtml(state, board, award, options, index)).join("")}
    </div>`;
}

// What the room paid for him, beside the name it paid it for. An award is only
// half a story without it: +13 WPAR off the first pick of the draft and +13 off
// the forty-second are not the same season.
function awardPrice(award) {
  const tag = priceTag(award.cost, award.byMoney);
  return tag ? `<span class="award-cost">${tag}</span>` : "";
}

// What the room paid, in the fewest characters that still say which it is.
function priceTag(cost, byMoney) {
  if (cost === null || cost === undefined) return "";
  return byMoney ? `$${num(cost)}` : `#${cost}`;
}

function rankBoardHtml(state, board, award, options, index) {
  return `<div class="rank-board">
    <p class="rank-head">${escapeHtml(board.label)}</p>
    ${board.entries.map((entry) => `
      <div class="rank-row" data-row="${rankKey(index, entry.rank)}" data-id="${escapeHtml(entry.id)}">
        <div data-swap>${rankRowInner(state, entry, award, options, index)}</div>
      </div>`).join("")}
  </div>`;
}

// The board's rows go on moving with the sim like everything else on the beat,
// so each number is a patch target. Without them the headline climbed while the
// board under it still read the figures from ten thousand games ago, and the
// winner's own row disagreed with his name.
function rankKey(board, rank) {
  return `b${board}r${rank}`;
}

function rankRowInner(state, entry, award, options, index) {
  const key = rankKey(index, entry.rank);
  return `<span class="rank-pos">${entry.rank}</span>
    ${playerName(options, entry, { tag: "span", className: "rank-name" })}
    <span class="rank-cost">${priceTag(entry.cost, award.byMoney)}</span>
    ${entry.stats
      // A pitcher is read on more than one number: the rate, the work he did at
      // it, and what the work was worth.
      ? `<span class="rank-stats">${entry.stats.map((stat, order) => `
          <span class="rank-stat"><b data-val="${key}s${order}">${escapeHtml(stat.value)}</b>${escapeHtml(stat.label)}</span>`).join("")}</span>`
      : `<span class="rank-value" data-val="${key}v">${escapeHtml(entry.value)}</span>`}
    ${manager(state, entry.team)}`;
}

// WPAR the way the engine stores it. Zero sits in the middle of each track,
// because a component can be negative and a glove that costs you games should
// look like it costs you.
function splitHtml(split, pitcher = false) {
  // A hitter is always read on all three: a glove worth nothing is a fact
  // about him, and leaving the row out made it look like it had not been
  // measured. A pitcher gets his arm, and the rest only if it did something.
  const always = pitcher ? ["pitching"] : ["hitting", "baserunning", "defense"];
  const rows = [["hitting", "Hitting"], ["baserunning", "Baserunning"], ["defense", "Defense"], ["pitching", "Pitching"]]
    .filter(([key]) => Number.isFinite(split[key]) && (always.includes(key) || Math.abs(split[key]) >= 0.05));
  if (!rows.length) return "";
  return `<div class="wpar-split">${rows.map(([key, label]) => `
    <div class="split-row" data-split="${key}">
      <span class="split-key">${label}</span>
      <span class="split-track"><i></i></span>
      <span class="split-value"></span>
    </div>`).join("")}</div>`;
}

// Four boards: the three cards that most beat what the room paid for them and
// the three that least did, for bats and for arms. Value is a rank against a
// rank — where he finished among his own kind against where he was taken.
function reckoningHtml(state, options) {
  const board = state.reckoning;
  if (!board) return "";
  const column = (title, rows, side) => `<div class="reckon-side${side.startsWith("b") ? " bargain" : ""}">
    <p class="reckon-head">${title}</p>
    <div class="reckon-body">
      ${rows.filter((entry) => entry.rank === 1).map((entry) => `
        <div class="reckon-spot" data-row="${side}${entry.rank}" data-id="${escapeHtml(entry.id)}">
          <div data-swap>${reckonInner(state, entry, board, options)}</div>
        </div>`).join("")}
      <div class="reckon-rest">
        ${rows.filter((entry) => entry.rank > 1).map((entry) => `
          <div class="reckon-row" data-row="${side}${entry.rank}" data-id="${escapeHtml(entry.id)}">
            <div data-swap>${reckonInner(state, entry, board, options)}</div>
          </div>`).join("")}
      </div>
    </div>
  </div>`;
  return `<div class="reckon-board">
    ${column("Best value, hitters", board.hitters?.best ?? [], "bh")}
    ${column("Best value, pitchers", board.pitchers?.best ?? [], "bp")}
    ${column("Worst value, hitters", board.hitters?.worst ?? [], "wh")}
    ${column("Worst value, pitchers", board.pitchers?.worst ?? [], "wp")}
  </div>`;
}

// One builder for both shapes, the way the leaders beat has one: the pick a
// board is about gets the card and the type, and the two behind him are rows.
function reckonInner(state, entry, board, options) {
  if (entry.rank === 1) return reckonSpotInner(state, entry, board, options);
  return `<span class="reckon-rank">${entry.rank}</span>
    <span class="reckon-who">
      ${playerName(options, entry, { tag: "b" })}
      <em><span data-val="v-${escapeHtml(entry.id)}">${escapeHtml(entry.value)}</span> ${board.byWpar ? "WPAR" : "WPA"}</em>
    </span>
    <span class="reckon-cost">${costLabel(entry.cost, board.byMoney)}</span>
    ${manager(state, entry.team)}`;
}

function reckonSpotInner(state, entry, board, options) {
  return `<span class="reckon-spot-card">${miniCard(entry.id, options)}</span>
    <span class="reckon-spot-copy">
      <b class="reckon-spot-name">${escapeHtml(stripCardYear(entry.name))}</b>
      <span class="reckon-spot-line">
        <span class="reckon-spot-value" data-val="v-${escapeHtml(entry.id)}">${escapeHtml(entry.value)}</span>
        <em class="reckon-spot-unit">${board.byWpar ? "WPAR" : "WPA"}</em>
        <span class="reckon-cost">${costLabel(entry.cost, board.byMoney)}</span>
        ${manager(state, entry.team)}
      </span>
    </span>`;
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

// How the two split their meetings, bigger share first so it says how close
// the series was without saying which of them won it — the replay reveals that
// itself, on the last out.
function seriesSplit(share) {
  const value = Number(share);
  if (!Number.isFinite(value) || value <= 0 || value >= 1) return "";
  const high = Math.max(value, 1 - value) * 100;
  return `, split ${high.toFixed(1)}&ndash;${(100 - high).toFixed(1)}`;
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
    return `<p class="lede">Looking through every meeting of the top two for the one that went the way their season against each other went.</p>`;
  }
  return `<div class="replay" data-row="game" data-id="${game.index}">
    <p class="replay-sub">Game ${num(game.index + 1)} &middot; one of their ${num(game.meetings)} meetings${seriesSplit(game.share)}</p>
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
      </div>
      <div class="sb-side" data-side="home">
        ${manager(state, game.home, "big")}
        <span class="sb-runs" data-board="runs-home">0</span>
      </div>
    </div>
    <div class="replay-duel" data-board="duel"></div>
    <div class="replay-stamp" data-board="stamp" hidden>
      <b data-board="stamp-score"></b>
    </div>
  </div>`;
}

// The two men, their cards, and the dice between them.
//
// Each man stands under his own manager: the scoreboard above puts the away
// club on the left and the home club on the right, so the cards take the same
// two sides and swap over when the innings turn. A card that crossed the board
// every half inning made you read the chip to work out whose it was.
//
// Each die sits beside the man who throws it, so `data-lead` says which role
// took the left-hand card and the stylesheet sends the pitch die and the swing
// die to the matching edges.
export function duelHtml(state, game, options) {
  const moment = game?.moment;
  if (!moment) return "";
  const event = moment.event;
  const batter = options.cardFor?.(event.batterId) ?? null;
  const pitcher = options.cardFor?.(event.pitcherId) ?? null;
  const advantage = storyAdvantage(event);
  const men = [
    { role: "pitching", team: event.pitchingTeam, card: pitcher, name: event.pitcher },
    { role: "batting", team: event.battingTeam, card: batter, name: event.batter }
  ];
  const [left, right] = men[1].team === game?.away ? [men[1], men[0]] : men;
  const side = (man) => `<div class="duel-card" data-role="${man.role}">
      <p class="duel-role">${manager(state, man.team)}<span class="duel-side">${man.role}</span></p>
      ${man.card ? cardPanelHtml(man.card) : ""}
      <p class="duel-name">${escapeHtml(stripCardYear(man.name ?? ""))}</p>
    </div>`;
  return `<div class="duel" data-phase="${moment.phase}" data-lead="${left.role}">
    ${side(left)}
    <div class="duel-middle">
      <div class="duel-roll" data-roll="control">
        <span class="roll-label">Pitch</span>
        ${dieHtml("die-control")}
        <span class="roll-note" data-board="note-control"></span>
      </div>
      <div class="duel-call">
        <p class="duel-advantage ${advantage ? `${advantage.key}-advantage` : ""}">${advantage ? escapeHtml(advantage.label) : ""}</p>
        <p class="duel-result" data-board="result"></p>
      </div>
      <div class="duel-roll" data-roll="swing">
        <span class="roll-label">Swing</span>
        ${dieHtml("die-swing")}
        <span class="roll-note" data-board="note-swing"></span>
      </div>
    </div>
    ${side(right)}
  </div>`;
}

// The d20 the adventure's drama screen throws: an icosahedron head-on reads as
// a hexagon, and the outline alone says so. The face is drawn once and the
// number sits on top of it, because the tumble rewrites the number many times
// a second and must not be rewriting the die.
function dieHtml(key) {
  return `<span class="die" data-board="${key}">
    <span class="die-spin">
      <svg class="die-face" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <polygon class="die-body" points="50,3 93,27 93,73 50,97 7,73 7,27"></polygon>
      </svg>
      <b class="die-roll">&middot;</b>
    </span>
  </span>`;
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
      for (const plaque of [...(state.traits?.offense ?? []), ...(state.traits?.defense ?? [])]) {
        swapRow(module, plaque.key, plaque.team, () => plaqueInner(state, plaque));
        setVal(module, plaque.key, plaque.value);
      }
      return;
    case "leaders":
      for (const category of state.leaders ?? []) {
        for (const entry of category.entries) {
          const row = `${category.key}${entry.rank}`;
          swapRow(module, row, entry.id, () => leaderInner(state, category, entry, options));
          setVal(module, row, entry.value);
        }
      }
      return;
    case "mvp":
    case "cy": {
      const award = state[key];
      if (!award) return;
      swapRow(module, "award", award.id, () => awardInner(award, state, options));
      setVal(module, "headline", award.headline);
      patchSplit(module, award.split);
      (award.boards ?? []).forEach((board, index) => {
        for (const entry of board.entries) {
          const row = rankKey(index, entry.rank);
          swapRow(module, row, entry.id, () => rankRowInner(state, entry, award, options, index));
          if (entry.stats) entry.stats.forEach((stat, order) => setVal(module, `${row}s${order}`, stat.value));
          else setVal(module, `${row}v`, entry.value);
        }
      });
      return;
    }
    case "reckoning": {
      const board = state.reckoning;
      if (!board) return;
      const rows = [
        ...(board.hitters?.best ?? []).map((entry) => [`bh${entry.rank}`, entry]),
        ...(board.hitters?.worst ?? []).map((entry) => [`wh${entry.rank}`, entry]),
        ...(board.pitchers?.best ?? []).map((entry) => [`bp${entry.rank}`, entry]),
        ...(board.pitchers?.worst ?? []).map((entry) => [`wp${entry.rank}`, entry])
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
