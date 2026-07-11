import { formatRange, positionsLabel, positionFieldingLabel } from "../../rules/cards.js";
import { RARITIES, dualPartnerCard } from "../packs.js";
import { CARD_IMAGE_FILES } from "../../data/cardImages.js";
import { MLB_TEAM_CODES, MLB_PLAYER_TEAMS, MLB_TEAM_CLUB_NAMES } from "../../data/mlbTeams.js";

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

// ---- The 2005 card face --------------------------------------------------
//
// Non-classic cards are a faithful port of card-lab-2005.html: black frame,
// full-card photo window, the silver name bar, the white home-plate
// On-Base/Control plate with its pill label, one white stat line, and the
// two-row d20 chart over a stadium-green strip. The one deliberate tweak:
// chart outcomes keep the colored result chips instead of plain white text.
// Geometry is the mock's 400px measurements in card-relative units — the
// card is its own CSS container, so 1cqw inside it = 1% of card width.

// The chart prints a fixed column per outcome — SO GB FB BB 1B 1B+ 2B 3B HR
// for hitters, PU SO GB FB BB 1B 2B HR for pitchers — die range on top,
// result underneath, and an em-dash range where the card simply doesn't
// have that outcome. Fixed positions make cards comparable at a glance. The
// role's off-outcome (hitter PU, pitcher 3B) only appears on the rare card
// that actually rolls it; 1B+ is batter-only and real classic cards are the
// only source that ever prints it.
const CHART_ORDER = ["PU", "SO", "GB", "FB", "BB", "1B", "1B+", "2B", "3B", "HR"];

function fixedChartColumns(card) {
  const merged = chartRangeCells(card);
  const present = new Set(merged.map((entry) => entry.result));
  const optional = new Set([card.kind === "pitcher" ? "3B" : "PU", "1B+"]);
  return CHART_ORDER
    .filter((result) => !optional.has(result) || present.has(result))
    .map((result) => ({
      result,
      text: merged.filter((entry) => entry.result === result).map(formatRange).join(",")
    }));
}

// Two grid rows, exactly like the printed card: every range across the top,
// every result beneath it.
function chartRows(card, extra = "") {
  const columns = fixedChartColumns(card);
  const ranges = columns
    .map(({ text }) => `<span class="gq-chart-range">${text ? escapeHtml(text) : "&mdash;"}</span>`)
    .join("");
  const results = columns
    .map(({ result, text }) =>
      `<span class="gq-chart-result gq-chart-${resultTone(result)}${text ? "" : " gq-chart-empty"}">${escapeHtml(result)}</span>`)
    .join("");
  return `<div class="gq-chart${extra}" style="--gq-chart-cols:${columns.length}">${ranges}${results}</div>`;
}

// A two-way pair prints ONE chart: the outcome labels once, the bat's die
// ranges above them and the arm's below. The column set is the full union —
// PU and 3B both show — with an em-dash on any side that lacks the outcome.
function comboChartRows(bat, arm) {
  const textOf = (card) => {
    const merged = chartRangeCells(card);
    return (result) => merged.filter((entry) => entry.result === result).map(formatRange).join(",");
  };
  const batText = textOf(bat);
  const armText = textOf(arm);
  const present = new Set([...chartRangeCells(bat), ...chartRangeCells(arm)].map((entry) => entry.result));
  const columns = CHART_ORDER.filter((result) => result !== "1B+" || present.has(result));
  const range = (text) => `<span class="gq-chart-range">${text ? escapeHtml(text) : "&mdash;"}</span>`;
  const cells =
    columns.map((result) => range(batText(result))).join("") +
    columns
      .map((result) =>
        `<span class="gq-chart-result gq-chart-${resultTone(result)}${batText(result) || armText(result) ? "" : " gq-chart-empty"}">${escapeHtml(result)}</span>`)
      .join("") +
    columns.map((result) => range(armText(result))).join("");
  return `<div class="gq-chart" style="--gq-chart-cols:${columns.length}">${cells}</div>`;
}

function resultTone(result) {
  if (result === "HR") return "homer";
  if (result === "BB") return "walk";
  if (result === "1B") return "single";
  if (result === "1B+") return "single";
  if (result === "2B") return "double";
  if (result === "3B") return "triple";
  return "out";
}

