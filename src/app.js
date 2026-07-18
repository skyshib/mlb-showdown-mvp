import {
  DECADES,
  EARLIEST_DECADE,
  FRANCHISES,
  UNIVERSES,
  buildDraftPool,
  deckFromIds,
  decadeLabel,
  setUniverse,
  universeConfig
} from "./data/universes.js";
import { applyFranchisePalette } from "./ui/franchisePalette.js";
import { CLASSIC_CARD_ROWS } from "./data/classicCards.js";
import { MLB_HISTORY_ROWS } from "./data/mlbPools.js";
import { buildFictionalDraftPool } from "./data/playerGeneration.js";
import { decodeCardRows } from "./data/realCards.js";
import { cardPanelHtml } from "./ui/cardFace.js?v=20260716-records";
import { nominatedPlayerFilter } from "./ui/auctionPresentation.js?v=20260716-auction-cues";
import {
  isMuted,
  playClockWarning,
  playDraftComplete,
  playLotteryBall,
  playNomination,
  playPick,
  playSniped,
  playTie,
  playYourTurn,
  toggleMuted,
  unlockSounds
} from "./ui/sounds.js?v=20260716-auction-cues";
import { hydratePhotos } from "./ui/photos.js?v=20260716-records";
import { createBattle } from "./rules/battle/controller.js?v=20260716-records";
import { createGame, renderGame } from "./ui/gameScreen.js?v=20260716-records";
import {
  AUCTION_DEFAULT_BUDGET,
  defaultAuctionBudget,
  AUCTION_DEFAULT_CLOCK_BANK_SECONDS,
  AUCTION_DEFAULT_CLOCK_INCREMENT_SECONDS,
  AUCTION_DEFAULT_REVIEW_SECONDS,
  SNAKE_DEFAULT_CLOCK_BANK_SECONDS,
  SNAKE_DEFAULT_CLOCK_INCREMENT_SECONDS,
  AUCTION_MIN_BID,
  AUCTION_MIN_RAISE,
  CORNER_OUTFIELD_POSITION,
  DEFAULT_STARTING_PITCHERS,
  MAX_STARTING_PITCHERS,
  MIN_STARTING_PITCHERS,
  ROSTER_BENCH_KEY,
  SIM_ACTION_TYPES,
  applyBattingOrder,
  applyDraftAction,
  assignLineupSlots,
  assignStaffSlots,
  auctionBidTimeRemainingMs,
  auctionBudget,
  auctionLotPlayer,
  auctionMaxBid,
  auctionReviewComplete,
  auctionReviewRemainingMs,
  auctionStepGuard,
  auctionTimerEnabled,
  autopick,
  availablePlayers,
  benchPlayers,
  buildTeam,
  canCancelLot,
  canNominatePlayer,
  canPickPlayer,
  canPlaceSealedBid,
  canPlayerFillLineupSlot,
  cancelLot,
  completeAuctionReview,
  cpuSealedBid,
  createDraft,
  currentManager,
  currentManagerMustReplace,
  draftHistory,
  guaranteedNominationMinimums,
  getRosterNeeds,
  hasUnlimitedRoster,
  isAuctionDraft,
  isAuctionPaused,
  isDraftPaused,
  isCornerOutfielder,
  isRandomNomination,
  lineupStatus,
  managerValuation,
  maxPoolManagers,
  nominateBestTarget,
  nominatePlayer,
  nominationQueueRemaining,
  normalizeAuctionBudget,
  normalizeAuctionTimerConfig,
  normalizeCardPosition,
  normalizePickTimerSeconds,
  normalizeStartingPitchers,
  normalizeSnakeTimerConfig,
  pauseAuction,
  pauseSnake,
  pickPlayer,
  placeSealedBid,
  randomNominationCounts,
  randomNominationShortfalls,
  rosterSizeForStartingPitchers,
  resumeAuction,
  resumeSnake,
  sealedBidder,
  setManagerCpu,
  snakeClockBankMs,
  snakeClockEnabled,
  snakeClockFlagged,
  snakeTimeRemainingMs,
  staffStatus,
  staffSlotLabels,
  startAuctionReview,
  startSnakeClock,
  syncAuctionTimer,
  undoLastPick,
  upcomingNominators,
  validateRoster
} from "./rules/draft.js?v=20260716-records";
import {
  createRoom,
  fetchRoom,
  joinRoom,
  sendRoomAction,
  subscribeRoom,
  loadOnlineSeat,
  storeOnlineSeat
} from "./onlineClient.js?v=20260716-records";
import {
  DEFAULT_BATCH_RUNS,
  batchProgressSnapshot,
  createBatchState,
  createWinExpectancyCalibration,
  finalizeWinExpectancyCalibration,
  normalizeBatchRuns,
  replayBatchGames,
  runBatchChunk,
  summarizeBatch
} from "./rules/batch.js?v=20260717-draft-wpa";
import { computeAwards } from "./rules/awards.js?v=20260716-records";
import { MAX_ROLL, chartSpan, hitterPositions, playsPosition, positionsLabel } from "./rules/cards.js?v=20260716-records";
import { CPU_PERSONALITIES, cpuPersonality } from "./rules/valuation.js?v=20260716-records";
import { VALUATION_BASE_WEIGHTS, VALUATION_PERTURBATION } from "./rules/valuation.js?v=20260716-records";
import { aggregateEventSkillStats, getTeamSkillLine } from "./rules/teamSkillStats.js?v=20260716-records";
import {
  basesText,
  cardRarity,
  escapeHtml,
  playerPosition,
  playerPower,
  playerPrimary,
  raceColor,
  renderBoxScore,
  renderBudgetRace,
  renderDraftHistoryTable,
  renderDraftScatter,
  renderPlayerCard,
  renderPlayerTable,
  renderRaceChart,
  renderWinProbabilityChart
} from "./ui/render.js?v=20260716-records";

const STORAGE_KEY = "mlb-showdown-mvp-state-v3";
const BOARD_POSITION_GROUPS = ["C", "1B", "2B", "3B", "SS", "LF/RF", "CF", "DH", "SP", "RP"];
const DEFAULT_UNIVERSE = "classic";
const app = document.querySelector("#app");
const cardPreview = document.createElement("div");
cardPreview.className = "hover-card-preview";
cardPreview.setAttribute("aria-hidden", "true");
document.body.append(cardPreview);
const chartTip = document.createElement("div");
chartTip.className = "chart-tip";
chartTip.setAttribute("aria-hidden", "true");
chartTip.hidden = true;
const chartTipValue = document.createElement("strong");
const chartTipPlay = document.createElement("span");
chartTip.append(chartTipValue, chartTipPlay);
document.body.append(chartTip);
// A richer floating card the interactive draft charts share: a bold title with a
// manager swatch, then a stack of plain-text lines. Content rides in data-tip-*
// attributes on each dot (see pointTipAttrs in render.js).
const pointTip = document.createElement("div");
pointTip.className = "chart-tip point-tip";
pointTip.setAttribute("aria-hidden", "true");
pointTip.hidden = true;
document.body.append(pointTip);
// A won lot gets a beat of its own: a card that drops in over the board naming
// the winner and the price, then bows out on its own a couple of seconds later.
const saleToast = document.createElement("div");
saleToast.className = "sale-toast";
saleToast.setAttribute("aria-hidden", "true");
saleToast.hidden = true;
document.body.append(saleToast);
let saleToastTimer = null;

let state = loadState() ?? defaultState();
// A restored draft carries its own dealt cards, so it never re-deals — but
// the card faces still look the rest of the universe up (a two-way player's
// other half, most of all), so point it at the room's card set on the way in.
setUniverse(state.seed, state.universe, { priceNoise: false });
let selectedLineupMove = null;
let draggedLineupMove = null;
let selectedOrderMove = null;
let draggedOrderMove = null;
// The open game, if one is being played. A game is a sitting rather than a
// save: it holds live engine state (the seeded rng included), so it lives in
// memory only and a reload puts you back on the draft board.
let liveGame = null;
let batchRunToken = 0;
let hoverPreviewController = null;
let onlineStream = null;
// The bid box that was rejected, and why — one manager's error, not the
// panel's, now that several boxes can be open at once.
let lotEntryError = null;
// A sealed bid you have typed but not submitted lives nowhere but in the box,
// and the board throws every box away each time it repaints — which it does on
// anybody's news: another manager's bid landing, a seat changing hands, a
// resync. Carry the digits, the focus, and the caret across the repaint.
let sealedBidStash = null;
let cpuPaused = false;
let setupImportError = null;
let cpuDriveKey = null;

// ---- Pick clock and chime ----
// Each client anchors the clock when it first sees a turn start, so clients
// agree to within a network hop — good enough for a friendly room. On expiry
// the on-the-clock player's client auto-picks itself; the host client
// backstops absent players after a short grace period.
let pickClockKey = null;
let pickClockDeadline = 0;
let pickClockTimeoutKey = null;
let pickClockWarned = false;
let warRoomLotKey = null;

setInterval(pickClockTick, 500);
setInterval(auctionClockTick, 500);

// Coming back from a break, the clock picks up where it stopped rather than
// handing the manager a fresh minute he did not earn.
function restartPickClock(draft) {
  const left = draft?.pausedRemainingMs;
  pickClockKey = null;
  pickClockTimeoutKey = null;
  pickClockWarned = false;
  if (Number.isFinite(left) && left > 0) {
    // pickClockTick sets the deadline when it sees a new turn key; pre-load the
    // one it is about to see so the remaining time survives the break.
    const turn = pickClockTurn();
    if (turn) {
      pickClockKey = turn.key;
      pickClockDeadline = Date.now() + left;
    }
  }
  if (draft) draft.pausedRemainingMs = null;
}

function pickClockTurn() {
  const draft = state.draft;
  if (!draft || draft.complete) return null;
  // Paused means paused: an untimed auction's pick clock stops too, so a break
  // never times anybody out of a nomination they were about to make.
  if (isDraftPaused(draft)) return null;
  if (isAuctionDraft(draft) && auctionTimerEnabled(draft)) return null;
  // Computer turns resolve instantly, so the clock only times humans: picks,
  // nominations, and each sealed-bid entry while a lot is on the block.
  const lot = liveLot(draft);
  // A passed lot leaves pickNumber where it was, so the lot counter — not the
  // sale counter — is what makes each turn's clock key its own.
  const lotNumber = isRandomNomination(draft) ? draft.auction.queueIndex : draft.pickNumber;
  if (isAuctionDraft(draft) && lot) {
    const bidder = sealedBidder(liveDraft(draft));
    if (!bidder || bidder.cpu) return null;
    return {
      current: bidder,
      bidTurn: true,
      key: `${state.online?.roomId ?? "local"}:${draft.seed}:${lotNumber}:bid:${lot.round}:${bidder.id}`
    };
  }
  // Between lots in a random-nomination room there is nothing for a human to
  // do — the queue turns the next card over by itself, so nobody is on a clock.
  if (isRandomNomination(draft)) return null;
  const current = currentManager(draft);
  if (!current || current.cpu) return null;
  return { current, bidTurn: false, key: `${state.online?.roomId ?? "local"}:${draft.seed}:${lotNumber}:${current.id}` };
}

function auctionClockTick() {
  const draft = state.draft;
  if (!draft || !isAuctionDraft(draft) || !auctionTimerEnabled(draft) || draft.complete) return;
  if (!state.online && syncAuctionTimer(draft, draftNow())) {
    selectedLineupMove = null;
    invalidateBatch();
    afterLocalDraftAction();
    return;
  }
  const reviewClock = document.querySelector("[data-auction-review-clock]");
  if (reviewClock) reviewClock.textContent = formatAuctionClock(auctionReviewRemainingMs(draft, draftNow()));
  const live = liveDraft(draft);
  for (const clock of document.querySelectorAll("[data-auction-clock][data-manager-id]")) {
    const manager = draft.managers.find((item) => item.id === clock.dataset.managerId);
    if (manager) clock.textContent = formatAuctionClock(auctionBidTimeRemainingMs(live, manager, draftNow()));
  }
}

function formatAuctionClock(ms) {
  const seconds = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// A snake draft has one clock or none: the per-pick countdown, or the chess
// clock. Which one is a question about the draft, so it is a question about
// state, not two settings that can quietly both be on.
function snakeClockMode(value) {
  if (value.snakeTimer?.enabled) return "chess";
  return value.pickTimerSeconds > 0 ? "pick" : "off";
}

// The form's three radios, read back into the two settings the rest of the app
// already understands. Only one of them can be live at a time.
function snakeClockFromForm(form) {
  const mode = String(form.get("snakeClock") ?? "off");
  return {
    pickTimerSeconds: mode === "pick" ? normalizePickTimerSeconds(form.get("pickTimer") || 60) : 0,
    snakeTimer: {
      enabled: mode === "chess",
      bankSeconds: normalizeTimerSeconds(form.get("snakeBankSeconds"), SNAKE_DEFAULT_CLOCK_BANK_SECONDS),
      incrementSeconds: normalizeTimerSeconds(form.get("snakeIncrementSeconds"), SNAKE_DEFAULT_CLOCK_INCREMENT_SECONDS)
    }
  };
}

// What createDraft wants: the config, or false for a draft with no chess clock
// at all. An auction never has one — it has its own.
function snakeTimerConfig(value, draftType) {
  return draftType !== "auction" && value.snakeTimer?.enabled ? { ...value.snakeTimer } : false;
}

function normalizeAuctionTimerInput(form) {
  return {
    reviewSeconds: normalizeTimerSeconds(form.get("auctionReviewSeconds"), AUCTION_DEFAULT_REVIEW_SECONDS),
    bankSeconds: normalizeTimerSeconds(form.get("auctionBankSeconds"), AUCTION_DEFAULT_CLOCK_BANK_SECONDS),
    incrementSeconds: normalizeTimerSeconds(form.get("auctionIncrementSeconds"), AUCTION_DEFAULT_CLOCK_INCREMENT_SECONDS)
  };
}

function normalizeTimerSeconds(value, fallback) {
  const seconds = Math.round(Number(value));
  return Number.isFinite(seconds) ? Math.max(0, seconds) : fallback;
}

function normalizeSnakeTimerState(value) {
  const timer = normalizeSnakeTimerConfig(value);
  return {
    enabled: timer.enabled,
    bankSeconds: timer.enabled ? Math.round(timer.bankMs / 1000) : SNAKE_DEFAULT_CLOCK_BANK_SECONDS,
    incrementSeconds: timer.enabled ? Math.round(timer.incrementMs / 1000) : SNAKE_DEFAULT_CLOCK_INCREMENT_SECONDS
  };
}

function normalizeAuctionTimerState(value) {
  const timer = normalizeAuctionTimerConfig(value ?? {
    reviewSeconds: AUCTION_DEFAULT_REVIEW_SECONDS,
    bankSeconds: AUCTION_DEFAULT_CLOCK_BANK_SECONDS,
    incrementSeconds: AUCTION_DEFAULT_CLOCK_INCREMENT_SECONDS
  });
  return {
    reviewSeconds: Math.round(timer.reviewMs / 1000),
    bankSeconds: Math.round(timer.bankMs / 1000),
    incrementSeconds: Math.round(timer.incrementMs / 1000)
  };
}

function pickClockTick() {
  const turn = pickClockTurn();
  if (!turn) {
    pickClockKey = null;
    updatePickClockDisplay(null);
    return;
  }
  if (turn.key !== pickClockKey) {
    pickClockKey = turn.key;
    pickClockDeadline = Date.now() + state.pickTimerSeconds * 1000;
    pickClockWarned = false;
    // The deadline lives in this tab's memory, which the broadcast board on the
    // second screen cannot see. Publish it once a turn — not once a tick — so
    // the board can run the same clock without this one writing constantly.
    if (state.pickTimerSeconds > 0) {
      state.pickDeadline = pickClockDeadline;
      saveState();
    }
    if (shouldChimeForTurn(turn.current)) {
      playYourTurn();
      announceTurn(state.draft, turn.current);
    } else {
      clearTurnAnnouncement();
    }
  }
  // The chess clock does not reset with the turn: what is left is whatever this
  // manager has left, and the draft itself is the one keeping it.
  const chess = snakeClockEnabled(state.draft);
  if (!state.pickTimerSeconds && !chess) {
    updatePickClockDisplay(null);
    return;
  }
  const remaining = chess
    ? snakeTimeRemainingMs(liveDraft(state.draft), turn.current, draftNow())
    : pickClockDeadline - Date.now();
  updatePickClockDisplay(remaining, chess ? turn.current : null);
  updateSnakeBankDisplays();
  // Ten seconds out, the clock stops being furniture and starts being a threat.
  if (!pickClockWarned && remaining > 0 && remaining <= 10_000 && shouldChimeForTurn(turn.current)) {
    pickClockWarned = true;
    playClockWarning();
  }
  if (remaining <= 0) handlePickClockExpiry(turn);
}

// Every manager's bank, wherever it is shown, kept honest between renders —
// the one that is running is the only one that moves.
function updateSnakeBankDisplays() {
  const draft = state.draft;
  if (!snakeClockEnabled(draft)) return;
  const live = liveDraft(draft);
  for (const node of document.querySelectorAll("[data-snake-clock][data-manager-id]")) {
    const manager = draft.managers.find((item) => item.id === node.dataset.managerId);
    if (!manager) continue;
    const left = snakeTimeRemainingMs(live, manager, draftNow());
    node.textContent = formatAuctionClock(left);
    node.classList.toggle("flagged", left <= 0);
  }
}

function handlePickClockExpiry(turn) {
  if (pickClockTimeoutKey === turn.key) return;
  const online = state.online;
  if (!online) {
    pickClockTimeoutKey = turn.key;
    // A stalled sealed bid times out into an auto-bid; a stalled pick or
    // nomination times out into an autopick.
    if (turn.bidTurn) {
      placeSealedBid(state.draft, turn.current.id, cpuSealedBid(state.draft, turn.current));
    } else {
      autopickTurn(state.draft);
    }
    selectedLineupMove = null;
    invalidateBatch();
    afterLocalDraftAction();
    return;
  }
  const myTurn = online.managerId === turn.current.id;
  // Whoever is on the clock times themselves out. The host covers a seat that
  // has gone quiet, a beat later so the two don't race.
  if (!myTurn && !online.host) return;
  if (!myTurn && Date.now() < pickClockDeadline + 2000) return;
  pickClockTimeoutKey = turn.key;
  if (turn.bidTurn) {
    // A stalled bid is entered at that manager's own willingness, exactly as a
    // local draft would — otherwise one player stepping away freezes the lot.
    const live = liveDraft(state.draft);
    sendOnlineAction({ type: "seal-bid", managerId: turn.current.id, amount: cpuSealedBid(live, turn.current) });
    return;
  }
  sendOnlineAction({ type: isAuctionDraft(state.draft) ? "auto-nominate" : "autopick" });
}

// Everything a computer manager is currently up for happens at once: snake
// picks, auction nominations, and sealed bids. Local drafts only — online
// rooms route computer moves through the host client instead.
function advanceCpuTurns() {
  const draft = state.draft;
  if (!draft || state.online || cpuPaused) return;
  if (isDraftPaused(draft)) return;
  if (isAuctionDraft(draft) && !auctionReviewComplete(draft, draftNow())) return;
  let guard = auctionStepGuard(draft);
  while (!draft.complete && guard > 0) {
    guard -= 1;
    if (isAuctionDraft(draft)) {
      if (draft.auction.lot) {
        const next = sealedBidder(draft);
        if (!next?.cpu) return;
        placeSealedBid(draft, next.id, cpuSealedBid(draft, next));
        continue;
      }
      // The queue owes nobody a turn: it deals the next card whether the seat
      // that bids first is a computer or a human waiting to bid on it.
      if (isRandomNomination(draft)) {
        nominateBestTarget(draft);
        continue;
      }
      if (!currentManager(draft).cpu) return;
      nominateBestTarget(draft);
      continue;
    }
    if (!currentManager(draft).cpu) return;
    autopick(draft);
  }
}

// ---- what the room hears ----
//
// One watcher, run on every draft render, rather than a sound bolted onto each
// of the several paths a pick can arrive by: your click, a computer's turn, an
// expired clock, a snapshot off the room server. They all land here in the end.
let heardPickNumber = null;
let heardComplete = false;
let heardAuctionLotKey;
// The lot key we last sounded a tie for, so a lot that comes back tied cries out
// once when it goes to a rebid rather than on every repaint while it hangs there.
let heardTieLotKey = null;
let filteredAuctionLotKey = null;

function reactToDraftChange(draft, { spectator = false } = {}) {
  if (!draft) {
    heardPickNumber = null;
    heardComplete = false;
    heardAuctionLotKey = undefined;
    filteredAuctionLotKey = null;
    return;
  }
  const picks = draft.pickNumber ?? 0;
  const first = heardPickNumber === null;
  const landed = !first && picks > heardPickNumber;
  const lot = isAuctionDraft(draft) ? draft.auction?.lot : null;
  const lotKey = lot
    ? `${state.online?.roomId ?? "local"}:${draft.seed}:${draft.auction.history.length}:${draft.auction.queueIndex ?? draft.pickNumber}:${lot.playerId}`
    : null;

  if (heardAuctionLotKey !== undefined && lotKey && lotKey !== heardAuctionLotKey) {
    playNomination();
  }

  // A lot that came back tied goes to a sealed rebid. It keeps the same lot key,
  // so it never trips the nomination sting — it gets its own, sounded once when
  // the round turns over rather than on every repaint while the rebid sits open.
  if (lot && lot.round === 2 && lotKey && lotKey !== heardTieLotKey) {
    if (heardTieLotKey !== null || !first) playTie();
    heardTieLotKey = lotKey;
  } else if (!lot || lot.round !== 2) {
    heardTieLotKey = null;
  }

  if (landed) {
    // A card off your own board going to somebody else is not a pick, it is a
    // mugging, and it gets its own sound. A wall has no board and cannot be
    // mugged: every pick sounds the same on the broadcast.
    const mine = spectator ? new Set() : starredIds();
    const taken = draftHistory(draft)
      .slice(-(picks - heardPickNumber))
      .some((entry) => mine.has(entry.player?.id));
    if (taken) playSniped();
    else playPick(isAuctionDraft(draft) ? 0.38 : undefined);
    // A won lot gets a moment of its own: the winner and the price, front and
    // centre, gone on its own a couple of seconds later. Only for real auction
    // wins — the closing sweep hands out free fills and completes the draft, and
    // those are not somebody winning a card.
    if (!spectator && isAuctionDraft(draft) && !draft.complete) {
      const sale = draftHistory(draft).slice(-1)[0];
      if (sale?.player && sale.manager && Number.isFinite(sale.price)) {
        showSaleToast(sale);
      }
    }
  }

  if (draft.complete && !heardComplete && !first) playDraftComplete();

  heardPickNumber = picks;
  heardComplete = Boolean(draft.complete);
  heardAuctionLotKey = lotKey;
}

// Wraps up every human-initiated local draft change: computers respond,
// state saves, screen re-renders. Human action also lifts the undo pause.
function afterLocalDraftAction() {
  cpuPaused = false;
  advanceCpuTurns();
  saveState();
  renderDraft();
}

// When the host's client sees a computer manager on the clock in an online
// room, it sends the pick on the computer's behalf (once per turn).
function driveOnlineCpuTurn() {
  const online = state.online;
  const draft = state.draft;
  if (!online?.host || !draft || draft.complete || isAuctionDraft(draft)) return;
  if (online.pausedForUndo) return;
  const current = currentManager(draft);
  if (!current?.cpu) return;
  const key = `${online.roomId}:${draft.pickNumber}`;
  if (cpuDriveKey === key) return;
  cpuDriveKey = key;
  sendOnlineAction({ type: "autopick" });
}

function updatePickClockDisplay(remaining, onTheClock = null) {
  const clock = document.querySelector("[data-pick-timer]");
  if (!clock) return;
  if (remaining === null || (!state.pickTimerSeconds && !snakeClockEnabled(state.draft))) {
    clock.hidden = true;
    return;
  }
  clock.hidden = false;
  // A chess clock is somebody's clock, so it says whose. A flag that is down
  // says so too — his picks are being made for him now, and the room can see it.
  const flagged = onTheClock && remaining <= 0;
  clock.textContent = flagged
    ? `⚑ ${onTheClock.name} — out of time`
    : `⏱ ${formatPickClock(remaining)}${onTheClock ? ` · ${onTheClock.name}` : ""}`;
  clock.classList.toggle("low", remaining <= 10_000);
}

function formatPickClock(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function shouldChimeForTurn(current) {
  if (state.online) return Boolean(state.online.managerId) && current.id === state.online.managerId;
  // Hotseat: the chime calls the next manager over to the shared screen, but
  // only when a timed draft is actually being played — on either clock.
  return state.pickTimerSeconds > 0 || snakeClockEnabled(state.draft);
}

function toggleSound() {
  const nowMuted = toggleMuted();
  if (!nowMuted) {
    // Turning sound on is itself the gesture that buys the right to make it —
    // but the switch flips whether or not the browser ever gets round to
    // agreeing, so the button is never left waiting on the speaker.
    unlockSounds().then((ok) => {
      if (ok) playYourTurn();
    });
  }
  renderCurrentScreen();
}

function updateWarRoomNominationSound(draft, lot, player) {
  if (!lot || !player) return;
  const lotKey = `${draft.seed}:${draft.auction?.queueIndex ?? 0}:${draft.pickNumber}:${player.id}`;
  if (warRoomLotKey !== null && lotKey !== warRoomLotKey) playNomination();
  warRoomLotKey = lotKey;
}

// ---- your turn, wherever you are ----
//
// The chime only ever reached somebody already looking at the tab, which is the
// one person who did not need telling. A notification and a title badge reach
// the person who wandered off, which is the whole point of a clock.

let turnNotification = null;
const baseTitle = document.title;

function setTitleBadge(on) {
  document.title = on ? `(1) Your pick — ${baseTitle}` : baseTitle;
}

function askToNotify() {
  try {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") Notification.requestPermission().catch(() => {});
  } catch {
    // A browser without notifications still has the chime and the badge.
  }
}

// The draft carries a pick number, not a round: the round is a thing you work
// out from how many managers are at the table.
function draftRound(draft) {
  const seats = draft?.managers?.length ?? 0;
  if (!seats) return 1;
  return Math.floor((draft.pickNumber ?? 0) / seats) + 1;
}

function announceTurn(draft, current) {
  setTitleBadge(true);
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    if (document.visibilityState === "visible") return;
    turnNotification?.close();
    const round = draftRound(draft);
    turnNotification = new Notification("You're on the clock", {
      body: `Round ${round} — ${current?.name ?? "your"} pick is up.`,
      tag: "showdown-turn",
      renotify: true
    });
    turnNotification.onclick = () => {
      window.focus();
      turnNotification?.close();
    };
  } catch {
    // Notification constructors throw on some platforms; the badge still stands.
  }
}

function clearTurnAnnouncement() {
  setTitleBadge(false);
  turnNotification?.close();
  turnNotification = null;
}

// Coming back to the tab is as good as being told.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") clearTurnAnnouncement();
});

// A browser will not let a page make noise, or ask to notify, until somebody has
// touched it. The first touch anywhere buys both for the rest of the session.
const openTheRoom = () => {
  unlockSounds();
  askToNotify();
};
window.addEventListener("pointerdown", openTheRoom, { once: true, capture: true });
window.addEventListener("keydown", openTheRoom, { once: true, capture: true });

const onlineRoomParam = new URLSearchParams(location.search).get("room");
const warRoomMode = new URLSearchParams(location.search).has("board");
if (warRoomMode) {
  window.addEventListener("pointerdown", unlockSounds, { once: true, capture: true });
  window.addEventListener("keydown", unlockSounds, { once: true, capture: true });
}
// The first paint waits for the module to finish being a module.
//
// This line used to run here, in the middle of the file, which meant the first
// render happened while the second half of the module did not exist yet. Every
// `const` and `let` below this point is still in its temporal dead zone at that
// moment — twelve of them — and a render that reaches one throws a
// ReferenceError instead of drawing anything. Restoring a FINISHED draft did
// exactly that: the results screen wants poolScaleCache, which is declared 4700
// lines further down, and the page came up blank with "Cannot access
// 'poolScaleCache' before initialization" and no way out but clearing storage.
//
// A microtask is enough. It runs the instant the module is evaluated, before the
// browser has a chance to paint anything, so nothing is deferred that anyone can
// see — but it runs AFTER the last declaration in the file, which is the whole
// point. Moving the one variable would have fixed the one crash and left the
// other eleven armed.
queueMicrotask(() => {
  if (onlineRoomParam) {
    bootOnlineRoom(onlineRoomParam);
  } else {
    renderCurrentScreen();
  }
});

// The TV board mirrors a same-browser draft through localStorage: the storage
// event fires on writes from other tabs, and a slow poll covers same-tab and
// missed events.
if (warRoomMode && !onlineRoomParam) {
  let warRoomSnapshot = localStorage.getItem(STORAGE_KEY);
  const refreshWarRoom = () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === warRoomSnapshot) return;
    warRoomSnapshot = raw;
    state = loadState() ?? defaultState();
    renderCurrentScreen();
  };
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) refreshWarRoom();
  });
  setInterval(refreshWarRoom, 1500);
  // The whole board only needs repainting when the room moves; the clock needs
  // repainting every second, and it is one span.
  setInterval(updateWarClock, 500);
}

function defaultState() {
  return {
    seed: "coefficient-classic",
    managers: ["Skylar", "Kasey", "Scott"],
    cpuManagers: [],
    universe: DEFAULT_UNIVERSE,
    draftType: "snake",
    nomination: "manual",
    // A blind draft: hide every card's printed points until it is drafted, so
    // managers pick and bid on the baseball rather than the number.
    hidePoints: false,
    auctionBudget: defaultAuctionBudget(rosterSizeForStartingPitchers(DEFAULT_STARTING_PITCHERS)),
    auctionTimer: {
      reviewSeconds: AUCTION_DEFAULT_REVIEW_SECONDS,
      bankSeconds: AUCTION_DEFAULT_CLOCK_BANK_SECONDS,
      incrementSeconds: AUCTION_DEFAULT_CLOCK_INCREMENT_SECONDS
    },
    pickTimerSeconds: 0,
    // The snake's chess clock: off by default, because the per-pick clock was
    // the only clock a snake draft ever had and a room that names none has none.
    snakeTimer: {
      enabled: false,
      bankSeconds: SNAKE_DEFAULT_CLOCK_BANK_SECONDS,
      incrementSeconds: SNAKE_DEFAULT_CLOCK_INCREMENT_SECONDS
    },
    // Which seat is yours. Kept outside `online`, which is cleared when the
    // room ends — see viewerManager().
    myManagerId: null,
    maskBids: false,
    startingPitchers: DEFAULT_STARTING_PITCHERS,
    rosterSize: rosterSizeForStartingPitchers(DEFAULT_STARTING_PITCHERS),
    draft: null,
    draftTab: "available",
    rosterTab: "roster",
    // Whose roster the focus view is showing. Null follows your own board; a
    // manager id pins someone else's roster (read-only unless it is yours).
    rosterManagerId: null,
    rosterDock: "open",
    online: null,
    tournament: null,
    batch: null,
    batchSorts: {
      teams: { sort: "winPct", direction: "desc" },
      hitters: { sort: "ops", direction: "desc" },
      pitchers: { sort: "era", direction: "asc" }
    },
    batchStatsTab: "overview",
    batchPitcherSplit: "overall",
    batchChartManager: null,
    batchGamePage: 0,
    batchGameIndex: null,
    view: null,
    selectedGameIndex: 0,
    selectedTeamName: null,
    // Each manager's watchlist, keyed by manager id: the cards they are keeping
    // an eye on. It belongs to your own seat when you have one; only an
    // anonymous hotseat lets it follow the clock around the table.
    starred: {},
    // A second watchlist that works exactly like the stars, keyed the same way:
    // a separate shortlist you can keep on the same board.
    flagged: {},
    // Whether an auction board colours by what a card cost or what it is worth.
    heatBy: "price",
    // When the clock on the current pick runs out — published for the board on
    // the second screen, which cannot see this tab's memory.
    pickDeadline: null,
    filters: {
      type: "hitter",
      position: "all",
      sort: "points",
      sortDirection: "desc",
      search: "",
      starredOnly: false,
      flaggedOnly: false
    }
  };
}

