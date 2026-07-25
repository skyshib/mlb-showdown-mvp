import { basesText, escapeHtml } from "./render.js?v=20260716-records";

const BASE_LABELS = ["1B", "2B", "3B"];

export function renderBaseDiamond(bases, { label = "After play", outs = 0 } = {}) {
  const occupied = Array.isArray(bases) ? bases.slice(0, 3) : [null, null, null];
  const displayed = Number(outs) >= 3 ? [null, null, null] : occupied;
  const situation = Number(outs) >= 3 ? "side retired, bases empty" : basesText(displayed);
  const markers = displayed.map((runner, index) => {
    const base = BASE_LABELS[index];
    const runnerLabel = runner ? `${base}: ${runner}` : `${base}: empty`;
    return `<span class="base-state-marker base-state-${index + 1}${runner ? " occupied" : ""}" title="${escapeHtml(runnerLabel)}">
      <span>${index + 1}</span>
    </span>`;
  }).join("");

  return `<div class="game-story-base-state" role="img" aria-label="${escapeHtml(`${label}: ${situation}`)}">
    <span class="game-story-base-label">${escapeHtml(label)}</span>
    <span class="game-story-base-diamond">${markers}</span>
    <span class="game-story-outs">${Number(outs) >= 3 ? "Side retired" : `${Number(outs) || 0} out${Number(outs) === 1 ? "" : "s"}`}</span>
  </div>`;
}

export function storyAdvantage(event) {
  if (event?.playDetails?.kind === "steal") {
    const attempt = event.playDetails.stealAttempt ?? {};
    const target = Number(attempt.target);
    const fielding = Number(attempt.fielding);
    if (Number.isFinite(target) && Number.isFinite(fielding)) {
      const safeChance = Number.isFinite(attempt.safeChance)
        ? attempt.safeChance
        : Math.max(0, Math.min(20, target - fielding)) / 20;
      const runnerFavored = safeChance >= 0.5;
      return {
        key: runnerFavored ? "runner" : "catcher",
        label: `${Math.round(safeChance * 100)}% SAFE`,
        detail: `${stealMatchupText(attempt)}${attempt.thrown ? "" : " · no throw"}`
      };
    }

    return {
      key: attempt.safe ? "runner" : "catcher",
      label: attempt.safe ? "RUNNER WINS" : "CATCHER WINS",
      detail: ""
    };
  }

  if (event?.chartOwner === "hitter") {
    return {
      key: "hitter",
      label: "HITTER ADVANTAGE",
      detail: Number.isFinite(event.controlTotal) && Number.isFinite(event.onBase)
        ? `${event.controlTotal} vs OB ${event.onBase}`
        : ""
    };
  }

  if (event?.chartOwner === "pitcher") {
    return {
      key: "pitcher",
      label: "PITCHER ADVANTAGE",
      detail: Number.isFinite(event.controlTotal) && Number.isFinite(event.onBase)
        ? `${event.controlTotal} vs OB ${event.onBase}`
        : ""
    };
  }

  return null;
}

export function formatAdvanceAttempt(attempt, defenseLabel = "defense") {
  const outcome = attempt.safe ? "safe" : "out";
  const runner = escapeHtml(attempt.runner);
  if (!attempt.thrown) {
    return `${runner} ${attempt.from}-${attempt.to} ${outcome} — no roll needed; the result was automatic (runner SPD target ${attempt.target} vs ${defenseLabel} ${signedNumber(Number(attempt.fielding))})`;
  }
  const comparison = attempt.safe ? "≤" : ">";
  return `${runner} ${attempt.from}-${attempt.to} ${outcome} — d20 roll ${attempt.roll} + ${defenseLabel} ${signedNumber(Number(attempt.fielding))} = ${attempt.total}; ${attempt.total} ${comparison} runner SPD target ${attempt.target}`;
}

function stealMatchupText(attempt) {
  const speed = Number(attempt.runnerSpeed);
  const target = Number(attempt.target);
  const bonus = Number(attempt.targetBonus);
  const fielding = Number(attempt.fielding);
  const catcher = `C ${signedNumber(fielding)}`;

  if (Number.isFinite(speed)) {
    if (Number.isFinite(bonus) && bonus !== 0) {
      return `SPD ${speed} ${bonus < 0 ? "−" : "+"} ${Math.abs(bonus)} (${attempt.to ?? "base"}) vs ${catcher}`;
    }
    return `SPD ${speed} vs ${catcher}`;
  }
  return `Run target ${target} vs ${catcher}`;
}

function signedNumber(value) {
  if (!Number.isFinite(value)) return "?";
  return value >= 0 ? `+${value}` : String(value);
}

export function storyHeadline(event) {
  if (event?.playDetails?.kind === "steal") {
    const attempt = event.playDetails.stealAttempt ?? {};
    return `${attempt.runner ?? event.runner ?? "Runner"} — ${attempt.safe ? `steals ${attempt.to ?? "a base"}` : `caught stealing ${attempt.to ?? ""}`.trim()}`;
  }

  const resultLabels = {
    SO: "strikeout",
    GB: "ground out",
    FB: "fly out",
    BB: "walk",
    "1B": "single",
    "1B+": "single and advance",
    "2B": "double",
    "3B": "triple",
    HR: "home run"
  };
  const runs = storyRunsScored(event);
  let result = resultLabels[event?.result] ?? event?.result ?? "play";
  if (event?.result === "HR") {
    result = runs === 1 ? "solo home run" : runs > 1 ? `${runs}-run home run` : result;
  }

  const clauses = [];
  if (runs > 0 && event?.result !== "HR") {
    clauses.push(`${runs} run${runs === 1 ? " scores" : "s score"}`);
  }

  const details = event?.playDetails ?? {};
  const attempts = details.kind === "hit"
    ? details.extraBaseAttempts ?? []
    : details.kind === "flyout"
      ? details.tagUpAttempts ?? []
      : [];
  for (const attempt of attempts) {
    if (attempt.safe) continue;
    const action = details.kind === "flyout" ? "tagging for" : "trying for";
    clauses.push(`${attempt.runner ?? "Runner"} thrown out ${action} ${baseDestination(attempt.to)}`);
  }

  return `${event?.batter ?? "Batter"} — ${result}${clauses.length ? `; ${clauses.join("; ")}` : ""}`;
}

function storyRunsScored(event) {
  if (Number.isFinite(event?.runs)) return Math.max(0, event.runs);
  const before = (Number(event?.scoreBefore?.away) || 0) + (Number(event?.scoreBefore?.home) || 0);
  const after = (Number(event?.scoreAfter?.away) || 0) + (Number(event?.scoreAfter?.home) || 0);
  return Math.max(0, after - before);
}

function baseDestination(base) {
  return {
    "1B": "first",
    "2B": "second",
    "3B": "third",
    home: "home"
  }[base] ?? String(base ?? "the next base");
}
