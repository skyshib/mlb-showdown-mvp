import { generatePlayerPool } from "./data/playerGeneration.js?v=20260704-card-variance";
import {
  autopick,
  assignLineupSlots,
  availablePlayers,
  buildTeam,
  canPlayerFillLineupSlot,
  canPickPlayer,
  createDraft,
  currentManager,
  getRosterNeeds,
  lineupStatus,
  pickPlayer,
  staffStatus,
  undoLastPick,
  validateRoster
} from "./rules/draft.js?v=20260704-roster-depth";
import { simulateRoundRobin } from "./rules/tournament.js";
import {
  basesText,
  escapeHtml,
  playerPosition,
  playerPower,
  playerPrimary,
  renderBoxScore,
  renderCardGrid,
  renderPlayerCard,
  renderPlayerTable
} from "./ui/render.js?v=20260704-roster-depth";

const STORAGE_KEY = "mlb-showdown-mvp-state-v2";
const app = document.querySelector("#app");
const cardPreview = document.createElement("div");
cardPreview.className = "hover-card-preview";
cardPreview.setAttribute("aria-hidden", "true");
document.body.append(cardPreview);

let state = loadState() ?? defaultState();
let selectedLineupMove = null;
let draggedLineupMove = null;

renderCurrentScreen();

function defaultState() {
  return {
    seed: "coefficient-classic",
    managers: ["Kasey", "Milo", "Nico", "Rafa"],
    rosterSize: 13,
    draft: null,
    tournament: null,
    selectedGameIndex: 0,
    selectedTeamName: null,
    filters: {
      type: "hitter",
      position: "all",
      sort: "points",
      sortDirection: "desc",
      search: ""
    }
  };
}

function renderCurrentScreen() {
  if (state.tournament) {
    renderTournament();
  } else if (state.draft) {
    renderDraft();
  } else {
    renderSetup();
  }
}

function renderSetup() {
  app.onclick = null;
  app.oninput = null;
  app.onchange = null;
  app.onpointerover = null;
  app.onpointermove = null;
  app.onpointerout = null;
  app.onmouseover = null;
  app.onmousemove = null;
  app.onmouseout = null;
  app.onfocusin = null;
  app.onfocusout = null;
  app.onkeydown = null;
  hideHoverCard();
  app.innerHTML = `<section class="panel setup">
    <div>
      <p class="eyebrow">MLB Showdown-ish MVP</p>
      <h1>Draft fictional cards. Sim a tournament.</h1>
      <p class="lede">Private local prototype. It now saves your room in this browser, so reloads should not wipe the draft.</p>
    </div>
    <form id="setup-form" class="setup-grid">
      <label>
        Managers
        <textarea name="managers" rows="5">${escapeHtml(state.managers.join("\n"))}</textarea>
      </label>
      <label>
        Seed
        <input name="seed" value="${escapeHtml(state.seed)}" />
      </label>
      <label>
        Roster size
        <input name="rosterSize" type="number" min="13" max="13" value="13" />
      </label>
      <button type="submit">Start draft</button>
    </form>
  </section>
  <section class="panel notes">
    <h2>V1 rules assumption</h2>
    <p>Control roll is d20 plus pitcher control versus hitter on-base. Higher than on-base uses the pitcher chart; ties go to the hitter. Baserunning is simplified and documented in <code>docs/rules.md</code>.</p>
  </section>`;

  document.querySelector("#setup-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const managers = String(form.get("managers"))
      .split("\n")
      .map((name) => name.trim())
      .filter(Boolean);
    state.seed = String(form.get("seed")).trim() || "showdown";
    state.managers = managers.length >= 2 ? managers : ["Home", "Away"];
    state.rosterSize = 13;
    const pool = generatePlayerPool(state.seed, state.managers.length, state.rosterSize);
    state.draft = createDraft(state.managers, pool, state.rosterSize);
    state.tournament = null;
    state.selectedGameIndex = 0;
    state.selectedTeamName = state.managers[0];
    saveState();
    renderDraft();
  });
}

function renderDraft() {
  const draft = state.draft;
  const current = draft.complete ? null : currentManager(draft);
  const playerRows = draft.complete
    ? filteredPlayers(availablePlayers(draft)).sort(comparePlayers).slice(0, 40)
    : draftVisiblePlayers(draft, current);
  const rosters = draft.managers.map((manager) => renderRoster(manager, draft)).join("");
  const focusManager = current ?? (state.selectedTeamName
    ? draft.managers.find((manager) => manager.name === state.selectedTeamName) ?? draft.managers[0]
    : draft.managers[0]);

  app.innerHTML = `<section class="toolbar">
    <button data-action="reset">New room</button>
    <button data-action="autopick" ${draft.complete ? "disabled" : ""}>Auto-pick next</button>
    <button data-action="undo-pick" ${draft.pickNumber > 0 ? "" : "disabled"}>Undo last pick</button>
    <button data-action="finish" ${draft.complete ? "disabled" : ""}>Auto-finish draft</button>
    <button data-action="tournament" ${canSimulate(draft) ? "" : "disabled"}>Sim tournament</button>
  </section>
  ${renderDraftFocus(draft, focusManager)}
  <section class="grid">
    <div class="panel">
      <div class="section-head">
        <h2>Available cards</h2>
        ${renderFilters()}
      </div>
      ${renderPlayerTable(playerRows, {
        mode: state.filters.type,
        action: "pick",
        label: "Pick",
        sort: state.filters.sort,
        sortDirection: state.filters.sortDirection,
        canPick: (player) => (current ? canPickPlayer(draft, current, player) : { ok: false, reason: "draft complete" })
      })}
    </div>
    <div class="panel">
      <h2>Rosters</h2>
      <div class="rosters">${rosters}</div>
    </div>
  </section>`;

  bindDraftActions();
}

