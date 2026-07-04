import { generatePlayerPool } from "./data/playerGeneration.js?v=20260705-uncapped-speed";
import { buildRealPlayerPool, maxRealPoolManagers, REAL_POOL_SEASON } from "./data/realPlayers.js?v=20260704-real-players";
import { buildMarinersPool, MARINERS_POOL_ERAS } from "./data/marinersPlayers.js?v=20260706-mariners";
import {
  applyDraftAction,
  autopick,
  assignLineupSlots,
  availablePlayers,
  buildTeam,
  canPlayerFillLineupSlot,
  canPickPlayer,
  CORNER_OUTFIELD_POSITION,
  createDraft,
  currentManager,
  draftHistory,
  getRosterNeeds,
  isCornerOutfielder,
  lineupStatus,
  normalizeCardPosition,
  pickPlayer,
  staffStatus,
  undoLastPick,
  validateRoster
} from "./rules/draft.js?v=20260705-online-rooms";
import {
  createRoom,
  fetchRoom,
  joinRoom,
  sendRoomAction,
  subscribeRoom,
  loadOnlineSeat,
  storeOnlineSeat
} from "./onlineClient.js?v=20260705-online-rooms-4";
import {
  DEFAULT_BATCH_RUNS,
  batchProgressSnapshot,
  createBatchState,
  normalizeBatchRuns,
  runBatchChunk,
  summarizeBatch
} from "./rules/batch.js?v=20260705-awards-show-batch-team-skills";
import { computeAwards } from "./rules/awards.js?v=20260705-awards-show";
import { aggregateEventSkillStats, getTeamSkillLine } from "./rules/teamSkillStats.js?v=20260705-batch-team-skills";
import { simulateRoundRobin } from "./rules/tournament.js?v=20260705-awards-show";
import {
  basesText,
  escapeHtml,
  playerPosition,
  playerPower,
  playerPrimary,
  raceColor,
  renderBoxScore,
  renderDraftHistoryTable,
  renderPlayerCard,
  renderPlayerTable,
  renderRaceChart
} from "./ui/render.js?v=20260705-caught-stealing-stats";

const STORAGE_KEY = "mlb-showdown-mvp-state-v2";
const REAL_POOL_INFO = (() => {
  const pool = buildRealPlayerPool();
  return { size: pool.length, managerLimit: maxRealPoolManagers(pool) };
})();
const MARINERS_POOL_INFO = (() => {
  const pool = buildMarinersPool();
  return { size: pool.length, managerLimit: maxRealPoolManagers(pool) };
})();
const app = document.querySelector("#app");
const cardPreview = document.createElement("div");
cardPreview.className = "hover-card-preview";
cardPreview.setAttribute("aria-hidden", "true");
document.body.append(cardPreview);

let state = loadState() ?? defaultState();
let selectedLineupMove = null;
let draggedLineupMove = null;
let batchRunToken = 0;
let hoverPreviewController = null;
let onlineStream = null;

const onlineRoomParam = new URLSearchParams(location.search).get("room");
if (onlineRoomParam) {
  bootOnlineRoom(onlineRoomParam);
} else {
  renderCurrentScreen();
}

