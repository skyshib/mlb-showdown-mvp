# MLB Showdown MVP

A private local prototype for drafting fictional MLB Showdown-style cards and simulating a round-robin tournament.

This is not trying to be a polished public clone yet. The current goal is to make a playable MVP, keep the rules explicit, and gradually replace approximations with official MLB Showdown mechanics as we verify them.

## Quick Start

Run the app locally:

```bash
npm run serve
```

Then open:

```text
http://127.0.0.1:5177/index.html
```

Run tests:

```bash
npm test
```

Run the balance simulation:

```bash
npm run balance
```

## How To Play

1. Start a draft room with manager names and a seed.
2. Draft 13 cards per team:
   - 9 hitters
   - 2 starting pitchers
   - 2 bullpen pitchers
3. Fill a legal lineup:
   - C, 1B, 2B, 3B, SS, LF, CF, RF, DH
4. Click a player in the top roster board to move or swap eligible lineup slots.
5. Click `Sim tournament` once every roster is legal.
6. Review standings, team rosters, box scores, and play-by-play.

Draft rooms are saved in browser `localStorage`, which means saves are local to the browser and exact origin. For example, `127.0.0.1:5177` and `127.0.0.1:5178` do not share saved drafts.

## Current Status

Implemented:

- Fictional generated player pool with broad name variety.
- Hitter cards with position, fielding, on-base, speed, handedness, points, and d20 chart.
- Pitcher cards with role, control, IP, handedness, points, and d20 chart.
- Drafting with legal roster checks.
- Manual lineup assignment in the top roster board.
- LF/RF flexibility.
- Any hitter can play 1B out of position with literal `-1` fielding.
- Two starters and two bullpen pitchers per roster.
- Tournament simulation with starter rotation across games.
- Box scores and play-by-play.
- Singles, doubles, triples, homers, walks, strikeouts, popups, groundouts, and flyouts.
- Double-play attempts on ground balls.
- Tag-up attempts on fly balls.
- Extra-base attempts after singles and doubles.
- Steal attempts using catcher fielding.
- Bullpen planning, pitcher fatigue, extra innings, and run-charged fatigue penalties.
- New card visual style in the 2005-strip direction with rarity borders.

Documented in more detail:

- [docs/rules.md](docs/rules.md)

## Important Gaps

Not implemented yet:

- Strategy cards.
- Sacrifice bunts.
- Hit-and-run.
- Manual pitching changes.
- Manager strategy controls.
- Official fielding checks beyond the simplified fielding sums currently used.
- Full official-rule verification by edition.
- Multiplayer or shared remote draft state.
- Export/import save files.

Intentionally deprioritized for now:

- Bench players.
- Backup/secondary positions beyond current LF/RF flexibility and emergency 1B handling.

Known rough edges:

- Saved drafts are only in local browser storage.
- If you change ports, you are effectively using a different save slot.
- Generated cards are balanced for playability, not official card distribution accuracy.

## Project Layout

```text
card-lab.html                  Card mockup/testing page
docs/rules.md                  Current rules contract and research notes
index.html                     Main app shell
scripts/balance-sim.js         Draft/tournament balance simulation
src/app.js                     UI state, draft/tournament screens, browser save logic
src/data/playerGeneration.js   Fictional card generation
src/rules/cards.js             Card chart helpers
src/rules/draft.js             Draft, roster, lineup, repair logic
src/rules/game.js              Game simulation rules
src/rules/rng.js               Deterministic seeded RNG
src/rules/tournament.js        Round-robin tournament simulation
src/ui/render.js               Card/table/box-score rendering
test/                          Node test suite
```

## Collaboration Workflow

This repo is private on GitHub:

```text
https://github.com/kaseshib/mlb-showdown-mvp
```

Before making changes:

```bash
git fetch origin
git status --short --branch
```

If remote changes exist, pull/rebase before editing.

After changes:

```bash
npm test
git add .
git commit -m "Short descriptive message"
git push
```

Default Codex workflow for this project:

1. Check whether collaborators pushed changes.
2. Pull/rebase if needed.
3. Make the requested change.
4. Run tests.
5. Commit.
6. Push.

If there is a conflict, stop and resolve it deliberately instead of overwriting someone else's work.
