import { escapeHtml, menuHtml, clampIndex, cardLine, cardPanelHtml } from "./helpers.js?v=20260715-b";
import { TRAINERS, BADGES, trainerById, isTrainerUnlocked, isTrainerAvailable, rewardCoins, npcBudget, pendingAmbush, ambushSprung, springAmbush, ambushDone } from "../region.js?v=20260715-b";
import { timesBeaten, managerFor, rosterPoints, pointCap, ensureSeasonStats, persistSave } from "../state.js?v=20260715-b";

// "1973/3500 PT" under the cap; uncapped saves just count.
export function pointsLabel(save) {
  const cap = pointCap(save);
  return Number.isFinite(cap) ? `${rosterPoints(save)}/${cap} PT` : `${rosterPoints(save)} PT &middot; UNCAPPED`;
}
import { dayWhimsy } from "../feats.js?v=20260715-b";
import { validateRoster } from "../../rules/draft.js?v=20260715-b";
import { buildNpcTeam } from "../npcTeams.js?v=20260715-b";
import { startTrainerBattle } from "./battleScreen.js?v=20260715-b";
import { playChallenge, playFootfall } from "../../ui/sounds.js?v=20260715-b";

export function rosterProblems(save) {
  const issues = validateRoster(managerFor(save));
  const points = rosterPoints(save);
  const cap = pointCap(save);
  if (points > cap) issues.push(`over the ${cap} point cap (${points})`);
  return issues;
}

function mapItems(app) {
  const save = app.save;
  const items = [];

  if (save.activeSeries) {
    const trainer = trainerById(save.activeSeries.trainerId);
    items.push({
      label: `RESUME SERIES: ${trainer.name} (${save.activeSeries.wins}-${save.activeSeries.losses})`,
      section: "! GYM SERIES IN PROGRESS",
      battle: true,
      resume: true,
      run: (a) => startTrainerBattle(a, trainer)
    });
  }

  for (const trainer of TRAINERS) {
    const beaten = timesBeaten(save, trainer.id) > 0;
    // Ambush trainers don't exist on the map until they've jumped the player,
    // and a lost bout is gone for good — the rival moved on.
    if (trainer.ambush && !beaten && (!ambushSprung(save, trainer.id) || ambushDone(save, trainer.id))) continue;
    const unlocked = isTrainerUnlocked(save, trainer);
    const available = isTrainerAvailable(save, trainer) && !save.activeSeries;
    // Beaten men keep their tick — you did beat them — and carry the wage they
    // will play you for now, so the map itself says where the coins are.
    const marker = beaten
      ? `&#10003; &#8635; $${rewardCoins(save, trainer)}`
      : formatTag(trainer);
    items.push({
      section: trainer.title.toUpperCase(),
      html: `${escapeHtml(trainer.name)} <span class="gq-dim">${unlocked ? marker : "LOCKED"}</span>`,
      disabled: !available,
      battle: true,
      beaten,
      run: (a) => a.go("trainerIntro", { trainerId: trainer.id, page: 0 })
    });
  }

  items.push({ section: "CEDAR YARDS", label: "CARD SHOP", run: (a) => a.go("shop", { menuIndex: 0 }) });
  items.push({ section: "YOUR CLUB", label: "TEAM", run: (a) => a.go("team", { index: 0, mode: "roster" }) });
  items.push({ section: "YOUR CLUB", label: "BATTING ORDER", run: (a) => a.go("lineup", { index: 0 }) });
  items.push({ section: "YOUR CLUB", label: "SEASON STATS", run: (a) => a.go("seasonStats", { index: 0, view: "hitters" }) });
  items.push({ section: "YOUR CLUB", label: "ALMANAC", run: (a) => a.go("almanac", { index: 0 }) });
  items.push({ section: "YOUR CLUB", label: "TROPHY ROOM", run: (a) => a.go("trophies", { index: 0 }) });
  items.push({ section: "YOUR CLUB", label: "BINDER", run: (a) => a.go("binder", { index: 0 }) });
  return items;
}

