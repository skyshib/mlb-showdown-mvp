import test from "node:test";
import assert from "node:assert/strict";
import { formatBalanceReport, runBalanceSimulation } from "../scripts/balance-sim.js";

test("balance simulation reports deterministic draft tournament distributions", () => {
  const first = runBalanceSimulation({ runs: 3, teams: 4, seed: "test-balance" });
  const second = runBalanceSimulation({ runs: 3, teams: 4, seed: "test-balance" });

  assert.deepEqual(first.summary, second.summary);
  assert.equal(first.summary.tournaments, 3);
  assert.equal(first.summary.teamWins.length, 4);
  assert.ok(first.summary.games > 0);
  assert.ok(first.summary.plateAppearances > 0);
  assert.ok(first.summary.rates.runsPerGame.mean >= 0);
  assert.ok(first.summary.rates.homeRunsPerGame.mean >= 0);
  assert.ok(first.summary.rates.walkRate >= 0);
  assert.ok(first.summary.rates.strikeoutRate >= 0);
});

test("balance simulation text output names the main metrics", () => {
  const result = runBalanceSimulation({ runs: 1, teams: 2, seed: "report-smoke" });
  const report = formatBalanceReport(result);

  assert.match(report, /Runs\/game/);
  assert.match(report, /HR\/game/);
  assert.match(report, /Walks\/game/);
  assert.match(report, /Strikeouts\/game/);
  assert.match(report, /Team 1/);
});
