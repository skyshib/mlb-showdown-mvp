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
  cardPanelHtml,
  cardLine
} from "./helpers.js";
import { gameStars, gameLogLine, statLineHtml, seriesStatLines } from "./statsScreens.js";
import { recordCompletedRun } from "../hallOfFame.js";
import { cardById } from "../packs.js";
import { buildBoxScore, inningsPlayed } from "../../rules/game.js";
import { trainerById, rewardCoins, markAmbushDone } from "../region.js";
import { gameFeats } from "../feats.js";
import { buildNpcTeam } from "../npcTeams.js";
import { positionsOverlap } from "../../rules/cards.js";
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
  clearSeries,
  LOSS_FEE
} from "../state.js";
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
  npcMoundVisit
} from "../../rules/battle/controller.js";

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
        won: game.playerWon
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
  persistSave(save);
  app.go("battle", {
    trainerId: trainer.id,
    battle,
    lines: [
      series.bestOf > 1 ? `GAME ${series.nextGame} of the best-of-${series.bestOf}.` : "One game. Winner takes the coins.",
      playerIsAway ? "You're the visitors. Top 1 — grab a bat." : "Your ballpark tonight. Take the mound."
    ],
    menuIndex: 0,
    mode: "menu"
  });
  app.rerender();
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
    return { won: false, coins: -LOSS_FEE };
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
  if (trainer.rewards.pack) {
    save.progress.counters.packsOpened += 1;
    save.pendingPacks.push({
      packId: trainer.rewards.pack,
      seed: deriveSeed(save, "pack", save.progress.counters.packsOpened)
    });
    outcome.pack = trainer.rewards.pack;
  }
  addLog(save, `Beat ${trainer.name} (+${coins} coins).`);
  return outcome;
}

// One finished game's history, wherever it came from (interactive battle or
// sim series): feats detected, an almanac page written, trophies framed.
// Returns the feats so the box-score screen can reuse them. Called after
// recordGameStats, so the season game count IS the day this game happened.
export function recordFinishedGame(save, { trainer, boxScore, playerSide, events, score, innings, won }) {
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
    boxScore
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
      run: (a) => afterAction(a, actAdvance(a.screen.battle, index + 1))
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
  const rows = battle.events.map((event) => ({ html: gameLogLine(event, battle.playerSide) }));
  const index = clampIndex(app.screen.logIndex ?? rows.length - 1, rows.length);
  return `<div class="gq-screen">
    <div class="gq-topbar"><span>GAME LOG &middot; VS ${escapeHtml(trainer.name)}</span><span>${halfLabel(battle.state)}</span></div>
    <div class="gq-body"><div class="gq-frame gq-scroll">${
      rows.length ? menuHtml(rows, index) : `<p class="gq-dim">NO PLAYS YET. GO MAKE SOME HISTORY.</p>`
    }</div></div>
    <div class="gq-textbox"><p class="gq-dim">% IS WPA FOR YOUR SIDE &middot; 10%+ SWINGS BOLD. X to go back.</p></div>
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

// The rolls worth staging, from the newest event that has any: a plate
// appearance carries the pitcher's control roll AND the batter's chart roll;
// an NPC steal only has the throw.
function dramaStages(events) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event) continue;
    const steal = event.playDetails?.stealAttempt;
    if (typeof steal?.roll === "number") return [{ label: "THE THROW", roll: steal.roll }];
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
      stages.push({ label: "SWING", roll: event.resultRoll });
      return stages;
    }
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
        .map((stage, index) => `<div class="gq-die-stage">
          <div class="gq-die" data-die="${index}">&#9670;</div>
          <p class="gq-dim">${escapeHtml(stage.label)}</p>
        </div>`)
        .join("")}</div>
      <p class="gq-dim" data-die-caption>&nbsp;</p>
      <p class="gq-dim gq-blink">THE D20 TUMBLES</p>
    </div>
    <div class="gq-textbox"><p class="gq-dim">Z to skip the suspense.</p></div>
  </div>`;
}

