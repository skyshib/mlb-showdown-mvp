import { timesBeaten } from "./state.js";

// The Cascade League: one town so far, with routes climbing past it. Trainers
// are pure data — teams build deterministically from teamSeed + pointBudget.
// Budgets ladder from 4000 up to the 10000-point champion: late bosses
// out-spend the player's flat 5000, so winning means fielding bargains.
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
    pointBudget: 4000,
    battleFormat: { type: "game" },
    repeatable: false,
    requires: [],
    rewards: { coins: 150 },
    dialog: {
      intro: ["Hey! My sandlot crew never strikes out.", "Let's play ball!"],
      win: ["Aw, dropped it...", "You play like a big-leaguer. Take a card, that's the rule."],
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
    pointBudget: 4400,
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
    pointBudget: 4300,
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
    pointBudget: 5200,
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
        "Take the IRONWOOD BADGE. The road past town just opened up."
      ],
      lose: ["Come back when your lineup grows teeth."]
    }
  },
  {
    id: "route-hollis",
    name: "UMP-IN-EXILE HOLLIS",
    title: "Route 2",
    sprite: "HO",
    archetype: "ace",
    aiProfile: "conservative",
    teamSeed: "route-hollis-v1",
    pointBudget: 6000,
    battleFormat: { type: "game" },
    repeatable: false,
    requires: ["gym-garrick"],
    rewards: { coins: 400 },
    dialog: {
      intro: ["They ran me out of the league for calling it straight.", "My aces call it straighter. Strike three, kid."],
      win: ["Ball four. You earned that walk-off.", "Fair is fair — pick a card off my bench."],
      lose: ["STEE-RIKE. You're out. Come back with a real bat."]
    }
  },
  {
    id: "route-petra",
    name: "SALVAGE QUEEN PETRA",
    title: "Route 2",
    sprite: "PE",
    archetype: "power",
    aiProfile: "aggressive",
    teamSeed: "route-petra-v1",
    pointBudget: 7000,
    battleFormat: { type: "game" },
    repeatable: false,
    requires: ["route-hollis"],
    rewards: { coins: 500 },
    dialog: {
      intro: ["Everything at my yard is overpriced except the swings.", "My sluggers were other teams' junk. Watch them fly."],
      win: ["Scrapped! Fine — one man's roster is another man's salvage."],
      lose: ["Straight to the crusher with you."]
    }
  },
  {
    id: "gym-quince",
    name: "HARBORMASTER QUINCE",
    title: "Galehook Gym",
    sprite: "QU",
    archetype: "contact",
    aiProfile: "balanced",
    teamSeed: "gym-quince-v1",
    pointBudget: 8000,
    battleFormat: { type: "series", bestOf: 3 },
    repeatable: false,
    requires: ["route-hollis", "route-petra"],
    rewards: { coins: 1500, pack: "booster", badge: "galehook" },
    dialog: {
      intro: [
        "Every ship that docks here pays a toll.",
        "Yours is nine innings, three times over.",
        "My crew slaps singles like the tide. Endless."
      ],
      win: [
        "You sailed through the gale...",
        "The GALEHOOK BADGE is yours. The summit road is open."
      ],
      lose: ["Back to port with you. The tide always wins."]
    }
  },
  {
    id: "route-sawyer",
    name: "NIGHT-TRAIN SAWYER",
    title: "Route 3",
    sprite: "SA",
    archetype: "speed",
    aiProfile: "aggressive",
    teamSeed: "route-sawyer-v1",
    pointBudget: 9000,
    battleFormat: { type: "game" },
    repeatable: false,
    requires: ["gym-quince"],
    rewards: { coins: 800 },
    dialog: {
      intro: ["Last stop before the summit, rookie.", "My roster cost more than your town. Try to keep up."],
      win: ["...The night train got derailed.", "Take a souvenir. You'll need it up there."],
      lose: ["All aboard! Next stop: back where you started."]
    }
  },
  {
    id: "boss-vale",
    name: "COMMISSIONER VALE",
    title: "Summit Gym",
    sprite: "VA",
    archetype: "balanced",
    aiProfile: "balanced",
    teamSeed: "boss-vale-v1",
    pointBudget: 10000,
    battleFormat: { type: "series", bestOf: 3 },
    repeatable: false,
    requires: ["route-sawyer"],
    rewards: { coins: 3000, pack: "booster", badge: "cascade" },
    dialog: {
      intro: [
        "So you're the bargain hunter the routes keep whispering about.",
        "I own the deepest checkbook in the league. Ten thousand points of it.",
        "Show me a lineup that money can't buy."
      ],
      win: [
        "Extraordinary. The checkbook lost.",
        "The CASCADE BADGE — and the league — are yours, champ."
      ],
      lose: ["Depth wins pennants. Come back when you've found yours."]
    }
  }
];

export const BADGES = {
  ironwood: { key: "ironwood", name: "IRONWOOD BADGE", town: "cedar-yards" },
  galehook: { key: "galehook", name: "GALEHOOK BADGE", town: "cedar-yards" },
  cascade: { key: "cascade", name: "CASCADE BADGE", town: "cedar-yards" }
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
