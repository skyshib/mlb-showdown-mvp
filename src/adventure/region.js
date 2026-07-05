import { timesBeaten } from "./state.js";

// M1 slice of the Cascade League: one town, one route, one gym. Trainers are
// pure data — teams build deterministically from teamSeed + pointBudget.
export const REGION = {
  name: "CASCADE LEAGUE",
  towns: [
    {
      id: "cedar-yards",
      name: "CEDAR YARDS",
      blurb: "A mill town that loves its nine."
    }
  ]
};

export const TRAINERS = [
  {
    id: "scout-jojo",
    name: "SANDLOT KID JOJO",
    title: "Route 1",
    sprite: "JO",
    archetype: "contact",
    aiProfile: "conservative",
    teamSeed: "scout-jojo-v1",
    pointBudget: 2350,
    battleFormat: { type: "game" },
    repeatable: false,
    requires: [],
    rewards: { coins: 150 },
    dialog: {
      intro: ["Hey! My sandlot crew never strikes out.", "Let's play ball!"],
      win: ["Aw, dropped it...", "You play like a big-leaguer."],
      lose: ["The sandlot stays undefeated!"]
    }
  },
  {
    id: "scout-mabel",
    name: "BLEACHER PROPHET MABEL",
    title: "Route 1",
    sprite: "MA",
    archetype: "speed",
    aiProfile: "aggressive",
    teamSeed: "scout-mabel-v1",
    pointBudget: 2550,
    battleFormat: { type: "game" },
    repeatable: false,
    requires: ["scout-jojo"],
    rewards: { coins: 250 },
    dialog: {
      intro: ["I foresaw your arrival, rookie.", "I also foresee my runners stealing you blind."],
      win: ["The prophecy... was wrong?!", "Take these coins. It is written."],
      lose: ["As foretold. Come back when destiny favors you."]
    }
  },
  {
    id: "farm-cage-crew",
    name: "BATTING CAGE CREW",
    title: "Cedar Yards",
    sprite: "CC",
    archetype: "balanced",
    aiProfile: "balanced",
    teamSeed: "farm-cage-crew-v1",
    pointBudget: 2500,
    battleFormat: { type: "simSeries", bestOf: 5 },
    repeatable: true,
    requires: [],
    rewards: { coins: 200 },
    dialog: {
      intro: ["Weekend money series, best of five.", "Set your lineup — we sim it out."],
      win: ["Cage rats pay their debts. Nice series."],
      lose: ["House wins. Run it back anytime."]
    }
  },
  {
    id: "gym-garrick",
    name: "BENCH BOSS GARRICK",
    title: "Ironwood Gym",
    sprite: "GA",
    archetype: "power",
    aiProfile: "balanced",
    teamSeed: "gym-garrick-v1",
    pointBudget: 2950,
    battleFormat: { type: "series", bestOf: 3 },
    repeatable: false,
    requires: ["scout-jojo", "scout-mabel"],
    rewards: { coins: 1000, pack: "booster", badge: "ironwood" },
    dialog: {
      intro: [
        "So you cleared Route 1. Cute.",
        "My boys hit the ball where it hurts: the bleachers.",
        "Best of three. Bring your whole staff."
      ],
      win: [
        "That... was a pennant swing.",
        "Take the IRONWOOD BADGE. Your roster cap just got heavier."
      ],
      lose: ["Come back when your lineup grows teeth."]
    }
  }
];

export const BADGES = {
  ironwood: { key: "ironwood", name: "IRONWOOD BADGE", town: "cedar-yards" }
};

export function trainerById(id) {
  return TRAINERS.find((trainer) => trainer.id === id) ?? null;
}

export function isTrainerUnlocked(save, trainer) {
  return trainer.requires.every((id) => timesBeaten(save, id) > 0);
}

export function isTrainerAvailable(save, trainer) {
  if (!isTrainerUnlocked(save, trainer)) return false;
  return trainer.repeatable || timesBeaten(save, trainer.id) === 0;
}

// Repeatable rewards shrink on repeat wins so farming stays a floor, not an
// exploit: 100%, 75%, 56%... with a floor of 50 coins.
export function rewardCoins(save, trainer) {
  const beaten = timesBeaten(save, trainer.id);
  if (!trainer.repeatable || beaten === 0) return trainer.rewards.coins;
  return Math.max(50, Math.round(trainer.rewards.coins * Math.pow(0.75, beaten)));
}
