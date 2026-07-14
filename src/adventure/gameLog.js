// The play-by-play, filed for later.
//
// A game was always thrown away the moment it ended: the almanac kept the box
// score and the board, and the events — the actual GAME, pitch by pitch — went in
// the bin. So reopening a game gave you a box score and an empty log, and the
// win-probability line had nothing to draw.
//
// They are kept now, but not as they are. A live event carries everything the
// engine needed to make the play; the log only needs what it is going to SAY. So
// the event is trimmed on the way into the book:
//
//   - the club names, stamped on all 68 plays, when the game already knows them
//   - the pitcher's control, his fatigue, his effective control: how the sausage
//     was made. The log tells you he struck him out, not what the arm was rated
//   - scoreBefore and wpBefore, both of which are just the previous play's After
//   - and the win probabilities, which arrive as 0.4372198374615 and are read to
//     the nearest percent
//
// What is left is what the log and the chart actually render, and it is roughly
// half the size. See TRIM_TEST in the suite: every field a renderer touches is
// asserted to survive, because the compression that quietly drops the one field
// the log needed is a log with a hole in it.

// Rounded to four places: the chart plots percentages and nobody can see the
// thirteenth decimal of a win probability.
function odds(value) {
  return typeof value === "number" ? Math.round(value * 1e4) / 1e4 : value;
}

// The throws and the double plays. Same rule: keep what gets said, round what
// gets shown.
function trimAttempt(attempt) {
  if (!attempt || typeof attempt !== "object") return attempt;
  const clean = { ...attempt };
  if (typeof clean.safeChance === "number") clean.safeChance = Math.round(clean.safeChance * 100) / 100;
  return clean;
}

function trimDetails(details) {
  if (!details || typeof details !== "object") return details ?? null;
  const clean = { ...details };
  for (const key of ["attempts", "tagUpAttempts", "extraBaseAttempts"]) {
    if (Array.isArray(clean[key])) clean[key] = clean[key].map(trimAttempt);
  }
  for (const key of ["thrownAttempt", "stealAttempt", "doublePlayAttempt"]) {
    if (clean[key]) clean[key] = trimAttempt(clean[key]);
  }
  return clean;
}

// One event, as the book keeps it. Exported for tests.
export function compactEvent(event) {
  if (!event || typeof event !== "object") return null;
  const kept = {
    type: event.type,
    inning: event.inning,
    half: event.half,
    batter: event.batter,
    batterId: event.batterId ?? null,
    pitcher: event.pitcher,
    pitcherId: event.pitcherId ?? null,
    controlRoll: event.controlRoll,
    controlTotal: event.controlTotal,
    onBase: event.onBase,
    chartOwner: event.chartOwner,
    resultRoll: event.resultRoll,
    result: event.result,
    outsBefore: event.outsBefore,
    outsAfter: event.outsAfter,
    basesBefore: event.basesBefore,
    basesAfter: event.basesAfter,
    scoreAfter: event.scoreAfter,
    runs: event.runs,
    wpAfter: odds(event.wpAfter),
    wpa: odds(event.wpa),
    playDetails: trimDetails(event.playDetails),
    // Steals and advances are their own kind of event and carry their own names.
    runnerId: event.runnerId,
    team: event.team
  };
  // An undefined field still costs its key in JSON.stringify's eyes only if it is
  // present, so drop them: most events are not steals and have no runnerId.
  for (const key of Object.keys(kept)) {
    if (kept[key] === undefined) delete kept[key];
  }
  return kept;
}

export function compactEvents(events) {
  return (events ?? []).filter(Boolean).map(compactEvent);
}

// ---- The cast ----------------------------------------------------------------
//
// Trimming the fields got a quarter of it. The rest of the fat is REPETITION: the
// same nine men bat all afternoon, and every play wrote out "Ichiro Suzuki '02"
// and his card id again, in the batter, in the pitcher, and in each of the three
// bases. Sixty-eight plays of that is most of the file.
//
// So the game is filed as a CAST and a script: the men once, at the top, and the
// plays pointing at them by number. It is the same game — expandGame puts every
// name back exactly where it was — and it is about a third of the size again.
//
// The shape is versioned (`v`), because a book that cannot say what format it is
// in is a book that has to guess, and an old almanac full of raw events must keep
// opening. expandGame reads both.
const LOG_VERSION = 1;

export function compactGame(events) {
  const cast = [];
  const index = new Map();
  // The same man, wherever he turns up, is the same number.
  const seat = (name, id) => {
    if (name === null || name === undefined) return null;
    const key = `${id ?? ""}|${name}`;
    if (!index.has(key)) {
      index.set(key, cast.length);
      cast.push(id ? { name, id } : { name });
    }
    return index.get(key);
  };
  const plays = compactEvents(events).map((event) => {
    const play = { ...event };
    play.b = seat(event.batter, event.batterId);
    play.p = seat(event.pitcher, event.pitcherId);
    delete play.batter;
    delete play.batterId;
    delete play.pitcher;
    delete play.pitcherId;
    // The bases hold names; the cast holds them once.
    if (Array.isArray(event.basesBefore)) play.bb = event.basesBefore.map((runner) => seat(runner, null));
    if (Array.isArray(event.basesAfter)) play.ba = event.basesAfter.map((runner) => seat(runner, null));
    delete play.basesBefore;
    delete play.basesAfter;
    // {away: 3, home: 1} is a pair of numbers wearing a costume.
    if (event.scoreAfter) play.s = [event.scoreAfter.away ?? 0, event.scoreAfter.home ?? 0];
    delete play.scoreAfter;
    return play;
  });
  return { v: LOG_VERSION, cast, plays };
}

// The game, back as the renderers expect it. An almanac page from before the log
// existed has nothing; one from before the cast existed is a plain array of
// events and is handed straight back.
export function expandGame(stored) {
  if (!stored) return [];
  if (Array.isArray(stored)) return stored;
  if (stored.v !== LOG_VERSION || !Array.isArray(stored.plays)) return [];
  const cast = Array.isArray(stored.cast) ? stored.cast : [];
  const nameOf = (seat) => (seat === null || seat === undefined ? null : cast[seat]?.name ?? null);
  const idOf = (seat) => (seat === null || seat === undefined ? null : cast[seat]?.id ?? null);
  return stored.plays.map((play) => {
    const event = { ...play };
    event.batter = nameOf(play.b);
    event.batterId = idOf(play.b);
    event.pitcher = nameOf(play.p);
    event.pitcherId = idOf(play.p);
    event.basesBefore = Array.isArray(play.bb) ? play.bb.map(nameOf) : [null, null, null];
    event.basesAfter = Array.isArray(play.ba) ? play.ba.map(nameOf) : [null, null, null];
    event.scoreAfter = { away: play.s?.[0] ?? 0, home: play.s?.[1] ?? 0 };
    delete event.b;
    delete event.p;
    delete event.bb;
    delete event.ba;
    delete event.s;
    return event;
  });
}
