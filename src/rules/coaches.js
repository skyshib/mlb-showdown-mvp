import { RESULTS, chartSpan } from "./cards.js?v=20260716-records";
import { createRng } from "./rng.js?v=20260716-records";

// ---- Coaches -----------------------------------------------------------------
//
// An optional draft mode: coach cards are dealt into the deck alongside the
// players, and a manager may draft as many of them as he likes, or none. A coach
// takes no roster slot — the nine bats and the staff are what they always were —
// and does one small thing to the way his club plays. Small on purpose: the
// point is not to change the game but to give the room something new to argue
// the price of. What is a first base coach worth in the eighth round?
//
// A coach is a card like any other as far as the board is concerned (an id, a
// name, points, a face), and a kind of its own — "coach" — everywhere a rule
// has to tell a bat from an arm from a clipboard.

export const COACH_KIND = "coach";

// The pool group a coach deals and counts under. Never a position: a coach
// fills no slot, so no roster-shape rule ever sees one.
export const COACH_GROUP = "COACH";

// How many of the catalog stay home each night. A board deals every coach but
// these, drawn by the seed and added ON TOP of the usual deck — the DH shelf
// and every position group deal exactly what they would without coaches. Two
// out keeps the room guessing which arguments it is not going to have.
export const COACHES_HELD_BACK = 2;

// The old cards graded speed A/B/C; the later printings put a number on it. An
// "A" is the top of the numeric scale: the 2000-01 A was a 20, and the numbered
// sets run their burners 18-20.
export const SPEED_A_MINIMUM = 18;

// The Rotation coach's thumb on the draw: three starts in five for the ace.
export const ROTATION_ACE_SHARE = 0.6;

// The Clutch Gene's lift on a natural 20.
export const CLUTCH_GENE_BONUS = 2;

export function speedGrade(speed) {
  const value = Number(speed) || 0;
  if (value >= SPEED_A_MINIMUM) return "A";
  if (value >= 13) return "B";
  return "C";
}

// The catalog. `ability` is the key the game engine reads (see coachEffects);
// everything else is the card. Points are a rough sticker for the computer
// managers and the draft recap — a coach is priced like a late pick.
//
// Every effect here is tuned to the same scale: a few percent of plate
// appearances, or a fraction of a run a game. A coach who touched half the
// swings in a game would be a star card, not a clipboard.
export const COACHES = [
  {
    id: "coach-green-light",
    kind: COACH_KIND,
    name: "Green Light",
    title: "First base coach",
    ability: "stealSpeedA",
    blurb: `Every Speed A runner (speed ${SPEED_A_MINIMUM}+) gets +1 to his target on stolen-base attempts.`,
    icon: "1B",
    points: 40
  },
  {
    id: "coach-cannon-arms",
    kind: COACH_KIND,
    name: "Cannon Arms",
    title: "Outfield coach",
    ability: "outfieldDefense",
    blurb: "The outfield defense is +1 better on every throw: tag-ups and runners trying for the extra base.",
    icon: "OF",
    points: 45
  },
  {
    id: "coach-lefty-specialist",
    kind: COACH_KIND,
    name: "Lefty Specialist",
    title: "Pitching coach",
    ability: "leftyControl",
    blurb: "Left-handed pitchers get +1 control against left-handed hitters (switch hitters bat right against them).",
    icon: "LHP",
    points: 45
  },
  {
    id: "coach-late-innings",
    kind: COACH_KIND,
    name: "Late Innings",
    title: "Hitting coach",
    ability: "lateSwing",
    blurb: "From the 9th inning on, batters get +1 on every swing while the club is tied or trailing.",
    icon: "9th",
    points: 50
  },
  {
    id: "coach-punchouts",
    kind: COACH_KIND,
    name: "Punchouts",
    title: "Bullpen coach",
    ability: "flyToStrikeout",
    blurb: "Every pitcher turns one fly-ball face of his chart into a strikeout (a 14-16 FB becomes 14 SO, 15-16 FB).",
    icon: "K",
    points: 30
  },
  {
    id: "coach-wild-card",
    kind: COACH_KIND,
    name: "Wild Card",
    title: "Bench coach",
    ability: "wildcard",
    blurb: "Pick one of your hitters. A coin flip gives him +1 on every swing, or -1 on every swing, for the season. You learn the flip before you set your lineup, and he need not be in it.",
    icon: "?",
    points: 30
  },
  {
    id: "coach-framing",
    kind: COACH_KIND,
    name: "Framing",
    title: "Catching coach",
    ability: "framing",
    blurb: "With two outs, a control check that lands exactly on the batter's on-base number goes to the pitcher instead of the hitter.",
    icon: "C",
    points: 40
  },
  {
    id: "coach-platoon",
    kind: COACH_KIND,
    name: "Platoon",
    title: "Hitting coach",
    ability: "platoonOnBase",
    blurb: "Right-handed hitters get +1 on-base against left-handed pitchers. Switch hitters bat right against a lefty, so they get it too.",
    icon: "R/L",
    points: 40
  },
  {
    id: "coach-contact",
    kind: COACH_KIND,
    name: "Contact",
    title: "Hitting coach",
    ability: "strikeoutToGroundBall",
    blurb: "Every hitter turns the lowest strikeout face of his chart into a ground ball: fewer strikeouts, more double plays. A chart with no strikeouts is unchanged.",
    icon: "GB",
    points: 35
  },
  {
    id: "coach-rotation",
    kind: COACH_KIND,
    name: "Rotation",
    title: "Pitching coach",
    ability: "rotationAce",
    blurb: "Your best starter by points takes the ball in three of every five simulated games instead of his even share of the rotation.",
    icon: "SP",
    points: 45
  },
  {
    id: "coach-clutch-gene",
    kind: COACH_KIND,
    name: "Clutch Gene",
    title: "Mental skills coach",
    ability: "clutchGene",
    blurb: `A natural 20 on any swing adds +${CLUTCH_GENE_BONUS}, reaching the 21+ and 22+ rows some cards print but no die can roll.`,
    icon: "20",
    points: 35
  },
  {
    id: "coach-old-school",
    kind: COACH_KIND,
    name: "Old School",
    title: "Infield coach",
    ability: "oldSchool",
    blurb: "+1 infield defense on every double-play attempt, but your club never attempts a steal.",
    icon: "DP",
    points: 35
  }
].map((coach) => ({
  ...coach,
  // A coach has no chart, but the board's chart-reading code looks for one on
  // every card; an empty one keeps every column blank rather than every page
  // broken.
  chart: [],
  team: "Coaching staff",
  setTag: "COACH",
  rarity: "uncommon",
  real: false
}));

