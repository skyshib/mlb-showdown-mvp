import {
  escapeHtml,
  menuHtml,
  clampIndex,
  describeEvent,
  halfLabel,
  diamondHtml,
  outsHtml,
  shortName,
  cardPanelHtml,
  cardLine
} from "./helpers.js";
import { gameStars, gameLogLine } from "./statsScreens.js";
import { buildBoxScore } from "../../rules/game.js";
import { trainerById, rewardCoins, markAmbushDone } from "../region.js";
import { gameFeats } from "../feats.js";
import { buildNpcTeam } from "../npcTeams.js";
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
  runSimSeries
} from "../battle/controller.js";

export function startTrainerBattle(app, trainer) {
  const save = app.save;

  if (trainer.battleFormat.type === "simSeries") {
    const attempt = attemptNumber(save, trainer.id);
    const series = runSimSeries({
      playerManager: managerFor(save),
      npcManager: buildNpcTeam(trainer),
      bestOf: trainer.battleFormat.bestOf,
      seed: deriveSeed(save, "sim", trainer.id, `a${attempt}`)
    });
    for (const game of series.games) {
      recordGameStats(save, game.playerIsAway ? game.boxScore.away : game.boxScore.home);
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
  const battle = createBattle({
    playerManager: managerFor(save),
    npcManager: buildNpcTeam(trainer),
    trainer,
    seed: deriveSeed(save, "battle", trainer.id, `a${series.attempt}`, `g${series.nextGame}`),
    starterIndex: series.nextGame - 1
  });
  persistSave(save);
  app.go("battle", {
    trainerId: trainer.id,
    battle,
    lines: [
      series.bestOf > 1 ? `GAME ${series.nextGame} of the best-of-${series.bestOf}.` : "One game. Winner takes the coins.",
      "You're the visitors. Top 1 — grab a bat."
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

// ---- Interactive battle ----------------------------------------------------

function battleMenuItems(app, phase) {
  if (phase.type === "advance-decision") {
    return advanceMenuItems(phase.pending);
  }
  if (phase.type === "player-batting") {
    const items = [{ label: "SWING AWAY", run: (a) => afterAction(a, actSwing(a.screen.battle)) }];
    if (phase.canBunt) {
      items.push({
        html: `SAC BUNT <span class="gq-dim">${Math.round(phase.buntChance * 100)}% CLEAN</span>`,
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
  const items = [{ label: "PITCH TO HIM", run: (a) => afterAction(a, actPitch(a.screen.battle)) }];
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
      const tail = events.filter(Boolean).slice(-2).flatMap(describeEvent);
      afterAction(a, [], [`&#9193; ${events.length} plays on autopilot...`, ...tail]);
    }
  };
}

function afterAction(app, events, presetLines = null) {
  const lines = presetLines ?? events.filter(Boolean).flatMap(describeEvent);
  app.screen.lines = lines.length ? lines : app.screen.lines;
  app.screen.mode = "menu";
  app.screen.menuIndex = 0;
  const phase = battlePhase(app.screen.battle);
  if (phase.type === "over") resolveGameEnd(app, phase);
}

// Every finished game routes through the box-score screen first, then on to
// the series break or the final result.
function resolveGameEnd(app, phase) {
  const save = app.save;
  const trainer = trainerById(app.screen.trainerId);
  const battle = app.screen.battle;
  const boxScore = buildBoxScore(battle.state);
  recordGameStats(save, boxScore[battle.playerSide]);
  const status = recordSeriesGame(save, phase.playerWon);
  persistSave(save);

  let next;
  if (status === "live") {
    next = { name: "seriesBreak", data: { trainerId: trainer.id, lastWon: phase.playerWon, score: phase.score, menuIndex: 0 } };
  } else {
    const outcome = applyOutcome(app, trainer, status === "won");
    clearSeries(save);
    persistSave(save);
    next = { name: "battleResult", data: { trainerId: trainer.id, outcome, score: phase.score, page: 0 } };
  }
  app.go("gameStats", {
    trainerId: trainer.id,
    boxScore,
    stars: gameStars(boxScore, battle.playerSide),
    feats: gameFeats({
      boxScore,
      playerSide: battle.playerSide,
      events: battle.events,
      score: phase.score,
      innings: battle.state.inning
    }),
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
    const phase = battlePhase(battle);
    const series = app.save.activeSeries;
    return `<div class="gq-screen">
      <div class="gq-topbar">
        <span>VS ${escapeHtml(trainer.name)}</span>
        <span>${series && series.bestOf > 1 ? `G${series.nextGame} (${series.wins}-${series.losses}) &middot; ` : ""}${halfLabel(state)}</span>
      </div>
      <div class="gq-battle-hud">
        <div class="gq-hud-team">YOU<b>${state.score.away}</b></div>
        <div>${diamondHtml(state)}<div class="gq-center gq-mt">${outsHtml(state.outs)}</div></div>
        <div class="gq-hud-team gq-hud-right">THEM<b>${state.score.home}</b></div>
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
  key(app, key) {
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

function renderMatchup(phase) {
  if (phase.type === "over") return "";
  if (phase.type === "advance-decision") {
    return `<div class="gq-matchup"><div>BALL IN PLAY<br><b>RUNNERS DECIDING...</b></div></div>`;
  }
  if (phase.type === "player-batting") {
    return `<div class="gq-matchup">
      <div>AT BAT<br><b data-card-id="${escapeHtml(phase.batter.id)}">#${phase.battingSpot} ${escapeHtml(shortName(phase.batter.name))}</b><br><span class="gq-dim">OB ${phase.batter.onBase} SPD ${phase.batter.speed}</span></div>
      <div class="gq-right">ON MOUND<br><b data-card-id="${escapeHtml(phase.opposingPitcher.id)}">${escapeHtml(shortName(phase.opposingPitcher.name))}</b><br><span class="gq-dim">CTRL ${phase.opposingPitcher.control}</span></div>
    </div>`;
  }
  const fatigue = phase.mound.fatiguePenalty;
  return `<div class="gq-matchup">
    <div>THEY SEND UP<br><b data-card-id="${escapeHtml(phase.batter.id)}">#${phase.battingSpot} ${escapeHtml(shortName(phase.batter.name))}</b><br><span class="gq-dim">OB ${phase.batter.onBase}</span></div>
    <div class="gq-right">YOUR ARM<br><b data-card-id="${escapeHtml(phase.mound.pitcher.id)}">${escapeHtml(shortName(phase.mound.pitcher.name))}</b><br>
      <span class="gq-dim ${fatigue > 0 ? "gq-fatigued" : ""}">CTRL ${phase.mound.pitcher.control}${fatigue > 0 ? ` &minus;${fatigue} TIRED` : ""} &middot; ${phase.mound.outsRecorded} OUTS IN</span></div>
  </div>`;
}

function renderBattleMenu(app, phase) {
  if (phase.type === "over") return "";
  if (app.screen.mode === "pen") {
    const options = (phase.bullpen ?? []).map(({ pitcher }) => ({
      html: `${escapeHtml(pitcher.role)} ${escapeHtml(shortName(pitcher.name))} <span class="gq-dim">CTRL${pitcher.control} IP${pitcher.ip}</span>`
    }));
    return menuHtml([...options, { label: "NEVER MIND" }], app.screen.penIndex ?? 0);
  }
  return menuHtml(
    battleMenuItems(app, phase).map((item) => ({ label: item.label, html: item.html, disabled: item.disabled })),
    app.screen.menuIndex ?? 0
  );
}

// ---- Between series games --------------------------------------------------

export const seriesBreakScreen = {
  render(app) {
    const trainer = trainerById(app.screen.trainerId);
    const series = app.save.activeSeries;
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>SERIES VS ${escapeHtml(trainer.name)}</span><span>BO${series.bestOf}</span></div>
      <div class="gq-body gq-center">
        <div class="gq-frame gq-title-frame">
          <p>${app.screen.lastWon ? "YOU TAKE GAME " : "THEY TAKE GAME "}${series.nextGame - 1}</p>
          <p class="gq-dim">FINAL ${app.screen.score.away}-${app.screen.score.home}</p>
          <p class="gq-mt" style="font-size:5cqw"><b>${series.wins} - ${series.losses}</b></p>
          <p class="gq-dim">SERIES STANDING (SAVED)</p>
        </div>
      </div>
      <div class="gq-textbox">
        ${menuHtml(
          [{ label: `PLAY GAME ${series.nextGame}` }, { label: "SET LINEUP" }, { label: "BACK TO MAP (RESUME LATER)" }],
          app.screen.menuIndex ?? 0
        )}
      </div>
    </div>`;
  },
  key(app, key) {
    if (key === "up" || key === "down") {
      app.screen.menuIndex = clampIndex((app.screen.menuIndex ?? 0) + (key === "down" ? 1 : -1), 3);
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
      app.go("map");
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
      <div class="gq-topbar"><span>${outcome.won ? "VICTORY!" : "DEFEAT..."}</span><span>FINAL ${app.screen.score ? `${app.screen.score.away}-${app.screen.score.home}` : ""}</span></div>
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
    selected.kind === "pitcher" ? card.role === selected.role : card.position === selected.position
  );
  const slot = selected.kind === "pitcher" ? selected.role : selected.position;
  return `${cardPanelHtml(selected)}
    <p class="gq-dim">YOURS AT ${escapeHtml(slot)}:</p>
    ${mine.length ? mine.map((card) => cardPanelHtml(card)).join("") : `<p class="gq-dim">NOBODY. OPEN SLOT.</p>`}`;
}

export const claimCardScreen = {
  render(app) {
    const trainer = trainerById(app.screen.trainerId);
    const roster = buildNpcTeam(trainer).roster;
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
    return buildNpcTeam(trainerById(app.screen.trainerId)).roster[index] ?? null;
  },
  key(app, key) {
    const trainer = trainerById(app.screen.trainerId);
    const roster = buildNpcTeam(trainer).roster;
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