function bindDraftActions() {
  let hoveredPreviewRow = null;

  app.onclick = (event) => {
    const lineupSlot = event.target.closest("[data-lineup-slot]");
    if (lineupSlot) {
      handleLineupSlotClick(lineupSlot);
      return;
    }

    const filterButton = event.target.closest("button[data-filter]");
    if (filterButton) {
      state.filters[filterButton.dataset.filter] = filterButton.dataset.filterValue;
      if (filterButton.dataset.filter === "type") {
        state.filters.position = "all";
        state.filters.sort = "points";
        state.filters.sortDirection = "desc";
      }
      saveState();
      renderDraft();
      return;
    }

    const sortButton = event.target.closest("button[data-sort]");
    if (sortButton) {
      updateSort(sortButton.dataset.sort);
      saveState();
      renderDraft();
      return;
    }

    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "reset") {
      clearSavedState();
      state = defaultState();
      renderSetup();
      return;
    }
    if (action === "pick") {
      if (button.disabled) return;
      pickPlayer(state.draft, button.dataset.playerId);
      selectedLineupMove = null;
      saveState();
      renderDraft();
    }
    if (action === "autopick") {
      autopick(state.draft);
      selectedLineupMove = null;
      saveState();
      renderDraft();
    }
    if (action === "undo-pick") {
      undoLastPick(state.draft);
      state.tournament = null;
      selectedLineupMove = null;
      draggedLineupMove = null;
      saveState();
      renderDraft();
    }
    if (action === "finish") {
      while (!state.draft.complete) autopick(state.draft);
      selectedLineupMove = null;
      saveState();
      renderDraft();
    }
    if (action === "tournament") {
      const teams = state.draft.managers.map(buildTeam);
      state.tournament = simulateRoundRobin(teams, state.seed);
      state.selectedGameIndex = state.tournament.final ? state.tournament.games.length : 0;
      state.selectedTeamName = state.tournament.standings[0]?.team ?? teams[0]?.name;
      saveState();
      renderTournament();
    }

  };

  app.oninput = (event) => {
    const input = event.target.closest("[data-filter]");
    if (!input) return;
    state.filters[input.dataset.filter] = input.value;
    if (input.dataset.filter === "sort") {
      state.filters.sortDirection = defaultSortDirection(input.value);
    }
    saveState();
    renderDraft();
  };

  app.onchange = app.oninput;

  app.onpointerover = (event) => {
    const previewTarget = event.target.closest(".player-name-preview");
    if (!previewTarget) return;
    hoveredPreviewRow = previewTarget;
    showHoverCard(previewTarget, event.clientX, event.clientY);
  };

  app.onpointermove = (event) => {
    if (!hoveredPreviewRow) return;
    showHoverCard(hoveredPreviewRow, event.clientX, event.clientY);
  };

  app.onpointerout = (event) => {
    const previewTarget = event.target.closest(".player-name-preview");
    if (!previewTarget || (event.relatedTarget instanceof Node && previewTarget.contains(event.relatedTarget))) return;
    hoveredPreviewRow = null;
    hideHoverCard();
  };
  app.onmouseover = app.onpointerover;
  app.onmousemove = app.onpointermove;
  app.onmouseout = app.onpointerout;

  app.onfocusin = (event) => {
    const previewTarget = event.target.closest(".player-name-preview");
    if (!previewTarget) return;
    const rect = previewTarget.getBoundingClientRect();
    showHoverCard(previewTarget, rect.right, rect.top + rect.height / 2);
  };

  app.onfocusout = (event) => {
    if (event.relatedTarget?.closest?.(".player-name-preview")) return;
    hideHoverCard();
  };

  app.onkeydown = (event) => {
    if (event.key === "Escape") {
      selectedLineupMove = null;
      hideHoverCard();
      renderDraft();
    }
  };

  app.ondragstart = (event) => {
    const slot = event.target.closest("[data-lineup-slot][data-player-id]");
    if (!slot) return;
    const player = findRosterPlayer(slot.dataset.managerId, slot.dataset.playerId);
    if (!player || player.kind !== "hitter") return;
    draggedLineupMove = {
      managerId: slot.dataset.managerId,
      playerId: slot.dataset.playerId,
      fromSlot: slot.dataset.slotLabel
    };
    selectedLineupMove = draggedLineupMove;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", slot.dataset.playerId);
  };

  app.ondragover = (event) => {
    const slot = event.target.closest("[data-lineup-slot]");
    if (!slot || !draggedLineupMove) return;
    if (slot.dataset.managerId !== draggedLineupMove.managerId) return;
    if (!canMoveLineupPlayer(draggedLineupMove.managerId, draggedLineupMove.playerId, slot.dataset.slotLabel)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  app.ondrop = (event) => {
    const slot = event.target.closest("[data-lineup-slot]");
    if (!slot || !draggedLineupMove) return;
    if (slot.dataset.managerId !== draggedLineupMove.managerId) return;
    event.preventDefault();
    moveLineupPlayer(draggedLineupMove.managerId, draggedLineupMove.playerId, slot.dataset.slotLabel);
    draggedLineupMove = null;
    selectedLineupMove = null;
    saveState();
    renderDraft();
  };

  app.ondragend = () => {
    if (draggedLineupMove) selectedLineupMove = null;
    draggedLineupMove = null;
  };
}

function renderTournament() {
  const tournament = state.tournament;
  const games = allTournamentGames(tournament);
  const selectedGame = games[state.selectedGameIndex] ?? games[0];
  const selectedTeamName = state.selectedTeamName ?? tournament.standings[0]?.team;
  const selectedManager = state.draft.managers.find((manager) => manager.name === selectedTeamName) ?? state.draft.managers[0];
  const standings = tournament.standings
    .map(
      (row, index) => `<tr class="${row.team === selectedManager.name ? "selected-row" : ""}">
        <td>${index + 1}</td>
        <td><button class="link-button" data-action="select-team" data-team="${escapeHtml(row.team)}">${escapeHtml(row.team)}</button></td>
        <td class="num">${row.wins}</td>
        <td class="num">${row.losses}</td>
        <td class="num">${row.runsFor}</td>
        <td class="num">${row.runsAgainst}</td>
      </tr>`
    )
    .join("");
  const gameButtons = games
    .map(
      (game, index) => `<button class="game-tab ${index === state.selectedGameIndex ? "active" : ""}" data-action="select-game" data-game-index="${index}">
        ${index === tournament.games.length ? "Final: " : ""}${escapeHtml(game.away.name)} ${game.away.runs}, ${escapeHtml(game.home.name)} ${game.home.runs}
      </button>`
    )
    .join("");

  app.innerHTML = `<section class="toolbar">
    <button data-action="back-draft">Back to draft</button>
    <button data-action="rerun-same">Replay same seed</button>
    <button data-action="rerun-new">New sim</button>
    <button data-action="reset">New room</button>
  </section>
  <section class="grid tournament-grid">
    <div class="panel">
      <p class="eyebrow">Tournament</p>
      <h1>${escapeHtml(tournament.final?.winner ?? tournament.standings[0].team)} wins</h1>
      <table>
        <thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>RF</th><th>RA</th></tr></thead>
        <tbody>${standings}</tbody>
      </table>
      <div class="team-detail">
        <h2>${escapeHtml(selectedManager.name)} roster</h2>
        ${renderRosterSummary(selectedManager)}
        ${renderCardGrid(selectedManager.roster, { compact: true })}
      </div>
    </div>
    <div class="panel wide">
      <h2>Games</h2>
      <div class="game-tabs">${gameButtons}</div>
      ${renderGameDetail(selectedGame)}
    </div>
  </section>
  ${renderTournamentStats(games)}`;

  bindTournamentActions();
}

function bindTournamentActions() {
  app.onclick = (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "back-draft") {
      state.tournament = null;
      state.selectedGameIndex = 0;
      saveState();
      renderDraft();
    }
    if (action === "rerun-same") {
      const teams = state.draft.managers.map(buildTeam);
      state.tournament = simulateRoundRobin(teams, state.seed);
      state.selectedGameIndex = state.tournament.final ? state.tournament.games.length : 0;
      saveState();
      renderTournament();
    }
    if (action === "rerun-new") {
      const teams = state.draft.managers.map(buildTeam);
      state.tournament = simulateRoundRobin(teams, `${state.seed}-${Date.now()}`);
      state.selectedGameIndex = state.tournament.final ? state.tournament.games.length : 0;
      saveState();
      renderTournament();
    }
    if (action === "reset") {
      clearSavedState();
      state = defaultState();
      renderSetup();
    }
    if (action === "select-game") {
      state.selectedGameIndex = Number(button.dataset.gameIndex);
      saveState();
      renderTournament();
    }
    if (action === "select-team") {
      state.selectedTeamName = button.dataset.team;
      saveState();
      renderTournament();
    }
  };
  app.oninput = null;
  app.onchange = null;
  app.onpointerover = null;
  app.onpointermove = null;
  app.onpointerout = null;
  app.onmouseover = null;
  app.onmousemove = null;
  app.onmouseout = null;
  app.onfocusin = null;
  app.onfocusout = null;
  app.onkeydown = null;
  hideHoverCard();
}

