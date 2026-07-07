# Showdown Quest — Gameboy-Style Adventure Mode (Spec)

A single-player, Pokemon-Gameboy-flavored collection-and-battle campaign built on the
existing MLB Showdown engine. You start with a starter pack, travel a region map of
ballparks, battle NPC trainer-managers, and spend winnings on booster packs and
singles to build a championship roster.

Ships as **its own website** (separate URL/entry point) but lives in this repo and
imports the existing rules engine.

---

## 0. Decisions assumed (awaiting confirmation)

These were proposed as clarifying questions; the spec proceeds with the recommended
option for each. Any of them can be swapped without invalidating the rest.

| # | Decision | Status | Notes |
|---|----------|--------|-------|
| 1 | Overworld style | *Assumed*: **node map** — pixel region map, stadium nodes, arrow/click between unlocked nodes | Alternatives: full walkable tile overworld (most charm, ~3-5x the work); menu-only ladder |
| 2 | Battle format | **✓ Decided**: a **mix per trainer** — interactive 9-inning games (some standalone, some best-of series) *and* simulated series, depending on level/trainer. See §5.1 | — |
| 3 | Opponents | **✓ Decided**: **computer NPCs** for now | Async/live PvP deferred to post-v1 |
| 4 | Code separation | *Assumed*: **same repo, own entry point** (`adventure.html` → `src/adventure/`), deployed at its own URL | Alternatives: new repo with extracted engine package; fully standalone repo |
| 5 | Card pool | *Assumed*: **fictional generated players** (`playerGeneration.js`) so the campaign controls rarity/power bands; real-player packs as a later unlockable set | Alternative: real players from day one |
| 6 | Persistence | *Assumed*: **browser localStorage** with export/import save codes; no server required (static hosting works) | Alternative: server accounts |

---

## 1. Vision

> Pokemon Red, but every trainer is a rec-league manager, every gym is a ballpark,
> and your party is a 13-card MLB Showdown roster.

The emotional beats to hit, in priority order:

1. **The starter moment** — ripping open a sealed starter pack: two rares, eleven
   commons, a whole roster of strangers that's suddenly *your team*.
2. **Pack-opening dopamine** — earned, not purchased with real money; rarity reveal animation.
3. **Roster identity** — your team feels like *yours*; you know your cards' charts.
4. **Gym-badge progression** — each stadium boss has a personality and a signature
   team archetype that teaches a counter-strategy.
5. **The rival** — a recurring NPC whose team grows alongside yours.

Non-goals for v1: real-money anything, live multiplayer, mobile app, full tile
overworld, animation-heavy battle scenes.

---

## 2. Core loop

```
  ┌────────────────────────────────────────────────┐
  │ REGION MAP                                     │
  │  pick an unlocked node                         │
  └───────┬────────────────────────────────────────┘
          ▼
  challenge a trainer (route scout / gym leader / rival / farm opponent)
          ▼
  BATTLE — interactive game, interactive series, or simulated series
  depending on the trainer (§5.1)
  (win → coins + XP toward badge; lose → retry, small coin loss)
          ▼
  SHOP / PACKS  (buy boosters, buy singles, sell duplicates)
          ▼
  TEAM SCREEN   (roster + lineup management, existing legality rules)
          ▼
  back to map — badges unlock new nodes; first wins claim a card off the loser
```

Session shape: one interactive game ≈ 8–15 minutes (with fast-forward for
uncontested at-bats); a simulated series ≈ 2–3 minutes. A "route" of 2–3 scouts +
shop visit ≈ one sitting; a gym series spans sittings (progress saved mid-series).

---

## 3. Region, map, and progression

### 3.1 The Cascade League (working name)

A pixel-art region map of **8 towns**, each with a stadium (gym), connected by routes.
Rendered as a single illustrated screen with node markers — not a tile engine. Arrow
keys / d-pad move a cursor between adjacent unlocked nodes; Enter/A enters a node.

Each node contains:

- **Route scouts** (1–3 per route segment): one-off NPC trainers with small teams and
  flavor dialog. Beating each pays coins; beating all on a route pays a bonus pack.