const COACHES_BY_ID = new Map(COACHES.map((coach) => [coach.id, coach]));

// How many coaches a board deals: the catalog less the ones held back.
export const COACHES_PER_BOARD = Math.max(0, COACHES.length - COACHES_HELD_BACK);

export function coachById(id) {
  return COACHES_BY_ID.get(id) ?? null;
}

export function isCoach(card) {
  return card?.kind === COACH_KIND;
}

// The one coach who asks the manager a question: which hitter?
export function needsCoachTarget(coach) {
  return coach?.ability === "wildcard";
}

// The Wild Card's coin. A pure function of the room and the choice, so every
// replica of a draft — the server, every browser, a save file — lands the same
// side up. It is keyed on the PLAYER chosen as well as the coach, which is what
// makes the choice a gamble: a manager cannot read the flip and then decide who
// to spend it on, because there is no flip until there is a who.
export function coachFlip(seed, managerId, coachId, playerId) {
  const rng = createRng(`${seed ?? "showdown"}:coach-flip:${managerId}:${coachId}:${playerId}`);
  return rng.next() < 0.5 ? 1 : -1;
}

export function coachTargetLabel(coach, target) {
  if (!needsCoachTarget(coach)) return "";
  if (!target?.playerId) return "no player picked yet";
  return target.swing > 0 ? "+1 on every swing" : "-1 on every swing";
}

// What each ability does to the effect sheet. One coach can turn more than one
// knob (Old School turns two: a glove and a rule).
const ABILITY_EFFECTS = {
  stealSpeedA: ["stealSpeedA"],
  outfieldDefense: ["outfieldDefense"],
  leftyControl: ["leftyControl"],
  lateSwing: ["lateSwing"],
  flyToStrikeout: ["flyToStrikeout"],
  framing: ["framing"],
  platoonOnBase: ["platoonOnBase"],
  strikeoutToGroundBall: ["strikeoutToGroundBall"],
  rotationAce: ["rotationAce"],
  clutchGene: ["clutchGene"],
  oldSchool: ["infieldDefense", "noSteals"]
};

