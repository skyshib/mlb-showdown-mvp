import {
  escapeHtml,
  menuHtml,
  clampIndex,
  describeEvent,
  halfLabel,
  diamondHtml,
  outsHtml,
  shortName,
  stripCardYear,
  surname,
  cardPanelHtml,
  cardLine
} from "./helpers.js?v=20260713-x";
import { gameStars, gameLogRows, statLineHtml, seriesStatLines, winProbChartHtml } from "./statsScreens.js?v=20260713-x";
import { recordCompletedRun } from "../hallOfFame.js?v=20260713-x";
import { cardById } from "../packs.js?v=20260713-x";
import { buildBoxScore, inningsPlayed, pitcherStatus, fieldingCheckNeeds } from "../../rules/game.js?v=20260713-x";
import { trainerById, rewardCoins, markAmbushDone } from "../region.js?v=20260713-x";
import { gameFeats } from "../feats.js?v=20260713-x";
import { buildNpcTeam } from "../npcTeams.js?v=20260713-x";
import { positionsOverlap } from "../../rules/cards.js?v=20260713-x";
import { playArmTiring, playArmSpent, playVictory, playDefeat } from "../../ui/sounds.js?v=20260713-x";
import {
  persistSave,
  deriveSeed,
  managerFor,
  grantCoins,
  recordTrainerWin,
  recordTrainerLoss,
  timesBeaten,
  grantBadge,
  addCardToCollection,
  rosterCards,
  addLog,
  startSeries,
  attemptNumber,
  recordSeriesGame,
  recordGameStats,
  ensureSeasonStats,
  recordAlmanacGame,
  addTrophies,
  clearSeries
} from "../state.js?v=20260713-x";
import {
  createBattle,
  battlePhase,
  actSwing,
  actSteal,
  actBunt,
  actAdvance,
  actIntentionalWalk,
  actPitch,
  actChangePitcher,
  fastForward,
  runSimSeries,
  isDramaticMoment,
  npcMoundVisit,
  serializeBattle,
  restoreBattle
} from "../../rules/battle/controller.js?v=20260713-x";

export function startTrainerBattle(app, trainer) {
  const save = app.save;

  if (trainer.battleFormat.type === "simSeries") {
    const attempt = attemptNumber(save, trainer.id);
    const series = runSimSeries({
      playerManager: managerFor(save),
      npcManager: buildNpcTeam(trainer, save),
      bestOf: trainer.battleFormat.bestOf,
      seed: deriveSeed(save, "sim", trainer.id, `a${attempt}`)
    });
    for (const game of series.games) {
      recordGameStats(save, game.playerIsAway ? game.boxScore.away : game.boxScore.home);
      recordFinishedGame(save, {
        trainer,
        boxScore: game.boxScore,
        playerSide: game.playerIsAway ? "away" : "home",
        events: game.events,
        score: game.playerIsAway
          ? { away: game.playerRuns, home: game.npcRuns }
          : { away: game.npcRuns, home: game.playerRuns },
        innings: game.innings,
        won: game.playerWon,
        lineScore: game.lineScore
      });
    }
    const outcome = applyOutcome(app, trainer, series.playerWonSeries);
    persistSave(save);
    app.go("simSeries", { trainerId: trainer.id, series, revealed: 0, outcome });
    app.rerender();
    return;
  }

  if (!save.activeSeries || save.activeSeries.trainerId !== trainer.id) {
    startSeries(save, trainer.id, trainer.battleFormat.bestOf ?? 1);
  }
  launchSeriesGame(app, trainer);
}

function launchSeriesGame(app, trainer) {
  const save = app.save;
  const series = save.activeSeries;
  // Series alternate ballparks: the player visits in odd games, hosts evens.
  const playerIsAway = series.bestOf <= 1 || series.nextGame % 2 === 1;
  const battle = createBattle({
    playerManager: managerFor(save),
    npcManager: buildNpcTeam(trainer, save),
    trainer,
    seed: deriveSeed(save, "battle", trainer.id, `a${series.attempt}`, `g${series.nextGame}`),
    starterIndex: series.nextGame - 1,
    playerIsAway
  });
  const lines = [
    series.bestOf > 1 ? `GAME ${series.nextGame} of the best-of-${series.bestOf}.` : "One game. Winner takes the coins.",
    playerIsAway ? "You're the visitors. Top 1 — grab a bat." : "Your ballpark tonight. Take the mound."
  ];
  stashBattle(save, trainer.id, battle, lines);
  persistSave(save);
  app.go("battle", {
    trainerId: trainer.id,
    battle,
    lines,
    // The book opens with the words the game opens with.
    playLog: [{ half: "top", inning: 1, score: { away: 0, home: 0 }, lines }],
    menuIndex: 0,
    mode: "menu"
  });
  app.rerender();
}

// ---- A game you can walk away from mid-inning --------------------------------

// A game in progress belongs in the save, not just in the tab. What's written
// is the seed and the decisions taken — the state is replayed from them — so
// a game costs a few hundred bytes and can never be a half-consistent snapshot
// of the engine's internals.
function stashBattle(save, trainerId, battle, lines) {
  save.activeBattle = { trainerId, lines: lines ?? [], ...serializeBattle(battle) };
}

function clearBattle(save) {
  save.activeBattle = null;
}

// Boot with a game still on the books: deal it again, re-take every decision,
// and put the manager back where he was standing. A recording this build can't
// replay is dropped rather than half-applied — you lose the game, not the save.
// Returns the screen to open on, or null if there is nothing to come back to.
export function resumeBattle(app) {
  const save = app.save;
  const stashed = save?.activeBattle;
  if (!stashed) return null;
  const trainer = trainerById(stashed.trainerId);
  const battle = trainer && restoreBattle({
    playerManager: managerFor(save),
    npcManager: buildNpcTeam(trainer, save),
    trainer,
    ...stashed
  });
  if (!battle) {
    clearBattle(save);
    persistSave(save);
    return null;
  }
  const screen = {
    trainerId: trainer.id,
    battle,
    lines: stashed.lines ?? [],
    playLog: rebuildPlayLog(battle),
    menuIndex: 0,
    mode: "menu"
  };
  // A game that was already over when the tab closed comes back to its FINAL
  // screen — the coins and the box score are handed out from there, and they
  // have not been handed out yet.
  const phase = battlePhase(battle);
  return phase.type === "over"
    ? { name: "gameOver", ...screen, phase }
    : { name: "battle", ...screen };
}

// Coins, badge, pack, and log bookkeeping for any battle outcome. Reward
// coins are read before the win is recorded so first-win pay is full price.
// Exported for tests. The first win over any trainer also earns a card claim:
// the player takes one card off the beaten roster (repeat wins pay coins only).
export function applyOutcome(app, trainer, won) {
  const save = app.save;
  // A rival bout only happens once: played to any result, it's over.
  if (trainer.ambush) markAmbushDone(save, trainer.id);
  if (!won) {
    recordTrainerLoss(save);
    addLog(save, `Lost to ${trainer.name}.`);
    // A loss costs the game and nothing else. Going out to lose to somebody
    // better than you is how a manager gets better, and it should not be taxed.
    return { won: false, coins: 0 };
  }
  const firstWin = timesBeaten(save, trainer.id) === 0;
  const coins = rewardCoins(save, trainer);
  grantCoins(save, coins);
  recordTrainerWin(save, trainer.id);
  const outcome = { won: true, coins, badge: null, pack: null, cardClaim: firstWin };
  if (trainer.rewards.badge && !save.player.badges.includes(trainer.rewards.badge)) {
    grantBadge(save, trainer.rewards.badge);
    outcome.badge = trainer.rewards.badge;
    // The Commissioner's Trophy finishes the campaign: the run enters the
    // hall of fame the moment it is won.
    if (trainer.rewards.badge === "trophy") recordCompletedRun(save);
  }
  // The pack, like the badge and the claimed card, is paid ONCE. A rematch pays
  // a wage, in coins, and the coins are the point: cards you go and buy, from a
  // shop, chasing the catalog. A boss who handed out a fresh pack every lap would
  // fill it for you.
  if (trainer.rewards.pack && firstWin) {
    save.progress.counters.packsOpened += 1;
    save.pendingPacks.push({
      packId: trainer.rewards.pack,
      seed: deriveSeed(save, "pack", save.progress.counters.packsOpened)
    });
    outcome.pack = trainer.rewards.pack;
  }
  outcome.rematch = !firstWin;
  addLog(save, `${firstWin ? "Beat" : "Beat (again)"} ${trainer.name} (+${coins} coins).`);
  return outcome;
}

