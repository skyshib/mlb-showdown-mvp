import { escapeHtml, menuHtml, clampIndex } from "./helpers.js";
import { TRAINERS, BADGES, trainerById, isTrainerUnlocked, isTrainerAvailable, rewardCoins } from "../region.js";
import { timesBeaten, managerFor, rosterPoints, pointCap } from "../state.js";
import { validateRoster } from "../../rules/draft.js";
import { startTrainerBattle } from "./battleScreen.js";

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
      run: (a) => startTrainerBattle(a, trainer)
    });
  }

  for (const trainer of TRAINERS) {
    const beaten = timesBeaten(save, trainer.id) > 0;
    const unlocked = isTrainerUnlocked(save, trainer);
    const available = isTrainerAvailable(save, trainer) && !save.activeSeries;
    const marker = beaten ? (trainer.repeatable ? "&#8635;" : "&#10003;") : formatTag(trainer);
    items.push({
      section: trainer.title.toUpperCase(),
      html: `${escapeHtml(trainer.name)} <span class="gq-dim">${unlocked ? marker : "LOCKED"}</span>`,
      disabled: !available,
      run: (a) => a.go("trainerIntro", { trainerId: trainer.id, page: 0 })
    });
  }

  items.push({ section: "CEDAR YARDS", label: "CARD SHOP", run: (a) => a.go("shop", { menuIndex: 0 }) });
  items.push({ section: "YOUR CLUB", label: "TEAM", run: (a) => a.go("team", { index: 0, mode: "roster" }) });
  items.push({ section: "YOUR CLUB", label: "BATTING ORDER", run: (a) => a.go("lineup", { index: 0 }) });
  items.push({ section: "YOUR CLUB", label: "BINDER", run: (a) => a.go("binder", { index: 0 }) });
  return items;
}

function formatTag(trainer) {
  const format = trainer.battleFormat;
  if (format.type === "simSeries") return `SIM BO${format.bestOf}`;
  if (format.type === "series") return `BO${format.bestOf}`;
  return "1 GAME";
}

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
        <span>${escapeHtml(save.player.name)}</span>
        <span>&#9679; ${save.player.coins} &middot; ${rosterPoints(save)}/${pointCap(save)} PT &middot; BADGES <span class="gq-badgeline">${badgeLine(save)}</span></span>
      </div>
      <div class="gq-body">${html}</div>
      <div class="gq-textbox">${
        problems.length
          ? `<p>! ROSTER NOT GAME-READY: ${escapeHtml(problems.join(", "))}. Fix it in TEAM.</p>`
          : `<p>Pick a place to go. Trainers pay coins; the gym pays a badge.</p>`
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
      const isBattle = item.run && (item.section?.includes("ROUTE") || item.section?.includes("GYM") || item.label?.includes("SERIES"));
      if (isBattle && rosterProblems(app.save).length) return;
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

export const trainerIntroScreen = {
  render(app) {
    const trainer = trainerById(app.screen.trainerId);
    const beaten = timesBeaten(app.save, trainer.id) > 0;
    const dialog = trainer.dialog.intro;
    const onLastPage = app.screen.page >= dialog.length - 1;
    return `<div class="gq-screen">
      <div class="gq-topbar"><span>${escapeHtml(trainer.title)}</span><span>${formatTag(trainer)}</span></div>
      <div class="gq-body gq-center">
        <div class="gq-frame gq-title-frame">
          <b style="font-size:6cqw">[${escapeHtml(trainer.sprite)}]</b><br>
          <b>${escapeHtml(trainer.name)}</b><br>
          <span class="gq-dim">TEAM BUDGET ${trainer.pointBudget} PT &middot; PAYS &#9679; ${rewardCoins(app.save, trainer)}${beaten && trainer.repeatable ? " (REMATCH)" : ""}</span>
        </div>
      </div>
      <div class="gq-textbox">
        <p>${escapeHtml(dialog[Math.min(app.screen.page, dialog.length - 1)])}</p>
        ${onLastPage
          ? menuHtml([{ label: "PLAY BALL" }, { label: "SET LINEUP" }, { label: "WALK AWAY" }], app.screen.menuIndex ?? 0)
          : `<p class="gq-blink gq-right">&#9660;</p>`}
      </div>
    </div>`;
  },
  key(app, key) {
    const trainer = trainerById(app.screen.trainerId);
    const onLastPage = app.screen.page >= trainer.dialog.intro.length - 1;
    if (!onLastPage) {
      if (key === "a") app.screen.page += 1;
      else if (key === "b") app.go("map");
    } else if (key === "up" || key === "down") {
      app.screen.menuIndex = clampIndex((app.screen.menuIndex ?? 0) + (key === "down" ? 1 : -1), 3);
    } else if (key === "a") {
      const choice = app.screen.menuIndex ?? 0;
      if (choice === 0) return startTrainerBattle(app, trainer);
      if (choice === 1) {
        return app.go("lineup", {
          index: 0,
          returnTo: "trainerIntro",
          returnData: { trainerId: trainer.id, page: app.screen.page, menuIndex: 0 }
        });
      }
      app.go("map");
    } else if (key === "b") {
      app.go("map");
    }
    app.rerender();
  }
};