- **Gym** (in towns): the boss battle. Requires all route scouts on the approach
  cleared (Pokemon's "trainers block the gym door" beat).
- **Shop** (in towns): packs + rotating singles (see §6).
- **Rival encounters** at scripted nodes (after badges 1, 3, 5, and pre-champion).

### 3.2 A flat cap and a rising boss ladder *(shipped)*

The player's roster budget is a **flat 3,500 printed points** for the whole
campaign — badges are trophies and unlock gates, not cap raises. The difficulty
spine is the **boss budget ladder** instead: trainer budgets climb from 2,500
through the 8,500-point summit and into a postseason that peaks at 10,000, so
late bosses out-spend the player nearly three-to-one.

| Trainer | Format | Budget |
|---------|--------|--------|
| Sandlot Kid Jojo (Route 1) | game | 2,500 |
| Rival Cam #1 (after Jojo) | game | 2,700 |
| Bleacher Prophet Mabel (Route 1) | game | 2,900 |
| Bench Boss Garrick (Ironwood Gym) | Bo3 | 3,700 |
| Rival Cam #2 (after Ironwood) | game | 4,200 |
| Ump-in-Exile Hollis (Route 2) | game | 4,500 |
| Salvage Queen Petra (Route 2) | game | 5,500 |
| Harbormaster Quince (Galehook Gym) | Bo3 | 6,500 |
| Rival Cam #3 (after Galehook) | Bo3 | 6,800 |
| Night-Train Sawyer (Route 3) | game | 7,500 |
| Commissioner Vale (Summit Gym) | Bo3 | 8,500 |
| October Gatekeeper Ivy (**Division Series**) | Bo5 | 9,000 |
| Pennant Shark Okabe (**Championship Series**) | Bo7 | 9,500 |
| Rival Cam #4 (before the World Series) | Bo3 | 9,800 |
| Mr. November Graves (**World Series**) | Bo7 | 10,000 |

The **rival** (Cam, a fellow rookie who opened a starter pack the same day)
reappears at milestones with a richer roster each time, Pokemon-style. Beating
the checkbook is possible because **printed prices are noisy** (§4.2): a
3,500-point roster of scouted bargains can carry far more true value than it
costs. Two other ratchets help the climb: the first win over any trainer
**claims one card of the player's choice off the beaten roster** (the claim
screen shows your own cards at that slot for comparison), and gym wins pay packs.

Time is tracked in **days: every game played is one day**. The map header shows
the current day, and winning the World Series ends on a championship review —
season length in days, battle record, packs ripped, and the season's WPA MVPs.

### 3.3 Trainer definitions

NPC trainers are **data, not code** — one authored JSON-ish module per region area:

```js
{
  id: "gym3-boomer-vance",
  name: "BOOMER VANCE",
  sprite: "slugger-coach",
  dialog: { intro: [...], win: [...], lose: [...] },
  teamSeed: "gym3-v1",          // deterministic team build
  pointBudget: 4000,
  archetype: "power",           // biases the team-builder's card selection
  aiProfile: "aggressive",      // see §5.4
  battleFormat: { type: "series", bestOf: 3 },   // or { type: "game" } or
                                                 // { type: "simSeries", bestOf: 7 }
  repeatable: false,            // simSeries farm opponents set true
  rewards: { coins: 900, pack: "series1", badge: 3 }
}
```

Teams are built at content-authoring time (or lazily, deterministically) by a
`buildNpcTeam(archetype, pointBudget, seed)` helper that reuses `autopick`/valuation
logic from `src/rules/draft.js` against a generated card pool, then hand-tweaked where
a boss needs a signature card.

---

## 4. Collection

### 4.1 Starter pack *(shipped)*

New save flow:

1. Professor-style intro NPC ("Professor Oakmont, the region's scorekeeper").
2. Player rips open a **sealed starter pack** — like the real MLB Showdown starter
   product: a full legal 13-card roster (nine bats covering every position plus a
   DH slot, two starters, two relievers) containing **exactly 2 rares and 11
   commons**, randomized per save (which slots get the rares is part of the luck).
   Cards reveal one at a time, then it's straight to the map.

### 4.2 The card universe, pricing, and packs *(shipped)*

Each save generates its **own ~3,000-card universe** from the save seed
(`setUniverseSeed` in `packs.js`) — a new game is always a fresh league, so runs
don't get repetitive. Within a universe:

- **True value** comes from a card's strength rank within its group (hitters /
  SP / RP), mapped onto a convex curve from ~90 up to 900 points. **Rarity follows
  true strength** (top 7% legend, next 11% rare, next 12% uncommon, rest common).