function defaultState() {
  return {
    seed: "coefficient-classic",
    managers: ["Kasey", "Milo", "Nico", "Rafa"],
    poolMode: "random",
    realPool: "stars",
    rosterSize: 13,
    draft: null,
    draftTab: "available",
    online: null,
    tournament: null,
    batch: null,
    batchSorts: {
      teams: { sort: "titleShare", direction: "desc" },
      hitters: { sort: "ops", direction: "desc" },
      pitchers: { sort: "era", direction: "asc" }
    },
    batchStatsTab: "overview",
    view: null,
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
  if (state.online && !state.online.managerId && !state.online.spectator) {
    renderSeatSelect();
  } else if (state.view === "batch" && state.batch && state.draft) {
    renderBatch();
  } else if (state.tournament) {
    renderTournament();
  } else if (state.draft) {
    renderDraft();
  } else {
    renderSetup();
  }
}

function resetAppHandlers() {
  clearHoverCardPreviewBindings();
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
  app.ondragstart = null;
  app.ondragover = null;
  app.ondrop = null;
  app.ondragend = null;
}

async function bootOnlineRoom(roomId) {
  renderOnlineMessage(`Connecting to room ${roomId}…`);
  let room;
  try {
    room = await fetchRoom(roomId);
  } catch (error) {
    renderOnlineMessage(error.message, true);
    return;
  }
  const seat = loadOnlineSeat(roomId);
  state = defaultState();
  state.seed = room.seed;
  state.managers = room.managers.map((manager) => manager.name);
  state.rosterSize = room.rosterSize;
  state.poolMode = room.poolMode === "real" ? "real" : "random";
  state.online = {
    roomId,
    managerId: seat?.managerId ?? null,
    token: seat?.token ?? null,
    host: Boolean(seat?.host),
    hostToken: seat?.hostToken ?? null,
    spectator: Boolean(seat?.spectator),
    claimedSeats: room.managers.filter((manager) => manager.claimed).map((manager) => manager.id),
    appliedSeq: 0,
    status: ""
  };
  rebuildOnlineDraft(room);
  subscribeOnline();
  renderCurrentScreen();
}

function rebuildOnlineDraft(room) {
  const pool = room.poolMode === "real"
    ? buildRealPlayerPool()
    : generatePlayerPool(room.seed, room.managers.length, room.rosterSize);
  state.draft = createDraft(state.managers, pool, room.rosterSize, room.seed);
  for (const entry of room.actions) applyDraftAction(state.draft, entry.action);
  state.online.appliedSeq = room.actions.length ? room.actions.at(-1).seq : 0;
  state.selectedTeamName = state.managers[0];
}

function subscribeOnline() {
  onlineStream?.close();
  onlineStream = subscribeRoom(state.online.roomId, state.online.appliedSeq, {
    onAction: (entry) => {
      const online = state.online;
      if (!online || entry.seq <= online.appliedSeq) return;
      if (entry.seq > online.appliedSeq + 1) {
        resyncOnlineRoom();
        return;
      }
      try {
        applyDraftAction(state.draft, entry.action);
      } catch {
        resyncOnlineRoom();
        return;
      }
      online.appliedSeq = entry.seq;
      online.status = "";
      if (entry.action.type !== "lineup") {
        state.tournament = null;
        invalidateBatch();
      }
      selectedLineupMove = null;
      draggedLineupMove = null;
      renderCurrentScreen();
    },
    onSeats: (payload) => {
      if (!state.online) return;
      state.online.claimedSeats = payload.seats;
      renderCurrentScreen();
    },
    onError: () => {
      if (!state.online || state.online.status) return;
      state.online.status = "Reconnecting to room server…";
      renderCurrentScreen();
    }
  });
}

async function resyncOnlineRoom() {
  const online = state.online;
  if (!online) return;
  try {
    const room = await fetchRoom(online.roomId);
    online.claimedSeats = room.managers.filter((manager) => manager.claimed).map((manager) => manager.id);
    rebuildOnlineDraft(room);
    online.status = "";
    subscribeOnline();
  } catch (error) {
    online.status = error.message;
  }
  renderCurrentScreen();
}

async function sendOnlineAction(action) {
  const online = state.online;
  if (!online?.token) return;
  try {
    await sendRoomAction(online.roomId, online.token, action);
  } catch (error) {
    online.status = error.message;
    renderCurrentScreen();
  }
}

function leaveOnlineRoom() {
  onlineStream?.close();
  onlineStream = null;
  location.href = location.pathname;
}

function renderOnlineMessage(message, isError = false) {
  resetAppHandlers();
  app.innerHTML = `<section class="panel setup online-message">
    <div>
      <p class="eyebrow">Online room</p>
      <h1>${isError ? "Cannot open room" : "One moment"}</h1>
      <p class="lede">${escapeHtml(message)}</p>
      ${isError ? `<p><a href="${location.pathname}">Back to local setup</a></p>` : ""}
    </div>
  </section>`;
}

function renderSeatSelect() {
  resetAppHandlers();
  const online = state.online;
  const seats = state.draft.managers
    .map((manager) => {
      const claimed = online.claimedSeats.includes(manager.id);
      return `<button class="seat-option" data-action="claim-seat" data-manager-id="${escapeHtml(manager.id)}" ${claimed ? "disabled" : ""}>
        <strong>${escapeHtml(manager.name)}</strong>
        <span>${claimed ? "Taken" : "Open seat"}</span>
      </button>`;
    })
    .join("");
  app.innerHTML = `<section class="panel setup">
    <div>
      <p class="eyebrow">Online room ${escapeHtml(online.roomId)}</p>
      <h1>Choose your seat</h1>
      <p class="lede">Pick the manager you will draft for.${online.hostToken ? " You created this room, so your seat gets host controls." : ""}</p>
      <div class="seat-grid">${seats}</div>
      <p><button type="button" class="link-button" data-action="spectate">Watch without a seat</button></p>
      ${online.status ? `<p class="warn">${escapeHtml(online.status)}</p>` : ""}
    </div>
  </section>`;

  app.onclick = async (event) => {
    const spectate = event.target.closest("[data-action='spectate']");
    if (spectate) {
      state.online.spectator = true;
      storeOnlineSeat(state.online.roomId, { spectator: true });
      renderCurrentScreen();
      return;
    }
    const button = event.target.closest("[data-action='claim-seat']");
    if (!button || button.disabled) return;
    try {
      const result = await joinRoom(state.online.roomId, button.dataset.managerId, state.online.hostToken ?? undefined);
      state.online.managerId = result.managerId;
      state.online.token = result.token;
      state.online.host = Boolean(result.host);
      storeOnlineSeat(state.online.roomId, {
        managerId: result.managerId,
        token: result.token,
        host: state.online.host,
        spectator: false
      });
      renderCurrentScreen();
    } catch (error) {
      state.online.status = error.message;
      renderSeatSelect();
    }
  };
}

function renderOnlineBanner(draft, current) {
  const online = state.online;
  const mySeat = draft.managers.find((manager) => manager.id === online.managerId);
  const shareUrl = `${location.origin}${location.pathname}?room=${encodeURIComponent(online.roomId)}`;
  const turnNote = draft.complete
    ? "Draft complete — anyone can sim the tournament locally"
    : current
      ? online.managerId === current.id
        ? "You are on the clock"
        : `Waiting for ${current.name}`
      : "";
  return `<section class="panel online-banner">
    <span><strong>Online room ${escapeHtml(online.roomId)}</strong></span>
    <span>${mySeat ? `You are ${escapeHtml(mySeat.name)}${online.host ? " (host)" : ""}` : "Spectating"}</span>
    ${turnNote ? `<span>${escapeHtml(turnNote)}</span>` : ""}
    <span class="online-share">Invite link: <code>${escapeHtml(shareUrl)}</code></span>
    ${online.status ? `<span class="warn">${escapeHtml(online.status)}</span>` : ""}
  </section>`;
}

function onlineCanPickNow(current) {
  const online = state.online;
  if (!online) return true;
  if (!current) return false;
  return online.host || current.id === online.managerId;
}

function onlineCanUndo(draft) {
  const online = state.online;
  if (!online) return true;
  if (online.host) return true;
  const lastPick = draftHistory(draft).at(-1);
  return Boolean(lastPick && lastPick.manager.id === online.managerId);
}

function renderSetup(setupError = "") {
  resetAppHandlers();
  app.innerHTML = `<section class="panel setup">
    <div>
      <p class="eyebrow">MLB Showdown-ish MVP</p>
      <h1>Draft fictional or real cards. Sim a tournament.</h1>
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
      <fieldset class="pool-mode">
        <legend>Player pool</legend>
        <label class="pool-option">
          <input type="radio" name="poolMode" value="random" ${state.poolMode === "real" ? "" : "checked"} />
          <span><strong>Fictional randoms</strong><small>A fresh generated pool built from the seed above.</small></span>
        </label>
        <label class="pool-option">
          <input type="radio" name="poolMode" value="real" ${state.poolMode === "real" ? "checked" : ""} />
          <span><strong>Real MLB players</strong><small>Cards built from real stat lines. Pick a pool below.</small></span>
        </label>
        <div class="pool-suboptions">
          <label class="pool-option">
            <input type="radio" name="realPool" value="stars" ${state.realPool === "mariners" ? "" : "checked"} />
            <span><strong>${REAL_POOL_SEASON} stars</strong><small>${REAL_POOL_INFO.size} standouts from around today's league, from approximate ${REAL_POOL_SEASON} stats. Up to ${REAL_POOL_INFO.managerLimit} managers.</small></span>
          </label>
          <label class="pool-option">
            <input type="radio" name="realPool" value="mariners" ${state.realPool === "mariners" ? "checked" : ""} />
            <span><strong>Mariners, every era</strong><small>${MARINERS_POOL_INFO.size} M's cards from ${MARINERS_POOL_ERAS} — Junior, Edgar, the Big Unit, Ichiro, Big Dumper. Up to ${MARINERS_POOL_INFO.managerLimit} managers.</small></span>
          </label>
        </div>
      </fieldset>
      ${setupError ? `<p class="form-error">${escapeHtml(setupError)}</p>` : ""}
      <button type="submit">Start draft</button>
      <div class="online-setup">
        <button type="button" data-action="create-online">Create online room</button>
        <p class="online-note" data-online-note>Draft with friends on other machines. Needs the room server: <code>npm run online</code></p>
      </div>
    </form>
  </section>
  <section class="panel notes">
    <h2>V1 rules assumption</h2>
    <p>Control roll is d20 plus pitcher control versus hitter on-base. Higher than on-base uses the pitcher chart; ties go to the hitter. Baserunning is simplified and documented in <code>docs/rules.md</code>.</p>
  </section>`;

  const setupForm = document.querySelector("#setup-form");
  // Picking a real-pool flavor implies the real mode; keep the parent radio in sync.
  setupForm.addEventListener("change", (event) => {
    if (event.target.name === "realPool") {
      setupForm.querySelector('input[name="poolMode"][value="real"]').checked = true;
    }
  });
  setupForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const managers = dedupeManagerNames(
      String(form.get("managers"))
        .split("\n")
        .map((name) => name.trim())
        .filter(Boolean)
    );
    state.seed = String(form.get("seed")).trim() || "showdown";
    state.managers = managers.length >= 2 ? managers : ["Home", "Away"];
    state.rosterSize = 13;
    state.poolMode = form.get("poolMode") === "real" ? "real" : "random";
    state.realPool = form.get("realPool") === "mariners" ? "mariners" : "stars";
    const realPoolInfo = state.realPool === "mariners" ? MARINERS_POOL_INFO : REAL_POOL_INFO;
    if (state.poolMode === "real" && state.managers.length > realPoolInfo.managerLimit) {
      renderSetup(
        `The ${state.realPool === "mariners" ? "all-era Mariners" : "real player"} pool has position depth for up to ${realPoolInfo.managerLimit} managers. Trim the manager list or pick a different pool.`
      );
      return;
    }
    const pool = state.poolMode === "real"
      ? state.realPool === "mariners"
        ? buildMarinersPool()
        : buildRealPlayerPool()
      : generatePlayerPool(state.seed, state.managers.length, state.rosterSize);
    state.draft = createDraft(state.managers, pool, state.rosterSize, state.seed);
    state.tournament = null;
    state.batch = null;
    state.view = null;
    state.selectedGameIndex = 0;
    state.selectedTeamName = state.managers[0];
    saveState();
    renderDraft();
  });

  document.querySelector("[data-action='create-online']").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const note = document.querySelector("[data-online-note]");
    const form = new FormData(document.querySelector("#setup-form"));
    const managers = dedupeManagerNames(
      String(form.get("managers"))
        .split("\n")
        .map((name) => name.trim())
        .filter(Boolean)
    );
    const seed = String(form.get("seed")).trim() || "showdown";
    const poolMode = form.get("poolMode") === "real" ? "real" : "random";
    button.disabled = true;
    note.textContent = "Creating online room…";
    try {
      const room = await createRoom({ seed, managers: managers.length >= 2 ? managers : ["Home", "Away"], poolMode });
      storeOnlineSeat(room.roomId, { hostToken: room.hostToken });
      location.href = `${location.pathname}?room=${encodeURIComponent(room.roomId)}`;
    } catch (error) {
      button.disabled = false;
      note.textContent = error.message;
    }
  });
}