// What a club's coaching staff does to the game, folded into one object the
// engine reads at the moments that matter. Counts, not flags, so two of the
// same coach (a pool that dealt duplicates) simply stack.
//
//   stealSpeedA           +n to the steal target of every Speed A runner
//   outfieldDefense       +n to the outfield's fielding total on throws
//   infieldDefense        +n to the infield's fielding total on double plays
//   leftyControl          +n control for a lefty arm facing a lefty bat
//   platoonOnBase         +n on-base for a right-handed (or switch) bat facing a lefty arm
//   framing               with two outs, a control-check tie goes to the pitcher
//   lateSwing             +n on the swing when tied or trailing in the 9th or later
//   clutchGene            +2n on the swing when the die shows a natural 20
//   flyToStrikeout        n fly-ball faces on every pitcher's chart become strikeouts
//   strikeoutToGroundBall n strikeout faces on every hitter's chart become ground balls
//   rotationAce           the best starter draws three starts in five (batch sim)
//   noSteals              the club never attempts a steal
//   swingTargets          { playerId: +n / -n } on every swing that man takes
//   names                 which coach supplies each effect, for the play-by-play
export function coachEffects(coaches = []) {
  const effects = {
    stealSpeedA: 0,
    outfieldDefense: 0,
    infieldDefense: 0,
    leftyControl: 0,
    platoonOnBase: 0,
    framing: 0,
    lateSwing: 0,
    clutchGene: 0,
    flyToStrikeout: 0,
    strikeoutToGroundBall: 0,
    rotationAce: 0,
    noSteals: 0,
    swingTargets: {},
    names: {}
  };
  for (const coach of coaches ?? []) {
    if (!isCoach(coach)) continue;
    if (coach.ability === "wildcard") {
      const target = coach.target;
      if (!target?.playerId || (target.swing !== 1 && target.swing !== -1)) continue;
      effects.swingTargets[target.playerId] = (effects.swingTargets[target.playerId] ?? 0) + target.swing;
      effects.names[`swing:${target.playerId}`] = coach.name;
      continue;
    }
    for (const key of ABILITY_EFFECTS[coach.ability] ?? []) {
      effects[key] += 1;
      if (!effects.names[key]) effects.names[key] = coach.name;
    }
  }
  return effects;
}

export function hasCoachEffects(effects) {
  if (!effects) return false;
  return Object.entries(effects).some(([key, value]) =>
    key === "swingTargets" ? Object.keys(value ?? {}).length > 0 : typeof value === "number" && value > 0);
}

// A chart edit: the lowest faces of one result become another, one face per
// count, and the rest of the row stays what it was. "3-8 SO, 14-16 FB" with one
// fly ball converted reads "3-8 SO, 14 SO, 15-16 FB" — the strikeouts are no
// longer one contiguous row, which every chart reader here already copes with
// (resolveChart walks the list; the card face merges what it can and prints the
// rest as "3-8,14"). A chart with none of the faces is left exactly as it was.
export function convertChartFaces(chart, fromResult, toResult, count = 1) {
  let remaining = Math.max(0, Math.round(Number(count)) || 0);
  if (!remaining || !Array.isArray(chart)) return chart;
  const sorted = [...chart].sort((a, b) => (Number(a.from) || 0) - (Number(b.from) || 0));
  const next = [];
  for (const entry of sorted) {
    const span = chartSpan(entry);
    if (remaining <= 0 || entry.result !== fromResult || span <= 0) {
      next.push(entry);
      continue;
    }
    const faces = Math.min(remaining, span);
    const from = Math.max(1, Number(entry.from) || 1);
    remaining -= faces;
    next.push({ ...entry, from, to: from + faces - 1, result: toResult });
    if (faces < span) next.push({ ...entry, from: from + faces });
  }
  return next;
}

// The bullpen coach: fly balls into strikeouts, on every arm.
export function convertFlyoutsToStrikeouts(chart, count = 1) {
  return convertChartFaces(chart, RESULTS.FB, RESULTS.SO, count);
}

// The contact coach: strikeouts into ground balls, on every bat.
export function convertStrikeoutsToGroundBalls(chart, count = 1) {
  return convertChartFaces(chart, RESULTS.SO, RESULTS.GB, count);
}

// The Rotation coach's ace: the best starter by printed points, the first of
// them on a tie. Points ride on the card whether the board shows them or not.
export function aceStarterIndex(starters) {
  let ace = 0;
  for (let index = 1; index < (starters?.length ?? 0); index += 1) {
    if ((Number(starters[index]?.points) || 0) > (Number(starters[ace]?.points) || 0)) ace = index;
  }
  return ace;
}
