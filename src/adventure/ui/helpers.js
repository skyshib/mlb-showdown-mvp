import { normalizeResult, formatRange } from "../../rules/cards.js";
import { RARITIES } from "../packs.js";

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
    : `${escapeHtml(card.position)} OB${card.onBase} SPD${card.speed}`;
  return `${escapeHtml(shortName(card.name))} <span class="gq-dim">${stat} ${card.points}PT</span>`;
}

export function shortName(name) {
  const parts = String(name).split(" ");
  if (parts.length < 2) return name.toUpperCase();
  return `${parts[0][0]}.${parts.slice(1).join(" ")}`.toUpperCase();
}

// Full card panel: the binder/pack view. Chart rows collapse to the compact
// range map used by the main app. Real-player cards (classic and MLB
// leagues) get a photo slot that main.js hydrates from Wikipedia, plus their
// set tag / years-active line.
export function cardPanelHtml(card, { count = null } = {}) {
  const ranges = chartRangeRows(card);
  const header = card.kind === "pitcher"
    ? `${card.role} &middot; CTRL ${card.control} &middot; IP ${card.ip} &middot; ${escapeHtml(card.throws)}HP`
    : `${escapeHtml(card.position)} &middot; OB ${card.onBase} &middot; SPD ${card.speed} &middot; FLD ${card.fielding >= 0 ? "+" : ""}${card.fielding}`;
  const foil = card.foil || card.rarity === "legend";
  return `<div class="gq-card gq-rarity-border-${card.rarity}${foil ? " gq-foil" : ""}">
    ${card.real ? `<div class="gq-card-headshot" data-photo-name="${escapeHtml(photoName(card.name))}" data-era="${eraYear(card)}"${card.mlbam ? ` data-mlbam="${escapeHtml(String(card.mlbam))}"` : ""}></div>` : ""}
    <div class="gq-card-name">${escapeHtml(card.name.toUpperCase())} ${count !== null ? `<span class="gq-dim">x${count}</span>` : ""}</div>
    <div class="gq-card-meta">${header}</div>
    <div class="gq-card-meta">${rarityTag(card)} <span class="gq-dim">${card.points} PT${card.setTag ? ` &middot; ${escapeHtml(card.setTag)}` : ""}</span></div>
    <div class="gq-card-chart">${ranges
      .map(([result, range]) => `<span class="gq-chart-cell"><b>${escapeHtml(result)}</b> ${escapeHtml(range)}</span>`)
      .join("")}</div>
  </div>`;
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

function chartRangeRows(card) {
  const ranges = new Map();
  for (const entry of card.chart) {
    const result = normalizeResult(entry.result);
    const list = ranges.get(result) ?? [];
    list.push(formatRange(entry));
    ranges.set(result, list);
  }
  return [...ranges].map(([result, list]) => [result, list.join(",")]);
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
    if (details?.clean) {
      lines.push(`${playName(event.batter)} lays it down. Textbook sacrifice.`);
    } else {
      lines.push(`${playName(event.batter)} bunts it right to the defense...`);
      if (details?.leadOut) lines.push(`${playName(details.leadOut.runner)} is FORCED at ${details.leadOut.at}!`);
    }
    return lines;
  }
  if (event.type === "advance") {
    const lines = [];
    for (const attempt of event.playDetails?.attempts ?? []) {
      if (attempt.thrown) {
        lines.push(attempt.safe
          ? `${playName(attempt.runner)} beats the throw to ${attempt.to}!`
          : `${playName(attempt.runner)} is cut down at ${attempt.to}!`);
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
  if (event.playDetails?.doublePlayAttempt?.batterOut) lines.push("Double play! Two gone.");
  const thrown = event.playDetails?.thrownAttempt;
  if (thrown) {
    lines.push(
      thrown.safe
        ? `${playName(thrown.runner)} takes ${thrown.to} on the throw!`
        : `${playName(thrown.runner)} is cut down at ${thrown.to}!`
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