function cardShell(card, extra = "") {
  const foil = card.foil || card.rarity === "legend";
  return `gq-card gq-card-${card.kind === "pitcher" ? "pitcher" : "hitter"} gq-rarity-border-${card.rarity}${foil ? " gq-foil" : ""}${extra}`;
}

// The team mark over the photo's lower right: a small club logo (hydrated
// at runtime from the club's Wikipedia page image, same pipeline as player
// portraits) with the era-correct code as the standing fallback. The code
// picks the club name, so an Expos-era player gets the Expos logo, never
// the Nationals'. Fictional teams have no logo and keep their letters.
function teamMark(card) {
  const codes = cardTeams(card);
  const code = codes?.length
    ? codes[0]
    : /^mlb-f([A-Z]{2,3})-/.exec(String(card.id ?? ""))?.[1] ?? null;
  if (code) return { code, club: MLB_TEAM_CLUB_NAMES[code] ?? null };
  const team = String(card.team ?? "").trim();
  if (!team) return null;
  return { code: team.slice(0, 3).toUpperCase(), club: MLB_TEAM_CLUB_NAMES[team] ?? null };
}

// Long names shrink to fit the name bar instead of ellipsizing — VLADIMIR
// GUERRERO JR. prints whole, just smaller. The budget is the bar width
// minus the rarity badge (and the 2-WAY badge when the card wears one),
// at roughly 0.52em per condensed-caps character.
function nameFontSize(name, twoWay) {
  const budget = twoWay ? 42 : 52; // cqw of text room on the bar
  const size = budget / (0.52 * Math.max(1, name.length));
  return Math.max(3.4, Math.min(6.25, size)).toFixed(2);
}

// rating: lead with OB/CTRL — for the classic scan tray, where there's no
// home-plate graphic carrying the number.
function statLineHtml(card, { rating = false } = {}) {
  const lead = rating ? `<span>${card.kind === "pitcher" ? `CTRL ${card.control}` : `OB ${card.onBase}`}</span>` : "";
  return card.kind === "pitcher"
    ? `${lead}<span>${card.points} PTS</span><span>IP ${card.ip}</span><span>${escapeHtml(card.role)}</span>`
    : `${lead}<span>${card.points} PTS</span><span>SPEED ${card.speed}</span><span>${escapeHtml(positionFieldingLabel(card))}</span>`;
}

