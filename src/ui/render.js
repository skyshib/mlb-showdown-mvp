import { formatRange, normalizeResult } from "../rules/cards.js";

const HITTER_OUTCOMES = ["BB", "1B", "2B", "3B", "HR"];
const PITCHER_OUTCOMES = ["PU", "SO", "GB", "FB", "BB", "1B", "2B", "HR"];

export function playerPosition(player) {
  return player.kind === "hitter" ? player.position : player.role;
}

export function playerPrimary(player) {
  return player.kind === "hitter" ? player.onBase : player.control;
}

export function playerPower(player) {
  const weights = { BB: 1, "1B": 2, "2B": 4, "3B": 5, HR: 6 };
  return player.chart.reduce((sum, entry) => sum + (entry.to - entry.from + 1) * (weights[normalizeResult(entry.result)] ?? 0), 0);
}

export function renderPlayerTable(players, options = {}) {
  if (!players.length) {
    return `<p class="empty">No matching players.</p>`;
  }
  const mode = options.mode ?? "hitter";
  const outcomes = mode === "pitcher" ? PITCHER_OUTCOMES : HITTER_OUTCOMES;
  const headers = mode === "pitcher"
    ? [
        { label: "" },
        { label: "Player", sort: "name" },
        { label: "Role", sort: "position" },
        { label: "CTRL", sort: "primary" },
        { label: "Throws", sort: "throws" },
        { label: "IP", sort: "ip" },
        { label: "Pts", sort: "points" },
        ...outcomes.map((outcome) => ({ label: outcome, sort: `chart:${outcome}` }))
      ]
    : [
        { label: "" },
        { label: "Player", sort: "name" },
        { label: "Pos", sort: "position" },
        { label: "OB", sort: "primary" },
        { label: "Speed", sort: "speed" },
        { label: "Field", sort: "fielding" },
        { label: "Pts", sort: "points" },
        ...outcomes.map((outcome) => ({ label: outcome, sort: `chart:${outcome}` }))
      ];

  const rows = players
    .map((player) => {
      const legality = options.canPick ? options.canPick(player) : { ok: true, reason: "" };
      const action = options.action
        ? `<button class="small" data-action="${options.action}" data-player-id="${player.id}" ${legality.ok ? "" : "disabled"} title="${escapeHtml(legality.reason)}">${legality.ok ? (options.label ?? "Pick") : "Blocked"}</button>`
        : "";
      const detailCells = player.kind === "pitcher"
        ? `<td>${escapeHtml(player.role)}</td>
        <td class="num">${player.control}</td>
        <td>${escapeHtml(player.throws)}HP</td>
        <td class="num">${player.ip}</td>`
        : `<td>${escapeHtml(player.position)}</td>
        <td class="num">${player.onBase}</td>
        <td class="num">${formatSpeed(player.speed)}</td>
        <td class="num">${formatSignedNumber(player.fielding)}</td>`;
      return `<tr class="draft-player-row">
        <td>${action}</td>
        <td><strong class="player-name-preview" tabindex="0" data-preview-id="${escapeHtml(player.id)}" data-preview-card="${escapeHtml(renderPlayerCard(player))}">${escapeHtml(player.name)}</strong></td>
        ${detailCells}
        <td class="num">${player.points}</td>
        ${renderOutcomeCells(player, outcomes)}
      </tr>`;
    })
    .join("");

  return `<div class="table-scroll"><table class="player-table ${mode}-table">
    <thead>
      <tr>
        ${headers.map((header, index) => renderHeaderCell(header, mode, index, options)).join("")}
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function renderHeaderCell(header, mode, index, options) {
  const className = tableHeaderClass(mode, index);
  if (!header.sort) return `<th class="${className}">${escapeHtml(header.label)}</th>`;
  const active = options.sort === header.sort;
  const direction = active ? options.sortDirection ?? "desc" : null;
  const arrow = direction === "asc" ? "^" : direction === "desc" ? "v" : "";
  return `<th class="${className}" aria-sort="${active ? (direction === "asc" ? "ascending" : "descending") : "none"}">
    <button type="button" class="column-sort ${active ? "active" : ""}" data-sort="${escapeHtml(header.sort)}">
      <span>${escapeHtml(header.label)}</span>${arrow ? `<span class="sort-arrow">${arrow}</span>` : ""}
    </button>
  </th>`;
}

function tableHeaderClass(mode, index) {
  const isNumeric = mode === "pitcher"
    ? index === 3 || index === 5 || index >= 6
    : index >= 3;
  return isNumeric ? "num" : "";
}

function renderOutcomeCells(player, outcomes) {
  const ranges = chartRanges(player.chart);
  return outcomes
    .map((outcome) => `<td class="num chart-range-cell">${ranges.get(outcome) ?? ""}</td>`)
    .join("");
}

function chartRanges(chart) {
  const ranges = new Map();
  for (const entry of chart) {
    const result = normalizeResult(entry.result);
    const resultRanges = ranges.get(result) ?? [];
    resultRanges.push(formatRange(entry));
    ranges.set(result, resultRanges);
  }
  return new Map([...ranges].map(([result, resultRanges]) => [result, resultRanges.join(", ")]));
}

export function renderCardGrid(players, options = {}) {
  if (!players.length) return `<p class="empty">No cards yet.</p>`;
  return `<div class="card-grid ${options.compact ? "compact-cards" : ""}">
    ${players.map((player) => renderPlayerCard(player)).join("")}
  </div>`;
}

export function renderPlayerCard(player) {
  const isPitcher = player.kind === "pitcher";
  const primaryValue = isPitcher ? player.control : player.onBase;
  const color = teamColor(player.name);
  const teamDark = shade(color, -42);
  const rarity = cardRarity(player);
  const meta = isPitcher
    ? `${player.points} pt&nbsp;&nbsp;CTRL ${player.control}&nbsp;&nbsp;IP ${player.ip}&nbsp;&nbsp;${escapeHtml(player.throws)}HP`
    : `${player.points} pt&nbsp;&nbsp;SPD ${formatSpeed(player.speed)}&nbsp;&nbsp;${escapeHtml(player.position)}${formatSignedNumber(player.fielding)}&nbsp;&nbsp;BATS ${escapeHtml(player.bats)}`;
  return `<article class="player-card ${isPitcher ? "pitcher-card" : "hitter-card"} rarity-${rarity.key}" style="--card-accent:${color};--card-accent-dark:${teamDark};--rarity-frame:${rarity.frame}">
    <div class="card-photo">
      <div class="card-logo"><span>MLB Showdown</span></div>
      <div class="card-portrait-stage">
        <img class="player-portrait" src="${playerImageUrl(player)}" alt="" loading="lazy" referrerpolicy="no-referrer" onload="this.classList.add('loaded')" onerror="this.remove()" />
        <span>${escapeHtml(initials(player.name))}</span>
      </div>
    </div>
    <div class="card-lower-panel">
      <div class="card-player-strip">
        <div class="card-primary-square">${primaryValue}</div>
        <div class="card-strip-text">
          <h3>${escapeHtml(player.name)}</h3>
          <div class="card-strip-meta">${meta}</div>
        </div>
        <div class="card-team-mark">${isPitcher ? escapeHtml(player.role) : escapeHtml(player.bats)}</div>
      </div>
      ${renderShowdownChart(player)}
    </div>
  </article>`;
}

function cardRarity(player) {
  if (player.points >= 390) return { key: "rainbow", frame: "conic-gradient(from 40deg, #ff6279, #ffd15e, #53d69e, #4f9dff, #c27cff, #ff6279)" };
  if (player.points >= 340) return { key: "gold", frame: "#e1b64b" };
  if (player.points >= 285) return { key: "silver", frame: "#c9d2d8" };
  return { key: "bronze", frame: "#9c6a3f" };
}

export function renderBoxScore(game) {
  if (!game?.boxScore) return "";
  return `<div class="box-score">
    ${renderHitterBox(game.boxScore.away)}
    ${renderHitterBox(game.boxScore.home)}
    ${renderPitcherBox(game.boxScore.away)}
    ${renderPitcherBox(game.boxScore.home)}
  </div>`;
}

export function basesText(bases) {
  const labels = ["1B", "2B", "3B"];
  const occupied = bases
    .map((runner, index) => (runner ? `${labels[index]} ${runner}` : null))
    .filter(Boolean);
  return occupied.length ? occupied.join(", ") : "empty";
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderHitterBox(teamBox) {
  const rows = teamBox.hitters
    .map(
      (line) => `<tr>
        <td>${escapeHtml(line.name)}</td>
        <td class="num">${line.ab}</td>
        <td class="num">${line.h}</td>
        <td class="num">${line.bb}</td>
        <td class="num">${line.so}</td>
        <td class="num">${line.hr}</td>
        <td class="num">${line.rbi}</td>
      </tr>`
    )
    .join("");
  return `<section>
    <h4>${escapeHtml(teamBox.team)} hitters</h4>
    <table>
      <thead><tr><th>Name</th><th>AB</th><th>H</th><th>BB</th><th>SO</th><th>HR</th><th>RBI</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

function renderPitcherBox(teamBox) {
  const rows = teamBox.pitchers
    .map(
      (line) => `<tr>
        <td>${escapeHtml(line.name)}</td>
        <td class="num">${formatInnings(line.outs)}</td>
        <td class="num">${line.h}</td>
        <td class="num">${line.bb}</td>
        <td class="num">${line.so}</td>
        <td class="num">${line.hr}</td>
        <td class="num">${line.r}</td>
      </tr>`
    )
    .join("");
  return `<section>
    <h4>${escapeHtml(teamBox.team)} pitchers</h4>
    <table>
      <thead><tr><th>Name</th><th>IP</th><th>H</th><th>BB</th><th>SO</th><th>HR</th><th>R</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

function formatInnings(outs) {
  const innings = Math.floor(outs / 3);
  const remainder = outs % 3;
  return `${innings}.${remainder}`;
}

function initials(name) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatSpeed(speed) {
  return String(speed ?? "");
}

function formatSignedNumber(value) {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return number > 0 ? `+${number}` : String(number);
}

function playerImageUrl(player) {
  const seed = encodeURIComponent(`${player.name}-${player.kind}-${playerPosition(player)}`);
  return `https://api.dicebear.com/9.x/adventurer/svg?seed=${seed}&backgroundColor=transparent`;
}

function renderShowdownChart(player) {
  const cells = compactChartEntries(player)
    .sort((a, b) => a.from - b.from)
    .map((entry) => {
      const result = normalizeResult(entry.result);
      return `<div class="chart-cell ${resultClass(result)}" title="${formatRange(entry)} ${resultLabel(result)}">
        <span class="chart-range">${formatRange(entry)}</span>
        <span class="chart-result">${result}</span>
      </div>`;
    })
    .join("");
  return `<div class="showdown-chart" style="--chart-columns:${compactChartEntries(player).length}" aria-label="${escapeHtml(player.name)} result chart">${cells}</div>`;
}

function compactChartEntries(player) {
  return [...player.chart]
    .map((entry) => ({ ...entry, result: normalizeResult(entry.result) }))
    .sort((a, b) => a.from - b.from)
    .reduce((merged, entry) => {
      const last = merged.at(-1);
      if (last && last.result === entry.result && last.to + 1 === entry.from) {
        last.to = entry.to;
      } else {
        merged.push({ ...entry });
      }
      return merged;
    }, []);
}

function resultClass(result) {
  if (["SO", "GB", "FB", "PU"].includes(result)) return "out";
  if (result === "BB") return "walk";
  if (result === "1B") return "single";
  if (result === "2B") return "double";
  if (result === "3B") return "triple";
  if (result === "HR") return "homer";
  return "out";
}

function resultLabel(result) {
  const labels = {
    PU: "Out(PU)",
    SO: "Out(SO)",
    GB: "Out(GB)",
    FB: "Out(FB)",
    BB: "Walk",
    "1B": "Single",
    "2B": "Double",
    "3B": "Triple",
    HR: "Homer"
  };
  return labels[result] ?? result;
}

function fictionalTeam(name) {
  const marks = ["Rockets", "Comets", "Pilots", "Foundry", "Caps", "Tides"];
  let total = 0;
  for (let i = 0; i < name.length; i += 1) total += name.charCodeAt(i);
  return marks[total % marks.length];
}

function teamColor(seed) {
  const colors = ["#0b6b53", "#365f91", "#8a4c22", "#8f3147", "#4f6f2b", "#5a4f91"];
  let total = 0;
  for (let i = 0; i < seed.length; i += 1) total += seed.charCodeAt(i);
  return colors[total % colors.length];
}

function shade(hex, amount) {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((index) => Math.max(0, Math.min(255, parseInt(value.slice(index, index + 2), 16) + amount)));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}