function renderCurrentScreen() {
  // The sheet is ruled in the club's ink once a franchise room is open. The
  // setup screen is not in a league yet, so it keeps the house colors — and
  // walking back out to it puts them back.
  applyFranchisePalette(state.draft ? state.universe : null);
  if (warRoomMode) {
    renderWarRoom();
    return;
  }
  if (state.online && !state.online.managerId && !state.online.spectator) {
    renderSeatSelect();
  } else if (liveGame) {
    renderLiveGame();
  } else if (state.view === "batch" && state.batch && state.draft) {
    renderBatch();
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
  // Fetching the room is the easy half. Rebuilding it — dealing its deck and
  // replaying every action in its log — is where things actually go wrong, and
  // an exception thrown in there used to escape into nothing: the screen sat on
  // "Connecting to room…" forever while the console quietly held the reason.
  // Say it out loud instead.
  try {
    openRoom(roomId, room);
  } catch (error) {
    renderOnlineMessage(`Room ${roomId} could not be rebuilt: ${error.message}`, true);
  }
}

function openRoom(roomId, room) {
  const seat = loadOnlineSeat(roomId);
  state = defaultState();
  state.seed = room.seed;
  state.managers = room.managers.map((manager) => manager.name);
  state.startingPitchers = normalizeStartingPitchers(room.startingPitchers);
  state.rosterSize = rosterSizeForStartingPitchers(state.startingPitchers);
  state.universe = universeConfig(room.universe)?.key ?? DEFAULT_UNIVERSE;
  state.pickTimerSeconds = normalizePickTimerSeconds(room.pickTimer);
  state.draftType = room.draftType === "auction" ? "auction" : "snake";
  state.nomination = room.nomination === "random" ? "random" : "manual";
  state.hidePoints = Boolean(room.hidePoints);
  state.auctionBudget = normalizeAuctionBudget(room.auctionBudget, state.rosterSize);
  state.auctionTimer = normalizeAuctionTimerState(room.auctionTimer);
  state.cpuManagers = room.managers.filter((manager) => manager.cpu).map((manager) => manager.name);
  state.online = {
    roomId,
    managerId: seat?.managerId ?? null,
    token: seat?.token ?? null,
    host: Boolean(seat?.host),
    hostToken: seat?.hostToken ?? null,
    spectator: Boolean(seat?.spectator) || warRoomMode,
    claimedSeats: room.managers.filter((manager) => manager.claimed).map((manager) => manager.id),
    // Claimed is not occupied. A seat whose holder lost their token is still
    // claimed, and is the one somebody needs to be able to sit back down in.
    liveSeats: room.managers.filter((manager) => manager.live).map((manager) => manager.id),
    appliedSeq: 0,
    serverOffsetMs: Number(room.serverNow) - Date.now() || 0,
    status: "",
    lot: null,
    // Where the room actually lives on the network, as the server sees itself.
    // The invite link needs this: a host reading the address off the terminal
    // is browsing 127.0.0.1, and that link means "your own machine" to everyone
    // he sends it to.
    lanOrigin: room.lanOrigin ?? null
  };
  rebuildOnlineDraft(room);
  subscribeOnline();
  renderCurrentScreen();
}

function rebuildOnlineDraft(room) {
  // The board is the one the ROOM dealt, not one this browser deals for itself.
  // Re-dealing from the seed asks every client to reproduce a deal that only
  // holds while nobody touches the dealing code — and the room outlives that.
  const pool = room.deck?.length
    ? deckFromIds(state.universe, room.seed, room.deck)
    : buildDraftPool(state.universe, room.seed, {
      nomination: state.nomination,
      managerCount: room.managers.length,
      startingPitchers: state.startingPitchers
    });
  state.draft = createDraft(
    room.managers.map((manager) => ({ name: manager.name, cpu: Boolean(manager.cpu) })),
    pool,
    room.rosterSize,
    room.seed,
    {
      draftType: state.draftType,
      startingPitchers: state.startingPitchers,
      nomination: state.nomination,
      hidePoints: state.hidePoints,
      budget: state.auctionBudget,
      // A room that names no clock has no clock — the same default reviveRoom
      // takes on the server. Left undefined this normalizes to a TIMED auction
      // (the house rule), which invents a review period the room never had, and
      // then the room's own log will not replay through it: the nomination that
      // was legal when it was recorded throws "Review period is still open" and
      // the room can never be opened again.
      timer: room.auctionTimer ?? false,
      // Same rule for the snake's chess clock: a room that names none has none.
      snakeTimer: room.snakeTimer ?? false
    }
  );
  // The bids on the card currently up are withheld until it sells, so the
  // replayed draft only knows the lot was nominated; the room's lot event
  // carries the rest of it.
  state.online.lot = room.lot ?? null;
  let lastSim = null;
  for (const entry of room.actions) {
    if (SIM_ACTION_TYPES.has(entry.action?.type)) {
      lastSim = entry.action;
    } else {
      applyDraftAction(state.draft, entry.action);
    }
  }
  state.online.appliedSeq = room.actions.length ? room.actions.at(-1).seq : 0;
  // Your own team, not the first name in the room. Everybody was landing on
  // manager one's roster and staring at somebody else's cards.
  const mySeat = state.draft.managers.find((manager) => manager.id === state.online.managerId);
  state.selectedTeamName = mySeat?.name ?? state.managers[0];
  if (lastSim) applySharedSim(lastSim, { instant: true });
  driveOnlineCpuTurn();
}

// A sim action in the shared log means someone hit "Sim": every client runs
// the same seeded simulation locally, so results match on all machines.
function applySharedSim(action, options = {}) {
  if (!state.draft || !canSimulate(state.draft)) return;
  if (action.type === "batch") {
    startBatchRun(action.runs ?? DEFAULT_BATCH_RUNS, { ...options, salt: action.salt });
  }
}

function subscribeOnline() {
  onlineStream?.close();
  onlineStream = subscribeRoom(state.online.roomId, state.online.appliedSeq, {
    onHello: () => {
      if (!state.online) return;
      state.online.status = "";
    },
    onAction: (entry) => {
      const online = state.online;
      if (!online || entry.seq <= online.appliedSeq) return;
      if (entry.seq > online.appliedSeq + 1) {
        resyncOnlineRoom();
        return;
      }
      if (SIM_ACTION_TYPES.has(entry.action?.type)) {
        online.appliedSeq = entry.seq;
        online.status = "";
        // The batch renders its own race animation; no render call here.
        applySharedSim(entry.action);
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
      // An undo means someone is rewinding on purpose; hold computer picks
      // until the next forward action so they don't instantly redo the turn.
      online.pausedForUndo = entry.action.type === "undo";
      if (entry.action.type !== "lineup") {
        state.tournament = null;
        invalidateBatch();
      }
      selectedLineupMove = null;
      draggedLineupMove = null;
      renderCurrentScreen();
      driveOnlineCpuTurn();
    },
    onSeats: (payload) => {
      if (!state.online) return;
      state.online.claimedSeats = payload.seats;
      state.online.liveSeats = payload.live ?? payload.seats;
      renderCurrentScreen();
    },
    onLot: (payload) => {
      if (!state.online) return;
      state.online.lot = payload.lot;
      renderCurrentScreen();
    },
    onError: () => {
      if (!state.online || state.online.status) return;
      state.online.status = "Reconnecting to room server…";
      renderCurrentScreen();
    },
    // The stream went quiet without ever erroring — the room has been moving on
    // without us. Go and fetch what we missed.
    //
    // This is what a two-second poll used to do, badly: it refetched the room
    // forever, whether anything had happened or not, and every resync rebuilt
    // the board — which tore the card you were hovering out from under your
    // cursor twice a second. The stream tells us when it dies now (the server
    // beats every twenty seconds), and an action's own reply tells the client
    // that sent it what happened. Neither needs a heartbeat of re-renders.
    onSilent: () => {
      resyncOnlineRoom();
    }
  }, state.online.token);
}

async function resyncOnlineRoom(snapshot = null) {
  const online = state.online;
  if (!online) return;
  try {
    const room = snapshot ?? await fetchRoom(online.roomId);
    if (state.online !== online) return;
    online.serverOffsetMs = Number(room.serverNow) - Date.now() || online.serverOffsetMs || 0;
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
  if (!online) return;
  if (!online.token) {
    online.status = "Spectators can't run room actions — claim a seat first.";
    renderCurrentScreen();
    return;
  }
  try {
    const result = await sendRoomAction(online.roomId, online.token, action);
    // Never wait on the stream to find out what your own click did. The reply
    // to the request carries the room's answer, so act on it: a bidder whose
    // stream has quietly died used to press Submit and watch nothing happen —
    // the bid landed, everybody else saw it, and only they were left staring at
    // a screen that would not move until they reloaded the page.
    if (state.online !== online) return;
    if (result?.lot !== undefined) online.lot = result.lot;
    if (Number(result?.seq) > online.appliedSeq) {
      // The log moved and we have not seen it — the stream is behind or gone.
      await resyncOnlineRoom();
      return;
    }
    renderCurrentScreen();
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
  // A seat is held by a token in one browser's storage, which is a fragile
  // place to keep the only key to your own team: clear it, or come back on a
  // different address, and the room says your seat is taken — by you, for ever.
  //
  // So a seat is only defended while somebody is actually IN it. The stream is
  // the proof: if a seat has nobody on the other end of it, it is empty, and
  // whoever comes back to it may sit down. The host can take back any seat at
  // all, occupied or not.
  const liveSeats = online.liveSeats ?? online.claimedSeats;
  const seats = state.draft.managers
    .map((manager) => {
      const claimed = online.claimedSeats.includes(manager.id);
      const occupied = liveSeats.includes(manager.id);
      const canTake = !manager.cpu && (!claimed || !occupied || online.hostToken);
      const label = manager.cpu ? "Computer"
        : !claimed ? "Open seat"
        : occupied ? (online.hostToken ? "Taken &middot; take it back" : "Taken")
        : "Nobody there &middot; take it back";
      return `<button class="seat-option ${claimed && canTake ? "reseat-option" : ""}" data-action="claim-seat" data-manager-id="${escapeHtml(manager.id)}" ${canTake ? "" : "disabled"}>
        <strong>${escapeHtml(manager.name)}</strong>
        <span>${label}</span>
      </button>`;
    })
    .join("");
  app.innerHTML = `<section class="panel setup">
    <div>
      <p class="eyebrow">Online room ${escapeHtml(online.roomId)}</p>
      <h1>Choose your seat</h1>
      <p class="lede">Pick the manager you will draft for.${online.hostToken ? " You created this room, so your seat gets host controls &mdash; and you can take back a seat somebody has lost." : ""}</p>
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
      // Remembered OUTSIDE the online block, which is cleared when the room
      // ends: the seat is who you are, and you are still that when the draft is
      // over and the room has gone.
      state.myManagerId = result.managerId;
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

// 127.0.0.1 and localhost mean "this machine" on whatever machine reads them,
// so an invite link built from a loopback address sends every guest to their
// own laptop, where nothing is listening. When the host is browsing loopback,
// hand out the address the server reports itself at on the network instead.
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function inviteOrigin(online) {
  if (!LOOPBACK_HOSTS.has(location.hostname)) return location.origin;
  return online.lanOrigin ?? location.origin;
}

function renderOnlineBanner(draft, current) {
  const online = state.online;
  const mySeat = draft.managers.find((manager) => manager.id === online.managerId);
  const shareUrl = `${inviteOrigin(online)}${location.pathname}?room=${encodeURIComponent(online.roomId)}`;
  const turnNote = draft.complete
    ? "Draft complete — anyone can sim the tournament locally"
    : current
      ? online.managerId === current.id
        ? "You are on the clock"
        : `Waiting for ${current.name}`
      : "";
  return `<section class="panel online-banner">
    <span><strong>Online room ${escapeHtml(online.roomId)}</strong></span>
    ${draft.seed ? `<span class="online-seed">Seed <code>${escapeHtml(String(draft.seed))}</code></span>` : ""}
    <span>${mySeat ? `You are ${escapeHtml(mySeat.name)}${online.host ? " (host)" : ""}` : "Spectating"}</span>
    ${turnNote ? `<span>${escapeHtml(turnNote)}</span>` : ""}
    <span class="online-share">Invite link: <code>${escapeHtml(shareUrl)}</code></span>
    <a class="tv-board-link" href="${escapeHtml(shareUrl)}&board" target="_blank" rel="noopener">&#128250; TV board</a>
    ${online.status ? `<span class="warn">${escapeHtml(online.status)}</span>` : ""}
  </section>`;
}

function onlineCanPickNow(current) {
  const online = state.online;
  if (!online) return true;
  if (!current) return false;
  return online.host || current.id === online.managerId;
}

function draftNow() {
  return Date.now() + (state.online?.serverOffsetMs ?? 0);
}

// Taking a pick back rewinds the room, so it is the host's button. A manager
// who could undo their own pick could undo it after seeing what came next, and
// on a hotseat the whole table shares the one keyboard anyway.
function onlineCanUndo() {
  const online = state.online;
  return !online || Boolean(online.host);
}

// The card set the room drafts out of, as the setup form sees it: which of
// the five choices is selected, plus the sub-picker state each of the two
// parameterized ones carries. The universe key is the whole truth — the form
// reads its shape back out rather than keeping a second copy in state.
function universeChoice(key) {
  const multi = /^decades-([\d,]+)$/.exec(key ?? "");
  if (multi) return { pick: "decades", decades: multi[1].split(",").map(Number), franchise: FRANCHISES[0].id };
  const decade = /^decade-(\d{4})$/.exec(key ?? "");
  if (decade) return { pick: "decades", decades: [Number(decade[1])], franchise: FRANCHISES[0].id };
  const franchise = /^franchise-([A-Z]{2,3})$/.exec(key ?? "");
  if (franchise) return { pick: "franchise", decades: [...DECADES], franchise: franchise[1] };
  return { pick: UNIVERSES[key] ? key : DEFAULT_UNIVERSE, decades: [...DECADES], franchise: FRANCHISES[0].id };
}

// The other direction: what the form is showing becomes a universe key.
function universeFromForm(form) {
  const pick = String(form.get("universe") ?? DEFAULT_UNIVERSE);
  if (pick === "decades") {
    const checked = DECADES.filter((start) => form.getAll("decade").includes(String(start)));
    return checked.length ? `decades-${checked.join(",")}` : null;
  }
  if (pick === "franchise") return `franchise-${String(form.get("franchise"))}`;
  return UNIVERSES[pick] ? pick : DEFAULT_UNIVERSE;
}

function renderUniverseFieldset(key) {
  const choice = universeChoice(key);
  const option = (value, title, blurb) => `<label class="pool-option">
    <input type="radio" name="universe" value="${value}" ${choice.pick === value ? "checked" : ""} />
    <span><strong>${title}</strong><small>${blurb}</small></span>
  </label>`;
  return `<fieldset class="pool-mode universe-mode">
    <legend>Card set</legend>
    ${option("classic", "Classic Showdown",
      "Every real MLB Showdown card, 2000&ndash;2005 &mdash; the printed charts, the printed points, and the printed card fronts.")}
    ${option("mlb-history", "MLB: all time",
      "A century of real big leaguers rated on their whole careers &mdash; stars, scrubs, and everyone between.")}
    ${option("decades", "MLB: by decade",
      "Real players rated on one decade's numbers. Check the decades you want in the pool.")}
    <div class="pool-suboptions decade-checklist" ${choice.pick === "decades" ? "" : "hidden"}>
      <button type="button" class="small decade-toggle" data-action="toggle-decades">${choice.decades.length === DECADES.length ? "Uncheck all" : "Check all"}</button>
      ${DECADES.map((start) => `<label class="decade-option">
        <input type="checkbox" name="decade" value="${start}" ${choice.decades.includes(start) ? "checked" : ""} />
        <span>The ${escapeHtml(decadeLabel(start).toLowerCase())}</span>
      </label>`).join("")}
      <small>The ${EARLIEST_DECADE}s bucket folds in the dead-ball era and everything before it. A player who lasted three decades prints three cards &mdash; you may only roster one of them.</small>
    </div>
    ${option("franchise", "MLB: by franchise",
      "One club's all-time roster, every player rated on their years there.")}
    <div class="pool-suboptions" ${choice.pick === "franchise" ? "" : "hidden"}>
      <label class="franchise-field">
        Club
        <select name="franchise">
          ${FRANCHISES.map((franchise) => `<option value="${franchise.id}" ${choice.franchise === franchise.id ? "selected" : ""}>${escapeHtml(franchise.name)}</option>`).join("")}
        </select>
      </label>
    </div>
    ${option("fictional", "Fictional players",
      "A made-up league, invented fresh from the seed above. Nobody has scouting reports on these guys.")}
  </fieldset>`;
}

// Random nomination is not a third kind of draft — it IS an auction, one that
// takes the nominating away from the managers. So the form asks the two
// questions it really is: what kind of draft, and then, if it's an auction,
// who puts the cards up. A snake draft has nobody nominating anything.
function draftModeFromForm(form) {
  const draftType = form.get("draftType") === "auction" ? "auction" : "snake";
  const nomination = draftType === "auction" && form.get("nomination") === "random" ? "random" : "manual";
  const hidePoints = Boolean(form.get("hidePoints"));
  return { draftType, nomination, hidePoints };
}

// Whether the chosen card set can actually seat the room, phrased for the setup
// screen. BOTH boards are dealt to the room now, so in both cases the question
// is the same one: is the card set deep enough to deal the board this room
// needs? It stopped being "how many managers does the deck seat", because the
// deck no longer has an opinion — it grows.
//
// The old message here said the deck seated nine and told you to pick a
// different card set. The first half was true and the second was not: the deck
// was a fixed 124 cards whatever the set, so no set could lift the number, and
// the advice sent people looking for a bigger set that would not have helped.
// The advice is real now — a single club's set runs dry where the whole of
// Showdown does not.
function draftPoolError(pool, universe, managerCount, nomination, startingPitchers = DEFAULT_STARTING_PITCHERS) {
  const setName = universeConfig(universe).name;
  if (nomination === "random") {
    const shortfalls = randomNominationShortfalls(pool, managerCount, startingPitchers);
    if (!shortfalls.length) return "";
    const spots = shortfalls.map((short) => `${short.group} (${short.dealt} of ${short.quota})`).join(", ");
    return `The ${setName} set is too thin to deal a ${managerCount}-manager random-nomination board: ${spots}. Trim the manager list or pick a deeper card set.`;
  }
  const managerLimit = maxPoolManagers(pool, startingPitchers);
  if (managerCount <= managerLimit) return "";
  return `The ${setName} set runs out of position depth at ${managerLimit} managers — it cannot deal a board deep enough for ${managerCount}. Trim the manager list or pick a deeper card set.`;
}

// The headline number: what this many managers actually see on the board, and
// how much of it comes up for bid.
function randomNominationBlurb(managerCount, startingPitchers = DEFAULT_STARTING_PITCHERS) {
  const { hiddenPerSlot, visiblePerSlot } = randomNominationCounts(Math.max(2, managerCount));
  return `With ${managerCount} managers the board shows ${visiblePerSlot * startingPitchers} starters and ${hiddenPerSlot * startingPitchers} of them come up.`;
}

// One real card from each pool, so the hero shows what it is offering instead
// of describing it. These are the same card objects the board deals, drawn by
// the same cardPanelHtml — so the printed set shows its actual scan, the
// historical set shows the 2005 face it prints, and the invented one shows the
// proto frame. The invented card comes off the seed in the box: change the seed
// and a different player turns up, which is the whole point of that set.
function exampleCard(rows, name) {
  const row = rows.filter((tuple) => tuple[1] === name);
  return row.length ? decodeCardRows(row)[0] : null;
}

function setupExamples(seed) {
  let invented = null;
  try {
    invented = buildFictionalDraftPool(seed).reduce((a, b) => (b.points > a.points ? b : a));
  } catch {
    invented = null;
  }
  return {
    printed: exampleCard(CLASSIC_CARD_ROWS, "Albert Pujols '04"),
    historical: exampleCard(MLB_HISTORY_ROWS, "Willie Mays"),
    invented
  };
}

function exampleCardHtml(card) {
  return card ? cardPanelHtml(card) : "";
}

// ---- are you sure ----
//
// The host's board looks exactly like everybody else's, except that every card
// on it is live on every clock. One stray click and a manager two seats over
// has a card they never asked for and cannot give back without the host undoing
// it. So when the host reaches across the table, the table asks first.
function confirmOverlay({ eyebrow, title, body, confirmLabel, cancelLabel = "Cancel" }) {
  return new Promise((resolve) => {
    const stage = document.createElement("div");
    stage.className = "confirm-stage";
    stage.innerHTML = `<div class="confirm-card" role="alertdialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <p class="eyebrow">${escapeHtml(eyebrow)}</p>
      <h2>${escapeHtml(title)}</h2>
      <p class="lede">${body}</p>
      <div class="confirm-actions">
        <button type="button" data-confirm="no">${escapeHtml(cancelLabel)}</button>
        <button type="button" class="confirm-yes" data-confirm="yes">${escapeHtml(confirmLabel)}</button>
      </div>
    </div>`;

    const settle = (answer) => {
      document.removeEventListener("keydown", onKey, true);
      stage.remove();
      resolve(answer);
    };
    // Escape is how a misclick gets taken back, so it has to beat every other
    // key handler on the page to the punch.
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      settle(false);
    };

    stage.onclick = (event) => {
      const button = event.target.closest("button[data-confirm]");
      // Clicking the dimmed room behind the card is a way of backing out of it.
      if (!button) {
        if (event.target === stage) settle(false);
        return;
      }
      settle(button.dataset.confirm === "yes");
    };
    document.addEventListener("keydown", onKey, true);
    document.body.append(stage);
    stage.querySelector(".confirm-yes").focus();
  });
}

// A host acting on their own clock is just drafting. A host acting on anyone
// else's clock is drafting for them, and that is the move worth a second look.
function hostActingForOthers(current) {
  const online = state.online;
  return Boolean(online?.host && current && current.id !== online.managerId);
}

function confirmHostAction(draft, current, playerId, { verb, outcome }) {
  const player = draft.pool.find((item) => item.id === playerId);
  return confirmOverlay({
    eyebrow: "Host controls",
    title: `${verb} for ${current.name}?`,
    body: `<strong>${escapeHtml(current.name)}</strong> is on the clock, not you.
      ${escapeHtml(player?.name ?? "This card")} ${outcome}, and the room will read it as their move.`,
    confirmLabel: `${verb} for ${current.name}`
  });
}

// ---- the lottery ----
//
// Draft order was whatever order the names got typed in, which is a strange way
// to decide who gets the first card in the set. Roll for it — and roll for it
// properly: the last seat comes out of the hat first, and the room works its way
// up to the first pick, because that is the only order that has any suspense in
// it.
let lotteryRunning = false;

async function runLottery(setupForm) {
  if (lotteryRunning) return;
  const textarea = setupForm.querySelector('textarea[name="managers"]');
  const names = dedupeManagerNames(
    String(textarea.value)
      .split("\n")
      .map((name) => name.trim())
      .filter(Boolean)
  );
  if (names.length < 2) return;

  lotteryRunning = true;
  // Ask for sound, but never wait on it. A browser that has not yet decided the
  // page is allowed to make noise leaves `resume()` pending indefinitely, and a
  // ceremony that waits for permission to be loud is a ceremony that never runs.
  unlockSounds();

  const order = [...names];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  const stage = document.createElement("div");
  stage.className = "lottery-stage";
  stage.innerHTML = `<div class="lottery-card">
    <p class="eyebrow">The lottery</p>
    <h2>Drawing the order</h2>
    <ol class="lottery-list">${order
      .map((_, index) => `<li class="lottery-slot" data-slot="${index}"><span class="lottery-pick">${index + 1}</span><span class="lottery-name">&mdash;</span></li>`)
      .join("")}</ol>
  </div>`;
  document.body.append(stage);

  const slots = [...stage.querySelectorAll(".lottery-slot")];
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  await wait(450);

  // Last seat first: the room counts down to who picks first.
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const slot = slots[index];
    slot.classList.add("drawn");
    slot.querySelector(".lottery-name").textContent = order[index];
    playLotteryBall(order.length - 1 - index, order.length);
    if (index === 0) slot.classList.add("first");
    await wait(index === 0 ? 200 : 620);
  }

  await wait(1100);
  stage.classList.add("closing");
  await wait(280);
  stage.remove();
  lotteryRunning = false;

  // The order the room just drew is the order the room drafts in.
  textarea.value = order.join("\n");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function renderSetup(setupError = "") {
  // Backing out of a club's room puts the house colors back on the way in, not
  // on the way out — nothing clears state.universe when a draft is abandoned.
  applyFranchisePalette(null);
  reactToDraftChange(null);
  // A local room starts from this screen, so its first queued nomination is
  // news. Joining an already-live online room never comes through setup and
  // remains quiet on its initial paint.
  heardAuctionLotKey = null;
  resetAppHandlers();
  const examples = setupExamples(state.seed);
  app.innerHTML = `<section class="setup">
    <header class="setup-hero">
      <div class="setup-hero-copy">
        <p class="eyebrow">MLB Showdown Draft and Simulator</p>
        <h1>It's draft day</h1>
      </div>
      <ul class="setup-features">
        <li class="setup-feature">
          <div class="setup-feature-card">${exampleCardHtml(examples.printed)}</div>
          <span class="setup-feature-name">Historical cards</span>
          <span class="setup-feature-note">Every real Showdown card, 2000&ndash;2005 &mdash; the printed charts and points.</span>
        </li>
        <li class="setup-feature">
          <div class="setup-feature-card">${exampleCardHtml(examples.historical)}</div>
          <span class="setup-feature-name">Real players</span>
          <span class="setup-feature-note">A century of big leaguers, rated by career, decade, or club.</span>
        </li>
        <li class="setup-feature">
          <div class="setup-feature-card" data-invented-example>${exampleCardHtml(examples.invented)}</div>
          <span class="setup-feature-name">Fictional</span>
          <span class="setup-feature-note">A made-up league, invented fresh from your seed.</span>
        </li>
      </ul>
    </header>
    <form id="setup-form" class="setup-grid">
      <div class="setup-col">
        <h2 class="setup-h2">The table</h2>
        <label>
          Managers
          <textarea name="managers" rows="5">${escapeHtml(state.managers.join("\n"))}</textarea>
          <small class="managers-note">
            <span>They pick in the order they are listed.</span>
            <button type="button" class="small lottery-button" data-action="lottery">&#127922; Roll for order</button>
          </small>
        </label>
        <fieldset class="pool-mode cpu-managers">
          <legend>Computer managers</legend>
          <div class="cpu-list" data-cpu-list>${renderCpuChoices(state.managers, state.cpuManagers)}</div>
          <small class="cpu-note">Checked managers play themselves — instant picks and sealed bids.</small>
        </fieldset>
        <div class="setup-row">
          <label>
            Seed
            <input name="seed" value="${escapeHtml(state.seed)}" />
          </label>
          <label>
            Starting pitchers per team
            <input name="startingPitchers" type="number" min="${MIN_STARTING_PITCHERS}" max="${MAX_STARTING_PITCHERS}" step="1" value="${state.startingPitchers}" />
            <small>Each team also drafts nine hitters and two relievers.</small>
          </label>
        </div>
        <fieldset class="pool-mode snake-clock-mode">
          <legend>Snake clock</legend>
          <label class="pool-option">
            <input type="radio" name="snakeClock" value="off" ${snakeClockMode(state) === "off" ? "checked" : ""} />
            <span><strong>Off</strong><small>Take as long as you like.</small></span>
          </label>
          <label class="pool-option">
            <input type="radio" name="snakeClock" value="pick" ${snakeClockMode(state) === "pick" ? "checked" : ""} />
            <span><strong>Per pick</strong><small>The same clock for every pick, and it resets each turn. Run it out and the pick is made for you.</small></span>
          </label>
          <div class="pool-suboptions snake-pick-suboptions" ${snakeClockMode(state) === "pick" ? "" : "hidden"}>
            <label class="auction-budget-field">
              Seconds per pick
              <select name="pickTimer">
                ${[[30, "30 seconds"], [60, "1 minute"], [90, "90 seconds"], [120, "2 minutes"], [180, "3 minutes"]]
                  .map(([seconds, label]) => `<option value="${seconds}" ${(state.pickTimerSeconds || 60) === seconds ? "selected" : ""}>${label}</option>`)
                  .join("")}
              </select>
            </label>
          </div>
          <label class="pool-option">
            <input type="radio" name="snakeClock" value="chess" ${snakeClockMode(state) === "chess" ? "checked" : ""} />
            <span><strong>Chess clock</strong><small>One bank of time for the whole draft, plus an increment paid back on every pick &mdash; the model the auction uses. Your clock runs only on your turn, so a long think in the third round is a short one in the tenth. Run the bank out and your picks are made for you from there.</small></span>
          </label>
          <div class="pool-suboptions snake-chess-suboptions" ${snakeClockMode(state) === "chess" ? "" : "hidden"}>
            <label class="auction-budget-field">
              Clock bank
              <input name="snakeBankSeconds" type="number" min="0" max="7200" step="30" value="${state.snakeTimer.bankSeconds}" />
              <small>Seconds each manager has for the whole draft.</small>
            </label>
            <label class="auction-budget-field">
              Per-pick increment
              <input name="snakeIncrementSeconds" type="number" min="0" max="600" step="5" value="${state.snakeTimer.incrementSeconds}" />
              <small>Seconds added back to the bank each time you make a pick.</small>
            </label>
          </div>
        </fieldset>
      </div>
      <div class="setup-col">
        <h2 class="setup-h2">The draft</h2>
      <fieldset class="pool-mode draft-type-mode">
        <legend>Draft type</legend>
        <label class="pool-option">
          <input type="radio" name="draftType" value="snake" ${state.draftType === "auction" ? "" : "checked"} />
          <span><strong>Snake draft</strong><small>Managers pick in turn and the order reverses every round.</small></span>
        </label>
        <label class="pool-option">
          <input type="radio" name="draftType" value="auction" ${state.draftType === "auction" ? "checked" : ""} />
          <span><strong>Auction draft</strong><small>Cards go up one at a time and everyone enters one sealed bid. The high bid wins and pays the second-highest bid plus one. Online too: bids stay hidden until the card sells.</small></span>
        </label>
        <div class="pool-suboptions auction-suboptions" ${state.draftType === "auction" ? "" : "hidden"}>
          <label class="pool-option">
            <input type="radio" name="nomination" value="manual" ${state.nomination === "random" ? "" : "checked"} />
            <span><strong>Managers nominate</strong><small>Each manager takes a turn putting a card of their choosing on the block.</small></span>
          </label>
          <label class="pool-option">
            <input type="radio" name="nomination" value="random" ${state.nomination === "random" ? "checked" : ""} />
            <span><strong>Random nomination</strong><small><span data-random-nomination-blurb>${escapeHtml(randomNominationBlurb(state.managers.length, state.startingPitchers))}</span> Nobody nominates: a hidden queue deals the cards out in random order. Buy as many as you can afford — there is no roster limit, only a budget. Anyone left short at the buzzer is filled out for free with the cheapest cards still on the board.</small></span>
          </label>
          <label class="auction-budget-field">
            Budget per manager ($)
            <input name="auctionBudget" type="number" min="${state.rosterSize * AUCTION_MIN_BID}" max="100000" step="${AUCTION_MIN_RAISE}" value="${state.auctionBudget}" />
            <small>Dollars, not card points &mdash; a card's printed points are what it is worth, and this is what you have to spend. A strong roster runs to roughly 5000 points, so $5000 bids like the classic Showdown cap.</small>
          </label>
          <label class="auction-budget-field">
            Pool review
            <input name="auctionReviewSeconds" type="number" min="0" max="3600" step="30" value="${state.auctionTimer.reviewSeconds}" />
            <small>Seconds to inspect the dealt pool before auction clocks start.</small>
          </label>
          <label class="auction-budget-field">
            Bid clock bank
            <input name="auctionBankSeconds" type="number" min="0" max="3600" step="30" value="${state.auctionTimer.bankSeconds}" />
            <small>Starting seconds each manager can spend entering sealed bids.</small>
          </label>
          <label class="auction-budget-field">
            Per-card increment
            <input name="auctionIncrementSeconds" type="number" min="0" max="120" step="1" value="${state.auctionTimer.incrementSeconds}" />
            <small>Seconds added to each active manager when a card comes up.</small>
          </label>
        </div>
      </fieldset>
      <fieldset class="pool-mode hide-points-mode">
        <legend>Points</legend>
        <label class="pool-option">
          <input type="checkbox" name="hidePoints" ${state.hidePoints ? "checked" : ""} />
          <span><strong>Blind draft</strong><small>Hide every card's printed points until it is drafted &mdash; the board, the card faces, and the picks all go numberless. Card colours stay, so you still see roughly how good a card is, just not its exact worth.</small></span>
        </label>
      </fieldset>
      ${renderUniverseFieldset(state.universe)}
      </div>
      <div class="setup-actions">
        ${setupError ? `<p class="form-error">${escapeHtml(setupError)}</p>` : ""}
        <div class="setup-buttons">
          <button type="submit">Start offline draft</button>
          <button type="button" data-action="create-online">Create online room</button>
          <button type="button" data-action="import-save" title="Open a room saved to a file">&#128193; Load a room</button>
          <!-- Empty, but it stays: this is the slot the online-room flow writes
               its progress and its errors into. -->
          <p class="online-note" data-online-note></p>
        </div>
        ${setupImportError ? `<p class="form-error">${escapeHtml(setupImportError)}</p>` : ""}
      </div>
    </form>
  </section>`;

  // The historical example wears a real face and club mark, same as it does on
  // the board; the printed one is already a scan and needs nothing.
  hydratePhotos(app);

  const setupForm = document.querySelector("#setup-form");
  // Only the selected card set shows its picker, and touching a picker
  // selects the set it belongs to — checking a decade means you want decades.
  const syncUniversePickers = () => {
    const pick = new FormData(setupForm).get("universe");
    setupForm.querySelector(".decade-checklist").hidden = pick !== "decades";
    setupForm.querySelector(".franchise-field").closest(".pool-suboptions").hidden = pick !== "franchise";
  };
  // The auction's own sub-options — who nominates, and the budget — belong to
  // the auction, so they only show when it is chosen; and reaching for one of
  // them says you want an auction, so it selects it.
  const syncAuctionOptions = () => {
    const auction = new FormData(setupForm).get("draftType") === "auction";
    setupForm.querySelector(".auction-suboptions").hidden = !auction;
  };
  // The snake has one clock or none, so each clock shows only its own settings —
  // and reaching for a setting says you want the clock it belongs to.
  const syncSnakeClockOptions = () => {
    const mode = new FormData(setupForm).get("snakeClock");
    setupForm.querySelector(".snake-pick-suboptions").hidden = mode !== "pick";
    setupForm.querySelector(".snake-chess-suboptions").hidden = mode !== "chess";
  };
  // The one button offers whichever move is left: check them all, or clear them.
  const syncDecadeToggle = () => {
    const boxes = [...setupForm.querySelectorAll('input[name="decade"]')];
    const toggle = setupForm.querySelector('[data-action="toggle-decades"]');
    if (!toggle || !boxes.length) return;
    toggle.textContent = boxes.every((box) => box.checked) ? "Uncheck all" : "Check all";
  };
  setupForm.addEventListener("change", (event) => {
    const owner = event.target.name === "decade" ? "decades"
      : event.target.name === "franchise" ? "franchise"
      : null;
    if (owner) setupForm.querySelector(`input[name="universe"][value="${owner}"]`).checked = true;
    if (owner || event.target.name === "universe") syncUniversePickers();
    // Ticking the last box off by hand turns the button back into "Check all".
    if (event.target.name === "decade") syncDecadeToggle();

    if (["nomination", "auctionBudget", "auctionReviewSeconds", "auctionBankSeconds", "auctionIncrementSeconds"].includes(event.target.name)) {
      setupForm.querySelector('input[name="draftType"][value="auction"]').checked = true;
    }
    if (["draftType", "nomination", "auctionBudget", "auctionReviewSeconds", "auctionBankSeconds", "auctionIncrementSeconds"].includes(event.target.name)) syncAuctionOptions();

    if (event.target.name === "pickTimer") {
      setupForm.querySelector('input[name="snakeClock"][value="pick"]').checked = true;
    }
    if (["snakeBankSeconds", "snakeIncrementSeconds"].includes(event.target.name)) {
      setupForm.querySelector('input[name="snakeClock"][value="chess"]').checked = true;
    }
    if (["snakeClock", "pickTimer", "snakeBankSeconds", "snakeIncrementSeconds"].includes(event.target.name)) syncSnakeClockOptions();
  });
  // The computer checkboxes track the manager list as it is typed.
  setupForm.addEventListener("input", (event) => {
    const form = new FormData(setupForm);
    // A hand-typed budget stops tracking the roster size — the manager has said
    // what they want, so a later roster change leaves it alone.
    if (event.target.name === "auctionBudget") {
      event.target.dataset.userEdited = "1";
      return;
    }
    if (event.target.name === "startingPitchers") {
      const startingPitchers = normalizeStartingPitchers(form.get("startingPitchers"));
      const rosterSize = rosterSizeForStartingPitchers(startingPitchers);
      // The default budget is $100 a slot, so it moves with the roster until a
      // manager overrides it.
      const budgetInput = setupForm.querySelector('input[name="auctionBudget"]');
      if (budgetInput) {
        budgetInput.min = rosterSize * AUCTION_MIN_BID;
        if (!budgetInput.dataset.userEdited) budgetInput.value = defaultAuctionBudget(rosterSize);
      }
      const blurb = setupForm.querySelector("[data-random-nomination-blurb]");
      const managerCount = dedupeManagerNames(String(form.get("managers")).split("\n").map((name) => name.trim()).filter(Boolean)).length;
      if (blurb) blurb.textContent = randomNominationBlurb(managerCount, startingPitchers);
      return;
    }
    if (event.target.name !== "managers") return;
    const checked = form.getAll("cpu").map(String);
    const names = dedupeManagerNames(
      String(form.get("managers"))
        .split("\n")
        .map((name) => name.trim())
        .filter(Boolean)
    );
    setupForm.querySelector("[data-cpu-list]").innerHTML = renderCpuChoices(names, checked);
    const blurb = setupForm.querySelector("[data-random-nomination-blurb]");
    if (blurb) blurb.textContent = randomNominationBlurb(names.length, normalizeStartingPitchers(form.get("startingPitchers")));
  });
  // Check all / uncheck all for the decade list: one button that flips to
  // whichever move is left. Reaching for it means you want decades, so it
  // selects that set the same way touching any other picker does.
  setupForm.addEventListener("click", (event) => {
    if (event.target.closest('[data-action="lottery"]')) {
      runLottery(setupForm);
      return;
    }
    if (event.target.closest('[data-action="import-save"]')) {
      pickSaveFile();
      return;
    }
    const toggle = event.target.closest('[data-action="toggle-decades"]');
    if (!toggle) return;
    const boxes = [...setupForm.querySelectorAll('input[name="decade"]')];
    const checkAll = !boxes.every((box) => box.checked);
    for (const box of boxes) box.checked = checkAll;
    syncDecadeToggle();
    setupForm.querySelector('input[name="universe"][value="decades"]').checked = true;
    syncUniversePickers();
  });
  // The invented example is dealt from the seed in the box, so it follows the
  // seed: type a new one and a different player turns up.
  setupForm.addEventListener("change", (event) => {
    if (event.target.name !== "seed") return;
    const slot = document.querySelector("[data-invented-example]");
    if (slot) slot.innerHTML = exampleCardHtml(setupExamples(event.target.value).invented);
  });
  setupForm.addEventListener("submit", (event) => {
    event.preventDefault();
    setupImportError = null;
    const form = new FormData(event.currentTarget);
    const managers = dedupeManagerNames(
      String(form.get("managers"))
        .split("\n")
        .map((name) => name.trim())
        .filter(Boolean)
    );
    state.seed = String(form.get("seed")).trim() || "showdown";
    state.managers = managers.length >= 2 ? managers : ["Home", "Away"];
    const cpuChecked = new Set(form.getAll("cpu").map(String));
    state.cpuManagers = state.managers.filter((name) => cpuChecked.has(name));
    state.startingPitchers = normalizeStartingPitchers(form.get("startingPitchers"));
    state.rosterSize = rosterSizeForStartingPitchers(state.startingPitchers);
    const universe = universeFromForm(form);
    if (!universe) {
      renderSetup("Check at least one decade, or pick a different card set.");
      return;
    }
    state.universe = universe;
    const mode = draftModeFromForm(form);
    state.draftType = mode.draftType;
    state.nomination = mode.nomination;
    state.hidePoints = mode.hidePoints;
    state.auctionBudget = normalizeAuctionBudget(form.get("auctionBudget"), state.rosterSize);
    state.auctionTimer = normalizeAuctionTimerInput(form);
    const snakeClock = snakeClockFromForm(form);
    state.pickTimerSeconds = snakeClock.pickTimerSeconds;
    state.snakeTimer = snakeClock.snakeTimer;
    const pool = buildDraftPool(state.universe, state.seed, {
      nomination: state.nomination,
      managerCount: state.managers.length,
      startingPitchers: state.startingPitchers
    });
    const poolError = draftPoolError(pool, state.universe, state.managers.length, state.nomination, state.startingPitchers);
    if (poolError) {
      renderSetup(poolError);
      return;
    }
    state.draft = createDraft(managerDescriptors(state.managers, state.cpuManagers), pool, state.rosterSize, state.seed, {
      draftType: state.draftType,
      startingPitchers: state.startingPitchers,
      nomination: state.nomination,
      hidePoints: state.hidePoints,
      budget: state.auctionBudget,
      timer: state.auctionTimer,
      snakeTimer: snakeTimerConfig(state, state.draftType)
    });
    if (isAuctionDraft(state.draft)) startAuctionReview(state.draft, draftNow());
    // The gun. Both clocks start when the board is dealt, not when somebody
    // first looks at it.
    else startSnakeClock(state.draft, draftNow());
    state.tournament = null;
    state.batch = null;
    state.view = null;
    state.selectedGameIndex = 0;
    state.selectedTeamName = state.managers[0];
    state.rosterManagerId = null;
    cpuPaused = false;
    advanceCpuTurns();
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
    const startingPitchers = normalizeStartingPitchers(form.get("startingPitchers"));
    const rosterSize = rosterSizeForStartingPitchers(startingPitchers);
    const universe = universeFromForm(form);
    const snakeClock = snakeClockFromForm(form);
    const pickTimer = snakeClock.pickTimerSeconds;
    const { draftType, nomination, hidePoints } = draftModeFromForm(form);
    const budget = normalizeAuctionBudget(form.get("auctionBudget"), rosterSize);
    const auctionTimer = normalizeAuctionTimerInput(form);
    const cpuChecked = form.getAll("cpu").map(String);
    if (!universe) {
      note.textContent = "Check at least one decade, or pick a different card set.";
      return;
    }
    button.disabled = true;
    note.textContent = "Creating online room…";
    try {
      const room = await createRoom({
        seed,
        startingPitchers,
        managers: managers.length >= 2 ? managers : ["Home", "Away"],
        universe,
        pickTimer,
        cpu: cpuChecked.filter((name) => managers.includes(name)),
        draftType,
        nomination,
        hidePoints,
        budget,
        auctionTimer,
        snakeTimer: snakeTimerConfig(snakeClock, draftType)
      });
      storeOnlineSeat(room.roomId, { hostToken: room.hostToken });
      location.href = `${location.pathname}?room=${encodeURIComponent(room.roomId)}`;
    } catch (error) {
      button.disabled = false;
      note.textContent = error.message;
    }
  });
}

function sealedBidLotKey(lot) {
  return `${lot.playerId}:${lot.round}`;
}

// Read the boxes as they stand before the board is torn down. The key rides on
// each box rather than being read off the draft, because by the time we repaint
// the draft has usually already moved on — and a bid typed for one card must
// never be handed to the next.
function captureSealedBids() {
  sealedBidStash = null;
  const inputs = app.querySelectorAll("[data-sealed-bid][data-manager-id]");
  if (!inputs.length) return;
  const active = document.activeElement;
  const values = new Map();
  let focused = null;
  for (const input of inputs) {
    if (input.value !== "") values.set(input.dataset.managerId, { value: input.value, lotKey: input.dataset.lotKey });
    if (input === active) focused = { managerId: input.dataset.managerId, lotKey: input.dataset.lotKey, caret: sealedBidCaret(input) };
  }
  if (!values.size && !focused) return;
  sealedBidStash = { values, focused };
}

function restoreSealedBids() {
  const stash = sealedBidStash;
  sealedBidStash = null;
  if (!stash) return;
  for (const input of app.querySelectorAll("[data-sealed-bid][data-manager-id]")) {
    const entry = stash.values.get(input.dataset.managerId);
    if (entry && entry.lotKey === input.dataset.lotKey) input.value = entry.value;
  }
  const focused = stash.focused;
  if (!focused) return;
  const input = app.querySelector(`[data-sealed-bid][data-manager-id="${CSS.escape(focused.managerId)}"]`);
  if (!input || input.dataset.lotKey !== focused.lotKey) return;
  input.focus();
  if (focused.caret !== null) {
    try {
      input.setSelectionRange(focused.caret, focused.caret);
    } catch {
      // A number box has no selection to set; focus alone leaves the caret at
      // the end of what was already typed, which is where it was.
    }
  }
}

// Only the masked box can say where the caret is: asking a number input for its
// selection throws rather than answering.
function sealedBidCaret(input) {
  try {
    return input.selectionStart;
  } catch {
    return null;
  }
}

function renderDraft() {
  // Here and not only in renderCurrentScreen: renderDraft is called directly
  // from a dozen places — the moment a room opens, and again on every pick —
  // so a palette hung off the dispatcher alone never runs for the screen that
  // most needs it.
  applyFranchisePalette(state.universe);
  // A blind draft has no points column to sort by, so the default "best points"
  // ordering — and any points sort a manager left set from an earlier draft —
  // falls back to the closest neutral one.
  if (pointsHidden() && state.filters.sort === "points") {
    state.filters.sort = "primary";
    state.filters.sortDirection = "desc";
  }
  // Typing into the card search re-renders the draft on every keystroke, and a
  // re-render replaces every node on the page — so the input the letter had just
  // gone into was thrown away, focus and caret with it, and the next letter had
  // nowhere to land. That is the whole reason the search only ever took ONE
  // letter. Remember where the caret was and put it back.
  const typing = captureTypingFocus();
  // A full innerHTML repaint snaps the window back to the top, so a bid landing
  // from another manager yanked you away from wherever you were reading. Keep
  // the scroll the way focus and the sealed bids are kept, and put it back below.
  const scrollTop = window.scrollY;
  // The card list scrolls inside its own tall pane, not the window — starring a
  // card repaints the page and reset that inner scroll to the top, throwing you
  // back to the best cards mid-scan. Remember it and put it back too.
  const listScrollTop = app.querySelector(".table-scroll-tall")?.scrollTop ?? 0;
  hideFloatingTips();
  const draft = state.draft;
  reactToDraftChange(draft);
  captureSealedBids();
  if (!state.online && syncAuctionTimer(draft, draftNow())) saveState();
  syncAuctionPositionFilter(draft);
  const auction = isAuctionDraft(draft);
  const reviewOpen = auction && !auctionReviewComplete(draft, draftNow());
  const queued = isRandomNomination(draft);
  const lot = auction ? draft.auction.lot : null;
  const current = draft.complete ? null : currentManager(draft);
  const historyTab = state.draftTab === "history";
  const boardOwner = watchlistOwner();
  // A board with nobody to own it (a spectator, a finished draft) has no tab.
  const boardTab = state.draftTab === "board" && Boolean(boardOwner);
  const boardCount = boardOwner
    ? bigBoard(boardOwner, draft).filter((entry) => !entry.gone).length
    : 0;
  const playerRows = historyTab || boardTab ? [] : draftVisiblePlayers(draft);
  const soldTags = draftSoldTags(draft);
  const focusManager = current ?? (state.selectedTeamName
    ? draft.managers.find((manager) => manager.name === state.selectedTeamName) ?? draft.managers[0]
    : draft.managers[0]);
  // Your board is the one you can actually do anything with, so it is the one
  // you get.
  const myManager = viewerManager(draft);
  const boardManager = myManager ?? focusManager;
  const dockViewerId = myManager?.id ?? focusManager?.id;

  const online = state.online;
  const paused = isDraftPaused(draft);
  // Pausing is the host's call, and on a hotseat everyone at the table is the
  // host. It only means anything before the draft is done.
  const canPause = !draft.complete && (!online || online.host);
  // A queued nomination isn't a move anyone made, so there is nothing to take
  // back while a card sits on the block — only a settled lot can be undone.
  const canUndo = !paused
    && (queued ? draft.pickNumber > 0 && !lot : auction ? draft.pickNumber > 0 || Boolean(lot) : draft.pickNumber > 0)
    && onlineCanUndo();
  const canAdvance = !draft.complete && !reviewOpen && !paused
    && (queued ? !online || online.host : onlineCanPickNow(current));
  const boardPanel = `<section class="panel draft-board-panel">
      <div class="game-tabs">
        <button class="game-tab ${state.draftTab === "available" ? "active" : ""}" data-action="draft-tab" data-tab="available">Available cards</button>
        ${boardOwner ? `<button class="game-tab ${boardTab ? "active" : ""}" data-action="draft-tab" data-tab="board">${escapeHtml(boardOwner.name)}'s board${boardCount ? ` <em>${boardCount}</em>` : ""}</button>` : ""}
        <button class="game-tab ${historyTab ? "active" : ""}" data-action="draft-tab" data-tab="history">Draft history</button>
      </div>
      ${historyTab
        ? renderDraftHistoryTable(draftHistory(draft), { hidePoints: pointsHidden() })
        : boardTab
        ? renderBigBoard(boardOwner, draft)
        : `<div class="section-head">
        <h2>Available cards</h2>
        ${renderFilters()}
      </div>
      ${renderNeedsStrip(boardManager, draft)}
      ${renderPlayerTable(playerRows, {
        mode: state.filters.type,
        hidePoints: pointsHidden(),
        starred: watchlistOwner() ? starredIds() : null,
        flagged: watchlistOwner() ? flaggedIds() : null,
        fillsNeed: rosterOpenings(boardManager, draft)?.fills ?? null,
        // An empty board under the watchlist filter means the list is empty, not
        // that the deck is — say which.
        emptyMessage: state.filters.starredOnly
          ? `${watchlistOwner()?.name ?? "This manager"} hasn't starred any ${state.filters.type === "pitcher" ? "pitchers" : "hitters"} yet. Tap a star to start a list.`
          : state.filters.flaggedOnly
          ? `${watchlistOwner()?.name ?? "This manager"} hasn't flagged any ${state.filters.type === "pitcher" ? "pitchers" : "hitters"} yet. Tap a flag to start a list.`
          : undefined,
        action: auction ? "nominate" : "pick",
        label: queued ? "Queued" : auction ? "Nominate" : "Pick",
        sort: state.filters.sort,
        sortDirection: state.filters.sortDirection,
        // Both boards are the whole deck at once, so they scroll in place
        // rather than pushing the rosters off the bottom of the screen.
        scroll: true,
        lotPlayerId: lot?.playerId ?? null,
        ownerOf: (player) => soldTags.get(player.id)
          ?? (draft.pickedIds.has(player.id) ? { label: "Gone", detail: "", title: "" } : null),
        canPick: (player) => {
          if (!current) return { ok: false, reason: "draft complete" };
          if (paused) return { ok: false, reason: "the draft is paused" };
          // Which of these ever come up is the room's one secret, so the board
          // says nothing about it: every card reads the same until it is called.
          if (queued) return { ok: false, reason: "the queue decides what comes up" };
          if (!onlineCanPickNow(current)) return { ok: false, reason: `${current.name} is ${auction ? "nominating" : "on the clock"}` };
          if (auction) return canNominatePlayer(draft, current, player, draftNow());
          return canPickPlayer(draft, current, player);
        }
      })}`}
    </section>`;
  const leadPanels = `${paused ? renderPausedPanel(draft) : ""}
    ${draft.complete ? renderDraftDone(draft) : ""}
    ${draft.complete ? renderAuctionBudgetSection(draft) : ""}
    ${renderDraftFocus(draft, focusManager, boardManager)}
    ${reviewOpen ? renderAuctionReviewPanel(draft) : ""}
    ${lot ? renderAuctionLotPanel(draft) : ""}
    ${auction && !draft.complete ? renderLastSalePanel(draft) : ""}`;
  const workspace = auction
    ? `<div class="auction-workspace">
        <div class="auction-workspace-main">${leadPanels}${boardPanel}</div>
        ${renderAuctionStatusPanel(draft)}
      </div>`
    : `${leadPanels}<div class="draft-board-full">${boardPanel}</div>`;

  app.innerHTML = `${online ? renderOnlineBanner(draft, current) : ""}
  <section class="toolbar">
    <button data-action="reset">${online ? "Leave room" : "New room"}</button>
    ${canPause ? `<button class="pause-button${paused ? " resume" : ""}" data-action="${paused ? "resume-draft" : "pause-draft"}">${paused ? "&#9654; Resume draft" : "&#10073;&#10073; Pause draft"}</button>` : ""}
    <button data-action="autopick" ${canAdvance ? "" : "disabled"}>${auction ? "Auto-run next lot" : "Auto-pick next"}</button>
    <button data-action="undo-pick" ${canUndo ? "" : "disabled"}>${auction && lot && !queued ? "Undo nomination" : "Undo last pick"}</button>
    ${auction && reviewOpen ? `<button data-action="complete-review" ${(online && !online.host) || paused ? "disabled" : ""}>Start auction now</button>` : ""}
    ${online && !online.host ? "" : `<button data-action="finish" ${draft.complete || reviewOpen || paused ? "disabled" : ""}>${auction ? "Auto-finish auction" : "Auto-finish draft"}</button>`}
    <button data-action="batch" ${canSimulate(draft) ? "" : "disabled"}>Sim ${DEFAULT_BATCH_RUNS} games</button>
    ${renderPlayGameControl(draft)}
    <button data-action="export-save" title="Save this room to a file you can keep, move, or send">&#128190; Save room</button>
    <button class="sound-toggle${isMuted() ? " muted" : ""}" data-action="toggle-sound" aria-pressed="${!isMuted()}" title="${isMuted() ? "Turn sound on" : "Turn sound off"}">${isMuted() ? "&#128264;" : "&#128266;"}</button>
    <span class="pick-clock" data-pick-timer hidden></span>
    ${/* A bare ?board reads the draft out of this browser's own storage, which is
          the whole draft on a hotseat and nothing at all in a room. The room's
          board hangs off the invite link up in the banner, so online there is
          only ever the one TV board link, and it is the one that works. */
      online ? "" : `<a class="tv-board-link" href="?board" target="_blank" rel="noopener" title="Read-only broadcast view for a second screen on this machine">&#128250; TV board</a>`}
  </section>
  ${workspace}
  ${renderRosterDock(draft, dockViewerId)}`;

  restoreSealedBids();
  restoreTypingFocus(typing);
  if (window.scrollY !== scrollTop) window.scrollTo(0, scrollTop);
  if (listScrollTop) {
    const list = app.querySelector(".table-scroll-tall");
    if (list) list.scrollTop = listScrollTop;
  }
  bindDraftActions();
  pickClockTick();
}

function syncAuctionPositionFilter(draft) {
  if (!isAuctionDraft(draft)) {
    filteredAuctionLotKey = null;
    return;
  }

  const player = auctionLotPlayer(draft);
  if (!player) {
    filteredAuctionLotKey = null;
    return;
  }

  const lotKey = `${state.online?.roomId ?? "local"}:${draft.seed}:${draft.auction.history.length}:${draft.auction.queueIndex ?? draft.pickNumber}:${player.id}`;
  if (lotKey === filteredAuctionLotKey) return;

  const filter = nominatedPlayerFilter(player);
  state.filters.type = filter.type;
  state.filters.position = filter.position;
  filteredAuctionLotKey = lotKey;
  saveState();
}

// The field the caret was in when the page was rebuilt under it, and where in
// the text it was sitting. Keyed on the filter's name rather than the node,
// because the node itself does not survive the render.
function captureTypingFocus() {
  const active = document.activeElement;
  const key = active?.dataset?.filter;
  if (!key) return null;
  // Only text fields have a caret to keep; a select just wants its focus back.
  const caret = typeof active.setSelectionRange === "function" && active.selectionStart !== null
    ? { start: active.selectionStart, end: active.selectionEnd }
    : null;
  return { key, caret };
}

function restoreTypingFocus(typing) {
  if (!typing) return;
  const field = document.querySelector(`[data-filter="${typing.key}"]`);
  if (!field) return;
  field.focus();
  if (typing.caret && typeof field.setSelectionRange === "function") {
    field.setSelectionRange(typing.caret.start, typing.caret.end);
  }
}

// The greyed-out rows on the draft board: who took each card, and the one
// number that is the story of the pick. In an auction that number is money —
// what the card sold for; in a snake draft it is the pick it went at. Keyed by
// player id so a full-deck repaint is one map lookup per row, not a scan.
function draftSoldTags(draft) {
  const auction = isAuctionDraft(draft);
  const tags = new Map();
  for (const pick of draftHistory(draft)) {
    const priced = Number.isFinite(pick.price);
    tags.set(pick.player.id, {
      label: pick.manager.name,
      round: auction ? pick.round : null,
      detail: auction ? (priced ? money(pick.price) : "") : `#${pick.pickNumber}`,
      title: auction
        ? (priced
            ? `${pick.manager.name} bought ${pick.player.name} for ${money(pick.price)}`
            : `${pick.manager.name} has ${pick.player.name}`)
        : `${pick.manager.name} took ${pick.player.name} with pick ${pick.pickNumber}`
    });
  }
  return tags;
}