// One finished game's history, wherever it came from (interactive battle or
// sim series): feats detected, an almanac page written, trophies framed.
// Returns the feats so the box-score screen can reuse them. Called after
// recordGameStats, so the season game count IS the day this game happened.
export function recordFinishedGame(save, { trainer, boxScore, playerSide, events, score, innings, won, lineScore = null }) {
  const feats = gameFeats({ boxScore, playerSide, events, score, innings });
  const day = ensureSeasonStats(save).games;
  recordAlmanacGame(save, {
    day,
    trainerId: trainer.id,
    opponent: trainer.name,
    won,
    score,
    playerSide,
    innings,
    feats,
    boxScore,
    // Games played before the board existed have no frames to hang; the box
    // score simply leaves the wall bare rather than inventing them.
    lineScore
  });
  addTrophies(save, feats, { day, opponent: trainer.name });
  return feats;
}

// ---- Interactive battle ----------------------------------------------------

function battleMenuItems(app, phase) {
  if (phase.type === "advance-decision") {
    return advanceMenuItems(phase.pending);
  }
  if (phase.type === "player-batting") {
    const items = [{ label: "SWING AWAY", run: (a) => resolveWithDrama(a, () => actSwing(a.screen.battle)) }];
    if (phase.canBunt) {
      items.push({
        label: "SAC BUNT",
        run: (a) => afterAction(a, actBunt(a.screen.battle))
      });
    }
    for (const option of phase.stealOptions) {
      items.push({
        html: `STEAL ${option.toIndex === 2 ? "3B" : "2B"} — ${escapeHtml(shortName(option.runner.name))} <span class="gq-dim">${Math.round(option.safeChance * 100)}% SAFE</span>`,
        run: (a) => afterAction(a, actSteal(a.screen.battle, option.fromIndex))
      });
    }
    items.push(rostersItem(), gameLogItem(), fastForwardItem());
    return items;
  }
  const items = [{ label: "PITCH TO HIM", run: (a) => resolveWithDrama(a, () => actPitch(a.screen.battle)) }];
  items.push({
    label: "INTENTIONAL WALK",
    run: (a) => afterAction(a, actIntentionalWalk(a.screen.battle))
  });
  items.push({
    label: `BULLPEN${phase.bullpen.length ? "" : " (EMPTY)"}`,
    disabled: !phase.bullpen.length,
    run: (a) => {
      a.screen.mode = "pen";
      a.screen.penIndex = 0;
    }
  });
  items.push(rostersItem(), gameLogItem(), fastForwardItem());
  return items;
}

// The send-or-hold menu after the player's hit or fly ball. Runners are lead
// first, and a trailing runner only goes if everyone ahead of him goes.
function advanceMenuItems(pending) {
  const verb = pending.kind === "tagup" ? "TAG UP" : "SEND";
  const items = [{
    label: pending.kind === "tagup" ? "NOBODY TAGS" : "HOLD THE RUNNERS",
    // Holding throws no dice. There is nothing to be suspenseful about.
    run: (a) => afterAction(a, actAdvance(a.screen.battle, 0), ["The runners hold."])
  }];
  pending.candidates.forEach((candidate, index) => {
    const sent = pending.candidates.slice(0, index + 1);
    const names = sent
      .map((c) => `${shortName(c.runner.name)} &#8594; ${destLabel(c.toIndex)}`)
      .join(", ");
    // The defense throws at the shakiest runner, so that's the live risk.
    const odds = Math.round(Math.min(...sent.map((c) => c.safeChance)) * 100);
    items.push({
      html: `${verb} ${names} <span class="gq-dim">${odds}% SAFE</span>`,
      run: (a) => resolveWithDrama(a, () => actAdvance(a.screen.battle, index + 1))
    });
  });
  return items;
}

function destLabel(toIndex) {
  if (toIndex >= 3) return "HOME";
  if (toIndex === 2) return "3B";
  return "2B";
}

function rostersItem() {
  return {
    label: "ROSTERS",
    run: (a) => {
      a.screen.mode = "rosters";
      a.screen.rosterIndex = 0;
    }
  };
}

function gameLogItem() {
  return {
    label: "GAME LOG",
    run: (a) => {
      a.screen.mode = "log";
      a.screen.logIndex = Math.max(0, a.screen.battle.events.length - 1);
    }
  };
}

// Every play so far with its WPA, newest at the bottom (the cursor starts
// there — you usually want to reread what just happened).
function renderGameLog(app, battle, trainer) {
  const rows = gameLogRows(battle.events, battle.playerSide);
  const index = clampIndex(app.screen.logIndex ?? rows.length - 1, rows.length);
  return `<div class="gq-screen">
    <div class="gq-topbar"><span>GAME LOG &middot; VS ${escapeHtml(trainer.name)}</span><span>${halfLabel(battle.state)}</span></div>
    ${winProbChartHtml(battle.events, battle.playerSide, index)}
    <div class="gq-body"><div class="gq-frame gq-scroll">${
      rows.length
        ? menuHtml(rows, index, { className: "gq-log-list" })
        : `<p class="gq-dim">NO PLAYS YET. GO MAKE SOME HISTORY.</p>`
    }</div></div>
    <div class="gq-textbox"><p class="gq-dim">THE LINE IS YOUR WIN ODDS, PLAY BY PLAY &mdash; TOUCH IT TO JUMP TO THE PLAY. X to go back.</p></div>
  </div>`;
}

function fastForwardItem() {
  return {
    label: "FAST FORWARD",
    run: (a) => {
      const events = fastForward(a.screen.battle);
      const tail = events.filter(Boolean).slice(-2).flatMap((event) => describeEvent(event, a.screen.battle.playerSide));
      afterAction(a, [], [`&#9193; ${events.length} plays on autopilot...`, ...tail]);
    }
  };
}

// ---- Dice-roll drama ---------------------------------------------------------

// High-leverage plate appearances (two outs and the bases loaded, or the 9th
// onward in a tight game) pause on the tumbling d20s before the call. The
// engine has already rolled — the pause is pure theater, staged the way the
// tabletop plays it: the PITCH die lands first and calls whose chart it is,
// then the SWING die lands, then the lines read out. The drama screen hides
// the HUD so the updated score can't spoil the result. Z skips the suspense.
function resolveWithDrama(app, act) {
  const dramatic = isDramaticMoment(app.screen.battle.state);
  const events = act();
  const stages = dramatic ? dramaStages(events) : null;
  if (!stages) return afterAction(app, events);
  app.screen.mode = "drama";
  app.screen.drama = { events, stages };
}

// EVERY die the play threw, in the order the table would have thrown them. The
// pitch and the swing were the only two staged, which meant the suspense screen
// stopped talking exactly where the play got interesting: a two-out grounder in
// the ninth cut to black and came back as a double play, and the die that turned
// it — the one you were actually sweating — was never shown. A ball in play is
// checked by a glove, and the glove rolls too.
// What the bat did, in a few words, so the fielding die that follows has something
// to follow. A die that starts tumbling for a double play before you have been
// told there IS a ground ball is a die you are watching for no reason.
const SWING_CALL = {
  SO: "STRUCK HIM OUT",
  GB: "GROUND BALL",
  FB: "FLY BALL",
  PU: "POPPED IT UP",
  BB: "BALL FOUR",
  HBP: "WEARS ONE",
  "1B": "BASE HIT",
  "1B+": "BASE HIT",
  "2B": "INTO THE GAP",
  "3B": "OFF THE WALL",
  HR: "GONE"
};

// What the defense has to throw. A die you are watching without knowing what it
// has to beat is a die you are only waiting on.
function needsLine(attempt) {
  const needs = fieldingCheckNeeds(attempt);
  if (!needs) return "";
  if (needs.certain) return "THEY HAVE HIM DEAD TO RIGHTS";
  if (needs.impossible) return "NOTHING CAN CATCH HIM";
  return `DEFENSE NEEDS A ${needs.needed}`;
}

function swingCall(event) {
  const call = SWING_CALL[event.result];
  return call ? `${escapeHtml(event.result)} — ${call}` : escapeHtml(String(event.result ?? "IN PLAY"));
}

