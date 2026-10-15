import { loadSave, hydrateUniverse, persistSave } from "./state.js?v=20260716-records";
import { cardById } from "./packs.js?v=20260716-records";
import { hydratePhotos } from "../ui/photos.js?v=20260716-records";
import { applyFranchisePalette } from "../ui/franchisePalette.js?v=20260716-records";
import { titleScreen, introScreen, nameEntryScreen, leagueSelectScreen, modeSelectScreen,
  formatSelectScreen,
  tierSelectScreen, starterRevealScreen, exportSaveScreen, importSaveScreen } from "./ui/titleScreens.js?v=20260716-records";
import { mapScreen, trainerIntroScreen, ambushScreen } from "./ui/mapScreen.js?v=20260716-records";
import { battleScreen,
  rotationDrawScreen, gameOverScreen, seriesBreakScreen, battleResultScreen, simSeriesScreen, claimCardScreen, resumeBattle } from "./ui/battleScreen.js?v=20260716-records";
import { shopScreen, sellScreen, binderScreen, teamScreen, lineupScreen, packOpenScreen, catalogScreen, compareScreen } from "./ui/collectionScreens.js?v=20260716-records";
import { gameStatsScreen, seasonStatsScreen, championshipScreen, almanacScreen, trophyScreen } from "./ui/statsScreens.js?v=20260716-records";
import { hallOfFameScreen, hofTeamScreen } from "./ui/hallOfFameScreen.js?v=20260716-records";
import { recordsScreen } from "./ui/recordsScreen.js?v=20260716-records";
import { mountConsole } from "./ui/console.js?v=20260716-records";
import { track, trackSession } from "../ui/telemetry.js?v=20260915-visits";

const SCREENS = {
  title: titleScreen,
  intro: introScreen,
  nameEntry: nameEntryScreen,
  leagueSelect: leagueSelectScreen,
  modeSelect: modeSelectScreen,
  formatSelect: formatSelectScreen,
  tierSelect: tierSelectScreen,
  starterReveal: starterRevealScreen,
  exportSave: exportSaveScreen,
  importSave: importSaveScreen,
  map: mapScreen,
  trainerIntro: trainerIntroScreen,
  ambush: ambushScreen,
  battle: battleScreen,
  rotationDraw: rotationDrawScreen,
  gameOver: gameOverScreen,
  seriesBreak: seriesBreakScreen,
  battleResult: battleResultScreen,
  simSeries: simSeriesScreen,
  claimCard: claimCardScreen,
  shop: shopScreen,
  sell: sellScreen,
  catalog: catalogScreen,
  binder: binderScreen,
  compare: compareScreen,
  almanac: almanacScreen,
  trophies: trophyScreen,
  team: teamScreen,
  lineup: lineupScreen,
  packOpen: packOpenScreen,
  gameStats: gameStatsScreen,
  seasonStats: seasonStatsScreen,
  championship: championshipScreen,
  hallOfFame: hallOfFameScreen,
  hofTeam: hofTeamScreen,
  records: recordsScreen
};

const KEY_MAP = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Enter: "a",
  z: "a",
  Z: "a",
  Escape: "b",
  x: "b",
  X: "b",
  Backspace: "b"
};

// Setting up a new game belongs to no club: the old save is still loaded until
// the new league is picked, and these are the screens where you pick it.
const SETUP_SCREENS = new Set(["intro", "nameEntry", "leagueSelect", "modeSelect", "formatSelect", "tierSelect"]);

// Screens in the middle of handing something over. A game in progress is written
// to the save after every decision, so walking out of one costs nothing — but
// these are the screens where the game has ended and the winnings have not all
// landed yet: a card to claim off the roster you just beat, a pack still sealed,
// a box score on its way to either. None of that is in the save, so there is no
// door on these screens; they are a few keypresses long and they end at the map.
const NO_EXIT_SCREENS = new Set([
  "gameStats",
  "seriesBreak",
  "battleResult",
  "simSeries",
  "claimCard",
  "packOpen",
  "starterReveal",
  "championship"
]);

const app = {
  save: loadSave(),
  screen: { name: "title", menuIndex: 0 },
  go(name, data = {}) {
    this.screen = { name, ...data };
    this.rerender();
  },
  rerender() {
    const root = document.getElementById("app");
    // A franchise league plays on the club's colors. Every other league — and
    // the title screen, before there is a save to ask — clears the tokens and
    // gets the stylesheet's own enamel back.
    //
    // Starting a new game is the exception. The old save is still loaded all the
    // way through the setup — the new one is not written until the league has
    // been chosen — so the screens where you choose it would otherwise be dressed
    // in the colors of the club you are leaving, and you would pick the Mets on a
    // Mariners page. Setting up a game belongs to no club, so it is shown in none.
    applyFranchisePalette(SETUP_SCREENS.has(this.screen.name) ? null : this.save?.universe);
    const screen = SCREENS[this.screen.name] ?? titleScreen;
    // Two doors, one shelf. On the title screen the way out is out of the PAGE,
    // back to the draft room — a browser link, which is exactly what it should
    // be there and has no business hanging over a man at the plate. In a game it
    // is the way out of the GAME: back to the front door, with the inning you
    // were in kept in the save and CONTINUE standing ready to put you back in it.
    const inGame = this.screen.name !== "title";
    document.querySelector(".gq-exit:not(.gq-quit)")?.toggleAttribute("hidden", inGame);
    document.querySelector(".gq-quit")?.toggleAttribute("hidden", !inGame);
    document.querySelector(".gq-corner")?.toggleAttribute("hidden", NO_EXIT_SCREENS.has(this.screen.name));
    root.innerHTML = screen.render(this);
    screen.mounted?.(this);
    // Real-player cards get their Wikipedia headshots filled in.
    hydratePhotos(root);
    // Rerendering resets scroll positions; keep the cursor row in view so
    // long lists (rosters, binder) can actually be walked.
    root.querySelector(".gq-cursor")?.scrollIntoView({ block: "nearest" });
  }
};

// Every save lives in its own card universe. Point the pool at the loaded save
// before anything renders a card: install its stored cards if it has them, or —
// for a save made before universes were snapshotted — freeze the pool it shows
// today so it stops re-rolling under generator changes. A freeze is persisted at
// once so it survives the next reload.
if (app.save) {
  if (hydrateUniverse(app.save)) app.save = persistSave(app.save);
  // A game left running is a game you are still in the middle of. Reloading the
  // tab — or closing it and coming back tomorrow — puts you back at the plate,
  // in the same inning, against the same arm, with the same men on.
  const resumed = resumeBattle(app);
  if (resumed) app.screen = resumed;
}

// The way out of a game, from inside it. Nothing is saved on the way through
// because there is nothing left to save: a game in progress is written to the
// save after every decision (see stashBattle), and every other screen writes as
// it changes things. So the front door is one press away, and so is the way back
// — CONTINUE re-deals the exact inning you walked out of.
document.querySelector(".gq-quit")?.addEventListener("click", () => {
  app.go("title", { menuIndex: 0 });
});

mountConsole({ app, screens: SCREENS, cardById });

trackSession();
// Whose save this browser holds, so a returning campaign has a name on it.
if (app.save) {
  track("adventure-open", {
    name: app.save.player?.name ?? "",
    saveSeed: app.save.saveSeed ?? "",
    universe: app.save.universe ?? "",
    mode: app.save.mode ?? "",
    battlesWon: app.save.progress?.counters?.battlesWon ?? 0,
    battlesLost: app.save.progress?.counters?.battlesLost ?? 0
  });
}

app.rerender();
