import {
  actAdvance,
  actBunt,
  actChangePitcher,
  actIntentionalWalk,
  actPitch,
  actSteal,
  actSwing,
  battlePhase,
  fastForward,
  npcMoundVisit
} from "../rules/battle/controller.js?v=20260714-b";
import { describeEvent, halfLabel } from "./playByPlay.js?v=20260714-b";
import { cardPanelHtml, escapeHtml, shortName, stripCardYear } from "./cardFace.js?v=20260714-b";
import { hydratePhotos } from "./photos.js?v=20260714-b";

// The interactive game: the same engine the adventure's battles run on, in
// the draft app's clothes. You manage one drafted roster against another —
// swing, bunt, steal, walk him on purpose, go to the pen, send the runners —
// and FAST FORWARD hands the wheel to the autopilot until the game gets
// interesting again.
//
// The game is a sitting, not a save: it lives in memory for as long as the
// screen is open. Leaving it returns to the draft board.

const OUT_RESULTS = new Set(["PU", "SO", "GB", "FB"]);

export function createGame({ battle, playerName, opponentName }) {
  return {
    battle,
    playerName,
    opponentName,
    // The booth's feed, oldest first. The screen shows the tail.
    log: [`${opponentName} takes the field. ${playerName} is up first.`]
  };
}

// Every action returns the events it produced; the booth narrates them, the
// NPC skipper gets its between-batters look at the mound, and the screen
// redraws. One funnel so no path forgets a step.
function afterAction(game, events, extraLines = []) {
  const lines = [
    ...extraLines,
    ...events.filter(Boolean).flatMap((event) => describeEvent(event, game.battle.playerSide))
  ];
  const visit = npcMoundVisit(game.battle);
  if (visit) lines.push(...describeEvent(visit, game.battle.playerSide));
  game.log.push(...lines);
}

export function renderGame(root, game, { onExit, onRerender }) {
  const { battle } = game;
  const phase = battlePhase(battle);
  root.innerHTML = gameHtml(game, phase);
  hydratePhotos(root);

  const feed = root.querySelector("[data-game-log]");
  if (feed) feed.scrollTop = feed.scrollHeight;

  root.onclick = (event) => {
    const button = event.target.closest("button[data-game-action]");
    if (!button) return;
    const { gameAction, index } = button.dataset;
    if (gameAction === "exit") {
      onExit();
      return;
    }
    runAction(game, gameAction, Number(index));
    onRerender();
  };
}

function runAction(game, action, index) {
  const { battle } = game;
  if (action === "swing") return afterAction(game, actSwing(battle));
  if (action === "bunt") return afterAction(game, actBunt(battle));
  if (action === "steal") return afterAction(game, actSteal(battle, index));
  if (action === "pitch") return afterAction(game, actPitch(battle));
  if (action === "walk") return afterAction(game, actIntentionalWalk(battle));
  if (action === "relieve") return afterAction(game, actChangePitcher(battle, index));
  if (action === "advance") {
    return afterAction(game, actAdvance(battle, index), index === 0 ? ["The runners hold."] : []);
  }
  if (action === "fast-forward") {
    const events = fastForward(battle);
    // The autopilot can play a dozen plates in one press: the feed gets the
    // headline plus the last two calls, not a wall of every pitch.
    const tail = events.filter(Boolean).slice(-2).flatMap((event) => describeEvent(event, battle.playerSide));
    return afterAction(game, [], [`⏩ ${events.length} plays on autopilot…`, ...tail]);
  }
}

// ---- The screen --------------------------------------------------------------

function gameHtml(game, phase) {
  const { battle } = game;
  const state = battle.state;
  const yours = state.score[battle.playerSide];
  const theirs = state.score[battle.npcSide];
  return `<section class="panel game-screen">
    <header class="game-bar">
      <div class="game-score">
        <span class="game-team ${theirs > yours ? "leading" : ""}">
          <strong>${escapeHtml(game.opponentName)}</strong><b>${theirs}</b>
        </span>
        <span class="game-team ${yours > theirs ? "leading" : ""}">
          <strong>${escapeHtml(game.playerName)}</strong><b>${yours}</b>
        </span>
      </div>
      <div class="game-situation">
        <span class="game-inning">${escapeHtml(halfLabel(state))}</span>
        ${outsHtml(state.outs)}
        ${diamondHtml(state)}
      </div>
      <button class="small" data-game-action="exit">Back to the draft</button>
    </header>
    ${matchupHtml(game, phase)}
    <div class="game-lower">
      <div class="game-actions">${actionsHtml(phase)}</div>
      <ol class="game-log" data-game-log>
        ${game.log.map((line) => `<li>${line}</li>`).join("")}
      </ol>
    </div>
  </section>`;
}