// The stadium backdrop behind the strip: blurred crowd lights over outfield
// green, seeded off the card id so each card keeps its own night sky.
function stripBackdrop(id) {
  let seed = [...String(id)].reduce((hash, ch) => (hash * 31 + ch.charCodeAt(0)) >>> 0, 99) || 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const uid = `gq${(seed % 99991).toString(36)}`;
  const lights = [];
  for (let i = 0; i < 26; i += 1) {
    const x = (rand() * 386).toFixed(1);
    const y = (8 + rand() * 40).toFixed(1);
    const r = (2 + rand() * 5).toFixed(1);
    lights.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="hsl(140 22% ${(30 + rand() * 22).toFixed(0)}%)"/>`);
  }
  return `<svg viewBox="0 0 386 138" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="386" height="138" fill="#0f2716"/>
    <g filter="url(#${uid}b)" opacity="0.75">
      ${lights.join("")}
      <rect y="52" width="386" height="26" fill="#1b4a2c"/>
      <rect y="76" width="386" height="62" fill="#0c2413"/>
    </g>
    <rect width="386" height="138" fill="url(#${uid}s)"/>
    <defs>
      <filter id="${uid}b"><feGaussianBlur stdDeviation="6"/></filter>
      <linearGradient id="${uid}s" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="rgba(4,12,7,0.25)"/>
        <stop offset="1" stop-color="rgba(3,9,5,0.72)"/>
      </linearGradient>
    </defs>
  </svg>`;
}

export function cardPanelHtml(card, { count = null } = {}) {
  // Classic cards with a real scan ARE the card: the printed scan fills the
  // frame (courtesy of ShowdownCards.com), with just a compact chart tray
  // below at the scan's width — no rarity chip, no set tag; the print
  // already says everything else.
  const scan = CARD_IMAGE_FILES[card.id];
  if (scan) {
    return `<div class="${cardShell(card, " gq-card-has-scan")}"><div class="gq-face">
      <div class="gq-scan-wrap">
        <img class="gq-card-scan" src="assets/cards/${escapeHtml(scan)}" alt="" loading="lazy">
        ${count !== null ? `<span class="gq-photo-tag">x${count}</span>` : ""}
      </div>
      <div class="gq-scan-tray"><div class="gq-stat-line">${statLineHtml(card, { rating: true })}</div>${chartRows(card)}</div>
    </div></div>`;
  }
  const initials = card.name.split(" ").map((word) => word[0] ?? "").slice(0, 2).join("").toUpperCase();
  const mark = teamMark(card);
  // Years active and clubs float in the photo's top-left corner — the
  // identity facts the printed face doesn't carry. Rarity badges the name
  // bar instead.
  const teams = cardTeams(card);
  const overlay = `<div class="gq-card-overlay">
    ${card.setTag ? `<span class="gq-card-overlay-line">${escapeHtml(card.setTag)}</span>` : ""}
    ${teams?.length ? `<span class="gq-card-overlay-line">${teams.map(escapeHtml).join(" &middot; ")}</span>` : ""}
  </div>`;
  // A simultaneous two-way pair prints as ONE card: "NAME - 2-WAY", a
  // combined 13|5 plate labeled OB|CTRL, one stat line (points for the
  // pair, the bat's speed, the arm's IP and role — the bat half DHs, so
  // its position goes without saying), and both charts stacked, bat over
  // arm. Both halves still roster separately.
  const partner = dualPartnerCard(card.id);
  const bat = partner ? (card.kind === "hitter" ? card : partner) : null;
  const arm = partner ? (card.kind === "pitcher" ? card : partner) : null;
  const nameBadge = partner ? `<span class="gq-name-badge">2-WAY</span>` : "";
  const plate = partner ? `${bat.onBase}|${arm.control}` : card.kind === "pitcher" ? card.control : card.onBase;
  const plateLabel = partner ? "OB|CTRL" : card.kind === "pitcher" ? "CTRL" : "OB";
  const stat = partner
    ? `<span>${card.points + partner.points} PTS</span><span>SPEED ${bat.speed}</span><span>IP ${arm.ip}</span><span>${escapeHtml(arm.role)}</span>`
    : statLineHtml(card);
  const charts = partner ? comboChartRows(bat, arm) : chartRows(card);
  return `<div class="${cardShell(card, partner ? " gq-card-two-way" : "")}"><div class="gq-face">
    <div class="gq-photo">${card.real
      ? `<div class="gq-card-headshot" data-photo-name="${escapeHtml(photoName(card.name))}" data-era="${eraYear(card)}"${card.mlbam ? ` data-mlbam="${escapeHtml(String(card.mlbam))}"` : ""}></div>`
      : `<span class="gq-card-initials">${escapeHtml(initials)}</span>
      <img class="gq-fictional-face" src="https://api.dicebear.com/9.x/open-peeps/svg?seed=${encodeURIComponent(`${card.name}-${card.kind}`)}&backgroundColor=transparent" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`}
      ${overlay}
      ${count !== null ? `<span class="gq-photo-tag">x${count}</span>` : ""}</div>
    ${mark ? `<div class="gq-team-mark"${mark.club ? ` data-team-logo="${escapeHtml(mark.club)}"` : ""}>${escapeHtml(mark.code)}</div>` : ""}
    <div class="gq-strip">
      <div class="gq-strip-bg">${stripBackdrop(card.id)}</div>
      <div class="gq-name-bar"><span class="gq-name" style="font-size:${nameFontSize(card.name, Boolean(partner))}cqw">${escapeHtml(card.name.toUpperCase())}</span>${nameBadge}${rarityTag(card)}</div>
      <div class="gq-plate${partner ? " gq-plate-combo" : ""}"><span>${plate}</span></div>
      <div class="gq-plate-label">${plateLabel}</div>
      <div class="gq-stat-line">${stat}</div>
      ${charts}
    </div>
  </div></div>`;
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
    .sort((a, b) => a.from - b.from)
    .reduce((merged, entry) => {
      const last = merged.at(-1);
      if (last && last.result === entry.result && last.to + 1 === entry.from) last.to = entry.to;
      else merged.push({ ...entry });
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
  "1B+": "lines a single!",
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
  if (event.result === "1B+" && event.basesAfter?.[1] === event.batter) {
    lines.push(`${playName(event.batter)} alertly takes second, uncontested!`);
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
