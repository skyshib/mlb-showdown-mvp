import test from "node:test";
import assert from "node:assert/strict";
import {
  DECADES,
  FRANCHISES,
  UNIVERSES,
  buildDraftPool,
  cardById,
  installUniversePool,
  setUniverse,
  snapshotUniversePool,
  universeConfig,
  universeKey,
  universePool
} from "../src/data/universes.js";
import { autopick, createDraft, maxPoolManagers, validateRoster } from "../src/rules/draft.js";
import { battlePhase, createBattle, fastForward } from "../src/rules/battle/controller.js";
import { personConflict } from "../src/rules/cards.js";

// The card sets a draft room can pick, one of each shape: the two fixed real
// sets, the fictional league, a decade, a multi-decade union, and a franchise
// (the smallest pool in the game, so it is the one most likely to run dry).
const MODES = [
  "classic",
  "mlb-history",
  "fictional",
  "decade-1950",
  "decades-2000,2010",
  "franchise-ARI"
];

test("every card set the setup screen offers resolves to a universe", () => {
  for (const key of Object.keys(UNIVERSES)) {
    assert.equal(universeConfig(key)?.key, key);
  }
  for (const franchise of FRANCHISES) {
    assert.ok(universeConfig(`franchise-${franchise.id}`), `no universe for ${franchise.id}`);
  }
  for (const start of DECADES) {
    assert.ok(universeConfig(`decade-${start}`), `no universe for the ${start}s`);
  }
  assert.ok(universeConfig(`decades-${DECADES.join(",")}`), "every decade at once is a universe");
  assert.equal(universeConfig("franchise-SPACE-JAM"), null);
  assert.equal(universeConfig(""), null);
});

test("the draft deck deals the same cards from the same seed, and different cards from another", () => {
  const a = buildDraftPool("classic", "night-a");
  const b = buildDraftPool("classic", "night-b");
  assert.deepEqual(a, buildDraftPool("classic", "night-a"), "a seed is a deck");
  assert.notDeepEqual(
    a.map((card) => card.id),
    b.map((card) => card.id),
    "another seed is another deck"
  );
});

for (const mode of MODES) {
  test(`the ${mode} deck seats eight managers and reads like its league`, () => {
    const deck = buildDraftPool(mode, "coefficient-classic");

    assert.ok(maxPoolManagers(deck) >= 8, `${mode} only seats ${maxPoolManagers(deck)} managers`);

    // The board is a slice of the league, so it is made of what the league is
    // made of. Nothing guarantees a star on any one board — the draw is
    // straight random within a position — but a set whose cards are 7% legends
    // deals boards that are about 7% legends, and mostly role players, because
    // that is what the set is.
    const share = (cards, tier) => cards.filter((card) => card.rarity === tier).length / cards.length;
    const pool = universePool();
    for (const tier of ["legend", "rare", "uncommon", "common"]) {
      assert.ok(
        Math.abs(share(deck, tier) - share(pool, tier)) < 0.12,
        `${mode}: the deck is ${(100 * share(deck, tier)).toFixed(0)}% ${tier} but the set is ${(100 * share(pool, tier)).toFixed(0)}%`
      );
    }

    // Every card is a real, playable card: a d20 chart and a printed price.
    for (const card of deck) {
      assert.ok(Array.isArray(card.chart) && card.chart.length, `${card.name} has no chart`);
      assert.ok(card.points > 0, `${card.name} has no points`);
    }
  });
}

test("draft rooms print honest stickers — no bargain noise, in any set", () => {
  for (const mode of MODES) {
    const deck = buildDraftPool(mode, "honest");
    for (const card of deck) {
      assert.equal(card.points, card.truePoints, `${mode}: ${card.name} is priced off its true value`);
    }
  }
});

test("an every-decade set prints a long career once per decade, and you may roster only one", () => {
  setUniverse("two-eras", `decades-${DECADES.join(",")}`, { priceNoise: false });
  const pool = universePool();
  const byPerson = new Map();
  for (const card of pool) {
    const person = /^mlb-d\d{4}-([^-]+)/.exec(card.id)?.[1];
    if (person) byPerson.set(person, [...(byPerson.get(person) ?? []), card]);
  }
  const [, careers] = [...byPerson].find(([, cards]) => cards.length > 1) ?? [];
  assert.ok(careers, "somebody should have played in more than one decade");

  // Both eras are in the pool; the roster rule is what stops you taking both.
  const [young, old] = careers;
  assert.ok(personConflict([young], old), "two decades of one man is a roster conflict");
  assert.equal(personConflict([young], young), null, "a card never conflicts with itself");
});