function fieldingStages(event) {
  const details = event.playDetails ?? {};
  const stages = [];
  const dp = details.doublePlayAttempt;
  if (typeof dp?.roll === "number") {
    stages.push({
      label: "THE PIVOT",
      roll: dp.roll,
      // Said BEFORE the die tumbles, so you know what you are watching — and what
      // the die has to beat, which is the only thing that makes watching it a
      // sweat rather than a wait.
      lead: `THEY GO FOR TWO&hellip; ${needsLine(dp)}`,
      // LATE: a glove only has something to do if the ball is in play, so a die
      // that says THE PIVOT sitting on the screen while the swing is still
      // tumbling has already told you the swing was a ball in play. It is not
      // drawn until it is thrown.
      late: true,
      caption: dp.batterOut ? "TURNED IT — TWO DOWN" : "ONLY ONE — HE BEAT THE THROW"
    });
  }
  // A throw is recorded once but filed twice: the attempts list holds the very
  // same object the thrownAttempt does. Dedupe by identity or the die is staged
  // twice and the play looks like it threw two of them.
  const seen = new Set();
  const throws = [
    details.thrownAttempt,
    ...(details.attempts ?? []),
    ...(details.tagUpAttempts ?? []),
    ...(details.extraBaseAttempts ?? [])
  ];
  for (const attempt of throws) {
    if (!attempt || typeof attempt.roll !== "number" || seen.has(attempt)) continue;
    seen.add(attempt);
    stages.push({
      label: `THROW TO ${escapeHtml(String(attempt.to ?? "").toUpperCase())}`,
      roll: attempt.roll,
      lead: `${escapeHtml(shortName(stripCardYear(attempt.runner ?? "")))} IS SENT TO ${escapeHtml(String(attempt.to ?? "").toUpperCase())}&hellip; ${needsLine(attempt)}`,
      // Late, and for the same reason: THROW TO HOME on the screen is a hit,
      // announced before the bat has even been swung.
      late: true,
      caption: `${escapeHtml(shortName(stripCardYear(attempt.runner ?? "")))} ${attempt.safe ? "IS SAFE!" : "IS OUT!"}`
    });
  }
  return stages;
}

// The rolls worth staging, from the newest event that has any: a plate
// appearance carries the pitcher's control roll, the batter's chart roll, and
// then whatever the gloves had to do about it; an NPC steal only has the throw;
// a send is nothing BUT the throw. Exported for tests.
export function dramaStages(events) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event) continue;
    const steal = event.playDetails?.stealAttempt;
    if (typeof steal?.roll === "number") {
      return [{
        label: "THE THROW",
        roll: steal.roll,
        caption: `${escapeHtml(shortName(stripCardYear(steal.runner ?? "")))} ${steal.safe ? "IS SAFE!" : "IS GUNNED DOWN!"}`
      }];
    }
    if (typeof event.resultRoll === "number") {
      const stages = [];
      if (typeof event.controlRoll === "number") {
        stages.push({
          label: "PITCH",
          roll: event.controlRoll,
          // The pitch verdict is half the drama: whose chart takes the swing.
          caption: `${event.controlTotal} VS OB ${event.onBase} — ${event.chartOwner === "pitcher" ? "PITCHER'S" : "BATTER'S"} CHART`
        });
      }
      const gloves = fieldingStages(event);
      // The swing says what it DID, but only when a glove is about to answer it:
      // with nothing following, the play is about to read out in the textbox
      // anyway, and calling it twice steps on it.
      stages.push({ label: "SWING", roll: event.resultRoll, caption: gloves.length ? swingCall(event) : null });
      return [...stages, ...gloves];
    }
    // A deferred send throws no pitch and takes no swing — the whole play is the
    // throw, and it is the most suspenseful die in the game.
    const fielding = fieldingStages(event);
    if (fielding.length) return fielding;
  }
  return null;
}

function revealDrama(app) {
  stopDramaTimer();
  const drama = app.screen.drama;
  if (!drama) return;
  app.screen.drama = null;
  afterAction(app, drama.events);
  app.rerender();
}

let dramaTimer = null;
function stopDramaTimer() {
  clearInterval(dramaTimer);
  clearTimeout(dramaTimer);
  dramaTimer = null;
}

function renderDrama(app, trainer) {
  const stages = app.screen.drama?.stages ?? [];
  return `<div class="gq-screen">
    <div class="gq-topbar"><span>VS ${escapeHtml(trainer.name)}</span><span>&#9733; HIGH LEVERAGE &#9733;</span></div>
    <div class="gq-body gq-center gq-drama">
      <p>THE CROWD IS ON ITS FEET...</p>
      <div class="gq-die-row">${stages
        .map((stage, index) => `<div class="gq-die-stage${stage.late ? " gq-die-unthrown" : ""}" data-die-stage="${index}">
          <div class="gq-die">${d20FaceHtml()}<span class="gq-die-roll" data-die="${index}">&nbsp;</span></div>
          <p class="gq-dim">${escapeHtml(stage.label)}</p>
        </div>`)
        .join("")}</div>
      <p class="gq-dim" data-die-caption>&nbsp;</p>
      <p class="gq-dim gq-blink">THE D20 TUMBLES</p>
    </div>
    <div class="gq-textbox"><p class="gq-dim">Z to skip the suspense.</p></div>
  </div>`;
}

// The die is a D20, so it is drawn as one: an icosahedron seen head-on reads as a
// hexagon, and the outline alone is enough to say so. A square with a number in
// it is not a die, it is a tile — and this game is a tabletop game, so the thing
// you are made to stare at while the game hangs in the balance should be the
// thing you would actually be staring at.
//
// The shape and nothing else. The faceting lines that make a d20 icon a d20 icon
// are drawn for people looking at an icon; here the die is a foot tall and the
// number thrown on it is the point, and a triangle ruled through the middle of
// it is just something else for the number to collide with.
//
// The face is drawn once and the ROLL is a separate element on top of it: the
// tumble rewrites the number many times a second, and it must not be rewriting
// the die.
function d20FaceHtml() {
  return `<svg class="gq-die-face" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    <polygon class="gq-die-body" points="50,3 93,27 93,73 50,97 7,73 7,27" />
  </svg>`;
}

// The browser-side animation, one die at a time: cycle faces, land on the real
// roll (posting the verdict under the dice), move to the next, hold a beat, then
// reveal. Tests drive reveal through the key handler.
//
// Two dice thrown at the same moment are one roll with two numbers on it. These
// are a SEQUENCE — the ball is put in play, and THEN a glove has to do something
// about it — so the screen is made to say the first thing before it throws the
// second. The swing lands and calls what it was (GB — GROUND BALL); the game
// waits long enough to be read; the pivot is announced (THEY GO FOR TWO...); and
// only then does that die start to tumble. Watching a die decide a double play
// before anybody has told you there is a ground ball is watching a die for no
// reason.
const DIE_HOLD_MS = 350;      // between two dice of the same roll: pitch, swing
const READ_THE_PLAY_MS = 1250; // between the bat's answer and the glove's question

function mountDrama(app) {
  stopDramaTimer();
  const stages = app.screen.drama?.stages ?? [];
  const say = (text) => {
    const caption = document.querySelector("[data-die-caption]");
    if (caption && text) caption.innerHTML = text;
  };
  const spin = (index) => {
    const die = document.querySelector(`[data-die="${index}"]`);
    if (!die || !app.screen.drama) return stopDramaTimer();
    // A die that has not been thrown is not on the table. The gloves' dice appear
    // at the moment they are thrown, and not one beat sooner — and they announce
    // themselves as they arrive, so the roll has a reason before it has a number.
    document.querySelector(`[data-die-stage="${index}"]`)?.classList.remove("gq-die-unthrown");
    say(stages[index].lead);
    let ticks = 0;
    dramaTimer = setInterval(() => {
      if (!die.isConnected || !app.screen.drama) return stopDramaTimer();
      ticks += 1;
      if (ticks < 8) {
        die.textContent = String(((ticks * 7 + index * 5) % 20) + 1);
        return;
      }
      stopDramaTimer();
      die.textContent = String(stages[index].roll);
      die.closest(".gq-die")?.classList.add("gq-die-landed");
      say(stages[index].caption);
      const next = stages[index + 1];
      if (!next) {
        dramaTimer = setTimeout(() => revealDrama(app), 700);
        return;
      }
      // A glove answering the bat gets a beat to be read into; a second die of
      // the same roll does not need one.
      dramaTimer = setTimeout(() => spin(index + 1), next.late ? READ_THE_PLAY_MS : DIE_HOLD_MS);
    }, 85);
  };
  spin(0);
}

// ---- A tiring arm --------------------------------------------------------------
//
// The BF line has always said this and nobody reads it — a number under a name
// changing from 23/24 to 25/24 is not an event, it is a footnote. It IS an event:
// the man on the mound just got worse, and every pitch from here is thrown by a
// lesser pitcher than the one you scouted.
//
// So it makes a noise. The first step down is the arm starting to labour; every
// step after that is the same, deeper sound — the difference that matters to a
// manager is FRESH, TIRING, GONE, not the exact number of the penalty. Both
// mounds ring: his arm going is as much your business as yours going, and you
// are the one who has to decide what to do about either.
// The decision, kept apart from the noise so it can be tested without a speaker:
// what has changed on the two mounds since the last play, and what that is worth
// hearing about. Exported for tests.
export function fatigueAlarm(battle, heard = {}) {
  const now = {};
  let tiring = false;
  let spent = false;
  for (const side of ["away", "home"]) {
    const mound = pitcherStatus(battle.state, side);
    const penalty = mound?.fatiguePenalty ?? 0;
    // Keyed on the MAN, not the side: a fresh arm out of the pen starts at zero,
    // and his zero must not read as the last man's penalty coming down — nor may
    // the new man inherit the tiredness the old man was making noises about.
    const key = `${side}:${mound?.pitcher?.id ?? ""}`;
    now[key] = penalty;
    const before = heard[key] ?? 0;
    if (penalty > before) {
      if (before === 0) tiring = true;
      else spent = true;
    }
  }
  // One sound a play, and the worse news is the news.
  return { now, sound: spent ? "spent" : tiring ? "tiring" : null };
}

