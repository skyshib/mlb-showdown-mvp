import { escapeHtml, menuHtml, clampIndex, cardLine, cardPanelHtml } from "./helpers.js?v=20260713-r";
import { TRAINERS, BADGES, trainerById, isTrainerUnlocked, isTrainerAvailable, rewardCoins, npcBudget, pendingAmbush, ambushSprung, springAmbush, ambushDone } from "../region.js?v=20260713-r";
import { timesBeaten, managerFor, rosterPoints, pointCap, ensureSeasonStats, persistSave } from "../state.js?v=20260713-r";

// "1973/3500 PT" under the cap; uncapped saves just count.
export function pointsLabel(save) {
  const cap = pointCap(save);
  return Number.isFinite(cap) ? `${rosterPoints(save)}/${cap} PT` : `${rosterPoints(save)} PT &middot; UNCAPPED`;
}
import { dayWhimsy } from "../feats.js?v=20260713-r";
import { validateRoster } from "../../rules/draft.js?v=20260713-r";
import { buildNpcTeam } from "../npcTeams.js?v=20260713-r";
import { startTrainerBattle } from "./battleScreen.js?v=20260713-r";

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
    const marker = beaten ? (trainer.repeatable ? "&#8635;" : "&#10003;") : formatTag(trainer);
    items.push({
      section: trainer.title.toUpperCase(),
      html: `${escapeHtml(trainer.name)} <span class="gq-dim">${unlocked ? marker : "LOCKED"}</span>`,
      disabled: !available,
      battle: true,
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
        <div class="gq-frame gq-title-frame">
          <b style="font-size:8cqw">&gt;:(</b><br>
          <b style="font-size:5cqw">[${escapeHtml(rival.sprite)}]</b><br>
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

export const mapScreen = {
  render(app) {
    const save = app.save;
    const items = mapItems(app);
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
        <span>&#9679; ${save.player.coins} &middot; ${pointsLabel(save)} &middot; BADGES <span class="gq-badgeline">${badgeLine(save)}</span></span>
      </div>
      <div class="gq-body">${html}</div>
      <div class="gq-textbox">${
        problems.length
          ? `<p>! ROSTER NOT GAME-READY: ${escapeHtml(problems.join(", "))}. Fix it in TEAM.</p>`
          : `<p>${escapeHtml(dayWhimsy(ensureSeasonStats(save).games + 1) ?? "Pick a place to go. Trainers pay coins; the gym pays a badge.")}</p>`
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
          <div>${selected ? cardPanelHtml(selected) : ""}</div>
        </div></div>
        <div class="gq-textbox"><p class="gq-dim">Hover or move the cursor to read a card. X to go back.</p></div>
      </div>`;
    }
    const beaten = timesBeaten(app.save, trainer.id) > 0;
    const dialog = trainer.dialog.intro;
    const onLastPage = app.screen.page >= dialog.length - 1;
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>${escapeHtml(trainer.title)}</span><span>${formatTag(trainer)}</span></div>
      <div class="gq-body gq-center">
        <div class="gq-frame gq-title-frame">
          <b style="font-size:6cqw">[${escapeHtml(trainer.sprite)}]</b><br>
          <b>${escapeHtml(trainer.name)}</b><br>
          <span class="gq-dim">TEAM BUDGET ${npcBudget(app.save, trainer)} PT &middot; PAYS &#9679; ${rewardCoins(app.save, trainer)}${beaten && trainer.repeatable ? " (REMATCH)" : ""}</span>
        </div>
      </div>
      <div class="gq-textbox">
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
  key(app, key) {
    const trainer = trainerById(app.screen.trainerId);
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
