import { stealCandidates, attemptSteal, advanceDecisionMinimum, pitcherStatus, autoRelieve, AUTO_PULL_MARGIN } from "../game.js?v=20260714-b";

// Profiles bend the two NPC decisions: stealBias shifts the league's
// advance-decision matrix (negative = greener lights) rather than replacing it,
// and pullMargin is how much BETTER the pen has to be before the skipper walks
// out there — measured in runs per plate appearance, the currency reliefDecision
// thinks in.
//
// It used to be pullAtFatigue, a tiredness threshold, and a temperament
// expressed that way could only ever choose between two wrong answers. This one
// says the true thing about a manager: not how tired he lets a man get, but how
// sure he has to be that the other guy is better. The aggressive skipper trusts
// his starter and wants a real upgrade before he moves; the conservative one has
// a quick hook and takes any upgrade going.
export const AI_PROFILES = {
  balanced: { stealBias: 0, pullMargin: AUTO_PULL_MARGIN },
  aggressive: { stealBias: -0.12, pullMargin: 3 },
  conservative: { stealBias: 0.1, pullMargin: 1 }
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
// the NPC makes a change, else null. The mound is under manual control for the
// NPC (see currentPitcher), so the skipper has to make this call himself — but
// he makes it with the same head the simulator uses, only more or less patient.
export function npcMaybePullPitcher(state, npcSide, profile) {
  const status = pitcherStatus(state, npcSide);
  if (!status.hasReliefAvailable) return null;
  return autoRelieve(state, npcSide, profile.pullMargin ?? AUTO_PULL_MARGIN);
}