function renderPausedPanel(draft) {
  const online = state.online;
  const host = !online || online.host;
  const auction = isAuctionDraft(draft);
  const left = draft.pausedRemainingMs;
  const clockLine = Number.isFinite(left) && left > 0
    ? ` The clock stopped at ${formatPickClock(left)} and will start again there.`
    : "";
  return `<section class="panel auction-paused">
    <div class="lot-header">
      <div>
        <p class="eyebrow">Paused</p>
        <h2>The draft is paused${auction && draft.auction.lot ? " — the card on the block is waiting" : ""}</h2>
        <p class="muted">${auction
          ? "Every clock is stopped. Nobody can nominate or bid until the host resumes."
          : `Every clock is stopped. Nobody picks until the host resumes.${clockLine}`}</p>
      </div>
    </div>
    ${host ? `<div class="lot-actions"><button data-action="resume-draft">&#9654; Resume draft</button></div>` : ""}
  </section>`;
}

function renderAuctionReviewPanel(draft) {
  return `<section class="panel auction-lot">
    <div class="lot-header">
      <div>
        <p class="eyebrow">Pool review</p>
        <h2>Inspect the cards before the auction clock starts</h2>
      </div>
      <div class="lot-bid-state">
        <span class="lot-bid-amount" data-auction-review-clock>${formatAuctionClock(auctionReviewRemainingMs(draft, draftNow()))}</span>
        <span class="lot-bid-holder">review remaining</span>
      </div>
    </div>
    <div class="lot-actions">
      <button data-action="complete-review" ${state.online && !state.online.host ? "disabled" : ""}>Skip review and start auction</button>
    </div>
  </section>`;
}

// A live online lot is only half-visible here: the amounts stay on the server
// until the card sells, so the replayed draft still shows the lot exactly as it
// was nominated. The room's lot event carries the public half — who is up, who
// has bid, the round, the tie — and this merges it back over the draft so the
// panel, the pick clock, and the bid checks see the real lot without ever
// seeing a number. Local drafts hold the whole lot already.
function liveLot(draft) {
  const lot = draft?.auction?.lot;
  if (!lot) return null;
  const shared = state.online?.lot;
  if (!shared || shared.playerId !== lot.playerId) return lot;
  return {
    ...lot,
    round: shared.round,
    tie: shared.tie,
    pending: [...shared.pending],
    clock: shared.clock ?? lot.clock,
    // Who has bid is all the room needs; the amounts arrive with the sale.
    bids: Object.fromEntries(shared.bidsIn.map((managerId) => [managerId, null]))
  };
}

// A read-only stand-in for the rules helpers that take a whole draft.
// The whole table's clocks, side by side — which is the point of a chess clock.
// A manager's bank is only interesting next to everybody else's: the man with
// four minutes left in round eight is in trouble, and the room should be able to
// see it coming. The one that is running is marked; a flag that has fallen stays
// visible, because his picks are being made for him from here.
function snakeClocksHtml(draft) {
  if (!snakeClockEnabled(draft)) return "";
  const now = draftNow();
  const onTheClock = draft.complete || isDraftPaused(draft) ? null : currentManager(draft);
  const chips = draft.managers
    .map((manager) => {
      const left = snakeTimeRemainingMs(draft, manager, now);
      const running = onTheClock?.id === manager.id;
      return `<span class="snake-clock-chip${running ? " running" : ""}${left <= 0 ? " flagged" : ""}">
        ${escapeHtml(manager.name)}
        <b data-snake-clock data-manager-id="${escapeHtml(manager.id)}"${left <= 0 ? ' class="flagged"' : ""}>${formatAuctionClock(left)}</b>
      </span>`;
    })
    .join("");
  return `<p class="snake-clocks">${chips}</p>`;
}

function liveDraft(draft) {
  const lot = liveLot(draft);
  if (!draft?.auction) return draft;
  const banks = state.online?.lot?.clock?.banks;
  if (lot === draft.auction.lot && !banks) return draft;
  return {
    ...draft,
    auction: {
      ...draft.auction,
      lot,
      ...(banks ? { clockBanks: { ...banks } } : {})
    }
  };
}

function renderAuctionBidEntry(draft) {
  const lot = liveLot(draft);
  if (!lot) {
    return `<p class="auction-side-empty">${draft.complete
      ? "The auction is complete."
      : auctionReviewComplete(draft, draftNow())
        ? "Waiting for the next card."
        : "Bidding opens when pool review ends."}</p>`;
  }
  if (isAuctionPaused(draft)) {
    return `<p class="auction-side-empty">Bidding is paused.</p>`;
  }

  const online = state.online;
  // Your own seat only online; a local hotseat keeps one box for every person
  // who still owes the sealed lot a bid.
  const canEnterFor = (manager) => !online || manager.id === online.managerId;
  const minBid = lot.round === 2 ? lot.tie.amount : AUCTION_MIN_BID;
  const lotKey = sealedBidLotKey(lot);
  const mine = draft.managers.filter((manager) => lot.pending.includes(manager.id) && canEnterFor(manager));
  if (!mine.length) {
    const viewerId = online?.managerId;
    const submitted = viewerId && viewerId in lot.bids;
    return `<p class="auction-side-empty">${submitted
      ? "Your sealed bid is in."
      : online
        ? "Watching this lot."
        : "All local bids are in."}</p>`;
  }

  return mine.map((manager) => {
    const isNominator = lot.round === 1 && manager.id === lot.nominatorId;
    const canPass = lot.round === 1 && !isNominator;
    const maxBid = Math.max(0, auctionMaxBid(draft, manager));
    // Down to the short strokes: when there is less than $200 of spendable budget
    // left, the fine-grained raise stops mattering — one button shoves the whole
    // stack (the most you can legally bid) into the box for you.
    const allIn = maxBid > 0 && auctionBudget(draft, manager) < 200
      ? `<button type="button" class="lot-all-in" data-action="seal-all-in" data-manager-id="${escapeHtml(manager.id)}" data-amount="${maxBid}" title="Load your whole remaining budget (${money(maxBid)}) into the box">All in &middot; ${money(maxBid)}</button>`
      : "";
    const error = lotEntryError?.managerId === manager.id ? lotEntryError.message : "";
    return `<div class="lot-entry auction-side-entry">
      <span class="lot-entry-name">${escapeHtml(manager.name)}${isNominator ? ` nominated &middot; min ${money(AUCTION_MIN_BID)}` : lot.round === 2 ? ` tie-break &middot; min ${money(minBid)}` : ""}</span>
      <div class="auction-side-entry-controls">
        ${state.maskBids
          ? `<input type="password" aria-label="${escapeHtml(manager.name)} sealed bid" data-sealed-bid data-manager-id="${escapeHtml(manager.id)}" data-lot-key="${escapeHtml(lotKey)}" inputmode="numeric" autocomplete="off" placeholder="${minBid}" />`
          : `<input type="number" aria-label="${escapeHtml(manager.name)} sealed bid" data-sealed-bid data-manager-id="${escapeHtml(manager.id)}" data-lot-key="${escapeHtml(lotKey)}" min="${canPass ? 0 : minBid}" max="${maxBid}" step="1" placeholder="${minBid}" />`}
        <button data-action="seal-bid" data-manager-id="${escapeHtml(manager.id)}">Bid</button>
        ${allIn}
        ${canPass ? `<button class="secondary-button" data-action="seal-pass" data-manager-id="${escapeHtml(manager.id)}">Pass</button>` : ""}
      </div>
      <span class="auction-side-max">Maximum ${money(maxBid)}</span>
      <label class="mask-toggle"><input type="checkbox" data-mask-bids ${state.maskBids ? "checked" : ""} /> Mask bids</label>
      ${error ? `<span class="warn">${escapeHtml(error)}</span>` : ""}
    </div>`;
  }).join("");
}

function auctionPlayersStillToCome(draft, lot) {
  if (isRandomNomination(draft)) {
    // The card on the block has already come up even though queueIndex moves
    // only after it settles.
    return Math.max(0, nominationQueueRemaining(draft) - (lot ? 1 : 0));
  }
  const target = draft.managers.length * draft.rosterSize;
  // Manual-auction nominations always sell because the nominator must open.
  return Math.max(0, target - draft.pickNumber - (lot ? 1 : 0));
}

function renderAuctionStatusPanel(draft) {
  const lot = liveLot(draft);
  const live = liveDraft(draft);
  const random = isRandomNomination(draft);
  const remaining = auctionPlayersStillToCome(draft, lot);
  const timed = auctionTimerEnabled(draft);
  const managers = draft.managers.map((manager) => {
    const clock = timed
      ? formatAuctionClock(auctionBidTimeRemainingMs(live, manager, draftNow()))
      : "untimed";
    const active = Boolean(lot?.pending?.includes(manager.id));
    return `<div class="auction-manager-status${active ? " active" : ""}">
      <strong>${escapeHtml(manager.name)}${manager.cpu ? ' <span class="cpu-tag">CPU</span>' : ""}</strong>
      <span class="auction-manager-budget">${money(auctionBudget(draft, manager))} left</span>
      <span class="auction-manager-clock${timed && clock === "0:00" ? " flagged" : ""}"${timed ? ` data-auction-clock data-manager-id="${escapeHtml(manager.id)}"` : ""}>${clock}</span>
    </div>`;
  }).join("");
  const minimums = random
    ? `<div class="auction-side-section">
        <h3>Guaranteed still to come</h3>
        <div class="nomination-minimums auction-side-minimums" aria-label="Guaranteed primary-position nominations still to come">
          ${guaranteedNominationMinimums(draft).map(({ position, minimum }) =>
            `<span class="nomination-minimum"><strong>${escapeHtml(position)}</strong> min ${minimum}</span>`
          ).join("")}
        </div>
      </div>`
    : "";

  return `<aside class="panel auction-status-panel" aria-label="Auction desk">
    <p class="eyebrow">Auction desk</p>
    <div class="auction-remaining">
      <strong>${remaining}</strong>
      <span>players still to come${lot ? " after this lot" : ""}</span>
    </div>
    <div class="auction-side-section auction-side-bid">
      <h3>${lot?.round === 2 ? "Tie-break bid" : "Enter bid"}</h3>
      ${renderAuctionBidEntry(draft)}
    </div>
    <div class="auction-side-section">
      <h3>Budget &amp; time</h3>
      <div class="auction-manager-statuses">${managers}</div>
    </div>
    ${minimums}
  </aside>`;
}

function renderAuctionLotPanel(draft) {
  const lot = liveLot(draft);
  const player = auctionLotPlayer(draft);
  if (!player || !lot) return "";
  const online = state.online;
  const nominator = draft.managers.find((manager) => manager.id === lot.nominatorId);
  const participants = draft.managers.filter((manager) =>
    lot.round === 2 ? lot.tie.managerIds.includes(manager.id) : manager.id in lot.bids || lot.pending.includes(manager.id)
  );

  const bidderChips = participants
    .map((manager) => {
      const waiting = lot.pending.includes(manager.id);
      const timedOut = Boolean(lot.clock?.timedOut?.includes(manager.id));
      const status = timedOut ? "timed out (0)" : waiting ? "still to bid" : "bid in";
      return `<div class="lot-bidder ${waiting ? "" : "high-bidder"}">
        <strong>${escapeHtml(manager.name)}${manager.cpu ? ' <span class="cpu-tag">CPU</span>' : ""}</strong>
        <em>${status}</em>
      </div>`;
    })
    .join("");

  const tieNote = lot.round === 2
    ? `<p class="lot-tie-note">Tied at ${lot.tie.amount} — the tied managers rebid sealed. Another tie is a coin flip at that price.</p>`
    : lot.nominatorId
      ? `<p class="lot-tie-note muted">Bids stay hidden until the card sells; the winner pays the second-highest bid + 1.</p>`
      : `<p class="lot-tie-note muted">Nobody nominated this card, so nobody has to open. Bids stay hidden until it sells; the winner pays the second-highest bid + 1. If the whole room passes, the card goes back on the board unsold.</p>`;

  return `<section class="panel auction-lot">
    <div class="lot-header">
      <div>
        <p class="eyebrow">${lot.round === 2 ? "Tie break" : "On the block"} &middot; ${nominator ? `nominated by ${escapeHtml(nominator.name)}` : "dealt by the queue"}</p>
        <h2>${renderPlayerPreviewName(player, player.name, "strong", "lot-player-name")}
          <span class="lot-player-meta">${escapeHtml(playerPosition(player))}${pointsHidden() ? "" : ` &middot; ${player.points} pts`}</span></h2>
      </div>
    </div>
    ${tieNote}
    <div class="lot-bidders">${bidderChips}</div>
    ${allowCancelLot(draft) ? `<div class="lot-actions"><button data-action="cancel-lot" ${online && !online.host ? "disabled" : ""}>Cancel nomination</button></div>` : ""}
  </section>`;
}

// Online, whether a bid has landed is only knowable from the live lot — the
// replayed draft still shows the nomination as untouched.
function allowCancelLot(draft) {
  return canCancelLot(liveDraft(draft));
}

// After a sale the sealed bids get revealed alongside the price paid.
function renderLastSalePanel(draft) {
  const entry = draft.auction.history.at(-1);
  if (!entry?.bids) return "";
  const player = draft.pool.find((item) => item.id === entry.playerId);
  if (!player) return "";
  const revealed = draft.managers
    .filter((manager) => manager.id in entry.bids)
    .map((manager) => `${escapeHtml(manager.name)} ${entry.bids[manager.id] > 0 ? entry.bids[manager.id] : "pass"}`)
    .join(" &middot; ");

  // A card the whole room passed on. It stays on the board, and the sweep may
  // yet hand it to whoever ends the night short.
  if (entry.passed) {
    return `<section class="panel last-sale">
      <p><strong>${escapeHtml(player.name)}</strong> went unsold — the whole room passed. He stays on the board.</p>
    </section>`;
  }

  const winner = draft.managers.find((manager) => manager.id === entry.managerId);
  if (!winner) return "";
  return `<section class="panel last-sale">
    <p><strong>${escapeHtml(player.name)}</strong> sold to <strong>${escapeHtml(winner.name)}</strong> for <strong>${money(entry.price)}</strong> — bids revealed: ${revealed}</p>
  </section>`;
}

function bindDraftActions() {
  app.onclick = (event) => {
    const orderTile = event.target.closest("[data-order-tile]");
    if (orderTile) {
      const managerId = orderTile.dataset.managerId;
      if (!canManageRoster(managerId)) return;
      if (selectedOrderMove && selectedOrderMove.managerId === managerId
        && selectedOrderMove.playerId !== orderTile.dataset.playerId) {
        moveBattingOrder(managerId, selectedOrderMove.playerId, Number(orderTile.dataset.orderIndex));
        selectedOrderMove = null;
        invalidateBatch();
        saveState();
        renderDraft();
        return;
      }
      selectedOrderMove = selectedOrderMove?.playerId === orderTile.dataset.playerId
        ? null
        : { managerId, playerId: orderTile.dataset.playerId };
      renderDraft();
      return;
    }
    const lineupSlot = event.target.closest("[data-lineup-slot]");
    if (lineupSlot) {
      handleLineupSlotClick(lineupSlot);
      return;
    }

    // Starring is a note to yourself, not a move in the draft: it changes no
    // turn, sends nothing to the room, and costs nobody their card.
    const starButton = event.target.closest("button[data-action='toggle-star']");
    if (starButton) {
      toggleStar(starButton.dataset.playerId);
      saveState();
      renderDraft();
      return;
    }

    // A flag is a second note to yourself, alongside the star: same idea, its own
    // list, so you can keep two shortlists on the same board.
    const flagButton = event.target.closest("button[data-action='toggle-flag']");
    if (flagButton) {
      toggleFlag(flagButton.dataset.playerId);
      saveState();
      renderDraft();
      return;
    }

    const boardMove = event.target.closest("button[data-action='board-up'], button[data-action='board-down']");
    if (boardMove) {
      moveOnBoard(boardMove.dataset.playerId, boardMove.dataset.action === "board-up" ? -1 : 1);
      saveState();
      renderDraft();
      return;
    }

    const starFilter = event.target.closest("button[data-action='toggle-starred-only']");
    if (starFilter) {
      state.filters.starredOnly = !state.filters.starredOnly;
      if (state.filters.starredOnly) state.filters.flaggedOnly = false;
      saveState();
      renderDraft();
      return;
    }

    const flagFilter = event.target.closest("button[data-action='toggle-flagged-only']");
    if (flagFilter) {
      state.filters.flaggedOnly = !state.filters.flaggedOnly;
      if (state.filters.flaggedOnly) state.filters.starredOnly = false;
      saveState();
      renderDraft();
      return;
    }

    const filterButton = event.target.closest("button[data-filter]");
    if (filterButton) {
      state.filters[filterButton.dataset.filter] = filterButton.dataset.filterValue;
      if (filterButton.dataset.filter === "type") {
        state.filters.position = "all";
        state.filters.sort = pointsHidden() ? "primary" : "points";
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
    if (action === "toggle-dock") {
      state.rosterDock = state.rosterDock === "collapsed" ? "open" : "collapsed";
      saveState();
      renderDraft();
      return;
    }
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
      const tab = button.dataset.tab;
      state.draftTab = tab === "history" || tab === "board" ? tab : "available";
      saveState();
      renderDraft();
      return;
    }
    if (action === "complete-review") {
      if (state.online) {
        sendOnlineAction({ type: "complete-review" });
        return;
      }
      completeAuctionReview(state.draft, draftNow());
      afterLocalDraftAction();
      return;
    }
    if (action === "heat-by") {
      state.heatBy = button.dataset.heatBy === "points" ? "points" : "price";
      saveState();
      renderCurrentScreen();
      return;
    }
    if (action === "export-save") {
      exportSave();
      return;
    }
    if (action === "copy-recap") {
      const text = recapText(state.draft);
      navigator.clipboard?.writeText(text).then(
        () => {
          button.textContent = "Copied";
          setTimeout(() => renderDraft(), 1200);
        },
        () => {
          button.textContent = "Couldn't copy";
        }
      );
      return;
    }
    if (action === "seat") {
      const managerId = button.dataset.managerId;
      const cpu = button.dataset.cpu === "1";
      if (state.online) {
        sendOnlineAction({ type: "seat", managerId, cpu });
        return;
      }
      setManagerCpu(state.draft, managerId, cpu);
      // Handing a seat over should make the computer take its turn if the clock
      // is already sitting on it.
      afterLocalDraftAction();
      return;
    }
    if (action === "pause-draft" || action === "resume-draft") {
      if (button.disabled) return;
      const pausing = action === "pause-draft";
      const snake = !isAuctionDraft(state.draft);
      const left = snake && pausing && state.pickTimerSeconds
        ? Math.max(0, pickClockDeadline - Date.now())
        : null;
      if (state.online) {
        sendOnlineAction({ type: pausing ? "pause" : "resume", remainingMs: left });
        return;
      }
      if (pausing) {
        if (snake) pauseSnake(state.draft, left, draftNow());
        else pauseAuction(state.draft, draftNow());
      } else if (snake) {
        resumeSnake(state.draft);
        restartPickClock(state.draft);
      } else {
        resumeAuction(state.draft, draftNow());
      }
      // Not afterLocalDraftAction: pausing must not wake the computer managers
      // up, and resuming should let them carry on from where they stopped.
      if (pausing) {
        saveState();
        renderDraft();
      } else {
        afterLocalDraftAction();
      }
      return;
    }
    if (action === "pick") {
      if (button.disabled) return;
      const playerId = button.dataset.playerId;
      if (state.online) {
        const current = currentManager(state.draft);
        if (hostActingForOthers(current)) {
          confirmHostAction(state.draft, current, playerId, { verb: "Pick", outcome: "goes onto their roster" })
            // The clock does not stop for the dialog. By the time the host says
            // yes the seat may have timed out or the card may be gone; the room
            // is the one that rules on that, so send it and let it answer.
            .then((yes) => { if (yes) sendOnlineAction({ type: "pick", playerId }); });
          return;
        }
        sendOnlineAction({ type: "pick", playerId });
        return;
      }
      pickPlayer(state.draft, playerId);
      selectedLineupMove = null;
      invalidateBatch();
      afterLocalDraftAction();
    }
    if (action === "nominate") {
      if (button.disabled) return;
      lotEntryError = null;
      const playerId = button.dataset.playerId;
      if (state.online) {
        const current = currentManager(state.draft);
        if (hostActingForOthers(current)) {
          confirmHostAction(state.draft, current, playerId, { verb: "Nominate", outcome: "goes on the block" })
            .then((yes) => { if (yes) sendOnlineAction({ type: "nominate", playerId }); });
          return;
        }
        sendOnlineAction({ type: "nominate", playerId });
        return;
      }
      nominatePlayer(state.draft, playerId, draftNow());
      afterLocalDraftAction();
    }
    if (action === "seal-all-in") {
      if (button.disabled) return;
      const managerId = button.dataset.managerId;
      const input = app.querySelector(`[data-sealed-bid][data-manager-id="${CSS.escape(managerId)}"]`);
      // Load the box, don't fire it — the manager still gets to look at the
      // number and press Submit (or think better of it) themselves.
      if (input) {
        input.value = button.dataset.amount;
        input.focus();
      }
      return;
    }
    if (action === "seal-bid" || action === "seal-pass") {
      if (button.disabled) return;
      const managerId = button.dataset.managerId;
      const manager = state.draft.managers.find((item) => item.id === managerId);
      // Several bid boxes can be on screen at once, so take the one belonging
      // to the manager whose button was pressed.
      const input = app.querySelector(`[data-sealed-bid][data-manager-id="${CSS.escape(managerId)}"]`);
      // An empty box is not a bid of zero. Submitting nothing used to pass the
      // card — the one button that spends your budget quietly gave the card
      // away instead. Passing is what the Pass button is for.
      if (action === "seal-bid" && !input?.value.trim()) return;
      const amount = action === "seal-pass" ? 0 : Math.round(Number(input?.value));
      lotEntryError = null;
      const legality = canPlaceSealedBid(liveDraft(state.draft), manager, amount, draftNow());
      if (!legality.ok) {
        lotEntryError = { managerId, message: legality.reason };
        renderDraft();
        return;
      }
      if (state.online) {
        sendOnlineAction({ type: "seal-bid", managerId, amount });
        return;
      }
      placeSealedBid(state.draft, managerId, amount, draftNow());
      selectedLineupMove = null;
      invalidateBatch();
      afterLocalDraftAction();
    }
    if (action === "cancel-lot") {
      if (button.disabled) return;
      lotEntryError = null;
      if (state.online) {
        sendOnlineAction({ type: "cancel-lot" });
        return;
      }
      cancelLot(state.draft);
      saveState();
      renderDraft();
    }
    if (action === "autopick") {
      if (button.disabled) return;
      if (state.online) {
        // Auto in an online auction only puts a card on the block: autopick
        // would run the whole lot, entering bids for managers who never made
        // them. Everyone still bids for themselves.
        sendOnlineAction({ type: isAuctionDraft(state.draft) ? "auto-nominate" : "autopick" });
        return;
      }
      autopickTurn(state.draft);
      selectedLineupMove = null;
      invalidateBatch();
      afterLocalDraftAction();
    }
    if (action === "undo-pick") {
      if (button.disabled) return;
      if (state.online) {
        sendOnlineAction({ type: "undo" });
        return;
      }
      let undone = undoLastPick(state.draft);
      if (isAuctionDraft(state.draft)) {
        // Hold computer moves so the undone lot isn't instantly redone.
        cpuPaused = true;
      } else {
        // Unwind through computer picks so the undo lands on a human's turn.
        while (undone?.manager?.cpu) undone = undoLastPick(state.draft);
      }
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
      afterLocalDraftAction();
    }
    if (action === "batch") {
      requestBatchRun(DEFAULT_BATCH_RUNS);
    }
    if (action === "roster-tab") {
      state.rosterTab = button.dataset.tab === "order" ? "order" : "roster";
      selectedLineupMove = null;
      selectedOrderMove = null;
      saveState();
      renderDraft();
      return;
    }
    if (action === "roster-manager") {
      state.rosterManagerId = button.dataset.managerId ?? null;
      selectedLineupMove = null;
      selectedOrderMove = null;
      saveState();
      renderDraft();
      return;
    }
    if (action === "adopt-manager") {
      const manager = findDraftManager(button.dataset.managerId);
      if (manager) {
        // Claiming a seat is an identity, not a takeover: the team can stay on
        // CPU auto-pick (use "Hand back" to drive it), but it is now yours to
        // set a lineup for, play as, and read as "you" everywhere.
        state.myManagerId = manager.id;
        state.selectedTeamName = manager.name;
        state.rosterManagerId = manager.id;
        saveState();
        renderDraft();
      }
      return;
    }
    if (action === "play-game") {
      startGame(app.querySelector("[data-play-opponent]")?.value);
    }

  };

  app.oninput = (event) => {
    // The sealed-bid input only commits via its buttons; typing must not
    // trigger a re-render that would steal focus.
    if (event.target.closest("[data-sealed-bid]")) return;
    const maskToggle = event.target.closest("[data-mask-bids]");
    if (maskToggle) {
      state.maskBids = Boolean(maskToggle.checked);
      saveState();
      renderDraft();
      return;
    }
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
    const tile = event.target.closest("[data-order-tile]");
    if (tile) {
      if (!canManageRoster(tile.dataset.managerId)) {
        event.preventDefault();
        return;
      }
      hideHoverCard();
      draggedOrderMove = { managerId: tile.dataset.managerId, playerId: tile.dataset.playerId };
      selectedOrderMove = draggedOrderMove;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", tile.dataset.playerId);
      return;
    }
    const slot = event.target.closest("[data-lineup-slot][data-player-id]");
    if (!slot) return;
    hideHoverCard();
    if (!canManageRoster(slot.dataset.managerId)) {
      event.preventDefault();
      return;
    }
    const player = findRosterPlayer(slot.dataset.managerId, slot.dataset.playerId);
    if (!player) return;
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
    const tile = event.target.closest("[data-order-tile]");
    if (tile && draggedOrderMove && tile.dataset.managerId === draggedOrderMove.managerId) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      return;
    }
    const slot = event.target.closest("[data-lineup-slot]");
    if (!slot || !draggedLineupMove) return;
    if (slot.dataset.managerId !== draggedLineupMove.managerId) return;
    if (!canMoveLineupPlayer(draggedLineupMove.managerId, draggedLineupMove.playerId, slot.dataset.slotLabel)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  app.ondrop = (event) => {
    const tile = event.target.closest("[data-order-tile]");
    if (tile && draggedOrderMove && tile.dataset.managerId === draggedOrderMove.managerId) {
      event.preventDefault();
      moveBattingOrder(draggedOrderMove.managerId, draggedOrderMove.playerId, Number(tile.dataset.orderIndex));
      draggedOrderMove = null;
      selectedOrderMove = null;
      invalidateBatch();
      saveState();
      renderDraft();
      return;
    }
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
    if (draggedOrderMove) selectedOrderMove = null;
    draggedLineupMove = null;
    draggedOrderMove = null;
  };
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
    const previewTarget = event.target.closest("[data-preview-card]");
    if (!previewTarget) return;
    hoveredPreviewRow = previewTarget;
    showHoverCard(previewTarget, event.clientX, event.clientY);
  };

  const handlePointerMove = (event) => {
    const chartZone = event.target.closest?.("[data-wp-value]");
    if (chartZone) showChartTip(chartZone, event.clientX, event.clientY);
    else hideChartTip();
    const chartPoint = event.target.closest?.("[data-point]");
    if (chartPoint) showPointTip(chartPoint, event.clientX, event.clientY);
    else hidePointTip();
    if (!hoveredPreviewRow) return;
    showHoverCard(hoveredPreviewRow, event.clientX, event.clientY);
  };

  const handlePointerOut = (event) => {
    if (event.target.closest?.("[data-wp-value]") && !(event.relatedTarget instanceof Element && event.relatedTarget.closest("[data-wp-value]"))) {
      hideChartTip();
    }
    if (event.target.closest?.("[data-point]") && !(event.relatedTarget instanceof Element && event.relatedTarget.closest("[data-point]"))) {
      hidePointTip();
    }
    const previewTarget = event.target.closest("[data-preview-card]");
    if (!previewTarget || (event.relatedTarget instanceof Node && previewTarget.contains(event.relatedTarget))) return;
    hoveredPreviewRow = null;
    hideHoverCard();
  };

  const handleFocusIn = (event) => {
    const chartPoint = event.target.closest?.("[data-point]");
    if (chartPoint) {
      const rect = chartPoint.getBoundingClientRect();
      showPointTip(chartPoint, rect.left + rect.width / 2, rect.top);
    }
    const previewTarget = event.target.closest("[data-preview-card]");
    if (!previewTarget) return;
    const rect = previewTarget.getBoundingClientRect();
    showHoverCard(previewTarget, rect.right, rect.top + rect.height / 2);
  };

  const handleFocusOut = (event) => {
    if (!event.relatedTarget?.closest?.("[data-point]")) hidePointTip();
    if (event.relatedTarget?.closest?.("[data-preview-card]")) return;
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
  hideChartTip();
  hidePointTip();
}

function invalidateBatch() {
  state.batch = null;
  state.batchGamePage = 0;
  state.batchGameIndex = null;
  if (state.view === "batch") state.view = null;
}

function managerDescriptors(names, cpuNames) {
  const cpuSet = new Set(cpuNames ?? []);
  return names.map((name) => ({ name, cpu: cpuSet.has(name) }));
}

// Once every roster is legal, you can stop simulating and go play one. The
// team you play is whichever roster the board is focused on; the select picks
// who you play against.
function renderPlayGameControl(draft) {
  if (!canSimulate(draft)) {
    return `<button data-action="play-game" disabled>Play a game</button>`;
  }
  const you = state.selectedTeamName ?? draft.managers[0].name;
  const opponents = draft.managers.filter((manager) => manager.name !== you);
  return `<span class="play-game-control">
    <button data-action="play-game">Play a game as ${escapeHtml(you)}</button>
    <label>vs
      <select data-play-opponent>
        ${opponents.map((manager) => `<option value="${escapeHtml(manager.name)}">${escapeHtml(manager.name)}</option>`).join("")}
      </select>
    </label>
  </span>`;
}

function renderCpuChoices(names, cpuNames) {
  const cpuSet = new Set(cpuNames ?? []);
  if (!names.length) return `<small class="cpu-note">Add managers above first.</small>`;
  return names
    .map(
      (name) => `<label class="cpu-option">
        <input type="checkbox" name="cpu" value="${escapeHtml(name)}" ${cpuSet.has(name) ? "checked" : ""} />
        <span>${escapeHtml(name)}</span>
      </label>`
    )
    .join("");
}

function dedupeManagerNames(names) {
  const seen = new Map();
  return names.map((name) => {
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    return count === 0 ? name : `${name} ${count + 1}`;
  });
}

// ---- The interactive game ----------------------------------------------------
//
// One game between two drafted rosters, played a plate appearance at a time
// on the same engine the adventure's battles run on. You are the away team
// (you're the one who travelled); the opponent's dugout is run by the
// balanced AI profile, so its arms tire and its runners go under exactly the
// rules yours do.
function startGame(opponentName) {
  const draft = state.draft;
  if (!draft || !canSimulate(draft)) return;
  const you = draft.managers.find((manager) => manager.name === state.selectedTeamName) ?? draft.managers[0];
  const them = draft.managers.find((manager) => manager.name === opponentName)
    ?? draft.managers.find((manager) => manager.id !== you.id);
  if (!them) return;
  const battle = createBattle({
    playerManager: you,
    npcManager: them,
    trainer: { name: them.name, aiProfile: "balanced" },
    seed: `${state.seed}:game:${you.id}-vs-${them.id}:${newBatchSalt()}`
  });
  liveGame = createGame({ battle, playerName: you.name, opponentName: them.name });
  renderCurrentScreen();
}

function renderLiveGame() {
  resetAppHandlers();
  renderGame(app, liveGame, {
    onExit: () => {
      liveGame = null;
      renderCurrentScreen();
    },
    onRerender: renderCurrentScreen
  });
}

// Every batch run gets a fresh salt so its seeded games differ from the
// last run's; online rooms carry the salt inside the shared action so every
// client still simulates the identical games.
function requestBatchRun(runs) {
  if (state.online) {
    sendOnlineAction({ type: "batch", runs: normalizeBatchRuns(runs), salt: newBatchSalt() });
    return;
  }
  startBatchRun(runs, { salt: newBatchSalt() });
}

function newBatchSalt() {
  return Date.now().toString(36);
}

function startBatchRun(runs, options = {}) {
  if (!state.draft || !canSimulate(state.draft)) return;
  const count = normalizeBatchRuns(runs);
  const teams = state.draft.managers.map((manager) => buildTeam(manager, { optimize: true }));
  const teamNames = teams.map((team) => team.name);
  const batchState = createBatchState(teams);
  const calibration = createWinExpectancyCalibration();
  const seed = options.salt ? `${state.seed}-batch-${options.salt}` : `${state.seed}-batch`;
  const token = ++batchRunToken;
  const gamesPerFrame = Math.max(2, Math.round(count / 90));
  const plotStart = Math.max(4, Math.round(count * 0.02));
  const series = [];
  let completed = 0;
  let skipRequested = Boolean(options.instant);
  // The race has two speeds and an exit: watch it, fast forward through the
  // dull middle innings of the season, or skip straight to the table.
  let fastForwarding = false;

  resetAppHandlers();
  hideHoverCard();
  app.onclick = (event) => {
    if (event.target.closest("button[data-action=batch-skip]")) skipRequested = true;
    if (event.target.closest("button[data-action=batch-fast-forward]")) fastForwarding = true;
  };

  const pushFrame = () => {
    if (completed < plotStart) return null;
    const snapshot = batchProgressSnapshot(batchState);
    const shareByTeam = new Map(snapshot.rows.map((row) => [row.team, row.share]));
    series.push({ n: completed, shares: teamNames.map((name) => shareByTeam.get(name) ?? 0) });
    return snapshot;
  };

  // A run too short to ever clear plotStart (a handful of games) samples fewer
  // than the two points a line needs. Rather than strand a finished season on
  // the placeholder, give it an honest two-point line: even win% at the first
  // game, the final standings at the last.
  const raceSeries = () => {
    if (series.length >= 2) return downsampleSeries(series);
    const snapshot = batchProgressSnapshot(batchState);
    const shareByTeam = new Map(snapshot.rows.map((row) => [row.team, row.share]));
    const finalShares = teamNames.map((name) => shareByTeam.get(name) ?? 0);
    const parity = teamNames.map(() => 1 / Math.max(1, teamNames.length));
    return [
      { n: 1, shares: parity },
      { n: Math.max(2, count), shares: finalShares }
    ];
  };

  const finalize = (scoredState) => {
    if (token !== batchRunToken || !state.draft) return;
    state.tournament = null;
    state.batch = {
      runs: count,
      seed,
      summary: summarizeBatch(scoredState),
      race: { teamNames, totalRuns: count, series: raceSeries() }
    };
    state.view = "batch";
    state.batchStatsTab = "overview";
    state.batchGamePage = 0;
    state.batchGameIndex = null;
    saveState();
    renderBatch();
  };

  const beginWpaScoring = () => {
    if (token !== batchRunToken || !state.draft) return;
    const winExpectancyModel = finalizeWinExpectancyCalibration(calibration);
    const scoredState = createBatchState(teams, { winExpectancyModel });
    const finalSnapshot = batchProgressSnapshot(batchState);
    const scoringGamesPerFrame = Math.max(100, Math.round(count / 20));
    let scored = 0;

    const scoreStep = () => {
      if (token !== batchRunToken || !state.draft) return;
      const size = skipRequested
        ? count - scored
        : Math.min(
          fastForwarding ? scoringGamesPerFrame * 4 : scoringGamesPerFrame,
          count - scored
        );
      runBatchChunk(scoredState, teams, seed, scored, size, { winExpectancyModel });
      scored += size;
      if (scored >= count) {
        finalize(scoredState);
        return;
      }
      renderBatchRace({
        snapshot: finalSnapshot,
        series,
        completed: scored,
        total: count,
        teamNames,
        fastForwarding,
        phase: "wpa"
      });
      setTimeout(scoreStep, fastForwarding ? 0 : 16);
    };

    renderBatchRace({
      snapshot: finalSnapshot,
      series,
      completed: 0,
      total: count,
      teamNames,
      fastForwarding,
      phase: "wpa"
    });
    setTimeout(scoreStep, skipRequested ? 0 : 50);
  };

  // Skip the animation, not the race. Running the whole remainder as one
  // synchronous chunk froze the page long enough to trip Chrome's "Page
  // Unresponsive" on slower machines — and did it with no feedback on the
  // {instant:true} online-resync path, which re-fires on every reconnect. So
  // slice the remainder into small chunks and yield the main thread between
  // them: the page stays responsive, and the "How the race unfolded" chart
  // still gets a real curve from the per-slice samples (a one-point series
  // can't draw a line). A chunk is capped near 200 games so no single task
  // blocks for more than a frame or two even on modest hardware. Once the race
  // itself is complete we hand off to the WPA scoring pass.
  // Run the rest of the season without the animation, but without freezing the
  // page either. Split the remainder into a handful of "pumps" that each
  // simulate a block of games and then yield once with setTimeout, so input and
  // paint get a slot before the next block. The yield COUNT is deliberately
  // small and fixed: a hidden tab throttles setTimeout to ~1s, so dozens of
  // tiny yields would crawl — a dozen keeps the whole skip snappy in the
  // foreground and merely brief in the background, while each block stays short
  // enough (a fraction of the ~1.4s full sim) to never read as a freeze. Inside
  // a pump the work is sub-chunked so pushFrame() samples the "How the race
  // unfolded" curve every 200 games regardless of pump size.
  const runSkip = () => {
    const start = completed;
    const remaining = count - start;
    const pumps = Math.min(remaining, 14);
    const perPump = Math.ceil(remaining / pumps);
    const SAMPLE = 200;
    const pump = () => {
      if (token !== batchRunToken || !state.draft) return;
      const target = Math.min(count, completed + perPump);
      let snapshot = null;
      while (completed < target) {
        const size = Math.min(SAMPLE, target - completed);
        runBatchChunk(batchState, teams, seed, completed, size, { calibration });
        completed += size;
        snapshot = pushFrame() ?? snapshot;
      }
      // The instant path (online resync/join) wants results, not a show —
      // leave the "Simulating…" screen up rather than flashing a race by.
      if (!options.instant) {
        renderBatchRace({ snapshot: snapshot ?? batchProgressSnapshot(batchState), series, completed, total: count, teamNames, fastForwarding: true });
      }
      if (completed >= count) {
        beginWpaScoring();
        return;
      }
      setTimeout(pump, 0);
    };
    pump();
  };

  const step = () => {
    if (token !== batchRunToken || !state.draft) return;
    if (skipRequested) {
      runSkip();
      return;
    }
    // Fast forward runs the same race, just with a longer stride per frame —
    // the chart still draws, it simply gets where it is going sooner.
    const perFrame = fastForwarding ? gamesPerFrame * 8 : gamesPerFrame;
    const size = Math.min(perFrame, count - completed);
    runBatchChunk(batchState, teams, seed, completed, size, { calibration });
    completed += size;
    const snapshot = pushFrame() ?? batchProgressSnapshot(batchState);
    renderBatchRace({ snapshot, series, completed, total: count, teamNames, fastForwarding });
    if (completed >= count) {
      setTimeout(beginWpaScoring, fastForwarding ? 250 : 700);
      return;
    }
    setTimeout(step, fastForwarding ? 16 : raceFrameDelay(completed / count));
  };

  renderBatchRace({ snapshot: null, series, completed: 0, total: count, teamNames, fastForwarding });
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

function renderBatchRace({ snapshot, series, completed, total, teamNames, fastForwarding = false, phase = "games" }) {
  const percent = total ? Math.round((completed / total) * 100) : 0;
  const tallies = (snapshot?.rows ?? teamNames.map((name) => ({ team: name, wins: 0, losses: 0, share: 0 })))
    .slice()
    .sort((a, b) => b.share - a.share || b.wins - a.wins);
  const leader = completed > 0 ? tallies[0] : null;
  const scoringWpa = phase === "wpa";
  const heading = scoringWpa
    ? "Calibrating draft-specific WPA"
    : completed >= total
      ? "Photo finish"
      : leader
        ? `${escapeHtml(leader.team)} leads by win percentage`
        : `Simulating ${total} games`;
  const lede = scoringWpa
    ? `${completed} of ${total} games replayed against this draft's run environment.`
    : `${completed} of ${total} games complete. Win percentage so far:`;
  const chips = tallies
    .map((row) => `<span class="race-chip"><i style="background:${raceColor(teamNames.indexOf(row.team))}"></i>${escapeHtml(row.team)} <strong>${row.wins}-${row.losses}</strong></span>`)
    .join("");

  app.innerHTML = `<section class="panel sim-progress race-screen">
    <p class="eyebrow">Game simulator</p>
    <h1>${heading}</h1>
    <p class="lede">${lede}</p>
    <div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div>
    ${renderRaceChart({ teamNames, totalRuns: total, series })}
    <div class="race-chips">${chips}</div>
    <div class="race-controls">
      <button data-action="batch-fast-forward" class="small race-fast-forward" ${fastForwarding ? "disabled" : ""}>
        ${fastForwarding ? "⏩ Fast forwarding" : "⏩ Fast forward"}
      </button>
      <button data-action="batch-skip" class="small race-skip">Skip to results</button>
    </div>
  </section>`;
}

