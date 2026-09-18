import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOnlineServer } from "../scripts/online-server.js";
import { buildDraftPool, cardById, deckEntry, deckFromIds, setUniverse, universePool } from "../src/data/universes.js";
import { RESULTS, resolveChart, resolveSwing } from "../src/rules/cards.js";
import { actAcceptRealign, actAdvance, actPitch, actSwing, battlePhase, createBattle, fastForward } from "../src/rules/battle/controller.js";
import {
  COACHES,
  COACHES_PER_BOARD,
  ROTATION_ACE_SHARE,
  SPEED_A_MINIMUM,
  aceStarterIndex,
  coachById,
  coachEffects,
  coachFlip,
  convertFlyoutsToStrikeouts,
  convertStrikeoutsToGroundBalls,
  isCoach,
  needsCoachTarget,
  speedGrade
} from "../src/rules/coaches.js";
import {
  applyDraftAction,
  auctionLotPlayer,
  auctionMaxBid,
  autopick,
  benchPlayers,
  buildTeam,
  canPickPlayer,
  canSetCoachTarget,
  cpuSealedBid,
  createDraft,
  currentManager,
  draftHistory,
  managerForPickNumber,
  nominatePlayer,
  pickPlayer,
  placeSealedBid,
  rosterCoaches,
  rosterFull,
  rosterPlayerCount,
  sealedBidder,
  undoLastPick,
  validateRoster
} from "../src/rules/draft.js";
import { applyFlyout, applyGroundout, attemptSteal, createInitialState, playPlateAppearance, playStealAttempt, stealCandidates } from "../src/rules/game.js";
import { replayBatchGames, simulateBatch } from "../src/rules/batch.js";

// ---- fixtures ---------------------------------------------------------------

const hitterChart = [
  { from: 1, to: 10, result: RESULTS.SINGLE },
  { from: 11, to: 19, result: RESULTS.HR },
  { from: 20, to: 20, result: RESULTS.GB }
];

const pitcherChart = [
  { from: 1, to: 2, result: RESULTS.PU },
  { from: 3, to: 8, result: RESULTS.SO },
  { from: 9, to: 13, result: RESULTS.GB },
  { from: 14, to: 16, result: RESULTS.FB },
  { from: 17, to: 20, result: RESULTS.BB }
];

const LINEUP_POSITIONS = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"];

// A nine and an arm, with the knobs the coaches turn: who bats and throws
// which way, how fast the runners are, and which coaches are in the dugout.
function makeTeam(name, { coaches = [], bats = "R", throws = "L", speed = 12, fielding = 0, chart = hitterChart } = {}) {
  const team = {
    name,
    lineup: LINEUP_POSITIONS.map((position, index) => ({
      id: `${name}-h-${index}`,
      name: `${name} Hitter ${index}`,
      kind: "hitter",
      position: position === "DH" ? "1B" : position,
      defensivePosition: position,
      onBase: 10,
      speed,
      fielding,
      bats,
      chart
    })),
    pitchers: [{ id: `${name}-p`, name: `${name} Pitcher`, kind: "pitcher", role: "SP", control: 4, ip: 6, throws, chart: pitcherChart }]
  };
  if (coaches.length) team.coaches = coaches;
  return team;
}

function coach(id, target = null) {
  const card = coachById(id);
  assert.ok(card, `${id} is a coach`);
  return target ? { ...card, target } : card;
}

// The dice, spelled out. Only d20s are ever thrown in a plate appearance.
function dice(...values) {
  let index = 0;
  return { d20: () => values[index++ % values.length] };
}

function playFirstBatter(away, home, rolls, setup = () => {}) {
  const state = createInitialState(away, home);
  setup(state);
  const event = playPlateAppearance(state, dice(...rolls));
  return { state, event };
}

// Six of the twelve coaches deal to a board, by the seed; a test that needs a
// particular coach on it walks seeds until the deal turns him up.
function seedDealing(base, coachIds, { managerCount = 2, nomination, universe = "classic" } = {}) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const seed = `${base}-${attempt}`;
    const dealt = new Set(buildDraftPool(universe, seed, { managerCount, coaches: true, nomination }).filter(isCoach).map((card) => card.id));
    if (coachIds.every((id) => dealt.has(id))) return seed;
  }
  throw new Error(`no seed under ${base} deals ${coachIds.join(", ")}`);
}

function coachRoom(managerCount, seed, options = {}) {
  const managers = Array.from({ length: managerCount }, (_, index) => ({ name: `M${index + 1}`, cpu: Boolean(options.cpu) }));
  const pool = buildDraftPool("classic", seed, { managerCount, coaches: true, nomination: options.nomination });
  const draft = createDraft(managers, pool, 13, seed, {
    draftType: options.draftType ?? "snake",
    nomination: options.nomination,
    budget: options.budget,
    timer: false
  });
  return { draft, pool };
}

// ---- the cards ----------------------------------------------------------------

test("the catalog holds twelve distinct coaches, deals ten, and only the Wild Card asks a question", () => {
  assert.equal(COACHES.length, 12);
  assert.equal(COACHES_PER_BOARD, 10);
  assert.equal(new Set(COACHES.map((card) => card.id)).size, 12);
  assert.ok(COACHES.every(isCoach));
  assert.ok(COACHES.every((card) => card.points > 0 && card.blurb && card.title));
  assert.deepEqual(COACHES.filter(needsCoachTarget).map((card) => card.id), ["coach-wild-card"]);
  assert.equal(coachById("coach-green-light").ability, "stealSpeedA");
  assert.equal(coachById("coach-old-school").ability, "oldSchool");
  assert.equal(coachById("nobody"), null);
});

test("speed A is the top of the numeric scale", () => {
  assert.equal(speedGrade(20), "A");
  assert.equal(speedGrade(SPEED_A_MINIMUM), "A");
  assert.equal(speedGrade(SPEED_A_MINIMUM - 1), "B");
  assert.equal(speedGrade(10), "C");
});