function showHoverCard(row, clientX, clientY) {
  const cardHtml = row.dataset.previewCard;
  if (!cardHtml) return;
  const previewId = row.dataset.previewId ?? cardHtml;
  if (cardPreview.dataset.previewId !== previewId) {
    cardPreview.innerHTML = cardHtml;
    cardPreview.dataset.previewId = previewId;
  }
  cardPreview.classList.add("active");
  cardPreview.setAttribute("aria-hidden", "false");

  const gap = 16;
  const rect = cardPreview.getBoundingClientRect();
  let x = clientX + gap;
  let y = clientY - rect.height / 2;

  if (x + rect.width + gap > window.innerWidth) x = clientX - rect.width - gap;
  x = Math.max(gap, Math.min(x, window.innerWidth - rect.width - gap));
  y = Math.max(gap, Math.min(y, window.innerHeight - rect.height - gap));

  cardPreview.style.left = `${Math.round(x)}px`;
  cardPreview.style.top = `${Math.round(y)}px`;
}

function hideHoverCard() {
  cardPreview.classList.remove("active");
  cardPreview.setAttribute("aria-hidden", "true");
}

function renderGameDetail(game) {
  if (!game) return "<p>No game selected.</p>";
  return `<div class="game-detail">
    <h3>${escapeHtml(game.away.name)} ${game.away.runs}, ${escapeHtml(game.home.name)} ${game.home.runs}</h3>
    <h4>Box score</h4>
    ${renderBoxScore(game)}
    <h4>Play-by-play</h4>
    ${renderGameLog(game)}
  </div>`;
}

