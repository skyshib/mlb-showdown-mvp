import test from "node:test";
import assert from "node:assert/strict";
import { buildRealPlayerPool } from "../src/data/realPlayers.js";
import { autopick, buildTeam, createDraft } from "../src/rules/draft.js";
import { createBatchState, measureRunEnvironment, simulateBatch } from "../src/rules/batch.js";

function draftRealTeams(seed, teamCount = 4) {
  const managers = Array.from({ length: teamCount }, (_, index) => `Team ${index + 1}`);
  const draft = createDraft(managers, buildRealPlayerPool(), 13, seed);
  while (!draft.complete) autopick(draft);
  return draft.managers.map((manager) => buildTeam(manager));
}

test("batch sims calibrate win probability to the drafted teams' run environment", () => {
  const teams = draftRealTeams("wp-calibration");
  const env = measureRunEnvironment(teams);

  assert.ok(env.runsPerHalf > 0.02 && env.runsPerHalf < 1.5, `runs per half looks unmeasured: ${env.runsPerHalf}`);
  assert.ok(env.varPerHalf >= 0.02, `variance per half looks unmeasured: ${env.varPerHalf}`);

  const state = createBatchState(teams);
  assert.deepEqual(state.wpEnv, env, "batch state carries the same seeded calibration");
});

// WPA is zero-sum between offense and defense per event, but a win-probability
// model promising a different run environment than the engine delivers would
// silently drain WPA from hitters to pitchers every half-inning. With the old
// hardcoded constants this drift measured about -0.19 per team-game and pushed
// closers past +20 WPA/162 while star hitters went negative. The normal
// projection keeps a known structural residual around -0.03; the threshold
// leaves room for that plus calibration noise, nothing more.
test("WPA does not systematically drain from hitters to pitchers", () => {
  const teams = draftRealTeams("wp-balance");
  const summary = simulateBatch(teams, { runs: 240, seed: "wp-balance" });

  const teamGames = summary.teams.reduce((sum, team) => sum + team.games, 0);
  const hitterWpa = summary.hitters.reduce((sum, line) => sum + line.wpa, 0);
  const driftPerTeamGame = hitterWpa / teamGames;
  assert.ok(
    Math.abs(driftPerTeamGame) < 0.07,
    `hitters as a class should hold near zero WPA, drifted ${driftPerTeamGame.toFixed(3)} per team-game`
  );

  const paces = [...summary.hitters, ...summary.pitchers].filter((line) => Number.isFinite(line.wpaPer162));
  const wildest = paces.reduce((best, line) => (Math.abs(line.wpaPer162) > Math.abs(best.wpaPer162) ? line : best));
  assert.ok(
    Math.abs(wildest.wpaPer162) < 16,
    `${wildest.name} paced ${wildest.wpaPer162.toFixed(1)} WPA/162; the best real season ever was about 12`
  );
});