test("the bullpen coach turns the lowest fly-ball face into a strikeout", () => {
  assert.deepEqual(convertFlyoutsToStrikeouts(pitcherChart, 1), [
    { from: 1, to: 2, result: RESULTS.PU },
    { from: 3, to: 8, result: RESULTS.SO },
    { from: 9, to: 13, result: RESULTS.GB },
    { from: 14, to: 14, result: RESULTS.SO },
    { from: 15, to: 16, result: RESULTS.FB },
    { from: 17, to: 20, result: RESULTS.BB }
  ]);
  // Two coaches, two faces; a chart with no fly ball is left alone.
  assert.deepEqual(convertFlyoutsToStrikeouts(pitcherChart, 2).filter((entry) => entry.result === RESULTS.FB), [{ from: 16, to: 16, result: RESULTS.FB }]);
  const noFlyBalls = [{ from: 1, to: 12, result: RESULTS.SO }, { from: 13, to: 20, result: RESULTS.BB }];
  assert.deepEqual(convertFlyoutsToStrikeouts(noFlyBalls, 1), noFlyBalls);
  assert.equal(convertFlyoutsToStrikeouts(pitcherChart, 0), pitcherChart);
  // The contact coach is the same edit the other way round.
  assert.deepEqual(convertStrikeoutsToGroundBalls(noFlyBalls, 1), [
    { from: 1, to: 1, result: RESULTS.GB },
    { from: 2, to: 12, result: RESULTS.SO },
    { from: 13, to: 20, result: RESULTS.BB }
  ]);
  assert.deepEqual(convertStrikeoutsToGroundBalls(hitterChart, 1), hitterChart, "no strikeouts, no change");
});

test("a swing pushed off the die reads the card's top or bottom row", () => {
  assert.equal(resolveSwing(hitterChart, 21), RESULTS.GB);
  assert.equal(resolveSwing(hitterChart, 0), RESULTS.SINGLE);
  assert.equal(resolveSwing(hitterChart, 11), RESULTS.HR);
  const openTop = [{ from: 1, to: 18, result: RESULTS.SINGLE }, { from: 19, to: Infinity, result: RESULTS.HR }];
  assert.equal(resolveSwing(openTop, 22), RESULTS.HR);
});

test("coachEffects folds a staff into counts and the Wild Card into a mark on one man", () => {
  const effects = coachEffects([
    coach("coach-green-light"),
    coach("coach-cannon-arms"),
    coach("coach-lefty-specialist"),
    coach("coach-late-innings"),
    coach("coach-punchouts"),
    coach("coach-wild-card", { playerId: "x", swing: -1 })
  ]);
  assert.equal(effects.stealSpeedA, 1);
  assert.equal(effects.outfieldDefense, 1);
  assert.equal(effects.leftyControl, 1);
  assert.equal(effects.lateSwing, 1);
  assert.equal(effects.flyToStrikeout, 1);
  assert.deepEqual(effects.swingTargets, { x: -1 });
  assert.equal(effects.names.lateSwing, "Late Innings");
  // An unanswered Wild Card marks nobody; two of one coach stack.
  assert.deepEqual(coachEffects([coach("coach-wild-card")]).swingTargets, {});
  assert.equal(coachEffects([coach("coach-cannon-arms"), coach("coach-cannon-arms")]).outfieldDefense, 2);
  // The second wave, Old School turning two knobs at once.
  const wave = coachEffects(["coach-framing", "coach-platoon", "coach-contact", "coach-rotation", "coach-clutch-gene", "coach-old-school"].map((id) => coach(id)));
  assert.equal(wave.framing, 1);
  assert.equal(wave.platoonOnBase, 1);
  assert.equal(wave.strikeoutToGroundBall, 1);
  assert.equal(wave.rotationAce, 1);
  assert.equal(wave.clutchGene, 1);
  assert.equal(wave.infieldDefense, 1);
  assert.equal(wave.noSteals, 1);
  assert.equal(wave.names.infieldDefense, "Old School");
  assert.equal(wave.names.noSteals, "Old School");
  assert.equal(effects.noSteals, 0);
});

// ---- the deal ----------------------------------------------------------------

test("coaches are extra draws on top of the snake board, the DH shelf included", () => {
  const plain = buildDraftPool("classic", "coach-deal", { managerCount: 4 });
  const dealt = buildDraftPool("classic", "coach-deal", { managerCount: 4, coaches: true });
  assert.equal(plain.filter(isCoach).length, 0);
  assert.equal(COACHES_PER_BOARD, COACHES.length - 2, "every coach but two");
  assert.equal(dealt.length, plain.length + COACHES_PER_BOARD, "the board grew by the staff and nothing else");
  const coaches = dealt.filter(isCoach);
  assert.equal(coaches.length, COACHES_PER_BOARD);
  assert.equal(new Set(coaches.map((card) => card.id)).size, COACHES_PER_BOARD, "ten different coaches");
  assert.ok(coaches.every((card) => coachById(card.id) && card.slot === "COACH"), "every one of them is in the catalog");
  assert.equal(dealt.filter((card) => card.position === "DH").length, plain.filter((card) => card.position === "DH").length, "the DH shelf is still there");
  // Every other card — the biddable deck and the standing replacements alike —
  // is exactly the card the coaches-off deal dealt, in the same order.
  assert.deepEqual(dealt.filter((card) => !isCoach(card)).map((card) => card.id), plain.map((card) => card.id));
  // Two sit out, by the seed.
  const sitOut = (deck) => COACHES.filter((coach) => !deck.some((card) => card.id === coach.id)).map((coach) => coach.id);
  assert.equal(sitOut(dealt).length, 2);
  assert.equal(sitOut(buildDraftPool("classic", "coach-deal-2", { managerCount: 4, coaches: true })).length, 2);
});

test("a random-nomination board shows every dealt coach and puts each of them up as an extra lot", () => {
  const plainDraft = createDraft(["M1", "M2", "M3"], buildDraftPool("classic", "coach-rn", { managerCount: 3, nomination: "random" }), 13, "coach-rn", {
    draftType: "auction", nomination: "random", budget: 5000, timer: false
  });
  const withCoaches = coachRoom(3, "coach-rn", { draftType: "auction", nomination: "random", budget: 5000 });
  assert.equal(plainDraft.coaches, false);
  assert.equal(withCoaches.pool.filter(isCoach).length, COACHES_PER_BOARD);
  assert.equal(withCoaches.pool.length, plainDraft.pool.length + COACHES_PER_BOARD, "the visible board grew by the staff, no bat lost");
  const queue = withCoaches.draft.auction.queue;
  assert.equal(queue.length, plainDraft.auction.queue.length + COACHES_PER_BOARD, "every coach is a lot of its own");
  assert.equal(queue.filter((id) => isCoach(coachById(id))).length, COACHES_PER_BOARD, "every dealt coach comes up");
  // The bats that come up are exactly the bats that came up without coaches.
  assert.deepEqual(queue.filter((id) => !isCoach(coachById(id))).sort(), [...plainDraft.auction.queue].sort());
});

test("a saved deck rebuilds its coaches from their ids", () => {
  const dealt = buildDraftPool("classic", "coach-save", { managerCount: 3, coaches: true });
  const back = deckFromIds("classic", "coach-save", dealt.map(deckEntry));
  assert.deepEqual(back.map((card) => card.id), dealt.map((card) => card.id));
  assert.equal(back.filter(isCoach).length, COACHES_PER_BOARD);
  assert.ok(back.filter(isCoach).every((card) => card.slot === "COACH"));
});

