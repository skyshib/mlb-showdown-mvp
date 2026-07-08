import {
  createInitialState,
  playPlateAppearance,
  playStealAttempt,
  stealCandidates,
  attemptSteal,
  changePitcher,
  pitcherStatus,
  isGameOver,
  simulateGame,
  canBunt,
  buntSuccessChance,
  attemptBunt,
  intentionalWalk,
  pendingAdvanceDecision,
  resolveAdvanceDecision
} from "../../rules/game.js";
import { buildTeam } from "../../rules/draft.js";
import { createRng } from "../../rules/rng.js";
import { npcMaybeSteal, npcMaybePullPitcher, profileFor } from "./ai.js";

// The interactive battle: one seeded game where the engine pauses before
// every plate appearance so the humans (well, one human) can manage.
// Single games put the player on the road (you are the one traveling);
// series alternate home and away game to game, like a real series.
export function createBattle({ playerManager, npcManager, trainer, seed, starterIndex = 0, playerIsAway = true }) {
  const playerTeam = buildTeam(playerManager, { starterIndex });
  const npcTeam = buildTeam(npcManager, { starterIndex });
  const playerSide = playerIsAway ? "away" : "home";
  const npcSide = playerIsAway ? "home" : "away";
  const state = createInitialState(
    playerIsAway ? playerTeam : npcTeam,
    playerIsAway ? npcTeam : playerTeam
  );
  // Both mounds run manual: the player pulls their own arms, and the NPC
  // skipper decides by AI profile — which means NPC pitchers visibly tire
  // (and ride their fatigue) under exactly the same rules as yours, instead
  // of being silently rotated out by a pitching plan.
  state.manualPitchingFor = "both";
  state.deferAdvancesFor = playerSide;
  return {
    seed,
    trainer,
    playerSide,
    npcSide,
    profile: profileFor(trainer?.aiProfile),
    state,
    rng: createRng(seed),
    events: [],
    eventCount: 0
  };
}

export function battingSide(battle) {
  return battle.state.half === "top" ? "away" : "home";
}

// What is the player being asked right now?
//  over             — game finished
//  advance-decision — send or hold the runners after a hit / fly ball
//  player-batting   — offer SWING / BUNT / STEAL
//  player-pitching  — offer PITCH / IBB / PITCHING CHANGE
export function battlePhase(battle) {
  const { state } = battle;
  if (isGameOver(state)) {
    return {
      type: "over",
      playerWon: state.score[battle.playerSide] > state.score[battle.npcSide],
      score: { ...state.score }
    };
  }
  const pending = pendingAdvanceDecision(state);
  if (pending) {
    return { type: "advance-decision", pending };
  }
  if (battingSide(battle) === battle.playerSide) {
    const team = state[battle.playerSide];
    return {
      type: "player-batting",
      batter: team.lineup[state.lineupIndex[battle.playerSide] % team.lineup.length],
      onDeck: team.lineup[(state.lineupIndex[battle.playerSide] + 1) % team.lineup.length],
      battingSpot: (state.lineupIndex[battle.playerSide] % team.lineup.length) + 1,
      stealOptions: stealCandidates(state),
      canBunt: canBunt(state),
      buntChance: buntSuccessChance(state),
      // Full mound status, so the UI can show the NPC arm's fatigue — the
      // tiredness rules are the same for both sides.
      opposingMound: pitcherStatus(state, battle.npcSide),
      opposingPitcher: pitcherStatus(state, battle.npcSide).pitcher
    };
  }
  const npcTeam = state[battle.npcSide];
  return {
    type: "player-pitching",
    batter: npcTeam.lineup[state.lineupIndex[battle.npcSide] % npcTeam.lineup.length],
    onDeck: npcTeam.lineup[(state.lineupIndex[battle.npcSide] + 1) % npcTeam.lineup.length],
    battingSpot: (state.lineupIndex[battle.npcSide] % npcTeam.lineup.length) + 1,
    mound: pitcherStatus(state, battle.playerSide),
    bullpen: availableRelievers(battle)
  };
}

// The arms the player can still bring in, with their staff indexes for
// changePitcher. Everyone behind the current pitcher is available.
export function availableRelievers(battle) {
  const state = battle.state;
  const runtime = state.pitching[battle.playerSide];
  return state[battle.playerSide].pitchers
    .map((pitcher, index) => ({ pitcher, index }))
    .slice(runtime.pitcherIndex + 1);
}

function pushEvent(battle, event) {
  if (!event) return null;
  battle.events.push(event);
  battle.eventCount += 1;
  return event;
}

// Player action while batting: let the plate appearance rip. The NPC gets its
// between-batters pitching-change look first, like a real mound visit.
export function actSwing(battle) {
  const pulled = npcMaybePullPitcher(battle.state, battle.npcSide, battle.profile);
  const events = [];
  if (pulled) events.push(pushEvent(battle, pitchingChangeEvent(battle, battle.npcSide, pulled)));
  events.push(pushEvent(battle, playPlateAppearance(battle.state, battle.rng)));
  return events;
}

// Player action while batting: send the runner on the chosen base.
export function actSteal(battle, fromIndex) {
  const event = attemptSteal(battle.state, fromIndex, battle.rng);
  return event ? [pushEvent(battle, event)] : [];
}

// Player action while batting: lay down a sacrifice bunt. The NPC gets its
// mound-visit look first, same as before a swing.
export function actBunt(battle) {
  const pulled = npcMaybePullPitcher(battle.state, battle.npcSide, battle.profile);
  const events = [];
  if (pulled) events.push(pushEvent(battle, pitchingChangeEvent(battle, battle.npcSide, pulled)));
  const event = attemptBunt(battle.state, battle.rng);
  if (event) events.push(pushEvent(battle, event));
  return events;
}

