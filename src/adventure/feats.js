// Easter eggs: rare feats worth stopping the presses for. Game feats read a
// finished game's box score and play-by-play; pack eggs read a fully revealed
// pack; day whimsy fires on exact day numbers. Everything here is rare by
// construction — the fun is in almost never seeing them.

// ---- Game feats ----------------------------------------------------------------

// Returns [{ title, blurb, cardId? }] for one finished interactive game, from
// the player's perspective. Order matters: the list reads top-down on the
// box-score screen, and bigger miracles suppress their lesser cousins
// (a perfect game is not ALSO reported as a shutout).
export function gameFeats({ boxScore, playerSide, events, score, innings }) {
  const npcSide = playerSide === "away" ? "home" : "away";
  const mine = boxScore[playerSide];
  const feats = [];
  const playerWon = score[playerSide] > score[npcSide];

  const hitsAllowed = mine.pitchers.reduce((sum, line) => sum + line.h, 0);
  const walksAllowed = mine.pitchers.reduce((sum, line) => sum + line.bb, 0);

  // The pitching miracles, rarest first.
  if (playerWon && innings >= 9 && hitsAllowed === 0 && walksAllowed === 0) {
    feats.push({ title: "PERFECT GAME!", blurb: "27 up, 27 down. Cooperstown is on the phone." });
  } else if (playerWon && innings >= 9 && hitsAllowed === 0) {
    feats.push({ title: "NO-HITTER!", blurb: "Check the mound for scorch marks." });
  } else if (playerWon && score[npcSide] === 0) {
    feats.push({ title: "SHUTOUT.", blurb: "They never touched home plate." });
  }

  for (const line of mine.hitters) {
    const singles = line.h - line.d - line.t - line.hr;
    if (singles >= 1 && line.d >= 1 && line.t >= 1 && line.hr >= 1) {
      feats.push({ title: `${line.name.toUpperCase()} HIT FOR THE CYCLE!`, blurb: "Single, double, triple, homer. A full set.", cardId: line.id });
    }
    if (line.hr >= 4) {
      feats.push({ title: `${line.name.toUpperCase()} WENT DEEP ${line.hr} TIMES!`, blurb: "The bleachers ran out of souvenirs.", cardId: line.id });
    }
    if (line.rbi >= 10) {
      feats.push({ title: `${line.name.toUpperCase()} DROVE IN ${line.rbi}!`, blurb: "A one-man offense.", cardId: line.id });
    }
    if (line.sb >= 5) {
      feats.push({ title: `${line.name.toUpperCase()} RAN WILD: ${line.sb} STEALS!`, blurb: "The catcher has filed a complaint.", cardId: line.id });
    }
    if (line.ab >= 5 && line.h === 0 && line.so >= 5) {
      feats.push({ title: `THE PLATINUM SOMBRERO.`, blurb: `${line.name.toUpperCase()} struck out ${line.so} times. Wear it proudly.`, cardId: line.id });
    }
  }

  for (const line of mine.pitchers) {
    if (line.so >= 15) {
      feats.push({ title: `${line.name.toUpperCase()} STRUCK OUT ${line.so}!`, blurb: "The radar gun needs a vacation.", cardId: line.id });
    }
  }

  // Team-shaped oddities.
  const myHits = mine.hitters.reduce((sum, line) => sum + line.h, 0);
  if (playerWon && myHits === 0) {
    feats.push({ title: "WON WITHOUT A HIT.", blurb: "Houdini applauds from the cheap seats." });
  }
  if (mine.hitters.length >= 9 && mine.hitters.every((line) => line.h === 1)) {
    feats.push({ title: "SOCIALIST BASEBALL.", blurb: "Nine hitters, one hit each. Perfectly balanced." });
  }
  if (innings >= 13) {
    feats.push({ title: `FREE BASEBALL: ${innings} INNINGS!`, blurb: "The vendors went home hours ago." });
  }
  if (playerWon && score[playerSide] - score[npcSide] >= 15) {
    feats.push({ title: "STATEMENT GAME.", blurb: `Won by ${score[playerSide] - score[npcSide]}. Someone check on their manager.` });
  }

  // Grand slams: a bases-loaded homer by the player's side.
  if (Array.isArray(events)) {
    for (const event of events) {
      if (event.result !== "HR" || event.runs !== 4 || !event.half) continue;
      const battingSide = event.half === "top" ? "away" : "home";
      if (battingSide !== playerSide) continue;
      const line = mine.hitters.find((hitter) => hitter.name === event.batter);
      feats.push({
        title: `${event.batter.toUpperCase()} — GRAND SLAM!`,
        blurb: `Bases loaded, ${event.half === "top" ? "top" : "bottom"} ${event.inning}. Emptied.`,
        cardId: line?.id
      });
    }
  }

  // The comeback: down big at any point, still won.
  if (playerWon && Array.isArray(events)) {
    let maxDeficit = 0;
    for (const event of events) {
      if (!event.scoreAfter) continue;
      const deficit = event.scoreAfter[npcSide] - event.scoreAfter[playerSide];
      if (deficit > maxDeficit) maxDeficit = deficit;
    }
    if (maxDeficit >= 5) {
      feats.push({ title: `DOWN ${maxDeficit}, NOT OUT.`, blurb: "A comeback for the scrapbook." });
    }
  }

  // The snowman: an eight-spot (or worse) in a single frame.
  if (Array.isArray(events)) {
    const frames = new Map();
    for (const event of events) {
      if (typeof event.runs !== "number" || !event.half) continue;
      const battingSide = event.half === "top" ? "away" : "home";
      if (battingSide !== playerSide) continue;
      const key = `${event.inning}:${event.half}`;
      frames.set(key, (frames.get(key) ?? 0) + event.runs);
    }
    const biggest = Math.max(0, ...frames.values());
    if (biggest >= 8) {
      feats.push({ title: `A ${biggest}-SPOT IN ONE INNING!`, blurb: "Snowman on the scoreboard." });
    }
  }

  return feats;
}