function renderDraft() {
  const draft = state.draft;
  const current = draft.complete ? null : currentManager(draft);
  const historyTab = state.draftTab === "history";
  const playerRows = historyTab
    ? []
    : draft.complete
      ? filteredPlayers(availablePlayers(draft)).sort(comparePlayers).slice(0, 40)
      : draftVisiblePlayers(draft, current);
  const rosters = draft.managers.map((manager) => renderRoster(manager, draft)).join("");
  const focusManager = current ?? (state.selectedTeamName
    ? draft.managers.find((manager) => manager.name === state.selectedTeamName) ?? draft.managers[0]
    : draft.managers[0]);

  const online = state.online;
  app.innerHTML = `${online ? renderOnlineBanner(draft, current) : ""}
  <section class="toolbar">
    <button data-action="reset">${online ? "Leave room" : "New room"}</button>
    <button data-action="autopick" ${draft.complete || !onlineCanPickNow(current) ? "disabled" : ""}>Auto-pick next</button>
    <button data-action="undo-pick" ${draft.pickNumber > 0 && onlineCanUndo(draft) ? "" : "disabled"}>Undo last pick</button>
    ${online && !online.host ? "" : `<button data-action="finish" ${draft.complete ? "disabled" : ""}>Auto-finish draft</button>`}
    <button data-action="tournament" ${canSimulate(draft) ? "" : "disabled"}>Sim tournament</button>
    <button data-action="batch" ${canSimulate(draft) ? "" : "disabled"}>Sim ${DEFAULT_BATCH_RUNS} seasons</button>
  </section>
  ${renderDraftFocus(draft, focusManager)}
  <section class="grid">
    <div class="panel">
      <div class="game-tabs">
        <button class="game-tab ${historyTab ? "" : "active"}" data-action="draft-tab" data-tab="available">Available cards</button>
        <button class="game-tab ${historyTab ? "active" : ""}" data-action="draft-tab" data-tab="history">Draft history</button>
      </div>
      ${historyTab
        ? renderDraftHistoryTable(draftHistory(draft))
        : `<div class="section-head">
        <h2>Available cards</h2>
        ${renderFilters()}
      </div>
      ${renderPlayerTable(playerRows, {
        mode: state.filters.type,
        action: "pick",
        label: "Pick",
        sort: state.filters.sort,
        sortDirection: state.filters.sortDirection,
        canPick: (player) => {
          if (!current) return { ok: false, reason: "draft complete" };
          if (!onlineCanPickNow(current)) return { ok: false, reason: `${current.name} is on the clock` };
          return canPickPlayer(draft, current, player);
        }
      })}`}
    </div>
    <div class="panel">
      <h2>Rosters</h2>
      <div class="rosters">${rosters}</div>
    </div>
  </section>`;

  bindDraftActions();
}

