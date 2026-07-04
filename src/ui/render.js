import { headshotUrl } from "../data/headshots.js";
import { formatRange, normalizeResult } from "../rules/cards.js";

const HITTER_OUTCOMES = ["BB", "1B", "2B", "3B", "HR"];
const PITCHER_OUTCOMES = ["PU", "SO", "GB", "FB", "BB", "1B", "2B", "HR"];
const HISTORY_OUTCOMES = ["PU", "SO", "GB", "FB", "BB", "1B", "2B", "3B", "HR"];

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

export function renderDraftHistoryTable(picks) {
  if (!picks.length) {
    return `<p class="empty">No picks made yet.</p>`;
  }
  const rows = picks
    .map(({ pickNumber, round, manager, player }) => `<tr class="draft-player-row">
        <td class="num">${pickNumber}</td>
        <td class="num">${round}</td>
        <td>${escapeHtml(manager.name)}</td>
        <td><strong class="player-name-preview" tabindex="0" data-preview-id="${escapeHtml(player.id)}" data-preview-card="${escapeHtml(renderPlayerCard(player))}">${escapeHtml(player.name)}</strong></td>
        <td>${escapeHtml(playerPosition(player))}</td>
        <td class="num">${playerPrimary(player)}</td>
        <td class="num">${player.points}</td>
        ${renderOutcomeCells(player, HISTORY_OUTCOMES)}
      </tr>`)
    .join("");

  return `<div class="table-scroll"><table class="player-table history-table">
    <thead>
      <tr>
        <th class="num">#</th>
        <th class="num">Rnd</th>
        <th>Manager</th>
        <th>Player</th>
        <th>Pos</th>
        <th class="num">OB/CT</th>
        <th class="num">Pts</th>
        ${HISTORY_OUTCOMES.map((outcome) => `<th class="num">${outcome}</th>`).join("")}
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
        ${renderPortraitImage(player)}
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

export function renderBoxScore(game, playersById = new Map()) {
  if (!game?.boxScore) return "";
  return `<div class="box-score">
    ${renderHitterBox(game.boxScore.away, playersById)}
    ${renderHitterBox(game.boxScore.home, playersById)}
    ${renderPitcherBox(game.boxScore.away, playersById)}
    ${renderPitcherBox(game.boxScore.home, playersById)}
  </div>`;
}

export const RACE_COLORS = ["#0b6b53", "#8f3147", "#365f91", "#b06c1f", "#5a4f91", "#4f6f2b", "#9c3b21", "#2b6f6f"];

export function raceColor(index) {
  return RACE_COLORS[index % RACE_COLORS.length];
}

export function renderRaceChart(race) {
  const teamNames = race?.teamNames ?? [];
  const series = race?.series ?? [];
  if (!teamNames.length || series.length < 2) {
    return `<div class="race-chart-placeholder">Waiting for the first seasons to finish...</div>`;
  }

  const width = 760;
  const height = 280;
  const margin = { top: 16, right: 138, bottom: 32, left: 48 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const lastPoint = series[series.length - 1];
  const totalRuns = Math.max(race.totalRuns ?? lastPoint.n, lastPoint.n, 1);
  const xMin = series[0].n;
  const xSpan = Math.max(1, totalRuns - xMin);
  const parity = 1 / teamNames.length;

  let maxShare = parity;
  for (const point of series) {
    for (const value of point.shares) {
      if (value > maxShare) maxShare = value;
    }
  }
  const yMax = Math.min(1, Math.max(0.3, Math.ceil((maxShare + 0.02) * 10) / 10));

  const xFor = (n) => margin.left + ((n - xMin) / xSpan) * plotWidth;
  const yFor = (value) => margin.top + (1 - value / yMax) * plotHeight;

  const gridStep = yMax > 0.6 ? 0.2 : 0.1;
  const gridLines = [];
  for (let value = 0; value <= yMax + 1e-9; value += gridStep) {
    const yPos = yFor(value);
    gridLines.push(`<line x1="${margin.left}" y1="${yPos.toFixed(1)}" x2="${margin.left + plotWidth}" y2="${yPos.toFixed(1)}" class="race-grid" />
      <text x="${margin.left - 8}" y="${(yPos + 4).toFixed(1)}" text-anchor="end" class="race-axis-text">${Math.round(value * 100)}%</text>`);
  }

  const parityY = yFor(parity);
  const parityLine = parity <= yMax
    ? `<line x1="${margin.left}" y1="${parityY.toFixed(1)}" x2="${margin.left + plotWidth}" y2="${parityY.toFixed(1)}" class="race-parity" />
      <text x="${margin.left + 6}" y="${(parityY - 5).toFixed(1)}" class="race-axis-text race-parity-text">even draft (${Math.round(parity * 100)}%)</text>`
    : "";

  const xTicks = [xMin, Math.round((xMin + totalRuns) / 2), totalRuns].map((n) => {
    const xPos = xFor(n);
    return `<text x="${xPos.toFixed(1)}" y="${height - 10}" text-anchor="middle" class="race-axis-text">${n}</text>`;
  });

  const lines = teamNames.map((name, index) => {
    const points = series
      .map((point) => `${xFor(point.n).toFixed(1)},${yFor(point.shares[index] ?? 0).toFixed(1)}`)
      .join(" ");
    return `<polyline points="${points}" fill="none" stroke="${raceColor(index)}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />`;
  });

  const labels = teamNames
    .map((name, index) => ({
      name,
      color: raceColor(index),
      value: lastPoint.shares[index] ?? 0,
      yPos: yFor(lastPoint.shares[index] ?? 0)
    }))
    .sort((a, b) => a.yPos - b.yPos);
  for (let index = 1; index < labels.length; index += 1) {
    labels[index].yPos = Math.max(labels[index].yPos, labels[index - 1].yPos + 14);
  }
  const labelMaxY = margin.top + plotHeight;
  for (let index = labels.length - 1; index >= 0; index -= 1) {
    const limit = labelMaxY - (labels.length - 1 - index) * 14;
    if (labels[index].yPos > limit) labels[index].yPos = limit;
  }
  const endX = Math.min(xFor(lastPoint.n), margin.left + plotWidth);
  const labelTexts = labels.map((label) => `<text x="${(endX + 8).toFixed(1)}" y="${(label.yPos + 4).toFixed(1)}" fill="${label.color}" class="race-label">${escapeHtml(label.name)} ${(label.value * 100).toFixed(1)}%</text>`);

  return `<svg viewBox="0 0 ${width} ${height}" class="race-chart" role="img" aria-label="Cumulative title share by team as seasons are simulated">
    ${gridLines.join("")}
    ${parityLine}
    ${xTicks.join("")}
    ${lines.join("")}
    ${labelTexts.join("")}
  </svg>`;
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