// ---- the snake ---------------------------------------------------------------

test("a coach costs a pick and no slot in a snake draft", () => {
  const { draft } = coachRoom(3, "coach-snake");
  assert.equal(draft.coaches, true);
  const [ana] = draft.managers;
  const coaches = draft.pool.filter(isCoach);

  // Pick 0 is Ana's; so is pick 5 (the snake turns). Both go on coaches.
  assert.equal(currentManager(draft).id, ana.id);
  assert.ok(canPickPlayer(draft, ana, coaches[0]).ok);
  pickPlayer(draft, coaches[0].id);
  while (currentManager(draft).id !== ana.id) autopick(draft);
  assert.equal(draft.pickNumber, 5);
  pickPlayer(draft, coaches[1].id);
  assert.equal(rosterPlayerCount(ana), 0);
  assert.equal(rosterCoaches(ana).length, 2);

  // A coach never asks the roster to reserve a slot: with twelve players and a
  // starter still owed, the rules would refuse a bat but take a coach.
  while (!draft.complete) autopick(draft);
  assert.equal(draft.pickNumber, 3 * 13 + 2, "every roster slot plus the two picks spent on coaches");
  for (const manager of draft.managers) {
    assert.equal(rosterPlayerCount(manager), 13);
    assert.ok(rosterFull(draft, manager));
    assert.deepEqual(validateRoster(manager, draft), []);
  }
  assert.equal(ana.roster.length, 15);

  // The extra turns fell to Ana, at the end, where the coaches' picks cost her.
  assert.equal(managerForPickNumber(draft, 39).id, ana.id);
  assert.equal(managerForPickNumber(draft, 40).id, ana.id);
  const history = draftHistory(draft);
  assert.equal(history.length, 41);
  assert.deepEqual(history.slice(-2).map((pick) => pick.manager.id), [ana.id, ana.id]);
  // The ledger and the rosters agree, pick for pick.
  for (const pick of history) {
    assert.ok(pick.manager.roster.some((card) => card.id === pick.player.id), `${pick.player.name} is on ${pick.manager.name}'s roster`);
  }
  // With no coaches on the board the old arithmetic still answers.
  const plain = createDraft(["A", "B"], buildDraftPool("classic", "coach-snake", { managerCount: 2 }), 13, "coach-snake");
  assert.equal(managerForPickNumber(plain, 3).id, plain.managers[0].id);
});

test("undoing a coach pick hands the turn back", () => {
  const { draft } = coachRoom(2, "coach-undo");
  const [ana] = draft.managers;
  const target = draft.pool.find(isCoach);
  pickPlayer(draft, target.id);
  assert.equal(currentManager(draft).id, draft.managers[1].id);
  const undone = undoLastPick(draft);
  assert.equal(undone.player.id, target.id);
  assert.equal(currentManager(draft).id, ana.id);
  assert.equal(draft.pickNumber, 0);
  assert.ok(!draft.pickedIds.has(target.id));
  assert.ok(canPickPlayer(draft, ana, target).ok);
});

test("the CPU takes a coach only when the pick costs less than the coach is worth", () => {
  // Every bat and arm is the same card, so passing on the best man now costs
  // nothing — the coach is the pick. Then the room fills as usual.
  const positions = ["C", "1B", "2B", "3B", "SS", "LF/RF", "CF", "LF/RF", "C"];
  const hitters = Array.from({ length: 27 }, (_, index) => ({
    id: `flat-h-${index}`, name: `Flat Hitter ${index}`, kind: "hitter", position: positions[index % positions.length],
    onBase: 10, speed: 12, fielding: 1, bats: "R", points: 200, chart: hitterChart
  }));
  const pitchers = Array.from({ length: 12 }, (_, index) => ({
    id: `flat-p-${index}`, name: `Flat Pitcher ${index}`, kind: "pitcher", role: index % 2 ? "RP" : "SP",
    ip: index % 2 ? 1 : 6, control: 4, throws: "R", points: 200, chart: pitcherChart
  }));
  const pool = [...hitters, ...pitchers, coach("coach-cannon-arms")];
  const draft = createDraft([{ name: "CPU", cpu: true }, { name: "Also CPU", cpu: true }], pool, 13, "flat-room");
  autopick(draft);
  assert.ok(isCoach(draft.managers[0].roster[0]), "a free coach is taken");
  while (!draft.complete) autopick(draft);
  assert.equal(rosterPlayerCount(draft.managers[0]), 13);
  assert.equal(rosterPlayerCount(draft.managers[1]), 13);
});

// ---- the Wild Card -----------------------------------------------------------

test("the Wild Card flips once per named hitter, and the naming is locked", () => {
  const { draft } = coachRoom(2, seedDealing("coach-wild", ["coach-wild-card"]));
  const [ana, bo] = draft.managers;
  const wild = draft.pool.find((card) => card.id === "coach-wild-card");
  pickPlayer(draft, wild.id);
  while (!draft.complete) autopick(draft);
  const bat = ana.roster.find((card) => card.kind === "hitter");
  const arm = ana.roster.find((card) => card.kind === "pitcher");

  assert.equal(canSetCoachTarget(draft, bo, wild.id, bo.roster[0].id).ok, false, "not his coach");
  assert.equal(canSetCoachTarget(draft, ana, wild.id, arm.id).ok, false, "a hitter, not an arm");
  assert.equal(canSetCoachTarget(draft, ana, "coach-cannon-arms", bat.id).ok, false, "only the Wild Card asks");
  assert.ok(canSetCoachTarget(draft, ana, wild.id, bat.id).ok);

  applyDraftAction(draft, { type: "coach-target", managerId: ana.id, coachId: wild.id, playerId: bat.id });
  const target = ana.coachTargets[wild.id];
  assert.equal(target.playerId, bat.id);
  assert.ok(target.swing === 1 || target.swing === -1);
  assert.equal(target.swing, coachFlip(draft.seed, ana.id, wild.id, bat.id), "the flip is a function of the naming");
  assert.equal(coachFlip("s", "m", "c", "p"), coachFlip("s", "m", "c", "p"));
  assert.throws(() => applyDraftAction(draft, { type: "coach-target", managerId: ana.id, coachId: wild.id, playerId: bat.id }), /already made his pick/);

  // The built team carries the coach with its answer; the bench never does.
  const team = buildTeam(ana, { optimize: true });
  assert.equal(team.coaches.length, 1);
  assert.deepEqual(team.coaches[0].target, target);
  assert.ok(benchPlayers(ana).every((card) => !isCoach(card)));
  assert.deepEqual(validateRoster(ana, draft), []);
  assert.equal(buildTeam(bo, { optimize: true }).coaches, undefined, "a club without coaches gets the team it always got");
});

