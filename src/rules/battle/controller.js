import {
  createInitialState,
  playPlateAppearance,
  playStealAttempt,
  stealCandidates,
  attemptSteal,
  changePitcher,
  autoRelieve,
  pitcherStatus,
  isGameOver,
  simulateGame,
  canBunt,
  buntSuccessChance,
  attemptBunt,
  intentionalWalk,
  pendingAdvanceDecision,
  resolveAdvanceDecision,
  stateLeverage
} from "../game.js?v=20260715-d";
import { buildTeam } from "../draft.js?v=20260715-d";
import { createRng } from "../rng.js?v=20260715-d";
import { npcMaybeSteal, npcMaybePullPitcher, profileFor } from "./ai.js?v=20260715-d";

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
    starterIndex,
    playerIsAway,
    profile: profileFor(trainer?.aiProfile),
    state,
    rng: createRng(seed),
    events: [],
    eventCount: 0,
    // Every managerial decision, in the order it was made. The game is a pure
    // function of its seed and this list, which is the whole reason a battle
    // can be rebuilt from a few hundred bytes instead of a serialized state.
    actions: []
  };
}

// A game in progress, small enough to sit in the save: the seed it was dealt
// from and the decisions taken since. The state is NOT stored — it is replayed.
// (eventCount rides along as a checksum: if a rebuild lands on a different
// number of events, the recording no longer describes this engine and the
// caller is told so rather than handed a subtly wrong game.)
export function serializeBattle(battle) {
  return {
    seed: battle.seed,
    starterIndex: battle.starterIndex,
    playerIsAway: battle.playerIsAway,
    eventCount: battle.eventCount,
    actions: battle.actions.map((action) => ({ ...action }))
  };
}

const REPLAY = {
  swing: (battle) => actSwing(battle),
  pitch: (battle) => actPitch(battle),
  steal: (battle, action) => actSteal(battle, action.from),
  bunt: (battle) => actBunt(battle),
  advance: (battle, action) => actAdvance(battle, action.send),
  iwalk: (battle) => actIntentionalWalk(battle),
  pen: (battle, action) => actChangePitcher(battle, action.index),
  fastForward: (battle) => fastForward(battle)
};