// The browser-side animation, one die at a time: cycle faces, land on the
// real roll (posting the pitch verdict under the dice), move to the next,
// hold a beat, then reveal. Tests drive reveal through the key handler.
function mountDrama(app) {
  stopDramaTimer();
  const stages = app.screen.drama?.stages ?? [];
  const spin = (index) => {
    const die = document.querySelector(`[data-die="${index}"]`);
    if (!die || !app.screen.drama) return stopDramaTimer();
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
      die.classList.add("gq-die-landed");
      const caption = document.querySelector("[data-die-caption]");
      if (stages[index].caption && caption) caption.textContent = stages[index].caption;
      if (index + 1 < stages.length) dramaTimer = setTimeout(() => spin(index + 1), 350);
      else dramaTimer = setTimeout(() => revealDrama(app), 700);
    }, 85);
  };
  spin(0);
}

function afterAction(app, events, presetLines = null) {
  const playerSide = app.screen.battle.playerSide;
  const lines = presetLines ?? events.filter(Boolean).flatMap((event) => describeEvent(event, playerSide));
  // The NPC's between-batters mound visit is its own beat: it announces
  // itself here, before the player picks an action against the new arm.
  const visit = npcMoundVisit(app.screen.battle);
  if (visit) lines.push(...describeEvent(visit, playerSide));
  app.screen.lines = lines.length ? lines : app.screen.lines;
  app.screen.mode = "menu";
  app.screen.menuIndex = 0;
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
    won: phase.playerWon
  });
  const status = recordSeriesGame(save, phase.playerWon);
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
      <div>${selected ? cardPanelHtml(selected.card) : ""}</div>
    </div></div>
    <div class="gq-textbox"><p class="gq-dim">Hover or move the cursor to read a card. X to go back.</p></div>
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
    const series = app.save.activeSeries;
    return `<div class="gq-screen">
      <div class="gq-topbar">
        <span>VS ${escapeHtml(trainer.name)}</span>
        <span>${series && series.bestOf > 1 ? `G${series.nextGame} (${series.wins}-${series.losses}) &middot; ` : ""}${halfLabel(state)}</span>
      </div>
      <div class="gq-battle-hud">
        <div class="gq-hud-team" data-hover-note="${escapeHtml(fieldingNote("YOUR DEFENSE", state[battle.playerSide]))}">YOU${battle.playerSide === "home" ? " &#9679;" : ""}<b>${state.score[battle.playerSide]}</b></div>
        <div>${diamondHtml(state)}<div class="gq-center gq-mt">${outsHtml(state.outs)}</div></div>
        <div class="gq-hud-team gq-hud-right" data-hover-note="${escapeHtml(fieldingNote("THEIR DEFENSE", state[battle.npcSide]))}">THEM${battle.npcSide === "home" ? " &#9679;" : ""}<b>${state.score[battle.npcSide]}</b></div>
      </div>
      ${renderMatchup(phase)}
      <div class="gq-textbox">
        ${(app.screen.lines ?? []).map((line) => `<p>${line}</p>`).join("")}
        ${renderBattleMenu(app, phase)}
      </div>
    </div>`;
  },
  hoverCard(app, index) {
    if (app.screen.mode !== "rosters") return null;
    return rosterRows(app.screen.battle)[index]?.card ?? null;
  },
  mounted(app) {
    if (app.screen.mode === "drama" && app.screen.drama) mountDrama(app);
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
function fieldingNote(title, team) {
  const total = (positions) => team.lineup
    .filter((player) => positions.includes(player.assignedPosition ?? player.position))
    .reduce((sum, player) => sum + (Number(player.fielding) || 0), 0);
  const signed = (value) => `${value >= 0 ? "+" : ""}${value}`;
  return `${title}\nCATCHER ${signed(total(["C", "CA"]))}\nINFIELD ${signed(total(["1B", "2B", "3B", "SS"]))}\nOUTFIELD ${signed(total(["LF", "CF", "RF"]))}`;
}

// The matchup panel drops classic cards' year suffix ("B.AUSMUS '01" reads
// "B.AUSMUS") — it's cramped in there, and the full card is a hover away.
// The play-by-play does the same; roster and box-score views keep the year.
function matchupName(name) {
  return shortName(stripCardYear(name));
}

function renderMatchup(phase) {
  if (phase.type === "over") return "";
  if (phase.type === "advance-decision") {
    return `<div class="gq-matchup"><div>BALL IN PLAY<br><b>RUNNERS DECIDING...</b></div></div>`;
  }
  if (phase.type === "player-batting") {
    return `<div class="gq-matchup">
      <div>AT BAT<br><b data-card-id="${escapeHtml(phase.batter.id)}">#${phase.battingSpot} ${escapeHtml(matchupName(phase.batter.name))}</b><br><span class="gq-dim">OB ${phase.batter.onBase} &middot; SPD ${phase.batter.speed}</span><br>${onDeckLine(phase)}</div>
      <div class="gq-right">ON MOUND<br><b data-card-id="${escapeHtml(phase.opposingPitcher.id)}">${escapeHtml(matchupName(phase.opposingPitcher.name))}</b><br>
        ${moundLine(phase.opposingMound)}</div>
    </div>`;
  }
  return `<div class="gq-matchup">
    <div>THEY SEND UP<br><b data-card-id="${escapeHtml(phase.batter.id)}">#${phase.battingSpot} ${escapeHtml(matchupName(phase.batter.name))}</b><br><span class="gq-dim">OB ${phase.batter.onBase}</span><br>${onDeckLine(phase)}</div>
    <div class="gq-right">YOUR ARM<br><b data-card-id="${escapeHtml(phase.mound.pitcher.id)}">${escapeHtml(matchupName(phase.mound.pitcher.name))}</b><br>
      ${moundLine(phase.mound)}</div>
  </div>`;
}

// A peek down the order, hoverable like everyone else in the matchup.
function onDeckLine(phase) {
  if (!phase.onDeck) return "";
  return `<span class="gq-dim">ON DECK <span data-card-id="${escapeHtml(phase.onDeck.id)}">${escapeHtml(matchupName(phase.onDeck.name))}</span></span>`;
}

// The mound readout: control and the fatigue subtraction, how much of the
// chart is outs, then the workload tank on its own line.
function moundLine(mound) {
  if (!mound) return "";
  const fatigue = mound.fatiguePenalty ?? 0;
  const tired = fatigue > 0 ? ` &minus;${fatigue} TIRED` : "";
  const outs = chartOutCount(mound.pitcher.chart);
  return `<span class="gq-dim ${fatigue > 0 ? "gq-fatigued" : ""}">CTRL ${mound.pitcher.control}${tired} &middot; ${outs} OUT</span><br><span class="gq-dim">${mound.battersFaced}/${mound.tiredAt} BF</span>`;
}

// Out slots (PU/SO/GB/FB) on the pitcher's d20 chart — "17 OUT" means 17 of
// the 20 rolls retire the batter outright.
const OUT_RESULTS = new Set(["PU", "SO", "GB", "FB"]);
function chartOutCount(chart) {
  if (!Array.isArray(chart)) return 0;
  let outs = 0;
  for (const entry of chart) {
    if (!OUT_RESULTS.has(entry.result)) continue;
    const from = Math.max(1, entry.from);
    const to = Math.min(20, Number.isFinite(entry.to) ? entry.to : 20);
    if (to >= from) outs += to - from + 1;
  }
  return outs;
}

// Defense menus (the NPC is hitting) read from the other dugout: right-
// aligned, mirroring the matchup panel's YOUR ARM side.
function renderBattleMenu(app, phase) {
  if (phase.type === "over") return "";
  if (app.screen.mode === "pen") {
    const options = (phase.bullpen ?? []).map(({ pitcher }) => ({
      html: `${escapeHtml(pitcher.role)} ${escapeHtml(shortName(pitcher.name))} <span class="gq-dim">CTRL${pitcher.control} IP${pitcher.ip}</span>`
    }));
    return menuHtml([...options, { label: "NEVER MIND" }], app.screen.penIndex ?? 0, { className: "gq-menu-right" });
  }
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
          <p class="gq-mt">${outcome.won ? `+&#9679; ${outcome.coins} COINS` : `LOST &#9679; ${LOSS_FEE} SCRAMBLING HOME`}</p>
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
        <div>${claimComparisonHtml(app, selected)}</div>
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
              ${outcome.won ? `SERIES WON! +&#9679; ${outcome.coins}` : `SERIES LOST. -&#9679; ${LOSS_FEE}`}
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
