import { shortName, stripCardYear } from "./cardFace.js?v=20260714-f";

// The booth: one engine event becomes the lines a broadcaster would say.
// Shared by both games — the adventure prints these in its text box, the
// draft app in its play-by-play feed — so a double play is called the same
// way wherever you are watching it from.

const RESULT_LINES = {
  SO: "strikes out!",
  PU: "pops it up. Easy out.",
  GB: "chops a grounder...",
  FB: "lofts a fly ball...",
  BB: "works a walk.",
  "1B": "lines a single!",
  "1B+": "lines a single!",
  "2B": "rips a double!",
  "3B": "legs out a triple!",
  HR: "CRUSHES IT! HOME RUN!"
};

// Narration names: short, and without the card-year suffix — the booth says
// "C.JONES", not "C.JONES '00".
function playName(name) {
  return shortName(stripCardYear(name));
}

// Every fielding check reports its d20 in parentheses, steal-call style, so
// the table always sees the throw that decided the play.
function rolled(attempt) {
  return typeof attempt?.roll === "number" ? ` (rolled ${attempt.roll})` : "";
}

// The two dice that decided the at-bat, called before the call itself: the
// pitch that set the chart, then the swing rolled off it. Plays that aren't a
// duel (a bunt, a walk, a trot around on someone else's hit) have no such pair
// and get no such line.
function duelLine(event) {
  if (typeof event.controlRoll !== "number" || typeof event.resultRoll !== "number") return null;
  return `PITCH ${event.controlRoll} vs SWING ${event.resultRoll}.`;
}

// Scores always read from the player's side: up 3-0 is "3-0" whether the
// player is home or away.
function scoreCall(event, playerSide) {
  const yours = event.scoreAfter[playerSide];
  const theirs = event.scoreAfter[playerSide === "home" ? "away" : "home"];
  return `It's ${yours}-${theirs}.`;
}

export function describeEvent(event, playerSide = "away") {
  if (!event) return [];
  if (event.type === "pitching-change") {
    return [`${playName(event.team)} goes to the pen: ${playName(event.pitcher)} takes the hill.`];
  }
  if (event.type === "intentional-walk") {
    const lines = [`${playName(event.batter)} is waved down to first. Intentional walk.`];
    if (event.runs > 0) lines.push(`That forces in a run! ${scoreCall(event, playerSide)}`);
    return lines;
  }
  if (event.type === "bunt") {
    const details = event.playDetails;
    const lines = [];
    lines.push(`${playName(event.batter)} lays it down. Textbook sacrifice.`);
    return lines;
  }
  if (event.type === "advance") {
    const lines = [];
    for (const attempt of event.playDetails?.attempts ?? []) {
      if (attempt.thrown) {
        lines.push(attempt.safe
          ? `${playName(attempt.runner)} beats the throw to ${attempt.to}!${rolled(attempt)}`
          : `${playName(attempt.runner)} is cut down at ${attempt.to}!${rolled(attempt)}`);
      } else {
        lines.push(`${playName(attempt.runner)} takes ${attempt.to}.`);
      }
    }
    if (event.runs > 0) {
      lines.push(`${event.runs === 1 ? "A run scores!" : `${event.runs} runs score!`} ${scoreCall(event, playerSide)}`);
    }
    if (event.outsAfter >= 3) {
      lines.push(sideRetiredLine(event));
    }
    return lines;
  }
  const lines = [];
  if (event.type === "steal") {
    const attempt = event.playDetails?.stealAttempt;
    if (attempt) {
      lines.push(
        attempt.safe
          ? `${playName(attempt.runner)} steals ${attempt.to}! (rolled ${attempt.roll})`
          : `${playName(attempt.runner)} is GUNNED DOWN at ${attempt.to}! (rolled ${attempt.roll})`
      );
    }
    return lines;
  }
  const duel = duelLine(event);
  if (duel) lines.push(duel);
  if (event.result === "HR" && event.runs === 4) {
    lines.push(`${playName(event.batter)} unloads the bases... GRAND SLAM!`);
  } else {
    lines.push(`${playName(event.batter)} ${RESULT_LINES[event.result] ?? event.result}`);
  }
  if (event.result === "1B+" && event.basesAfter?.[1] === event.batter) {
    lines.push(`${playName(event.batter)} alertly takes second, uncontested!`);
  }
  const doublePlay = event.playDetails?.doublePlayAttempt;
  if (doublePlay?.batterOut) lines.push(`Double play! Two gone.${rolled(doublePlay)}`);
  const thrown = event.playDetails?.thrownAttempt;
  if (thrown) {
    lines.push(
      thrown.safe
        ? `${playName(thrown.runner)} takes ${thrown.to} on the throw!${rolled(thrown)}`
        : `${playName(thrown.runner)} is cut down at ${thrown.to}!${rolled(thrown)}`
    );
  }
  if (event.runs > 0) {
    lines.push(`${event.runs === 1 ? "A run scores!" : `${event.runs} runs score!`} `, scoreCall(event, playerSide));
  }
  if (event.outsAfter >= 3) {
    lines.push(sideRetiredLine(event));
  }
  return lines;
}

// The third out either turns the inning over or ends the game — never
// announce a next half-inning that won't be played.
function sideRetiredLine(event) {
  const decided = event.inning >= 9 && (
    event.half === "bottom"
      ? event.scoreAfter.home !== event.scoreAfter.away
      : event.scoreAfter.home > event.scoreAfter.away
  );
  if (decided) return "That's the ballgame!";
  return `Side retired. ${event.half === "top" ? "Bottom" : "Top"} ${event.half === "top" ? event.inning : event.inning + 1} coming up.`;
}

export function halfLabel(state) {
  return `${state.half === "top" ? "TOP" : "BOT"} ${state.inning}`;
}