// Deal the same game again and re-take the same decisions. The dice follow,
// because they always followed from the seed. Returns null if the recording
// cannot be replayed onto this engine — a save from an older build, say —
// so a bad restore reads as "no game to resume" rather than a wrong one.
export function restoreBattle({ playerManager, npcManager, trainer, seed, starterIndex, playerIsAway, actions, eventCount }) {
  const battle = createBattle({ playerManager, npcManager, trainer, seed, starterIndex, playerIsAway });
  for (const action of actions ?? []) {
    const replay = REPLAY[action.type];
    if (!replay) return null;
    replay(battle, action);
    // The UI gives the NPC skipper his look at the mound after every action,
    // so the replay has to give him the same look, at the same points.
    npcMoundVisit(battle);
  }
  return typeof eventCount === "number" && battle.eventCount !== eventCount ? null : battle;
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

// The decision goes in the book before the dice are thrown for it, so an action
// that turns out to be a no-op (a steal call on an empty base) is still part of
// the recording — replaying has to consume the game the same way it was played.
function record(battle, action) {
  battle.actions.push(action);
}

// The NPC skipper's between-batters mound visit, as its OWN event: the UI
// calls this when a new plate appearance is about to start, so the change
// announces itself before the player picks an action against the new arm —
// never inside the swing. Only fires between batters (no mid-play changes,
// no pending advance decision).
export function npcMoundVisit(battle) {
  if (battlePhase(battle).type !== "player-batting") return null;
  const pulled = npcMaybePullPitcher(battle.state, battle.npcSide, battle.profile);
  if (!pulled) return null;
  return pushEvent(battle, pitchingChangeEvent(battle, battle.npcSide, pulled));
}

// Player action while batting: let the plate appearance rip.
export function actSwing(battle) {
  record(battle, { type: "swing" });
  return [pushEvent(battle, playPlateAppearance(battle.state, battle.rng))];
}

// Player action while batting: send the runner on the chosen base.
export function actSteal(battle, fromIndex) {
  record(battle, { type: "steal", from: fromIndex });
  const event = attemptSteal(battle.state, fromIndex, battle.rng);
  return event ? [pushEvent(battle, event)] : [];
}

// Player action while batting: lay down a sacrifice bunt (traditional
// Showdown — it always gets down, so no dice ride on it).
export function actBunt(battle) {
  record(battle, { type: "bunt" });
  const event = attemptBunt(battle.state);
  return event ? [pushEvent(battle, event)] : [];
}

// Player decision after their own hit or fly ball: send the first `sendCount`
// runners (lead first), hold the rest.
export function actAdvance(battle, sendCount) {
  record(battle, { type: "advance", send: sendCount });
  const event = resolveAdvanceDecision(battle.state, sendCount, battle.rng);
  return event ? [pushEvent(battle, event)] : [];
}

// Player action while pitching: put the batter on for free.
export function actIntentionalWalk(battle) {
  record(battle, { type: "iwalk" });
  const event = intentionalWalk(battle.state);
  return event ? [pushEvent(battle, event)] : [];
}

// Player action while pitching: face the batter. The NPC offense gets its
// steal look first; if a runner goes, that IS the event — the decision point
// comes back around before the plate appearance.
export function actPitch(battle) {
  record(battle, { type: "pitch" });
  const steal = npcMaybeSteal(battle.state, battle.rng, battle.profile);
  if (steal) return [pushEvent(battle, steal)];
  return [pushEvent(battle, playPlateAppearance(battle.state, battle.rng))];
}

// Player action while pitching: go to the pen. Pass a staff index to bring
// in a specific arm; omit it for the next man up.
export function actChangePitcher(battle, targetIndex = null) {
  record(battle, { type: "pen", index: targetIndex });
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
// ---- Leverage ----------------------------------------------------------------
//
// What a moment is WORTH, from MLB history rather than from a rule somebody
// wrote down: src/data/leverage.js is Greg Stoll's leverage index, the same
// Retrosheet dataset the win expectancy comes from. 1.0 is an average plate
// appearance; 3.06 is the bases loaded with two out in a tie; 10.4 is bases
// loaded, two out, down one in the bottom of the ninth.
//
// The rules these thresholds replaced were guesses at the same quantity, and
// they were wrong in both directions: they called EVERY eighth-inning plate
// appearance a leverage moment (a 9-run game in the 8th is not a leverage
// moment) and they refused to call a one-run ninth dramatic if the batting team
// happened to be the one ahead (a closer protecting a one-run lead is the most
// leveraged thing in baseball). The table knows the difference. Nothing else in
// the game had to change: the moments simply became the real ones.

// Fast-forward hands the game back when it starts to matter — twice an average
// plate appearance. Measured over 300 games: 8.5% of plate appearances, about
// one in twelve.
export const LEVERAGE_STOP = 2;

// And the d20 comes out slow when it REALLY matters. Measured the same way:
//
//   2.50 ... 4.5% of plate appearances, about 1 in 22
//   2.25 ... 5.7% of plate appearances, about 1 in 18   <- here
//   2.00 ... 8.5%, which is where fast-forward already hands back
//
// It sat at 2.50 and the die came out a shade too rarely to feel like the game's
// heartbeat. A quarter of a point is the whole change: roughly one dramatic
// moment every eighteen plate appearances instead of every twenty-two — four or
// five a game rather than three. Still scarce, which is the point of it; a die
// that tumbles for everything is just a slow game.
export const DRAMA_LEVERAGE = 2.25;

export function isLeverageMoment(state) {
  return stateLeverage(state) >= LEVERAGE_STOP;
}

// The moments that earn the slow d20. Checked BEFORE the plate appearance
// resolves — the drama is in the wind-up, which is exactly what the leverage
// index measures: not what happened, but what COULD.
export function isDramaticMoment(state) {
  return stateLeverage(state) >= DRAMA_LEVERAGE;
}

// Auto-resolve on engine autopilot (decision matrix steals and advances,
// fatigue-based pitching for both sides, NPC profile moves) until the next
// leverage moment or the end of the game.
export function fastForward(battle, { maxEvents = 500 } = {}) {
  record(battle, { type: "fastForward" });
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
      // Manage the player's pen the way a balanced skipper would — which for a
      // long time this did not do. It said "pull at fatigue 2 and take the next
      // man along the bench," which is the rule the hook replaced, kept alive in
      // the one place nobody looked: your own dugout, on autopilot. It was blind
      // in both directions and worse than blind in one. The bench is sorted
      // WORST-CONTROL-FIRST (buildPitchingPlan, from the old scripted staff where
      // the closer was meant to finish), so "the next man along" is by
      // construction the worst arm you own — and your best one waited behind him
      // for a game that usually ended first. That is how an IP 1 reliever throws
      // four innings while the ace of your pen gets a one-inning cameo.
      //
      // It is the same hook now, at the same bar, that the other dugout has been
      // using all along. One rule, every mound.
      const pulled = autoRelieve(state, battle.playerSide);
      if (pulled) events.push(pushEvent(battle, pitchingChangeEvent(battle, battle.playerSide, pulled)));
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
      lineScore: result.lineScore,
      // Feats (slams, comebacks) read the play-by-play; the events ride the
      // transient series result but never land in the save.
      events: result.events
    });
  }

  return { games, playerWins, npcWins, playerWonSeries: playerWins > npcWins, bestOf };
}
