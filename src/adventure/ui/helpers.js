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
  return `<div class="gq-card gq-rarity-border-${card.rarity}">
    ${card.real ? `<div class="gq-card-portrait" data-photo-name="${escapeHtml(card.name)}"></div>` : ""}
    <div class="gq-card-name">${escapeHtml(card.name.toUpperCase())} ${count !== null ? `<span class="gq-dim">x${count}</span>` : ""}</div>
    <div class="gq-card-meta">${header}</div>
    <div class="gq-card-meta">${rarityTag(card)} <span class="gq-dim">${card.points} PT${card.setTag ? ` &middot; ${escapeHtml(card.setTag)}` : ""}</span></div>
    <div class="gq-card-chart">${ranges
      .map(([result, range]) => `<span class="gq-chart-cell"><b>${escapeHtml(result)}</b> ${escapeHtml(range)}</span>`)
      .join("")}</div>
  </div>`;
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

export function describeEvent(event) {
  if (!event) return [];
  if (event.type === "pitching-change") {
    return [`${shortName(event.team)} goes to the pen: ${shortName(event.pitcher)} takes the hill.`];
  }
  if (event.type === "intentional-walk") {
    const lines = [`${shortName(event.batter)} is waved down to first. Intentional walk.`];
    if (event.runs > 0) lines.push(`That forces in a run! It's ${event.scoreAfter.away}-${event.scoreAfter.home}.`);
    return lines;
  }
  if (event.type === "bunt") {
    const details = event.playDetails;
    const lines = [];
    if (details?.clean) {
      lines.push(`${shortName(event.batter)} lays it down. Textbook sacrifice.`);
    } else {
      lines.push(`${shortName(event.batter)} bunts it right to the defense...`);
      if (details?.leadOut) lines.push(`${shortName(details.leadOut.runner)} is FORCED at ${details.leadOut.at}!`);
    }
    return lines;
  }
  if (event.type === "advance") {
    const lines = [];
    for (const attempt of event.playDetails?.attempts ?? []) {
      if (attempt.thrown) {
        lines.push(attempt.safe
          ? `${shortName(attempt.runner)} beats the throw to ${attempt.to}!`
          : `${shortName(attempt.runner)} is cut down at ${attempt.to}!`);
      } else {
        lines.push(`${shortName(attempt.runner)} takes ${attempt.to}.`);
      }
    }
    if (event.runs > 0) {
      lines.push(`${event.runs === 1 ? "A run scores!" : `${event.runs} runs score!`} It's ${event.scoreAfter.away}-${event.scoreAfter.home}.`);
    }
    if (event.outsAfter >= 3) {
      lines.push(`Side retired. ${event.half === "top" ? "Bottom" : "Top"} ${event.half === "top" ? event.inning : event.inning + 1} coming up.`);
    }
    return lines;
  }
  const lines = [];
  if (event.type === "steal") {
    const attempt = event.playDetails?.stealAttempt;
    if (attempt) {
      lines.push(
        attempt.safe
          ? `${shortName(attempt.runner)} steals ${attempt.to}! (rolled ${attempt.roll})`
          : `${shortName(attempt.runner)} is GUNNED DOWN at ${attempt.to}! (rolled ${attempt.roll})`
      );
    }
    return lines;
  }
  lines.push(`${shortName(event.batter)} ${RESULT_LINES[event.result] ?? event.result}`);
  if (event.playDetails?.doublePlayAttempt?.batterOut) lines.push("Double play! Two gone.");
  const thrown = event.playDetails?.thrownAttempt;
  if (thrown) {
    lines.push(
      thrown.safe
        ? `${shortName(thrown.runner)} takes ${thrown.to} on the throw!`
        : `${shortName(thrown.runner)} is cut down at ${thrown.to}!`
    );
  }
  if (event.runs > 0) {
    lines.push(`${event.runs === 1 ? "A run scores!" : `${event.runs} runs score!`} It's ${event.scoreAfter.away}-${event.scoreAfter.home}.`);
  }
  if (event.outsAfter >= 3) {
    lines.push(`Side retired. ${event.half === "top" ? "Bottom" : "Top"} ${event.half === "top" ? event.inning : event.inning + 1} coming up.`);
  }
  return lines;
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