function renderBatch() {
  if (!state.batch?.summary?.teams?.length) {
    state.view = null;
    renderCurrentScreen();
    return;
  }
  hideFloatingTips();
  const { summary, runs } = state.batch;
  const top = summary.teams[0];
  const pickNumberMap = buildPickNumberMap(state.draft);
  const pricePaidMap = buildPricePaidMap(state.draft);
  const awards = computeAwards(summary, pickNumberMap, pricePaidMap);
  const backLabel = "Back to draft";
  const playersById = draftedPlayersById();
  const auctionDraft = isAuctionDraft(state.draft);
  const draftCostHeader = auctionDraft ? "Price" : "Pick #";
  const draftCostFor = (line) => {
    const player = playerForBoxLine(playersById, line, line.team);
    if (!player) return "";
    if (auctionDraft) {
      const price = pricePaidMap[player.id];
      return Number.isFinite(price) ? money(price) : "";
    }
    return pickNumberMap[player.id] ?? "";
  };
  const leagueWoba = tournamentWoba(summary.hitters);
  const hasPitcherSplits = summary.pitchers.some((line) => line.fresh);
  const pitcherSplit = hasPitcherSplits ? normalizeBatchPitcherSplit(state.batchPitcherSplit) : "overall";
  const pitcherLines = pitcherSplit === "fresh"
    ? summary.pitchers.map((line) => ({ ...line, ...(line.fresh ?? {}) }))
    : summary.pitchers;
  const fipConstant = tournamentFipConstant(pitcherLines);
  const teamGamesByName = new Map(summary.teams.map((row) => [row.team, row.games ?? teamScheduleGames(row)]));
  const sortedTeams = sortBatchRows(summary.teams, "teams", (row, sort) => batchTeamSortValue(row, sort));
  const sortedHitters = sortBatchRows(summary.hitters, "hitters", (row, sort) => batchHitterSortValue(row, sort, leagueWoba, teamGamesByName));
  const sortedPitchers = sortBatchRows(pitcherLines, "pitchers", (row, sort) => batchPitcherSortValue(row, sort, fipConstant, teamGamesByName));
  const sortedBaserunning = [...summary.teams].sort(compareTournamentBaserunning);
  const sortedDefense = [...summary.teams].sort(compareTournamentDefense);
  const winExpectancyModel = summary.winExpectancyModel;
  const secondOneOut = winExpectancyModel?.runExpectancy?.["1|2"]?.runs;
  const wpaCalibrationNote = winExpectancyModel?.version
    ? `WPA was calibrated from these ${winExpectancyModel.games} games (${winExpectancyModel.runsPerGame.toFixed(2)} runs/game${Number.isFinite(secondOneOut) ? `; runner on second with one out: ${secondOneOut.toFixed(2)} expected runs` : ""}) and then scored on an identical seeded replay.`
    : "This simulation predates draft-specific WPA calibration.";

  const teamRows = sortedTeams
    .map(
      (row, index) => `<tr>
        <td>${index + 1}</td>
        <td><strong>${escapeHtml(row.team)}</strong></td>
        <td class="num">${formatShare(row.winPct)}</td>
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
        <td class="num">${draftCostFor(line)}</td>
        <td>${renderBatchPlayerName(line, playersById)}</td>
        <td>${escapeHtml(line.team)}</td>
        <td>${escapeHtml(line.position ?? "")}</td>
        ${renderPaceCell(line, "paPer162", "pa", teamGamesByName, "PA")}
        ${renderPaceCell(line, "hrPer162", "hr", teamGamesByName, "HR")}
        ${renderPaceCell(line, "rPer162", "r", teamGamesByName, "R")}
        ${renderPaceCell(line, "rbiPer162", "rbi", teamGamesByName, "RBI")}
        ${renderPaceCell(line, "sbPer162", "sb", teamGamesByName, "SB")}
        ${renderPaceCell(line, "csPer162", "cs", teamGamesByName, "CS")}
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
        ${renderPaceCell(line, "wpaPer162", "wpa", teamGamesByName, "WPA", formatWpaStat)}
      </tr>`
    )
    .join("");

  const pitcherRows = sortedPitchers
    .map(
      (line, index) => `<tr>
        <td>${index + 1}</td>
        <td class="num">${draftCostFor(line)}</td>
        <td>${renderBatchPlayerName(line, playersById)}</td>
        <td>${escapeHtml(line.team)}</td>
        <td>${escapeHtml(line.role)}</td>
        ${renderPaceCell(line, "ipPer162", "ip", teamGamesByName, "IP", (value) => formatDecimal(value, 1), line.outs / 3)}
        <td class="num">${formatPerNine(line.so, line.outs)}</td>
        <td class="num">${formatPerNine(line.bb, line.outs)}</td>
        <td class="num">${formatPerNine(line.r, line.outs)}</td>
        <td class="num">${formatFip(line, fipConstant)}</td>
        ${renderPaceCell(line, "wpaPer162", "wpa", teamGamesByName, "WPA", formatWpaStat)}
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
    <p class="eyebrow">${runs} simulated games</p>
    <h1>${escapeHtml(top.team)} had the best draft</h1>
    <p class="batch-note">${escapeHtml(top.team)} led the sim with a ${formatShare(top.winPct)} win rate.</p>
    <p class="batch-note">${wpaCalibrationNote}</p>
    <table>
      <thead><tr>
        <th>#</th>
        ${renderBatchSortHeader("teams", "team", "Team")}
        ${renderBatchSortHeader("teams", "winPct", "Win%", "num")}
        ${renderBatchSortHeader("teams", "w162", "W/162", "num")}
        ${renderBatchSortHeader("teams", "l162", "L/162", "num")}
        ${renderBatchSortHeader("teams", "rf162", "RF/162", "num")}
        ${renderBatchSortHeader("teams", "ra162", "RA/162", "num")}
      </tr></thead>
      <tbody>${teamRows}</tbody>
    </table>
  </div>`;
  // Managers keep the color they wear on the standings race chart, keyed by
  // their seat order so a team is the same hue everywhere on the screen.
  const chartTeamOrder = state.batch.race?.teamNames ?? summary.teams.map((row) => row.team);
  const colorForTeam = (team) => {
    const index = chartTeamOrder.indexOf(team);
    return raceColor(index >= 0 ? index : 0);
  };
  const chartLegend = chartTeamOrder.map((name, index) => ({ name, color: raceColor(index) }));

  const scatterCost = (line) => {
    const player = playerForBoxLine(playersById, line, line.team);
    const id = player?.id ?? line.id;
    if (auctionDraft) {
      const price = pricePaidMap[id];
      return Number.isFinite(price) ? price : null;
    }
    const pick = pickNumberMap[id];
    return Number.isFinite(pick) ? pick : null;
  };
  const costLabel = (cost) => (auctionDraft ? money(cost) : `#${cost}`);
  const scatterPoints = [];
  for (const line of summary.hitters) {
    const cost = scatterCost(line);
    if (cost == null) continue;
    const wpa162 = batchPace(line, "wpaPer162", "wpa", teamGamesByName);
    const hr = Math.round(batchPace(line, "hrPer162", "hr", teamGamesByName));
    const rbi = Math.round(batchPace(line, "rbiPer162", "rbi", teamGamesByName));
    const sb = Math.round(batchPace(line, "sbPer162", "sb", teamGamesByName));
    const slash = `${formatBattingStat(line.avg)}/${formatBattingStat(line.obp)}/${formatBattingStat(line.slg)}`;
    const color = colorForTeam(line.team);
    scatterPoints.push({
      x: cost,
      y: wpa162,
      color,
      team: line.team,
      cardId: playerForBoxLine(playersById, line, line.team)?.id ?? line.id,
      tipTitle: line.name,
      tipColor: color,
      tipLines: [
        line.team + (line.position ? ` · ${line.position}` : ""),
        `${auctionDraft ? "Price" : "Pick"}: ${costLabel(cost)}`,
        `WPA/162: ${formatWpaStat(wpa162)}`,
        `${slash} · ${hr} HR · ${rbi} RBI${sb ? ` · ${sb} SB` : ""}`
      ]
    });
  }
  for (const line of summary.pitchers) {
    const cost = scatterCost(line);
    if (cost == null) continue;
    const wpa162 = batchPace(line, "wpaPer162", "wpa", teamGamesByName);
    const ip162 = batchPace(line, "ipPer162", "ip", teamGamesByName, line.outs / 3);
    const color = colorForTeam(line.team);
    scatterPoints.push({
      x: cost,
      y: wpa162,
      color,
      team: line.team,
      cardId: playerForBoxLine(playersById, line, line.team)?.id ?? line.id,
      tipTitle: line.name,
      tipColor: color,
      tipLines: [
        line.team + (line.role ? ` · ${line.role}` : ""),
        `${auctionDraft ? "Price" : "Pick"}: ${costLabel(cost)}`,
        `WPA/162: ${formatWpaStat(wpa162)}`,
        `${formatDecimal(ip162, 1)} IP · ${formatPerNine(line.r, line.outs)} R/9 · ${formatPerNine(line.so, line.outs)} K/9 · ${formatPerNine(line.bb, line.outs)} BB/9`
      ]
    });
  }
  // Filter the dots to one manager when the legend is toggled; a stale filter
  // (a manager who isn't in this room) falls back to showing everyone.
  const chartManager = chartTeamOrder.includes(state.batchChartManager) ? state.batchChartManager : null;
  const shownScatter = chartManager ? scatterPoints.filter((point) => point.team === chartManager) : scatterPoints;
  const draftValueSection = scatterPoints.length ? `<section class="panel wide draft-chart-panel">
    <div class="section-title-row">
      <div>
        <p class="eyebrow">Draft value</p>
        <h2>${auctionDraft ? "Dollars spent" : "Draft slot"} against WPA per 162</h2>
      </div>
    </div>
    <p class="batch-note">Each dot is a drafted player who logged a stat, colored by manager. Hover for the box-score line, click for the card, or use the legend to filter by manager.</p>
    ${renderDraftScatter({ points: shownScatter, xLabel: auctionDraft ? "Price paid ($)" : "Pick number", yLabel: "WPA / 162 games", legend: chartLegend, activeManager: chartManager })}
  </section>` : "";

  const overviewSection = `<section class="grid batch-overview-grid">
    ${teamTableSection}
    ${awardsSection}
  </section>
  ${draftValueSection}
  ${raceSection}
  ${renderFormulaRevealSection(summary)}`;
  const headToHeadSection = renderBatchHeadToHead(summary);
  const hittersSection = `<section class="panel wide">
    <h2>Hitters, 162-game pace</h2>
    <div class="table-scroll">
      <table>
        <thead><tr>
          <th>#</th>
          <th class="num">${draftCostHeader}</th>
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
    <div class="section-title-row">
      <div>
        <h2>Pitchers, 162-game pace</h2>
        <p class="batch-note">${!hasPitcherSplits
          ? "This simulation predates fatigue splits. Run it again to compare fresh and tired work."
          : pitcherSplit === "fresh"
          ? "Only plate appearances that began before the pitcher was tired."
          : "All plate appearances, including work after the pitcher became tired."}</p>
      </div>
      <div class="type-filter batch-pitcher-filter" role="group" aria-label="Pitcher fatigue split">
        <button type="button" class="type-pill ${pitcherSplit === "overall" ? "active" : ""}" data-batch-pitcher-split="overall" aria-pressed="${pitcherSplit === "overall"}">Overall</button>
        <button type="button" class="type-pill ${pitcherSplit === "fresh" ? "active" : ""}" data-batch-pitcher-split="fresh" aria-pressed="${pitcherSplit === "fresh"}" ${hasPitcherSplits ? "" : "disabled"}>Not tired</button>
      </div>
    </div>
    <div class="table-scroll">
      <table>
        <thead><tr>
          <th>#</th>
          <th class="num">${draftCostHeader}</th>
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
      <span>${runs} games</span>
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
  const draftRecapSection = `<section class="panel wide draft-recap-panel">
    <div class="section-title-row">
      <div>
        <p class="eyebrow">Draft review</p>
        <h2>Every pick of the draft</h2>
      </div>
      <span>${state.draft.pickNumber} picks</span>
    </div>
    ${renderDraftHistoryTable(draftHistory(state.draft))}
  </section>`;
  const batchSections = {
    overview: overviewSection,
    headToHead: headToHeadSection,
    hitters: hittersSection,
    pitchers: pitchersSection,
    skills: teamSkillsSection,
    // Replaying games is cheap but not free; only do it when the tab is open.
    games: activeBatchTab === "games" ? renderBatchGamesSection() : "",
    draft: draftRecapSection
  };

  app.innerHTML = `<section class="toolbar">
    <button data-action="batch-back">${backLabel}</button>
    <label class="batch-runs-label">Games
      <input data-batch-runs type="number" min="1" step="1" value="${runs}">
    </label>
    <button data-action="batch-run">Run again</button>
    <button data-action="reset">New room</button>
  </section>
  ${renderBatchStatsTabs(activeBatchTab)}
  ${batchSections[activeBatchTab]}`;

  bindBatchActions();
}

function renderBatchStatsTabs(activeTab) {
  return `<div class="game-tabs batch-stat-tabs" role="tablist" aria-label="Game simulator stats">
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
    { id: "headToHead", label: "Head-to-head" },
    { id: "hitters", label: "Hitters" },
    { id: "pitchers", label: "Pitchers" },
    { id: "skills", label: "Team skills" },
    { id: "games", label: "Game log" },
    { id: "draft", label: "Draft recap" }
  ];
}