function callTheBullpenPhone(app) {
  const { now, sound } = fatigueAlarm(app.screen.battle, app.screen.fatigueHeard ?? {});
  app.screen.fatigueHeard = now;
  if (sound === "spent") playArmSpent();
  else if (sound === "tiring") playArmTiring();
}

// The book, drawn: every play in order, with a rule ACROSS THE BOX wherever the
// sides changed and the half-inning that just closed named on it, with the score
// as it stood. A wall of plays with nothing between them makes you count the
// outs to find where an inning went.
function playLogHtml(app, battle) {
  const entries = app.screen.playLog ?? [];
  if (!entries.length) return (app.screen.lines ?? []).map((line) => `<p>${line}</p>`).join("");
  const state = battle.state;
  const you = battle.playerSide;
  const them = battle.npcSide;
  const half = (entry) => `${entry.half === "top" ? "TOP" : "BOT"} ${entry.inning}`;
  let html = "";
  let previous = null;
  for (const entry of entries) {
    if (previous && (previous.half !== entry.half || previous.inning !== entry.inning)) {
      // The score reads from your dugout, the way every other score in this game
      // does.
      html += `<div class="gq-play-break"><span>END ${half(previous)} &middot; ${
        previous.score[you]
      }-${previous.score[them]}</span></div>`;
    }
    html += entry.lines.map((line) => `<p>${line}</p>`).join("");
    previous = entry;
  }
  void state;
  return html;
}

// ---- The book of the game ------------------------------------------------------
//
// The textbox used to hold the last play and nothing else: whatever had just
// happened wiped whatever happened before it, and a game you looked away from for
// ten seconds was a game you could not catch up on. It is a LOG now — every play
// of the game, oldest at the top, scrolled to the bottom where the newest one is —
// and it looks exactly as it did, because the newest play is still the thing you
// are looking at. The rest is simply still there, above it.
//
// Each entry knows the half-inning it belongs to and what the score was when it
// ended, which is what lets the log rule a line between innings and say where the
// game stood as each one closed.
function logPlay(app, lines, events) {
  if (!lines.length) return;
  const state = app.screen.battle.state;
  // The half-inning the play HAPPENED in, not the one the game has since rolled
  // over into: the third out belongs to the inning it ended, not the next one.
  const last = [...events].filter(Boolean).pop();
  const half = last?.half ?? state.half;
  const inning = last?.inning ?? state.inning;
  const score = last?.scoreAfter ?? state.score;
  app.screen.playLog = [
    ...(app.screen.playLog ?? []),
    { half, inning, lines, score: { away: score.away, home: score.home } }
  ];
}

// A resumed game rebuilds its book from the plays themselves — the same events
// the engine replayed — so coming back to a game mid-inning comes back to the
// whole of it, not to a blank box.
export function rebuildPlayLog(battle) {
  return battle.events.filter(Boolean).map((event) => ({
    half: event.half,
    inning: event.inning,
    score: { away: event.scoreAfter?.away ?? 0, home: event.scoreAfter?.home ?? 0 },
    lines: describeEvent(event, battle.playerSide)
  })).filter((entry) => entry.lines.length);
}

function afterAction(app, events, presetLines = null) {
  const playerSide = app.screen.battle.playerSide;
  const lines = presetLines ?? events.filter(Boolean).flatMap((event) => describeEvent(event, playerSide));
  // The NPC's between-batters mound visit is its own beat: it announces
  // itself here, before the player picks an action against the new arm.
  const visit = npcMoundVisit(app.screen.battle);
  if (visit) lines.push(...describeEvent(visit, playerSide));
  // Every play comes through here, so this is where the diamond learns what to
  // act out. The id is what stops a cursor keypress from replaying it.
  app.screen.motion = { id: (app.screen.motion?.id ?? 0) + 1, ...playMotion(events) };
  callTheBullpenPhone(app);
  logPlay(app, lines, [...events, visit]);
  app.screen.lines = lines.length ? lines : app.screen.lines;
  app.screen.mode = "menu";
  app.screen.menuIndex = 0;
  // The book is written after every decision, so a closed tab costs the manager
  // nothing: the game he comes back to is the one he left, mid-inning.
  stashBattle(app.save, app.screen.trainerId, app.screen.battle, app.screen.lines);
  persistSave(app.save);
  const phase = battlePhase(app.screen.battle);
  if (phase.type === "over") {
    // Land on the FINAL screen first: the last play and the outcome, stated
    // plainly, before the box score.
    app.go("gameOver", {
      trainerId: app.screen.trainerId,
      battle: app.screen.battle,
      lines: app.screen.lines,
      phase
    });
  }
}

// ---- Game over ---------------------------------------------------------------