function renderTournamentStats(games) {
  const stats = aggregateTournamentStats(games);
  const hitters = stats.hitters.sort(compareTournamentHitters);
  const pitchers = stats.pitchers.sort(compareTournamentPitchers);

  return `<section class="panel tournament-stats-panel">
    <div class="section-title-row">
      <div>
        <p class="eyebrow">Tournament stats</p>
        <h2>All games combined</h2>
      </div>
      <span>${games.length} games</span>
    </div>
    <div class="leader-grid">
      ${renderLeaderCard("HR leaders", hitters, (row) => row.hr, (row) => `${row.rbi} RBI`)}
      ${renderLeaderCard("RBI leaders", hitters, (row) => row.rbi, (row) => `${row.h} H`)}
      ${renderLeaderCard("Hit leaders", hitters, (row) => row.h, (row) => `${formatAverage(row.h, row.ab)} AVG`)}
      ${renderLeaderCard("Strikeout leaders", pitchers, (row) => row.so, (row) => `${formatInnings(row.outs)} IP`)}
    </div>
    <div class="stat-table-grid">
      <div class="stat-table-block">
        <h3>Hitters</h3>
        <div class="table-scroll">
          <table class="tournament-stat-table">
            <thead><tr><th>Player</th><th>Team</th><th class="num">PA</th><th class="num">AB</th><th class="num">H</th><th class="num">BB</th><th class="num">SO</th><th class="num">HR</th><th class="num">RBI</th><th class="num">AVG</th><th class="num">OBP</th></tr></thead>
            <tbody>${hitters.map(renderTournamentHitterRow).join("")}</tbody>
          </table>
        </div>
      </div>
      <div class="stat-table-block">
        <h3>Pitchers</h3>
        <div class="table-scroll">
          <table class="tournament-stat-table">
            <thead><tr><th>Player</th><th>Team</th><th class="num">IP</th><th class="num">BF</th><th class="num">H</th><th class="num">BB</th><th class="num">SO</th><th class="num">HR</th><th class="num">R</th><th class="num">RA/9</th></tr></thead>
            <tbody>${pitchers.map(renderTournamentPitcherRow).join("")}</tbody>
          </table>
        </div>
      </div>
    </div>
  </section>`;
}

function renderLeaderCard(title, rows, valueForRow, detailForRow) {
  const leaders = rows
    .filter((row) => valueForRow(row) > 0)
    .slice(0, 5);
  if (!leaders.length) {
    return `<article class="leader-card">
      <h3>${escapeHtml(title)}</h3>
      <p class="empty">No leaders yet.</p>
    </article>`;
  }
  const max = Math.max(...leaders.map(valueForRow), 1);
  return `<article class="leader-card">
    <h3>${escapeHtml(title)}</h3>
    <ol>
      ${leaders.map((row) => {
        const value = valueForRow(row);
        const width = Math.round((value / max) * 100);
        return `<li>
          <div class="leader-line">
            <strong>${escapeHtml(row.name)}</strong>
            <span>${escapeHtml(row.team)}</span>
            <b>${value}</b>
          </div>
          <div class="leader-bar-track"><span class="leader-bar" style="--leader-width: ${width}%"></span></div>
          <em>${escapeHtml(detailForRow(row))}</em>
        </li>`;
      }).join("")}
    </ol>
  </article>`;
}

function renderTournamentHitterRow(row) {
  return `<tr>
    <td>${escapeHtml(row.name)}</td>
    <td>${escapeHtml(row.team)}</td>
    <td class="num">${row.pa}</td>
    <td class="num">${row.ab}</td>
    <td class="num">${row.h}</td>
    <td class="num">${row.bb}</td>
    <td class="num">${row.so}</td>
    <td class="num">${row.hr}</td>
    <td class="num">${row.rbi}</td>
    <td class="num">${formatAverage(row.h, row.ab)}</td>
    <td class="num">${formatAverage(row.h + row.bb, row.ab + row.bb)}</td>
  </tr>`;
}

function renderTournamentPitcherRow(row) {
  return `<tr>
    <td>${escapeHtml(row.name)}</td>
    <td>${escapeHtml(row.team)}</td>
    <td class="num">${formatInnings(row.outs)}</td>
    <td class="num">${row.bf}</td>
    <td class="num">${row.h}</td>
    <td class="num">${row.bb}</td>
    <td class="num">${row.so}</td>
    <td class="num">${row.hr}</td>
    <td class="num">${row.r}</td>
    <td class="num">${formatRunsPerNine(row.r, row.outs)}</td>
  </tr>`;
}

function aggregateTournamentStats(games) {
  const hitters = new Map();
  const pitchers = new Map();

  for (const game of games) {
    for (const side of ["away", "home"]) {
      const teamBox = game.boxScore?.[side];
      if (!teamBox) continue;
      for (const line of teamBox.hitters ?? []) {
        const row = getAggregateLine(hitters, line, teamBox.team, {
          pa: 0,
          ab: 0,
          h: 0,
          bb: 0,
          so: 0,
          hr: 0,
          rbi: 0
        });
        row.pa += line.pa;
        row.ab += line.ab;
        row.h += line.h;
        row.bb += line.bb;
        row.so += line.so;
        row.hr += line.hr;
        row.rbi += line.rbi;
      }
      for (const line of teamBox.pitchers ?? []) {
        const row = getAggregateLine(pitchers, line, teamBox.team, {
          bf: 0,
          outs: 0,
          h: 0,
          bb: 0,
          so: 0,
          hr: 0,
          r: 0
        });
        row.bf += line.bf;
        row.outs += line.outs;
        row.h += line.h;
        row.bb += line.bb;
        row.so += line.so;
        row.hr += line.hr;
        row.r += line.r;
      }
    }
  }

  return {
    hitters: [...hitters.values()],
    pitchers: [...pitchers.values()]
  };
}

function getAggregateLine(map, line, team, stats) {
  if (!map.has(line.id)) {
    map.set(line.id, {
      id: line.id,
      name: line.name,
      team: line.team ?? team,
      ...stats
    });
  }
  return map.get(line.id);
}

function compareTournamentHitters(a, b) {
  return b.hr - a.hr
    || b.rbi - a.rbi
    || b.h - a.h
    || b.pa - a.pa
    || a.name.localeCompare(b.name);
}

function compareTournamentPitchers(a, b) {
  return b.so - a.so
    || a.r - b.r
    || b.outs - a.outs
    || a.name.localeCompare(b.name);
}