function normalizeBatchStatsTab(value) {
  return batchStatsTabs().some((tab) => tab.id === value) ? value : "overview";
}

function normalizeBatchPitcherSplit(value) {
  return value === "fresh" ? "fresh" : "overall";
}

function renderBatchHeadToHead(summary) {
  const teams = summary.teams.map((row) => row.team);
  const records = new Map((summary.headToHead ?? []).map((row) => [`${row.team}\u0000${row.opponent}`, row]));
  if (!records.size) {
    return `<section class="panel wide">
      <h2>Head-to-head records</h2>
      <p class="batch-note">This simulation predates head-to-head tracking. Run it again to build the matchup matrix.</p>
    </section>`;
  }
  const header = teams.map((team) => `<th class="num" title="${escapeHtml(team)}">${escapeHtml(team)}</th>`).join("");
  const rows = teams.map((team) => {
    const cells = teams.map((opponent) => {
      if (team === opponent) return `<td class="num head-to-head-diagonal" aria-label="${escapeHtml(team)}">—</td>`;
      const row = records.get(`${team}\u0000${opponent}`);
      if (!row) return `<td class="num" title="No games played">0-0</td>`;
      const title = `${team} vs ${opponent}: ${row.wins}-${row.losses}, ${row.runsFor}-${row.runsAgainst} runs`;
      return `<td class="num head-to-head-record" title="${escapeHtml(title)}"><strong>${row.wins}-${row.losses}</strong><span>${row.runsFor}-${row.runsAgainst} runs</span></td>`;
    }).join("");
    return `<tr><th scope="row">${escapeHtml(team)}</th>${cells}</tr>`;
  }).join("");
  return `<section class="panel wide">
    <p class="eyebrow">${summary.runs} simulated games</p>
    <h2>Head-to-head records</h2>
    <p class="batch-note">Each cell shows wins-losses, with runs scored and allowed underneath.</p>
    <div class="table-scroll">
      <table class="head-to-head-table">
        <thead><tr><th>Team</th>${header}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </section>`;
}

const GAME_LOG_PAGE_SIZE = 50;

// The review log never stores games: every batch game is re-simulated from its
// deterministic seed on demand, so any of the batch's games can be
// reopened play by play — including win probability — at any time.
function renderBatchGamesSection() {
  const { runs, seed } = state.batch;
  const teams = state.draft.managers.map((manager) => buildTeam(manager, { optimize: true }));
  const winExpectancyModel = state.batch.summary?.winExpectancyModel ?? null;
  const replayOptions = { scheduleVersion: state.batch.summary?.scheduleVersion ?? 1 };
  if (state.batchGameIndex != null && state.batchGameIndex >= 0 && state.batchGameIndex < runs) {
    const replay = replayBatchGames(
      teams,
      seed,
      state.batchGameIndex,
      1,
      winExpectancyModel,
      replayOptions
    )[0];
    return renderBatchGameDetail(replay?.game, state.batchGameIndex, runs);
  }

  const pageCount = Math.max(1, Math.ceil(runs / GAME_LOG_PAGE_SIZE));
  const page = Math.min(Math.max(state.batchGamePage ?? 0, 0), pageCount - 1);
  const start = page * GAME_LOG_PAGE_SIZE;
  const count = Math.min(GAME_LOG_PAGE_SIZE, runs - start);
  const games = replayBatchGames(teams, seed, start, count, winExpectancyModel, replayOptions);

  const rows = games
    .map(({ index, game }) => {
      const homeWon = game.winner === game.home.name;
      const swing = game.topSwing
        ? `${escapeHtml(game.topSwing.name)} ${escapeHtml(game.topSwing.result)} (${formatWpaPercent(game.topSwing.wpa)})`
        : "—";
      return `<tr class="game-log-row" data-game-open="${index}" title="Open play-by-play">
        <td class="num">${index + 1}</td>
        <td>${homeWon ? escapeHtml(game.away.name) : `<strong>${escapeHtml(game.away.name)}</strong>`} @ ${homeWon ? `<strong>${escapeHtml(game.home.name)}</strong>` : escapeHtml(game.home.name)}</td>
        <td class="num">${game.away.runs}–${game.home.runs}${finalInningLabel(game)}</td>
        <td>${swing}</td>
        <td><button class="small" data-game-open="${index}">Replay</button></td>
      </tr>`;
    })
    .join("");

  return `<section class="panel wide game-log-panel">
    <div class="section-title-row">
      <div>
        <p class="eyebrow">Review log</p>
        <h2>Every game of the sim</h2>
      </div>
      <span>Games ${start + 1}–${start + count} of ${runs}</span>
    </div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>#</th><th>Matchup</th><th>Final</th><th>Biggest swing</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="game-log-pager">
      <button class="small" data-game-page="${page - 1}" ${page === 0 ? "disabled" : ""}>Previous</button>
      <span>Page ${page + 1} of ${pageCount}</span>
      <button class="small" data-game-page="${page + 1}" ${page >= pageCount - 1 ? "disabled" : ""}>Next</button>
    </div>
  </section>`;
}

function renderBatchGameDetail(game, index, runs) {
  if (!game) return `<section class="panel wide"><p>Game unavailable.</p></section>`;
  const homeWon = game.winner === game.home.name;
  return `<section class="panel wide game-log-panel">
    <div class="section-title-row">
      <div>
        <p class="eyebrow">Game ${index + 1} of ${runs}</p>
        <h2>${homeWon ? escapeHtml(game.away.name) : `<strong>${escapeHtml(game.away.name)}</strong>`} ${game.away.runs}, ${homeWon ? `<strong>${escapeHtml(game.home.name)}</strong>` : escapeHtml(game.home.name)} ${game.home.runs}${finalInningLabel(game)}</h2>
      </div>
      <div class="game-log-pager">
        <button class="small" data-game-open="${index - 1}" ${index === 0 ? "disabled" : ""}>Prev game</button>
        <button class="small" data-action="batch-game-back">All games</button>
        <button class="small" data-game-open="${index + 1}" ${index >= runs - 1 ? "disabled" : ""}>Next game</button>
      </div>
    </div>
    <h3>Win probability — ${escapeHtml(game.home.name)} (home)</h3>
    ${renderWinProbabilityChart(game)}
    <h3>Box score</h3>
    ${renderBoxScore(game, draftedPlayersById())}
    <h3>Play-by-play</h3>
    ${renderGameLog(game)}
  </section>`;
}

function finalInningLabel(game) {
  const innings = game.events.length ? game.events[game.events.length - 1].inning : 9;
  return innings === 9 ? "" : ` (${innings})`;
}

function formatWpaPercent(value) {
  const percent = (Number(value) || 0) * 100;
  return `${percent >= 0 ? "+" : ""}${percent.toFixed(1)}%`;
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

// End-of-sim reveal: CPU managers draft with a private, draft-seeded twist on
// the shared valuation formula. Human seats carry no CPU persona, so showing a
// generated model for them would imply the app made choices that the player did.
function renderFormulaRevealSection(summary) {
  const draft = state.draft;
  if (!draft?.managers?.length) return "";
  const cpuManagers = draft.managers.filter((manager) => manager.cpu);
  if (!cpuManagers.length) return "";
  const outcomes = new Map(summary.teams.map((row, index) => [row.team, { place: index + 1, winPct: row.winPct }]));
  const cards = [...cpuManagers]
    .sort((a, b) => (outcomes.get(a.name)?.place ?? 99) - (outcomes.get(b.name)?.place ?? 99))
    .map((manager) => renderFormulaCard(draft, manager, outcomes.get(manager.name)))
    .join("");
  const spread = Math.round(VALUATION_PERTURBATION * 100);
  return `<section class="panel wide formula-reveal-panel">
    <div class="section-title-row">
      <div>
        <p class="eyebrow">CPU draft formulas</p>
        <h2>How the computer managers valued cards</h2>
      </div>
    </div>
    <p class="batch-note">Only computer-controlled seats are shown. Each CPU uses the same baseline formula, with draft-seeded preferences nudging each weight up to &plusmn;${spread}%. These numbers drove the CPU managers' auto-picks and auction bids &mdash; compare the leans against the standings to see which preferences paid off.</p>
    <div class="formula-grid">${cards}</div>
    <p class="batch-note">Chart is the card's result chart scored slot by slot (HR +14 &hellip; SO &minus;4 for hitters; SO +10 &hellip; HR &minus;16 for pitchers). IP-load scales pitcher quality by workload: (IP + 4) / 10, so full price for a 6-IP starter and about half for a 1-IP reliever.</p>
  </section>`;
}

function renderFormulaCard(draft, manager, outcome) {
  const weights = managerValuation(draft, manager).weights;
  const hitter = weights.hitter;
  const pitcher = weights.pitcher;
  const terms = [
    { label: "On-Base", weight: hitter.onBase, base: VALUATION_BASE_WEIGHTS.hitter.onBase },
    { label: "Fielding", weight: hitter.fielding, base: VALUATION_BASE_WEIGHTS.hitter.fielding },
    { label: "Speed", weight: hitter.speed, base: VALUATION_BASE_WEIGHTS.hitter.speed },
    { label: "Hitter chart", weight: hitter.chart, base: VALUATION_BASE_WEIGHTS.hitter.chart },
    { label: "Control", weight: pitcher.control, base: VALUATION_BASE_WEIGHTS.pitcher.control },
    { label: "IP", weight: pitcher.ip, base: VALUATION_BASE_WEIGHTS.pitcher.ip },
    { label: "Pitcher chart", weight: pitcher.chart, base: VALUATION_BASE_WEIGHTS.pitcher.chart }
  ];
  const standing = outcome
    ? `<span class="formula-outcome">#${outcome.place} &middot; ${formatShare(outcome.winPct)} win rate</span>`
    : `<span class="formula-outcome">did not play</span>`;
  return `<div class="formula-card">
    <div class="formula-card-head">
      <strong>${escapeHtml(manager.name)} <span class="cpu-tag">CPU</span></strong>
      ${standing}
    </div>
    <p class="formula-line"><span class="formula-kind">Hitters</span> ${formulaTerm(hitter.onBase, "On-Base")} + ${formulaTerm(hitter.fielding, "Fielding")} + ${formulaTerm(hitter.speed, "(Speed&minus;1)")} + ${formulaTerm(hitter.chart, "Chart")}</p>
    <p class="formula-line"><span class="formula-kind">Pitchers</span> (${formulaTerm(pitcher.control, "Control")} + ${formulaTerm(pitcher.chart, "Chart")}) &times; IP-load + ${formulaTerm(pitcher.ip, "IP")}</p>
    <div class="formula-leans">${terms.map((term) => weightLeanChip(term)).join("")}</div>
  </div>`;
}

function formulaTerm(weight, label) {
  return `<strong>${formatWeight(weight)}</strong>&times;${label}`;
}

// Weights span ~0.9 (chart) to ~44 (control); two significant-ish digits keeps
// small weights meaningful without cluttering the big ones.
function formatWeight(weight) {
  return weight >= 10 ? weight.toFixed(1) : weight.toFixed(2);
}

function weightLeanChip({ label, weight, base }) {
  const delta = Math.round((weight / base - 1) * 100);
  const direction = delta > 0 ? "lean-up" : delta < 0 ? "lean-down" : "";
  const sign = delta > 0 ? "+" : "";
  return `<span class="weight-lean ${direction}">${escapeHtml(label)} <strong>${sign}${delta}%</strong></span>`;
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
  if (sort === "winPct") return row.winPct ?? row.titleShare ?? 0;
  if (sort === "w162") return per162(formatDistributionTotal(row.wins), teamScheduleGames(row));
  if (sort === "l162") return per162(formatDistributionTotal(row.losses), teamScheduleGames(row));
  if (sort === "rf162") return per162(formatDistributionTotal(row.runsFor), teamScheduleGames(row));
  if (sort === "ra162") return per162(formatDistributionTotal(row.runsAgainst), teamScheduleGames(row));
  return row.winPct ?? row.titleShare ?? 0;
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
    teams: { sort: "winPct", direction: "desc" },
    hitters: { sort: "ops", direction: "desc" },
    pitchers: { sort: "era", direction: "asc" }
  };
}

function normalizeBatchSorts(value) {
  const sorts = { ...defaultBatchSorts(), ...(value ?? {}) };
  if (sorts.teams?.sort === "titleShare" || sorts.teams?.sort === "finalsShare") {
    sorts.teams = { sort: "winPct", direction: "desc" };
  }
  return sorts;
}

function defaultBatchSortDirection(table, sort) {
  if (["name", "team", "position", "role"].includes(sort)) return "asc";
  if (table === "pitchers" && ["era", "fip", "bb9"].includes(sort)) return "asc";
  return "desc";
}

