import {
  createInitialState,
  playPlateAppearance,
  pinchHit,
  pinchRun,
  defensiveSub,
  availableBench,
  substitutionEligibility,
  autoSubstituteFor,
  pinchSubKeepsDefense,
  defensiveSubFits,
  walkoffSpot,
  swapDefensivePositions,
  positionTrades,
  dhTakesTheField,
  dhMoveOptions,
  pendingRealign,
  acceptRealign,
  manualRealign,
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
} from "../game.js?v=20260716-records";
import { buildTeam, pickRandomStarter } from "../draft.js?v=20260716-records";
import { createRng } from "../rng.js?v=20260716-records";
import { npcMaybeSteal, npcMaybePullPitcher, profileFor } from "./ai.js?v=20260716-records";

// The interactive battle: one seeded game where the engine pauses before
// every plate appearance so the humans (well, one human) can manage.
// Single games put the player on the road (you are the one traveling);
// series alternate home and away game to game, like a real series.
export function createBattle({ playerManager, npcManager, trainer, seed, starterIndex = 0, npcStarterIndex = null, playerIsAway = true }) {
  const playerTeam = buildTeam(playerManager, { starterIndex });
  // The full-roster format draws each dugout's starter separately; classic
  // callers pass nothing and the NPC opens with the same rotation slot.
  const npcTeam = buildTeam(npcManager, { starterIndex: npcStarterIndex ?? starterIndex });
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
  // A defense of the player's that needs bench help to cover the field is a
  // question, not a housekeeping task: he is asked before anyone is spent.
  state.deferRealignFor = playerSide;
  return {
    seed,
    trainer,
    playerSide,
    npcSide,
    starterIndex,
    npcStarterIndex,
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
    npcStarterIndex: battle.npcStarterIndex ?? null,
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
  ra: (battle) => actAcceptRealign(battle),
  rm: (battle, action) => actManualRealign(battle, action.id, action.target),
  ph: (battle, action) => actPinchHit(battle, action.id),
  pr: (battle, action) => actPinchRun(battle, action.id, action.base),
  ds: (battle, action) => actDefensiveSub(battle, action.id, action.target),
  dx: (battle, action) => actDefenseSwap(battle, action.a, action.b),
  dh: (battle, action) => actDhTakesField(battle, action.target),
  fastForward: (battle) => fastForward(battle)
};

// Deal the same game again and re-take the same decisions. The dice follow,
// because they always followed from the seed. Returns null if the recording
// cannot be replayed onto this engine — a save from an older build, say —
// so a bad restore reads as "no game to resume" rather than a wrong one.
export function restoreBattle({ playerManager, npcManager, trainer, seed, starterIndex, npcStarterIndex = null, playerIsAway, actions, eventCount }) {
  const battle = createBattle({ playerManager, npcManager, trainer, seed, starterIndex, npcStarterIndex, playerIsAway });
  for (const action of actions ?? []) {
    const replay = REPLAY[action.type];
    if (!replay) return null;
    replay(battle, action);
    // The UI gives the NPC skipper his look at the dugout after every action,
    // so the replay has to give him the same look, at the same points.
    npcDugoutVisit(battle);
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
      // A forfeit outranks the scoreboard: the club that could not field a
      // legal defense loses, whatever the score reads.
      playerWon: state.forfeitedBy
        ? state.forfeitedBy === battle.npcSide
        : state.score[battle.playerSide] > state.score[battle.npcSide],
      forfeitedBy: state.forfeitedBy ?? null,
      score: { ...state.score }
    };
  }
  // A broken defense stops the game: nothing can be pitched until the nine
  // can cover the field, so this is asked before anything else.
  const realign = pendingRealign(state);
  if (realign && realign.side === battle.playerSide) {
    return {
      type: "realign",
      realign,
      bench: availableBench(state, battle.playerSide),
      lineup: state[battle.playerSide].lineup
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
      bench: availableBench(state, battle.playerSide),
      subEligibility: substitutionEligibility(state, battle.playerSide),
      // Occupied bases a pinch-runner could take, innermost first.
      pinchRunBases: state.bases
        .map((runner, base) => (runner ? { base, runner } : null))
        .filter(Boolean),
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
    bullpen: availableRelievers(battle),
    bench: availableBench(state, battle.playerSide),
    subEligibility: substitutionEligibility(state, battle.playerSide),
    // The nine on the field: who each man could be replaced by off the
    // bench, and who he could trade spots with out there.
    defenseTargets: state[battle.playerSide].lineup.map((player) => ({
      player,
      trades: positionTrades(state, battle.playerSide, player.id)
    })),
    // What it would take to send the DH out to a glove, and what it costs.
    dhMoves: dhMoveOptions(state, battle.playerSide)
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

// Engine events generated between plays — a forced double-switch at the turn
// of an inning, a forfeit — into the book, after whatever play queued them.
// Every action drains, so a replayed recording books them at the same points.
function drainEngineEvents(battle) {
  const queued = battle.state.pendingSubEvents ?? [];
  const events = [];
  while (queued.length) events.push(pushEvent(battle, queued.shift()));
  return events;
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

// The NPC's trip to its bench, on either side of the ball: pinch moves when
// it bats, a defensive glove when it fields. Same decision rules as auto
// play, bent by the trainer's temperament (subBias); rng-free, so a replay
// makes the identical trips. Loops so a pinch-hitter AND a pinch-runner can
// both come on in one visit, each as its own event.
export function npcBenchVisit(battle) {
  const events = [];
  let guard = 4;
  while (guard-- > 0) {
    const phase = battlePhase(battle);
    if (phase.type !== "player-batting" && phase.type !== "player-pitching") break;
    const event = autoSubstituteFor(battle.state, battle.npcSide, battle.profile.subBias ?? 1);
    if (!event) break;
    events.push(pushEvent(battle, event));
  }
  return events;
}

// Every between-actions look the NPC skipper gets: the bench first, then the
// mound. The interactive layer and the replay call this at the same points,
// which is what keeps a restored recording's eventCount honest.
export function npcDugoutVisit(battle) {
  const events = npcBenchVisit(battle);
  const mound = npcMoundVisit(battle);
  if (mound) events.push(mound);
  return events;
}

// Player action while batting: let the plate appearance rip.
export function actSwing(battle) {
  record(battle, { type: "swing" });
  return [pushEvent(battle, playPlateAppearance(battle.state, battle.rng)), ...drainEngineEvents(battle)];
}

// Player action while batting: send the runner on the chosen base.
export function actSteal(battle, fromIndex) {
  record(battle, { type: "steal", from: fromIndex });
  const event = attemptSteal(battle.state, fromIndex, battle.rng);
  return event ? [pushEvent(battle, event), ...drainEngineEvents(battle)] : drainEngineEvents(battle);
}

// Player action while batting: lay down a sacrifice bunt (traditional
// Showdown — it always gets down, so no dice ride on it).
export function actBunt(battle) {
  record(battle, { type: "bunt" });
  const event = attemptBunt(battle.state);
  return event ? [pushEvent(battle, event), ...drainEngineEvents(battle)] : drainEngineEvents(battle);
}

// Player decision after their own hit or fly ball: send the first `sendCount`
// runners (lead first), hold the rest.
export function actAdvance(battle, sendCount) {
  record(battle, { type: "advance", send: sendCount });
  const event = resolveAdvanceDecision(battle.state, sendCount, battle.rng);
  return event ? [pushEvent(battle, event), ...drainEngineEvents(battle)] : drainEngineEvents(battle);
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
  if (steal) return [pushEvent(battle, steal), ...drainEngineEvents(battle)];
  return [pushEvent(battle, playPlateAppearance(battle.state, battle.rng)), ...drainEngineEvents(battle)];
}

// Player action while pitching: go to the pen. Pass a staff index to bring
// in a specific arm; omit it for the next man up.
export function actChangePitcher(battle, targetIndex = null) {
  record(battle, { type: "pen", index: targetIndex });
  const pitcher = changePitcher(battle.state, battle.playerSide, targetIndex);
  if (!pitcher) return [];
  return [pushEvent(battle, pitchingChangeEvent(battle, battle.playerSide, pitcher))];
}

// The two answers to a broken defense: let the skipper fix it, or fix it
// yourself, one man at a time, until the nine can cover the field.
export function actAcceptRealign(battle) {
  record(battle, { type: "ra" });
  acceptRealign(battle.state);
  return drainEngineEvents(battle);
}

export function actManualRealign(battle, cardId, targetId) {
  record(battle, { type: "rm", id: cardId, target: targetId });
  manualRealign(battle.state, cardId, targetId);
  return drainEngineEvents(battle);
}

// Player substitutions. Recorded by CARD ID — bench order shifts as men
// leave it, so an index would replay as a different man.
export function actPinchHit(battle, cardId) {
  record(battle, { type: "ph", id: cardId });
  const event = pinchHit(battle.state, battle.playerSide, cardId);
  return event ? [pushEvent(battle, event)] : [];
}

export function actPinchRun(battle, cardId, baseIndex) {
  record(battle, { type: "pr", id: cardId, base: baseIndex });
  const event = pinchRun(battle.state, battle.playerSide, cardId, baseIndex);
  return event ? [pushEvent(battle, event)] : [];
}

// Moving two men who are already out there. Not a substitution — nobody
// enters, nobody leaves — so it is legal in any inning.
// Sending the DH out to a glove — the one move on this screen that costs a
// man and the designated hitter both (Official Baseball Rule 5.11).
export function actDhTakesField(battle, targetId) {
  record(battle, { type: "dh", target: targetId });
  const event = dhTakesTheField(battle.state, battle.playerSide, targetId);
  return event ? [pushEvent(battle, event), ...drainEngineEvents(battle)] : drainEngineEvents(battle);
}

export function actDefenseSwap(battle, idA, idB) {
  record(battle, { type: "dx", a: idA, b: idB });
  const event = swapDefensivePositions(battle.state, battle.playerSide, idA, idB);
  return event ? [pushEvent(battle, event), ...drainEngineEvents(battle)] : drainEngineEvents(battle);
}

export function actDefensiveSub(battle, cardId, targetId) {
  record(battle, { type: "ds", id: cardId, target: targetId });
  const event = defensiveSub(battle.state, battle.playerSide, cardId, targetId);
  return event ? [pushEvent(battle, event)] : [];
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

// Auto-resolve on engine autopilot (break-even steals and advances,
// fatigue-based pitching for both sides, NPC profile moves) until the next
// leverage moment or the end of the game.
export function fastForward(battle, { maxEvents = 500 } = {}) {
  record(battle, { type: "fastForward" });
  const state = battle.state;
  const events = [];
  let guard = maxEvents;

  // Autopilot takes the wheel: no deferred decisions while it runs, and any
  // decision already waiting resolves by the break-even.
  const deferredFor = state.deferAdvancesFor;
  state.deferAdvancesFor = null;
  const pendingEvent = resolveAdvanceDecision(state, "auto", battle.rng);
  if (pendingEvent) events.push(pushEvent(battle, pendingEvent));

  while (!isGameOver(state) && guard > 0) {
    guard -= 1;
    // Both benches run on the same autopilot the sim uses — the NPC with its
    // temperament, the player's dugout on the balanced rule (the exact
    // precedent the pen sets below). One sub per pass; the loop comes around.
    const subEvent = autoSubstituteFor(state, battle.npcSide, battle.profile.subBias ?? 1)
      ?? autoSubstituteFor(state, battle.playerSide);
    if (subEvent) {
      events.push(pushEvent(battle, subEvent));
      continue;
    }
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
    events.push(...drainEngineEvents(battle));
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

  // Full-format rotations are drawn, not walked: ONE seeded draw per game,
  // shared by both dugouts — rotations are ranked by points (buildTeam), so
  // the drawn rank pits each club's Nth-best arm against the other's. No
  // rank starts more than its ceil(bestOf/4) share. Classic managers keep
  // the fixed turn — game N is rotation slot N.
  const starterCounts = {};
  const drawRank = (gameNumber) => {
    const pick = pickRandomStarter({
      rng: createRng(`${seed}:starter:g${gameNumber}`),
      starterCount: playerManager.startingPitchers ?? 4,
      priorStartCounts: starterCounts,
      bestOf
    });
    starterCounts[pick] = (starterCounts[pick] ?? 0) + 1;
    return pick;
  };

  for (let gameNumber = 1; playerWins < needed && npcWins < needed; gameNumber += 1) {
    const full = playerManager.rosterFormat === "full" || npcManager.rosterFormat === "full";
    const rank = full ? drawRank(gameNumber) : null;
    const starterFor = (manager) => (manager.rosterFormat === "full" ? rank : gameNumber - 1);
    const playerTeam = buildTeam(playerManager, { starterIndex: starterFor(playerManager) });
    const npcTeam = buildTeam(npcManager, { starterIndex: starterFor(npcManager) });
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
      twenties: result.twenties,
      boxScore: result.boxScore,
      lineScore: result.lineScore,
      // Feats (slams, comebacks) read the play-by-play; the events ride the
      // transient series result but never land in the save.
      events: result.events
    });
  }

  return { games, playerWins, npcWins, playerWonSeries: playerWins > npcWins, bestOf };
}
