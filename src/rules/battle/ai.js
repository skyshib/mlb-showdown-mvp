import { stealCandidates, attemptSteal, advanceDecisionMinimum, pitcherStatus, changePitcher } from "../game.js?v=20260713-o";

// Profiles bend the two NPC decisions: stealBias shifts the league's
// advance-decision matrix (negative = greener lights) rather than replacing
// it, and pullAtFatigue is how much tiredness the skipper tolerates before
// going to the pen.
export const AI_PROFILES = {
  balanced: { stealBias: 0, pullAtFatigue: 2 },
  aggressive: { stealBias: -0.12, pullAtFatigue: 3 },
  conservative: { stealBias: 0.1, pullAtFatigue: 1 }
};

export function profileFor(name) {
  return AI_PROFILES[name] ?? AI_PROFILES.balanced;
}

// Called before an NPC plate appearance. Returns the steal event if the NPC
// sends a runner, else null. The go/no-go bar is the same decision matrix
// auto play uses, shifted by the trainer's personality.
export function npcMaybeSteal(state, rng, profile) {
  const candidates = stealCandidates(state);
  if (!candidates.length) return null;
  const best = [...candidates].sort((a, b) => b.safeChance - a.safeChance || b.toIndex - a.toIndex)[0];
  const minimum = advanceDecisionMinimum(best.outsForDecision, best.destination) + (profile.stealBias ?? 0);
  if (best.safeChance < minimum) return null;
  return attemptSteal(state, best.fromIndex, rng);
}

// Called before the NPC's pitcher faces a batter. Returns the new pitcher if
// the NPC makes a change, else null.
export function npcMaybePullPitcher(state, npcSide, profile) {
  const status = pitcherStatus(state, npcSide);
  if (!status.hasReliefAvailable) return null;
  if (status.fatiguePenalty < profile.pullAtFatigue) return null;
  return changePitcher(state, npcSide);
}