// What every card on a roster cost its owner. Empty for a snake draft, where
// nobody paid anything but a pick.
function buildPricePaidMap(draft) {
  if (!isAuctionDraft(draft)) return {};
  const prices = {};
  for (const pick of draftHistory(draft)) {
    if (Number.isFinite(pick.price)) prices[pick.player.id] = pick.price;
  }
  return prices;
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
    // A dot on the draft-value chart pins that player's card. Clicking anywhere
    // else on the results dismisses it — hover cards were unreachable on touch,
    // and the dots are too small to hover precisely anyway.
    const cardDot = event.target.closest("[data-card-id]");
    if (cardDot) {
      const player = draftedPlayersById().get(cardDot.dataset.cardId);
      if (player) presentCard(previewCard(player), `dot-${player.id}`, event.clientX, event.clientY);
      return;
    }
    hideHoverCard();

    const chartManagerButton = event.target.closest("button[data-batch-chart-manager]");
    if (chartManagerButton) {
      state.batchChartManager = chartManagerButton.dataset.batchChartManager || null;
      saveState();
      renderBatch();
      return;
    }

    const tabButton = event.target.closest("button[data-batch-tab]");
    if (tabButton) {
      state.batchStatsTab = normalizeBatchStatsTab(tabButton.dataset.batchTab);
      saveState();
      renderBatch();
      return;
    }

    const pitcherSplitButton = event.target.closest("button[data-batch-pitcher-split]");
    if (pitcherSplitButton) {
      state.batchPitcherSplit = normalizeBatchPitcherSplit(pitcherSplitButton.dataset.batchPitcherSplit);
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

    const gameOpen = event.target.closest("[data-game-open]");
    if (gameOpen && !gameOpen.disabled) {
      state.batchGameIndex = Number(gameOpen.dataset.gameOpen);
      saveState();
      renderBatch();
      return;
    }

    const gamePage = event.target.closest("button[data-game-page]");
    if (gamePage && !gamePage.disabled) {
      state.batchGamePage = Number(gamePage.dataset.gamePage);
      saveState();
      renderBatch();
      return;
    }

    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "batch-game-back") {
      state.batchGameIndex = null;
      saveState();
      renderBatch();
      return;
    }
    if (action === "batch-back") {
      state.view = null;
      saveState();
      renderCurrentScreen();
    }
    if (action === "batch-run") {
      const input = app.querySelector("[data-batch-runs]");
      requestBatchRun(input?.value ?? DEFAULT_BATCH_RUNS);
    }
    if (action === "reset") {
      if (state.online) {
        leaveOnlineRoom();
        return;
      }
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

function renderPaceCell(line, paceKey, totalKey, teamGamesByName, label, formatter = formatSeasonCount, totalOverride = null) {
  const value = batchPace(line, paceKey, totalKey, teamGamesByName, totalOverride);
  const total = totalOverride ?? Number(line?.[totalKey] ?? 0);
  const games = Number(line?.teamGames ?? teamGamesByName.get(line?.team) ?? 0);
  const title = `${label}: ${formatAuditNumber(total)} raw / ${formatAuditNumber(games)} team games * 162 = ${formatAuditNumber(value)}`;
  return `<td class="num stat-audit" title="${escapeHtml(title)}">${formatter(value)}</td>`;
}

function formatAuditNumber(value) {
  const number = Number(value) || 0;
  return Number.isInteger(number) ? String(number) : number.toFixed(2);
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
  return `${number >= 0 ? "+" : ""}${number.toFixed(2)}`;
}

function showHoverCard(row, clientX, clientY) {
  presentCard(row.dataset.previewCard, row.dataset.previewId ?? row.dataset.previewCard, clientX, clientY);
}

// Drop a rendered player card into the shared preview element and place it near
// the cursor. Used both by the table hover cards and by clicking a chart dot.
function presentCard(cardHtml, previewId, clientX, clientY) {
  if (!cardHtml) return;
  if (cardPreview.dataset.previewId !== previewId) {
    cardPreview.innerHTML = cardHtml;
    // The face renders with an empty photo window; the cascade fills it (and
    // the club logo) from the MLB and Wikipedia image APIs, cached per name.
    hydratePhotos(cardPreview);
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

function showChartTip(zone, clientX, clientY) {
  chartTipValue.textContent = zone.dataset.wpValue ?? "";
  chartTipPlay.textContent = zone.dataset.wpPlay ?? "";
  chartTip.hidden = false;

  const gap = 14;
  const rect = chartTip.getBoundingClientRect();
  let x = clientX - rect.width / 2;
  let y = clientY - rect.height - gap;
  if (y < gap) y = clientY + gap;
  x = Math.max(gap, Math.min(x, window.innerWidth - rect.width - gap));

  chartTip.style.left = `${Math.round(x)}px`;
  chartTip.style.top = `${Math.round(y)}px`;
}

function hideChartTip() {
  chartTip.hidden = true;
}

function showPointTip(dot, clientX, clientY) {
  const title = dot.dataset.tipTitle ?? "";
  const color = dot.dataset.tipColor ?? "";
  const lines = (dot.dataset.tipLines ?? "").split("\n").filter(Boolean);
  pointTip.innerHTML = `<strong class="point-tip-title">${color ? `<i class="point-tip-swatch" style="background:${escapeHtml(color)}"></i>` : ""}${escapeHtml(title)}</strong>${lines.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}`;
  pointTip.hidden = false;
  pointTip.setAttribute("aria-hidden", "false");

  const gap = 14;
  const rect = pointTip.getBoundingClientRect();
  let x = clientX - rect.width / 2;
  let y = clientY - rect.height - gap;
  if (y < gap) y = clientY + gap;
  x = Math.max(gap, Math.min(x, window.innerWidth - rect.width - gap));
  pointTip.style.left = `${Math.round(x)}px`;
  pointTip.style.top = `${Math.round(y)}px`;
}

function hidePointTip() {
  pointTip.hidden = true;
  pointTip.setAttribute("aria-hidden", "true");
}

// Both floating tips are singletons pinned to the body, anchored to a dot that a
// repaint throws away — and a removed dot fires no pointer-out, so the tip that
// was riding it hangs there over the new screen. Any full repaint of a
// chart-bearing view calls this first to clear a stale one; the pointer handlers
// bring it back the moment the cursor actually sits on a live dot again.
function hideFloatingTips() {
  hidePointTip();
  hideChartTip();
}

// Announce a won lot: winner and price, dropped in over the board and cleared on
// its own after a beat. It never blocks — the draft rolls straight on to the next
// nomination underneath it.
function showSaleToast(sale) {
  const price = money(sale.price);
  const name = sale.player?.name ?? "";
  const winner = sale.manager?.name ?? "";
  saleToast.innerHTML = `<span class="sale-toast-mark">SOLD</span>
    <strong class="sale-toast-name">${escapeHtml(name)}</strong>
    <span class="sale-toast-line">to <strong>${escapeHtml(winner)}</strong> for <strong>${escapeHtml(price)}</strong></span>`;
  saleToast.hidden = false;
  saleToast.setAttribute("aria-hidden", "false");
  // Restart the entrance every time so a quick run of sales each get their own
  // full moment rather than one frozen card riding through all of them.
  saleToast.classList.remove("show");
  void saleToast.offsetWidth;
  saleToast.classList.add("show");
  if (saleToastTimer) clearTimeout(saleToastTimer);
  saleToastTimer = setTimeout(() => {
    saleToast.classList.remove("show");
    saleToast.hidden = true;
    saleToast.setAttribute("aria-hidden", "true");
    saleToastTimer = null;
  }, 2600);
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
    data-preview-card="${escapeHtml(previewCard(player))}"
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
      (event) => `<tr${Math.abs(event.wpa ?? 0) >= 0.1 ? ' class="wpa-swing"' : ""}>
        <td>${event.inning}${event.half === "top" ? "T" : "B"}</td>
        <td>${renderEventMatchup(event)}</td>
        <td>${renderControlResult(event)}</td>
        <td>${renderEventResult(event)}</td>
        <td>${event.outsBefore} to ${event.outsAfter}</td>
        <td>${escapeHtml(basesText(event.basesBefore))} to ${escapeHtml(basesText(event.basesAfter))}</td>
        <td>${event.scoreAfter.away}-${event.scoreAfter.home}</td>
        ${renderEventWinProbability(event)}
      </tr>`
    )
    .join("");

  return `<div class="game-log">
    <table>
      <thead><tr><th>Inn</th><th>Matchup</th><th>Control</th><th>Result</th><th>Outs</th><th>Bases</th><th>Score</th><th class="num">Home WP</th><th class="num">WPA</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

// Home team's win probability around the play, plus the play's WPA from the
// batting side's perspective — the amount credited to the batter (or runner)
// and debited from the pitcher.
function renderEventWinProbability(event) {
  if (event.wpBefore == null || event.wpAfter == null) return `<td></td><td></td>`;
  const wpa = event.wpa ?? 0;
  const tone = wpa > 0.0005 ? "wpa-pos" : wpa < -0.0005 ? "wpa-neg" : "";
  return `<td class="num wp-cell">${formatWinProb(event.wpBefore)} → ${formatWinProb(event.wpAfter)}</td>
    <td class="num ${tone}">${formatWpaPercent(wpa)}</td>`;
}

function formatWinProb(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
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

// The blind-draft rule, asked once and answered the same everywhere: keep a
// single card's printed points off the screen. Only the numerals go — the
// rarity and heat COLOURS stay, so a card still reads as roughly good or bad,
// just not exactly how much — and aggregate team totals are left alone, because
// the rule is about one card's worth, not the shape of a finished roster.
function pointsHidden() {
  return Boolean(state.draft?.hidePoints);
}

// A floating card-face preview that obeys the blind-draft rule wherever it
// appears — over the board, the dock, a roster slot.
function previewCard(player) {
  return renderPlayerCard(player, { hidePoints: pointsHidden() });
}

function renderRoster(manager, draft) {
  const counts = rosterCounts(manager.roster);
  const auction = isAuctionDraft(draft);
  const history = draftHistory(draft);
  const slotContext = {
    prices: auction ? new Map(history.map((pick) => [pick.player.id, pick.price])) : null,
    lastPickedId: history.at(-1)?.player.id ?? null,
    heatScale: draftHeatScale(draft)
  };
  const totalPoints = manager.roster.reduce((sum, player) => sum + player.points, 0);
  const budgetLine = auction
    ? ` &middot; ${money(auctionBudget(draft, manager))} left &middot; max bid ${money(draft.complete ? 0 : auctionMaxBid(draft, manager))}`
    : "";
  // Nothing to count up to when the roster has no ceiling: a manager owns as
  // many cards as they bought, one active roster of which takes the field.
  const draftedLine = hasUnlimitedRoster(draft)
    ? `${manager.roster.length} card${manager.roster.length === 1 ? "" : "s"}`
    : `${manager.roster.length}/${draft.rosterSize} drafted`;
  // A computer manager says what he believes, so a pick that looks mad has a
  // reason you can read.
  const persona = manager.cpu ? cpuPersonality(manager.persona) : null;
  // The whistle: a seat nobody is sitting in can be handed to the computer so
  // the room keeps moving, and handed back the moment its manager returns.
  const online = state.online;
  const canSeat = !draft.complete && (!online || online.host);
  const seatButton = canSeat
    ? `<button class="small seat-button" data-action="seat" data-manager-id="${escapeHtml(manager.id)}" data-cpu="${manager.cpu ? "0" : "1"}">${manager.cpu ? "Hand back" : "Hand to CPU"}</button>`
    : "";
  return `<article class="roster">
    <h3>${escapeHtml(manager.name)} ${pointsHidden() ? "" : `<span class="roster-points">${totalPoints} pts</span>`}${seatButton}</h3>
    ${persona ? `<p class="persona" title="${escapeHtml(persona.blurb)}"><span class="persona-tag">${escapeHtml(persona.name)}</span><span class="persona-blurb">${escapeHtml(persona.blurb)}</span></p>` : ""}
    <p>${draftedLine}${budgetLine}</p>
    <div class="target-row">
      <span class="${counts.hitters >= 9 ? "ok" : "warn"}">${counts.hitters}/9 hitters</span>
      <span class="${counts.starters >= draft.startingPitchers ? "ok" : "warn"}">${counts.starters}/${draft.startingPitchers} starters</span>
      <span class="${counts.bullpen >= 2 ? "ok" : "warn"}">${counts.bullpen}/2 bullpen</span>
    </div>
    ${renderRosterDepthChart(manager, slotContext)}
  </article>`;
}

function renderRosterDepthChart(manager, slotContext = {}) {
  const lineupSlots = assignHittersToLineupSlots(manager).slots;
  const staffSlots = assignPlayersToSlots(
    manager.roster.filter((player) => player.kind === "pitcher"),
    [...Array.from({ length: state.draft?.startingPitchers ?? DEFAULT_STARTING_PITCHERS }, () => "SP"), "RP", "RP"],
    (player) => player.role
  ).slots;

  return `<div class="mini-roster-board">
    <div class="mini-roster-section">
      <span class="mini-roster-heading">Lineup</span>
      <div class="mini-slot-grid">${lineupSlots.map((slot) => renderMiniRosterSlot(slot.player, slot.label, slotContext)).join("")}</div>
    </div>
    <div class="mini-roster-section">
      <span class="mini-roster-heading">Staff</span>
      <div class="mini-slot-grid staff-mini-slots">${staffSlots.map((slot) => renderMiniRosterSlot(slot.player, slot.label, slotContext)).join("")}</div>
    </div>
  </div>`;
}

function renderMiniRosterSlot(player, slotLabel, slotContext = {}) {
  if (!player) {
    return `<div class="mini-roster-slot empty-mini-slot">
      <span class="mini-slot-label">${escapeHtml(slotLabel)}</span>
      <span class="mini-slot-name">open</span>
    </div>`;
  }
  const price = slotContext.prices?.get(player.id);
  const flash = player.id === slotContext.lastPickedId ? " just-picked" : "";
  const heat = slotContext.heatScale ? heatStyle(heatValue(player, slotContext.heatScale, slotContext.prices), slotContext.heatScale) : "";
  return `<div class="mini-roster-slot filled-mini-slot heat${flash}" style="${heat}">
    <span class="mini-slot-label">${escapeHtml(slotLabel)}</span>
    <strong class="mini-slot-name player-name-preview" tabindex="0" data-preview-id="${escapeHtml(player.id)}" data-preview-card="${escapeHtml(previewCard(player))}">${escapeHtml(player.name)}</strong>
    <span class="mini-slot-meta">${escapeHtml(rosterSlotDescription(player, slotLabel))}${pointsHidden() ? "" : ` | ${player.points} pts`}</span>
    ${price !== undefined ? `<span class="mini-slot-price">${money(price)}</span>` : ""}
  </div>`;
}

// Read-only broadcast layout for a TV: the lot, every board, and the ticker
// on one dark screen. Opened with ?board (same browser via localStorage) or
// ?room=CODE&board (live spectator over SSE).
// ---- the broadcast board ----
//
// The grid is the thing every draft room in the world has on the wall: rounds
// down the side, managers across the top, and the squares filling in one at a
// time. A snake draft is exactly that shape — one pick per manager per round —
// so it is exactly that grid, and it reverses the way the picking does.
//
// An auction has no rounds, so it does not get a grid. It gets its ticker, which
// is the shape an auction actually has.
function renderWarGrid(draft, history) {
  // A snake draft has rounds and no dollars, so the grid is always the points.
  if (isAuctionDraft(draft)) return "";
  const scale = draftHeatScale(draft);
  const seats = draft.managers;
  const rounds = draft.rosterSize;
  const byRound = new Map();
  for (const pick of history) {
    byRound.set(`${pick.round}:${pick.manager.id}`, pick);
  }

  const nextPick = draft.complete ? null : draft.pickNumber + 1;
  const head = seats.map((manager) => `<th>${escapeHtml(manager.name)}</th>`).join("");
  const rows = Array.from({ length: rounds }, (_, index) => {
    const round = index + 1;
    // The snake turns at the end of every round, and the board turns with it.
    const order = round % 2 === 0 ? [...seats].reverse() : seats;
    const cells = seats
      .map((manager) => {
        const pick = byRound.get(`${round}:${manager.id}`);
        const seat = order.indexOf(manager);
        const pickNumber = (round - 1) * seats.length + seat + 1;
        const onClock = pickNumber === nextPick;
        if (!pick) {
          return `<td class="war-cell ${onClock ? "on-clock" : "empty"}">${onClock ? "ON THE CLOCK" : ""}</td>`;
        }
        return `<td class="war-cell filled heat" style="${heatStyle(pick.player.points, scale)}">
          <span class="war-cell-name">${escapeHtml(shortCardName(pick.player.name))}</span>
          <span class="war-cell-meta">${escapeHtml(playerPosition(pick.player))}${pointsHidden() ? "" : ` &middot; ${pick.player.points}`}</span>
        </td>`;
      })
      .join("");
    return `<tr><th class="war-round">${round}</th>${cells}</tr>`;
  }).join("");

  return `<section class="war-grid-wrap">
    <table class="war-grid">
      <thead><tr><th class="war-round"></th>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

// A card's name, short enough for a square on a wall.
function shortCardName(name) {
  const trimmed = String(name).replace(/\s+'\d{2}$/, "");
  const parts = trimmed.split(" ");
  if (parts.length < 2) return trimmed;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

function renderWarRoom() {
  resetAppHandlers();
  document.body.classList.add("war-room-body");
  const draft = state.draft;
  if (!draft) {
    app.innerHTML = `<div class="war-room"><p class="war-standby">Waiting for a draft to start&hellip;</p></div>`;
    return;
  }
  reactToDraftChange(draft, { spectator: true });
  const auction = isAuctionDraft(draft);
  const lot = auction ? draft.auction.lot : null;
  const lotPlayer = lot ? auctionLotPlayer(draft) : null;
  updateWarRoomNominationSound(draft, lot, lotPlayer);
  const history = draftHistory(draft);
  const prices = auction ? new Map(history.map((pick) => [pick.player.id, pick.price])) : null;
  const heatScale = draftHeatScale(draft);
  const current = draft.complete ? null : currentManager(draft);
  const totalPicks = draft.managers.length * draft.rosterSize;
  const lastPick = history.at(-1);

  const status = draft.complete
    ? "DRAFT COMPLETE"
    : auction
      ? lot
        ? `LOT ${draft.pickNumber + 1} OF ${totalPicks}`
        : `${escapeHtml(current?.name ?? "")} NOMINATES NEXT`
      : `PICK ${draft.pickNumber + 1} OF ${totalPicks} &middot; ${escapeHtml(current?.name ?? "")} ON THE CLOCK`;

  const spotlightPlayer = lotPlayer ?? lastPick?.player ?? null;
  const spotlightLabel = lotPlayer
    ? `ON THE BLOCK &middot; NOMINATED BY ${escapeHtml(draft.managers.find((m) => m.id === lot.nominatorId)?.name ?? "").toUpperCase()}`
    : lastPick
      ? `LAST ${auction ? "SALE" : "PICK"} &middot; ${escapeHtml(lastPick.manager.name).toUpperCase()}${auction ? ` FOR ${money(lastPick.price)}` : ""}`
      : "WAITING FOR THE FIRST PICK";

  const bidBoard = lot
    ? `<div class="war-bids">${draft.managers
        .map((manager) => {
          const inHand = lot.bids && Object.prototype.hasOwnProperty.call(lot.bids, manager.id);
          return `<div class="war-bid ${inHand ? "bid-in" : ""}">${escapeHtml(manager.name)}${manager.cpu ? " &middot; CPU" : ""}<em>${inHand ? "bid in" : "thinking&hellip;"}</em></div>`;
        })
        .join("")}</div>`
    : "";

  const teams = draft.managers
    .map((manager) => {
      const needs = dockNeedsSummary(manager);
      const points = manager.roster.reduce((sum, player) => sum + player.points, 0);
      // A running total is a specific card's points in disguise — one card early,
      // or the gap between two picks — so the blind draft drops it and keeps the
      // budget line.
      const budgetLead = auction && !draft.complete
        ? `${money(auctionBudget(draft, manager))} left &middot; max ${money(auctionMaxBid(draft, manager))}`
        : "";
      const headerMeta = [budgetLead, pointsHidden() ? "" : `${points} pts`].filter(Boolean).join(" &middot; ");
      return `<section class="war-team">
        <header>
          <h3>${escapeHtml(manager.name)}</h3>
          <span>${headerMeta}</span>
        </header>
        ${renderWarTeamPositions(manager, auction, prices, heatScale)}
        ${needs ? `<footer>needs ${escapeHtml(needs)}</footer>` : ""}
      </section>`;
    })
    .join("");

  const ticker = history
    .slice(-6)
    .reverse()
    .map(
      (pick) => `<span class="recent-pick heat" style="${heatStyle(heatValue(pick.player, heatScale, prices), heatScale)}">
        <strong>${escapeHtml(pick.player.name)}</strong>
        <em>&rarr; ${escapeHtml(pick.manager.name)}${auction ? ` for ${money(pick.price)}` : ""}</em>
      </span>`
    )
    .join("");

  app.innerHTML = `<div class="war-room">
    <header class="war-header">
      <span class="war-brand">MLB Showdown &middot; ${escapeHtml(draft.seed ?? "")}</span>
      <h1>${status}</h1>
      <span class="war-clock" data-war-clock hidden></span>
      ${renderHeatLegend(heatScale)}
      <button type="button" class="war-sound-toggle ${isMuted() ? "" : "enabled"}" data-action="toggle-sound" aria-pressed="${!isMuted()}">${isMuted() ? "&#128264; Sound off" : "&#128266; Sound on"}</button>
      ${state.online ? `<span class="war-live">&#9679; LIVE</span>` : ""}
    </header>
    <div class="war-main">
      <section class="war-spotlight">
        <p class="war-spotlight-label">${spotlightLabel}</p>
        ${spotlightPlayer ? `<div class="war-card">${previewCard(spotlightPlayer)}</div>` : ""}
        ${bidBoard}
      </section>
      <div class="war-teams">${teams}</div>
    </div>
    ${renderWarGrid(draft, history)}
    ${renderPoolFloor(draft)}
    <footer class="war-ticker">${ticker}</footer>
  </div>`;
  app.onclick = (event) => {
    if (event.target.closest("[data-action='toggle-sound']")) toggleSound();
    const heat = event.target.closest("[data-action='heat-by']");
    if (heat) {
      state.heatBy = heat.dataset.heatBy === "points" ? "points" : "price";
      renderWarRoom();
    }
  };
  updateWarClock();
}

// The board runs the clock the drafting tab published, so the room on the second
// screen counts down with the room at the table.
function updateWarClock() {
  const slot = document.querySelector("[data-war-clock]");
  if (!slot) return;
  const draft = state.draft;
  const deadline = state.pickDeadline;
  if (!draft || draft.complete || isDraftPaused(draft) || !Number.isFinite(deadline)) {
    slot.hidden = true;
    return;
  }
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    slot.hidden = true;
    return;
  }
  slot.hidden = false;
  slot.textContent = formatPickClock(remaining);
  slot.classList.toggle("urgent", remaining <= 10_000);
}



function positionGroupOf(player) {
  if (player.kind === "pitcher") return player.role === "SP" ? "SP" : "RP";
  if (isCornerOutfielder(player.position)) return "LF/RF";
  return BOARD_POSITION_GROUPS.includes(player.position) ? player.position : "DH";
}

// Grouped, color-coded team view for the TV board: one cell per printed
// position, every player the team owns there stacked inside it.
function renderWarTeamPositions(manager, auction, prices, heatScale) {
  const groups = new Map(BOARD_POSITION_GROUPS.map((group) => [group, []]));
  for (const player of manager.roster) groups.get(positionGroupOf(player)).push(player);
  const cells = BOARD_POSITION_GROUPS.map((group) => {
    const players = groups
      .get(group)
      .sort((a, b) =>
        auction
          ? (prices.get(b.id) ?? 0) - (prices.get(a.id) ?? 0)
          : pointsHidden()
            ? a.name.localeCompare(b.name)
            : b.points - a.points);
    const chips = players
      .map((player) => {
        const tag = auction
          ? (heatBy() === "points" ? (pointsHidden() ? undefined : `${player.points}`) : money(prices.get(player.id)))
          : undefined;
        return `<span class="war-pos-chip heat" style="${heatStyle(heatValue(player, heatScale, prices), heatScale)}">${escapeHtml(dockChipName(player))}${tag !== undefined ? `<em>${tag}</em>` : ""}</span>`;
      })
      .join("");
    return `<div class="war-pos${players.length ? "" : " war-pos-empty"}">
      <small>${group}</small>
      ${chips || `<span class="war-pos-blank">&mdash;</span>`}
    </div>`;
  }).join("");
  return `<div class="war-positions">${cells}</div>`;
}

// What is still on the board at every spot some roster has not filled: how
// many eligible cards remain, the best of them, and the floor you settle for
// if you wait. Eligibility follows lineup rules, so 1B and DH consider every
// remaining hitter. The chip edge is heat-tinted by the best card's points,
// so a red edge means a stud is still out there.
function renderPoolFloor(draft) {
  const needed = leagueOpenGroups(draft);
  if (!needed.size) return "";
  const available = availablePlayers(draft);
  // The card on the block is still "available", but it is the very one being
  // decided right now — so "N left" that quietly counted it read as one more
  // fallback than you actually have. Set it aside and mark its group, so the
  // number is what remains if you let this lot go.
  const lotPlayer = isAuctionDraft(draft) ? auctionLotPlayer(draft) : null;
  const pointsScale = poolPointsScale(draft);
  const previewChip = (label, player) =>
    `<strong class="player-name-preview" tabindex="0" data-preview-id="pool-${label}-${escapeHtml(player.id)}" data-preview-card="${escapeHtml(previewCard(player))}">${label} ${escapeHtml(dockChipName(player))}${pointsHidden() ? "" : ` &middot; ${player.points}`}</strong>`;
  const items = BOARD_POSITION_GROUPS.filter((group) => needed.has(group))
    .map((group) => {
      const onBlock = lotPlayer && poolGroupEligible(lotPlayer, group);
      const eligible = available.filter((player) =>
        poolGroupEligible(player, group) && !(onBlock && player.id === lotPlayer.id));
      const blockNote = onBlock ? `<em class="floor-onblock">+1 up now</em>` : "";
      if (!eligible.length) {
        return `<span class="floor-chip floor-empty"><small>${group} ${blockNote}</small><strong>none left${onBlock ? " after this" : ""}</strong></span>`;
      }
      const best = eligible.reduce((high, player) => (player.points > high.points ? player : high));
      const floor = eligible.reduce((low, player) => (player.points < low.points ? player : low));
      const lines = best === floor
        ? previewChip("last:", best)
        : `${previewChip("best", best)}${previewChip("floor", floor)}`;
      return `<span class="floor-chip heat" style="${heatStyle(best.points, pointsScale)}"><small>${group} &middot; ${eligible.length} left ${blockNote}</small>${lines}</span>`;
    })
    .join("");
  return `<div class="pool-floor" aria-label="Strength remaining at open positions"><small>left on the board &middot; the card up now is counted apart</small>${items}</div>`;
}

// Card-points scale for pool-quality tints, independent of the bid scale.
function poolPointsScale(draft) {
  const points = draft.pool.map((player) => player.points).sort((a, b) => a - b);
  const lo = quantileOf(points, 0.1);
  return { lo, hi: Math.max(quantileOf(points, 0.9), lo + 10), auction: false };
}

function poolGroupEligible(player, group) {
  if (group === "SP" || group === "RP") {
    return player.kind === "pitcher" && (player.role === "SP") === (group === "SP");
  }
  if (player.kind !== "hitter") return false;
  if (group === "LF/RF") return canPlayerFillLineupSlot(player, "LF");
  return canPlayerFillLineupSlot(player, group);
}

function leagueOpenGroups(draft) {
  const needed = new Set();
  for (const manager of draft.managers) {
    const lineup = lineupStatus(manager.roster);
    for (const position of lineup.missingPositions) {
      needed.add(isCornerOutfielder(position) ? "LF/RF" : position);
    }
    const needs = getRosterNeeds(manager.roster, draft);
    if (needs.starter) needed.add("SP");
    if (needs.bullpen) needed.add("RP");
    if (needs.hitter && !lineup.dhFilled) needed.add("DH");
  }
  return needed;
}

// Blue-to-red heat scale over winning bids (card points in snake drafts).
// Auction endpoints are fixed: 0 up to 15% of the starting budget, so colors
// mean the same thing all draft and a max-out bid clamps red.
// ---- dollars are not points ----
//
// An auction budget and a card's printed points were both bare numbers, and a
// manager reading "480" on a chip had no way of knowing whether that was what a
// card is worth or what somebody paid for it. They are different currencies and
// they now look it: a card costs points, a bid costs dollars.
function money(amount) {
  return `$${Number(amount ?? 0).toLocaleString()}`;
}

function draftHeatScale(draft) {
  const auction = isAuctionDraft(draft);
  if (auction && heatBy() === "price") {
    const budget = draft.auction.budget ?? AUCTION_DEFAULT_BUDGET;
    return { lo: 0, hi: Math.max(1, Math.round(budget * 0.15)), auction, by: "price" };
  }
  const points = draft.pool.map((player) => player.points).sort((a, b) => a - b);
  const lo = quantileOf(points, 0.1);
  return { lo, hi: Math.max(quantileOf(points, 0.9), lo + 10), auction, by: "points" };
}

function quantileOf(sorted, q) {
  if (!sorted.length) return 0;
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return Math.round(sorted[lower] * (1 - weight) + sorted[upper] * weight);
}

// Hue path 215 (cool blue) through purple to 360 (red).
// ---- the heat scale ----
//
// It used to walk the hue wheel from blue to red, which passes through purple —
// and a purple at fifteen per cent lightness on a black board is a colour you
// cannot see, let alone rank. Every middling card came out the same murky
// aubergine and the scale said nothing.
//
// A diverging ramp instead: cold blue, through a bright bone at the average, to
// a hot red. The middle is the lightest point rather than the muddiest, so the
// eye reads distance from average, which is the only thing the scale was ever
// trying to say.
// The ramp lives inside the function that uses it. A `const` at module scope
// would sit in the temporal dead zone when the board paints itself on load —
// this file renders a screen on its way down, long before its tail has run.
function heatColor(t) {
  const cold = [46, 104, 196];
  const mid = [240, 237, 228];
  const hot = [190, 42, 40];
  const [from, to, local] = t < 0.5 ? [cold, mid, t / 0.5] : [mid, hot, (t - 0.5) / 0.5];
  return [0, 1, 2].map((index) => Math.round(from[index] + (to[index] - from[index]) * local));
}

function heatHex([r, g, b]) {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

// A bone-white cell cannot carry white lettering, and a deep blue one cannot
// carry black. The colour brings its own ink.
function readableInk(rgb) {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.42 ? "#181510" : "#ffffff";
}

function heatStyle(value, scale) {
  if (value === undefined || value === null) return "";
  const t = Math.max(0, Math.min(1, (value - scale.lo) / Math.max(1, scale.hi - scale.lo)));
  const rgb = heatColor(t);
  return `--heat-c:${heatHex(rgb)};--heat-ink:${readableInk(rgb)}`;
}

// In an auction a card carries two numbers — what it is worth, and what somebody
// paid — and they are not the same story. What a manager wants to see depends on
// what he is asking: "who is holding the good cards" is a question about points,
// "who blew their budget" is a question about dollars. So the board answers
// whichever one is asked, and says which it is answering.
//
// A snake draft has no dollars, so it has no question and no toggle.
function heatBy() {
  return state.heatBy === "points" ? "points" : "price";
}

function heatValue(player, scale, prices) {
  if (!scale.auction) return player.points;
  return heatBy() === "points" ? player.points : prices?.get(player.id);
}

function renderHeatLegend(scale) {
  const dollars = scale.by === "price";
  const show = (value) => (dollars ? money(value) : `${value}`);
  const toggle = scale.auction
    ? `<button type="button" class="heat-toggle" data-action="heat-by" data-heat-by="${dollars ? "points" : "price"}" title="Colour the board by ${dollars ? "what the cards are worth" : "what they cost"}">
        <span class="${dollars ? "on" : ""}">$ paid</span><span class="${dollars ? "" : "on"}">pts</span>
      </button>`
    : "";
  // A blind draft keeps the colour but drops the numeric points scale — the bar
  // still reads weaker-to-stronger, it just doesn't put a number on it.
  const numbersHidden = !dollars && pointsHidden();
  const lo = numbersHidden ? "" : `${dollars ? "" : "pts "}${show(scale.lo)}`;
  const hi = numbersHidden ? "" : `${show(scale.hi)}+`;
  return `<span class="heat-legend" aria-label="Colour scale for ${dollars ? "winning bids" : "card points"}">
    ${toggle}
    <em>${lo}</em>
    <i class="heat-bar"></i>
    <em>${hi}</em>
  </span>`;
}

// Floating rival boards: every other team pinned to the bottom edge so nobody
// scrolls mid-auction to see what the room has done.
function renderRosterDock(draft, viewerId) {
  // Everyone gets a bar, with the viewer's own team pinned to the top row.
  const ordered = [
    ...draft.managers.filter((manager) => manager.id === viewerId),
    ...draft.managers.filter((manager) => manager.id !== viewerId)
  ];
  if (!ordered.length) return "";
  const collapsed = state.rosterDock === "collapsed";
  const auction = isAuctionDraft(draft);
  const prices = auction
    ? new Map(draftHistory(draft).map((pick) => [pick.player.id, pick.price]))
    : null;
  const heatScale = draftHeatScale(draft);
  // The "you" tag hangs off the same answer the rest of the screen uses, so it
  // cannot end up pinned to a manager the app no longer thinks is you.
  const ownTag = viewerManager(draft) ? "you" : "";
  const bars = collapsed
    ? ""
    : ordered
        .map((manager) => renderDockBar(draft, manager, auction, prices, heatScale, { own: manager.id === viewerId, ownTag }))
        .join("");
  return `<div class="roster-dock-spacer${collapsed ? " collapsed" : ""}"></div>
  <aside class="roster-dock${collapsed ? " collapsed" : ""}" aria-label="Team rosters">
    <div class="dock-top">
      <button type="button" class="dock-toggle" data-action="toggle-dock">${collapsed ? "Show rival boards &#9650;" : "Hide &#9660;"}</button>
      ${collapsed ? "" : renderHeatLegend(heatScale)}
    </div>
    ${bars ? `<div class="dock-bars">${bars}</div>` : ""}
  </aside>`;
}

function renderDockBar(draft, manager, auction, prices, heatScale, { own = false, ownTag = "" } = {}) {
  // This strip is an ownership board, not the manager's private depth chart.
  // Keep showing every drafted card in the usual compact slots even if that
  // manager has deliberately left one of their playable slots open.
  const lineupSlots = assignLineupSlots(manager.roster).slots;
  const staffSlots = assignPlayersToSlots(
    manager.roster.filter((player) => player.kind === "pitcher"),
    [...Array.from({ length: draft.startingPitchers }, () => "SP"), "RP", "RP"],
    (player) => player.role
  ).slots;
  const slots = [...lineupSlots, ...staffSlots]
    .map((slot) => renderDockSlot(slot.player, slot.label, auction, prices, heatScale))
    .join("");
  return `<div class="dock-bar${own ? " own-bar" : ""}">
    <span class="dock-team">${escapeHtml(manager.name)}${own && ownTag ? ` <em class="own-tag">${escapeHtml(ownTag)}</em>` : ""}</span>
    <div class="dock-slots">${slots}</div>
  </div>`;
}

function renderDockSlot(player, label, auction, prices, heatScale) {
  if (!player) {
    return `<span class="dock-slot empty-dock-slot"><small>${escapeHtml(label)}</small><span>open</span></span>`;
  }
  const tag = auction
    ? (heatBy() === "points" ? (pointsHidden() ? undefined : `${player.points} pts`) : money(prices.get(player.id)))
    : undefined;
  return `<span class="dock-slot heat player-name-preview" style="${heatStyle(heatValue(player, heatScale, prices), heatScale)}" tabindex="0" data-preview-id="dockslot-${escapeHtml(player.id)}" data-preview-card="${escapeHtml(previewCard(player))}">
    <small>${escapeHtml(label)}${tag !== undefined ? ` &middot; ${tag}` : ""}</small>
    <span>${escapeHtml(dockChipName(player))}</span>
  </span>`;
}



function dockChipName(player) {
  const match = player.name.match(/^(\S+)\s+(.+)$/);
  if (!match) return player.name;
  return `${match[1][0]}. ${match[2]}`;
}

function dockNeedsSummary(manager) {
  const needs = getRosterNeeds(manager.roster, state.draft);
  const lineup = lineupStatus(manager.roster);
  const parts = [...lineup.missingPositions];
  if (needs.starter) parts.push(`${needs.starter}SP`);
  if (needs.bullpen) parts.push(`${needs.bullpen}RP`);
  return parts.join(" ");
}

// Two different questions, and they were being answered by the same manager:
// WHO IS ON THE CLOCK — which belongs to the room — and WHOSE BOARD IS THIS,
// which belongs to you. Conflating them meant a seated player watched somebody
// else's roster all draft and could never reach their own.
function renderDraftFocus(draft, clockManager, boardManager = clockManager) {
  // The roster tabs default to your own board, but a toggle can pin anyone
  // else's roster to browse it. Only the owner's roster stays editable.
  const shown = draft.managers.find((entry) => entry.id === state.rosterManagerId) ?? boardManager;
  const manager = shown;
  const auction = isAuctionDraft(draft);
  const queued = isRandomNomination(draft);
  const lot = auction ? draft.auction.lot : null;
  const totalPoints = manager.roster.reduce((sum, player) => sum + player.points, 0);
  const fieldingSums = lineupFieldingSums(manager);
  // A random-nomination room runs on the length of the queue, not on a roster
  // count — the draft ends when the last card has come up, however many cards
  // anybody has bought by then.
  const queueTotal = queued ? draft.auction.queue.length : 0;
  const totalPicks = queued ? queueTotal : draft.managers.length * draft.rosterSize;
  const lotNumber = queued ? draft.auction.queueIndex + 1 : draft.pickNumber + 1;
  const eyebrow = draft.complete
    ? "Roster view"
    : auction
      ? `Lot ${Math.min(lotNumber, totalPicks)} of ${totalPicks}`
      : `Round ${draftPickInfo(draft).round}, pick ${draftPickInfo(draft).pickInRound}`;
  const heading = draft.complete
    ? `${escapeHtml(shown.name)} roster`
    : queued
      ? lot
        ? "A card is on the block"
        : "The queue deals the next card"
      : auction
        ? lot
          ? `${escapeHtml(clockManager.name)} has a card on the block`
          : `${escapeHtml(clockManager.name)} nominates next`
        : `${escapeHtml(clockManager.name)} is on the clock`;
  const nextNames = (auction ? upcomingNominators(draft, 5).slice(1) : upcomingManagers(draft, 4))
    .map((item) => escapeHtml(item.name))
    .join(" · ");
  // The board can run dry on a scarce slot — the last catcher taken while this
  // seat still needs one. There is nothing legal left to pick, so tell him the
  // one move he has: Auto-pick prints a replacement-level fill-in for the hole.
  const stallNotice = !auction && !draft.complete && currentManagerMustReplace(draft)
    ? `<p class="next-up stall-notice">The board is out of cards for ${escapeHtml(clockManager.name)}'s open ${escapeHtml(dockNeedsSummary(clockManager) || "slot")} &mdash; Auto-pick hands out a replacement-level fill-in.</p>`
    : "";
  return `<section class="panel draft-focus">
    <div class="draft-focus-main">
      <p class="eyebrow">${eyebrow}</p>
      <h1>${heading}</h1>
      <div class="draft-metrics">
        <span>${queued ? `${draft.auction.queueIndex}/${queueTotal} lots called` : `${draft.pickNumber}/${totalPicks} ${auction ? "cards sold" : "picks made"}`}</span>
        ${queued ? `<span>${manager.roster.length} cards</span>` : ""}
        ${auction ? `<span>${money(auctionBudget(draft, manager))} budget left</span>` : ""}
        ${pointsHidden() ? "" : `<span>${totalPoints} pts</span>`}
        <span>IF ${formatSignedNumber(fieldingSums.infield)}</span>
        <span>OF ${formatSignedNumber(fieldingSums.outfield)}</span>
      </div>
      ${stallNotice}
      ${snakeClocksHtml(draft)}
      ${draft.complete || !nextNames ? "" : `<p class="next-up">${auction ? "Nominates after" : "Next"}: ${nextNames}</p>`}
    </div>
    <div class="roster-view">
      ${renderRosterManagerToggle(draft, shown)}
      <div class="game-tabs roster-tabs">
        <button class="game-tab ${state.rosterTab === "order" ? "" : "active"}" data-action="roster-tab" data-tab="roster">Roster</button>
        <button class="game-tab ${state.rosterTab === "order" ? "active" : ""}" data-action="roster-tab" data-tab="order">Batting order</button>
      </div>
      ${renderRosterAdoptNotice(draft, shown)}
      ${state.rosterTab === "order" ? renderBattingOrder(manager) : renderRosterSlots(manager, draft)}
    </div>
  </section>`;
}

// A pill per manager so you can flip through everyone's roster from your own
// seat; the owned seat is tagged "you". Hidden online, where the roster dock and
// the seat you claimed already answer whose board you are looking at.
function renderRosterManagerToggle(draft, shown) {
  if (state.online || draft.managers.length < 2) return "";
  const owner = viewerManager(draft);
  const pills = draft.managers
    .map((manager) => `<button type="button"
      class="game-tab ${manager.id === shown.id ? "active" : ""}"
      data-action="roster-manager"
      data-manager-id="${escapeHtml(manager.id)}"
      role="tab"
      aria-selected="${manager.id === shown.id ? "true" : "false"}"
    >${escapeHtml(manager.name)}${owner && manager.id === owner.id ? ' <em class="roster-you">you</em>' : ""}${manager.cpu ? ' <span class="roster-cpu-tag">CPU</span>' : ""}</button>`)
    .join("");
  return `<div class="game-tabs roster-manager-tabs" role="tablist" aria-label="Whose roster to view">${pills}</div>`;
}

// Whose seat this is, and whether you can claim it:
//   - your own seat: nothing to say.
//   - someone else's, when you hold a seat at a table with humans: read-only.
//   - a shared all-human hotseat: it is meant to run every seat, so stay quiet.
//   - an all-computer table: there is no "you" at all, so offer to adopt the
//     shown team. Owning a seat is what lets you field a lineup and run the sim
//     as a manager rather than a spectator — and you can re-adopt to switch.
function renderRosterAdoptNotice(draft, shown) {
  if (state.online) return "";
  const owner = viewerManager(draft);
  if (owner && owner.id === shown.id) return "";
  const allCpu = draft.managers.every((manager) => manager.cpu);
  if (owner && !allCpu) {
    return `<div class="roster-adopt roster-adopt-readonly"><span>Viewing ${escapeHtml(shown.name)}'s roster &mdash; read-only.</span></div>`;
  }
  if (!owner && !allCpu) return "";
  return `<div class="roster-adopt">
    <span>${owner ? `Viewing ${escapeHtml(shown.name)}'s roster.` : "No seat is yours yet."} Adopt a team to set its lineup and play as it.</span>
    <button type="button" class="small" data-action="adopt-manager" data-manager-id="${escapeHtml(shown.id)}">Make ${escapeHtml(shown.name)} my team</button>
  </div>`;
}

// The nine who bat, in the order they bat. Default is the order the lineup
// slots happen to be listed in — catcher first, which nobody has ever wanted —
// so this is where you fix it. Drag a man up and everyone below him shuffles
// down; the order rides along into the sim and into a played game.
function renderBattingOrder(manager) {
  const lineup = battingLineup(manager);
  const mine = canManageRoster(manager.id);
  if (!lineup.length) {
    return `<p class="empty">Draft nine hitters and they will line up here.</p>`;
  }
  const tiles = lineup
    .map((player, index) => `<button type="button"
      class="order-tile ${mine ? "" : "readonly-slot"} ${selectedOrderMove?.playerId === player.id ? "selected-slot" : ""}"
      data-order-tile="true"
      data-manager-id="${escapeHtml(manager.id)}"
      data-player-id="${escapeHtml(player.id)}"
      data-order-index="${index}"
      ${mine ? 'draggable="true"' : "disabled"}
      data-preview-id="order-${escapeHtml(manager.id)}-${escapeHtml(player.id)}"
      data-preview-card="${escapeHtml(previewCard(player))}"
    >
      <strong>${index + 1}</strong>
      <span>${escapeHtml(player.name)}</span>
      <em>${escapeHtml(playerPosition(player))} &middot; OB ${player.onBase} &middot; SPD ${player.speed}${pointsHidden() ? "" : ` &middot; ${player.points} pts`}</em>
    </button>`)
    .join("");
  return `<div class="batting-order" aria-label="${escapeHtml(manager.name)} batting order">
    <span class="order-hint">${mine ? "Drag a hitter to bat them sooner" : "Batting order"}</span>
    <div class="order-list">${tiles}</div>
  </div>`;
}

// The nine active bats, in the order they will come up.
function battingLineup(manager) {
  const lineup = assignLineupSlots(manager.roster, manager.lineupAssignments).slots
    .filter((slot) => slot.player)
    .map((slot) => slot.player);
  return applyBattingOrder(lineup, manager.battingOrder);
}

// Move a hitter to a spot in the order; everyone in between shuffles along.
function moveBattingOrder(managerId, playerId, toIndex) {
  const manager = findDraftManager(managerId);
  if (!manager || !canManageRoster(managerId)) return false;
  const order = battingLineup(manager).map((player) => player.id);
  const from = order.indexOf(playerId);
  if (from < 0 || toIndex < 0 || toIndex >= order.length || from === toIndex) return false;
  order.splice(from, 1);
  order.splice(toIndex, 0, playerId);
  if (state.online) {
    sendOnlineAction({ type: "batting-order", managerId, order });
    return true;
  }
  manager.battingOrder = order;
  return true;
}

function renderRosterSlots(manager, draft) {
  const hitterSlots = assignHittersToLineupSlots(manager);
  const staffSlots = assignStaffSlots(manager.roster, manager.staffAssignments, draft);
  // Everything drafted that is not in the active roster. On a capped roster this is
  // empty; on an unlimited one it is where the manager chooses their team.
  const bench = benchPlayers(manager);
  const mine = canManageRoster(manager.id);
  return `<div class="roster-board" aria-label="${escapeHtml(manager.name)} drafted cards">
    <div class="slot-group">
      <span>Lineup</span>
      <div class="slot-grid lineup-slots">${hitterSlots.slots.map((slot) => renderRosterSlot(slot.player, slot.label, manager)).join("")}</div>
    </div>
    <div class="slot-group">
      <span>Staff</span>
      <div class="slot-grid staff-slots">${staffSlots.map((slot) => renderRosterSlot(slot.player, slot.label, manager)).join("")}</div>
    </div>
    ${mine || bench.length ? `<div class="slot-group bench-group">
      <span>Bench${bench.length ? ` &middot; ${bench.length} inactive` : ""}${mine ? " &mdash; drag a player here to keep their slot open" : ""}</span>
      <div class="slot-grid bench-slots">
        ${mine ? renderBenchDropZone(manager) : ""}
        ${bench.map((player) => renderBenchCard(player, manager)).join("")}
      </div>
    </div>` : ""}
  </div>`;
}

function renderBenchDropZone(manager) {
  const selected = selectedLineupMove?.managerId === manager.id;
  const valid = selected && canMoveLineupPlayer(manager.id, selectedLineupMove.playerId, "BENCH");
  return `<button type="button"
    class="roster-slot bench-drop-zone empty-slot ${valid ? "valid-drop-slot" : selected ? "invalid-drop-slot" : ""}"
    data-lineup-slot="true"
    data-manager-id="${escapeHtml(manager.id)}"
    data-slot-label="BENCH"
    ${valid ? 'aria-label="Move selected player to the bench"' : ""}
  >
    <strong>Bench</strong>
    <span>Drop player here</span>
    <em>Keeps their slot open</em>
  </button>`;
}

// A drafted card that is not taking the field. Drag it onto a slot it can fill
// and it takes that slot; whoever was there goes to the bench in its place.
function renderBenchCard(player, manager) {
  const mine = canManageRoster(manager.id);
  const selected = selectedLineupMove?.playerId === player.id && selectedLineupMove?.managerId === manager.id;
  return `<button type="button"
    class="roster-slot bench-slot ${player.kind === "pitcher" ? "pitcher-slot" : "hitter-slot"} ${selected ? "selected-slot" : ""} ${mine ? "" : "readonly-slot"}"
    data-lineup-slot="true"
    data-manager-id="${escapeHtml(manager.id)}"
    data-slot-label="BENCH"
    ${mine ? "" : "disabled"}
    data-player-id="${escapeHtml(player.id)}"
    data-preview-id="bench-${escapeHtml(manager.id)}-${escapeHtml(player.id)}"
    data-preview-card="${escapeHtml(previewCard(player))}"
    ${mine ? 'draggable="true"' : ""}
  >
    <strong>${escapeHtml(player.kind === "pitcher" ? pitcherRoleOf(player) : playerPosition(player))}</strong>
    <span>${escapeHtml(player.name)}</span>
    ${pointsHidden() ? "" : `<em>${player.points} pts</em>`}
  </button>`;
}

function pitcherRoleOf(player) {
  return player.role === "SP" ? "SP" : "RP";
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
  const mine = canManageRoster(manager.id);
  const selected = selectedLineupMove?.managerId === manager.id;
  const isSelectedPlayer = selected && player?.id === selectedLineupMove.playerId;
  const isValidTarget = selected && canMoveLineupPlayer(manager.id, selectedLineupMove.playerId, slotLabel);
  const isInvalidTarget = selected && !isValidTarget;
  const classes = [
    "roster-slot",
    player ? "filled-slot hitter-slot" : "empty-slot",
    isSelectedPlayer ? "selected-slot" : "",
    isValidTarget ? "valid-drop-slot" : "",
    isInvalidTarget ? "invalid-drop-slot" : "",
    mine ? "" : "readonly-slot"
  ]
    .filter(Boolean)
    .join(" ");
  const description = player ? rosterSlotDescription(player, slotLabel) : "open";
  return `<button type="button"
    class="${classes}"
    data-lineup-slot="true"
    data-manager-id="${escapeHtml(manager.id)}"
    data-slot-label="${escapeHtml(slotLabel)}"
    ${mine ? "" : "disabled"}
    ${player && mine ? `data-player-id="${escapeHtml(player.id)}" draggable="true"` : player ? `data-player-id="${escapeHtml(player.id)}"` : ""}
    ${player ? `data-preview-id="slot-${escapeHtml(manager.id)}-${escapeHtml(player.id)}" data-preview-card="${escapeHtml(previewCard(player))}"` : ""}
    ${isValidTarget ? `aria-label="Move selected player to ${escapeHtml(slotLabel)}"` : ""}
  >
    <strong>${escapeHtml(slotLabel)}</strong>
    <span>${player ? escapeHtml(player.name) : "open"}</span>
    <em>${player ? `${escapeHtml(description)}${pointsHidden() ? "" : ` &middot; ${player.points} pts`}` : "open"}</em>
  </button>`;
}

function rosterSlotDescription(player, slotLabel) {
  if (player.kind === "pitcher") return playerPosition(player);
  if (slotLabel === "1B" && !playsPosition(player, "1B")) return `${player.position} at 1B | Field -1`;
  return playerPosition(player);
}

function handleLineupSlotClick(slot) {
  const managerId = slot.dataset.managerId;
  const playerId = slot.dataset.playerId;
  const slotLabel = slot.dataset.slotLabel;

  // Not your team, not your call.
  if (!canManageRoster(managerId)) {
    selectedLineupMove = null;
    return;
  }

  if (selectedLineupMove?.managerId === managerId && canMoveLineupPlayer(managerId, selectedLineupMove.playerId, slotLabel)) {
    moveLineupPlayer(managerId, selectedLineupMove.playerId, slotLabel);
    selectedLineupMove = null;
    invalidateBatch();
    saveState();
    renderDraft();
    return;
  }

  const player = playerId ? findRosterPlayer(managerId, playerId) : null;
  if (player) {
    selectedLineupMove = { managerId, playerId, fromSlot: slotLabel };
  } else {
    selectedLineupMove = null;
  }
  renderDraft();
}

// Your team is yours. Online, that means the seat you are sitting in; on a
// hotseat everybody shares the screen, so everybody may move everything.
// This gates the AFFORDANCE, not just the move: a card you cannot move must
// not pick up, must not highlight, must not look for a moment like it went
// somewhere. The rule was already enforced on the way out — but only after
// you had dragged another manager's shortstop across his infield.
// Which manager is YOU — and it has to outlive the online session.
//
// When a room ends, the online block is cleared, and "you" used to fall back to
// whoever was on the clock. For a FINISHED draft that is manager one. So a room
// of one human and eight computers decided, the moment the last pick was made,
// that you were the computer sitting in seat one — and handed you his lineup to
// set. Manager ids are positional (team-1, team-2), so the seat you held is not
// something the draft itself remembers about you: it has to be remembered here.
//
// Three answers, in order of how much they know:
//   the seat you are sitting in right now, if the room is still live
//   the seat you sat in, remembered from when you claimed it
//   the only human at the table, which a nine-seat room with eight computers
//     in it can always answer
function viewerManager(draft) {
  if (!draft?.managers?.length) return null;
  const byId = (id) => (id ? draft.managers.find((manager) => manager.id === id) : null);
  const seated = byId(state.online?.managerId);
  if (seated) return seated;
  const remembered = byId(state.myManagerId);
  if (remembered) return remembered;
  const humans = draft.managers.filter((manager) => !manager.cpu);
  return humans.length === 1 ? humans[0] : null;
}

// Online you may only touch your own seat. Offline, when the table has a clear
// owner — the seat you claimed, or the only human among computers — that owner's
// roster is the one you edit; everyone else's is there to browse, not change. A
// table with no owner at all (a shared hotseat, or an all-computer room before
// anyone has adopted a seat) stays fully editable, the way a hotseat always was.
function canManageRoster(managerId) {
  if (state.online) return managerId === state.online.managerId;
  const owner = viewerManager(state.draft);
  if (owner) return managerId === owner.id;
  return true;
}

const isStaffSlot = (label) => staffSlotLabels(state.draft?.startingPitchers).includes(label);

// Can this card go in that slot? Works for a card already on the field and for
// one sitting on the bench — the bench is where an unlimited roster keeps the
// cards it bought and did not start.
function canMoveLineupPlayer(managerId, playerId, toLabel) {
  if (!canManageRoster(managerId)) return false;
  const manager = findDraftManager(managerId);
  const player = findRosterPlayer(managerId, playerId);
  if (!manager || !player) return false;

  if (toLabel === "BENCH") {
    const slots = player.kind === "pitcher"
      ? assignStaffSlots(manager.roster, manager.staffAssignments, state.draft)
      : assignLineupSlots(manager.roster, manager.lineupAssignments).slots;
    return slots.some((slot) => slot.player?.id === playerId);
  }

  if (isStaffSlot(toLabel)) {
    if (player.kind !== "pitcher") return false;
    const slots = assignStaffSlots(manager.roster, manager.staffAssignments, state.draft);
    const target = slots.find((slot) => slot.label === toLabel);
    if (!target || target.player?.id === playerId) return false;
    // An arm only fills the kind of slot it is: a closer does not start.
    return (player.role === "SP" ? "SP" : "RP") === target.role;
  }

  if (player.kind !== "hitter") return false;
  const slots = assignLineupSlots(manager.roster, manager.lineupAssignments).slots;
  const fromSlot = slots.find((slot) => slot.player?.id === playerId);
  const targetSlot = slots.find((slot) => slot.label === toLabel);
  if (!targetSlot || fromSlot?.label === toLabel) return false;
  if (!canPlayerFillLineupSlot(player, toLabel)) return false;
  // A swap between two slots has to work both ways. A bench bat displacing a
  // starter does not — the starter just goes to the bench.
  if (fromSlot && targetSlot.player && !canPlayerFillLineupSlot(targetSlot.player, fromSlot.label)) return false;
  return true;
}

function moveLineupPlayer(managerId, playerId, toLabel) {
  const manager = findDraftManager(managerId);
  if (!manager || !canMoveLineupPlayer(managerId, playerId, toLabel)) return false;

  const player = findRosterPlayer(managerId, playerId);
  const staffMove = player.kind === "pitcher";
  const actionType = staffMove ? "staff" : "lineup";
  const previous = staffMove ? manager.staffAssignments : manager.lineupAssignments;
  const slots = staffMove
    ? assignStaffSlots(manager.roster, previous, state.draft)
    : assignLineupSlots(manager.roster, previous).slots;
  const fromSlot = slots.find((slot) => slot.player?.id === playerId);
  let assignments = rosterAssignmentsFromSlots(slots, previous);

  if (toLabel === "BENCH") {
    if (!fromSlot) return false;
    assignments[fromSlot.label] = null;
    assignments = withBenchIds(assignments, [...assignmentBenchIds(assignments), playerId]);
    return commitRosterAssignments(manager, actionType, assignments);
  }

  if (isStaffSlot(toLabel)) {
    const targetSlot = slots.find((slot) => slot.label === toLabel);
    assignments[toLabel] = playerId;
    if (fromSlot) {
      // Two arms on the field trade places.
      if (targetSlot.player) assignments[fromSlot.label] = targetSlot.player.id;
      else assignments[fromSlot.label] = null;
    } else if (targetSlot.player) {
      assignments = withBenchIds(assignments, [...assignmentBenchIds(assignments), targetSlot.player.id]);
    }
    assignments = withBenchIds(assignments, assignmentBenchIds(assignments).filter((id) => id !== playerId));
    return commitRosterAssignments(manager, actionType, assignments);
  }

  const targetSlot = slots.find((slot) => slot.label === toLabel);
  assignments[toLabel] = playerId;
  if (fromSlot) {
    if (targetSlot.player) assignments[fromSlot.label] = targetSlot.player.id;
    else assignments[fromSlot.label] = null;
  } else if (targetSlot.player) {
    assignments = withBenchIds(assignments, [...assignmentBenchIds(assignments), targetSlot.player.id]);
  }
  assignments = withBenchIds(assignments, assignmentBenchIds(assignments).filter((id) => id !== playerId));

  const cleaned = cleanLineupAssignments(manager, assignments);
  return commitRosterAssignments(manager, actionType, cleaned);
}

function assignmentBenchIds(assignments) {
  return Array.isArray(assignments?.[ROSTER_BENCH_KEY]) ? assignments[ROSTER_BENCH_KEY] : [];
}

function withBenchIds(assignments, playerIds) {
  const unique = [...new Set(playerIds)];
  if (unique.length) assignments[ROSTER_BENCH_KEY] = unique;
  else delete assignments[ROSTER_BENCH_KEY];
  return assignments;
}

function rosterAssignmentsFromSlots(slots, previous = {}) {
  const assignments = {};
  for (const slot of slots) {
    if (slot.player) assignments[slot.label] = slot.player.id;
    else if (Object.prototype.hasOwnProperty.call(previous ?? {}, slot.label) && previous[slot.label] === null) {
      assignments[slot.label] = null;
    }
  }
  return withBenchIds(assignments, assignmentBenchIds(previous));
}

function commitRosterAssignments(manager, actionType, assignments) {
  if (state.online) {
    sendOnlineAction({ type: actionType, managerId: manager.id, assignments });
    return true;
  }
  if (actionType === "staff") manager.staffAssignments = assignments;
  else manager.lineupAssignments = assignments;
  return true;
}

function cleanLineupAssignments(manager, assignments) {
  const rosterIds = new Set(manager.roster.filter((player) => player.kind === "hitter").map((player) => player.id));
  const clean = {};
  for (const [label, playerId] of Object.entries(assignments ?? {})) {
    if (label === ROSTER_BENCH_KEY) continue;
    if (playerId === null) {
      clean[label] = null;
      continue;
    }
    const player = manager.roster.find((item) => item.id === playerId);
    if (rosterIds.has(playerId) && canPlayerFillLineupSlot(player, label)) clean[label] = playerId;
  }
  withBenchIds(clean, assignmentBenchIds(assignments).filter((playerId) => rosterIds.has(playerId)));
  return clean;
}

function findDraftManager(managerId) {
  return state.draft?.managers.find((manager) => manager.id === managerId);
}

function findRosterPlayer(managerId, playerId) {
  return findDraftManager(managerId)?.roster.find((player) => player.id === playerId);
}

function renderFilters() {
  // Pure DHs only exist in card sets that print them — no deck from the
  // dead-ball decades has one, so the filter doesn't offer an empty shelf.
  const hasDesignatedHitters = state.draft?.pool.some((player) => player.position === "DH");
  const positions = state.filters.type === "pitcher"
    ? ["all", "SP", "RP"]
    : ["all", "C", "1B", "2B", "3B", "SS", "LF/RF", "CF", ...(hasDesignatedHitters ? ["DH"] : [])];
  const sortOptions = [
    // A blind draft drops "best points": there is no points column to sort on.
    ...(pointsHidden() ? [] : [["points", "Best points"]]),
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
  // The watchlist button names its owner, because at a shared screen the list on
  // the board belongs to whoever is on the clock — not to whoever is holding the
  // mouse. It only appears when there is somebody to own it.
  // The count is what is still gettable. A card that has been drafted stays on
  // the manager's list — undo a pick and it comes back — but it is nothing he
  // can act on, so it does not pad the number on the button.
  const owner = watchlistOwner();
  const gettable = (ids) => state.draft
    ? ids.filter((id) => !state.draft.pickedIds.has(id)).length
    : ids.length;
  const list = owner ? (state.starred[owner.id] ?? []) : [];
  const starCount = gettable(list);
  const starFilter = owner
    ? `<button type="button" class="star-filter${state.filters.starredOnly ? " active" : ""}" data-action="toggle-starred-only" aria-pressed="${state.filters.starredOnly}" title="${state.filters.starredOnly ? "Show every card" : `Show only the cards ${owner.name} is watching`}">
        <span class="star-filter-mark">${starCount ? "★" : "☆"}</span>
        <span>${escapeHtml(owner.name)}'s list</span>
        ${starCount ? `<span class="star-filter-count">${starCount}</span>` : ""}
      </button>`
    : "";
  const flagList = owner ? (state.flagged[owner.id] ?? []) : [];
  const flagCount = gettable(flagList);
  const flagFilter = owner
    ? `<button type="button" class="star-filter flag-filter${state.filters.flaggedOnly ? " active" : ""}" data-action="toggle-flagged-only" aria-pressed="${state.filters.flaggedOnly}" title="${state.filters.flaggedOnly ? "Show every card" : `Show only the cards ${owner.name} has flagged`}">
        <span class="star-filter-mark">${flagCount ? "⚑" : "⚐"}</span>
        <span>Flagged</span>
        ${flagCount ? `<span class="star-filter-count">${flagCount}</span>` : ""}
      </button>`
    : "";

  return `<div class="filters">
    <div class="type-filter" role="group" aria-label="Player type">
      ${typeOptions.map(([value, label]) => `<button type="button" class="type-pill ${state.filters.type === value ? "active" : ""}" data-filter="type" data-filter-value="${value}">${label}</button>`).join("")}
    </div>
    ${starFilter}
    ${flagFilter}
    <label class="filter-position">
      Position
      <select data-filter="position">
        ${positions.map((position) => `<option value="${position}" ${state.filters.position === position ? "selected" : ""}>${position}</option>`).join("")}
      </select>
    </label>
    <label class="filter-sort">
      Sort
      <select data-filter="sort">
        ${displayedSortOptions.map(([value, label]) => `<option value="${value}" ${state.filters.sort === value ? "selected" : ""}>${label}</option>`).join("")}
      </select>
    </label>
    <label class="filter-search">
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

// ---- the watchlist ----
//
// A star is a private note a manager makes to himself: the cards he is watching
// while the board moves. It is not a claim on anything — starring a card does
// not hold it, and anyone else can still take it.
//
// The list belongs to a manager, not to the room, so the board shows whoever's
// turn it is: online that is the seat you are sitting in, and at a shared screen
// it is the manager on the clock, which is the person actually looking at it.
// Nobody's stars are sent to the room server.
function normalizeStarred(value) {
  if (!value || typeof value !== "object") return {};
  const clean = {};
  for (const [managerId, ids] of Object.entries(value)) {
    if (!Array.isArray(ids)) continue;
    const list = ids.filter((id) => typeof id === "string");
    if (list.length) clean[managerId] = [...new Set(list)];
  }
  return clean;
}

// Whose stars the board is showing, or null when nobody owns them — a spectator
// online, or a finished draft with nobody left on the clock.
function watchlistOwner() {
  const draft = state.draft;
  if (!draft) return null;
  if (state.online) {
    if (!state.online.managerId) return null;
    return draft.managers.find((manager) => manager.id === state.online.managerId) ?? null;
  }
  // The board is yours whenever you have a seat, so you can build your own list
  // while another manager is up — being the one running the room does not hand
  // you their watchlist. Only an anonymous hotseat (no seat picked, more than
  // one human) lets it follow whoever is on the clock around the table.
  return viewerManager(draft) ?? currentManager(draft);
}

function starredIds() {
  const owner = watchlistOwner();
  if (!owner) return new Set();
  return new Set(state.starred[owner.id] ?? []);
}

function toggleStar(playerId) {
  const owner = watchlistOwner();
  if (!owner) return;
  const list = state.starred[owner.id] ?? [];
  // A new star joins the bottom of the board. The order is the whole point now,
  // so a card never jumps the queue just by being clicked.
  const next = list.includes(playerId)
    ? list.filter((id) => id !== playerId)
    : [...list, playerId];
  if (next.length) state.starred[owner.id] = next;
  else delete state.starred[owner.id];
}

// The flag is a second shortlist, owned and toggled exactly like the stars.
function flaggedIds() {
  const owner = watchlistOwner();
  if (!owner) return new Set();
  return new Set(state.flagged[owner.id] ?? []);
}

function toggleFlag(playerId) {
  const owner = watchlistOwner();
  if (!owner) return;
  const list = state.flagged[owner.id] ?? [];
  const next = list.includes(playerId)
    ? list.filter((id) => id !== playerId)
    : [...list, playerId];
  if (next.length) state.flagged[owner.id] = next;
  else delete state.flagged[owner.id];
}

// ---- the big board ----
//
// The watchlist, in the order you actually want them. Its one real job is the
// clock: when yours runs out, the room takes the top name still standing on your
// board instead of guessing on your behalf. Stepping away costs you nothing.
function moveOnBoard(playerId, delta) {
  const owner = watchlistOwner();
  if (!owner) return;
  const list = [...(state.starred[owner.id] ?? [])];
  const from = list.indexOf(playerId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= list.length) return;
  [list[from], list[to]] = [list[to], list[from]];
  state.starred[owner.id] = list;
}

// The board in rank order, each card carried along with whether it is still
// gettable — a drafted card keeps its place (undo brings it back) but is plainly
// out of reach.
function bigBoard(manager, draft) {
  if (!manager || !draft) return [];
  const byId = new Map(draft.pool.map((player) => [player.id, player]));
  // An auction has no slot to be blocked out of. You do not take a card, you
  // BUY one, and what stops you is the money — so the badge that says a card
  // will not fit never lights, and saying nothing is exactly right.
  const slots = !isAuctionDraft(draft);
  return (state.starred[manager.id] ?? [])
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((player) => {
      const legality = slots ? canPickPlayer(draft, manager, player) : { ok: true, reason: "" };
      return {
        player,
        gone: draft.pickedIds.has(player.id),
        legal: legality.ok,
        // Keep the REASON, not just the verdict. "No slot" was a lie by
        // omission: a pick is refused for several different reasons — your
        // lineup is full, you have to keep slots back for pitchers, the league
        // would run short — and being told the wrong one sends you hunting for
        // a bug in the rule that is not the rule that stopped you.
        reason: legality.reason
      };
    });
}

// The top card on a manager's board that he could actually take right now.
function boardPickId(draft, manager) {
  if (!manager || isAuctionDraft(draft)) return null;
  return bigBoard(manager, draft).find((entry) => !entry.gone && entry.legal)?.player.id ?? null;
}

// An expired clock, or a hand-waved "pick for me": consult the manager's board
// first, and only fall back to the computer's judgement when it has nothing to
// say. A computer's own seat has no board and never did.
function autopickTurn(draft) {
  const manager = draft.complete ? null : currentManager(draft);
  if (manager && !manager.cpu) {
    const id = boardPickId(draft, manager);
    if (id) {
      pickPlayer(draft, id);
      return;
    }
  }
  autopick(draft);
}

// ---- when the last pick lands ----
//
// Not a verdict. The simulator is the verdict, and it is one button away and
// nobody's lineup is set yet — a projection taken now would be a projection of a
// team nobody has finished building.
//
// This is a description. What did each manager actually walk away with: how fast
// is it, how well does it field, how much of the ball leaves the yard, and what
// is the rotation made of. All of it reads straight off the drafted roster, so
// it is true the moment the last one lands, and it does not pretend to know who
// wins.
// A hitter's chart, read as if it were a season: what the twenty faces do when
// the swing gets through. Not the on-base roll, not the pitcher — just the card.
// It is the closest thing a Showdown chart has to a slash line, and it is what
// separates a 12 on-base who singles from a 12 on-base who does not.
function chartOps(card) {
  let walks = 0;
  let singles = 0;
  let doubles = 0;
  let triples = 0;
  let homers = 0;
  for (const entry of card.chart ?? []) {
    const faces = chartSpan(entry);
    if (entry.result === "BB") walks += faces;
    else if (entry.result === "1B" || entry.result === "1B+") singles += faces;
    else if (entry.result === "2B") doubles += faces;
    else if (entry.result === "3B") triples += faces;
    else if (entry.result === "HR") homers += faces;
  }
  const hits = singles + doubles + triples + homers;
  const atBats = MAX_ROLL - walks;
  const obp = (hits + walks) / MAX_ROLL;
  const slg = atBats > 0 ? (singles + doubles * 2 + triples * 3 + homers * 4) / atBats : 0;
  return obp + slg;
}

const primaryFielding = (card) => (Array.isArray(card.fielding) ? card.fielding[0] : card.fielding) || 0;

// ---- grading against the pool ----
//
// A grade only means something if it is a grade of something. "Best defence at
// this table" is a fact about two other people; "your average glove is in the
// top tenth of every glove you could have drafted" is a fact about the roster.
// So every measure is placed against the pool the cards actually came out of.
//
// The comparison is card-for-card: the manager's average hitter against every
// hitter he could have had, his starters against every starter on the board. A
// pool of weak arms grades a weak rotation kindly, and it should — that was the
// board everybody was drafting from.
const POOL_MEASURES = {
  onBase: { of: "hitter", read: (card) => Number(card.onBase) || 0, better: "high" },
  chart: { of: "hitter", read: chartOps, better: "high" },
  speed: { of: "hitter", read: (card) => Number(card.speed) || 0, better: "high" },
  defence: { of: "hitter", read: primaryFielding, better: "high" },
  spControl: { of: "SP", read: (card) => Number(card.control) || 0, better: "high" },
  // An arm's chart is the other half of him, and it runs the other way: the
  // number is what the hitter does once the swing gets through, so the good ones
  // are small. Control says how often a batter has to read your chart at all;
  // the chart says what it costs him when he does. A 5-control starter who gives
  // up a homer on 18+ is not the same card as a 5-control starter who does not,
  // and one number was hiding the other.
  spChart: { of: "SP", read: chartOps, better: "low" },
  rpControl: { of: "RP", read: (card) => Number(card.control) || 0, better: "high" },
  rpChart: { of: "RP", read: chartOps, better: "low" }
};

let poolScaleCache = null;

function poolScales(draft) {
  const key = `${draft.seed}:${draft.pool.length}`;
  if (poolScaleCache?.key === key) return poolScaleCache.scales;

  const belongs = (card, of) =>
    of === "hitter" ? card.kind === "hitter" : card.kind === "pitcher" && (of === "SP" ? card.role === "SP" : card.role !== "SP");

  const scales = {};
  for (const [name, measure] of Object.entries(POOL_MEASURES)) {
    scales[name] = draft.pool
      .filter((card) => belongs(card, measure.of))
      .map(measure.read)
      .sort((a, b) => a - b);
  }
  poolScaleCache = { key, scales };
  return scales;
}

// Where a number sits among the cards it could have been. Ties count as half, so
// a pool where everybody is a 10 puts a 10 in the middle rather than the top.
function percentile(sorted, value) {
  if (!sorted.length) return 0.5;
  let below = 0;
  let equal = 0;
  for (const entry of sorted) {
    if (entry < value) below += 1;
    else if (entry === value) equal += 1;
  }
  return (below + equal / 2) / sorted.length;
}

const GRADE_BANDS = [
  [0.9, "A"],
  [0.7, "B"],
  [0.4, "C"],
  [0.18, "D"],
  [0, "F"]
];

function gradeFor(share) {
  return GRADE_BANDS.find(([floor]) => share >= floor)?.[1] ?? "F";
}

function teamComposition(manager, draft) {
  const scales = poolScales(draft);
  const bats = manager.roster.filter((card) => card.kind === "hitter");
  const arms = manager.roster.filter((card) => card.kind === "pitcher");
  const groups = {
    hitter: bats,
    SP: arms.filter((card) => card.role === "SP"),
    RP: arms.filter((card) => card.role !== "SP")
  };

  const graded = {};
  for (const [name, measure] of Object.entries(POOL_MEASURES)) {
    const cards = groups[measure.of];
    const value = cards.length
      ? cards.reduce((sum, card) => sum + measure.read(card), 0) / cards.length
      : 0;
    const place = percentile(scales[name], value);
    // A small number is the good one on a pitcher's chart, so the standing is
    // read from the other end of the board.
    const share = measure.better === "low" ? 1 - place : place;
    graded[name] = { value, share, grade: cards.length ? gradeFor(share) : "—" };
  }

  return {
    manager,
    ...graded,
    points: manager.roster.reduce((sum, card) => sum + card.points, 0)
  };
}

// A chart is graded and not priced. The OPS behind it reads nothing like a real
// slash line — a hitter comes out around 1.8 where a good season is 0.9, because
// it reads the card alone, with the pitcher taken out of it — so the figure is
// good for ranking charts against charts and good for nothing else. Printing it
// only invites an argument about a decimal place that was never meant to be read
// aloud. The letter is the answer; the number was only ever how it got there.
//
// `decimals: null` is a row that shows its grade and keeps its arithmetic.
const COMPOSITION_ROWS = [
  { key: "onBase", label: "On-base", decimals: 1 },
  { key: "chart", label: "Chart quality", decimals: null },
  { key: "speed", label: "Speed", decimals: 1 },
  { key: "defence", label: "Defense", decimals: 1 },
  { key: "spControl", label: "Starters · control", decimals: 1, group: "sp" },
  { key: "spChart", label: "Starters · chart", decimals: null, group: "sp" },
  { key: "rpControl", label: "Bullpen · control", decimals: 1, group: "rp" },
  { key: "rpChart", label: "Bullpen · chart", decimals: null, group: "rp" }
];

function compositionTable(draft) {
  const teams = draft.managers.map((manager) => teamComposition(manager, draft));
  const rows = COMPOSITION_ROWS.map((row) => ({
    ...row,
    cells: teams.map((team) => ({ manager: team.manager, ...team[row.key] }))
  }));
  return { teams, rows };
}

function draftRecap(draft) {
  if (!draft?.complete) return null;
  const history = draftHistory(draft);
  if (!history.length) return null;

  // An auction is not a queue, and a lot number is not a draft position: the
  // cards come up in whatever order the room called them, so "he went too early"
  // is not a sentence that means anything. What means something is the money. A
  // card is worth its printed points, and this room decided what a point costs —
  // total spent over total points bought. Every lot can then be read against the
  // rate the room itself set: who bought points cheap, and who paid over the odds.
  if (isAuctionDraft(draft)) {
    const paid = history.reduce((sum, entry) => sum + (entry.price ?? 0), 0);
    const bought = history.reduce((sum, entry) => sum + entry.player.points, 0);
    const rate = bought > 0 ? paid / bought : 0;

    const picks = history.map((entry) => {
      const worth = entry.player.points * rate;
      // Positive is a bargain: worth more than it cost.
      return { ...entry, worth, swing: worth - (entry.price ?? 0) };
    });

    const steal = picks.reduce((best, pick) => (pick.swing > best.swing ? pick : best), picks[0]);
    const reach = picks.reduce((worst, pick) => (pick.swing < worst.swing ? pick : worst), picks[0]);
    return { picks, steal, reach, auction: true, rate };
  }

  // A snake draft is a queue, so its argument is about position: a card's rank by
  // printed points is where the board says it should have gone, and the gap
  // between that and where it actually went is who reached and who got lucky.
  const ranked = [...draft.pool].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  const rankOf = new Map(ranked.map((card, index) => [card.id, index + 1]));

  const picks = history.map((entry) => {
    const rank = rankOf.get(entry.player.id) ?? ranked.length;
    return { ...entry, rank, swing: rank - entry.pickNumber };
  });

  const steal = picks.reduce((best, pick) => (pick.swing < best.swing ? pick : best), picks[0]);
  const reach = picks.reduce((worst, pick) => (pick.swing > worst.swing ? pick : worst), picks[0]);
  return { picks, steal, reach, auction: false };
}

function recapText(draft) {
  const recap = draftRecap(draft);
  if (!recap) return "";
  const { teams, rows } = compositionTable(draft);
  const names = draft.managers.map((manager) => manager.name);

  const lines = [`MLB Showdown draft — seed "${draft.seed}"`, ""];
  lines.push(`What each manager built, graded against the ${draft.pool.length} cards on the board:`);
  const width = 16;
  const col = 14;
  lines.push(`  ${"".padEnd(width)}${names.map((name) => name.padStart(col)).join("")}`);
  for (const row of rows) {
    const cells = row.cells
      .map((cell) => `${cell.grade}${row.decimals === null ? "" : ` (${cell.value.toFixed(row.decimals)})`}`.padStart(col))
      .join("");
    lines.push(`  ${row.label.padEnd(width)}${cells}`);
  }
  lines.push(`  ${"Total points".padEnd(width)}${teams.map((team) => String(team.points).padStart(col)).join("")}`);
  lines.push("");
  if (recap.auction) {
    const rate = Math.round(recap.rate * 100) / 100;
    lines.push(`The room paid ${money(rate)} a point.`);
    lines.push(`Best value: ${recap.steal.player.name} to ${recap.steal.manager.name} for ${money(recap.steal.price)} — ${recap.steal.player.points} pts, ${money(Math.round(recap.steal.swing))} under the rate`);
    lines.push(`Biggest overpay: ${recap.reach.player.name} to ${recap.reach.manager.name} for ${money(recap.reach.price)} — ${recap.reach.player.points} pts, ${money(Math.round(-recap.reach.swing))} over the rate`);
    lines.push("", "Every lot:");
    for (const pick of recap.picks) {
      lines.push(`  ${pick.manager.name.padEnd(12)} ${money(pick.price).padStart(7)}  ${pick.player.name} (${pick.player.points} pts)`);
    }
  } else {
    lines.push(`Best value: ${recap.steal.player.name} to ${recap.steal.manager.name} at pick ${recap.steal.pickNumber} (ranked #${recap.steal.rank})`);
    lines.push(`Biggest reach: ${recap.reach.player.name} to ${recap.reach.manager.name} at pick ${recap.reach.pickNumber} (ranked #${recap.reach.rank})`);
    lines.push("", "Every pick:");
    for (const pick of recap.picks) {
      lines.push(`  ${String(pick.pickNumber).padStart(3)}. ${pick.manager.name} — ${pick.player.name} (${pick.player.points} pts)`);
    }
  }
  return lines.join("\n");
}

function renderDraftDone(draft) {
  const recap = draftRecap(draft);
  if (!recap) return "";

  const { teams, rows } = compositionTable(draft);
  const head = draft.managers.map((manager) => `<th>${escapeHtml(manager.name)}</th>`).join("");

  const body = rows
    .map(
      (row, index, all) => `<tr class="${row.group ? `comp-grouped${all[index - 1]?.group === row.group ? " comp-group-tail" : " comp-group-head"}` : ""}">
        <th class="comp-label"><span class="comp-name">${escapeHtml(row.label)}</span></th>
        ${row.cells
          .map(
            (cell) => `<td class="comp-cell">
              <span class="comp-grade grade-${cell.grade}">${cell.grade}</span>
              ${row.decimals === null ? "" : `<span class="comp-value">(${cell.value.toFixed(row.decimals)})</span>`}
            </td>`
          )
          .join("")}
      </tr>`
    )
    .join("");

  // Not a grade, and not a bill either: nothing is spent in points. It is simply
  // what the roster's cards add up to — worth reporting, and worth leaving alone,
  // because a light roster is a thing a manager chose.
  const cheapest = Math.min(...teams.map((team) => team.points));
  const pointsRow = `<tr class="comp-points">
    <th class="comp-label"><span class="comp-name">Total points</span></th>
    ${teams
      .map(
        (team) => `<td class="comp-cell">
          <span class="comp-points-value${team.points === cheapest ? " cheapest" : ""}">${team.points}</span>
        </td>`
      )
      .join("")}
  </tr>`;

  const card = (label, pick, tone) => {
    const line = recap.auction
      ? `<p class="recap-line">
          to <strong>${escapeHtml(pick.manager.name)}</strong> for <strong>${money(pick.price)}</strong>.
          They are worth <strong>${pick.player.points}</strong> points, and this room paid
          ${money(Math.round(recap.rate * 100) / 100)} a point &mdash; so they ought to have gone for about
          <strong>${money(Math.round(pick.worth))}</strong>.
        </p>
        <p class="recap-swing">${
          pick.swing > 0
            ? `Bought ${money(Math.round(pick.swing))} under the going rate.`
            : pick.swing < 0
              ? `Paid ${money(Math.round(-pick.swing))} over the going rate.`
              : "Bought at exactly the going rate."
        }</p>`
      : `<p class="recap-line">
          to <strong>${escapeHtml(pick.manager.name)}</strong> at pick ${pick.pickNumber},
          and the set ranks them <strong>#${pick.rank}</strong> of ${draft.pool.length} by points.
        </p>
        <p class="recap-swing">${
          pick.swing < 0
            ? `They fell ${Math.abs(pick.swing)} picks further than their price says they should have.`
            : pick.swing > 0
              ? `Taken ${pick.swing} picks ahead of their price.`
              : "Taken exactly where their price says."
        }</p>`;
    return `<div class="recap-card ${tone}">
      <p class="eyebrow">${label}</p>
      <h3>${escapeHtml(pick.player.name)}</h3>
      ${line}
    </div>`;
  };

  return `<section class="panel draft-done">
    <div class="section-head">
      <h2>What the table built</h2>
      <div class="done-actions">
        <button class="small" data-action="copy-recap">Copy the recap</button>
        <button class="small" data-action="export-save">Save the room</button>
      </div>
    </div>
    <div class="table-scroll">
      <table class="comp-table">
        <thead><tr><th class="comp-corner"></th>${head}</tr></thead>
        <tbody>${body}${pointsRow}</tbody>
      </table>
    </div>
    <p class="compare-note">
      Graded card-for-card against the ${draft.pool.length} cards on the board, not against each other:
      an A is a top-tenth roster of what you could have drafted. Who actually wins is a question for the simulator.
    </p>
    <div class="recap-cards">
      ${card("Best value", recap.steal, "steal")}
      ${card(recap.auction ? "Biggest overpay" : "Biggest reach", recap.reach, "reach")}
    </div>
  </section>`;
}

// Auction only: the bankroll burndown, one stepped line per manager, sitting
// just under "What the table built". Managers wear their standings-race color,
// keyed by seat order so a team is the same hue as on the sim screens.
function renderAuctionBudgetSection(draft) {
  if (!isAuctionDraft(draft)) return "";
  const history = draftHistory(draft);
  if (!history.length) return "";
  const startBudget = draft.auction?.budget ?? 0;
  const spentByManager = new Map();
  const managers = new Map(draft.managers.map((manager, index) => [manager.id, { name: manager.name, color: raceColor(index), buys: [] }]));
  for (const pick of history) {
    const entry = managers.get(pick.manager.id);
    if (!entry) continue;
    const price = Number(pick.price) || 0;
    const spent = (spentByManager.get(pick.manager.id) ?? 0) + price;
    spentByManager.set(pick.manager.id, spent);
    entry.buys.push({ pick: pick.pickNumber, price, playerName: pick.player.name, remaining: startBudget - spent });
  }
  const managerList = draft.managers.map((manager) => managers.get(manager.id));
  return `<section class="panel wide draft-chart-panel budget-race-panel">
    <div class="section-title-row">
      <div>
        <p class="eyebrow">Auction spending</p>
        <h2>Budget remaining through the draft</h2>
      </div>
    </div>
    <p class="batch-note">Each line is a manager's bankroll as the auction ran. Hover a step for the player bought and the price paid.</p>
    ${renderBudgetRace({ managers: managerList, totalPicks: history.length, budget: startBudget })}
  </section>`;
}

// ---- what the roster still wants ----
//
// The board sorts by points and wishes you luck. But a fourth outfielder is
// worth nothing to a manager with no catcher, and the roster panel has always
// known which slots are still open — it just never said so where you were
// looking. This says it above the board, and greys the cards that fill none of
// them.
//
// An unlimited roster (the random-nomination auction) has no slots to fill and
// therefore no needs: everything is legal, and the closing sweep handles the
// rest.
function rosterOpenings(manager, draft) {
  if (!manager || !draft || hasUnlimitedRoster(draft)) return null;
  if (manager.roster.length >= draft.rosterSize) return null;

  const lineup = lineupStatus(manager.roster);
  const needs = getRosterNeeds(manager.roster, draft);
  const bats = [...lineup.missingPositions];
  if (!lineup.dhFilled && needs.hitter > bats.length) bats.push("DH");

  const slots = [
    ...bats,
    ...Array.from({ length: needs.starter }, () => "SP"),
    ...Array.from({ length: needs.bullpen }, () => "RP")
  ];
  if (!slots.length) return null;

  // Anyone can DH, so an open DH slot means every bat is still useful. That is
  // true, and it is why the greying only bites late, once the shape of the
  // roster has actually closed in.
  const fills = (player) => {
    if (player.kind === "pitcher") {
      const role = player.role === "SP" ? "SP" : "RP";
      return role === "SP" ? needs.starter > 0 : needs.bullpen > 0;
    }
    return bats.some((slot) => slot === "DH" || playsPosition(player, slot));
  };

  return { slots, fills };
}

function renderBigBoard(manager, draft) {
  if (!manager) return "";
  const entries = bigBoard(manager, draft);
  if (!entries.length) {
    return `<div class="section-head"><h2>${escapeHtml(manager.name)}'s board</h2></div>
      <p class="empty">Nothing on the board yet. Star a card on the available list and it lands here — then put them in the order you want them.</p>
      <p class="board-note">When your clock runs out, the room takes the top card still standing on your board. An empty board means the computer picks for you.</p>`;
  }
  const live = entries.filter((entry) => !entry.gone);
  const nextUp = live.find((entry) => entry.legal)?.player ?? null;

  const rows = entries
    .map((entry, index) => {
      const player = entry.player;
      const rating = player.kind === "pitcher" ? `CTRL ${player.control}` : `OB ${player.onBase}`;
      const spot = player.kind === "pitcher" ? player.role : positionsLabel(player);
      const status = entry.gone
        ? `<span class="board-status gone">Drafted</span>`
        : !entry.legal
          ? `<span class="board-status blocked" title="${escapeHtml(entry.reason)}">${escapeHtml(entry.reason)}</span>`
          : player.id === nextUp?.id
            ? `<span class="board-status next">Next up</span>`
            : "";
      return `<li class="board-row${entry.gone ? " gone" : ""}${player.id === nextUp?.id ? " next" : ""}">
        <span class="board-rank">${index + 1}</span>
        <span class="board-name">
          <strong class="player-name-preview" tabindex="0" data-preview-id="${escapeHtml(player.id)}" data-preview-card="${escapeHtml(previewCard(player))}">${escapeHtml(player.name)}</strong>
          <small>${escapeHtml(spot)} &middot; ${escapeHtml(rating)}${pointsHidden() ? "" : ` &middot; ${player.points} pts`}</small>
        </span>
        ${status}
        <span class="board-controls">
          <button class="small" data-action="board-up" data-player-id="${escapeHtml(player.id)}" ${index === 0 ? "disabled" : ""} title="Move up" aria-label="Move ${escapeHtml(player.name)} up">&#9650;</button>
          <button class="small" data-action="board-down" data-player-id="${escapeHtml(player.id)}" ${index === entries.length - 1 ? "disabled" : ""} title="Move down" aria-label="Move ${escapeHtml(player.name)} down">&#9660;</button>
          <button class="small board-drop" data-action="toggle-star" data-player-id="${escapeHtml(player.id)}" title="Take off the board" aria-label="Take ${escapeHtml(player.name)} off the board">&times;</button>
        </span>
      </li>`;
    })
    .join("");

  return `<div class="section-head"><h2>${escapeHtml(manager.name)}'s board</h2></div>
    <p class="board-note">
      ${nextUp
        ? `If the clock runs out, <strong>${escapeHtml(nextUp.name)}</strong> is the pick.`
        : "Nothing on this board can be taken right now — the computer would pick instead."}
    </p>
    <ol class="big-board">${rows}</ol>`;
}

// The slots still open, said plainly, above the board they apply to. Repeats
// collapse into a count — two open starters is "SP x2", not "SP · SP".
function renderNeedsStrip(manager, draft) {
  const openings = rosterOpenings(manager, draft);
  if (!openings) return "";
  const counts = new Map();
  for (const slot of openings.slots) counts.set(slot, (counts.get(slot) ?? 0) + 1);
  const chips = [...counts.entries()]
    .map(([slot, count]) => `<span class="need-chip">${escapeHtml(slot)}${count > 1 ? `<em>&times;${count}</em>` : ""}</span>`)
    .join("");
  return `<div class="needs-strip">
    <span class="needs-label">${escapeHtml(manager.name)} still needs</span>
    <div class="needs-chips">${chips}</div>
  </div>`;
}

function filteredPlayers(players) {
  const search = state.filters.search.trim().toLowerCase();
  const starred = state.filters.starredOnly ? starredIds() : null;
  const flagged = state.filters.flaggedOnly ? flaggedIds() : null;
  return players.filter((player) => {
    if (player.kind !== state.filters.type) return false;
    if (starred && !starred.has(player.id)) return false;
    if (flagged && !flagged.has(player.id)) return false;
    if (state.filters.position !== "all" && !matchesPositionFilter(player, state.filters.position)) return false;
    if (search && !`${player.name} ${player.team ?? ""} ${playerPosition(player)} ${player.kind}`.toLowerCase().includes(search)) return false;
    return true;
  });
}

function matchesPositionFilter(player, filterPosition) {
  if (player.kind !== "hitter") return playerPosition(player) === filterPosition;
  if (filterPosition === CORNER_OUTFIELD_POSITION) {
    return hitterPositions(player).some((entry) => isCornerOutfielder(entry.pos));
  }
  return playsPosition(player, filterPosition);
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
  const options = { unlimitedRoster: hasUnlimitedRoster(draft), startingPitchers: draft.startingPitchers };
  return draft.complete && draft.managers.every((manager) => validateRoster(manager, options).length === 0);
}

// Both boards show the whole deck at once, best first — the cards that have
// gone stay in their place, greyed out, because what is off the board (and who
// took it, and what it went for) is half of what the board is telling you.
function draftVisiblePlayers(draft) {
  return filteredPlayers(draft.pool).sort(comparePlayers);
}

function comparePlayers(a, b) {
  const sort = state.filters.sort;
  const direction = state.filters.sortDirection === "asc" ? 1 : -1;
  const result = comparePlayersBySort(a, b, sort);
  if (result) return result * direction;
  return a.name.localeCompare(b.name);
}

// Points are the one thing a blind draft hides, so they must not sneak back in
// as the tiebreaker: when they are hidden, players tied on the visible key fall
// through to the neutral name sort instead of quietly lining up by the number
// nobody is supposed to see.
function pointsTiebreak(a, b) {
  return pointsHidden() ? 0 : a.points - b.points;
}

function comparePlayersBySort(a, b, sort) {
  if (sort === "primary") {
    return playerPrimary(a) - playerPrimary(b) || pointsTiebreak(a, b);
  }
  if (sort === "power") {
    return playerPower(a) - playerPower(b) || pointsTiebreak(a, b);
  }
  if (sort === "position") {
    return playerPosition(a).localeCompare(playerPosition(b)) || pointsTiebreak(a, b);
  }
  if (sort === "name") {
    return a.name.localeCompare(b.name);
  }
  if (sort === "speed") {
    return speedValue(a.speed) - speedValue(b.speed) || pointsTiebreak(a, b);
  }
  if (sort === "fielding") {
    return (a.fielding ?? 0) - (b.fielding ?? 0) || pointsTiebreak(a, b);
  }
  if (sort === "ip") {
    return (a.ip ?? 0) - (b.ip ?? 0) || pointsTiebreak(a, b);
  }
  if (sort?.startsWith("chart:")) {
    const result = sort.slice("chart:".length);
    return chartMinimum(a, result) - chartMinimum(b, result) || pointsTiebreak(a, b);
  }
  // Unknown sort: points lead only when they are on the table; blind, it is the
  // primary stat that orders the board.
  return pointsTiebreak(a, b) || playerPrimary(a) - playerPrimary(b);
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
  return sort === "name" || sort === "position" ? "asc" : "desc";
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
    needs: getRosterNeeds(roster, state.draft)
  };
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

// ---- saves that survive ----
//
// A draft lived in one browser's localStorage and nowhere else. Change the port
// and it was a different save slot; clear your browsing data and a season was
// gone. A room is a file now: it can be carried to another machine, kept, or
// sent to somebody who wants to see what you did with the eighth pick.
//
// The file is the same shape the browser was already storing, so a save and a
// reload are the same operation with different paper.
const SAVE_VERSION = 1;

function saveFileName(draft) {
  const managers = draft?.managers?.length ?? 0;
  const round = draft?.complete ? "complete" : `round-${draftRound(draft)}`;
  const stamp = new Date().toISOString().slice(0, 10);
  return `showdown-${managers}-managers-${round}-${stamp}.json`;
}

function exportSave() {
  const payload = {
    kind: "mlb-showdown-save",
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    state: serializeState(state)
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = saveFileName(state.draft);
  link.click();
  URL.revokeObjectURL(url);
}

// A file from somewhere else is not to be trusted just because it is JSON: it
// could be any JSON at all. Say what is wrong with it rather than dying on it.
function readSave(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "That file isn't a saved room — it isn't even JSON." };
  }
  if (!parsed || typeof parsed !== "object") {
    return { error: "That file isn't a saved room." };
  }
  if (parsed.kind !== "mlb-showdown-save") {
    return { error: "That JSON isn't a Showdown save file." };
  }
  if (!Number.isFinite(parsed.version) || parsed.version > SAVE_VERSION) {
    return { error: `That save was written by a newer version (v${parsed.version}). This one reads up to v${SAVE_VERSION}.` };
  }
  if (!parsed.state || typeof parsed.state !== "object") {
    return { error: "That save file has no room in it." };
  }
  try {
    const revived = reviveState(parsed.state);
    if (!revived.draft) return { error: "That save has no draft in it." };
    if (!Array.isArray(revived.draft.managers) || revived.draft.managers.length < 2) {
      return { error: "That save's draft has no managers." };
    }
    return { state: revived };
  } catch (error) {
    return { error: `That save could not be opened: ${error.message}` };
  }
}

async function importSave(file) {
  const result = readSave(await file.text());
  if (result.error) {
    setupImportError = result.error;
    renderCurrentScreen();
    return;
  }
  setupImportError = null;
  state = result.state;
  // An imported room is this browser's room now.
  state.online = null;
  saveState();
  cpuPaused = false;
  renderCurrentScreen();
}

function pickSaveFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) importSave(file);
  });
  input.click();
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
  const batchSorts = normalizeBatchSorts(value.batchSorts);
  if (filters.type === "all") filters.type = "hitter";
  filters.sortDirection = filters.sortDirection ?? defaultSortDirection(filters.sort);
  const savedStartingPitchers = normalizeStartingPitchers(
    value.draft?.startingPitchers ?? value.startingPitchers ?? Number(value.draft?.rosterSize) - 11
  );
  const draft = value.draft
    ? {
        ...value.draft,
        startingPitchers: savedStartingPitchers,
        rosterSize: rosterSizeForStartingPitchers(savedStartingPitchers),
        pickedIds: new Set(value.draft.pickedIds ?? [])
      }
    : null;
  if (draft) {
    draft.seed = draft.seed ?? value.seed ?? "showdown";
    draft.draftType = draft.draftType === "auction" ? "auction" : "snake";
    draft.nomination = draft.draftType === "auction" && draft.nomination === "random" ? "random" : "manual";
    draft.unlimitedRoster = draft.nomination === "random";
    draft.hidePoints = Boolean(draft.hidePoints);
    // A random-nomination draft ends when the queue runs out, not when the
    // rosters fill — they never do, there is no cap to fill to.
    draft.complete = draft.unlimitedRoster
      ? Boolean(draft.complete)
      : draft.managers.every((manager) => manager.roster.length >= draft.rosterSize);
    // Rooms saved before corners were lumped still carry bare LF/RF labels.
    draft.pool = draft.pool.map(normalizeCardPosition);
    for (const manager of draft.managers) {
      manager.startingPitchers = draft.startingPitchers;
      manager.roster = manager.roster.map(normalizeCardPosition);
    }
    if (draft.draftType === "auction") {
      draft.auction = reviveAuction(draft, draft.auction);
    }
  }
  return {
    ...defaultState(),
    ...value,
    startingPitchers: draft?.startingPitchers ?? normalizeStartingPitchers(value.startingPitchers),
    rosterSize: draft?.rosterSize ?? rosterSizeForStartingPitchers(value.startingPitchers),
    universe: universeConfig(value.universe)?.key ?? DEFAULT_UNIVERSE,
    draftType: value.draftType === "auction" ? "auction" : "snake",
    auctionBudget: normalizeAuctionBudget(
      value.auctionBudget ?? AUCTION_DEFAULT_BUDGET,
      draft?.rosterSize ?? rosterSizeForStartingPitchers(value.startingPitchers)
    ),
    auctionTimer: normalizeAuctionTimerState(value.auctionTimer),
    pickTimerSeconds: normalizePickTimerSeconds(value.pickTimerSeconds),
    snakeTimer: normalizeSnakeTimerState(value.snakeTimer),
    maskBids: Boolean(value.maskBids),
    hidePoints: Boolean(value.hidePoints),
    cpuManagers: Array.isArray(value.cpuManagers) ? value.cpuManagers.filter((name) => typeof name === "string") : [],
    starred: normalizeStarred(value.starred),
    flagged: normalizeStarred(value.flagged),
    heatBy: value.heatBy === "points" ? "points" : "price",
    pickDeadline: Number.isFinite(value.pickDeadline) ? value.pickDeadline : null,
    myManagerId: typeof value.myManagerId === "string" ? value.myManagerId : null,
    filters,
    batchSorts,
    batchStatsTab: normalizeBatchStatsTab(value.batchStatsTab),
    batchPitcherSplit: normalizeBatchPitcherSplit(value.batchPitcherSplit),
    rosterTab: value.rosterTab === "order" ? "order" : "roster",
    rosterManagerId: typeof value.rosterManagerId === "string" ? value.rosterManagerId : null,
    draft,
    tournament: null,
    view: value.view === "batch" && value.batch ? "batch" : null
  };
}

function reviveAuction(draft, auction) {
  const budget = normalizeAuctionBudget(auction?.budget, draft.rosterSize);
  const timer = normalizeAuctionTimerConfig(auction?.timer ?? { enabled: false });
  const savedBudgets = auction?.budgets ?? {};
  const budgets = Object.fromEntries(
    draft.managers.map((manager) => {
      const saved = Number(savedBudgets[manager.id]);
      return [manager.id, Number.isFinite(saved) ? saved : budget];
    })
  );
  const nominatorIndex = Math.min(
    Math.max(0, Math.round(Number(auction?.nominatorIndex) || 0)),
    draft.managers.length - 1
  );
  const savedClockBanks = auction?.clockBanks ?? {};
  const clockBanks = Object.fromEntries(
    draft.managers.map((manager) => {
      const saved = Number(savedClockBanks[manager.id]);
      return [manager.id, Number.isFinite(saved) ? Math.max(0, saved) : timer.bankMs];
    })
  );
  const savedReview = auction?.review ?? {};
  const finiteOrNull = (value) => value === null || value === undefined || value === ""
    ? null
    : Number.isFinite(Number(value)) ? Number(value) : null;
  const review = {
    startedAt: finiteOrNull(savedReview.startedAt),
    endsAt: finiteOrNull(savedReview.endsAt),
    completedAt: savedReview.completedAt === 0 ? 0 : finiteOrNull(savedReview.completedAt),
    // What was left on the review clock when the room paused. Lose this and a
    // paused draft comes back with its break already over.
    pausedRemainingMs: finiteOrNull(savedReview.pausedRemainingMs)
  };
  if (!timer.enabled && review.completedAt === null) review.completedAt = 0;
  // Lots saved by the old open-bid auction lack a pending list; drop them
  // rather than revive a shape the sealed-bid flow can't advance.
  const lot = auction?.lot?.playerId && Array.isArray(auction.lot.pending) && !draft.pickedIds.has(auction.lot.playerId)
    ? auction.lot
    : null;
  const revived = {
    budget,
    budgets,
    timer,
    clockBanks,
    review,
    nominatorIndex,
    lot,
    // A draft paused when the tab closed is still paused when it opens again.
    pausedAt: finiteOrNull(auction?.pausedAt),
    history: Array.isArray(auction?.history) ? auction.history : []
  };
  // The hidden queue and how far it has been dealt ARE the draft's clock in a
  // random-nomination room; drop them and there is no draft left to restore.
  if (Array.isArray(auction?.queue)) {
    revived.queue = auction.queue;
    revived.queueIndex = Math.min(
      Math.max(0, Math.round(Number(auction.queueIndex) || 0)),
      auction.queue.length
    );
  }
  return revived;
}