function bindDraftActions() {
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
      if (state.online) {
        leaveOnlineRoom();
        return;
      }
      clearSavedState();
      state = defaultState();
      renderSetup();
      return;
    }
    if (action === "draft-tab") {
      state.draftTab = button.dataset.tab === "history" ? "history" : "available";
      saveState();
      renderDraft();
      return;
    }
    if (action === "pick") {
      if (button.disabled) return;
      if (state.online) {
        sendOnlineAction({ type: "pick", playerId: button.dataset.playerId });
        return;
      }
      pickPlayer(state.draft, button.dataset.playerId);
      selectedLineupMove = null;
      invalidateBatch();
      saveState();
      renderDraft();
    }
    if (action === "autopick") {
      if (button.disabled) return;
      if (state.online) {
        sendOnlineAction({ type: "autopick" });
        return;
      }
      autopick(state.draft);
      selectedLineupMove = null;
      invalidateBatch();
      saveState();
      renderDraft();
    }
    if (action === "undo-pick") {
      if (button.disabled) return;
      if (state.online) {
        sendOnlineAction({ type: "undo" });
        return;
      }
      undoLastPick(state.draft);
      state.tournament = null;
      selectedLineupMove = null;
      draggedLineupMove = null;
      invalidateBatch();
      saveState();
      renderDraft();
    }
    if (action === "finish") {
      if (button.disabled) return;
      if (state.online) {
        sendOnlineAction({ type: "finish" });
        return;
      }
      while (!state.draft.complete) autopick(state.draft);
      selectedLineupMove = null;
      invalidateBatch();
      saveState();
      renderDraft();
    }
    if (action === "tournament") {
      const teams = state.draft.managers.map((manager) => buildTeam(manager));
      state.tournament = simulateRoundRobin(teams, state.seed);
      state.view = null;
      state.selectedGameIndex = state.tournament.final ? state.tournament.games.length : 0;
      state.selectedTeamName = state.tournament.standings[0]?.team ?? teams[0]?.name;
      saveState();
      renderTournament();
    }
    if (action === "batch") {
      startBatchRun(DEFAULT_BATCH_RUNS);
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

  bindHoverCardPreviews(() => {
    selectedLineupMove = null;
    renderDraft();
  });

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
    invalidateBatch();
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
  const standings = tournament.standings
    .map(
      (row, index) => `<tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(row.team)}</td>
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
    <button data-action="batch">Sim ${DEFAULT_BATCH_RUNS} seasons</button>
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
  resetAppHandlers();
  hideHoverCard();
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
    if (action === "batch") {
      startBatchRun(DEFAULT_BATCH_RUNS);
    }
  };
  bindHoverCardPreviews();
}

function bindHoverCardPreviews(onEscape = null) {
  let hoveredPreviewRow = null;
  clearHoverCardPreviewBindings();
  hoverPreviewController = new AbortController();
  const listenerOptions = { signal: hoverPreviewController.signal };

  hideHoverCard();

  app.onpointerover = null;
  app.onpointermove = null;
  app.onpointerout = null;
  app.onmouseover = null;
  app.onmousemove = null;
  app.onmouseout = null;
  app.onfocusin = null;
  app.onfocusout = null;
  app.onkeydown = null;

  const handlePointerOver = (event) => {
    const previewTarget = event.target.closest(".player-name-preview");
    if (!previewTarget) return;
    hoveredPreviewRow = previewTarget;
    showHoverCard(previewTarget, event.clientX, event.clientY);
  };

  const handlePointerMove = (event) => {
    if (!hoveredPreviewRow) return;
    showHoverCard(hoveredPreviewRow, event.clientX, event.clientY);
  };

  const handlePointerOut = (event) => {
    const previewTarget = event.target.closest(".player-name-preview");
    if (!previewTarget || (event.relatedTarget instanceof Node && previewTarget.contains(event.relatedTarget))) return;
    hoveredPreviewRow = null;
    hideHoverCard();
  };

  const handleFocusIn = (event) => {
    const previewTarget = event.target.closest(".player-name-preview");
    if (!previewTarget) return;
    const rect = previewTarget.getBoundingClientRect();
    showHoverCard(previewTarget, rect.right, rect.top + rect.height / 2);
  };

  const handleFocusOut = (event) => {
    if (event.relatedTarget?.closest?.(".player-name-preview")) return;
    hideHoverCard();
  };

  const handleKeyDown = (event) => {
    if (event.key !== "Escape") return;
    hideHoverCard();
    onEscape?.(event);
  };

  app.addEventListener("pointerover", handlePointerOver, listenerOptions);
  app.addEventListener("pointermove", handlePointerMove, listenerOptions);
  app.addEventListener("pointerout", handlePointerOut, listenerOptions);
  app.addEventListener("mouseover", handlePointerOver, listenerOptions);
  app.addEventListener("mousemove", handlePointerMove, listenerOptions);
  app.addEventListener("mouseout", handlePointerOut, listenerOptions);
  app.addEventListener("focusin", handleFocusIn, listenerOptions);
  app.addEventListener("focusout", handleFocusOut, listenerOptions);
  app.addEventListener("keydown", handleKeyDown, listenerOptions);
}

function clearHoverCardPreviewBindings() {
  hoverPreviewController?.abort();
  hoverPreviewController = null;
  hideHoverCard();
}

function invalidateBatch() {
  state.batch = null;
  if (state.view === "batch") state.view = null;
}

function dedupeManagerNames(names) {
  const seen = new Map();
  return names.map((name) => {
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    return count === 0 ? name : `${name} ${count + 1}`;
  });
}

function startBatchRun(runs) {
  if (!state.draft || !canSimulate(state.draft)) return;
  const count = normalizeBatchRuns(runs);
  const teams = state.draft.managers.map((manager) => buildTeam(manager));
  const teamNames = teams.map((team) => team.name);
  const batchState = createBatchState(teams);
  const seed = `${state.seed}-batch`;
  const token = ++batchRunToken;
  const seasonsPerFrame = Math.max(2, Math.round(count / 90));
  const plotStart = Math.max(4, Math.round(count * 0.02));
  const series = [];
  let completed = 0;
  let skipRequested = false;

  resetAppHandlers();
  hideHoverCard();
  app.onclick = (event) => {
    if (event.target.closest("button[data-action=batch-skip]")) skipRequested = true;
  };

  const pushFrame = () => {
    if (completed < plotStart) return null;
    const snapshot = batchProgressSnapshot(batchState);
    const shareByTeam = new Map(snapshot.rows.map((row) => [row.team, row.share]));
    series.push({ n: completed, shares: teamNames.map((name) => shareByTeam.get(name) ?? 0) });
    return snapshot;
  };

  const finalize = () => {
    if (token !== batchRunToken || !state.draft) return;
    state.batch = {
      runs: count,
      seed,
      summary: summarizeBatch(batchState),
      race: { teamNames, totalRuns: count, series: downsampleSeries(series) }
    };
    state.view = "batch";
    state.batchStatsTab = "overview";
    saveState();
    renderBatch();
  };

  const step = () => {
    if (token !== batchRunToken || !state.draft) return;
    if (skipRequested) {
      runBatchChunk(batchState, teams, seed, completed, count - completed);
      completed = count;
      pushFrame();
      finalize();
      return;
    }
    const size = Math.min(seasonsPerFrame, count - completed);
    runBatchChunk(batchState, teams, seed, completed, size);
    completed += size;
    const snapshot = pushFrame() ?? batchProgressSnapshot(batchState);
    renderBatchRace({ snapshot, series, completed, total: count, teamNames });
    if (completed >= count) {
      setTimeout(finalize, 700);
      return;
    }
    setTimeout(step, raceFrameDelay(completed / count));
  };

  renderBatchRace({ snapshot: null, series, completed: 0, total: count, teamNames });
  setTimeout(step, 250);
}

function raceFrameDelay(progress) {
  if (progress >= 0.85) return 230;
  if (progress <= 0.12) return 170;
  return 90;
}

function downsampleSeries(series, maxPoints = 160) {
  if (series.length <= maxPoints) return series;
  const step = series.length / (maxPoints - 1);
  const sampled = [];
  for (let index = 0; index < maxPoints - 1; index += 1) {
    sampled.push(series[Math.floor(index * step)]);
  }
  sampled.push(series[series.length - 1]);
  return sampled;
}

function renderBatchRace({ snapshot, series, completed, total, teamNames }) {
  const percent = total ? Math.round((completed / total) * 100) : 0;
  const tallies = (snapshot?.rows ?? teamNames.map((name) => ({ team: name, titles: 0, share: 0 })))
    .slice()
    .sort((a, b) => b.titles - a.titles);
  const leader = completed > 0 ? tallies[0] : null;
  const heading = completed >= total
    ? "Photo finish"
    : leader
      ? `${escapeHtml(leader.team)} leads the title race`
      : `Simulating ${total} seasons`;
  const chips = tallies
    .map((row) => `<span class="race-chip"><i style="background:${raceColor(teamNames.indexOf(row.team))}"></i>${escapeHtml(row.team)} <strong>${row.titles}</strong></span>`)
    .join("");

  app.innerHTML = `<section class="panel sim-progress race-screen">
    <p class="eyebrow">Season simulator</p>
    <h1>${heading}</h1>
    <p class="lede">${completed} of ${total} seasons complete. Title share so far, season by season:</p>
    <div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div>
    ${renderRaceChart({ teamNames, totalRuns: total, series })}
    <div class="race-chips">${chips}</div>
    <button data-action="batch-skip" class="small race-skip">Skip to results</button>
  </section>`;
}

function renderBatch() {
  if (!state.batch?.summary?.teams?.length) {
    state.view = null;
    renderCurrentScreen();
    return;
  }
  const { summary, runs } = state.batch;
  const top = summary.teams[0];
  const awards = computeAwards(summary, buildPickNumberMap(state.draft));
  const backLabel = state.tournament ? "Back to tournament" : "Back to draft";
  const playersById = draftedPlayersById();
  const leagueWoba = tournamentWoba(summary.hitters);
  const fipConstant = tournamentFipConstant(summary.pitchers);
  const teamGamesByName = new Map(summary.teams.map((row) => [row.team, row.games ?? teamScheduleGames(row)]));
  const sortedTeams = sortBatchRows(summary.teams, "teams", (row, sort) => batchTeamSortValue(row, sort));
  const sortedHitters = sortBatchRows(summary.hitters, "hitters", (row, sort) => batchHitterSortValue(row, sort, leagueWoba, teamGamesByName));
  const sortedPitchers = sortBatchRows(summary.pitchers, "pitchers", (row, sort) => batchPitcherSortValue(row, sort, fipConstant, teamGamesByName));
  const sortedBaserunning = [...summary.teams].sort(compareTournamentBaserunning);
  const sortedDefense = [...summary.teams].sort(compareTournamentDefense);

  const teamRows = sortedTeams
    .map(
      (row, index) => `<tr>
        <td>${index + 1}</td>
        <td><strong>${escapeHtml(row.team)}</strong></td>
        <td class="num">${formatShare(row.titleShare)}</td>
        <td class="num">${formatShare(row.finalsShare)}</td>
        <td class="num">${formatSeasonCount(per162(formatDistributionTotal(row.wins), teamScheduleGames(row)))}</td>
        <td class="num">${formatSeasonCount(per162(formatDistributionTotal(row.losses), teamScheduleGames(row)))}</td>
        <td class="num">${formatSeasonCount(per162(formatDistributionTotal(row.runsFor), teamScheduleGames(row)))}</td>
        <td class="num">${formatSeasonCount(per162(formatDistributionTotal(row.runsAgainst), teamScheduleGames(row)))}</td>
      </tr>`
    )
    .join("");

  const hitterRows = sortedHitters
    .map(
      (line, index) => `<tr>
        <td>${index + 1}</td>
        <td>${renderBatchPlayerName(line, playersById)}</td>
        <td>${escapeHtml(line.team)}</td>
        <td>${escapeHtml(line.position ?? "")}</td>
        <td class="num">${formatSeasonCount(batchPace(line, "paPer162", "pa", teamGamesByName))}</td>
        <td class="num">${formatSeasonCount(batchPace(line, "hrPer162", "hr", teamGamesByName))}</td>
        <td class="num">${formatSeasonCount(batchPace(line, "rPer162", "r", teamGamesByName))}</td>
        <td class="num">${formatSeasonCount(batchPace(line, "rbiPer162", "rbi", teamGamesByName))}</td>
        <td class="num">${formatSeasonCount(batchPace(line, "sbPer162", "sb", teamGamesByName))}</td>
        <td class="num">${formatSeasonCount(batchPace(line, "csPer162", "cs", teamGamesByName))}</td>
        <td class="num">${formatPercent(line.bb, line.pa, 1)}</td>
        <td class="num">${formatPercent(line.so, line.pa, 1)}</td>
        <td class="num">${formatAverage(totalBases(line) - line.h, line.ab)}</td>
        <td class="num">${formatAverage(line.h - line.hr, babipDenominator(line))}</td>
        <td class="num">${formatBattingStat(line.avg)}</td>
        <td class="num">${formatBattingStat(line.obp)}</td>
        <td class="num">${formatBattingStat(line.slg)}</td>
        <td class="num">${formatBattingStat(line.ops)}</td>
        <td class="num">${formatAverage(wobaNumerator(line), line.pa)}</td>
        <td class="num">${wrcPlus(line, leagueWoba)}</td>
        <td class="num">${formatWpaStat(batchPace(line, "wpaPer162", "wpa", teamGamesByName))}</td>
      </tr>`
    )
    .join("");

  const pitcherRows = sortedPitchers
    .map(
      (line, index) => `<tr>
        <td>${index + 1}</td>
        <td>${renderBatchPlayerName(line, playersById)}</td>
        <td>${escapeHtml(line.team)}</td>
        <td>${escapeHtml(line.role)}</td>
        <td class="num">${formatDecimal(batchPace(line, "ipPer162", "ip", teamGamesByName, line.outs / 3), 1)}</td>
        <td class="num">${formatPerNine(line.so, line.outs)}</td>
        <td class="num">${formatPerNine(line.bb, line.outs)}</td>
        <td class="num">${formatPerNine(line.r, line.outs)}</td>
        <td class="num">${formatFip(line, fipConstant)}</td>
        <td class="num">${formatWpaStat(batchPace(line, "wpaPer162", "wpa", teamGamesByName))}</td>
      </tr>`
    )
    .join("");

  const activeBatchTab = normalizeBatchStatsTab(state.batchStatsTab);
  const raceSection = state.batch.race ? `<section class="panel race-results-panel">
    <h2>How the race unfolded</h2>
    ${renderRaceChart(state.batch.race)}
  </section>` : "";
  const awardsSection = awards.length ? `<div class="panel awards-panel">
    <h2>The awards show</h2>
    <div class="award-grid">${awards.map((item) => renderAwardCard(item, playersById)).join("")}</div>
  </div>` : `<div class="panel awards-panel"><h2>The awards show</h2><p class="batch-note">This sim predates the awards stats. Hit Run again to hold the ceremony.</p></div>`;
  const teamTableSection = `<div class="panel">
    <p class="eyebrow">${runs} simulated seasons</p>
    <h1>${escapeHtml(top.team)} had the best draft</h1>
    <p class="batch-note">${escapeHtml(top.team)} wins the title in ${formatShare(top.titleShare)} of seasons.</p>
    <table>
      <thead><tr>
        <th>#</th>
        ${renderBatchSortHeader("teams", "team", "Team")}
        ${renderBatchSortHeader("teams", "titleShare", "Title", "num")}
        ${renderBatchSortHeader("teams", "finalsShare", "Final", "num")}
        ${renderBatchSortHeader("teams", "w162", "W/162", "num")}
        ${renderBatchSortHeader("teams", "l162", "L/162", "num")}
        ${renderBatchSortHeader("teams", "rf162", "RF/162", "num")}
        ${renderBatchSortHeader("teams", "ra162", "RA/162", "num")}
      </tr></thead>
      <tbody>${teamRows}</tbody>
    </table>
  </div>`;
  const overviewSection = `<section class="grid batch-overview-grid">
    ${teamTableSection}
    ${awardsSection}
  </section>
  ${raceSection}`;
  const hittersSection = `<section class="panel wide">
    <h2>Hitters, 162-game pace</h2>
    <div class="table-scroll">
      <table>
        <thead><tr>
          <th>#</th>
          ${renderBatchSortHeader("hitters", "name", "Player")}
          ${renderBatchSortHeader("hitters", "team", "Team")}
          ${renderBatchSortHeader("hitters", "position", "Pos")}
          ${renderBatchSortHeader("hitters", "pa162", "PA/162", "num")}
          ${renderBatchSortHeader("hitters", "hr162", "HR/162", "num")}
          ${renderBatchSortHeader("hitters", "r162", "R/162", "num")}
          ${renderBatchSortHeader("hitters", "rbi162", "RBI/162", "num")}
          ${renderBatchSortHeader("hitters", "sb162", "SB/162", "num")}
          ${renderBatchSortHeader("hitters", "cs162", "CS/162", "num")}
          ${renderBatchSortHeader("hitters", "bbRate", "BB%", "num")}
          ${renderBatchSortHeader("hitters", "kRate", "K%", "num")}
          ${renderBatchSortHeader("hitters", "iso", "ISO", "num")}
          ${renderBatchSortHeader("hitters", "babip", "BABIP", "num")}
          ${renderBatchSortHeader("hitters", "avg", "AVG", "num")}
          ${renderBatchSortHeader("hitters", "obp", "OBP", "num")}
          ${renderBatchSortHeader("hitters", "slg", "SLG", "num")}
          ${renderBatchSortHeader("hitters", "ops", "OPS", "num")}
          ${renderBatchSortHeader("hitters", "woba", "wOBA", "num")}
          ${renderBatchSortHeader("hitters", "wrcPlus", "wRC+", "num")}
          ${renderBatchSortHeader("hitters", "wpa162", "WPA/162", "num")}
        </tr></thead>
        <tbody>${hitterRows}</tbody>
      </table>
    </div>
  </section>`;
  const pitchersSection = `<section class="panel wide">
    <h2>Pitchers, 162-game pace</h2>
    <div class="table-scroll">
      <table>
        <thead><tr>
          <th>#</th>
          ${renderBatchSortHeader("pitchers", "name", "Player")}
          ${renderBatchSortHeader("pitchers", "team", "Team")}
          ${renderBatchSortHeader("pitchers", "role", "Role")}
          ${renderBatchSortHeader("pitchers", "ip162", "IP/162", "num")}
          ${renderBatchSortHeader("pitchers", "k9", "K/9", "num")}
          ${renderBatchSortHeader("pitchers", "bb9", "BB/9", "num")}
          ${renderBatchSortHeader("pitchers", "era", "ERA", "num")}
          ${renderBatchSortHeader("pitchers", "fip", "FIP", "num")}
          ${renderBatchSortHeader("pitchers", "wpa162", "WPA/162", "num")}
        </tr></thead>
        <tbody>${pitcherRows}</tbody>
      </table>
    </div>
  </section>`;
  const teamSkillsSection = `<section class="panel tournament-stats-panel">
    <div class="section-title-row">
      <div>
        <p class="eyebrow">Team skills</p>
        <h2>Baserunning and defense, 162-game pace</h2>
      </div>
      <span>${runs} seasons</span>
    </div>
    <div class="team-skill-grid">
      <div class="stat-table-block">
        <h3>Baserunning</h3>
        <div class="table-scroll">
          <table class="tournament-stat-table team-stat-table">
            <thead><tr><th>Team</th><th class="num">SB/162</th><th class="num">CS/162</th><th class="num">Adv/162</th><th class="num">Att/162</th><th class="num">Adv%</th><th class="num">Tag%</th><th class="num">OOB/162</th></tr></thead>
            <tbody>${sortedBaserunning.map(renderBatchBaserunningRow).join("")}</tbody>
          </table>
        </div>
      </div>
      <div class="stat-table-block">
        <h3>Defense</h3>
        <div class="table-scroll">
          <table class="tournament-stat-table team-stat-table">
            <thead><tr><th>Team</th><th class="num">Cut/162</th><th class="num">Home/162</th><th class="num">CS/162</th><th class="num">DP%</th><th class="num">Ch/162</th><th class="num">Stop%</th></tr></thead>
            <tbody>${sortedDefense.map(renderBatchDefenseRow).join("")}</tbody>
          </table>
        </div>
      </div>
    </div>
  </section>`;
  const batchSections = {
    overview: overviewSection,
    hitters: hittersSection,
    pitchers: pitchersSection,
    skills: teamSkillsSection
  };

  app.innerHTML = `<section class="toolbar">
    <button data-action="batch-back">${backLabel}</button>
    <label class="batch-runs-label">Seasons
      <select data-batch-runs>
        ${[100, 500, 1000, 2500, 5000].map((option) => `<option value="${option}" ${option === runs ? "selected" : ""}>${option}</option>`).join("")}
      </select>
    </label>
    <button data-action="batch-run">Run again</button>
    <button data-action="reset">New room</button>
  </section>
  ${renderBatchStatsTabs(activeBatchTab)}
  ${batchSections[activeBatchTab]}`;

  bindBatchActions();
}

function renderBatchStatsTabs(activeTab) {
  return `<div class="game-tabs batch-stat-tabs" role="tablist" aria-label="Season simulator stats">
    ${batchStatsTabs().map((tab) => `<button
      type="button"
      class="game-tab ${tab.id === activeTab ? "active" : ""}"
      data-batch-tab="${escapeHtml(tab.id)}"
      role="tab"
      aria-selected="${tab.id === activeTab ? "true" : "false"}"
    >${escapeHtml(tab.label)}</button>`).join("")}
  </div>`;
}

function batchStatsTabs() {
  return [
    { id: "overview", label: "Overview" },
    { id: "hitters", label: "Hitters" },
    { id: "pitchers", label: "Pitchers" },
    { id: "skills", label: "Team skills" }
  ];
}

function normalizeBatchStatsTab(value) {
  return batchStatsTabs().some((tab) => tab.id === value) ? value : "overview";
}

function renderAwardCard(item, playersById = new Map()) {
  if (!item) return "";
  return `<div class="award-card">
    <span class="award-label">${escapeHtml(item.label)}</span>
    ${renderBatchPlayerName({ id: item.id, name: item.name, team: item.team }, playersById, "strong", "award-player-name")}
    <span class="award-stat">${escapeHtml(item.stat)}</span>
    <em>${escapeHtml(item.team ?? "")}</em>
    ${item.note ? `<span class="award-note">${escapeHtml(item.note)}</span>` : ""}
  </div>`;
}

function renderBatchPlayerName(line, playersById, tagName = "strong", className = "batch-player-name") {
  const player = playerForBoxLine(playersById, line, line.team);
  return renderPlayerPreviewName(player, line.name, tagName, className);
}

function renderBatchSortHeader(table, sort, label, className = "") {
  const config = batchSortConfig(table);
  const active = config.sort === sort;
  const direction = active ? config.direction : null;
  const arrow = direction === "asc" ? "^" : direction === "desc" ? "v" : "";
  return `<th class="${escapeHtml(className)}" aria-sort="${active ? (direction === "asc" ? "ascending" : "descending") : "none"}">
    <button type="button" class="column-sort ${active ? "active" : ""}" data-batch-table="${escapeHtml(table)}" data-batch-sort="${escapeHtml(sort)}">
      <span>${escapeHtml(label)}</span>${arrow ? `<span class="sort-arrow">${arrow}</span>` : ""}
    </button>
  </th>`;
}

function sortBatchRows(rows, table, valueForSort) {
  const { sort, direction } = batchSortConfig(table);
  const multiplier = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const value = compareSortValues(valueForSort(a, sort), valueForSort(b, sort));
    if (value) return value * multiplier;
    return String(a.name ?? a.team ?? "").localeCompare(String(b.name ?? b.team ?? ""));
  });
}

function compareSortValues(a, b) {
  if (typeof a === "string" || typeof b === "string") return String(a ?? "").localeCompare(String(b ?? ""));
  return (Number(a) || 0) - (Number(b) || 0);
}

function batchTeamSortValue(row, sort) {
  if (sort === "team") return row.team;
  if (sort === "titleShare") return row.titleShare;
  if (sort === "finalsShare") return row.finalsShare;
  if (sort === "w162") return per162(formatDistributionTotal(row.wins), teamScheduleGames(row));
  if (sort === "l162") return per162(formatDistributionTotal(row.losses), teamScheduleGames(row));
  if (sort === "rf162") return per162(formatDistributionTotal(row.runsFor), teamScheduleGames(row));
  if (sort === "ra162") return per162(formatDistributionTotal(row.runsAgainst), teamScheduleGames(row));
  return row.titleShare;
}

function batchHitterSortValue(line, sort, leagueWoba, teamGamesByName) {
  if (sort === "name") return line.name;
  if (sort === "team") return line.team;
  if (sort === "position") return line.position ?? "";
  if (sort === "pa162") return batchPace(line, "paPer162", "pa", teamGamesByName);
  if (sort === "hr162") return batchPace(line, "hrPer162", "hr", teamGamesByName);
  if (sort === "r162") return batchPace(line, "rPer162", "r", teamGamesByName);
  if (sort === "rbi162") return batchPace(line, "rbiPer162", "rbi", teamGamesByName);
  if (sort === "sb162") return batchPace(line, "sbPer162", "sb", teamGamesByName);
  if (sort === "cs162") return batchPace(line, "csPer162", "cs", teamGamesByName);
  if (sort === "bbRate") return rateValue(line.bb, line.pa);
  if (sort === "kRate") return rateValue(line.so, line.pa);
  if (sort === "iso") return rateValue(totalBases(line) - line.h, line.ab);
  if (sort === "babip") return rateValue(line.h - line.hr, babipDenominator(line));
  if (sort === "avg") return line.avg;
  if (sort === "obp") return line.obp;
  if (sort === "slg") return line.slg;
  if (sort === "ops") return line.ops;
  if (sort === "woba") return woba(line);
  if (sort === "wrcPlus") return wrcPlus(line, leagueWoba);
  if (sort === "wpa162") return batchPace(line, "wpaPer162", "wpa", teamGamesByName);
  return line.ops;
}

function batchPitcherSortValue(line, sort, fipConstant, teamGamesByName) {
  if (sort === "name") return line.name;
  if (sort === "team") return line.team;
  if (sort === "role") return line.role;
  if (sort === "ip162") return batchPace(line, "ipPer162", "ip", teamGamesByName, line.outs / 3);
  if (sort === "k9") return rateValue(line.so * 27, line.outs);
  if (sort === "bb9") return rateValue(line.bb * 27, line.outs);
  if (sort === "era") return rateValue(line.r * 27, line.outs);
  if (sort === "fip") return line.outs ? rawFip(line) + fipConstant : Number.POSITIVE_INFINITY;
  if (sort === "wpa162") return batchPace(line, "wpaPer162", "wpa", teamGamesByName);
  return rateValue(line.r * 27, line.outs);
}

function rateValue(numerator, denominator) {
  return denominator ? numerator / denominator : 0;
}

function batchSortConfig(table) {
  return state.batchSorts?.[table] ?? defaultBatchSorts()[table] ?? { sort: "name", direction: "asc" };
}

function updateBatchSort(table, sort) {
  if (!table || !sort) return;
  state.batchSorts = { ...defaultBatchSorts(), ...(state.batchSorts ?? {}) };
  const current = state.batchSorts[table] ?? defaultBatchSorts()[table] ?? { sort: "name", direction: "asc" };
  state.batchSorts[table] = current.sort === sort
    ? { sort, direction: current.direction === "asc" ? "desc" : "asc" }
    : { sort, direction: defaultBatchSortDirection(table, sort) };
}

function defaultBatchSorts() {
  return {
    teams: { sort: "titleShare", direction: "desc" },
    hitters: { sort: "ops", direction: "desc" },
    pitchers: { sort: "era", direction: "asc" }
  };
}

function defaultBatchSortDirection(table, sort) {
  if (["name", "team", "position", "role"].includes(sort)) return "asc";
  if (table === "pitchers" && ["era", "fip", "bb9"].includes(sort)) return "asc";
  return "desc";
}

function buildPickNumberMap(draft) {
  if (!draft?.managers?.length || !draft.rosterSize) return {};
  const map = {};
  const rosterIndexes = new Map();
  const teamCount = draft.managers.length;
  const totalPicks = teamCount * draft.rosterSize;
  for (let pick = 0; pick < totalPicks; pick += 1) {
    const round = Math.floor(pick / teamCount);
    const indexInRound = pick % teamCount;
    const managerIndex = round % 2 === 0 ? indexInRound : teamCount - 1 - indexInRound;
    const manager = draft.managers[managerIndex];
    const rosterIndex = rosterIndexes.get(manager.id) ?? 0;
    rosterIndexes.set(manager.id, rosterIndex + 1);
    const player = manager.roster[rosterIndex];
    if (player) map[player.id] = pick + 1;
  }
  return map;
}

function bindBatchActions() {
  resetAppHandlers();
  hideHoverCard();
  app.onclick = (event) => {
    const tabButton = event.target.closest("button[data-batch-tab]");
    if (tabButton) {
      state.batchStatsTab = normalizeBatchStatsTab(tabButton.dataset.batchTab);
      saveState();
      renderBatch();
      return;
    }

    const sortButton = event.target.closest("button[data-batch-sort]");
    if (sortButton) {
      updateBatchSort(sortButton.dataset.batchTable, sortButton.dataset.batchSort);
      saveState();
      renderBatch();
      return;
    }

    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "batch-back") {
      state.view = null;
      saveState();
      renderCurrentScreen();
    }
    if (action === "batch-run") {
      const select = app.querySelector("[data-batch-runs]");
      startBatchRun(select?.value ?? DEFAULT_BATCH_RUNS);
    }
    if (action === "reset") {
      clearSavedState();
      state = defaultState();
      renderSetup();
    }
  };
  bindHoverCardPreviews();
}

function formatShare(value) {
  return `${((Number(value) || 0) * 100).toFixed(1)}%`;
}

function formatDistributionTotal(value) {
  const total = value?.sum ?? (value?.mean ?? 0) * (value?.count ?? 0);
  return Math.round(total);
}

function teamScheduleGames(row) {
  return formatDistributionTotal(row.wins) + formatDistributionTotal(row.losses);
}

function batchPace(line, paceKey, totalKey, teamGamesByName, totalOverride = null) {
  if (!line) return 0;
  const existing = Number(line[paceKey]);
  if (Number.isFinite(existing)) return existing;
  const total = totalOverride ?? Number(line[totalKey] ?? 0);
  const games = Number(line.teamGames ?? teamGamesByName.get(line.team) ?? 0);
  return per162(total, games);
}

function per162(total, games) {
  return games ? (Number(total) * 162) / games : 0;
}

function formatSeasonCount(value) {
  return String(Math.round(Number(value) || 0));
}

function formatDecimal(value, digits = 1) {
  return (Number(value) || 0).toFixed(digits);
}

function formatBattingStat(value) {
  const number = Number(value) || 0;
  const fixed = number.toFixed(3);
  return number < 1 ? fixed.replace(/^0/, "") : fixed;
}

function formatWpaStat(value) {
  const number = Number(value) || 0;
  return `${number >= 0 ? "+" : ""}${number.toFixed(3)}`;
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
    ${renderBoxScore(game, draftedPlayersById())}
    <h4>Play-by-play</h4>
    ${renderGameLog(game)}
  </div>`;
}

function renderTournamentStats(games) {
  const playersById = draftedPlayersById();
  const stats = aggregateTournamentStats(games, playersById);
  const leagueWoba = tournamentWoba(stats.hitters);
  const fipConstant = tournamentFipConstant(stats.pitchers);
  const hitters = stats.hitters.sort((a, b) => compareTournamentHitters(a, b, leagueWoba));
  const pitchers = stats.pitchers.sort(compareTournamentPitchers);
  const baserunning = stats.teams.sort(compareTournamentBaserunning);
  const defense = [...stats.teams].sort(compareTournamentDefense);

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
      ${renderLeaderCard("Run leaders", hitters, (row) => row.r, (row) => `${row.hr} HR`)}
      ${renderLeaderCard("wRC+ leaders", hitters, (row) => wrcPlus(row, leagueWoba), (row) => `${formatAverage(totalBases(row), row.ab)} SLG`)}
      ${renderLeaderCard("Strikeout leaders", pitchers, (row) => row.so, (row) => `${formatInnings(row.outs)} IP`)}
    </div>
    <div class="stat-table-grid">
      <div class="stat-table-block">
        <h3>Hitters</h3>
        <div class="table-scroll">
          <table class="tournament-stat-table">
            <thead><tr><th>Player</th><th>Team</th><th class="num">PA</th><th class="num">HR</th><th class="num">R</th><th class="num">RBI</th><th class="num">SB</th><th class="num">CS</th><th class="num">BB%</th><th class="num">K%</th><th class="num">ISO</th><th class="num">BABIP</th><th class="num">AVG</th><th class="num">OBP</th><th class="num">SLG</th><th class="num">wOBA</th><th class="num">wRC+</th></tr></thead>
            <tbody>${hitters.map((row) => renderTournamentHitterRow(row, leagueWoba)).join("")}</tbody>
          </table>
        </div>
      </div>
      <div class="stat-table-block">
        <h3>Pitchers</h3>
        <div class="table-scroll">
          <table class="tournament-stat-table">
            <thead><tr><th>Player</th><th>Team</th><th class="num">IP</th><th class="num">K/9</th><th class="num">BB/9</th><th class="num">ERA</th><th class="num">FIP</th></tr></thead>
            <tbody>${pitchers.map((row) => renderTournamentPitcherRow(row, fipConstant)).join("")}</tbody>
          </table>
        </div>
      </div>
    </div>
    <div class="team-skill-grid">
      <div class="stat-table-block">
        <h3>Baserunning</h3>
        <div class="table-scroll">
          <table class="tournament-stat-table team-stat-table">
            <thead><tr><th>Team</th><th class="num">SB</th><th class="num">CS</th><th class="num">Adv</th><th class="num">Att</th><th class="num">Adv%</th><th class="num">Tag</th><th class="num">OOB</th></tr></thead>
            <tbody>${baserunning.map(renderTournamentBaserunningRow).join("")}</tbody>
          </table>
        </div>
      </div>
      <div class="stat-table-block">
        <h3>Defense</h3>
        <div class="table-scroll">
          <table class="tournament-stat-table team-stat-table">
            <thead><tr><th>Team</th><th class="num">Cut</th><th class="num">Home</th><th class="num">CS</th><th class="num">DP</th><th class="num">Ch</th><th class="num">Stop%</th></tr></thead>
            <tbody>${defense.map(renderTournamentDefenseRow).join("")}</tbody>
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
            ${renderTournamentPlayerName(row, "strong")}
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

function renderTournamentHitterRow(row, leagueWoba) {
  return `<tr>
    <td>${renderTournamentPlayerName(row)}</td>
    <td>${escapeHtml(row.team)}</td>
    <td class="num">${row.pa}</td>
    <td class="num">${row.hr}</td>
    <td class="num">${row.r}</td>
    <td class="num">${row.rbi}</td>
    <td class="num">${row.sb}</td>
    <td class="num">${row.cs}</td>
    <td class="num">${formatPercent(row.bb, row.pa, 1)}</td>
    <td class="num">${formatPercent(row.so, row.pa, 1)}</td>
    <td class="num">${formatAverage(totalBases(row) - row.h, row.ab)}</td>
    <td class="num">${formatAverage(row.h - row.hr, babipDenominator(row))}</td>
    <td class="num">${formatAverage(row.h, row.ab)}</td>
    <td class="num">${formatAverage(row.h + row.bb, row.ab + row.bb)}</td>
    <td class="num">${formatAverage(totalBases(row), row.ab)}</td>
    <td class="num">${formatAverage(wobaNumerator(row), row.pa)}</td>
    <td class="num">${wrcPlus(row, leagueWoba)}</td>
  </tr>`;
}

function renderTournamentPitcherRow(row, fipConstant) {
  return `<tr>
    <td>${renderTournamentPlayerName(row)}</td>
    <td>${escapeHtml(row.team)}</td>
    <td class="num">${formatInnings(row.outs)}</td>
    <td class="num">${formatPerNine(row.so, row.outs)}</td>
    <td class="num">${formatPerNine(row.bb, row.outs)}</td>
    <td class="num">${formatPerNine(row.r, row.outs)}</td>
    <td class="num">${formatFip(row, fipConstant)}</td>
  </tr>`;
}

function renderBatchBaserunningRow(row) {
  const games = teamSkillGames(row);
  return `<tr>
    <td>${escapeHtml(row.team)}</td>
    <td class="num">${formatSeasonCount(per162(row.steals, games))}</td>
    <td class="num">${formatSeasonCount(per162(row.caughtStealing, games))}</td>
    <td class="num">${formatSeasonCount(per162(row.advances, games))}</td>
    <td class="num">${formatSeasonCount(per162(row.advanceAttempts, games))}</td>
    <td class="num">${formatPercent(row.advances, row.advanceAttempts)}</td>
    <td class="num">${formatPercent(row.tagAdvances, row.tagAttempts)}</td>
    <td class="num">${formatSeasonCount(per162(row.outsOnBases, games))}</td>
  </tr>`;
}

function renderBatchDefenseRow(row) {
  const games = teamSkillGames(row);
  return `<tr>
    <td>${escapeHtml(row.team)}</td>
    <td class="num">${formatSeasonCount(per162(row.cutDowns, games))}</td>
    <td class="num">${formatSeasonCount(per162(row.homeCutDowns, games))}</td>
    <td class="num">${formatSeasonCount(per162(row.caughtStealingByDefense, games))}</td>
    <td class="num">${formatPercent(row.doublePlays, row.doublePlayChances)}</td>
    <td class="num">${formatSeasonCount(per162(row.advanceChances, games))}</td>
    <td class="num">${formatPercent(row.cutDowns, row.advanceChances)}</td>
  </tr>`;
}

function teamSkillGames(row) {
  return row.games ?? teamScheduleGames(row);
}

function renderTournamentBaserunningRow(row) {
  return `<tr>
    <td>${escapeHtml(row.team)}</td>
    <td class="num">${row.steals}</td>
    <td class="num">${row.caughtStealing}</td>
    <td class="num">${row.advances}</td>
    <td class="num">${row.advanceAttempts}</td>
    <td class="num">${formatPercent(row.advances, row.advanceAttempts)}</td>
    <td class="num">${row.tagAdvances}/${row.tagAttempts}</td>
    <td class="num">${row.outsOnBases}</td>
  </tr>`;
}

function renderTournamentDefenseRow(row) {
  return `<tr>
    <td>${escapeHtml(row.team)}</td>
    <td class="num">${row.cutDowns}</td>
    <td class="num">${row.homeCutDowns}</td>
    <td class="num">${row.caughtStealingByDefense}</td>
    <td class="num">${row.doublePlays}/${row.doublePlayChances}</td>
    <td class="num">${row.advanceChances}</td>
    <td class="num">${formatPercent(row.cutDowns, row.advanceChances)}</td>
  </tr>`;
}

function renderTournamentPlayerName(row, tagName = "span") {
  return renderPlayerPreviewName(row.player, row.name, tagName, "stat-player-name");
}

function renderPlayerPreviewName(player, name, tagName = "span", className = "") {
  if (!player) return `<${tagName}>${escapeHtml(name)}</${tagName}>`;
  const classes = ["player-name-preview", className].filter(Boolean).join(" ");
  return `<${tagName}
    class="${escapeHtml(classes)}"
    tabindex="0"
    data-preview-id="${escapeHtml(player.id)}"
    data-preview-card="${escapeHtml(renderPlayerCard(player))}"
  >${escapeHtml(name)}</${tagName}>`;
}

function aggregateTournamentStats(games, playersById = new Map()) {
  const hitters = new Map();
  const pitchers = new Map();
  const teams = new Map();

  for (const game of games) {
    for (const side of ["away", "home"]) {
      const teamBox = game.boxScore?.[side];
      if (!teamBox) continue;
      getTeamSkillLine(teams, teamBox.team);
      for (const line of teamBox.hitters ?? []) {
        const row = getAggregateLine(hitters, line, teamBox.team, {
          pa: 0,
          ab: 0,
          h: 0,
          d: 0,
          t: 0,
          r: 0,
          bb: 0,
          so: 0,
          hr: 0,
          sb: 0,
          cs: 0,
          rbi: 0
        }, playersById);
        row.pa += line.pa;
        row.ab += line.ab;
        row.h += line.h;
        row.d += line.d ?? 0;
        row.t += line.t ?? 0;
        row.r += line.r ?? 0;
        row.bb += line.bb;
        row.so += line.so;
        row.hr += line.hr;
        row.sb += line.sb ?? 0;
        row.cs += line.cs ?? 0;
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
        }, playersById);
        row.bf += line.bf;
        row.outs += line.outs;
        row.h += line.h;
        row.bb += line.bb;
        row.so += line.so;
        row.hr += line.hr;
        row.r += line.r;
      }
    }

    for (const event of game.events ?? []) {
      aggregateEventSkillStats(teams, event);
    }
  }

  return {
    hitters: [...hitters.values()],
    pitchers: [...pitchers.values()],
    teams: [...teams.values()]
  };
}

