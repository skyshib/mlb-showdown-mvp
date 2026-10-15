import { battleScreen, gameOverScreen } from "./battleScreen.js?v=20260716-records";
import { gameStatsScreen, gameStars } from "./statsScreens.js?v=20260716-records";
import { mountConsole } from "./console.js?v=20260716-records";
import { createBattle } from "../../rules/battle/controller.js?v=20260716-records";
import { buildBoxScore, inningsPlayed } from "../../rules/game.js?v=20260716-records";
import { gameFeats } from "../feats.js?v=20260716-records";
import { applyFranchisePalette } from "../../ui/franchisePalette.js?v=20260716-records";
import { hydratePhotos } from "../../ui/photos.js?v=20260716-records";
import { escapeHtml } from "./helpers.js?v=20260716-records";

// One game between two drafted rosters, on the adventure's console.
//
// The draft room used to play its exhibition in its own clothes — a panel of
// buttons and a feed of lines — which meant the game the whole site is about
// was played twice, two different ways, and the good version was the one you
// had to leave the room to find. This is the good version: the same handheld,
// the same board, the same menus, the same dice. The only thing that differs is
// what is on the other side of the table and what happens afterwards. There is
// no campaign behind it — no save, no coins, no ladder — so the game keeps
// nothing. It is a sitting: play it, read the box score, go back to the board.
//
// The draft room hands the matchup over in sessionStorage (see startGame in
// app.js): both managers with their rosters, the seed, and the league's colors.

const HANDOFF_KEY = "showdown-exhibition";
const DRAFT_ROOM = "./index.html";

function readMatchup() {
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Nothing to play — somebody opened the page on its own, or the tab that set
// the game up is gone. Say so, and point at the door.
function renderEmpty(root) {
  root.innerHTML = `<div class="gq-screen">
    <div class="gq-topbar"><span>EXHIBITION</span><span>NO GAME</span></div>
    <div class="gq-body gq-center">
      <div class="gq-frame gq-title-frame">
        <b>NO GAME DEALT</b>
        <p class="gq-mt gq-dim">PICK TWO CLUBS IN THE DRAFT ROOM AND PRESS PLAY A GAME.</p>
      </div>
    </div>
    <div class="gq-textbox"><p><a href="${DRAFT_ROOM}">&lsaquo; BACK TO THE DRAFT ROOM</a></p></div>
  </div>`;
}

const matchup = readMatchup();
const root = document.getElementById("app");

if (!matchup?.you || !matchup?.them) {
  renderEmpty(root);
} else {
  start(matchup);
}

function start({ you, them, seed, universe }) {
  // The league the draft was dealt from plays in its own colors here too; a
  // fictional or mixed board gets the house enamel.
  applyFranchisePalette(universe ?? null);

  // The opposing dugout is run by the balanced skipper — its arms tire and its
  // runners go under exactly the rules yours do. It stands in for the trainer
  // the campaign would have put there, which is where every screen reads the
  // other club's name from.
  const trainer = { id: null, name: them.name, aiProfile: "balanced" };
  const battle = createBattle({
    playerManager: you,
    npcManager: them,
    trainer,
    seed,
    playerIsAway: true
  });

  const lines = [
    `${them.name.toUpperCase()} host. One game, nothing on it but the game.`,
    "You're the visitors. Top 1 — grab a bat."
  ];

  // Every card in either dugout, so hovering a name — or a runner on a base —
  // floats his card. The campaign resolves these out of the collection; an
  // exhibition's cards were dealt by the draft and live nowhere else.
  const cards = new Map();
  for (const manager of [you, them]) {
    for (const card of manager.roster ?? []) cards.set(card.id, card);
  }

  const app = {
    // No campaign behind this game: nothing to stash it in, nothing to pay out,
    // nothing to record. Every screen that would have written to a save checks
    // for one first.
    save: null,
    screen: {
      name: "battle",
      trainerId: null,
      battle,
      lines,
      // The book opens with the words the game opens with.
      playLog: [{ half: "top", inning: 1, score: { away: 0, home: 0 }, lines }],
      menuIndex: 0,
      mode: "menu"
    },
    go(name, data = {}) {
      if (name === "exit") {
        window.location.href = matchup.returnTo ?? DRAFT_ROOM;
        return;
      }
      this.screen = { name, ...data };
      this.rerender();
    },
    rerender() {
      const screen = SCREENS[this.screen.name];
      if (!screen) return;
      root.innerHTML = screen.render(this);
      screen.mounted?.(this);
      // Real-player cards get their Wikipedia headshots filled in.
      hydratePhotos(root);
      // Rerendering resets scroll positions; keep the cursor row in view so
      // long lists (the rosters, the log) can actually be walked.
      root.querySelector(".gq-cursor")?.scrollIntoView({ block: "nearest" });
    }
  };

  // The last out is in the book. The campaign's FINAL screen hands off to coins,
  // badges and a series ledger; here it hands off to the box score and nothing
  // else, and the box score hands off to the door.
  const exhibitionGameOver = {
    ...gameOverScreen,
    key(a, key) {
      if (key !== "a" && key !== "b") return;
      const { battle: played, phase } = a.screen;
      const boxScore = buildBoxScore(played.state);
      const playerSide = played.playerSide;
      a.go("gameStats", {
        trainerId: null,
        opponent: them.name,
        boxScore,
        stars: gameStars(boxScore, playerSide),
        feats: gameFeats({
          boxScore,
          playerSide,
          events: played.events,
          score: phase.score,
          innings: inningsPlayed(played.state)
        }),
        events: played.events,
        score: phase.score,
        // The board the game was played on, so the box score can hang it back up.
        lineScore: played.state.lineScore,
        you: played.state[playerSide].name,
        playerSide,
        index: 0,
        next: { name: "exit", data: {} }
      });
    }
  };

  const SCREENS = {
    battle: battleScreen,
    gameOver: exhibitionGameOver,
    gameStats: gameStatsScreen
  };

  mountConsole({ app, screens: SCREENS, cardById: (id) => cards.get(id) ?? null });
  app.rerender();
}

// The name of the club you are managing, up on the shelf beside the way out —
// the one thing the console's own chrome cannot work out for itself.
if (matchup?.you) {
  const seat = document.querySelector("[data-exhibition-seat]");
  if (seat) seat.innerHTML = `Managing ${escapeHtml(matchup.you.name)}`;
}