- **Printed points** — what roster caps and NPC budgets actually pay — are true
  value ±35% seeded noise. Some cards are steals, some are rip-offs; scouting the
  actual chart beats reading the sticker. Calibration: an even-rarity 13-card
  roster costs ≈ 5,000 printed points — well above the 3,500-point cap, so you
  cannot buy even average depth at sticker price.
- **Booster pack** (5 cards, 500 coins): four *wild* slots that can land anywhere
  (common 58% / uncommon 27% / rare 12% / legend 3%) plus one *hit* slot that's
  always uncommon-or-better (uncommon 62% / rare 30% / legend 8%). Duds and
  jackpots both happen — packs are a gamble, not a guaranteed upgrade.

Pack pulls are seeded per-open (`saveSeed + packCounter`) — deterministic per save,
different across saves, savescumming-resistant.

### 4.3 Binder, duplicates, currency

- **Binder screen**: full collection, filter/sort by position, rarity, points, set.
- Duplicates can be **sold** for coins (sell value ≈ 25–35% of shop-single price).
- v1 has one currency (**coins**). No dust/craft system yet — singles in shops cover
  the "I need a catcher" problem that pure-gacha economies have.

---

## 5. Battles

### 5.1 Formats

Each trainer declares one of three battle formats (`battleFormat` in the trainer
data, §3.3). The mix escalates stakes and time investment with progression:

| Format | What it is | Typical use | Time |
|--------|-----------|-------------|------|
| `game` | One interactive 9-inning game, at-bat-by-at-bat | Route scouts, rival early encounters | ~8–15 min |
| `series` | Interactive best-of-N (3 or 5); every game played out; rotation carries across games (SP1/SP2, fatigue/usage persists within the series) | Gym leaders, late rival fights, Pennant Series | one game per sitting; series progress saved between sessions |
| `simSeries` | Simulated best-of-N (or fixed-length set, e.g. "take 4 of 6") using the batch engine, shown as a dramatic paced play-by-play race like the existing sim viewer; you manage roster/lineup/rotation *before* it runs, not during | Filler/farm opponents, roadhouse "weekend series" money games, rematch grinding | ~2–3 min |

Design intent: interactive formats are where decisions and tension live; `simSeries`
is the coin-earning grind loop and shows off team-building strength rather than
in-game managing. Early routes are mostly `game`; gyms are `series`; each town also
offers a repeatable `simSeries` opponent so players can farm coins without replaying
long interactive games.

For interactive play, the existing engine already exposes the right seams:
`createInitialState`, `playPlateAppearance`, `playStealAttempt`, and the fatigue /
bullpen model in `src/rules/game.js`. The adventure layer wraps these in a
**pause-for-decision** loop instead of the batch runner's auto-resolve. `simSeries`
reuses the batch simulation path (`src/rules/batch.js`) with a small series wrapper
(win-condition + game count instead of fixed 1000 games).

### 5.2 Battle screen

```
┌──────────────────────────────────┐
│ BOOMER VANCE          ⚾ TOP 7th │
│ ▔▔▔▔▔▔▔▔▔▔▔▔▔▔        THEM 3    │
│   [pitcher sprite]     YOU  2    │
│   ◆◇◇ outs      1B·2B·3B bases  │
│ ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁ │
│ J.RODRIGUEZ steps in.            │
│ Runner on 2nd, 1 out.            │
│ ▸SWING AWAY   ▸STEAL             │
│ ▸PITCHING CHG ▸FAST-FORWARD      │
└──────────────────────────────────┘
```

- Text box narrates play-by-play (engine already produces it).
- Diamond widget shows baserunners; HP-bar visual repurposed as **pitcher stamina**
  (the fatigue model), which is the most Pokemon-feeling stat in the engine.
- **Fast-forward** auto-resolves until the next leverage moment (runner in scoring
  position, pitching-change window, 8th inning onward) so games don't drag.

### 5.3 Player decisions (v1)

Shipped decision set:

| Decision | Engine seam | When offered |
|----------|-------------|--------------|
| Steal attempt (per runner) | `stealCandidates` / `attemptSteal` | runner on, before PA resolves |
| Sacrifice bunt | `canBunt` / `attemptBunt` | runner on 1st/2nd, none on 3rd (no squeeze), fewer than two outs |
| Intentional walk | `intentionalWalk` | any time your side pitches |
| Pitching change | `changePitcher`, manual via `state.manualPitchingFor` (no auto-substitution for the player) | between batters when your side pitches |
| Send / hold runners on hits | `state.deferAdvancesFor` pauses the play; `resolveAdvanceDecision` finishes it | every hit that creates an extra-base chance |
| Tag-up attempt | same deferred-advance seam | every fly ball with a runner in position |
| Batting order | `battingOrder` on the manager, editable in the club and before games | outside battles (persists as the default) |

Runners send lead-first: a trailing runner can only go if everyone ahead of him
goes. Fast-forward switches all of these back to the decision-matrix autopilot
(and manages your pen at fatigue 2) until the next leverage moment.

Deferred (engine gaps, listed in README): hit-and-run, pinch-hitting (no bench
concept yet), strategy cards. The decision-hook interface should be designed so these
slot in later without reworking the battle UI.

### 5.4 NPC AI

Simple profile-driven policies over the same decision set:

- `conservative` — steals only with speed A, pulls starters early.
- `aggressive` — sends runners liberally, rides starters into fatigue.
- `bullpen-savvy` — optimal-ish pitching changes (reuse batch sim's bullpen logic).

Profiles are a table of thresholds, not a search algorithm. Gym leaders get one
signature behavior each ("Boomer never bunts; he swings for it").

### 5.5 Determinism and fairness

Every battle runs on a seed derived from `saveSeed + battleId + attemptNumber` (for
series: `+ gameNumber`), so a rematch after a loss is a *different* game (attempt is
salted) but any single game is reproducible for debugging. A series loss restarts the
whole series on the next attempt. Losses cost a small coin fee ("you scurried back to the
clubhouse…") and never cost cards.

### 5.6 Stats and stars

Every interactive game ends on a box-score screen: three stars of the game (both
teams, ranked by WPA), then batting and pitching lines for each side. Every row
leads with its signed WPA percent (10%+ swings in bold), and the textbox legend
explains the number. A full **game log** is one keypress away: GAME LOG in the
battle menu during play, and &#8592;/&#8594; on the box-score screen after — every
play with inning, actor, result, score, and its WPA signed from the player's side
(the opponent's big rally reads negative). Box-score lines are keyed by side as well as card id, so a
card appearing in both lineups keeps separate home and away stat lines. Sim-series
reveal rows carry each game's top-swing star. Every game — interactive or simmed —
also folds the player's team lines into `save.seasonStats`, viewable at YOUR CLUB →
SEASON STATS with the batch sim's rate stats (AVG/OBP/SLG/OPS; IP, RA9, K) plus each
card's cumulative season WPA, shown with the same signed-percent treatment as the
box-score screen. The field grows in place on older saves; no version bump.

---

## 6. Economy (initial tuning targets)

| Item | Price (coins) |
|------|--------------|
| Booster pack | 500 |
| Premium pack | 1,200 |
| Shop single: common / uncommon / rare / epic | 150 / 400 / 900 / 2,000 |
| Route scout win (interactive game) | 150–300 |
| Farm opponent simSeries win (repeatable) | 100–200, diminishing on repeats |
| Gym series win | 800–1,500 + 1 free pack |
| Rival win | 500 + 1 free pack |
| Duplicate sale | ~30% of single price |

Target pacing: a player who clears each route can afford **~2 packs per town** plus
one targeted single — enough to feel roster growth every badge without trivializing
the point cap. Validate with a headless campaign simulation (bot plays greedily,
assert cap-vs-collection-strength curve stays in band) — same philosophy as the
existing `balance-sim`.

---

## 7. Presentation

- **Palette**: authentic DMG 4-shade green (`#0f380f #306230 #8bac0f #9bbc0f`) as the
  base theme; an unlockable "Game Boy Color" palette post-badge-4 as a delight.
- **Type**: pixel font (self-hosted bitmap-style webfont, e.g. "Press Start 2P"–like;
  must be bundled, not CDN'd).
- **Resolution discipline**: the whole app renders in a fixed 160×144-proportioned
  stage scaled up integer-multiples, letterboxed — this single constraint does most
  of the aesthetic work.
- **Cards in battle** render as simplified pixel "mini-cards"; the full existing 2005
  card style appears in the binder/pack-opening screens (contrast is a feature: packs
  feel like opening *real* cards inside a Gameboy world).
- **Sprites**: a small authored set — ~10 trainer portraits, 1 player avatar,
  stadium node icons. Pixel-art PNGs in `mockup-assets/adventure/`.
- **Sound** (v1.1, not v1): chiptune loop per area + battle jingle, muted by default.
- **Input**: full keyboard (arrows/Z/X = d-pad/A/B) and mouse/touch parity.

---

## 8. Technical design

### 8.1 Placement

```
adventure.html                    New entry point (own website; deploy target)
src/adventure/
  main.js                         Boot, save load, screen router
  state.js                        Save schema, reducers, localStorage + export codes
  region.js                       Map data: nodes, routes, unlock rules
  trainers/                       Authored NPC/gym/rival data modules
  npcTeams.js                     buildNpcTeam(archetype, budget, seed)
  packs.js                        Pack tables, seeded pull logic, shop inventory
  battle/
    controller.js                 Decision-pause loop wrapping src/rules/game.js
    ai.js                         NPC decision profiles
    view.js                       Battle screen rendering
  ui/                             Map, shop, binder, team, pack-opening screens
  styles.css                      DMG theme (independent of src/styles.css)
test/adventure/                   Node tests: economy, unlocks, save migration,
                                  battle-controller determinism, npc team legality
```

**Rules engine is imported, never forked.** New engine needs (decision hooks for
send-runner/tag-up, manual pitching change) are added to `src/rules/game.js` as
opt-in hooks so batch sim behavior is byte-identical when hooks are absent —
guarded by existing tests.

### 8.2 Save schema (localStorage, versioned)

```js
{
  version: 2,                       // v2: per-save universes, flat cap, starter packs
  saveSeed: "…",                    // master seed; the card universe and all RNG derive from it
  player: { name, avatar, coins, badges: [] },   // point cap is a flat 5000
  collection: { [cardId]: count },  // cards are pool-generated; pool seed stored
  roster: { cardIds: [], lineup: {} },   // validated by existing draft.js rules
  progress: { nodesUnlocked, scoutsBeaten, rivalStage, counters: { packsOpened, … } },
  activeSeries: null | { battleId, attempt, wins, losses, nextGame,
                         rotationState },  // mid-series save/resume (§5.1)
  log: [ …recent battle results… ]
}
```

Export/import as a compressed base64 code (copy-paste, no server). Version field +
migration function from day one.

### 8.3 Deployment

Pure static site — no rooms server needed. `scripts/serve.js` already serves the
repo; `adventure.html` just works locally. For its own public URL: any static host
(GitHub Pages / Netlify / a second Fly app or a path on the existing one). Decision
deferred until v1 is playable.

---

## 9. Milestones

**M1 — Vertical slice (the proof):** starter flow → 1 route with 2 scouts
(interactive `game`) → 1 farm opponent (`simSeries`) → 1 gym (best-of-3 `series`) →
shop with booster packs → binder + team screen. One town, DMG theme, full battle
controller with steal + pitching-change decisions, mid-series save/resume.
*Everything risky is in M1 — all three battle formats included deliberately.*

**M2 — The region:** all 8 towns/gyms, rival arc, point-cap progression, themed
packs, singles shop, economy balance sim, save export/import.

**M3 — Finale + polish:** Pennant Series + Champion, pack-opening animation,
GBC palette unlock, sound, post-game rematches (scaled-up gym rematch teams).

**Later / explicitly out of v1:** async PvP (import a friend's save-code team as a
wandering trainer — cheap and high-value, likely first post-v1 feature), real-player
card set unlock, walkable tile overworld, strategy cards once the engine grows them.

---

## 10. Open questions (beyond the §0 defaults)

1. **Series sizes**: best-of-3 for all gyms, or escalate (Bo3 early gyms → Bo5 late
   gyms → Bo7 Pennant Series/Champion)? Leaning escalate.
2. **Losing stakes**: coin fee only (assumed), or Nuzlocke-style optional hard mode?
3. **Roster floor**: should the point cap also have a *floor* to stop cheesing gyms
   with under-cap all-star compression? (Probably unnecessary — cap is a max and NPC
   budgets scale — but flagging.)
4. **Naming**: "Showdown Quest" is a placeholder. Also needs a region name.
5. **Card art**: fictional players currently have generated identities — do we want
   pixel headshot generation for the mini-cards, or silhouette placeholders in v1?