// The two cards in the confrontation, printed faces and all — the batter on
// the left, the arm he is facing on the right. Over is over: the box shows
// the final instead.
function matchupHtml(game, phase) {
  if (phase.type === "over") {
    const won = phase.playerWon;
    return `<div class="game-final">
      <h2>${won ? "You win it" : "You lose it"}, ${phase.score[game.battle.playerSide]}&ndash;${phase.score[game.battle.npcSide]}</h2>
      <p class="lede">${won
        ? `${escapeHtml(game.opponentName)} heads for the bus.`
        : `${escapeHtml(game.opponentName)} takes the series opener.`}</p>
      <button data-game-action="exit">Back to the draft</button>
    </div>`;
  }
  const batting = phase.type === "player-batting";
  const batter = phase.batter ?? null;
  const mound = batting ? phase.opposingMound : phase.mound;
  if (!batter || !mound) return "";
  return `<div class="game-matchup">
    <div class="game-card">
      <p class="eyebrow">${batting ? "Your bat" : `${escapeHtml(game.opponentName)} bats`} &middot; #${phase.battingSpot}</p>
      ${cardPanelHtml(batter)}
      <p class="game-ondeck">On deck: ${escapeHtml(shortName(stripCardYear(phase.onDeck.name)))}</p>
    </div>
    <div class="game-card">
      <p class="eyebrow">${batting ? `${escapeHtml(game.opponentName)} pitches` : "Your arm"}</p>
      ${cardPanelHtml(mound.pitcher)}
      <p class="game-mound ${mound.fatiguePenalty > 0 ? "fatigued" : ""}">
        ${mound.battersFaced}/${mound.tiredAt} batters faced${mound.fatiguePenalty > 0 ? ` &middot; &minus;${mound.fatiguePenalty} TIRED` : ""}
        &middot; ${chartOutCount(mound.pitcher.chart)} of 20 are outs
      </p>
    </div>
  </div>`;
}

function actionsHtml(phase) {
  if (phase.type === "over") return "";
  if (phase.type === "advance-decision") return advanceActionsHtml(phase.pending);

  const buttons = [];
  if (phase.type === "player-batting") {
    buttons.push(action("swing", "Swing away"));
    if (phase.canBunt) {
      buttons.push(action("bunt", `Sacrifice bunt <small>${Math.round(phase.buntChance * 100)}% down</small>`));
    }
    for (const option of phase.stealOptions) {
      buttons.push(action("steal", `Steal ${option.toIndex === 2 ? "third" : "second"}
        <small>${escapeHtml(shortName(stripCardYear(option.runner.name)))} &middot; ${Math.round(option.safeChance * 100)}% safe</small>`,
      option.fromIndex));
    }
  } else {
    buttons.push(action("pitch", "Pitch to him"));
    buttons.push(action("walk", "Intentional walk"));
    for (const relief of phase.bullpen) {
      buttons.push(action("relieve", `Bring in ${escapeHtml(shortName(stripCardYear(relief.pitcher.name)))}
        <small>${relief.pitcher.role} &middot; CTRL ${relief.pitcher.control} &middot; IP ${relief.pitcher.ip}</small>`,
      relief.index));
    }
  }
  // The autopilot plays both dugouts by the book — the decision matrix on the
  // bases, the pen at fatigue 2 — and gives the game back when it matters:
  // the 8th inning on, or a runner in scoring position in a one-run game.
  buttons.push(`<button class="game-action fast-forward" data-game-action="fast-forward">
    Fast forward <small>Autopilot to the next big moment</small>
  </button>`);
  return buttons.join("");
}

// Send or hold, lead runner first — a trailing runner only goes if everyone
// ahead of him goes, so the options are prefixes of the queue.
function advanceActionsHtml(pending) {
  const verb = pending.kind === "tagup" ? "Tag up" : "Send";
  const buttons = [action("advance", pending.kind === "tagup" ? "Nobody tags" : "Hold the runners", 0)];
  pending.candidates.forEach((candidate, index) => {
    const sent = pending.candidates.slice(0, index + 1);
    const names = sent
      .map((entry) => `${shortName(stripCardYear(entry.runner.name))} &rarr; ${baseLabel(entry.toIndex)}`)
      .join(", ");
    // The defense throws at the shakiest runner, so that is the live risk.
    const odds = Math.round(Math.min(...sent.map((entry) => entry.safeChance)) * 100);
    buttons.push(action("advance", `${verb} ${escapeHtml(names)} <small>${odds}% safe</small>`, index + 1));
  });
  return buttons.join("");
}

function action(name, label, index = null) {
  return `<button class="game-action" data-game-action="${name}"${index === null ? "" : ` data-index="${index}"`}>${label}</button>`;
}

function baseLabel(toIndex) {
  if (toIndex >= 3) return "home";
  if (toIndex === 2) return "third";
  return "second";
}

function outsHtml(outs) {
  return `<span class="game-outs">${[0, 1, 2]
    .map((index) => `<i class="${index < outs ? "on" : ""}"></i>`)
    .join("")} out</span>`;
}

function diamondHtml(state) {
  const [first, second, third] = state.bases;
  const base = (cls, runner) =>
    `<span class="game-base ${cls} ${runner ? "on" : ""}"${runner ? ` title="${escapeHtml(runner.name)}"` : ""}></span>`;
  return `<span class="game-diamond">
    ${base("second", second)}
    ${base("third", third)}
    ${base("first", first)}
  </span>`;
}

// Out slots (PU/SO/GB/FB) on the pitcher's d20 chart — "17 of 20 are outs"
// means 17 rolls retire the batter outright.
function chartOutCount(chart) {
  if (!Array.isArray(chart)) return 0;
  return chart
    .filter((entry) => OUT_RESULTS.has(entry.result))
    .reduce((sum, entry) => sum + (Math.min(20, entry.to) - entry.from + 1), 0);
}