function formatTag(trainer) {
  const format = trainer.battleFormat;
  if (format.type === "simSeries") return `SIM BO${format.bestOf}`;
  if (format.type === "series") return `BO${format.bestOf}`;
  return "1 GAME";
}

// The Pokemon "!" moment: heading off to the next game, the rival jumps out
// instead. Its own screen so the map (shop, team, binder) stays reachable —
// claimed cards can join the roster before the bout.
export const ambushScreen = {
  render(app) {
    const rival = trainerById(app.screen.trainerId);
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>CEDAR YARDS</span><span>!!</span></div>
      <div class="gq-body gq-center">
        <p class="gq-ambush-bang gq-blink">!</p>
        <div class="gq-frame gq-title-frame gq-ambush-card">
          ${versusSprite(faceSeed(rival), rival.sprite)}
          <b>${escapeHtml(rival.name)}</b><br>
          <span class="gq-dim">HE LOOKS MEAN. ${npcBudget(app.save, rival)} PT OF MEAN.</span>
        </div>
      </div>
      <div class="gq-textbox">
        <p>You head for the ballpark... ${escapeHtml(rival.name)} jumps out of the dugout shadows!</p>
        <p class="gq-blink">Z — FACE HIM</p>
      </div>
    </div>`;
  },
  key(app, key) {
    if (key !== "a" && key !== "b") return;
    springAmbush(app.save, app.screen.trainerId);
    persistSave(app.save);
    app.go("trainerIntro", { trainerId: app.screen.trainerId, page: 0 });
    app.rerender();
  }
};

// Where the cursor stands when you walk onto the map. Beaten trainers no longer
// retire — the ladder only grows — so the top of the list is a museum of men you
// have already beaten, and the man you are actually here for is at the bottom of
// it. The cursor opens on him: the FARTHEST one you can still take for the first
// time, or, once they are all beaten, the farthest one you can play at all.
// A series you are in the middle of outranks everything: finish it.
function defaultMapIndex(items) {
  const playable = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.battle && !item.disabled);
  const resume = playable.find(({ item }) => item.resume);
  if (resume) return resume.index;
  const fresh = playable.filter(({ item }) => !item.beaten);
  const pick = (fresh.length ? fresh : playable).at(-1);
  return pick ? pick.index : 0;
}

export const mapScreen = {
  render(app) {
    const save = app.save;
    const items = mapItems(app);
    // Only on the way in. Once you have moved the cursor yourself it is yours.
    if (app.screen.menuIndex === undefined) app.screen.menuIndex = defaultMapIndex(items);
    const problems = rosterProblems(save);
    const sections = [];
    for (const [index, item] of items.entries()) {
      if (item.section !== items[index - 1]?.section) sections.push({ header: item.section, start: index });
    }
    let html = "";
    for (const [sectionIndex, section] of sections.entries()) {
      const end = sections[sectionIndex + 1]?.start ?? items.length;
      html += `<div class="gq-map-node"><h3>${section.header}</h3>${menuHtml(
        items.slice(section.start, end).map((item) => ({ label: item.label, html: item.html, disabled: item.disabled })),
        (app.screen.menuIndex ?? 0) - section.start,
        { offset: section.start }
      )}</div>`;
    }
    return `<div class="gq-screen">
      <div class="gq-topbar">
        <span>${escapeHtml(save.player.name)} &middot; DAY ${ensureSeasonStats(save).games + 1}</span>
        <span class="gq-map-purse">$${save.player.coins} &middot; ${pointsLabel(save)} &middot; <span class="gq-badgeline">${badgeLine(save)}</span></span>
      </div>
      <div class="gq-body">${html}</div>
      <div class="gq-textbox">${
        problems.length
          ? `<p>! ROSTER NOT GAME-READY: ${escapeHtml(problems.join(", "))}. Fix it in TEAM.</p>`
          : `<p>${escapeHtml(dayWhimsy(ensureSeasonStats(save).games + 1) ?? "Pick a place to go. Trainers pay cash; the gym pays a badge.")}</p>`
      }</div>
    </div>`;
  },
  key(app, key) {
    const items = mapItems(app);
    if (key === "up" || key === "down") {
      let index = app.screen.menuIndex ?? 0;
      for (let step = 0; step < items.length; step += 1) {
        index = clampIndex(index + (key === "down" ? 1 : -1), items.length);
        if (!items[index].disabled) break;
      }
      app.screen.menuIndex = index;
    } else if (key === "a") {
      const item = items[app.screen.menuIndex ?? 0];
      if (!item || item.disabled) return;
      if (item.battle && rosterProblems(app.save).length) return;
      // Setting off for any game springs a waiting rival first.
      if (item.battle && !app.save.activeSeries) {
        const ambush = pendingAmbush(app.save);
        if (ambush) return app.go("ambush", { trainerId: ambush.id });
      }
      item.run(app);
    } else if (key === "b") {
      app.go("title", { menuIndex: 0 });
    }
    app.rerender();
  }
};

function badgeLine(save) {
  return Object.values(BADGES)
    .map((badge) => (save.player.badges.includes(badge.key) ? "&#9673;" : "&#9675;"))
    .join("");
}

// The scouting report: the trainer's full squad, hitters then arms.
function scoutRows(trainer, save) {
  const npc = buildNpcTeam(trainer, save);
  return [
    ...npc.roster.filter((card) => card.kind === "hitter"),
    ...npc.roster.filter((card) => card.kind === "pitcher")
  ];
}

// ---- The stare-down ----------------------------------------------------------
//
// How long the walk-on runs, start to finish: he crosses, you cross behind him,
// the park shakes, and only then does anybody speak. Kept in step with the
// timings in styles.css (.gq-versus-enter and .gq-intro-late).
const INTRO_MS = 2500;
// The frame the second man lands on, and the park with him.
const INTRO_IMPACT_MS = 1900;
//
// The Game Boy did this with a pan: the field slides sideways and the two of you
// arrive from opposite edges, each behind a bracket of your team. You come in
// from the left, he comes in from the right, and for one beat before anybody
// says anything you are just two managers looking at each other across a
// ballpark. It is the whole reason a trainer battle feels like an event.
function teamDots(count) {
  return `<span class="gq-versus-dots">${"<i></i>".repeat(Math.max(0, count))}</span>`;
}

// A face, not a name tag. The cards in this game are already drawn by a seeded
// portrait service, so the men holding the cards are drawn by the same one and
// belong to the same world. The seed is the person, so a trainer looks like
// himself every time you meet him — and looks like nobody else.
//
// The initials sit UNDER the portrait and are what you see if the portrait never
// arrives (offline, blocked, slow): the sprite is a face when it can be and a
// name plate when it can't, and the layout does not move either way.
// Which PERSON a trainer entry is. Cam is four entries — he jumps you on Route
// 1, after Garrick, after Quince, and again past the championship — and seeding
// his face with the entry's id gave him a new face every ambush. The roster code
// already knows those four are one man: INHERITS is how his binder follows him
// up the chain, so it is how his face follows him too. Everyone else stands
// alone at the root of his own chain and is seeded exactly as before.
function faceSeed(trainer) {
  let person = trainer;
  const seen = new Set([person.id]);
  while (person.inherits && !seen.has(person.inherits)) {
    seen.add(person.inherits);
    person = trainerById(person.inherits) ?? person;
  }
  return `${person.id}-${person.name}`;
}

function versusSprite(seed, initials) {
  const url = `https://api.dicebear.com/10.x/micah/svg?seed=${encodeURIComponent(seed)}&clothesVariant=crew`;
  return `<span class="gq-versus-sprite">
    <b class="gq-versus-initials">${escapeHtml(initials)}</b>
    <img class="gq-versus-face" src="${url}" alt="" loading="eager" referrerpolicy="no-referrer" onerror="this.remove()">
  </span>`;
}

// You are not looking at yourself. In the handheld the manager on your side of
// the field is drawn from BEHIND — the back of a head, a cap, a pair of
// shoulders — because you are standing where he is standing and looking out at
// the man who came to beat you. A face on your side would be a second opponent.
function playerSilhouette() {
  return `<span class="gq-versus-sprite gq-versus-back">
    <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id="gq-brim-right"><rect x="50" y="0" width="50" height="100" /></clipPath>
      </defs>
      <path class="gq-back-body" d="M4 100 C 9 73, 27 62, 50 62 C 73 62, 91 73, 96 100 Z" />
      <ellipse class="gq-back-brim" cx="50" cy="34" rx="30" ry="7" clip-path="url(#gq-brim-right)" />
      <circle class="gq-back-head" cx="50" cy="38" r="25" />
      <path class="gq-back-cap" d="M25 37 a 25 25 0 0 1 50 0 l 0 3 l -50 0 Z" />
      <ellipse class="gq-back-squatchee" cx="50" cy="12.2" rx="3.15" ry="1.38" />
    </svg>
  </span>`;
}

function versusHtml(app, trainer) {
  const save = app.save;
  const theirs = scoutRows(trainer, save).length;
  const yours = managerFor(save).roster.length;
  // The pan runs once, when the screen opens. Paging through his dialog
  // rerenders this markup, and a slide that replayed under every line of
  // trash talk would stop being an entrance.
  return `<div class="gq-versus${app.screen.introPlayed ? "" : " gq-versus-enter"}">
    <span class="gq-versus-field"></span>
    <div class="gq-versus-row gq-versus-them">
      ${teamDots(theirs)}
      ${versusSprite(faceSeed(trainer), trainer.sprite)}
    </div>
    <div class="gq-versus-row gq-versus-you">
      ${playerSilhouette()}
      ${teamDots(yours)}
    </div>
  </div>`;
}

export const trainerIntroScreen = {
  render(app) {
    const trainer = trainerById(app.screen.trainerId);
    if (app.screen.mode === "scout") {
      const rows = scoutRows(trainer, app.save);
      const index = clampIndex(app.screen.scoutIndex ?? 0, rows.length);
      const selected = rows[index];
      return `<div class="gq-screen">
        <div class="gq-topbar"><span>SCOUTING ${escapeHtml(trainer.name)}</span><span>${buildNpcTeam(trainer, app.save).points} PT</span></div>
        <div class="gq-body"><div class="gq-columns">
          <div class="gq-frame gq-scroll">${menuHtml(rows.map((card) => ({ html: cardLine(card) })), index)}</div>
          <div class="gq-card-side">${selected ? cardPanelHtml(selected) : ""}</div>
        </div></div>
        <div class="gq-textbox"><p class="gq-dim">Hover or move the cursor to read a card. X to go back.</p></div>
      </div>`;
    }
    const beaten = timesBeaten(app.save, trainer.id) > 0;
    const dialog = trainer.dialog.intro;
    const onLastPage = app.screen.page >= dialog.length - 1;
    // Nobody talks during the walk-on: the plate with his name on it and the
    // first thing he says both wait until the two of you have stopped moving.
    const late = app.screen.introPlayed ? "" : " gq-intro-late";
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>${escapeHtml(trainer.title)}</span><span>${formatTag(trainer)}</span></div>
      <div class="gq-body gq-center">
        <div class="gq-frame gq-title-frame${late}">
          <b>${escapeHtml(trainer.name)}</b><br>
          <span class="gq-dim">TEAM BUDGET ${npcBudget(app.save, trainer)} PT &middot; PAYS $${rewardCoins(app.save, trainer)}${beaten ? " &middot; REMATCH RATE" : ""}</span>
        </div>
        ${versusHtml(app, trainer)}
      </div>
      <div class="gq-textbox${late}">
        <p>${escapeHtml(dialog[Math.min(app.screen.page, dialog.length - 1)])}</p>
        ${onLastPage
          ? menuHtml(
              [
                { label: "PLAY BALL", disabled: rosterProblems(app.save).length > 0 },
                { label: "SCOUT ROSTER" },
                { label: "SET LINEUP" },
                { label: "WALK AWAY" }
              ],
              app.screen.menuIndex ?? 0
            )
          : `<p class="gq-blink gq-right">&#9660;</p>`}
      </div>
    </div>`;
  },
  hoverCard(app, index) {
    if (app.screen.mode !== "scout") return null;
    return scoutRows(trainerById(app.screen.trainerId), app.save)[index] ?? null;
  },
  mounted(app) {
    if (app.screen.mode === "scout" || app.screen.introPlayed || app.screen.introRunning) return;
    // He is coming. The sting rides the walk-on, and his boots land on the frame
    // where the park shakes — see the timings in styles.css.
    playChallenge();
    const walkingOn = app.screen.trainerId;
    setTimeout(() => {
      // He may not be on the screen any more — a save reloaded, a screen changed.
      // Boots that land on an empty field are just a noise.
      if (app.screen.trainerId === walkingOn && app.screen.introRunning) playFootfall();
    }, INTRO_IMPACT_MS);
    // The entrance is spent when it has actually HAPPENED, not the instant the
    // screen is first painted. Marking it played in mounted looked right and was
    // fatal: mapScreen.key calls rerender() after item.run() has already gone to
    // this screen, so a second render landed in the same task — with the flag now
    // set, it dropped the animation class, and the browser never painted a single
    // frame of the walk-on. Nobody ever saw it.
    app.screen.introRunning = true;
    setTimeout(() => {
      app.screen.introPlayed = true;
      app.screen.introRunning = false;
      app.rerender();
    }, INTRO_MS);
  },
  key(app, key) {
    const trainer = trainerById(app.screen.trainerId);
    // Nothing you press hurries a man walking onto a field. Buttons are dead
    // until he is standing there — which also stops a keypress mid-walk-on from
    // rerendering the screen and restarting the animation from the top.
    if (app.screen.introRunning && app.screen.mode !== "scout") return;
    if (app.screen.mode === "scout") {
      const rows = scoutRows(trainer);
      if (key === "up" || key === "down") {
        app.screen.scoutIndex = clampIndex((app.screen.scoutIndex ?? 0) + (key === "down" ? 1 : -1), rows.length);
      } else if (key === "b" || key === "a") {
        app.screen.mode = null;
      }
      app.rerender();
      return;
    }
    const onLastPage = app.screen.page >= trainer.dialog.intro.length - 1;
    if (!onLastPage) {
      if (key === "a") app.screen.page += 1;
      else if (key === "b") app.go("map");
    } else if (key === "up" || key === "down") {
      app.screen.menuIndex = clampIndex((app.screen.menuIndex ?? 0) + (key === "down" ? 1 : -1), 4);
    } else if (key === "a") {
      const choice = app.screen.menuIndex ?? 0;
      if (choice === 0) {
        if (rosterProblems(app.save).length) return;
        return startTrainerBattle(app, trainer);
      }
      if (choice === 1) {
        app.screen.mode = "scout";
        app.screen.scoutIndex = 0;
      } else if (choice === 2) {
        return app.go("lineup", {
          index: 0,
          returnTo: "trainerIntro",
          returnData: { trainerId: trainer.id, page: app.screen.page, menuIndex: 0 }
        });
      } else {
        app.go("map");
      }
    } else if (key === "b") {
      app.go("map");
    }
    app.rerender();
  }
};