function getAggregateLine(map, line, team, stats, playersById = new Map()) {
  const id = line.id ?? playerLookupKey(team, line.name);
  if (!map.has(id)) {
    map.set(id, {
      id,
      name: line.name,
      team: line.team ?? team,
      player: playerForBoxLine(playersById, line, team),
      ...stats
    });
  }
  return map.get(id);
}

function draftedPlayersById() {
  const players = new Map();
  for (const manager of state.draft?.managers ?? []) {
    for (const player of manager.roster) {
      players.set(player.id, player);
      players.set(playerLookupKey(manager.name, player.name), player);
      if (!players.has(player.name)) players.set(player.name, player);
    }
  }
  return players;
}

function playerForBoxLine(playersById, line, team) {
  return playersById.get(line.id)
    ?? playersById.get(playerLookupKey(line.team ?? team, line.name))
    ?? playersById.get(line.name)
    ?? null;
}

function playerLookupKey(team, name) {
  return `${team ?? ""}::${name ?? ""}`;
}

function compareTournamentHitters(a, b, leagueWoba) {
  return wrcPlus(b, leagueWoba) - wrcPlus(a, leagueWoba)
    || b.hr - a.hr
    || b.rbi - a.rbi
    || b.r - a.r
    || b.pa - a.pa
    || a.name.localeCompare(b.name);
}

