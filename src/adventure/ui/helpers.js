import { normalizeResult, formatRange, positionsLabel, positionFieldingLabel } from "../../rules/cards.js";
import { RARITIES, dualPartnerCard } from "../packs.js";
import { CARD_IMAGE_FILES } from "../../data/cardImages.js";
import { MLB_TEAM_CODES, MLB_PLAYER_TEAMS } from "../../data/mlbTeams.js";

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function clampIndex(index, length) {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}

// A cursor menu: items render with .gq-cursor on the selected row. Screens
// keep the index in their own state and call menuHtml to draw. Sectioned
// menus pass `offset` so every row carries its global index for clicks.
export function menuHtml(items, selectedIndex, { className = "", offset = 0 } = {}) {
  return `<ul class="gq-menu ${className}">${items
    .map((item, index) => {
      const selected = index === selectedIndex;
      return `<li class="${selected ? "gq-cursor" : ""} ${item.disabled ? "gq-disabled" : ""}" data-menu-index="${offset + index}">
          <span class="gq-caret">${selected ? "&#9654;" : "&nbsp;"}</span>${item.html ?? escapeHtml(item.label)}
        </li>`;
    })
    .join("")}</ul>`;
}

export function rarityTag(card) {
  const rarity = RARITIES[card.rarity] ?? RARITIES.common;
  return `<span class="gq-rarity gq-rarity-${rarity.key}">${escapeHtml(rarity.label.toUpperCase())}</span>`;
}

export function cardLine(card) {
  const stat = card.kind === "pitcher"
    ? `${card.role} CTRL${card.control} IP${card.ip}`
    : `${escapeHtml(positionsLabel(card))} OB${card.onBase} SPD${card.speed}`;
  return `${escapeHtml(shortName(card.name))} <span class="gq-dim">${stat} ${card.points}PT</span>`;
}

export function shortName(name) {
  const parts = String(name).split(" ");
  if (parts.length < 2) return name.toUpperCase();
  return `${parts[0][0]}.${parts.slice(1).join(" ")}`.toUpperCase();
}

// The clubs behind an MLB-pool card, most years worn first. The card id
// carries the slice (mlb-all-, mlb-d1990-, mlb-00s-) and the databank player
// id; career cards list the whole ride, decade cards just that window.
// Franchise-pool ids (mlb-fSEA-) don't match — the club IS the pool there.
const TEAM_LIST_CAP = 6;

function cardTeams(card) {
  const match = /^mlb-(all|00s|d\d{4})-(.+?)(-bat)?$/.exec(String(card.id ?? ""));
  if (!match) return null;
  const window = match[1] === "all" ? "all" : match[1] === "00s" ? "2000" : match[1].slice(1);
  const list = MLB_PLAYER_TEAMS[match[2]]?.[window];
  if (!list?.length) return null;
  const codes = list.map((index) => MLB_TEAM_CODES[index]);
  return codes.length > TEAM_LIST_CAP + 1
    ? [...codes.slice(0, TEAM_LIST_CAP), `+${codes.length - TEAM_LIST_CAP} more`]
    : codes;
}

// Full card panel: the binder/pack view, laid out like the main app's card —
// a player strip with the big On-Base/Control square, name over one compact
// meta line ("896 PT · SPD 10 · 2B+3"), then the chart as a range-map grid.
// Real-player cards (classic and MLB leagues) get a photo band up top that
// main.js hydrates from Wikipedia, plus their set tag / years-active line.
function stripMetaLine(card) {
  return card.kind === "pitcher"
    ? `${card.points} PT &middot; ${escapeHtml(card.role)} &middot; IP ${card.ip} &middot; ${escapeHtml(card.throws)}HP`
    : `${card.points} PT &middot; SPD ${card.speed} &middot; ${escapeHtml(positionFieldingLabel(card))}`;
}

function cardStrip(card, { count = null, tag = "" } = {}) {
  return `<div class="gq-card-strip">
    <span class="gq-card-square">${card.kind === "pitcher" ? card.control : card.onBase}</span>
    <span class="gq-card-strip-text">
      <span class="gq-card-name">${escapeHtml(card.name.toUpperCase())}${count !== null ? ` <span class="gq-dim">x${count}</span>` : ""}</span>
      <span class="gq-card-meta">${stripMetaLine(card)}</span>
    </span>
    ${tag}
  </div>`;
}

// Adjacent same-result rolls merge into one column (5-8 BB), die range on
// top, result underneath — the printed card's chart strip.
function chartGrid(card) {
  const cells = chartRangeCells(card)
    .map((entry) => `<span class="gq-chart-cell gq-chart-${resultTone(entry.result)}">
      <b class="gq-chart-range">${escapeHtml(formatRange(entry))}</b>
      <span class="gq-chart-result">${escapeHtml(entry.result)}</span>
    </span>`)
    .join("");
  return `<div class="gq-chart" style="--gq-chart-cols:${chartRangeCells(card).length}">${cells}</div>`;
}