test("a snapshotted pool is served verbatim, not re-derived from the seed", () => {
  // An adventure save stores its cards so its universe never re-rolls when the
  // generators change. Prove the stored cards win over what the seed would build.
  setUniverse("frozen-save", "fictional", { priceNoise: true });
  const frozen = snapshotUniversePool();
  // Stand in for a generator change: the stored cards say something the seed
  // would never produce. If install re-derived, this edit would vanish.
  frozen[0] = { ...frozen[0], name: "FROZEN MARKER" };
  const markerId = frozen[0].id;

  // The generators move on — a different seed is a different league entirely.
  setUniverse("some-other-seed", "fictional", { priceNoise: true });
  assert.notEqual(cardById(markerId)?.name, "FROZEN MARKER", "a new seed really re-rolls the pool");

  // Installing the snapshot seats those exact cards again, drift and all.
  installUniversePool(frozen, { seed: "frozen-save", mode: "fictional", priceNoise: true });
  assert.equal(cardById(markerId).name, "FROZEN MARKER", "the stored card is served, not regenerated");
  assert.equal(universePool().length, frozen.length);
  assert.equal(universeKey(), "fictional", "and the mode is recorded so a matching setUniverse is a no-op");
});

test("the whole universe stays behind the deck, so a card can find its two-way other half", () => {
  setUniverse("ohtani", "mlb-history", { priceNoise: false });
  const pool = universePool();
  const bat = pool.find((card) => card.id.endsWith("-bat"));
  assert.ok(bat, "the all-time set prints two-way players");
  const arm = pool.find((card) => card.id === bat.id.slice(0, -4));
  assert.ok(arm, "and both halves are in the pool");
  assert.equal(arm.kind, "pitcher");
  assert.equal(bat.kind, "hitter");
});

// The interactive game the draft app plays is the adventure's battle engine.
// Two drafted rosters, autopilot on, all the way to a final score.
test("two drafted rosters play a full game on fast forward", () => {
  const pool = buildDraftPool("classic", "gameday");
  const draft = createDraft(["Kasey", "Milo"], pool, 13, "gameday");
  while (!draft.complete) autopick(draft);
  const [you, them] = draft.managers;
  assert.deepEqual(validateRoster(you), [], "the autopicked roster is legal");

  const battle = createBattle({
    playerManager: you,
    npcManager: them,
    trainer: { name: them.name, aiProfile: "balanced" },
    seed: "gameday:1"
  });

  let guard = 200;
  while (battlePhase(battle).type !== "over" && guard-- > 0) {
    fastForward(battle);
  }

  const phase = battlePhase(battle);
  assert.equal(phase.type, "over", "fast forward should reach a final");
  assert.notEqual(phase.score.home, phase.score.away, "somebody won it");
  assert.ok(battle.events.length > 40, "a nine-inning game is more than a handful of plays");
  assert.equal(typeof phase.playerWon, "boolean");
});

test("the same game seed replays the same game", () => {
  const pool = buildDraftPool("classic", "gameday");
  const draft = createDraft(["Kasey", "Milo"], pool, 13, "gameday");
  while (!draft.complete) autopick(draft);
  const [you, them] = draft.managers;

  const finalOf = () => {
    const battle = createBattle({ playerManager: you, npcManager: them, seed: "replay-me" });
    while (battlePhase(battle).type !== "over") fastForward(battle);
    return battlePhase(battle).score;
  };
  assert.deepEqual(finalOf(), finalOf());
});

// The board used to be a fixed 124 cards no matter how many managers sat down,
// which quietly capped a draft at nine — and no card set could lift it, because
// the deck never grew: ten thousand cards still dealt a 124-card board. The
// board is dealt to the ROOM now.
test("the deck grows with the room, so a big draft is not capped by the board", () => {
  for (const managerCount of [9, 10, 12, 16, 20]) {
    const deck = buildDraftPool("classic", "big-room", { managerCount });
    assert.ok(
      maxPoolManagers(deck) >= managerCount,
      `a ${managerCount}-manager room is dealt a board that only seats ${maxPoolManagers(deck)}`
    );
  }
});

// It grows only. A thinner board is a board with less choice on it, and a small
// room should not be punished for being small — it keeps the deep board it has
// always had, card for card. This is also what keeps every saved room's deal
// intact: a room of eight deals exactly what it dealt before the deck took a
// manager count at all.
test("a small room keeps the deep board, unchanged card for card", () => {
  const eight = buildDraftPool("classic", "night-a", { managerCount: 8 });
  for (const managerCount of [1, 2, 3, 5, 8]) {
    const deck = buildDraftPool("classic", "night-a", { managerCount });
    assert.deepEqual(
      deck.map((card) => card.id),
      eight.map((card) => card.id),
      `a ${managerCount}-manager room was dealt a different board`
    );
  }
  // And the deal with no manager count at all — what every old caller did — is
  // that same board.
  assert.deepEqual(
    buildDraftPool("classic", "night-a").map((card) => card.id),
    eight.map((card) => card.id)
  );
});
