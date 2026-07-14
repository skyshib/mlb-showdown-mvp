import { stealCandidates, attemptSteal, advanceDecisionMinimum, pitcherStatus, autoRelieve, AUTO_PULL_BIAS } from "../game.js?v=20260714-k";

// Profiles bend the two NPC decisions: stealBias shifts the league's
// advance-decision matrix (negative = greener lights) rather than replacing it,
// and pullBias shifts the bar the pen has to clear before the skipper walks out
// there — in control points, the currency reliefDecision thinks in.
//
// It used to be pullAtFatigue, a tiredness threshold, and a temperament
// expressed that way could only ever choose between two wrong answers. This one
// says the true thing about a manager: not how tired he lets a man get, but how
// sure he has to be that the other guy is better. The aggressive skipper trusts
// his starter and wants a real upgrade before he moves; the conservative one has
// a quick hook and takes any upgrade going.
//
// It is a BIAS and not a bar because the bar itself now moves with the game —
// every skipper gets quicker with the hook as the outs run out (see pullMargin).
// What separates them is how much patience they bring to that slide, which is
// the thing that stays true about a man from the first inning to the ninth.
// Half a control point, and not a whole one. A temperament is a thumb on the
// scale, not a second opinion — and the place it was doing damage was the end of
// the game, where the sliding bar has come down to half a point and a full point
// of aggression is bigger than the bar it is bending. That is how an eleventh
// inning ends up with a control 2 arm on the mound and a control 4 arm warm: not
// because the skipper judged it, but because his personality outweighed the rule.
export const AI_PROFILES = {
  balanced: { stealBias: 0, pullBias: AUTO_PULL_BIAS },
  aggressive: { stealBias: -0.12, pullBias: 0.5 },
  conservative: { stealBias: 0.1, pullBias: -0.5 }
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
  return autoRelieve(state, npcSide, profile.pullBias ?? AUTO_PULL_BIAS);
}