function compareTournamentPitchers(a, b) {
  return runsPerNine(a.r, a.outs) - runsPerNine(b.r, b.outs)
    || b.outs - a.outs
    || b.so - a.so
    || a.name.localeCompare(b.name);
}

function compareTournamentBaserunning(a, b) {
  return b.advances - a.advances
    || b.steals - a.steals
    || a.outsOnBases - b.outsOnBases
    || a.team.localeCompare(b.team);
}

function compareTournamentDefense(a, b) {
  return b.cutDowns - a.cutDowns
    || b.doublePlays - a.doublePlays
    || b.caughtStealingByDefense - a.caughtStealingByDefense
    || a.team.localeCompare(b.team);
}

function formatAverage(numerator, denominator) {
  if (!denominator) return "---";
  return (numerator / denominator).toFixed(3).replace(/^0/, "");
}

function formatPercent(numerator, denominator, digits = 0) {
  if (!denominator) return "---";
  return `${((numerator / denominator) * 100).toFixed(digits)}%`;
}

function formatPerNine(total, outs) {
  if (!outs) return "---";
  return ((total * 27) / outs).toFixed(2);
}

function formatRunsPerNine(runs, outs) {
  return formatPerNine(runs, outs);
}

function formatFip(row, constant) {
  if (!row.outs) return "---";
  return (rawFip(row) + constant).toFixed(2);
}