export const gameOverScreen = {
  render(app) {
    const trainer = trainerById(app.screen.trainerId);
    const battle = app.screen.battle;
    const phase = app.screen.phase;
    const you = phase.score[battle.playerSide];
    const them = phase.score[battle.npcSide];
    const innings = inningsPlayed(battle.state);
    const lines = (app.screen.lines ?? []).filter(Boolean);
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>FINAL</span><span>VS ${escapeHtml(trainer.name)}</span></div>
      <div class="gq-body gq-center">
        <div class="gq-frame gq-title-frame">
          <b style="font-size:7cqw">${phase.playerWon ? "&#9733; YOU WIN! &#9733;" : "YOU LOSE..."}</b>
          <p class="gq-mt" style="font-size:4.6cqw"><b>YOU ${you} &middot; THEM ${them}</b></p>
          <p class="gq-dim">${battle.state.walkoff ? "WALK-OFF! " : ""}${innings !== 9 ? `${innings} INNINGS` : "9 INNINGS"} &middot; ${battle.playerSide === "home" ? "YOUR PARK" : "ON THE ROAD"}</p>
        </div>
        <div class="gq-frame" style="text-align:left">
          <p class="gq-dim">THE FINAL PLAY:</p>
          ${lines.length ? lines.map((line) => `<p>${line}</p>`).join("") : "<p>The last out is in the book.</p>"}
        </div>
      </div>
      <div class="gq-textbox"><p class="gq-blink">Z — BOX SCORE</p></div>
    </div>`;
  },
  // The last out is in the book, and the room finds out how it feels about it.
  // Once: this screen rerenders, and a fanfare that fired on every one of them
  // would turn the best moment in the game into a stuck record.
  mounted(app) {
    if (app.screen.calledIt) return;
    app.screen.calledIt = true;
    if (app.screen.phase?.playerWon) playVictory();
    else playDefeat();
  },
  key(app, key) {
    if (key !== "a" && key !== "b") return;
    resolveGameEnd(app, app.screen.phase);
    app.rerender();
  }
};

// Every finished game routes through the box-score screen first, then on to
// the series break or the final result.
function resolveGameEnd(app, phase) {
  const save = app.save;
  const trainer = trainerById(app.screen.trainerId);
  const battle = app.screen.battle;
  const boxScore = buildBoxScore(battle.state);
  recordGameStats(save, boxScore[battle.playerSide]);
  const feats = recordFinishedGame(save, {
    trainer,
    boxScore,
    playerSide: battle.playerSide,
    events: battle.events,
    score: phase.score,
    innings: inningsPlayed(battle.state),
    won: phase.playerWon,
    // So the almanac can hang the board back up when the game is reopened.
    lineScore: battle.state.lineScore
  });
  const status = recordSeriesGame(save, phase.playerWon);
  // The game is in the books now — coins paid, stats recorded. Nothing left to
  // come back to, so the recording comes off the save.
  clearBattle(save);
  persistSave(save);

  let next;
  if (status === "live") {
    next = { name: "seriesBreak", data: { trainerId: trainer.id, lastWon: phase.playerWon, score: phase.score, playerSide: battle.playerSide, menuIndex: 0 } };
  } else {
    const outcome = applyOutcome(app, trainer, status === "won");
    clearSeries(save);
    persistSave(save);
    next = { name: "battleResult", data: { trainerId: trainer.id, outcome, score: phase.score, playerSide: battle.playerSide, page: 0 } };
  }
  app.go("gameStats", {
    trainerId: trainer.id,
    boxScore,
    stars: gameStars(boxScore, battle.playerSide),
    feats,
    events: battle.events,
    score: phase.score,
    // The board the game was played on, so the box score can hang it back up —
    // both clubs by name, the way it stood at the last out.
    lineScore: battle.state.lineScore,
    you: battle.state[battle.playerSide].name,
    playerSide: battle.playerSide,
    index: 0,
    next
  });
}

// Every card in the game, sectioned: your lineup in batting order, your
// staff, then theirs. The &#9679; marks the arm currently on the mound.
function rosterRows(battle) {
  const rows = [];
  const sides = [
    { key: battle.playerSide, tag: "YOU" },
    { key: battle.npcSide, tag: "THEM" }
  ];
  for (const side of sides) {
    const team = battle.state[side.key];
    const onMound = battle.state.pitching[side.key].pitcherIndex;
    team.lineup.forEach((player, index) => rows.push({
      section: `${side.tag} — LINEUP`,
      html: `${index + 1}. ${escapeHtml(player.assignedPosition ?? player.position)} ${escapeHtml(shortName(player.name))} <span class="gq-dim">OB${player.onBase} SPD${player.speed}</span>`,
      card: player
    }));
    team.pitchers.forEach((pitcher, index) => rows.push({
      section: `${side.tag} — ARMS`,
      html: `${index === onMound ? "&#9679; " : ""}${escapeHtml(pitcher.role)} ${escapeHtml(shortName(pitcher.name))} <span class="gq-dim">CTRL${pitcher.control} IP${pitcher.ip}</span>`,
      card: pitcher
    }));
  }
  return rows;
}

function renderRosters(app, battle, trainer) {
  const rows = rosterRows(battle);
  const index = clampIndex(app.screen.rosterIndex ?? 0, rows.length);
  const selected = rows[index];
  const sections = [];
  rows.forEach((row, rowIndex) => {
    if (row.section !== rows[rowIndex - 1]?.section) sections.push({ header: row.section, start: rowIndex });
  });
  let listHtml = "";
  for (const [sectionIndex, section] of sections.entries()) {
    const end = sections[sectionIndex + 1]?.start ?? rows.length;
    listHtml += `<h3>${section.header}</h3>${menuHtml(
      rows.slice(section.start, end).map((row) => ({ html: row.html })),
      index - section.start,
      { offset: section.start }
    )}`;
  }
  return `<div class="gq-screen">
    <div class="gq-topbar"><span>ROSTERS &middot; VS ${escapeHtml(trainer.name)}</span><span>${halfLabel(battle.state)}</span></div>
    <div class="gq-body"><div class="gq-columns">
      <div class="gq-frame gq-scroll">${listHtml}</div>
      <div class="gq-card-side">${selected ? cardPanelHtml(selected.card) : ""}</div>
    </div></div>
    <div class="gq-textbox"><p class="gq-dim">Hover or move the cursor to read a card. X to go back.</p></div>
  </div>`;
}

// Going to the pen is a comparison, not a menu pick: you are weighing a fresh
// arm against the one that is tiring in front of you. So it opens like the
// roster book — the pen down the left, and both cards up where you can read
// their charts against each other.
function renderPen(app, battle, trainer, phase) {
  const options = phase.bullpen ?? [];
  const index = clampIndex(app.screen.penIndex ?? 0, options.length + 1);
  const selected = options[index]?.pitcher ?? null;
  const mound = pitcherStatus(battle.state, battle.playerSide);
  const rows = options.map(({ pitcher }) => ({
    html: `${escapeHtml(pitcher.role)} ${escapeHtml(shortName(pitcher.name))} <span class="gq-dim">CTRL${pitcher.control} IP${pitcher.ip}</span>`
  }));
  return `<div class="gq-screen">
    <div class="gq-topbar"><span>BULLPEN &middot; VS ${escapeHtml(trainer.name)}</span><span>${halfLabel(battle.state)}</span></div>
    <div class="gq-body"><div class="gq-columns gq-columns-pen">
      <div class="gq-frame gq-scroll"><h3>YOUR PEN</h3>${menuHtml([...rows, { label: "NEVER MIND" }], index)}</div>
      <div class="gq-card-side">
        <p class="gq-dim">${selected ? "WARMING UP" : "&nbsp;"}</p>
        ${selected ? cardPanelHtml(selected) : ""}
        <p class="gq-dim">${selected ? "FRESH" : "&nbsp;"}</p>
      </div>
      <div class="gq-card-side">
        <p class="gq-dim">ON THE MOUND</p>
        ${cardPanelHtml(mound.pitcher)}
        <p class="gq-dim">${moundLine(mound)}</p>
      </div>
    </div></div>
    <div class="gq-textbox"><p class="gq-dim">A brings him in. X leaves your arm in the game.</p></div>
  </div>`;
}

export const battleScreen = {
  render(app) {
    const battle = app.screen.battle;
    const state = battle.state;
    const trainer = trainerById(app.screen.trainerId);
    if (app.screen.mode === "rosters") return renderRosters(app, battle, trainer);
    if (app.screen.mode === "log") return renderGameLog(app, battle, trainer);
    if (app.screen.mode === "drama") return renderDrama(app, trainer);
    const phase = battlePhase(battle);
    if (app.screen.mode === "pen" && phase.type !== "over") return renderPen(app, battle, trainer, phase);
    const series = app.save.activeSeries;
    // The board, then the game, then the clubs. What you are DOING — the menu you
    // are choosing from and the call of the play you just made — sits in the
    // middle of the screen where your eyes already are, and the two lineups hold
    // the floor underneath it. The order used to put the men above the menu,
    // which meant the one thing you actually touch was the thing furthest from
    // everything else on the screen.
    return `<div class="gq-screen gq-battle-screen">
      ${renderScoreboard(battle, trainer, series)}
      <div class="gq-textbox${phase.type === "player-pitching" ? " gq-textbox-fielding" : ""}">
        <div class="gq-battle-menu">${renderBattleMenu(app, phase)}</div>
        <div class="gq-battle-lines">${playLogHtml(app, battle)}</div>
      </div>
      ${renderHud(battle, phase)}
    </div>`;
  },
  hoverCard(app, index) {
    if (app.screen.mode === "pen") {
      return battlePhase(app.screen.battle).bullpen?.[index]?.pitcher ?? null;
    }
    if (app.screen.mode !== "rosters") return null;
    return rosterRows(app.screen.battle)[index]?.card ?? null;
  },
  mounted(app) {
    if (app.screen.mode === "drama" && app.screen.drama) mountDrama(app);
    // The call of the play is the newest line, and it's the one worth reading.
    const lines = document.querySelector(".gq-battle-lines");
    if (lines) lines.scrollTop = lines.scrollHeight;
    playMotionOnce(app);
  },
  key(app, key) {
    if (app.screen.mode === "drama") {
      if (key === "a" || key === "b") revealDrama(app);
      return;
    }
    const phase = battlePhase(app.screen.battle);
    if (app.screen.mode === "rosters") {
      const rows = rosterRows(app.screen.battle);
      if (key === "up" || key === "down") {
        app.screen.rosterIndex = clampIndex((app.screen.rosterIndex ?? 0) + (key === "down" ? 1 : -1), rows.length);
      } else if (key === "b" || key === "a") {
        app.screen.mode = "menu";
        app.screen.menuIndex = 0;
      }
      app.rerender();
      return;
    }
    if (app.screen.mode === "log") {
      const total = app.screen.battle.events.length;
      if (key === "up" || key === "down") {
        app.screen.logIndex = clampIndex((app.screen.logIndex ?? total - 1) + (key === "down" ? 1 : -1), total);
      } else if (key === "b" || key === "a") {
        app.screen.mode = "menu";
        app.screen.menuIndex = 0;
      }
      app.rerender();
      return;
    }
    if (phase.type === "over") return;
    if (app.screen.mode === "pen") {
      const options = phase.bullpen ?? [];
      const items = options.length + 1;
      if (key === "up" || key === "down") {
        app.screen.penIndex = clampIndex((app.screen.penIndex ?? 0) + (key === "down" ? 1 : -1), items);
      } else if (key === "a") {
        const index = app.screen.penIndex ?? 0;
        if (index < options.length) afterAction(app, actChangePitcher(app.screen.battle, options[index].index));
        else app.screen.mode = "menu";
      } else if (key === "b") {
        app.screen.mode = "menu";
      }
    } else {
      const items = battleMenuItems(app, phase);
      if (key === "up" || key === "down") {
        app.screen.menuIndex = clampIndex((app.screen.menuIndex ?? 0) + (key === "down" ? 1 : -1), items.length);
      } else if (key === "a") {
        const item = items[app.screen.menuIndex ?? 0];
        if (item && !item.disabled) item.run(app);
      }
    }
    app.rerender();
  }
};

// Team defense at a glance, mirroring the engine's steal/bunt/tag-up math:
// the catcher's arm, the four infielders, the three outfielders.
// The gloves standing behind a pitcher, added up the way the engine adds them:
// the catcher's arm, the four infielders, the three outfielders. One definition,
// because the hover note and the club's strip must never disagree about what the
// defense is.
function fieldingSums(team) {
  const total = (positions) => team.lineup
    .filter((player) => positions.includes(player.assignedPosition ?? player.position))
    .reduce((sum, player) => sum + (Number(player.fielding) || 0), 0);
  return {
    catcher: total(["C", "CA"]),
    infield: total(["1B", "2B", "3B", "SS"]),
    outfield: total(["LF", "CF", "RF"])
  };
}

function signedFielding(value) {
  return `${value >= 0 ? "+" : ""}${value}`;
}

function fieldingNote(title, team) {
  const sums = fieldingSums(team);
  return `${title}\nCATCHER ${signedFielding(sums.catcher)}\nINFIELD ${signedFielding(sums.infield)}\nOUTFIELD ${signedFielding(sums.outfield)}`;
}

// What the arm has behind him. His control and his workload say what HE can do;
// this says what happens when the ball is put in play, which is most of the time
// — and it belongs under him, because it is the rest of the sentence.
function defenseLine(team) {
  const sums = fieldingSums(team);
  return `C ${signedFielding(sums.catcher)} &middot; IF ${signedFielding(sums.infield)} &middot; OF ${signedFielding(sums.outfield)}`;
}

// Who is actually facing whom right now, whatever the player is being asked.
// The plate appearance bumps the lineup index before the runners are polled,
// so on the advance-decision beat the man to show is the one the pending
// decision names — the fellow who just put the ball in play — not the next
// hitter up.
function currentMatchup(battle) {
  const state = battle.state;
  const battingSide = state.half === "top" ? "away" : "home";
  const fieldingSide = battingSide === "away" ? "home" : "away";
  const lineup = state[battingSide].lineup;
  const pending = state.pendingAdvance;
  const spot = state.lineupIndex[battingSide] % lineup.length;
  const batter = pending
    ? lineup.find((player) => player.id === pending.batter?.id) ?? lineup[spot]
    : lineup[spot];
  const mound = pitcherStatus(state, fieldingSide);
  return {
    batter,
    mound,
    deciding: Boolean(pending),
    battingSide,
    playerIsBatting: battingSide === battle.playerSide
  };
}

// The board IS the banner: the two clubs by name, the runs hung frame by frame,
// the bases and the outs beside them. No caption saying who you are playing —
// the board has both clubs on it, which is what a board is for.
function renderScoreboard(battle, trainer, series) {
  const state = battle.state;
  return `<div class="gq-topbar gq-battle-topbar">
    ${lineScoreHtml(battle, series)}
    <span class="gq-board-bases">
      ${diamondHtml(state)}${outsHtml(state.outs)}
    </span>
  </div>`;
}

// The hand-operated board: a slot per inning, hung as the runs come in, with
// the frame in progress marked. A club that has batted in an inning and not
// scored gets its nought; one that hasn't come up yet gets an empty slot —
// which is the whole point of a board like this, and why blank and 0 differ.
//
// How many frames the wall holds. The board and the bases share the banner and
// the bases are not moving, so this is the count that fits beside them with a
// gap still showing — measured against the rendered board at its widest (a
// two-digit frame is wider than a one-digit one, and the longest club name
// takes the name column to its cap), not guessed.
const MAX_FRAMES = 10;

function lineScoreHtml(battle, series = null) {
  const state = battle.state;
  const played = Math.max(9, state.lineScore.away.length, state.lineScore.home.length, state.inning);
  // Extras hang new frames off the end until the board runs out of wall — which
  // is where the bases are standing. Past that it slides: the oldest frames come
  // down, the newest stay up, and the run total on the end still counts them all.
  const last = played;
  const first = Math.max(1, last - MAX_FRAMES + 1);
  const innings = Array.from({ length: last - first + 1 }, (unused, index) => first + index);
  // A half is on the board once it has started: the top of the current inning
  // always has, the bottom only once we are in it.
  const batted = (side, inning) =>
    inning < state.inning || (inning === state.inning && (side === "away" || state.half === "bottom"));
  const atBat = battingSide(state);
  // The clubs stand by name, the way they would on a real board. The defense
  // summaries the old YOU/THEM chips carried come with them: each club's row
  // still tells you what its glove adds up to.
  const row = (side) => `
    <tr data-hover-note="${escapeHtml(
      fieldingNote(side === battle.playerSide ? "YOUR DEFENSE" : "THEIR DEFENSE", state[side])
    )}">
      <th>${escapeHtml(state[side].name)}</th>
      ${innings.map((inning) => {
        const live = inning === state.inning && side === atBat;
        const runs = state.lineScore[side][inning - 1] ?? 0;
        // A frame still being played has nothing hung in it until a run comes
        // in: the slot is lit, but empty. A nought is a finished frame's
        // verdict, and this frame has not finished.
        const hung = !batted(side, inning) || (live && runs === 0) ? "" : runs;
        return `<td class="${live ? "gq-line-live" : ""}">${hung}</td>`;
      }).join("")}
      <td class="gq-line-total">${state.score[side]}</td>
    </tr>`;
  // The corner cell — above the clubs, beside the frame numbers — was empty, and
  // a board with a hole in the corner of it is where the game number goes. It is
  // a fact ABOUT this board (which game of the series it is, and where the series
  // stands), so it belongs on the board and not floating beside the bases.
  const corner = series && series.bestOf > 1
    ? `GAME ${series.nextGame} (${series.wins}-${series.losses})`
    : "";
  return `<table class="gq-linescore" aria-label="line score">
    <tr class="gq-line-head">
      <th class="gq-line-series">${corner}</th>${innings.map((inning) => `<th>${inning}</th>`).join("")}<th class="gq-line-total">R</th>
    </tr>
    ${row("away")}
    ${row("home")}
  </table>`;
}

function battingSide(state) {
  return state.half === "top" ? "away" : "home";
}

// ---- Motion on the diamond -------------------------------------------------

const HOME = 4;
const BASE_SELECTOR = { 1: ".gq-base-1", 2: ".gq-base-2", 3: ".gq-base-3", [HOME]: ".gq-base-h" };
const BASE_NUMBER = { "1B": 1, "2B": 2, "3B": 3, home: HOME };
// What the batter himself touches on his way. A walk is a trot to first; a
// homer is the whole lap, which is the reason to trace a path at all rather
// than just light up where everyone ended.
const BATTER_PATH = {
  HR: [1, 2, 3, 4],
  "3B": [1, 2, 3],
  "2B": [1, 2],
  "1B": [1],
  "1B+": [1],
  BB: [1],
  IBB: [1],
  HBP: [1]
};

// The play as the diamond sees it: bases touched, in the order they were
// touched, and the bases a man was cut down on. Runners other than the batter
// come through the attempt records — a steal carries one, a hit or a fly ball
// can carry several. Exported for tests.
export function playMotion(events) {
  const path = [];
  const outs = [];
  const touch = (base) => {
    if (base && !path.includes(base)) path.push(base);
  };
  for (const event of (events ?? []).filter(Boolean)) {
    for (const base of BATTER_PATH[event.result] ?? []) touch(base);
    const details = event.playDetails ?? {};
    for (const attempt of [details.stealAttempt, ...(details.attempts ?? [])].filter(Boolean)) {
      const base = BASE_NUMBER[attempt.to];
      if (!base) continue;
      if (attempt.safe) touch(base);
      else outs.push(base);
    }
    // However he got there, a run is a man touching the plate — which is why
    // the plate appearing in the path always means a run, and can always be
    // lit as one.
    if (event.runs > 0) touch(HOME);
  }
  return { path, outs };
}

// The diamond only moves when something happened: a rerender for a cursor
// keypress must not replay the last hit, so each play's motion carries an id
// and is acted out exactly once.
function playMotionOnce(app) {
  const motion = app.screen.motion;
  if (!motion || app.screen.motionPlayed === motion.id) return;
  app.screen.motionPlayed = motion.id;
  const diamond = document.querySelector(".gq-battle-topbar .gq-diamond");
  if (!diamond) return;
  const baseAt = (base) => diamond.querySelector(BASE_SELECTOR[base]);
  // The lap is staggered, so a home run reads as a man rounding the bases
  // rather than four bases lighting up at once. Touching the plate is the one
  // that means a run, so the plate says so in the sign's red rather than just
  // swelling like any other bag.
  motion.path.forEach((base, index) => {
    const el = baseAt(base);
    if (!el) return;
    el.style.animationDelay = `${index * 130}ms`;
    el.classList.add(base === HOME ? "gq-base-score" : "gq-base-pulse");
  });
  for (const base of motion.outs ?? []) {
    baseAt(base)?.classList.add("gq-base-out");
  }
}

// The at-bat band, outside in: each club's order down its own edge, and the two
// men in the duel as cards in the middle. The OB and CTRL lines this panel used
// to spell out are printed on the card faces; the whole order stands where ON
// DECK used to name one man; and the scoreboard has gone up into the banner.
function renderHud(battle, phase) {
  const state = battle.state;
  const matchup = phase.type === "over" ? null : currentMatchup(battle);
  // The club at bat lights up the man in the box. The club in the field lights
  // up, more quietly, whoever leads off when they get their turn — that's who
  // the lineup index is already pointing at over there.
  const strip = (side) => {
    const batting = matchup && matchup.battingSide === side;
    const lineup = state[side].lineup;
    return lineupStripHtml(state[side], {
      litId: batting ? matchup.batter.id : null,
      nextId: batting || !matchup ? null : lineup[state.lineupIndex[side] % lineup.length].id,
      mound: pitcherStatus(state, side),
      mine: side === battle.playerSide
    });
  };
  // Your men stand on your side of the screen and theirs on theirs, whichever
  // half it is — the cards swap roles, not places. What each man is doing is
  // written above him, so the side never has to move to say it.
  const batting = matchup?.deciding ? "BALL IN PLAY" : "NOW BATTING";
  const card = (mine) => {
    if (!matchup) return `<div></div>`;
    const isBatter = matchup.playerIsBatting === mine;
    return isBatter
      ? hudCardHtml(matchup.batter, batting, "")
      : hudCardHtml(matchup.mound.pitcher, "NOW PITCHING", "");
  };
  return `<div class="gq-battle-hud">
    ${strip(battle.playerSide)}
    ${card(true)}
    ${card(false)}
    ${strip(battle.npcSide)}
  </div>`;
}

// One club's card, top to bottom: the order nine deep — spot, surname, on-base
// — then the arm behind them, set off by a gap and marked P, reading his
// control where the hitters read their on-base, with his workload under his
// name. Every row carries its card id, so the whole club is hoverable.
function lineupStripHtml(team, { litId, nextId, mound, mine = true }) {
  const line = (spot, player, value) => `
      <span class="gq-strip-spot">${spot}</span>
      <span class="gq-strip-name">${escapeHtml(surname(player.name))}</span>
      <span class="gq-strip-ob">${value}</span>`;
  const mark = (player) =>
    player.id === litId ? " gq-strip-now" : player.id === nextId ? " gq-strip-next" : "";
  const bats = team.lineup.map((player, index) =>
    `<li class="gq-strip-bat${mark(player)}" data-card-id="${escapeHtml(player.id)}">${
      line(index + 1, player, player.onBase)
    }</li>`).join("");
  const pitcher = mound?.pitcher;
  const arm = pitcher
    ? `<li class="gq-strip-arm" data-card-id="${escapeHtml(pitcher.id)}">
        <span class="gq-strip-line">${line("P", pitcher, pitcher.control)}</span>
        <span class="gq-strip-bf${(mound.fatiguePenalty ?? 0) > 0 ? " gq-fatigued" : ""}">${moundLine(mound)}</span>
        <span class="gq-strip-def">${defenseLine(team)}</span>
      </li>`
    : "";
  // Each club's summary line runs to ITS OWN outside edge — yours left, theirs
  // right — so the two strips read outward from the field between them instead
  // of both pointing the same way.
  return `<ul class="gq-hud-strip${mine ? "" : " gq-hud-strip-away"}">${bats}${arm}</ul>`;
}

// A card small enough to flank the diamond, with the state its face can't
// carry underneath it. Hoverable, so it still floats full size.
function hudCardHtml(card, label, note) {
  return `<div class="gq-hud-card">
    <span class="gq-hud-card-label">${label}</span>
    <div class="gq-hud-card-face" data-card-id="${escapeHtml(card.id)}">${cardPanelHtml(card)}</div>
    ${note ? `<span class="gq-hud-card-note gq-dim">${note}</span>` : ""}
  </div>`;
}

// CTRL and the chart are printed on the card. What it cannot show is the
// workload: how deep this arm is, and whether he has started to tire. It rides
// under his name in the club's strip, where both arms can be read at once.
function moundLine(mound) {
  if (!mound) return "";
  const fatigue = mound.fatiguePenalty ?? 0;
  return `${mound.battersFaced}/${mound.tiredAt} BF${fatigue > 0 ? ` &middot; &minus;${fatigue} TIRED` : ""}`;
}

// Defense menus (the NPC is hitting) read from the other dugout: right-
// aligned, mirroring the matchup panel's YOUR ARM side.
function renderBattleMenu(app, phase) {
  if (phase.type === "over") return "";
  return menuHtml(
    battleMenuItems(app, phase).map((item) => ({ label: item.label, html: item.html, disabled: item.disabled })),
    app.screen.menuIndex ?? 0,
    { className: phase.type === "player-pitching" ? "gq-menu-right" : "" }
  );
}

// Scores always read from the player's side, whichever dugout that was.
function yourScore(screen) {
  const side = screen.playerSide ?? "away";
  return `${screen.score[side]}-${screen.score[side === "home" ? "away" : "home"]}`;
}

// ---- Between series games --------------------------------------------------

// Everyone who has played in THIS series, bats then arms, for the stats view.
function seriesStatRows(save) {
  const { hitters, pitchers } = seriesStatLines(save);
  return [
    ...hitters.map((line) => ({ section: "YOUR BATS", id: line.id, html: statLineHtml(line, "hitters") })),
    ...pitchers.map((line) => ({ section: "YOUR ARMS", id: line.id, html: statLineHtml(line, "pitchers") }))
  ];
}

export const seriesBreakScreen = {
  render(app) {
    const trainer = trainerById(app.screen.trainerId);
    const series = app.save.activeSeries;
    if (app.screen.mode === "stats") {
      const rows = seriesStatRows(app.save);
      const index = clampIndex(app.screen.statIndex ?? 0, rows.length);
      const sections = [];
      rows.forEach((row, rowIndex) => {
        if (row.section !== rows[rowIndex - 1]?.section) sections.push({ header: row.section, start: rowIndex });
      });
      let listHtml = "";
      for (const [sectionIndex, section] of sections.entries()) {
        const end = sections[sectionIndex + 1]?.start ?? rows.length;
        listHtml += `<h3>${section.header}</h3>${menuHtml(
          rows.slice(section.start, end).map((row) => ({ html: row.html })),
          index - section.start,
          { offset: section.start }
        )}`;
      }
      return `<div class="gq-screen">
        <div class="gq-topbar"><span>SERIES STATS &middot; VS ${escapeHtml(trainer.name)}</span><span>${series.wins}-${series.losses} (BO${series.bestOf})</span></div>
        <div class="gq-body"><div class="gq-frame gq-scroll gq-map-node">${
          rows.length ? listHtml : `<p class="gq-dim">NO GAMES IN THE BOOK YET.</p>`
        }</div></div>
        <div class="gq-textbox"><p class="gq-dim">This series only. % IS SERIES WPA. Hover a row to read the card. X to go back.</p></div>
      </div>`;
    }
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>SERIES VS ${escapeHtml(trainer.name)}</span><span>BO${series.bestOf}</span></div>
      <div class="gq-body gq-center">
        <div class="gq-frame gq-title-frame">
          <p>${app.screen.lastWon ? "YOU TAKE GAME " : "THEY TAKE GAME "}${series.nextGame - 1}</p>
          <p class="gq-dim">FINAL ${yourScore(app.screen)}</p>
          <p class="gq-mt" style="font-size:5cqw"><b>${series.wins} - ${series.losses}</b></p>
          <p class="gq-dim">SERIES STANDING (SAVED)</p>
        </div>
      </div>
      <div class="gq-textbox">
        ${menuHtml(
          [{ label: `PLAY GAME ${series.nextGame}` }, { label: "SET LINEUP" }, { label: "SERIES STATS" }, { label: "BACK TO MAP (RESUME LATER)" }],
          app.screen.menuIndex ?? 0
        )}
      </div>
    </div>`;
  },
  hoverCard(app, index) {
    if (app.screen.mode !== "stats") return null;
    return cardById(seriesStatRows(app.save)[index]?.id) ?? null;
  },
  key(app, key) {
    if (app.screen.mode === "stats") {
      const rows = seriesStatRows(app.save);
      if (key === "up" || key === "down") {
        app.screen.statIndex = clampIndex((app.screen.statIndex ?? 0) + (key === "down" ? 1 : -1), rows.length);
      } else if (key === "a" || key === "b") {
        app.screen.mode = null;
      }
      app.rerender();
      return;
    }
    if (key === "up" || key === "down") {
      app.screen.menuIndex = clampIndex((app.screen.menuIndex ?? 0) + (key === "down" ? 1 : -1), 4);
    } else if (key === "a") {
      const choice = app.screen.menuIndex ?? 0;
      if (choice === 0) return launchSeriesGame(app, trainerById(app.screen.trainerId));
      if (choice === 1) {
        return app.go("lineup", {
          index: 0,
          returnTo: "seriesBreak",
          returnData: {
            trainerId: app.screen.trainerId,
            lastWon: app.screen.lastWon,
            score: app.screen.score,
            menuIndex: 0
          }
        });
      }
      if (choice === 2) {
        app.screen.mode = "stats";
        app.screen.statIndex = 0;
      } else {
        app.go("map");
      }
    }
    app.rerender();
  }
};

