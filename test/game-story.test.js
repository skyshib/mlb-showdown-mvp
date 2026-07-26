import test from "node:test";
import assert from "node:assert/strict";
import { formatAdvanceAttempt, renderBaseDiamond, storyAdvantage, storyHeadline } from "../src/ui/gameStory.js";

test("the play-by-play diamond shows the supplied runners and clears on three outs", () => {
  const occupied = renderBaseDiamond(["Ichiro", null, "Edgar"], { label: "After", outs: 1 });
  assert.match(occupied, /After: 1B Ichiro, 3B Edgar/);
  assert.equal((occupied.match(/occupied/g) ?? []).length, 2);
  assert.match(occupied, />1 out</);

  const retired = renderBaseDiamond(["Ichiro", "Boone", "Edgar"], { label: "After", outs: 3 });
  assert.match(retired, /After: side retired, bases empty/);
  assert.equal((retired.match(/occupied/g) ?? []).length, 0);
  assert.match(retired, /Side retired/);
});

test("story advantage distinguishes hitter, pitcher, runner, and catcher edges", () => {
  assert.deepEqual(
    storyAdvantage({ chartOwner: "hitter", controlTotal: 9, onBase: 10 }),
    { key: "hitter", label: "HITTER ADVANTAGE", detail: "9 vs OB 10" }
  );
  assert.deepEqual(
    storyAdvantage({ chartOwner: "pitcher", controlTotal: 15, onBase: 10 }),
    { key: "pitcher", label: "PITCHER ADVANTAGE", detail: "15 vs OB 10" }
  );
  assert.deepEqual(
    storyAdvantage({ playDetails: { kind: "steal", stealAttempt: { thrown: true, target: 19, fielding: 5 } } }),
    { key: "runner", label: "70% SAFE", detail: "Run target 19 vs C +5" }
  );
  assert.deepEqual(
    storyAdvantage({ playDetails: { kind: "steal", stealAttempt: { thrown: true, target: 10, fielding: 5 } } }),
    { key: "catcher", label: "25% SAFE", detail: "Run target 10 vs C +5" }
  );
  assert.deepEqual(
    storyAdvantage({
      playDetails: {
        kind: "steal",
        stealAttempt: {
          thrown: true,
          target: 10,
          runnerSpeed: 15,
          targetBonus: -5,
          to: "3B",
          fielding: 5,
          safeChance: 0.25
        }
      }
    }),
    { key: "catcher", label: "25% SAFE", detail: "SPD 15 − 5 (3B) vs C +5" }
  );
});

test("play headlines surface runs and runners thrown out taking an extra base", () => {
  assert.equal(storyHeadline({
    batter: "Mike Piazza",
    result: "2B",
    runs: 1,
    playDetails: {
      kind: "hit",
      extraBaseAttempts: [
        { runner: "Ken Griffey Jr.", to: "home", safe: false }
      ]
    }
  }), "Mike Piazza — double; 1 run scores; Ken Griffey Jr. thrown out trying for home");

  assert.equal(storyHeadline({
    batter: "Ichiro",
    result: "FB",
    runs: 0,
    playDetails: {
      kind: "flyout",
      tagUpAttempts: [
        { runner: "Edgar Martinez", to: "3B", safe: false }
      ]
    }
  }), "Ichiro — fly out; Edgar Martinez thrown out tagging for third");

  assert.equal(storyHeadline({
    batter: "Barry Bonds",
    result: "HR",
    runs: 3
  }), "Barry Bonds — 3-run home run");
});

test("baserunning throws label the roll, defense, and speed comparison", () => {
  assert.equal(formatAdvanceAttempt({
    runner: "Mike Piazza",
    from: "1B",
    to: "3B",
    safe: false,
    thrown: true,
    roll: 17,
    fielding: 3,
    total: 20,
    target: 19
  }, "outfield defense"),
  "Mike Piazza 1B-3B out — d20 roll 17 + outfield defense +3 = 20; 20 > runner SPD target 19");

  assert.equal(formatAdvanceAttempt({
    runner: "Ichiro",
    from: "1B",
    to: "2B",
    safe: true,
    thrown: true,
    roll: 8,
    fielding: 2,
    total: 10,
    target: 20
  }, "catcher defense"),
  "Ichiro 1B-2B safe — d20 roll 8 + catcher defense +2 = 10; 10 ≤ runner SPD target 20");
});