test("a coach's pick dies with the man he picked", () => {
  const { draft } = coachRoom(2, seedDealing("coach-forget", ["coach-wild-card"]));
  const [ana] = draft.managers;
  const wild = draft.pool.find((card) => card.id === "coach-wild-card");
  pickPlayer(draft, wild.id);
  while (!draft.complete) autopick(draft);
  // Ana's last pick was the last pick of the draft: a bat, or the undo below
  // would need to walk further. Find the last pick and make sure it is hers
  // and a hitter before pinning the Wild Card on him.
  const last = draftHistory(draft).at(-1);
  if (last.manager.id === ana.id && last.player.kind === "hitter") {
    applyDraftAction(draft, { type: "coach-target", managerId: ana.id, coachId: wild.id, playerId: last.player.id });
    assert.ok(ana.coachTargets[wild.id]);
    undoLastPick(draft);
    assert.equal(ana.coachTargets[wild.id], undefined);
  }
  // Undoing the coach himself drops his answer too.
  const room = coachRoom(2, seedDealing("coach-forget-2", ["coach-wild-card"]));
  const owner = room.draft.managers[0];
  pickPlayer(room.draft, "coach-wild-card");
  undoLastPick(room.draft);
  assert.equal(rosterCoaches(owner).length, 0);
});

test("a computer manager names his best bat when the draft ends", () => {
  const { draft } = coachRoom(2, seedDealing("coach-cpu-target", ["coach-wild-card"]), { cpu: true });
  pickPlayer(draft, "coach-wild-card");
  while (!draft.complete) autopick(draft);
  const owner = draft.managers[0];
  const target = owner.coachTargets["coach-wild-card"];
  assert.ok(target, "the computer answered the question");
  const best = owner.roster.filter((card) => card.kind === "hitter").sort((a, b) => b.points - a.points)[0];
  assert.equal(target.playerId, best.id);
});

// ---- the auction --------------------------------------------------------------

test("a coach on the block reserves no slot and a full roster cannot bid on him", () => {
  const { draft } = coachRoom(2, seedDealing("coach-auction", ["coach-wild-card"]), { draftType: "auction", nomination: "manual", budget: 1300 });
  const [ana, bo] = draft.managers;
  const wild = draft.pool.find((card) => card.id === "coach-wild-card");
  // Thirteen open slots at $5 each: a player lot must leave $60 behind, a
  // coach lot the whole $65.
  assert.equal(auctionMaxBid(draft, ana), 1300 - 12 * 5);
  nominatePlayer(draft, wild.id);
  assert.equal(auctionLotPlayer(draft).id, wild.id);
  assert.equal(auctionMaxBid(draft, ana), 1300 - 13 * 5);
  assert.equal(sealedBidder(draft).id, ana.id);
  placeSealedBid(draft, ana.id, 40);
  const sale = placeSealedBid(draft, bo.id, 10);
  assert.equal(sale.sold, true);
  assert.equal(sale.manager.id, ana.id);
  assert.equal(rosterCoaches(ana).length, 1);
  assert.equal(rosterPlayerCount(ana), 0);
  while (!draft.complete) autopick(draft);
  assert.equal(rosterPlayerCount(ana), 13);
  assert.equal(rosterPlayerCount(bo), 13);
  assert.ok(cpuSealedBid(draft, ana) >= 0);
});

test("a random-nomination room sells its coaches and still finishes every roster", () => {
  const { draft } = coachRoom(3, "coach-rn-run", { draftType: "auction", nomination: "random", budget: 5000, cpu: true });
  applyDraftAction(draft, { type: "finish", at: 0 });
  assert.equal(draft.complete, true);
  const sold = draft.auction.history.filter((entry) => isCoach(coachById(entry.playerId)) && entry.managerId);
  assert.ok(sold.length >= 1, "somebody bought a coach");
  for (const manager of draft.managers) assert.deepEqual(validateRoster(manager, { unlimitedRoster: true }), []);
  assert.ok(draft.managers.every((manager) => benchPlayers(manager).every((card) => !isCoach(card))));
});

// ---- the game ----------------------------------------------------------------

test("the pitching coach's lefty bonus rides on the pitch, lefty on lefty only", () => {
  const rolls = [6, 5];
  // 6 + 4 = 10 is not over an on-base of 10: the batter's chart, a single.
  const plain = playFirstBatter(makeTeam("away", { bats: "L" }), makeTeam("home", { throws: "L" }), rolls);
  assert.equal(plain.event.chartOwner, "hitter");
  assert.equal(plain.event.controlBonus, 0);
  // 6 + 4 + 1 = 11 clears it: the pitcher's chart, and a 5 there is a strikeout.
  const coached = playFirstBatter(makeTeam("away", { bats: "L" }), makeTeam("home", { throws: "L", coaches: [coach("coach-lefty-specialist")] }), rolls);
  assert.equal(coached.event.controlBonus, 1);
  assert.equal(coached.event.effectiveControl, 5);
  assert.equal(coached.event.chartOwner, "pitcher");
  assert.equal(coached.event.result, RESULTS.SO);
  assert.deepEqual(coached.event.coachNotes, ["Lefty Specialist +1 control"]);
  // A switch hitter bats right against him; a right-hander gets nothing.
  assert.equal(playFirstBatter(makeTeam("away", { bats: "S" }), makeTeam("home", { throws: "L", coaches: [coach("coach-lefty-specialist")] }), rolls).event.controlBonus, 0);
  assert.equal(playFirstBatter(makeTeam("away", { bats: "L" }), makeTeam("home", { throws: "R", coaches: [coach("coach-lefty-specialist")] }), rolls).event.controlBonus, 0);
});

test("the hitting coach's late-innings bonus rides on the swing while tied or trailing", () => {
  const away = makeTeam("away", { coaches: [coach("coach-late-innings")] });
  const home = makeTeam("home");
  const ninthTied = (state) => { state.inning = 9; };
  // 1 + 4 is the batter's chart; a raw 10 is a single, and the coach makes it 11 — a homer.
  const tied = playFirstBatter(away, home, [1, 10], ninthTied);
  assert.equal(tied.event.swingBonus, 1);
  assert.equal(tied.event.resultRoll, 10);
  assert.equal(tied.event.swingRoll, 11);
  assert.equal(tied.event.result, RESULTS.HR);
  assert.deepEqual(tied.event.coachNotes, ["Late Innings +1 swing"]);
  const trailing = playFirstBatter(away, home, [1, 10], (state) => { state.inning = 10; state.score.home = 2; });
  assert.equal(trailing.event.result, RESULTS.HR);
  // Not in the eighth, and not while ahead.
  assert.equal(playFirstBatter(away, home, [1, 10], (state) => { state.inning = 8; }).event.result, RESULTS.SINGLE);
  assert.equal(playFirstBatter(away, home, [1, 10], (state) => { state.inning = 9; state.score.away = 1; }).event.swingBonus, 0);
  // Pushed off the die, the swing reads the top row — here a 20 is the out.
  const offTheDie = playFirstBatter(away, home, [1, 20], ninthTied);
  assert.equal(offTheDie.event.swingRoll, 21);
  assert.equal(offTheDie.event.result, RESULTS.GB);
  // The other dugout has no such coach.
  assert.equal(playFirstBatter(makeTeam("away"), home, [1, 10], ninthTied).event.swingBonus, 0);
});