function renderHitterBox(teamBox, playersById) {
  const rows = teamBox.hitters
    .map(
      (line) => `<tr>
        <td>${renderBoxScorePlayerName(line, teamBox.team, playersById)}</td>
        <td class="num">${line.ab}</td>
        <td class="num">${line.r ?? 0}</td>
        <td class="num">${line.h}</td>
        <td class="num">${line.bb}</td>
        <td class="num">${line.so}</td>
        <td class="num">${line.hr}</td>
        <td class="num">${line.sb ?? 0}</td>
        <td class="num">${line.cs ?? 0}</td>
        <td class="num">${line.rbi}</td>
      </tr>`
    )
    .join("");
  return `<section>
    <h4>${escapeHtml(teamBox.team)} hitters</h4>
    <table>
      <thead><tr><th>Name</th><th>AB</th><th>R</th><th>H</th><th>BB</th><th>SO</th><th>HR</th><th>SB</th><th>CS</th><th>RBI</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

function renderPitcherBox(teamBox, playersById) {
  const rows = teamBox.pitchers
    .map(
      (line) => `<tr>
        <td>${renderBoxScorePlayerName(line, teamBox.team, playersById)}</td>
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

function renderBoxScorePlayerName(line, team, playersById) {
  const player = playerForBoxLine(line, team, playersById);
  if (!player) return escapeHtml(line.name);
  return `<strong
    class="player-name-preview box-score-player-name"
    tabindex="0"
    data-preview-id="${escapeHtml(player.id)}"
    data-preview-card="${escapeHtml(renderPlayerCard(player))}"
  >${escapeHtml(line.name)}</strong>`;
}

function playerForBoxLine(line, team, playersById) {
  return playersById.get(line.id)
    ?? playersById.get(`${line.team ?? team ?? ""}::${line.name ?? ""}`)
    ?? playersById.get(line.name)
    ?? null;
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

function renderPortraitImage(player) {
  const imageUrl = playerImageUrl(player);
  if (!imageUrl) return "";
  return `<img class="player-portrait" src="${imageUrl}" alt="" loading="lazy" referrerpolicy="no-referrer" onload="this.classList.add('loaded')" onerror="this.remove()" />`;
}

// Real-pool players (they carry a team) get real photos; fictional generated
// players keep the illustrated avatars. A real player with no known photo
// shows the initials placeholder instead of a cartoon.
function playerImageUrl(player) {
  if (player.team) return headshotUrl(player.name);
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