function totalBases(row) {
  return singles(row) + (row.d ?? 0) * 2 + (row.t ?? 0) * 3 + (row.hr ?? 0) * 4;
}

function singles(row) {
  return Math.max(0, (row.h ?? 0) - (row.d ?? 0) - (row.t ?? 0) - (row.hr ?? 0));
}

function babipDenominator(row) {
  return row.ab - row.so - row.hr;
}

function wobaNumerator(row) {
  return (row.bb ?? 0) * 0.69
    + singles(row) * 0.89
    + (row.d ?? 0) * 1.27
    + (row.t ?? 0) * 1.62
    + (row.hr ?? 0) * 2.1;
}

function woba(row) {
  return row.pa ? wobaNumerator(row) / row.pa : 0;
}

function tournamentWoba(rows) {
  const numerator = rows.reduce((sum, row) => sum + wobaNumerator(row), 0);
  const denominator = rows.reduce((sum, row) => sum + row.pa, 0);
  return denominator ? numerator / denominator : 0;
}

function wrcPlus(row, leagueWoba) {
  if (!leagueWoba || !row.pa) return 0;
  return Math.round((woba(row) / leagueWoba) * 100);
}

function inningsPitched(row) {
  return row.outs / 3;
}

function runsPerNine(runs, outs) {
  return outs ? (runs * 27) / outs : Number.POSITIVE_INFINITY;
}