// Player decision after their own hit or fly ball: send the first `sendCount`
// runners (lead first), hold the rest.
export function actAdvance(battle, sendCount) {
  const event = resolveAdvanceDecision(battle.state, sendCount, battle.rng);
  return event ? [pushEvent(battle, event)] : [];
}

// Player action while pitching: put the batter on for free.
export function actIntentionalWalk(battle) {
  const event = intentionalWalk(battle.state);
  return event ? [pushEvent(battle, event)] : [];
}

// Player action while pitching: face the batter. The NPC offense gets its
// steal look first; if a runner goes, that IS the event — the decision point
// comes back around before the plate appearance.
export function actPitch(battle) {
  const steal = npcMaybeSteal(battle.state, battle.rng, battle.profile);
  if (steal) return [pushEvent(battle, steal)];
  return [pushEvent(battle, playPlateAppearance(battle.state, battle.rng))];
}

// Player action while pitching: go to the pen. Pass a staff index to bring
// in a specific arm; omit it for the next man up.
export function actChangePitcher(battle, targetIndex = null) {
  const pitcher = changePitcher(battle.state, battle.playerSide, targetIndex);
  if (!pitcher) return [];
  return [pushEvent(battle, pitchingChangeEvent(battle, battle.playerSide, pitcher))];
}

function pitchingChangeEvent(battle, side, pitcher) {
  return {
    type: "pitching-change",
    side,
    team: battle.state[side].name,
    pitcher: pitcher.name,
    inning: battle.state.inning,
    half: battle.state.half
  };
}

// Is this a moment worth stopping the fast-forward for? Late innings always;
// earlier, a runner in scoring position in a close game.
export function isLeverageMoment(state) {
  if (state.inning >= 8) return true;
  const diff = Math.abs(state.score.home - state.score.away);
  const risp = Boolean(state.bases[1] || state.bases[2]);
  return risp && diff <= 2;
}

// The moments that earn the slow d20: two outs with the bases loaded, any
// time; or the 9th inning onward with the game within two runs. Checked
// BEFORE the plate appearance resolves — the drama is in the wind-up.
export function isDramaticMoment(state) {
  if (state.outs === 2 && state.bases[0] && state.bases[1] && state.bases[2]) return true;
  return state.inning >= 9 && Math.abs(state.score.home - state.score.away) <= 2;
}

// Auto-resolve on engine autopilot (decision matrix steals and advances,
// fatigue-based pitching for both sides, NPC profile moves) until the next
// leverage moment or the end of the game.
export function fastForward(battle, { maxEvents = 500 } = {}) {
  const state = battle.state;
  const events = [];
  let guard = maxEvents;

  // Autopilot takes the wheel: no deferred decisions while it runs, and any
  // decision already waiting resolves by the matrix.
  const deferredFor = state.deferAdvancesFor;
  state.deferAdvancesFor = null;
  const pendingEvent = resolveAdvanceDecision(state, "auto", battle.rng);
  if (pendingEvent) events.push(pushEvent(battle, pendingEvent));

  while (!isGameOver(state) && guard > 0) {
    guard -= 1;
    if (battingSide(battle) === battle.playerSide) {
      const pulled = npcMaybePullPitcher(state, battle.npcSide, battle.profile);
      if (pulled) events.push(pushEvent(battle, pitchingChangeEvent(battle, battle.npcSide, pulled)));
    } else {
      // Manage the player's pen the way a balanced skipper would.
      const mound = pitcherStatus(state, battle.playerSide);
      if (mound.fatiguePenalty >= 2 && mound.hasReliefAvailable) {
        const pitcher = changePitcher(state, battle.playerSide);
        if (pitcher) events.push(pushEvent(battle, pitchingChangeEvent(battle, battle.playerSide, pitcher)));
      }
    }
    const event = playStealAttempt(state, battle.rng) ?? playPlateAppearance(state, battle.rng);
    events.push(pushEvent(battle, event));
    if (isLeverageMoment(state)) break;
  }

  state.deferAdvancesFor = deferredFor;
  return events;
}

// ---- Simulated series ------------------------------------------------------

// A best-of-N resolved entirely by the sim engine. The player is the visitor
// in odd games, hosts even games, and both rotations turn over game to game.
export function runSimSeries({ playerManager, npcManager, bestOf, seed }) {
  const needed = Math.floor(bestOf / 2) + 1;
  const games = [];
  let playerWins = 0;
  let npcWins = 0;

  for (let gameNumber = 1; playerWins < needed && npcWins < needed; gameNumber += 1) {
    const starterIndex = gameNumber - 1;
    const playerTeam = buildTeam(playerManager, { starterIndex });
    const npcTeam = buildTeam(npcManager, { starterIndex });
    const playerIsAway = gameNumber % 2 === 1;
    const result = simulateGame(
      playerIsAway ? playerTeam : npcTeam,
      playerIsAway ? npcTeam : playerTeam,
      `${seed}:g${gameNumber}`
    );
    const playerRuns = playerIsAway ? result.away.runs : result.home.runs;
    const npcRuns = playerIsAway ? result.home.runs : result.away.runs;
    const playerWon = playerRuns > npcRuns;
    if (playerWon) playerWins += 1;
    else npcWins += 1;
    games.push({
      gameNumber,
      playerIsAway,
      playerRuns,
      npcRuns,
      innings: result.innings,
      playerWon,
      topSwing: result.topSwing,
      boxScore: result.boxScore,
      // Feats (slams, comebacks) read the play-by-play; the events ride the
      // transient series result but never land in the save.
      events: result.events
    });
  }

  return { games, playerWins, npcWins, playerWonSeries: playerWins > npcWins, bestOf };
}
