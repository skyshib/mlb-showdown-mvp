import { timesBeaten } from "./state.js?v=20260713-c";
import { poolCeiling, LADDER_REFERENCE } from "./packs.js?v=20260713-c";

// The Cascade League: one town so far, with routes climbing past it. Trainers
// are pure data — teams build deterministically from teamSeed + pointBudget.
// Budgets ladder from 2500 up through the 6500-point summit and into the
// postseason (division series, championship series, world series at 7500):
// the player's cap is 1.4x the first rung (3500 in the reference league),
// so mid-ladder bosses catch the player and the summit out-spends him
// badly — winning means bargains.
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
    pointBudget: 2500,
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
    pointBudget: 2800,
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
    id: "rival-1",
    name: "RIVAL CAM",
    title: "Rival",
    ambush: true,
    sprite: "CA",
    archetype: "power",
    aiProfile: "aggressive",
    teamSeed: "rival-cam-1",
    pointBudget: 2650,
    battleFormat: { type: "game" },
    repeatable: false,
    requires: ["scout-jojo"],
    rewards: { coins: 300 },
    dialog: {
      intro: [
        "There you are! I ripped my starter pack the same day you did.",
        "Mine came out better. Obviously.",
        "One game. Loser walks home."
      ],
      win: ["WHAT. Rematch me after the gym. I'll be stronger."],
      lose: ["Told you my pack was better. Smell ya later!"]
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
    pointBudget: 3300,
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
    id: "rival-2",
    name: "RIVAL CAM",
    title: "Rival",
    ambush: true,
    sprite: "CA",
    archetype: "power",
    aiProfile: "aggressive",
    teamSeed: "rival-cam-2",
    pointBudget: 3650,
    battleFormat: { type: "game" },
    repeatable: false,
    requires: ["gym-garrick"],
    rewards: { coins: 600 },
    dialog: {
      intro: [
        "Heard you took the IRONWOOD BADGE. Took mine a week ago.",
        "I've been pulling packs while you were napping.",
        "Let's see whose binder grew teeth."
      ],
      win: ["Ugh. Fine. FINE. This isn't over."],
      lose: ["Still a step behind me. Smell ya later!"]
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
    pointBudget: 3850,
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
    pointBudget: 4500,
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
    pointBudget: 5200,
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
    id: "rival-3",
    name: "RIVAL CAM",
    title: "Rival",
    ambush: true,
    sprite: "CA",
    archetype: "power",
    aiProfile: "aggressive",
    teamSeed: "rival-cam-3",
    pointBudget: 5400,
    battleFormat: { type: "game" },
    repeatable: false,
    requires: ["gym-quince"],
    rewards: { coins: 1200 },
    dialog: {
      intro: [
        "The gale didn't slow you down, huh.",
        "I traded half my binder for this roster. Every card a hammer.",
        "One game. For real this time."
      ],
      win: ["...You're actually good. Go take the summit. I'll be watching."],
      lose: ["The summit's got no room for you. Smell ya later!"]
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
    pointBudget: 5800,
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
    pointBudget: 6500,
    battleFormat: { type: "series", bestOf: 3 },
    repeatable: false,
    requires: ["route-sawyer"],
    rewards: { coins: 3000, pack: "booster", badge: "cascade" },
    dialog: {
      intro: [
        "So you're the bargain hunter the routes keep whispering about.",
        "I own the deepest checkbook in the league. Sixty-five hundred points of it.",
        "Show me a lineup that money can't buy."
      ],
      win: [
        "Extraordinary. The checkbook lost.",
        "The CASCADE BADGE is yours. Now October begins — the postseason awaits."
      ],
      lose: ["Depth wins pennants. Come back when you've found yours."]
    }
  },
  {
    id: "post-division",
    name: "OCTOBER GATEKEEPER IVY",
    title: "Division Series",
    sprite: "IV",
    archetype: "speed",
    aiProfile: "aggressive",
    teamSeed: "post-division-v6",
    pointBudget: 6800,
    battleFormat: { type: "series", bestOf: 5 },
    repeatable: false,
    requires: ["boss-vale"],
    rewards: { coins: 2000, pack: "booster" },
    dialog: {
      intro: [
        "Welcome to October, rookie. The air is colder up here.",
        "Five games. My runners never stop moving.",
        "One bad hop and your season's over."
      ],
      win: ["Swept out of my own series...", "Go on then. The championship is waiting."],
      lose: ["And that's the season. See you next spring."]
    }
  },
  {
    id: "post-championship",
    name: "PENNANT SHARK OKABE",
    title: "Championship Series",
    sprite: "OK",
    archetype: "ace",
    aiProfile: "balanced",
    teamSeed: "post-championship-v4",
    pointBudget: 7800,
    battleFormat: { type: "series", bestOf: 7 },
    repeatable: false,
    requires: ["post-division"],
    rewards: { coins: 3500, pack: "booster", badge: "pennant" },
    dialog: {
      intro: [
        "Seven games. Four aces. Zero mercy.",
        "I've hung six pennants. Yours would look better in my office.",
        "Throw the first pitch whenever you're ready."
      ],
      win: [
        "My rotation... out-pitched by a binder full of bargains.",
        "The PENNANT is yours. One series left."
      ],
      lose: ["The shark eats again. Swim home."]
    }
  },
  {
    id: "rival-4",
    name: "RIVAL CAM",
    title: "Rival",
    ambush: true,
    sprite: "CA",
    archetype: "power",
    aiProfile: "aggressive",
    teamSeed: "rival-cam-4",
    pointBudget: 8000,
    battleFormat: { type: "game" },
    repeatable: false,
    requires: ["post-championship"],
    rewards: { coins: 2500, pack: "booster" },
    dialog: {
      intro: [
        "Of course it's you. It was always going to be you and me.",
        "I spent everything I had for this one game.",
        "Before you play the World Series... you play ME."
      ],
      win: [
        "...Go win the whole thing. You earned it.",
        "And hey. Thanks for pushing me all season."
      ],
      lose: ["The World Series will eat you alive. Shoulda been me out there."]
    }
  },
  {
    id: "post-worldseries",
    name: "MR. NOVEMBER GRAVES",
    title: "World Series",
    sprite: "GR",
    archetype: "balanced",
    aiProfile: "aggressive",
    teamSeed: "post-worldseries-v6",
    pointBudget: 8800,
    battleFormat: { type: "series", bestOf: 7 },
    repeatable: false,
    requires: ["post-championship"],
    rewards: { coins: 5000, pack: "booster", badge: "trophy" },
    dialog: {
      intro: [
        "Every October ends the same way: with me holding the trophy.",
        "Eighty-eight hundred points. The best money can assemble.",
        "Seven games for everything. Play ball."
      ],
      win: [
        "...The confetti falls for someone else this year.",
        "THE COMMISSIONER'S TROPHY IS YOURS. You are the champion of the CASCADE LEAGUE."
      ],
      lose: ["November belongs to me. It always has."]
    }
  }
];

export const BADGES = {
  ironwood: { key: "ironwood", name: "IRONWOOD BADGE", town: "cedar-yards" },
  galehook: { key: "galehook", name: "GALEHOOK BADGE", town: "cedar-yards" },
  cascade: { key: "cascade", name: "CASCADE BADGE", town: "cedar-yards" },
  pennant: { key: "pennant", name: "LEAGUE PENNANT", town: "cedar-yards" },
  trophy: { key: "trophy", name: "COMMISSIONER'S TROPHY", town: "cedar-yards" }
};

export function trainerById(id) {
  return TRAINERS.find((trainer) => trainer.id === id) ?? null;
}

export function isTrainerUnlocked(save, trainer) {
  return trainer.requires.every((id) => timesBeaten(save, id) > 0);
}

export function isTrainerAvailable(save, trainer) {
  if (!isTrainerUnlocked(save, trainer)) return false;
  if (trainer.ambush && ambushDone(save, trainer.id)) return false;
  return trainer.repeatable || timesBeaten(save, trainer.id) === 0;
}

// The NPC budget a save actually faces. The printed ladder (2500 -> 8800)
// was tuned against the fictional league, whose best legal 13-card roster
// prices near LADDER_REFERENCE — but pools print very different ceilings
// (a thin expansion franchise ~4k, the all-time MLB pool ~8.8k), so the
// ladder keeps its SHAPE and rescales to the pool: the World Series boss
// always shops the same fraction of what this pool can actually field.
// Uncapped saves still swing harder: budgets grow on a power-1.5 curve
// anchored at the first scout's rung, capped at the pool ceiling scaled to
// the trainer's rung so mid-ladder bosses don't max out small universes.
export function npcBudget(save, trainer) {
  const scale = poolCeiling() / LADDER_REFERENCE;
  const printed = Math.round((trainer.pointBudget * scale) / 50) * 50;
  if (save?.mode !== "uncapped") return printed;
  const curve = Math.round((2500 * scale * Math.pow(trainer.pointBudget / 2500, 1.5)) / 50) * 50;
  const maxPrinted = Math.max(...TRAINERS.map((t) => t.pointBudget));
  const rung = Math.round((poolCeiling() * trainer.pointBudget / maxPrinted) / 50) * 50;
  return Math.max(printed, Math.min(curve, rung));
}

// Repeatable rewards shrink on repeat wins so farming stays a floor, not an
// exploit: 100%, 75%, 56%... with a floor of 50 coins.
export function rewardCoins(save, trainer) {
  const beaten = timesBeaten(save, trainer.id);
  if (!trainer.repeatable || beaten === 0) return trainer.rewards.coins;
  return Math.max(50, Math.round(trainer.rewards.coins * Math.pow(0.75, beaten)));
}

// ---- Rival ambushes ----------------------------------------------------------

// Ambush trainers stay off the map until they jump the player: the first map
// visit after their requirements clear. Once sprung they show like anyone else.
export function pendingAmbush(save) {
  return TRAINERS.find((trainer) =>
    trainer.ambush &&
    !ambushSprung(save, trainer.id) &&
    timesBeaten(save, trainer.id) === 0 &&
    isTrainerUnlocked(save, trainer)
  ) ?? null;
}

export function ambushSprung(save, trainerId) {
  return Boolean(save.progress.ambushes?.[trainerId]);
}

// Older saves grow the ambush ledger in place; no version bump.
export function springAmbush(save, trainerId) {
  save.progress.ambushes ??= {};
  save.progress.ambushes[trainerId] ??= true;
}

// Rival bouts are one-and-done: once played to a result — win OR lose — the
// bout is over and the rival moves on. Walking away from the intro does not
// count; only a finished battle does.
export function markAmbushDone(save, trainerId) {
  save.progress.ambushes ??= {};
  save.progress.ambushes[trainerId] = "done";
}

export function ambushDone(save, trainerId) {
  return save.progress.ambushes?.[trainerId] === "done";
}