test("the Wild Card's mark follows one man and nobody else", () => {
  const away = makeTeam("away", { coaches: [coach("coach-wild-card", { playerId: "away-h-0", swing: -1 })] });
  const home = makeTeam("home");
  const marked = playFirstBatter(away, home, [1, 11]);
  assert.equal(marked.event.batterId, "away-h-0");
  assert.equal(marked.event.swingBonus, -1);
  assert.equal(marked.event.result, RESULTS.SINGLE, "an 11 read at 10 is a single, not a homer");
  assert.deepEqual(marked.event.coachNotes, ["Wild Card -1 swing"]);
  // The next man up is unmarked.
  const state = createInitialState(away, home);
  playPlateAppearance(state, dice(1, 11));
  const second = playPlateAppearance(state, dice(1, 11));
  assert.equal(second.batterId, "away-h-1");
  assert.equal(second.swingBonus, 0);
  assert.equal(second.result, RESULTS.HR);
  // Heads is +1: a raw 10 becomes a homer.
  const heads = makeTeam("away", { coaches: [coach("coach-wild-card", { playerId: "away-h-0", swing: 1 })] });
  assert.equal(playFirstBatter(heads, home, [1, 10]).event.result, RESULTS.HR);
});

test("the bullpen coach's chart edit lands on the runtime arms and nowhere else", () => {
  const home = makeTeam("home", { coaches: [coach("coach-punchouts")] });
  // 20 + 4 is the pitcher's chart, where a 14 was a fly ball.
  const coached = playFirstBatter(makeTeam("away"), home, [20, 14]);
  assert.equal(coached.event.chartOwner, "pitcher");
  assert.equal(coached.event.result, RESULTS.SO);
  assert.deepEqual(
    coached.state.home.pitchers[0].chart.filter((entry) => entry.from >= 14 && entry.from <= 16),
    [{ from: 14, to: 14, result: RESULTS.SO }, { from: 15, to: 16, result: RESULTS.FB }]
  );
  assert.deepEqual(home.pitchers[0].chart, pitcherChart, "the drafted card is untouched");
  assert.equal(playFirstBatter(makeTeam("away"), makeTeam("home"), [20, 14]).event.result, RESULTS.FB);
});

test("the first base coach's green light is +1 on the steal, for Speed A runners only", () => {
  const green = (speed, coaches = [coach("coach-green-light")]) => {
    const state = createInitialState(makeTeam("away", { coaches }), makeTeam("home", { fielding: 1 }));
    state.bases[0] = { id: "runner", name: "Runner", speed };
    return state;
  };
  const fast = stealCandidates(green(20))[0];
  assert.equal(fast.coachBonus, 1);
  assert.equal(fast.target, 21);
  assert.equal(stealCandidates(green(SPEED_A_MINIMUM))[0].coachBonus, 1);
  assert.equal(stealCandidates(green(SPEED_A_MINIMUM - 1))[0].coachBonus, 0);
  assert.equal(stealCandidates(green(20, []))[0].coachBonus, 0);
  // Against a +1 catcher and a natural 20: 21 beats a target of 20 and ties a
  // target of 21. With the coach the runner is safe (uncontested, even); without
  // him the throw gets him.
  const coached = attemptSteal(green(20), 0, dice(20));
  assert.equal(coached.result, "SB");
  assert.equal(coached.playDetails.stealAttempt.coachBonus, 1);
  const plain = attemptSteal(green(20, []), 0, dice(20));
  assert.equal(plain.result, "CS");
});

test("the outfield coach's arm is +1 on every throw from the outfield", () => {
  const tagUp = (coaches) => {
    const state = createInitialState(makeTeam("away"), makeTeam("home", { coaches }));
    state.bases[2] = { id: "runner", name: "Runner", speed: 12 };
    state.deferAdvancesFor = "away";
    applyFlyout(state, state.away.lineup[0], "away", "home", dice(1));
    return state.pendingAdvance.candidates[0];
  };
  assert.equal(tagUp([]).fielding, 0);
  const coached = tagUp([coach("coach-cannon-arms")]);
  assert.equal(coached.fielding, 1);
  assert.equal(coached.safeChance, (17 - 1) / 20);
});

test("a season with coaches in it is deterministic", () => {
  const { draft } = coachRoom(3, seedDealing("coach-season", ["coach-late-innings", "coach-wild-card"], { managerCount: 3 }));
  for (const id of ["coach-late-innings", "coach-wild-card"]) {
    while (currentManager(draft).id !== draft.managers[0].id) autopick(draft);
    pickPlayer(draft, id);
  }
  while (!draft.complete) autopick(draft);
  const ana = draft.managers[0];
  applyDraftAction(draft, { type: "coach-target", managerId: ana.id, coachId: "coach-wild-card", playerId: ana.roster.find((card) => card.kind === "hitter").id });
  const teams = draft.managers.map((manager) => buildTeam(manager, { optimize: true }));
  const first = simulateBatch(teams, { seed: "coach-season", runs: 12 });
  const second = simulateBatch(teams, { seed: "coach-season", runs: 12 });
  assert.deepEqual(first, second);
  assert.equal(first.teams.reduce((sum, row) => sum + row.games, 0), 24);
});

test("the catching coach frames a two-out tie for the pitcher", () => {
  // 6 + 4 lands exactly on an on-base of 10: the tie the hitter has always won.
  const rolls = [6, 5];
  const home = makeTeam("home", { coaches: [coach("coach-framing")] });
  const noOuts = playFirstBatter(makeTeam("away"), home, rolls);
  assert.equal(noOuts.event.chartOwner, "hitter");
  assert.deepEqual(noOuts.event.coachNotes, []);
  const twoOuts = playFirstBatter(makeTeam("away"), home, rolls, (state) => { state.outs = 2; });
  assert.equal(twoOuts.event.chartOwner, "pitcher");
  assert.equal(twoOuts.event.result, RESULTS.SO);
  assert.deepEqual(twoOuts.event.coachNotes, ["Framing: tie to the pitcher"]);
  // Not a tie: nothing to frame. No coach: the tie is the hitter's.
  assert.deepEqual(playFirstBatter(makeTeam("away"), home, [7, 5], (state) => { state.outs = 2; }).event.coachNotes, []);
  assert.equal(playFirstBatter(makeTeam("away"), makeTeam("home"), rolls, (state) => { state.outs = 2; }).event.chartOwner, "hitter");
});