// ---- Result ----------------------------------------------------------------

export const battleResultScreen = {
  render(app) {
    const trainer = trainerById(app.screen.trainerId);
    const outcome = app.screen.outcome;
    const dialog = outcome.won ? trainer.dialog.win : trainer.dialog.lose;
    const page = Math.min(app.screen.page, dialog.length - 1);
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>${outcome.won ? "VICTORY!" : "DEFEAT..."}</span><span>FINAL ${app.screen.score ? yourScore(app.screen) : ""}</span></div>
      <div class="gq-body gq-center">
        <div class="gq-frame gq-title-frame">
          <b style="font-size:6cqw">${outcome.won ? "&#9733; W &#9733;" : "L"}</b>
          <p class="gq-mt">${outcome.won
            ? `+$${outcome.coins}${outcome.rematch ? ` <span class="gq-dim">REMATCH RATE</span>` : ""}`
            : `NO FEE. COME BACK AND TAKE HIM.`}</p>
          ${outcome.badge ? `<p><b>THE ${escapeHtml(outcome.badge.toUpperCase())} BADGE IS YOURS!</b><br><span class="gq-dim">NEW CHALLENGERS AWAIT.</span></p>` : ""}
          ${outcome.pack ? `<p>BONUS: A BOOSTER PACK!</p>` : ""}
          ${outcome.cardClaim ? `<p>WINNER'S RULE: TAKE A CARD FROM THEIR ROSTER!</p>` : ""}
        </div>
      </div>
      <div class="gq-textbox">
        <p>${escapeHtml(trainer.name)}: "${escapeHtml(dialog[page])}"</p>
        <p class="gq-blink gq-right">&#9660;</p>
      </div>
    </div>`;
  },
  key(app, key) {
    if (key !== "a" && key !== "b") return;
    const trainer = trainerById(app.screen.trainerId);
    const outcome = app.screen.outcome;
    const dialog = outcome.won ? trainer.dialog.win : trainer.dialog.lose;
    if (app.screen.page + 1 < dialog.length) {
      app.screen.page += 1;
    } else if (outcome.cardClaim) {
      app.go("claimCard", { trainerId: trainer.id, index: 0 });
    } else if (app.save.pendingPacks.length) {
      app.go("packOpen", { revealed: 0, returnTo: "map" });
    } else {
      app.go("map");
    }
    app.rerender();
  }
};

// ---- Winner's card claim -----------------------------------------------------

// First win over a trainer: take any one card off the beaten roster. The NPC
// team rebuilds deterministically, so the roster here is the one just faced.
// The right column stacks the boss card over YOUR cards at the same slot, so
// the upgrade (or trap) is a straight side-read.
function claimComparisonHtml(app, selected) {
  if (!selected) return "";
  const mine = rosterCards(app.save).filter((card) =>
    selected.kind === "pitcher" ? card.role === selected.role : card.kind === "hitter" && positionsOverlap(card, selected)
  );
  const slot = selected.kind === "pitcher" ? selected.role : selected.position;
  return `${cardPanelHtml(selected)}
    <p class="gq-dim">YOURS AT ${escapeHtml(slot)}:</p>
    ${mine.length ? mine.map((card) => cardPanelHtml(card)).join("") : `<p class="gq-dim">NOBODY. OPEN SLOT.</p>`}`;
}

// What the beaten trainer actually puts on the table: the whole roster, every
// card claimable. The winner's pick is the reward for the fight, so nothing is
// withheld — legends and all.
function claimableRoster(trainer, save) {
  return buildNpcTeam(trainer, save).roster;
}

export const claimCardScreen = {
  render(app) {
    const trainer = trainerById(app.screen.trainerId);
    const roster = claimableRoster(trainer, app.save);
    const index = clampIndex(app.screen.index ?? 0, roster.length);
    const selected = roster[index];
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>WINNER'S PICK</span><span>${escapeHtml(trainer.name)}</span></div>
      <div class="gq-body"><div class="gq-columns">
        <div class="gq-frame gq-scroll">${menuHtml(roster.map((card) => ({ html: cardLine(card) })), index)}</div>
        <div class="gq-card-side">${claimComparisonHtml(app, selected)}</div>
      </div></div>
      <div class="gq-textbox"><p>Take ONE card from their roster — your own ${selected ? escapeHtml(selected.kind === "pitcher" ? selected.role : selected.position) : ""} cards show below theirs. Z claims it. X walks away empty-handed.</p></div>
    </div>`;
  },
  hoverCard(app, index) {
    return claimableRoster(trainerById(app.screen.trainerId), app.save)[index] ?? null;
  },
  key(app, key) {
    const trainer = trainerById(app.screen.trainerId);
    const roster = claimableRoster(trainer, app.save);
    if (key === "up" || key === "down") {
      app.screen.index = clampIndex((app.screen.index ?? 0) + (key === "down" ? 1 : -1), roster.length);
    } else if (key === "a") {
      const card = roster[clampIndex(app.screen.index ?? 0, roster.length)];
      addCardToCollection(app.save, card.id);
      addLog(app.save, `Claimed ${card.name} from ${trainer.name}.`);
      persistSave(app.save);
      leaveClaim(app);
    } else if (key === "b") {
      leaveClaim(app);
    }
    app.rerender();
  }
};

