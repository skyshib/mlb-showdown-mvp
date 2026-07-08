import { adventurePool } from "./packs.js";
import { npcBudget } from "./region.js";
import { createRng } from "../rules/rng.js";

// One roster slot per required lineup spot plus the four-man staff. "HITTER"
// is the DH: any bat qualifies.
const HITTER_SLOTS = ["C", "1B", "2B", "3B", "SS", "LF/RF", "LF/RF", "CF", "HITTER"];
const PITCHER_SLOTS = ["SP", "SP", "RP", "RP"];

// Archetype scoring biases which card wins a slot; the greedy budget keeps
// the roster legal and affordable either way. Scoring reads TRUE value, not
// the noisy printed price — trainers scout talent, then pay the sticker.
const ARCHETYPES = {
  balanced: (card) => worth(card),
  contact: (card) => (card.kind === "hitter" ? card.onBase * 30 + worth(card) * 0.2 : worth(card)),
  speed: (card) => (card.kind === "hitter" ? card.speed * 25 + worth(card) * 0.3 : worth(card)),
  power: (card) => (card.kind === "hitter" ? chartSlots(card, "HR") * 90 + worth(card) * 0.4 : worth(card)),
  ace: (card) => (card.kind === "pitcher" ? worth(card) * 2 : worth(card))
};

function worth(card) {
  return card.truePoints ?? card.points;
}

function chartSlots(card, result) {
  return card.chart.reduce((sum, row) => sum + (row.result === result ? row.to - row.from + 1 : 0), 0);
}

function slotMatches(slot, card) {
  if (slot === "HITTER") return card.kind === "hitter";
  if (slot === "SP" || slot === "RP") return card.role === slot;
  return card.kind === "hitter" && card.position === slot;
}

// Greedy under budget: fill slots one at a time, always leaving enough budget
// to cover the remaining slots with the cheapest unused fits, and spend most of
// the room on the best archetype fit. Early slots see the most room, so the
// fill ORDER is shuffled per trainer — which position lands the star is part of
// the trainer's identity, not always the catcher. Ace staffs still shop for
// pitching first so the budget lands on the mound.
// Pass the save so mode scaling applies (uncapped bosses shop richer);
// without one the printed budget stands. Team identity (seeded slot order,
// weights, picks) only shifts when the budget itself does.
export function buildNpcTeam(trainer, save = null) {
  const pool = adventurePool();
  const pointBudget = npcBudget(save, trainer);
  const score = ARCHETYPES[trainer.archetype] ?? ARCHETYPES.balanced;
  const rng = createRng(`npc-team:${trainer.teamSeed}`);
  const slots = trainer.archetype === "ace"
    ? [...shuffled(PITCHER_SLOTS, rng), ...shuffled(HITTER_SLOTS, rng)]
    : shuffled([...HITTER_SLOTS, ...PITCHER_SLOTS], rng);

  const used = new Set();
  const roster = [];
  let spent = 0;

  const unusedFits = (slot) => pool.filter((card) => !used.has(card.id) && slotMatches(slot, card));

  const reserveFor = (remainingSlots) => {
    const reserved = new Set();
    let total = 0;
    for (const slot of remainingSlots) {
      const cheapest = pool
        .filter((card) => !used.has(card.id) && !reserved.has(card.id) && slotMatches(slot, card))
        .sort((a, b) => a.points - b.points)[0];
      if (!cheapest) return Infinity;
      reserved.add(cheapest.id);
      total += cheapest.points;
    }
    return total;
  };

  // Every slot gets its own share of the budget up front, drawn from a
  // bounded band (~0.7-1.6x an even split) so rosters read like real teams —
  // a couple of headliners, a solid middle, role players — instead of one
  // mega star and twelve minimum bids. Unspent allocation rolls forward.
  const weights = slots.map(() => 0.7 + rng.next() * 0.9);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  let carry = 0;

  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    const reserve = reserveFor(slots.slice(index + 1));
    const room = pointBudget - spent - reserve;
    const allocation = (pointBudget * weights[index]) / weightTotal + carry;
    const target = Math.max(0, Math.min(allocation, room));
    const fits = unusedFits(slot);
    // Shop near the slot's allocation first; widen to anything affordable,
    // then to the cheapest legal fill, only if the band comes up empty.
    let candidates = fits.filter((card) => card.points <= Math.min(room, target * 1.25) && card.points >= target * 0.5);
    if (!candidates.length) candidates = fits.filter((card) => card.points <= room);
    if (!candidates.length) candidates = [...fits].sort((a, b) => a.points - b.points).slice(0, 1);
    candidates = [...candidates].sort((a, b) => score(b) - score(a) || a.points - b.points || a.name.localeCompare(b.name));
    // A pinch of seeded variety among near-equal picks so trainers sharing an
    // archetype don't field carbon-copy teams.
    const pick = candidates[Math.min(candidates.length - 1, rng.int(0, Math.min(2, candidates.length - 1)))];
    if (!pick) throw new Error(`NPC team for ${trainer.id} cannot fill ${slot}`);
    used.add(pick.id);
    roster.push(pick);
    spent += pick.points;
    carry = allocation - pick.points;
  }

  // Present (and bat) the squad best-first: hitters by printed points, then
  // pitchers by printed points, so the top starter also opens game 1.
  const byPoints = (a, b) => b.points - a.points || a.name.localeCompare(b.name);
  const hitters = roster.filter((card) => card.kind === "hitter").sort(byPoints);
  const pitchers = roster.filter((card) => card.kind === "pitcher").sort(byPoints);

  return {
    id: trainer.id,
    name: trainer.name,
    roster: [...hitters, ...pitchers],
    lineupAssignments: {},
    battingOrder: hitters.map((card) => card.id),
    points: spent
  };
}

function shuffled(slots, rng) {
  const copy = [...slots];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