test("the platoon coach's on-base bonus lands on right-handed bats against lefties", () => {
  // 7 + 4 = 11 clears an on-base of 10, but not one the coach has made 11.
  const rolls = [7, 5];
  const lefty = makeTeam("home", { throws: "L" });
  const boosted = playFirstBatter(makeTeam("away", { bats: "R", coaches: [coach("coach-platoon")] }), lefty, rolls);
  assert.equal(boosted.event.onBaseBonus, 1);
  assert.equal(boosted.event.onBase, 11);
  assert.equal(boosted.event.chartOwner, "hitter");
  assert.deepEqual(boosted.event.coachNotes, ["Platoon +1 on-base"]);
  assert.equal(playFirstBatter(makeTeam("away", { bats: "S", coaches: [coach("coach-platoon")] }), lefty, rolls).event.onBaseBonus, 1, "a switch hitter turns around");
  assert.equal(playFirstBatter(makeTeam("away", { bats: "L", coaches: [coach("coach-platoon")] }), lefty, rolls).event.onBaseBonus, 0, "lefty on lefty is no platoon");
  assert.equal(playFirstBatter(makeTeam("away", { bats: "R", coaches: [coach("coach-platoon")] }), makeTeam("home", { throws: "R" }), rolls).event.onBaseBonus, 0);
  const plain = playFirstBatter(makeTeam("away", { bats: "R" }), lefty, rolls);
  assert.equal(plain.event.chartOwner, "pitcher");
  assert.equal(plain.event.onBase, 10);
});

test("the contact coach turns every hitter's lowest strikeout face into a ground ball", () => {
  const chart = [
    { from: 1, to: 2, result: RESULTS.SO },
    { from: 3, to: 10, result: RESULTS.SINGLE },
    { from: 11, to: 20, result: RESULTS.HR }
  ];
  const away = makeTeam("away", { chart, coaches: [coach("coach-contact")] });
  const state = createInitialState(away, makeTeam("home"));
  assert.deepEqual(state.away.lineup[0].chart.slice(0, 2), [
    { from: 1, to: 1, result: RESULTS.GB },
    { from: 2, to: 2, result: RESULTS.SO }
  ]);
  assert.deepEqual(away.lineup[0].chart, chart, "the drafted card is untouched");
  // 1 + 4 is the batter's chart; a 1 was a strikeout and is now a ground ball.
  assert.equal(playPlateAppearance(state, dice(1, 1)).result, RESULTS.GB);
  assert.equal(playFirstBatter(makeTeam("away", { chart }), makeTeam("home"), [1, 1]).event.result, RESULTS.SO);
});

test("the clutch gene carries a natural 20 past the die", () => {
  const chart = [
    { from: 1, to: 10, result: RESULTS.SINGLE },
    { from: 11, to: 20, result: RESULTS.DOUBLE },
    { from: 21, to: Infinity, result: RESULTS.HR }
  ];
  const away = makeTeam("away", { chart, coaches: [coach("coach-clutch-gene")] });
  const twenty = playFirstBatter(away, makeTeam("home"), [1, 20]);
  assert.equal(twenty.event.swingBonus, 2);
  assert.equal(twenty.event.swingRoll, 22);
  assert.equal(twenty.event.result, RESULTS.HR);
  assert.deepEqual(twenty.event.coachNotes, ["Clutch Gene +2 swing"]);
  assert.equal(playFirstBatter(away, makeTeam("home"), [1, 19]).event.swingBonus, 0, "a 19 is a 19");
  assert.equal(playFirstBatter(makeTeam("away", { chart }), makeTeam("home"), [1, 20]).event.result, RESULTS.DOUBLE, "without him the 21+ row is out of reach");
});

test("the rotation coach hands the ace three starts in five", () => {
  const club = (coaches) => {
    const team = makeTeam("away", { coaches });
    const ace = { ...team.pitchers[0], id: "away-ace", name: "Ace", points: 500 };
    const other = { ...team.pitchers[0], id: "away-other", name: "Other", points: 100 };
    return { ...team, starters: [other, ace], bullpen: [], pitchers: [other] };
  };
  assert.equal(aceStarterIndex(club([]).starters), 1);
  const aceShare = (coaches, games = 200) => {
    const played = replayBatchGames([club(coaches), makeTeam("home")], "rotation-seed", 0, games);
    const starts = played.filter(({ game }) => (game.away.name === "away" ? game.away : game.home).pitchers[0].id === "away-ace").length;
    return starts / games;
  };
  const coached = aceShare([coach("coach-rotation")]);
  assert.ok(coached > ROTATION_ACE_SHARE - 0.08 && coached < ROTATION_ACE_SHARE + 0.08, `the ace started ${coached} of the games`);
  const plain = aceShare([]);
  assert.ok(plain > 0.38 && plain < 0.62, `without him the ace started ${plain} of the games`);
});

test("old school turns two and never runs", () => {
  // The club does not run: a certain steal is not attempted, offered, or taken.
  const runners = createInitialState(makeTeam("away", { coaches: [coach("coach-old-school")] }), makeTeam("home"));
  runners.bases[0] = { id: "runner", name: "Runner", speed: 20 };
  assert.deepEqual(stealCandidates(runners), []);
  assert.equal(playStealAttempt(runners, dice(20)), null);
  assert.equal(attemptSteal(runners, 0, dice(20)), null);
  const free = createInitialState(makeTeam("away"), makeTeam("home"));
  free.bases[0] = { id: "runner", name: "Runner", speed: 20 };
  assert.equal(stealCandidates(free).length, 1);
  // Turn two: the double-play total carries the +1, and here it is the out.
  const twoOn = (coaches) => {
    const state = createInitialState(makeTeam("away"), makeTeam("home", { coaches }));
    state.bases[0] = { id: "runner", name: "Runner", speed: 12 };
    applyGroundout(state, state.away.lineup[0], "away", "home", dice(12));
    return state.lastPlayDetails.doublePlayAttempt;
  };
  const coached = twoOn([coach("coach-old-school")]);
  assert.equal(coached.fielding, 1);
  assert.equal(coached.batterOut, true);
  const plain = twoOn([]);
  assert.equal(plain.fielding, 0);
  assert.equal(plain.batterOut, false);
});

// ---- the sweep ----------------------------------------------------------------
//
// Every coach, on every kind of card set, through real games: nothing throws,
// every result is a printed result, and a swing pushed off the die reads the
// row the card prints for it — the 20's row when the chart stops at 20, the
// printed 21+ row when the old card has one.

