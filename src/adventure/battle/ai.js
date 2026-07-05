import { stealCandidates, attemptSteal, pitcherStatus, changePitcher } from "../../rules/game.js";

// Profiles are threshold tables over the two NPC decisions: how sure a runner
// must be to go, and how much fatigue the skipper tolerates before pulling
// the pitcher.
export const AI_PROFILES = {
  balanced: { stealChance: 0.75, pullAtFatigue: 2 },
  aggressive: { stealChance: 0.62, pullAtFatigue: 3 },
  conservative: { stealChance: 0.85, pullAtFatigue: 1 }
};

export function profileFor(name) {
  return AI_PROFILES[name] ?? AI_PROFILES.balanced;
}

// Called before an NPC plate appearance. Returns the steal event if the NPC
// sends a runner, else null.
export function npcMaybeSteal(state, rng, profile) {
  const candidates = stealCandidates(state);
  if (!candidates.length) return null;
  const best = [...candidates].sort((a, b) => b.safeChance - a.safeChance || b.toIndex - a.toIndex)[0];
  if (best.safeChance < profile.stealChance) return null;
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