function rawFip(row) {
  const innings = inningsPitched(row);
  if (!innings) return 0;
  return (13 * row.hr + 3 * row.bb - 2 * row.so) / innings;
}

function tournamentFipConstant(rows) {
  const outs = rows.reduce((sum, row) => sum + row.outs, 0);
  if (!outs) return 0;
  const runs = rows.reduce((sum, row) => sum + row.r, 0);
  const raw = rows.reduce((sum, row) => sum + rawFip(row) * inningsPitched(row), 0) / (outs / 3);
  return runsPerNine(runs, outs) - raw;
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
  return playerPosition(player);
}

function handleLineupSlotClick(slot) {
  const managerId = slot.dataset.managerId;
  const playerId = slot.dataset.playerId;
  const slotLabel = slot.dataset.slotLabel;

  if (selectedLineupMove?.managerId === managerId && canMoveLineupPlayer(managerId, selectedLineupMove.playerId, slotLabel)) {
    moveLineupPlayer(managerId, selectedLineupMove.playerId, slotLabel);
    selectedLineupMove = null;
    invalidateBatch();
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
  if (state.online && !state.online.host && managerId !== state.online.managerId) return false;
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

  const cleaned = cleanLineupAssignments(manager, assignments);
  if (state.online) {
    sendOnlineAction({ type: "lineup", managerId, assignments: cleaned });
    return true;
  }
  manager.lineupAssignments = cleaned;
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

function renderFilters() {
  const positions = state.filters.type === "pitcher"
    ? ["all", "SP", "RP"]
    : ["all", "C", "1B", "2B", "3B", "SS", "LF/RF", "CF", ...(state.poolMode === "real" ? ["DH"] : [])];
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
    if (state.filters.position !== "all" && !matchesPositionFilter(player, state.filters.position)) return false;
    if (search && !`${player.name} ${player.team ?? ""} ${playerPosition(player)} ${player.kind}`.toLowerCase().includes(search)) return false;
    return true;
  });
}

function matchesPositionFilter(player, filterPosition) {
  if (filterPosition === CORNER_OUTFIELD_POSITION) return isCornerOutfielder(playerPosition(player));
  return playerPosition(player) === filterPosition;
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
  if (state.online) return;
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
  const batchSorts = { ...defaultBatchSorts(), ...(value.batchSorts ?? {}) };
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
    draft.seed = draft.seed ?? value.seed ?? "showdown";
    draft.complete = draft.managers.every((manager) => manager.roster.length >= draft.rosterSize);
    // Rooms saved before corners were lumped still carry bare LF/RF labels.
    draft.pool = draft.pool.map(normalizeCardPosition);
    for (const manager of draft.managers) {
      manager.roster = manager.roster.map(normalizeCardPosition);
    }
  }
  return {
    ...defaultState(),
    ...value,
    rosterSize: 13,
    poolMode: value.poolMode === "real" ? "real" : "random",
    realPool: value.realPool === "mariners" ? "mariners" : "stars",
    filters,
    batchSorts,
    batchStatsTab: normalizeBatchStatsTab(value.batchStatsTab),
    draft,
    view: value.view === "batch" && value.batch ? "batch" : null
  };
}