function resultTone(result) {
  if (result === "HR") return "homer";
  if (result === "BB") return "walk";
  if (["1B", "2B", "3B"].includes(result)) return "hit";
  return "out";
}

export function cardPanelHtml(card, { count = null } = {}) {
  const foil = card.foil || card.rarity === "legend";
  // Classic cards with a real scan show the actual printed card (courtesy of
  // ShowdownCards.com), full color on purpose; everyone else keeps the
  // photo band.
  const scan = CARD_IMAGE_FILES[card.id];
  const photo = !scan && card.real
    ? `<div class="gq-card-photo"><div class="gq-card-headshot" data-photo-name="${escapeHtml(photoName(card.name))}" data-era="${eraYear(card)}"${card.mlbam ? ` data-mlbam="${escapeHtml(String(card.mlbam))}"` : ""}></div></div>`
    : "";
  const teams = cardTeams(card);
  const setLine = [card.setTag ? escapeHtml(card.setTag) : "", ...(teams ?? []).map(escapeHtml)]
    .filter(Boolean)
    .join(" &middot; ");
  // A simultaneous two-way pair prints as one card: the other half's strip
  // and chart stack under the primary's. Both roster separately.
  const partner = dualPartnerCard(card.id);
  const partnerBlock = partner
    ? `${cardStrip(partner, { tag: `<span class="gq-card-meta gq-dim">TWO-WAY</span>` })}
    ${chartGrid(partner)}`
    : "";
  const body = `${photo}
    ${cardStrip(card, { count, tag: rarityTag(card) })}
    ${setLine ? `<div class="gq-card-teams">${setLine}</div>` : ""}
    ${chartGrid(card)}
    ${partnerBlock}`;
  // Scanned cards lay out as text | card image, so the panel grows to fit
  // the scan instead of the scan spilling out of the frame.
  if (scan) {
    return `<div class="gq-card gq-card-has-scan gq-rarity-border-${card.rarity}${foil ? " gq-foil" : ""}">
      <div class="gq-card-body">${body}</div>
      <img class="gq-card-scan" src="assets/cards/${escapeHtml(scan)}" alt="" loading="lazy">
    </div>`;
  }
  return `<div class="gq-card gq-rarity-border-${card.rarity}${foil ? " gq-foil" : ""}">${body}</div>`;
}