const SWEEP_SETS = ["classic", "mlb-history", "fictional", "decade-1920", "franchise-SEA"];
const VALID_RESULTS = new Set(Object.values(RESULTS));

// Hand a manager a staff — any coaches, dealt to his board or not — and name
// the Wild Card's man: heads on an odd-sized staff, tails on an even one.
function staffed(manager, coachIds) {
  const roster = manager.roster.filter((card) => !isCoach(card));
  const coaches = coachIds.map((id) => coachById(id));
  const bat = roster.find((card) => card.kind === "hitter");
  const wild = coaches.find((card) => needsCoachTarget(card));
  return {
    ...manager,
    roster: [...roster, ...coaches],
    coachTargets: wild ? { [wild.id]: { playerId: bat.id, swing: coachIds.length % 2 ? 1 : -1 } } : {}
  };
}

// The row each swing read, checked against the runtime card the game says it
// was read on — whose chart already carries Punchouts' and Contact's edits.
function checkSwings(game, tally) {
  const sides = { away: game.away, home: game.home };
  for (const event of game.events) {
    if (event.type === "steal" || typeof event.resultRoll !== "number") continue;
    assert.ok(VALID_RESULTS.has(event.result), `${event.result} is a result`);
    const battingSide = event.half === "top" ? "away" : "home";
    const pitchingSide = battingSide === "away" ? "home" : "away";
    const card = event.chartOwner === "pitcher"
      ? sides[pitchingSide].pitchers.find((arm) => arm.id === event.pitcherId)
      : sides[battingSide].lineup.find((bat) => bat.id === event.batterId);
    if (!card) continue;
    const roll = event.swingRoll ?? event.resultRoll;
    assert.equal(event.result, event.swingBonus ? resolveSwing(card.chart, roll) : resolveChart(card.chart, roll), `${card.name} at ${roll}`);
    if (roll > 20) {
      tally.past20 += 1;
      const printed = card.chart.find((row) => roll >= row.from && roll <= (Number.isFinite(row.to) ? row.to : Infinity));
      const topRow = card.chart.reduce((top, row) => (row.from > top.from ? row : top));
      const expected = printed ? printed.result : topRow.from <= 20 ? resolveChart(card.chart, 20) : topRow.result;
      assert.equal(event.result, expected, `a ${roll} on ${card.name}`);
      if (!printed) tally.readAsTwenty += 1;
    }
    if (roll < 1) {
      tally.underOne += 1;
      assert.equal(event.result, resolveChart(card.chart, 1), `a ${roll} on ${card.name} reads the 1`);
    }
  }
}

test("every coach, on every kind of card set, plays whole seasons without breaking a game", () => {
  const tally = { games: 0, past20: 0, readAsTwenty: 0, underOne: 0 };
  for (const mode of SWEEP_SETS) {
    const seed = `sweep-${mode}`;
    const pool = buildDraftPool(mode, seed, { managerCount: 3, coaches: true });
    const draft = createDraft(["A", "B", "C"], pool, 13, seed);
    while (!draft.complete) autopick(draft);
    const everyone = COACHES.map((coach) => coach.id);
    const configs = [
      ...COACHES.map((coach) => [[coach.id], []]),
      [everyone, []],
      [everyone, everyone]
    ];
    configs.forEach(([aIds, bIds], index) => {
      const teams = [staffed(draft.managers[0], aIds), staffed(draft.managers[1], bIds), draft.managers[2]]
        .map((manager) => buildTeam(manager, { optimize: true }));
      const names = teams.map((team) => team.name);
      for (const { game } of replayBatchGames(teams, `${seed}-${index}`, 0, 30)) {
        tally.games += 1;
        assert.ok(names.includes(game.winner), `${mode}: ${game.winner} won`);
        checkSwings(game, tally);
      }
    });
  }
  assert.ok(tally.games >= 2000, `${tally.games} games`);
  assert.ok(tally.past20 > 0, "swings were pushed past the die");
  assert.ok(tally.readAsTwenty > 0, "on charts that stop at 20, they read the 20");
  assert.ok(tally.underOne > 0, "swings were pushed under the die");
});

test("on the old cards a pushed swing reads the 20 where the chart stops, and the printed 21+ row where it doesn't", () => {
  setUniverse("boundary", "classic", { priceNoise: false });
  const stopsAt20 = (card) => card.chart.every((row) => Number.isFinite(row.to) && row.to <= 20);
  const printsPast20 = (card) => card.chart.some((row) => row.from > 20);
  const pool = universePool();
  const cappedBat = pool.find((card) => card.kind === "hitter" && stopsAt20(card));
  const cappedArm = pool.find((card) => card.kind === "pitcher" && stopsAt20(card));
  const deepArm = pool.find((card) => card.kind === "pitcher" && printsPast20(card) && card.chart.some((row) => row.from === 21));
  const deepBat = pool.find((card) => card.kind === "hitter" && printsPast20(card));
  assert.ok(cappedBat && cappedArm && deepArm && deepBat, "the classic set prints both kinds of chart");
  assert.equal(cardById(cappedBat.id), cappedBat);

  const batting = (card, coaches, setup, rolls) => {
    const away = makeTeam("away", { coaches });
    away.lineup[0] = { ...card, defensivePosition: "C" };
    return playFirstBatter(away, makeTeam("home"), rolls, setup ?? (() => {})).event;
  };
  const pitching = (card, coaches, setup, rolls) => {
    const home = makeTeam("home");
    home.pitchers = [{ ...card }];
    return playFirstBatter(makeTeam("away", { coaches }), home, rolls, setup ?? (() => {})).event;
  };
  const ninthTied = (state) => { state.inning = 9; };

  // A chart that stops at 20: the Clutch Gene's 22 and the hitting coach's 21
  // both read the 20's row. Nothing throws, nothing invents a row.
  const clutch = batting(cappedBat, [coach("coach-clutch-gene")], null, [1, 20]);
  assert.equal(clutch.swingRoll, 22);
  assert.equal(clutch.result, resolveChart(cappedBat.chart, 20), cappedBat.name);
  const late = batting(cappedBat, [coach("coach-late-innings")], ninthTied, [1, 20]);
  assert.equal(late.swingRoll, 21);
  assert.equal(late.result, resolveChart(cappedBat.chart, 20), cappedBat.name);
  // Pushed under the die, it reads the 1's row.
  const under = batting(cappedBat, [coach("coach-wild-card", { playerId: cappedBat.id, swing: -1 })], null, [1, 1]);
  assert.equal(under.swingRoll, 0);
  assert.equal(under.result, resolveChart(cappedBat.chart, 1), cappedBat.name);
  // The same on a pitcher's chart that stops at 20, read when the arm wins the pitch.
  const armCapped = pitching(cappedArm, [coach("coach-late-innings")], ninthTied, [20, 20]);
  assert.equal(armCapped.chartOwner, "pitcher");
  assert.equal(armCapped.swingRoll, 21);
  assert.equal(armCapped.result, resolveChart(cappedArm.chart, 20), cappedArm.name);

  // A chart that prints a 21+ row: the +1 reaches it, which no bare die could.
  const armDeep = pitching(deepArm, [coach("coach-late-innings")], ninthTied, [20, 20]);
  assert.equal(armDeep.chartOwner, "pitcher");
  const row21 = deepArm.chart.find((row) => row.from === 21);
  assert.equal(armDeep.result, row21.result, `${deepArm.name}'s printed 21+ row`);
  // A bare 20 stops at the 20's row, which is not that row.
  assert.equal(pitching(deepArm, [], null, [20, 20]).result, resolveChart(deepArm.chart, 20));
  assert.notEqual(row21.result, resolveChart(deepArm.chart, 20), `${deepArm.name} prints something past the die`);
  const batDeep = batting(deepBat, [coach("coach-clutch-gene")], null, [1, 20]);
  assert.equal(batDeep.result, resolveSwing(deepBat.chart, 22), `${deepBat.name} at 22`);
});

