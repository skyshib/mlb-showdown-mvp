// Wins above replacement, measured one decision at a time inside a simulated
// game. Every number here is a difference in win probability between what the
// player's card did and what the room's standing replacement card would have
// done in exactly the same spot.
//
// A card has four kinds of number on it, and each one is measured in exactly one
// bucket, so no win is ever counted twice:
//
//   hitting      the batter's on-base number and chart. The plate appearance is
//                replayed with the same dice and the replacement's on-base and
//                chart; the batter's own speed stays on the replayed runner.
//   baserunning  speed. At every steal, extra-base, tag-up and double-play
//                chance, the expected value is recomputed with the runner's speed
//                swapped for the replacement's (the go/hold decision re-made).
//   defense      fielding. At the same chances, the expected value is recomputed
//                with the fielder's glove swapped for the replacement's at his
//                position.
//   pitching     the pitcher's control and chart, replayed with the same dice
//                and the replacement SP's or RP's numbers (same fatigue).
//
// Hitting and pitching are replays of one plate appearance: nothing after the
// plate appearance is re-simulated. For hitters that matches reality — swapping a
// hitter for the replacement card in a real batch moved team wins within about
// half a win of his measured WAR. For pitchers it does not: the replay makes the
// replacement face every batter the real arm faced, but the auto-manager pulls
// or skips a bad arm (a replacement reliever swapped into a bullpen faced 0.03
// batters a game against the real one's 7.8), so pitching WAR runs high —
// about 40% for the starters checked, several times over for a reliever.
// Baserunning and defense are exact expectations over the d20, so they carry no
// dice luck at all.
//
// The team fielding curve reuses the defense machinery: at every chance, the
// unit's fielding total (catcher, infield sum, outfield sum) is shifted from
// -FIELDING_SWEEP to +FIELDING_SWEEP and the change in the fielding team's win
// probability is summed. Alongside it, each unit's real fielding total is summed
// over the same chances, so the curve can be read against what the club fielded.

export const FIELDING_SWEEP = 10;
export const FIELDING_UNITS = ["C", "IF", "OF"];
export const UNIT_POSITIONS = {
  C: ["C"],
  IF: ["1B", "2B", "3B", "SS"],
  OF: ["LF", "CF", "RF"]
};

// Where a lineup spot finds its replacement card. Rooms dealt before first base
// had a standing card of its own fall back to the DH card there (see game.js).
export function replacementSlotFor(position) {
  if (position === "CA") return "C";
  if (position === "LF" || position === "RF" || position === "LF/RF") return "LF/RF";
  if (!position) return "DH";
  return position;
}

export function createAttribution({ resolveReplacement, rng }) {
  const curve = () => Object.fromEntries(FIELDING_UNITS.map((unit) => [unit, new Array(FIELDING_SWEEP * 2 + 1).fill(0)]));
  const fielded = () => Object.fromEntries(FIELDING_UNITS.map((unit) => [unit, { total: 0, chances: 0 }]));
  return {
    resolveReplacement,
    rng,
    lines: { away: new Map(), home: new Map() },
    curves: { away: curve(), home: curve() },
    fielded: { away: fielded(), home: fielded() },
    // A throwaway box score for plate-appearance replays to write into. Never
    // read, so it is never cleared either.
    sink: { hitters: new Map(), pitchers: new Map() }
  };
}

export function attributionLine(attribution, side, player, team) {
  const lines = attribution.lines[side];
  let line = lines.get(player.id);
  if (!line) {
    line = {
      id: player.id, name: player.name, side, team, hitting: 0, baserunning: 0, defense: 0, pitching: 0,
      // The part of `pitching` from plate appearances that began before he tired.
      pitchingFresh: 0,
      // What defense and baserunning were measured against, summed per chance:
      // the player's glove and legs and the replacement's.
      inputs: { fieldChances: 0, glove: 0, replacementGlove: 0, runChances: 0, speed: 0, replacementSpeed: 0 }
    };
    lines.set(player.id, line);
  }
  return line;
}

function safeChance(target, fielding) {
  return Math.max(0, Math.min(20, target - fielding)) / 20;
}