// Classic card names carry their card year ("Mike Caruso '02"). Cramped or
// conversational spots (the matchup panel, the play-by-play) drop it; the
// binder, rosters, and box scores keep it so twin printings stay tellable.
export function stripCardYear(name) {
  return String(name).replace(/\s*'\d\d$/, "");
}

function photoName(name) {
  return stripCardYear(name);
}

// The card's first active year, for era-styling the generated pixel
// portraits (pillbox caps and handlebars before the war). MLB set tags read
// "1989-2010"; classic tags read "'04 PR1".
export function eraYear(card) {
  const four = /(\d{4})/.exec(card.setTag ?? "");
  if (four) return Number(four[1]);
  const two = /'(\d\d)/.exec(card.setTag ?? "");
  if (two) return Number(two[1]) + (Number(two[1]) < 30 ? 2000 : 1900);
  return 2000;
}

function chartRangeCells(card) {
  return [...card.chart]
    .map((entry) => ({ ...entry, result: normalizeResult(entry.result) }))
    .sort((a, b) => a.from - b.from)
    .reduce((merged, entry) => {
      const last = merged.at(-1);
      if (last && last.result === entry.result && last.to + 1 === entry.from) last.to = entry.to;
      else merged.push(entry);
      return merged;
    }, []);
}

// ---- Battle narration ------------------------------------------------------

const RESULT_LINES = {
  SO: "strikes out!",
  PU: "pops it up. Easy out.",
  GB: "chops a grounder...",
  FB: "lofts a fly ball...",
  BB: "works a walk.",
  "1B": "lines a single!",
  "2B": "rips a double!",
  "3B": "legs out a triple!",
  HR: "CRUSHES IT! HOME RUN!"
};

// Narration names: short, and without the card-year suffix — the booth says
// "C.JONES", not "C.JONES '00".
function playName(name) {
  return shortName(stripCardYear(name));
}

// Every fielding check reports its d20 in parentheses, steal-call style, so
// the table always sees the throw that decided the play.
function rolled(attempt) {
  return typeof attempt?.roll === "number" ? ` (rolled ${attempt.roll})` : "";
}

// Scores always read from the player's side: up 3-0 is "3-0" whether the
// player is home or away.
function scoreCall(event, playerSide) {
  const yours = event.scoreAfter[playerSide];
  const theirs = event.scoreAfter[playerSide === "home" ? "away" : "home"];
  return `It's ${yours}-${theirs}.`;
}

export function describeEvent(event, playerSide = "away") {
  if (!event) return [];
  if (event.type === "pitching-change") {
    return [`${playName(event.team)} goes to the pen: ${playName(event.pitcher)} takes the hill.`];
  }
  if (event.type === "intentional-walk") {
    const lines = [`${playName(event.batter)} is waved down to first. Intentional walk.`];
    if (event.runs > 0) lines.push(`That forces in a run! ${scoreCall(event, playerSide)}`);
    return lines;
  }
  if (event.type === "bunt") {
    const details = event.playDetails;
    const lines = [];
    lines.push(`${playName(event.batter)} lays it down. Textbook sacrifice.`);
    return lines;
  }
  if (event.type === "advance") {
    const lines = [];
    for (const attempt of event.playDetails?.attempts ?? []) {
      if (attempt.thrown) {
        lines.push(attempt.safe
          ? `${playName(attempt.runner)} beats the throw to ${attempt.to}!${rolled(attempt)}`
          : `${playName(attempt.runner)} is cut down at ${attempt.to}!${rolled(attempt)}`);
      } else {
        lines.push(`${playName(attempt.runner)} takes ${attempt.to}.`);
      }
    }
    if (event.runs > 0) {
      lines.push(`${event.runs === 1 ? "A run scores!" : `${event.runs} runs score!`} ${scoreCall(event, playerSide)}`);
    }
    if (event.outsAfter >= 3) {
      lines.push(sideRetiredLine(event));
    }
    return lines;
  }
  const lines = [];
  if (event.type === "steal") {
    const attempt = event.playDetails?.stealAttempt;
    if (attempt) {
      lines.push(
        attempt.safe
          ? `${playName(attempt.runner)} steals ${attempt.to}! (rolled ${attempt.roll})`
          : `${playName(attempt.runner)} is GUNNED DOWN at ${attempt.to}! (rolled ${attempt.roll})`
      );
    }
    return lines;
  }
  if (event.result === "HR" && event.runs === 4) {
    lines.push(`${playName(event.batter)} unloads the bases... GRAND SLAM!`);
  } else {
    lines.push(`${playName(event.batter)} ${RESULT_LINES[event.result] ?? event.result}`);
  }
  const doublePlay = event.playDetails?.doublePlayAttempt;
  if (doublePlay?.batterOut) lines.push(`Double play! Two gone.${rolled(doublePlay)}`);
  const thrown = event.playDetails?.thrownAttempt;
  if (thrown) {
    lines.push(
      thrown.safe
        ? `${playName(thrown.runner)} takes ${thrown.to} on the throw!${rolled(thrown)}`
        : `${playName(thrown.runner)} is cut down at ${thrown.to}!${rolled(thrown)}`
    );
  }
  if (event.runs > 0) {
    lines.push(`${event.runs === 1 ? "A run scores!" : `${event.runs} runs score!`} `, scoreCall(event, playerSide));
  }
  if (event.outsAfter >= 3) {
    lines.push(sideRetiredLine(event));
  }
  return lines;
}

// The third out either turns the inning over or ends the game — never
// announce a next half-inning that won't be played.
function sideRetiredLine(event) {
  const decided = event.inning >= 9 && (
    event.half === "bottom"
      ? event.scoreAfter.home !== event.scoreAfter.away
      : event.scoreAfter.home > event.scoreAfter.away
  );
  if (decided) return "That's the ballgame!";
  return `Side retired. ${event.half === "top" ? "Bottom" : "Top"} ${event.half === "top" ? event.inning : event.inning + 1} coming up.`;
}

export function halfLabel(state) {
  return `${state.half === "top" ? "TOP" : "BOT"} ${state.inning}`;
}

// Occupied bases carry the runner's card id so hovering the icon floats the
// full card (main.js resolves data-card-id into the tooltip).
export function diamondHtml(state) {
  const [first, second, third] = state.bases;
  const base = (cls, runner) =>
    `<span class="gq-base ${cls} ${runner ? "gq-base-on" : ""}"${
      runner?.id ? ` data-card-id="${escapeHtml(runner.id)}" title="${escapeHtml(runner.name)}"` : ""
    }></span>`;
  return `<div class="gq-diamond">
    ${base("gq-base-2", second)}
    ${base("gq-base-3", third)}
    ${base("gq-base-1", first)}
    <span class="gq-base gq-base-h"></span>
  </div>`;
}

export function outsHtml(outs) {
  return `<span class="gq-outs">${[0, 1, 2]
    .map((i) => `<i class="${i < outs ? "gq-out-on" : ""}"></i>`)
    .join("")} OUT</span>`;
}