test("the interactive game runs two fully coached clubs to the final out", () => {
  const { draft } = coachRoom(2, "battle-coaches");
  while (!draft.complete) autopick(draft);
  const everyone = COACHES.map((coach) => coach.id);
  const battle = createBattle({
    playerManager: staffed(draft.managers[0], everyone),
    npcManager: staffed(draft.managers[1], everyone),
    seed: "battle-coaches"
  });
  // The autopilot first, then every phase by hand, the way the screen does it.
  fastForward(battle, { maxEvents: 200 });
  let guard = 4000;
  while (battlePhase(battle).type !== "over" && guard > 0) {
    guard -= 1;
    const phase = battlePhase(battle);
    if (phase.type === "player-batting") {
      // Old School: the club never runs, so the screen is never offered a steal.
      assert.deepEqual(phase.stealOptions, []);
      actSwing(battle);
    } else if (phase.type === "player-pitching") {
      actPitch(battle);
    } else if (phase.type === "advance-decision") {
      actAdvance(battle, phase.pending.autoSend ?? 0);
    } else if (phase.type === "realign") {
      actAcceptRealign(battle);
    } else {
      throw new Error(`unexpected phase ${phase.type}`);
    }
  }
  const final = battlePhase(battle);
  assert.equal(final.type, "over");
  assert.ok(guard > 0, "the game ended on its own");
  assert.ok(battle.events.some((event) => event.coachNotes?.length), "the coaches showed up in the game");
});

// ---- the room ----------------------------------------------------------------

async function startServer(t) {
  const roomsDir = await mkdtemp(join(tmpdir(), "showdown-coaches-"));
  const { server } = createOnlineServer({ dataDir: roomsDir });
  server.listen(0);
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => server.close());
  return base;
}

async function api(base, method, path, body) {
  const response = await fetch(base + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

test("an online room deals its coaches, replays them, and gates the Wild Card's pick", async (t) => {
  const base = await startServer(t);
  const seed = seedDealing("online-coaches", ["coach-wild-card"], { universe: "fictional" });
  const created = await api(base, "POST", "/api/rooms", { seed, managers: ["Ana", "Bo"], coaches: true });
  assert.equal(created.status, 201);
  assert.equal(created.data.coaches, true);
  const roomId = created.data.roomId;

  const ana = await api(base, "POST", `/api/rooms/${roomId}/join`, { managerId: "team-1", hostToken: created.data.hostToken });
  const bo = await api(base, "POST", `/api/rooms/${roomId}/join`, { managerId: "team-2" });
  // The board is hidden until every seat is taken; now it is.
  const seated = await api(base, "GET", `/api/rooms/${roomId}`);
  const deckCoaches = seated.data.deck.filter((entry) => entry?.slot === "COACH");
  assert.equal(deckCoaches.length, COACHES_PER_BOARD);
  assert.ok(deckCoaches.some((entry) => entry.id === "coach-wild-card"));
  const pick = await api(base, "POST", `/api/rooms/${roomId}/actions`, { token: ana.data.token, action: { type: "pick", playerId: "coach-wild-card" } });
  assert.equal(pick.status, 200);

  // Bo cannot answer Ana's coach; nobody can answer before the draft is done
  // either, because Ana has no hitter yet.
  const notHis = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: bo.data.token,
    action: { type: "coach-target", managerId: "team-1", coachId: "coach-wild-card", playerId: "nobody" }
  });
  assert.equal(notHis.status, 409);
  assert.match(notHis.data.error, /own coach/i);

  const finish = await api(base, "POST", `/api/rooms/${roomId}/actions`, { token: ana.data.token, action: { type: "finish" } });
  assert.equal(finish.status, 200);

  const room = await api(base, "GET", `/api/rooms/${roomId}`);
  assert.equal(room.data.complete, true);
  const rebuild = () => {
    const pool = deckFromIds(room.data.universe, room.data.seed, room.data.deck);
    const replica = createDraft(room.data.managers.map((manager) => manager.name), pool, room.data.rosterSize, room.data.seed);
    for (const entry of room.data.actions) applyDraftAction(replica, entry.action);
    return replica;
  };
  const replica = rebuild();
  assert.equal(replica.coaches, true);
  assert.equal(rosterCoaches(replica.managers[0]).length, 1);
  assert.equal(rosterPlayerCount(replica.managers[0]), 13);
  assert.equal(rosterPlayerCount(replica.managers[1]), 13);

  const bat = replica.managers[0].roster.find((card) => card.kind === "hitter");
  const named = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: ana.data.token,
    action: { type: "coach-target", managerId: "team-1", coachId: "coach-wild-card", playerId: bat.id }
  });
  assert.equal(named.status, 200);
  const again = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: ana.data.token,
    action: { type: "coach-target", managerId: "team-1", coachId: "coach-wild-card", playerId: bat.id }
  });
  assert.equal(again.status, 409);
  assert.match(again.data.error, /already made his pick/);

  const after = await api(base, "GET", `/api/rooms/${roomId}`);
  const pool = deckFromIds(after.data.universe, after.data.seed, after.data.deck);
  const final = createDraft(after.data.managers.map((manager) => manager.name), pool, after.data.rosterSize, after.data.seed);
  for (const entry of after.data.actions) applyDraftAction(final, entry.action);
  assert.deepEqual(final.managers[0].coachTargets["coach-wild-card"], {
    playerId: bat.id,
    swing: coachFlip(after.data.seed, "team-1", "coach-wild-card", bat.id)
  });
});
