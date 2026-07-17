# MLB Showdown MVP

A private local prototype for drafting real MLB Showdown cards, playing games with them, and simulating a season of them.

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

1. Start a draft room with manager names, a seed, and a card set. The five card sets are the same ones the adventure plays in:
   - **Classic Showdown** — every real MLB Showdown card, 2000-2005, with its printed chart, printed points, and printed card front.
   - **MLB: all time** — a century of real big leaguers rated on their whole careers.
   - **MLB: by decade** — real players rated on one decade's numbers; check the decades you want in the pool.
   - **MLB: by franchise** — one club's all-time roster, each player rated on his years there.
   - **Fictional players** — a made-up league invented fresh from the seed.

   The seed deals a deck out of the set, drawn down the rarity ladder so draft night has stars in it as well as scrubs. Cards, charts, points, and card art are shared with the adventure — the same Griffey card, wherever you meet him.
2. Choose 1–5 starting pitchers per team, then draft the resulting roster:
   - 9 hitters
   - Your configured number of starting pitchers (2 by default)
   - 2 bullpen pitchers
3. Fill a legal lineup:
   - C, 1B, 2B, 3B, SS, LF, CF, RF, DH
4. Click a player in the top roster board to move or swap eligible lineup slots.
5. Once every roster is legal, either play a game or simulate a season.
   - `Play a game as <you>` plays one nine-inning game against another manager, a plate appearance at a time: swing away, lay down a sacrifice, send a runner, walk the dangerous man on purpose, go to the pen, and send or hold on every hit. `Fast forward` hands both dugouts to the autopilot until the game gets interesting again — the 8th inning on, or a runner in scoring position in a close game. The opposing skipper manages by the same rules you do, so his arms tire and his runners run.
   - `Sim 1000 games` runs the season instead.
6. Watch the win-rate race unfold live: the sim is intentionally paced (about 15 seconds) with a line chart of each team's cumulative win percentage, a leader callout, and running tallies. It slows down near the finish for drama; `Fast forward` runs the same race at eight times the stride, and `Skip to results` jumps straight to the verdict. The final chart is saved with the results.
7. Review aggregate team, player, baserunning, and defensive stats normalized to 162-game pace. The games dropdown on the results screen re-runs with 100-5000 simulated games.
8. Stick around for the awards show: Sim MVP by win probability added, Cy Young and shutdown reliever by ERA, on-base machine, home run king, speed demon, run scorer, rally killer (most GIDP), steal and bust of the draft (pick number versus WPA finish), and the single biggest swing across the simulated games.

Draft rooms are saved in browser `localStorage`, which means saves are local to the browser and exact origin. For example, `127.0.0.1:5177` and `127.0.0.1:5178` do not share saved drafts.

## Online Play (multiple machines)

Local solo play works exactly as before. To draft with friends on other machines, one person hosts the app — `npm run serve` (port 5177) and `npm run online` (port 8790) are the same server and both include online rooms.

Then:

1. Open the app (e.g. `http://127.0.0.1:5177/index.html`) and click `Create online room` on the setup screen.
2. Share the invite link shown in the room banner (use your LAN IP or a tunnel, e.g. `http://192.168.1.20:8790/index.html?room=ab12cd`).
3. Each player opens the link and claims a manager seat; extra visitors can spectate.
4. Snake picks and auction nominations are turn-gated, and you can only edit your own lineup or submit your own auction bid. The room creator's seat is the host, and can skip auction review, resolve lots, auto-finish the draft, undo actions, or act for a stalled seat.
5. Once the draft completes, anyone can run `Sim 1000 games` locally — results are identical on every machine because all sims are seeded.

How it works: the server keeps an ordered log of draft actions per room and streams it to every browser over server-sent events. Each client rebuilds the identical draft by replaying the log through the same deterministic rules used in local play. For auctions, the server timestamps bids and publishes review and bid-clock expirations, so every machine uses the same ordering and timeout results.

Rooms persist to disk (one JSON file per room, `data/rooms/` by default, override with `ROOMS_DIR`), so drafts survive server restarts: the server replays each saved action log on boot and seat tokens keep working.

### Live auction rooms

Pick `Auction draft` on the setup screen before creating the room and the whole auction runs online. The nominator puts a card on the block, then every manager enters one sealed bid in seat order; the high bid wins and pays the second-highest bid plus one. A tie opens one sealed rebid round among the tied managers, and a second tie is a seeded coin flip, so every machine agrees on the winner.

Sealed bids are the one thing the room log cannot carry as it happens. The action stream reaches every browser, so a bid broadcast when it is placed is a bid the next bidder can read. Instead the server holds each lot's bids back: while the card is on the block the room is only told *who* has bid, and the amounts enter the log together the moment it sells — in the order they were placed, so every client still replays to the identical draft. Withheld bids are saved with the room, so a server restart mid-lot resumes the bidding rather than losing it.

Computer managers in an auction room play from the server rather than the host's browser: only the server can see the sealed lot, so only the server can bid into it. Turning the pick timer on gives each bid its own clock, and a manager who stalls is bid at their own willingness rather than freezing the lot.

### Hosting on the internet