function formatAverage(numerator, denominator) {
  if (!denominator) return "---";
  return (numerator / denominator).toFixed(3).replace(/^0/, "");
}

function formatRunsPerNine(runs, outs) {
  if (!outs) return "---";
  return ((runs * 27) / outs).toFixed(2);
}

function formatInnings(outs) {
  return `${Math.floor(outs / 3)}.${outs % 3}`;
}

function renderGameLog(game) {
  const rows = game.events
    .map(
      (event) => `<tr>
        <td>${event.inning}${event.half === "top" ? "T" : "B"}</td>
        <td>${renderEventMatchup(event)}</td>
        <td>${renderControlResult(event)}</td>
        <td>${renderEventResult(event)}</td>
        <td>${event.outsBefore} to ${event.outsAfter}</td>
        <td>${escapeHtml(basesText(event.basesBefore))} to ${escapeHtml(basesText(event.basesAfter))}</td>
        <td>${event.scoreAfter.away}-${event.scoreAfter.home}</td>
      </tr>`
    )
    .join("");

  return `<div class="game-log">
    <table>
      <thead><tr><th>Inn</th><th>Matchup</th><th>Control</th><th>Result</th><th>Outs</th><th>Bases</th><th>Score</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function renderEventMatchup(event) {
  if (event.playDetails?.kind === "steal") {
    const attempt = event.playDetails.stealAttempt;
    return `${escapeHtml(attempt.runner)} steal attempt`;
  }
  return `${escapeHtml(event.batter)} vs ${escapeHtml(event.pitcher)}`;
}

function renderControlResult(event) {
  if (event.playDetails?.kind === "steal") return "Before pitch";
  const effectiveControl = event.effectiveControl ?? event.controlTotal - event.controlRoll;
  const fatigue = event.fatiguePenalty ? `, fatigue -${event.fatiguePenalty}` : "";
  return `${event.controlRoll}+${effectiveControl}=${event.controlTotal} vs OB ${event.onBase}. ${event.chartOwner}${fatigue}`;
}

function renderEventResult(event) {
  if (event.playDetails?.kind === "steal") {
    const attempt = event.playDetails.stealAttempt;
    const outcome = attempt.safe ? "SB" : "CS";
    return `${outcome}; ${renderAdvanceAttempts([attempt])}`;
  }

  const base = `${event.resultRoll} => ${event.result}`;
  if (event.playDetails?.kind === "groundout" && event.playDetails.doublePlayAttempt) {
    const attempt = event.playDetails.doublePlayAttempt;
    const outcome = attempt.batterOut ? "DP" : "batter safe";
    return `${base}; ${outcome} (${attempt.roll}+${attempt.fielding}=${attempt.total} vs SPD ${attempt.target})`;
  }

  if (event.playDetails?.kind === "flyout" && event.playDetails.tagUpAttempts?.length) {
    return `${base}; tag-up: ${renderAdvanceAttempts(event.playDetails.tagUpAttempts)}`;
  }

  if (event.playDetails?.kind === "hit" && event.playDetails.extraBaseAttempts?.length) {
    return `${base}; extra base: ${renderAdvanceAttempts(event.playDetails.extraBaseAttempts)}`;
  }

  return base;
}

function renderAdvanceAttempts(attempts) {
  return attempts
    .map((attempt) => {
      const outcome = attempt.safe ? "safe" : "out";
      const runner = escapeHtml(attempt.runner);
      if (!attempt.thrown) return `${runner} ${attempt.from}-${attempt.to} ${outcome} (no throw)`;
      return `${runner} ${attempt.from}-${attempt.to} ${outcome} (${attempt.roll}+${attempt.fielding}=${attempt.total} vs SPD ${attempt.target})`;
    })
    .join("; ");
}

function renderRoster(manager, draft) {
  const counts = rosterCounts(manager.roster);
  return `<article class="roster">
    <h3>${escapeHtml(manager.name)}</h3>
    <p>${manager.roster.length}/${draft.rosterSize} drafted</p>
    <div class="target-row">
      <span class="${counts.hitters >= 9 ? "ok" : "warn"}">${counts.hitters}/9 hitters</span>
      <span class="${counts.starters >= 2 ? "ok" : "warn"}">${counts.starters}/2 starters</span>
      <span class="${counts.bullpen >= 2 ? "ok" : "warn"}">${counts.bullpen}/2 bullpen</span>
    </div>
    ${renderRosterDepthChart(manager)}
  </article>`;
}

function renderRosterDepthChart(manager) {
  const lineupSlots = assignHittersToLineupSlots(manager).slots;
  const staffSlots = assignPlayersToSlots(
    manager.roster.filter((player) => player.kind === "pitcher"),
    ["SP", "SP", "RP", "RP"],
    (player) => player.role
  ).slots;

  return `<div class="mini-roster-board">
    <div class="mini-roster-section">
      <span class="mini-roster-heading">Lineup</span>
      <div class="mini-slot-grid">${lineupSlots.map((slot) => renderMiniRosterSlot(slot.player, slot.label)).join("")}</div>
    </div>
    <div class="mini-roster-section">
      <span class="mini-roster-heading">Staff</span>
      <div class="mini-slot-grid staff-mini-slots">${staffSlots.map((slot) => renderMiniRosterSlot(slot.player, slot.label)).join("")}</div>
    </div>
  </div>`;
}

function renderMiniRosterSlot(player, slotLabel) {
  if (!player) {
    return `<div class="mini-roster-slot empty-mini-slot">
      <span class="mini-slot-label">${escapeHtml(slotLabel)}</span>
      <span class="mini-slot-name">open</span>
    </div>`;
  }
  return `<div class="mini-roster-slot filled-mini-slot">
    <span class="mini-slot-label">${escapeHtml(slotLabel)}</span>
    <strong class="mini-slot-name player-name-preview" tabindex="0" data-preview-id="${escapeHtml(player.id)}" data-preview-card="${escapeHtml(renderPlayerCard(player))}">${escapeHtml(player.name)}</strong>
    <span class="mini-slot-meta">${escapeHtml(rosterSlotDescription(player, slotLabel))} | ${player.points} pts</span>
  </div>`;
}

function renderDraftFocus(draft, manager) {
  const totalPoints = manager.roster.reduce((sum, player) => sum + player.points, 0);
  const fieldingSums = lineupFieldingSums(manager);
  const pick = draftPickInfo(draft);
  const nextNames = upcomingManagers(draft, 4).map((item) => escapeHtml(item.name)).join(" · ");
  const totalPicks = draft.managers.length * draft.rosterSize;
  return `<section class="panel draft-focus">
    <div class="draft-focus-main">
      <p class="eyebrow">${draft.complete ? "Roster view" : `Round ${pick.round}, pick ${pick.pickInRound}`}</p>
      <h1>${draft.complete ? `${escapeHtml(manager.name)} roster` : `${escapeHtml(manager.name)} is on the clock`}</h1>
      <div class="draft-metrics">
        <span>${draft.pickNumber}/${totalPicks} picks made</span>
        <span>${totalPoints} pts</span>
        <span>IF ${formatSignedNumber(fieldingSums.infield)}</span>
        <span>OF ${formatSignedNumber(fieldingSums.outfield)}</span>
      </div>
      ${draft.complete ? "" : `<p class="next-up">Next: ${nextNames}</p>`}
    </div>
    ${renderRosterSlots(manager, draft)}
  </section>`;
}

function renderRosterSlots(manager, draft) {
  const hitterSlots = assignHittersToLineupSlots(manager);
  const pitcherSlots = assignPlayersToSlots(
    manager.roster.filter((player) => player.kind === "pitcher"),
    ["SP", "SP", "RP", "RP"],
    (player) => player.role
  );
  return `<div class="roster-board" aria-label="${escapeHtml(manager.name)} drafted cards">
    <div class="slot-group">
      <span>Lineup</span>
      <div class="slot-grid lineup-slots">${hitterSlots.slots.map((slot) => renderRosterSlot(slot.player, slot.label, manager)).join("")}</div>
    </div>
    <div class="slot-group">
      <span>Staff</span>
      <div class="slot-grid staff-slots">${pitcherSlots.slots.map((slot) => renderRosterSlot(slot.player, slot.label)).join("")}</div>
    </div>
  </div>`;
}

function assignHittersToLineupSlots(manager) {
  return assignLineupSlots(manager.roster, manager.lineupAssignments);
}

function lineupFieldingSums(manager) {
  const infieldPositions = new Set(["1B", "2B", "3B", "SS"]);
  const outfieldPositions = new Set(["LF", "CF", "RF"]);
  return assignHittersToLineupSlots(manager).slots.reduce(
    (sums, slot) => {
      const fielding = Number(slot.fielding ?? 0);
      if (infieldPositions.has(slot.label)) sums.infield += fielding;
      if (outfieldPositions.has(slot.label)) sums.outfield += fielding;
      return sums;
    },
    { infield: 0, outfield: 0 }
  );
}

function renderRosterSlot(player, slotLabel, manager = null) {
  if (manager && slotLabel !== "SP" && slotLabel !== "RP") return renderLineupSlot(player, slotLabel, manager);
  if (!player) {
    return `<div class="roster-slot empty-slot"><strong>${escapeHtml(slotLabel)}</strong><span>open</span></div>`;
  }
  return `<div class="roster-slot filled-slot ${player.kind === "pitcher" ? "pitcher-slot" : "hitter-slot"}">
    <strong>${escapeHtml(slotLabel)}</strong>
    <span>${escapeHtml(player.name)}</span>
    <em>${escapeHtml(rosterSlotDescription(player, slotLabel))}</em>
  </div>`;
}

function renderLineupSlot(player, slotLabel, manager) {
  const selected = selectedLineupMove?.managerId === manager.id;
  const isSelectedPlayer = selected && player?.id === selectedLineupMove.playerId;
  const isValidTarget = selected && canMoveLineupPlayer(manager.id, selectedLineupMove.playerId, slotLabel);
  const isInvalidTarget = selected && !isValidTarget;
  const classes = [
    "roster-slot",
    player ? "filled-slot hitter-slot" : "empty-slot",
    isSelectedPlayer ? "selected-slot" : "",
    isValidTarget ? "valid-drop-slot" : "",
    isInvalidTarget ? "invalid-drop-slot" : ""
  ]
    .filter(Boolean)
    .join(" ");
  const description = player ? rosterSlotDescription(player, slotLabel) : "open";
  return `<button type="button"
    class="${classes}"
    data-lineup-slot="true"
    data-manager-id="${escapeHtml(manager.id)}"
    data-slot-label="${escapeHtml(slotLabel)}"
    ${player ? `data-player-id="${escapeHtml(player.id)}" draggable="true"` : ""}
    ${isValidTarget ? `aria-label="Move selected player to ${escapeHtml(slotLabel)}"` : ""}
  >
    <strong>${escapeHtml(slotLabel)}</strong>
    <span>${player ? escapeHtml(player.name) : "open"}</span>
    <em>${escapeHtml(description)}</em>
  </button>`;
}

function rosterSlotDescription(player, slotLabel) {
  if (player.kind === "pitcher") return playerPosition(player);
  if (slotLabel === "1B" && player.position !== "1B") return `${player.position} at 1B | Field -1`;
  if ((slotLabel === "LF" || slotLabel === "RF") && player.position !== slotLabel) return `${player.position} at ${slotLabel}`;
  return playerPosition(player);
}

function handleLineupSlotClick(slot) {
  const managerId = slot.dataset.managerId;
  const playerId = slot.dataset.playerId;
  const slotLabel = slot.dataset.slotLabel;

  if (selectedLineupMove?.managerId === managerId && canMoveLineupPlayer(managerId, selectedLineupMove.playerId, slotLabel)) {
    moveLineupPlayer(managerId, selectedLineupMove.playerId, slotLabel);
    selectedLineupMove = null;
    saveState();
    renderDraft();
    return;
  }

  const player = playerId ? findRosterPlayer(managerId, playerId) : null;
  if (player?.kind === "hitter") {
    selectedLineupMove = { managerId, playerId, fromSlot: slotLabel };
  } else {
    selectedLineupMove = null;
  }
  renderDraft();
}

function canMoveLineupPlayer(managerId, playerId, toLabel) {
  const manager = findDraftManager(managerId);
  const player = findRosterPlayer(managerId, playerId);
  if (!manager || !player || player.kind !== "hitter") return false;
  const slots = assignLineupSlots(manager.roster, manager.lineupAssignments).slots;
  const fromSlot = slots.find((slot) => slot.player?.id === playerId);
  const targetSlot = slots.find((slot) => slot.label === toLabel);
  if (!fromSlot || !targetSlot || fromSlot.label === toLabel) return false;
  if (!canPlayerFillLineupSlot(player, toLabel)) return false;
  if (targetSlot.player && !canPlayerFillLineupSlot(targetSlot.player, fromSlot.label)) return false;
  return true;
}

function moveLineupPlayer(managerId, playerId, toLabel) {
  const manager = findDraftManager(managerId);
  if (!manager || !canMoveLineupPlayer(managerId, playerId, toLabel)) return false;
  const slots = assignLineupSlots(manager.roster, manager.lineupAssignments).slots;
  const fromSlot = slots.find((slot) => slot.player?.id === playerId);
  const targetSlot = slots.find((slot) => slot.label === toLabel);
  const assignments = Object.fromEntries(slots.filter((slot) => slot.player).map((slot) => [slot.label, slot.player.id]));

  assignments[toLabel] = playerId;
  if (targetSlot.player) {
    assignments[fromSlot.label] = targetSlot.player.id;
  } else {
    delete assignments[fromSlot.label];
  }

  manager.lineupAssignments = cleanLineupAssignments(manager, assignments);
  return true;
}

function cleanLineupAssignments(manager, assignments) {
  const rosterIds = new Set(manager.roster.filter((player) => player.kind === "hitter").map((player) => player.id));
  const clean = {};
  for (const [label, playerId] of Object.entries(assignments ?? {})) {
    const player = manager.roster.find((item) => item.id === playerId);
    if (rosterIds.has(playerId) && canPlayerFillLineupSlot(player, label)) clean[label] = playerId;
  }
  return clean;
}

function findDraftManager(managerId) {
  return state.draft?.managers.find((manager) => manager.id === managerId);
}

function findRosterPlayer(managerId, playerId) {
  return findDraftManager(managerId)?.roster.find((player) => player.id === playerId);
}

function renderRosterSummary(manager) {
  const counts = rosterCounts(manager.roster);
  return `<div class="target-row summary">
    <span>${counts.hitters} hitters</span>
    <span>${counts.starters} starters</span>
    <span>${counts.bullpen} bullpen</span>
    <span>${manager.roster.reduce((sum, player) => sum + player.points, 0)} points</span>
  </div>`;
}

function renderFilters() {
  const positions = state.filters.type === "pitcher"
    ? ["all", "SP", "RP"]
    : ["all", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
  const sortOptions = [
    ["points", "Best points"],
    ["primary", "Best OB/CTRL"],
    ["power", "Best chart"],
    ["position", "Position"],
    ["name", "Name"]
  ];
  const displayedSortOptions = sortOptions.some(([value]) => value === state.filters.sort)
    ? sortOptions
    : [[state.filters.sort, columnSortLabel(state.filters.sort)], ...sortOptions];
  const typeOptions = [
    ["hitter", "Hitters"],
    ["pitcher", "Pitchers"]
  ];
  return `<div class="filters">
    <div class="type-filter" role="group" aria-label="Player type">
      ${typeOptions.map(([value, label]) => `<button type="button" class="type-pill ${state.filters.type === value ? "active" : ""}" data-filter="type" data-filter-value="${value}">${label}</button>`).join("")}
    </div>
    <label>
      Position
      <select data-filter="position">
        ${positions.map((position) => `<option value="${position}" ${state.filters.position === position ? "selected" : ""}>${position}</option>`).join("")}
      </select>
    </label>
    <label>
      Sort
      <select data-filter="sort">
        ${displayedSortOptions.map(([value, label]) => `<option value="${value}" ${state.filters.sort === value ? "selected" : ""}>${label}</option>`).join("")}
      </select>
    </label>
    <label>
      Search
      <input data-filter="search" value="${escapeHtml(state.filters.search)}" placeholder="name or position" />
    </label>
  </div>`;
}

function columnSortLabel(sort) {
  if (sort?.startsWith("chart:")) return `Column: ${sort.slice("chart:".length)}`;
  const labels = {
    fielding: "Column: Field",
    ip: "Column: IP",
    speed: "Column: Speed",
    throws: "Column: Throws"
  };
  return labels[sort] ?? "Column sort";
}

function draftPickInfo(draft) {
  const teamCount = draft.managers.length;
  return {
    round: Math.floor(draft.pickNumber / teamCount) + 1,
    pickInRound: (draft.pickNumber % teamCount) + 1
  };
}

function upcomingManagers(draft, count) {
  const managers = [];
  const teamCount = draft.managers.length;
  for (let offset = 0; offset < count; offset += 1) {
    const pickNumber = draft.pickNumber + offset;
    const round = Math.floor(pickNumber / teamCount);
    const indexInRound = pickNumber % teamCount;
    const managerIndex = round % 2 === 0 ? indexInRound : teamCount - 1 - indexInRound;
    managers.push(draft.managers[managerIndex]);
  }
  return managers;
}

function filteredPlayers(players) {
  const search = state.filters.search.trim().toLowerCase();
  return players.filter((player) => {
    if (player.kind !== state.filters.type) return false;
    if (state.filters.position !== "all" && playerPosition(player) !== state.filters.position) return false;
    if (search && !`${player.name} ${playerPosition(player)} ${player.kind}`.toLowerCase().includes(search)) return false;
    return true;
  });
}

function assignPlayersToSlots(players, labels, labelForPlayer) {
  const slots = labels.map((label) => ({ label, player: null }));
  const extras = [];
  const remaining = [...players];

  for (const slot of slots) {
    const matchIndex = remaining.findIndex((player) => labelForPlayer(player) === slot.label);
    if (matchIndex >= 0) {
      slot.player = remaining.splice(matchIndex, 1)[0];
    }
  }

  for (const slot of slots) {
    if (!slot.player && remaining.length) {
      slot.player = remaining.shift();
    }
  }

  extras.push(...remaining);
  return { slots, extras };
}

function canSimulate(draft) {
  return draft.complete && draft.managers.every((manager) => validateRoster(manager).length === 0);
}

function draftVisiblePlayers(draft, manager) {
  return filteredPlayers(availablePlayers(draft))
    .map((player) => ({ player, legality: canPickPlayer(draft, manager, player) }))
    .sort(compareDraftRows)
    .slice(0, 40)
    .map((item) => item.player);
}

function compareDraftRows(a, b) {
  const legalSort = Number(b.legality.ok) - Number(a.legality.ok);
  if (legalSort) return legalSort;
  return comparePlayers(a.player, b.player);
}

function comparePlayers(a, b) {
  const sort = state.filters.sort;
  const direction = state.filters.sortDirection === "asc" ? 1 : -1;
  const result = comparePlayersBySort(a, b, sort);
  if (result) return result * direction;
  return a.name.localeCompare(b.name);
}

function comparePlayersBySort(a, b, sort) {
  if (sort === "primary") {
    return playerPrimary(a) - playerPrimary(b) || a.points - b.points;
  }
  if (sort === "power") {
    return playerPower(a) - playerPower(b) || a.points - b.points;
  }
  if (sort === "position") {
    return playerPosition(a).localeCompare(playerPosition(b)) || a.points - b.points;
  }
  if (sort === "name") {
    return a.name.localeCompare(b.name);
  }
  if (sort === "speed") {
    return speedValue(a.speed) - speedValue(b.speed) || a.points - b.points;
  }
  if (sort === "fielding") {
    return (a.fielding ?? 0) - (b.fielding ?? 0) || a.points - b.points;
  }
  if (sort === "throws") {
    return String(a.throws ?? "").localeCompare(String(b.throws ?? "")) || a.points - b.points;
  }
  if (sort === "ip") {
    return (a.ip ?? 0) - (b.ip ?? 0) || a.points - b.points;
  }
  if (sort?.startsWith("chart:")) {
    const result = sort.slice("chart:".length);
    return chartMinimum(a, result) - chartMinimum(b, result) || a.points - b.points;
  }
  return a.points - b.points || playerPrimary(a) - playerPrimary(b);
}

function updateSort(sort) {
  if (state.filters.sort === sort) {
    state.filters.sortDirection = state.filters.sortDirection === "asc" ? "desc" : "asc";
    return;
  }
  state.filters.sort = sort;
  state.filters.sortDirection = defaultSortDirection(sort);
}

function defaultSortDirection(sort) {
  return sort === "name" || sort === "position" || sort === "throws" ? "asc" : "desc";
}

function speedValue(speed) {
  return Number(speed) || 0;
}

function formatSignedNumber(value) {
  const number = Number(value) || 0;
  return number > 0 ? `+${number}` : String(number);
}

function chartMinimum(player, result) {
  const entry = player.chart.find((item) => item.result === result);
  return entry ? entry.from : 999;
}

function rosterCounts(roster) {
  const staff = staffStatus(roster);
  return {
    hitters: roster.filter((player) => player.kind === "hitter").length,
    pitchers: staff.pitchers.length,
    starters: staff.starters.length,
    bullpen: staff.bullpen.length,
    needs: getRosterNeeds(roster)
  };
}

function allTournamentGames(tournament) {
  return [...tournament.games, tournament.final].filter(Boolean);
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState(state)));
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return reviveState(JSON.parse(raw));
  } catch {
    return null;
  }
}

function clearSavedState() {
  localStorage.removeItem(STORAGE_KEY);
}

function serializeState(value) {
  return {
    ...value,
    draft: value.draft
      ? {
          ...value.draft,
          pickedIds: [...value.draft.pickedIds]
        }
      : null
  };
}

function reviveState(value) {
  const filters = { ...defaultState().filters, ...(value.filters ?? {}) };
  if (filters.type === "all") filters.type = "hitter";
  filters.sortDirection = filters.sortDirection ?? defaultSortDirection(filters.sort);
  const draft = value.draft
    ? {
        ...value.draft,
        rosterSize: Math.max(13, Number(value.draft.rosterSize) || 13),
        pickedIds: new Set(value.draft.pickedIds ?? [])
      }
    : null;
  if (draft) {
    draft.complete = draft.managers.every((manager) => manager.roster.length >= draft.rosterSize);
  }
  return {
    ...defaultState(),
    ...value,
    rosterSize: 13,
    filters,
    draft
  };
}
