import { adventurePool } from "./packs.js";
import { createRng } from "../rules/rng.js";

// One roster slot per required lineup spot plus the four-man staff. "HITTER"
// is the DH: any bat qualifies.
const HITTER_SLOTS = ["C", "1B", "2B", "3B", "SS", "LF/RF", "LF/RF", "CF", "HITTER"];
const PITCHER_SLOTS = ["SP", "SP", "RP", "RP"];

// Archetype scoring biases which card wins a slot; the greedy budget keeps
// the roster legal and affordable either way.
const ARCHETYPES = {
  balanced: (card) => card.points,
  contact: (card) => (card.kind === "hitter" ? card.onBase * 30 + card.points * 0.2 : card.points),
  speed: (card) => (card.kind === "hitter" ? card.speed * 25 + card.points * 0.3 : card.points),
  power: (card) => (card.kind === "hitter" ? chartSlots(card, "HR") * 90 + card.points * 0.4 : card.points),
  ace: (card) => (card.kind === "pitcher" ? card.points * 2 : card.points)
};

function chartSlots(card, result) {
  return card.chart.reduce((sum, row) => sum + (row.result === result ? row.to - row.from + 1 : 0), 0);
}

function slotMatches(slot, card) {
  if (slot === "HITTER") return card.kind === "hitter";
  if (slot === "SP" || slot === "RP") return card.role === slot;
  return card.kind === "hitter" && card.position === slot;
}

// Greedy under budget: fill slots one at a time, always leaving enough budget
// to cover the remaining slots with the cheapest unused fits, and spend the
// rest of the room on the best archetype fit. Ace staffs shop for pitching
// first so the budget lands on the mound.
export function buildNpcTeam(trainer) {
  const pool = adventurePool();
  const score = ARCHETYPES[trainer.archetype] ?? ARCHETYPES.balanced;
  const rng = createRng(`npc-team:${trainer.teamSeed}`);
  const slots = trainer.archetype === "ace"
    ? [...PITCHER_SLOTS, ...HITTER_SLOTS]
    : [...HITTER_SLOTS, ...PITCHER_SLOTS];

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

  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    const reserve = reserveFor(slots.slice(index + 1));
    const room = trainer.pointBudget - spent - reserve;
    const fits = unusedFits(slot);
    const affordable = fits.filter((card) => card.points <= room);
    const candidates = (affordable.length ? affordable : fits.sort((a, b) => a.points - b.points).slice(0, 1))
      .sort((a, b) => score(b) - score(a) || a.points - b.points || a.name.localeCompare(b.name));
    // A pinch of seeded variety among near-equal picks so trainers sharing an
    // archetype don't field carbon-copy teams.
    const pick = candidates[Math.min(candidates.length - 1, rng.int(0, Math.min(2, candidates.length - 1)))];
    if (!pick) throw new Error(`NPC team for ${trainer.id} cannot fill ${slot}`);
    used.add(pick.id);
    roster.push(pick);
    spent += pick.points;
  }

  return {
    id: trainer.id,
    name: trainer.name,
    roster,
    lineupAssignments: {},
    points: spent
  };
}