const THROW_CHOICE_TIE = 1e-9;

// The batting team's expected win probability at one chance, for a given
// fielding total and runner speeds. Mirrors the engine: runners go lead first
// while each clears his break-even (a forced play has no decision), and the
// defense throws at the runner whose out is worth the most, falling back to the
// most gettable one when the throws price the same.
export function opportunityWp(op, fielding, speeds) {
  const count = op.candidates.length;
  const chances = new Array(count);
  let prefix = 0;
  for (let index = 0; index < count; index += 1) {
    const candidate = op.candidates[index];
    chances[index] = safeChance(speeds[index] + candidate.bonus, fielding);
    if (!op.forced && chances[index] < candidate.min) break;
    prefix = index + 1;
  }
  if (!prefix) return op.holdWp;
  const safeWp = op.safeWp[prefix];
  const outWp = op.outWp[prefix];
  if (prefix === 1) return chances[0] * safeWp + (1 - chances[0]) * outWp[0];

  let bestEv = Infinity;
  let worstEv = -Infinity;
  for (let index = 0; index < prefix; index += 1) {
    const ev = chances[index] * safeWp + (1 - chances[index]) * outWp[index];
    if (ev < bestEv) bestEv = ev;
    if (ev > worstEv) worstEv = ev;
  }
  if (worstEv - bestEv > THROW_CHOICE_TIE) return bestEv;
  let target = 0;
  for (let index = 1; index < prefix; index += 1) {
    if (chances[index] < chances[target]
      || (chances[index] === chances[target] && op.candidates[index].toIndex > op.candidates[target].toIndex)) {
      target = index;
    }
  }
  return chances[target] * safeWp + (1 - chances[target]) * outWp[target];
}

// Credit one fielding chance. `fielders` are the unit on the field, each with
// his glove at his position; `teams` names the two sides for the lines.
export function attributeOpportunity(attribution, { battingSide, fieldingSide, unit, fielders, teams }, op) {
  const fielding = fielders.reduce((sum, fielder) => sum + fielder.value, 0);
  const speeds = op.candidates.map((candidate) => candidate.speed);
  const actual = opportunityWp(op, fielding, speeds);

  const fielded = attribution.fielded[fieldingSide][unit];
  fielded.total += fielding;
  fielded.chances += 1;
  const curve = attribution.curves[fieldingSide][unit];
  for (let shift = -FIELDING_SWEEP; shift <= FIELDING_SWEEP; shift += 1) {
    if (shift === 0) continue;
    // The fielding team's gain is the batting team's loss.
    curve[shift + FIELDING_SWEEP] += actual - opportunityWp(op, fielding + shift, speeds);
  }

  for (const fielder of fielders) {
    if (!fielder.player?.id) continue;
    const replacementValue = attribution.resolveReplacement(fieldingSide, "fielder", fielder.player, fielder.position);
    if (replacementValue === null) continue;
    const withReplacement = opportunityWp(op, fielding - fielder.value + replacementValue, speeds);
    const line = attributionLine(attribution, fieldingSide, fielder.player, teams[fieldingSide]);
    line.defense += withReplacement - actual;
    line.inputs.fieldChances += 1;
    line.inputs.glove += fielder.value;
    line.inputs.replacementGlove += replacementValue;
  }

  op.candidates.forEach((candidate, index) => {
    if (!candidate.runner?.id) return;
    const replacementSpeed = attribution.resolveReplacement(battingSide, "runner", candidate.runner);
    if (replacementSpeed === null) return;
    const swapped = [...speeds];
    swapped[index] = replacementSpeed;
    const line = attributionLine(attribution, battingSide, candidate.runner, teams[battingSide]);
    line.baserunning += actual - opportunityWp(op, fielding, swapped);
    line.inputs.runChances += 1;
    line.inputs.speed += candidate.speed;
    line.inputs.replacementSpeed += replacementSpeed;
  });
}

export function summarizeGameAttribution(attribution) {
  if (!attribution) return null;
  return {
    lines: [...attribution.lines.away.values(), ...attribution.lines.home.values()],
    curves: attribution.curves,
    fielded: attribution.fielded
  };
}
