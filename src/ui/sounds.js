// The draft room's sound kit.
//
// Every sound is synthesised — no files to fetch, so the room stays
// offline-complete and the whole kit costs nothing to ship. They are built from
// the same two ideas: a short stack of notes, and an envelope that opens fast
// and closes slow, which is what makes a tone read as a bell rather than a beep.
//
// Browsers will not let a page make noise until the person has touched it, so
// the context starts suspended and `unlockSounds` opens it on the first real
// gesture. Until then every call here is a no-op, quietly.

let context = null;
let muted = false;
let unlocked = false;

const MUTE_KEY = "mlb-showdown-mvp-muted";

try {
  muted = localStorage.getItem(MUTE_KEY) === "1";
} catch {
  muted = false;
}

export function isMuted() {
  return muted;
}

export function setMuted(value) {
  muted = Boolean(value);
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    // A browser that won't remember the setting still honours it this session.
  }
  return muted;
}

export function toggleMuted() {
  return setMuted(!muted);
}

// The first gesture on the page buys us the right to make noise for the rest of
// it. Call this from a real event — a click, a key — or the resume is refused.
export async function unlockSounds() {
  if (muted) return false;
  try {
    context = context ?? new AudioContext();
    if (context.state === "suspended") await context.resume();
    unlocked = context.state === "running";
    return unlocked;
  } catch {
    return false;
  }
}

function audio() {
  if (muted) return null;
  try {
    context = context ?? new AudioContext();
    if (context.state === "suspended") {
      // Not unlocked yet: try, but don't wait around for it.
      context.resume().catch(() => {});
      return null;
    }
    unlocked = true;
    return context;
  } catch {
    return null;
  }
}

// One voice: a note with a fast attack and a long tail, optionally an octave
// shimmer over it to give the tone some body.
function voice(ctx, master, { frequency, at, duration, type = "triangle", gain = 0.2, shimmer = false }) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.value = frequency;
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(gain, at + 0.018);
  env.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(env);
  env.connect(master);
  osc.start(at);
  osc.stop(at + duration + 0.02);

  if (shimmer) {
    const high = ctx.createOscillator();
    high.type = "sine";
    high.frequency.value = frequency * 2;
    high.connect(env);
    high.start(at);
    high.stop(at + duration + 0.02);
  }
}

// A phrase: notes as [frequency, offset, duration], played through one master
// envelope so the whole thing fades as a piece rather than note by note.
function phrase(notes, { level = 0.4, type = "triangle", shimmer = false, tail = 0.6 } = {}) {
  const ctx = audio();
  if (!ctx) return;
  try {
    const start = ctx.currentTime + 0.02;
    const last = notes.reduce((end, [, offset, duration]) => Math.max(end, offset + duration), 0);
    const master = ctx.createGain();
    master.gain.setValueAtTime(level, start);
    master.gain.exponentialRampToValueAtTime(0.0001, start + last + tail);
    master.connect(ctx.destination);
    for (const [frequency, offset, duration] of notes) {
      voice(ctx, master, { frequency, at: start + offset, duration, type, shimmer });
    }
  } catch {
    // A page that cannot make noise is still a page that works.
  }
}

const D3 = 146.83;
const F3 = 174.61;
const G3 = 196;
const A3 = 220;
const G4 = 392;
const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const A5 = 880;
const C6 = 1046.5;
const D6 = 1174.66;
const E6 = 1318.51;

// It is your turn. Two bright notes — the sound the room already used, kept, so
// a draft that was in progress does not suddenly start speaking a new language.
export function playYourTurn() {
  phrase([[A5, 0, 0.55], [D6, 0.18, 0.6]], { level: 0.34, type: "sine", tail: 0.3 });
}

// A pick landed. Short, dry, and low enough to sit under conversation — this one
// fires on every pick in the room, so it must never be the loudest thing.
export function playPick() {
  phrase([[C5, 0, 0.14], [G5, 0.06, 0.22]], { level: 0.16, type: "triangle", tail: 0.15 });
}

// A card on your board just went to somebody else. It falls, because it is bad
// news, and it is the one sound allowed to be a little rude.
export function playSniped() {
  phrase([[E5, 0, 0.16], [C5, 0.09, 0.18], [G4, 0.19, 0.42]], { level: 0.3, type: "sawtooth", tail: 0.25 });
}

// The clock is nearly out. A tick with an edge on it: quiet, but it climbs.
export function playClockWarning() {
  phrase([[C6, 0, 0.08], [C6, 0.14, 0.1]], { level: 0.22, type: "square", tail: 0.1 });
}

// A card is on the block. The board's existing rising sting, unchanged.
export function playNomination() {
  phrase(
    [[G4, 0, 0.2], [C5, 0.11, 0.22], [E5, 0.22, 0.24], [G5, 0.36, 0.28], [C6, 0.53, 0.7]],
    { level: 0.48, shimmer: true, tail: 0.55 }
  );
}

// A seat comes out of the lottery hat. One note, and it climbs with each seat
// drawn, so the room hears the order being built.
export function playLotteryBall(index = 0, total = 1) {
  const scale = [C5, E5, G5, A5, C6, D6, E6];
  const step = total > 1 ? Math.round((index / (total - 1)) * (scale.length - 1)) : 0;
  phrase([[scale[Math.min(step, scale.length - 1)], 0, 0.3]], { level: 0.3, type: "triangle", shimmer: true, tail: 0.3 });
}

// The draft is over. The one moment that has earned a real flourish.
export function playDraftComplete() {
  phrase(
    [[C5, 0, 0.3], [E5, 0.12, 0.3], [G5, 0.24, 0.34], [C6, 0.38, 0.5], [E6, 0.52, 0.9]],
    { level: 0.44, shimmer: true, tail: 0.9 }
  );
}

// A man has walked onto the field to play you. A rising sting, and it does not
// resolve — it stops on the step below the note it is reaching for, so the ear
// is left leaning forward. That is the whole job: something is about to happen.
export function playChallenge() {
  phrase(
    [[G3, 0, 0.16], [C5, 0.1, 0.18], [E5, 0.22, 0.2], [G5, 0.36, 0.5]],
    { level: 0.36, type: "square", shimmer: true, tail: 0.4 }
  );
}

// His boots land. A low, blunt thud with no tone to speak of — it is felt more
// than heard, and it lands on the frame where the park shakes.
export function playFootfall() {
  phrase([[D3, 0, 0.1], [D3, 0.05, 0.16]], { level: 0.4, type: "square", tail: 0.12 });
}

// An arm has started to labour. Everything else in this kit rises or rings; this
// one SAGS — two notes falling a step, low and dry, with no shimmer on them. It
// is the sound of a man who has thrown enough, and it should feel like the game
// telling you something you would rather not hear.
export function playArmTiring() {
  phrase([[A3, 0, 0.3], [G3, 0.16, 0.46]], { level: 0.26, type: "triangle", tail: 0.35 });
}

// And he is worse now. Same shape, lower, longer, and rough — a sawtooth where
// the first was a triangle — so a second warning cannot be mistaken for a repeat
// of the first. However deep the hole gets, this is the sound: the difference
// that matters is FRESH, TIRING, GONE.
export function playArmSpent() {
  phrase([[F3, 0, 0.34], [D3, 0.18, 0.62]], { level: 0.32, type: "sawtooth", tail: 0.5 });
}

export function soundsUnlocked() {
  return unlocked;
}