For friends on different networks, either tunnel a locally running server (`cloudflared tunnel --url http://localhost:5177`) or deploy it. The server is one dependency-free Node process, so any Node/Docker host works — give it a persistent disk and point `ROOMS_DIR` at it. The repo ships a `Dockerfile` (listens on `$PORT`, default 8080, rooms under `/data/rooms`) and a `fly.toml` for Fly.io:

```bash
fly auth login
fly launch --copy-config --no-deploy   # first time only; pick an app name
fly volumes create rooms_data --size 1 # first time only
fly deploy
```

Static-only hosts (GitHub Pages, Netlify static) cannot run the rooms API.

## Current Status

Implemented:

- Five card sets, shared with the adventure: the real 2000-2005 Showdown cards, MLB all-time, MLB by decade, MLB by franchise, and a generated fictional league.
- One card face everywhere: a classic card renders its real printed scan, an MLB or fictional card the 2005 front, with photos hydrated from the MLB and Wikipedia image APIs.
- Hitter cards with position, fielding, on-base, speed, handedness, points, and d20 chart.
- Pitcher cards with role, control, IP, handedness, points, and d20 chart.
- Drafting with legal roster checks.
- Manual lineup assignment in the top roster board.
- LF/RF flexibility.
- Any hitter can play 1B out of position with literal `-1` fielding.
- Two starters and two bullpen pitchers per roster.
- Batch game simulation with starter rotation across games.
- Box scores and play-by-play.
- Singles, doubles, triples, homers, walks, strikeouts, popups, groundouts, and flyouts.
- Double-play attempts on ground balls.
- Tag-up attempts on fly balls.
- Extra-base attempts after singles and doubles.
- Steal attempts using catcher fielding.
- Bullpen planning, pitcher fatigue, extra innings, and run-charged fatigue penalties.
- Interactive single games with the full decision set (steal, sacrifice bunt, intentional walk, pitching changes, send-or-hold) and a fast-forward autopilot that returns the wheel at the leverage moments.
- Batch game simulator (`Sim 1000 games`): deterministic balanced matchup streams with win percentage, 162-game pace stats, per-player aggregate stats (AVG/OBP/SLG/OPS, RA/9, K/9, BB/9), and sim awards (MVP, ace, HR king).
- Duplicate manager names are auto-suffixed so standings and stats never merge two managers.
- A watchlist and a ranked big board per manager: star cards, put them in order, and an expired clock takes the top one still standing instead of guessing.
- The board says what the roster still needs and greys the cards that fill none of it.
- Cards pinned side by side, charts lined up by outcome and counted in faces of the die.
- Computer managers with archetypes — slugger, ace-first, bargain hunter, positional purist — that visibly draft different teams.
- A commissioner's whistle: pause a snake draft (the clock keeps its remaining time), and hand a stalled seat to the computer or back.
- A draft-order lottery, drawn last seat first.
- Instant draft grades when the last pick lands, and a recap naming the best value and the biggest reach, copyable as text.
- Export and import a room as a save file.
- A broadcast board for a second screen: the grid filling round by round, the live clock, and the pick landing with its card face.
- A synthesised sound kit (your turn, a pick, the ten-second warning, a starred card sniped, the last pick) with a mute switch, plus a browser notification and title badge when the clock comes to you.

Documented in more detail:

- [docs/rules.md](docs/rules.md)

## Important Gaps

Not implemented yet:

- Strategy cards.
- Hit-and-run.
- Pinch hitting (there is no bench concept yet).
- Official fielding checks beyond the simplified fielding sums currently used.
- Full official-rule verification by edition.
- Trades, in the draft or after it.
- Keeper leagues carrying rosters from one draft to the next.

Intentionally deprioritized for now:

- Bench players.
- Backup/secondary positions beyond current LF/RF flexibility and emergency 1B handling.

Known rough edges:

- A draft still lives in local browser storage by default; `Save room` writes it
  to a file you can keep or carry, but there is no server-side save.
- If you change ports, the browser's own save slot changes with it — the file
  does not.
- Generated cards are balanced for playability, not official card distribution accuracy.

## Project Layout

```text
card-lab.html                  Card mockup/testing page
docs/rules.md                  Current rules contract and research notes
index.html                     Main app shell
scripts/balance-sim.js         Draft/tournament balance simulation
scripts/serve.js               Zero-dependency static dev server (sends no-store headers)
src/app.js                     UI state, draft/game/batch screens, browser save logic
src/data/universes.js          The card sets both games share: pools, charts, prices, rarity, the draft deck
src/data/playerGeneration.js   Fictional card generation
src/rules/batch.js             Batch season simulation and aggregation
src/rules/battle/             The interactive game: pausable engine loop, fast forward, opposing-skipper AI
src/rules/cards.js             Card chart helpers
src/rules/draft.js             Draft, roster, lineup, repair logic
src/rules/game.js              Game simulation rules
src/rules/rng.js               Deterministic seeded RNG
src/rules/stats.js             Shared distribution/rate helpers
src/rules/tournament.js        Round-robin tournament simulation
src/ui/cardFace.js/.css        The printed card front, shared by both games
src/ui/gameScreen.js           The interactive game screen
src/ui/photos.js               Player portrait / club logo hydration
src/ui/playByPlay.js           The booth: engine events into broadcast lines
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