function leaveClaim(app) {
  // Winning the World Series ends the season: the review screen follows the
  // spoils instead of the map.
  const destination = app.screen.trainerId === "post-worldseries" ? "championship" : "map";
  if (app.save.pendingPacks.length) app.go("packOpen", { revealed: 0, returnTo: destination });
  else app.go(destination);
}

// ---- Simulated series ------------------------------------------------------

export const simSeriesScreen = {
  render(app) {
    const trainer = trainerById(app.screen.trainerId);
    const { series, revealed, outcome } = app.screen;
    const done = revealed >= series.games.length;
    const rows = series.games
      .slice(0, revealed)
      .map(
        (game) =>
          `<p>G${game.gameNumber} ${game.playerIsAway ? "@" : "VS"} &middot; ${game.playerWon ? "<b>W</b>" : "L"} ${game.playerRuns}-${game.npcRuns}${game.innings > 9 ? ` (${game.innings})` : ""}${
            game.topSwing ? ` <span class="gq-dim">&#9733; ${escapeHtml(shortName(game.topSwing.name))}</span>` : ""
          }</p>`
      )
      .join("");
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>SIM SERIES VS ${escapeHtml(trainer.name)}</span><span>BEST OF ${series.bestOf}</span></div>
      <div class="gq-body">
        <div class="gq-frame">${rows || `<p class="gq-dim">THE CAGE LIGHTS FLICKER ON...</p>`}</div>
        ${done
          ? `<div class="gq-frame gq-center"><b style="font-size:5cqw">${series.playerWins} - ${series.npcWins}</b><br>
              ${outcome.won ? `SERIES WON! +$${outcome.coins}${outcome.rematch ? " (REMATCH)" : ""}` : `SERIES LOST. IT COST YOU NOTHING BUT THE GAMES.`}
              ${outcome.cardClaim ? `<br>WINNER'S RULE: TAKE A CARD FROM THEIR ROSTER!` : ""}</div>`
          : ""}
      </div>
      <div class="gq-textbox"><p>${done ? "Z to head back." : "Z to reveal the next game."}</p></div>
    </div>`;
  },
  key(app, key) {
    if (key !== "a" && key !== "b") return;
    if (app.screen.revealed < app.screen.series.games.length) app.screen.revealed += 1;
    else if (app.screen.outcome.cardClaim) app.go("claimCard", { trainerId: app.screen.trainerId, index: 0 });
    else app.go("map");
    app.rerender();
  }
};
