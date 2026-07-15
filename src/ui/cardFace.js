import { formatRange, positionFieldingLabel } from "../rules/cards.js?v=20260715-d";
import { dualPartnerCard } from "../data/universes.js";
import { CARD_IMAGE_FILES } from "../data/cardImages.js";
import { MLB_TEAM_CODES, MLB_PLAYER_TEAMS, MLB_TEAM_CLUB_NAMES } from "../data/mlbTeams.js";

// The printed card front, shared by both games: the adventure browses these
// in its binder, the draft app floats them over the board. A card renders the
// same either way — a classic card is its real scan, an MLB or fictional card
// is the 2005 face. Styling lives in cardFace.css; the photo slots hydrate at
// runtime through photos.js.

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function shortName(name) {
  const parts = String(name).split(" ");
  if (parts.length < 2) return name.toUpperCase();
  return `${parts[0][0]}.${parts.slice(1).join(" ")}`.toUpperCase();
}

// Classic card names carry their card year ("Mike Caruso '02"). Cramped or
// conversational spots (the matchup panel, the play-by-play) drop it; the
// binder, rosters, and box scores keep it so twin printings stay tellable.
export function stripCardYear(name) {
  return String(name).replace(/\s*'\d\d$/, "");
}

// The name a scoreboard puts up: the last word of a man's name is USUALLY his
// surname, and for Ken Griffey Jr. it is "Jr." — which is how the lineup strip
// came to have a JR. batting third. The suffix is not the man.
const NAME_SUFFIXES = new Set(["JR", "SR", "II", "III", "IV"]);

export function surname(name) {
  const words = stripCardYear(String(name)).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return String(name).toUpperCase();
  let last = words.length - 1;
  while (last > 0 && NAME_SUFFIXES.has(words[last].replace(/\./g, "").toUpperCase())) last -= 1;
  return words[last].toUpperCase();
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

const RARITY_LABELS = {
  common: "COMMON",
  uncommon: "UNCOMMON",
  rare: "RARE",
  legend: "LEGEND"
};

export function rarityTag(card) {
  const key = RARITY_LABELS[card.rarity] ? card.rarity : "common";
  return `<span class="gq-rarity gq-rarity-${key}">${RARITY_LABELS[key]}</span>`;
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
  return `gq-card gq-card-${card.kind === "pitcher" ? "pitcher" : "hitter"} gq-rarity-border-${card.rarity ?? "common"}${foil ? " gq-foil" : ""}${extra}`;
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

function photoName(name) {
  return stripCardYear(name);
}

const FICTIONAL_BACKDROPS = [
  "day", "sunset", "night", "ivy", "brick", "dome",
  "aqua", "violet", "citrus", "lagoon", "plum", "denim",
  "mint", "berry", "amber", "teal", "orchid", "slate",
  "salmon", "indigo", "jade", "wine", "ice", "peach"
];

function fictionalBackdropClass(card) {
  const key = String(card.id ?? card.name ?? "player");
  let hash = 2166136261;
  for (const char of key) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `gq-backdrop-${FICTIONAL_BACKDROPS[hash % FICTIONAL_BACKDROPS.length]}`;
}

const FICTIONAL_HITTER_CHART = ["SO", "GB", "FB", "BB", "1B", "1B+", "2B", "3B", "HR"];
const FICTIONAL_PITCHER_CHART = ["PU", "SO", "GB", "FB", "BB", "1B", "2B", "HR"];

function fictionalRarity(card) {
  if (card.rarity === "legend") return { key: "legendary", label: "LEGENDARY" };
  if (card.rarity === "rare") return { key: "gold", label: "GOLD" };
  if (card.rarity === "uncommon") return { key: "bronze", label: "BRONZE" };
  return { key: "common", label: "COMMON" };
}

function fictionalRarityMark(rarity) {
  if (rarity.key !== "legendary") return escapeHtml(rarity.label);
  const letters = [...rarity.label]
    .map((letter) => `<span aria-hidden="true">${escapeHtml(letter)}</span>`)
    .join("");
  return `<span class="gq-proto-rainbow-word" aria-label="${escapeHtml(rarity.label)}">${letters}</span>`;
}

function fictionalChartRows(card) {
  const order = card.kind === "pitcher" ? FICTIONAL_PITCHER_CHART : FICTIONAL_HITTER_CHART;
  const merged = chartRangeCells(card);
  const ranges = order.map((result) => {
    const text = merged.filter((entry) => entry.result === result).map(formatRange).join(",");
    return `<span>${text ? escapeHtml(text) : "&mdash;"}</span>`;
  }).join("");
  const outcomes = order.map((result) => `<span>${escapeHtml(result)}</span>`).join("");
  return `<div class="gq-proto-chart" style="--gq-proto-cols:${order.length}">
    <div class="gq-proto-chart-ranges">${ranges}</div>
    <div class="gq-proto-chart-outcomes">${outcomes}</div>
  </div>`;
}

function fictionalNameFontSize(name) {
  const size = 70 / (0.52 * Math.max(1, String(name).length));
  return Math.max(4.3, Math.min(7.75, size)).toFixed(2);
}

function fictionalPitcherBadge(card) {
  return `<svg class="gq-proto-baseball" viewBox="0 0 100 100" aria-hidden="true">
    <circle class="gq-proto-ball-fill" cx="50" cy="50" r="48"></circle>
    <g class="gq-proto-ball-markings" transform="rotate(35 50 50)">
      <path class="gq-proto-ball-seam" d="M 18 7 C 42 22 42 78 18 93"></path>
      <path class="gq-proto-ball-seam" d="M 82 7 C 58 22 58 78 82 93"></path>
      <path class="gq-proto-ball-stitches" d="M 23 20 L 33 12 M 29 32 L 39 26 M 31 44 L 43 42 M 31 56 L 43 58 M 29 68 L 39 74 M 23 80 L 33 88"></path>
      <path class="gq-proto-ball-stitches" d="M 67 12 L 77 20 M 61 26 L 71 32 M 57 42 L 69 44 M 57 58 L 69 56 M 61 74 L 71 68 M 67 88 L 77 80"></path>
    </g>
  </svg>
  <svg class="gq-proto-ribbon" viewBox="0 0 200 70" aria-hidden="true">
    <path d="M 8 30 Q 100 7 192 30 L 181 64 Q 100 42 19 64 Z"></path>
  </svg>
  <div class="gq-proto-control" aria-label="Control plus ${escapeHtml(card.control)}">
    <span class="gq-proto-control-plus">+</span>
    <span class="gq-proto-control-number">${escapeHtml(card.control)}</span>
  </div>
  <svg class="gq-proto-control-label" viewBox="0 0 200 70" role="img" aria-label="Control">
    <path id="gq-control-curve-${escapeHtml(card.id)}" d="M 15 52 Q 100 29 185 52"></path>
    <text><textPath href="#gq-control-curve-${escapeHtml(card.id)}" startOffset="50%">CONTROL</textPath></text>
  </svg>`;
}

function fictionalCardHtml(card, count) {
  const pitcher = card.kind === "pitcher";
  const rarity = fictionalRarity(card);
  const frame = pitcher
    ? "vendor/showdownbot/2004-Pitcher-BLUE-NO-FOOTER-NO-RIBBON.png"
    : "vendor/showdownbot/2004-Hitter-BLUE-NO-FOOTER.png";
  const role = card.role === "SP" ? "STARTER" : "RELIEVER";
  const stats = pitcher
    ? [`${card.points} PT`, role, `IP ${card.ip}`, `THROWS ${card.throws}`]
    : [`${card.points} PT`, `SPEED ${card.speed}`, `BATS ${card.bats}`, positionFieldingLabel(card)];
  const rating = pitcher
    ? fictionalPitcherBadge(card)
    : `<div class="gq-proto-onbase">${escapeHtml(card.onBase)}</div>`;
  const initials = card.name.split(" ").map((word) => word[0] ?? "").slice(0, 2).join("").toUpperCase();
  return `<div class="${cardShell(card)} gq-proto-card gq-proto-${pitcher ? "pitcher" : "hitter"} gq-proto-rarity-${rarity.key}"><div class="gq-face">
    <div class="gq-proto-photo gq-fictional-backdrop ${fictionalBackdropClass(card)}">
      <span class="gq-proto-initials">${escapeHtml(initials)}</span>
      <img class="gq-proto-portrait" src="https://api.dicebear.com/10.x/micah/svg?seed=${encodeURIComponent(`${card.name}-${card.kind}-${card.position ?? card.role}`)}&clothesVariant=crew" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">
    </div>
    <img class="gq-proto-frame gq-proto-frame-top" src="${frame}" alt="">
    <img class="gq-proto-frame gq-proto-frame-bottom" src="${frame}" alt="">
    <span class="gq-proto-rarity-mark">${fictionalRarityMark(rarity)}</span>
    ${count !== null ? `<span class="gq-proto-count">x${count}</span>` : ""}
    ${rating}
    <div class="gq-proto-name" style="font-size:${fictionalNameFontSize(card.name)}cqw">${escapeHtml(card.name.toUpperCase())}</div>
    <div class="gq-proto-meta">${stats.map((value) => `<span>${escapeHtml(value)}</span>`).join("")}</div>
    ${fictionalChartRows(card)}
  </div></div>`;
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
  if (!card.real) return fictionalCardHtml(card, count);
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
  const photoClass = card.real ? "gq-photo" : `gq-photo gq-fictional-backdrop ${fictionalBackdropClass(card)}`;
  return `<div class="${cardShell(card, partner ? " gq-card-two-way" : "")}"><div class="gq-face">
    <div class="${photoClass}">${card.real
      ? `<div class="gq-card-headshot" data-photo-name="${escapeHtml(photoName(card.name))}" data-era="${eraYear(card)}"${card.replacement ? " data-photo-anon" : ""}${card.mlbam ? ` data-mlbam="${escapeHtml(String(card.mlbam))}"` : ""}></div>`
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