// ---- Pack eggs -----------------------------------------------------------------

// Oddities in a fully revealed pack. countFor(id) is how many copies the
// player owns AFTER this pack was added.
export function packEggs(cards, countFor) {
  const eggs = [];
  const legends = cards.filter((card) => card.rarity === "legend").length;
  if (legends >= 2) {
    eggs.push("&#9733; THE HEAVENS OPEN: TWO LEGENDS IN ONE PACK. &#9733;");
  }
  if (new Set(cards.map((card) => card.rarity)).size === 1) {
    eggs.push("A MONOCHROME PACK. THE PRINTER HICCUPED.");
  }
  const slots = new Set(cards.map((card) => (card.kind === "pitcher" ? card.role : card.position)));
  if (slots.size === 1) {
    eggs.push(`FIVE OF THE SAME SLOT? THE SCOUT NEEDS GLASSES.`);
  }
  if (cards.every((card) => countFor(card.id) >= 2)) {
    eggs.push("D&Eacute;J&Agrave; VU. EVERY CARD IN THIS PACK WAS ALREADY IN YOUR BINDER.");
  }
  return eggs;
}

// ---- Day whimsy ----------------------------------------------------------------

// One-liners that replace the map's hint on exact days. Every game is a day,
// so most saves will only ever see the first few.
const DAY_WHIMSY = {
  13: "DAY 13. THE UMPS ARE FEELING SUPERSTITIOUS TODAY.",
  27: "DAY 27. THE NUMBER OF OUTS IN A PERFECT GAME. NO PRESSURE.",
  42: "DAY 42. THE ANSWER TO BASEBALL, THE UNIVERSE, AND EVERYTHING.",
  56: "DAY 56. SOMEWHERE, DIMAGGIO NODS.",
  100: "DAY 100! THERE'S CAKE IN THE CLUBHOUSE.",
  108: "DAY 108. ONE DAY PER STITCH ON THE BALL.",
  162: "DAY 162. A FULL BIG-LEAGUE SEASON. HYDRATE.",
  314: "DAY 314. THE CLUBHOUSE CELEBRATES PIE DAY.",
  500: "DAY 500. THE GROUNDSKEEPER NAMED A RAKE AFTER YOU.",
  715: "DAY 715. YOU JUST PASSED THE BABE.",
  755: "DAY 755. HAMMERIN' THROUGH HISTORY."
};

export function dayWhimsy(day) {
  return DAY_WHIMSY[day] ?? null;
}
