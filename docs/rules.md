# Showdown MVP Rules

This file is the simulator contract for the first build. It is intentionally narrower than full MLB Showdown.

## Current Research Baseline

MLB Showdown used a d20, hitter cards, pitcher cards, and strategy cards. A plate appearance starts with a control check, then a second d20 roll is read on either the pitcher chart or hitter chart.

The card fields we model:

- Hitters: position, fielding, on-base, speed, handedness, point value, result chart.
- Pitchers: role, control, IP, handedness, point value, result chart.

Edition changes we still need to verify before locking a public rules claim:

- 2001 added more baserunning choices.
- 2002 changed on-base values.
- 2003 added card icons.

## Generated Card Model

The current player pool is fictional and generated from distributions in `src/data/playerGeneration.js`. This is not an official MLB Showdown card distribution, and there are no fixed hitter or pitcher archetype charts anymore.

Pool generation:

- Each hitter position gets `teamCount * 2` generated cards: `C, 1B, 2B, 3B, SS, LF, CF, RF`.
- Starting pitchers get `teamCount * 4` generated cards.
- Bullpen pitchers get `teamCount * 4` generated cards.
- Player names are drawn from 222 first names and 235 last names, and each generated pool avoids exact duplicate full names.
- Hitter bats are picked uniformly from `R, L, S`.
- Pitcher throws are picked uniformly from `R, L`.
- Relievers have `IP 1`; starters have IP centered around 6.

Normal distributions are rounded to the nearest integer and clipped to the listed range.

Hitter attributes:

| Attribute | Distribution |
| --- | --- |
| Hitter chart out slots | Normal mean `6`, SD `2.2`, clipped `1-11` |
| On-base | Normal mean `10.5 - (outSlots - 6) * 0.25`, SD `1.6`, clipped `6-15` |
| Speed | Normal by position, SD `4.5`, clipped `1-20`; fewer chart outs add a small positive adjustment |
| Walk/hit split | Hits are normal mean `80%` of non-out slots, SD `16%`, clipped `50%-98%`; the rest are walks |
| Extra-base hit split | Extra-base hits are normal mean `32%` of hit slots, SD `18%`, clipped `0%-80%` |
| Home runs | Normal share of extra-base slots with wider variance; can be zero |
| Outs mix | SO/GB/FB proportions are independently varied with wider variance, then normalized to fill the out slots |

Speed means by position:

| Position | Mean |
| --- | ---: |
| C | 10 |
| 1B | 10 |
| 2B | 12 |
| 3B | 11 |
| SS | 12 |
| LF | 12 |
| CF | 14 |
| RF | 12 |

Fielding distributions by position:

| Position | Mean | SD | Clipped Range |
| --- | ---: | ---: | ---: |
| C | 6 | 1.5 | 1-10 |
| 1B | 0.5 | 0.5 | 0-1 |
| 2B | 2.5 | 1.5 | 0-6 |
| 3B | 1.5 | 1 | 0-3 |
| SS | 3 | 1.5 | 0-6 |
| LF | 1 | 0.67 | 0-2 |
| CF | 2 | 0.67 | 1-3 |
| RF | 1 | 0.67 | 0-2 |

Pitcher attributes:

| Attribute | Distribution |
| --- | --- |
| Pitcher chart out slots | Normal mean `16`, SD `1.6`, clipped `11-19` |
| Control | Normal mean `3.5`, SD `1.5`, clipped `0-6` |
| Starter IP | Normal mean `6`, SD `0.5`, clipped `5-7`; 2% chance of `8` |
| Reliever IP | Fixed at `1` |
| Walk/hit split | Walks are normal mean `35%` of non-out slots, SD `18%`, clipped `5%-75%`; the rest are hits |
| Extra-base hit split | Extra-base hits are normal mean `28%` of hit slots, SD `16%`, clipped `0%-75%` |
| Outs mix | PU/SO/GB/FB proportions are independently varied with wider variance, then normalized to fill the out slots |

Point values:

- Hitter points are `onBase * 20 + fielding * 7 + speedPoints + chartPower`.
- `speedPoints` are `round((speed - 1) * 1.5)`, floored at 0.
- Hitter chart weights are SO `-4`, GB `-2`, FB `-2`, BB `4`, 1B `5`, 2B `9`, 3B `11`, HR `14`, multiplied by the number of d20 slots for each result.
- Pitcher points are `control * 35 + IP * 8 + pitcherChartPower`.
- Pitcher chart weights are PU `8`, SO `10`, GB `8`, FB `6`, BB `-5`, 1B `-7`, 2B `-11`, HR `-16`, multiplied by the number of d20 slots for each result.

## Real Player Pool

Setup offers a second pool: real MLB players from `src/data/realPlayers.js`. It is a fixed 94-card pool (58 hitters, 22 starters, 14 relievers) with enough position depth for up to 6 managers. The seed still controls every sim; it just no longer changes the pool.

Cards are derived from hand-entered, approximate 2025 season stat lines (injury-shortened seasons lean on recent form), echoing how the original game built cards from the prior season:

- Hitter on-base is `10.5 + (OBP - .312) * 25`, rounded and clipped `7-16`.
- Hitter chart on-base slots solve for the player's real OBP against a typical pool pitcher (control ~4.6, ~21% on-base pitcher chart), clipped to `8-19` slots.
- On-base slots split across BB/1B/2B/3B/HR proportionally to the player's real event counts using deterministic largest-remainder rounding; outs split SO vs GB/FB by real strikeout share.
- Pitcher control is `3.2 + (.300 - OBP allowed) * 28`, rounded and clipped `0-6`, with batters faced approximated as `3 * IP + H + BB`.
- Pitcher chart on-base slots solve for real OBP allowed against a typical pool hitter, clipped to `1-6` slots; strikeout share drives the SO column, and non-HR hits split 70/30 into singles and doubles.
- Starter IP is real innings per start clipped `5-8`; relievers are IP `1`.
- Speed and fielding are hand-assigned scouting ratings on the generated pool's scales, and points reuse the generated pool's formulas exactly.

Real hitters can carry the `DH` position (Ohtani, Alvarez, Schwarber). A DH card can fill only the DH or 1B lineup slots, and at first base it takes the standard out-of-position `-1` fielding. This pool is a deliberately star-heavy universe: average on-base and control run higher than the fictional pool, so run scoring lands closer to real baseball.

## MVP Assumptions

Control check:

1. Roll a d20.
2. Add the pitcher's control.
3. If the total is greater than the hitter's on-base value, use the pitcher chart.
4. Otherwise use the hitter chart.

Result check:

1. Roll a second d20.
2. Read the result from the selected chart.

Tie on the control check goes to the hitter. This matches the "higher than on-base" wording I remember, but we should verify it.

## Implemented Results

- `PU`, `SO`: batter is out, runners hold.
- `GB`: batter is out. Runners on second and third advance one base unless the play creates the third out. With a runner on first, the runner from first is out and the defense attempts a double play: d20 plus total infield fielding must beat the batter's speed to also retire the batter.
- `FB`: batter is out. If the catch is not the third out, eligible runners on second and/or third may tag up using the advancement decision matrix. The defense throws at the lowest-probability attempt; d20 plus total outfield fielding must beat the runner's speed target to retire the runner. Ties go to the runner.
- `BB`: forced runners advance.
- `1B`: all runners advance one base. Runners who end on second or third may attempt one extra base using the advancement decision matrix.
- `2B`: runner on first reaches third; all other runners score. The runner who reaches third may attempt home using the advancement decision matrix.
- `3B`: all runners score.
- `HR`: all runners and the batter score.

This baserunning model is playable but not final. Groundouts include double-play attempts, fly balls include automated tag-up decisions, and singles/doubles include automated extra-base attempts.

## Advancement Decision Matrix

Optional advancement uses a 3x3 decision matrix. Rows are the number of outs at the moment of the decision, and columns are the destination base.

| Outs | Second | Third | Home |
| --- | ---: | ---: | ---: |
| 0 | 90% | 85% | 75% |
| 1 | 80% | 75% | 65% |
| 2 | 70% | 65% | 55% |

For tag-ups, the flyout out is recorded before reading the matrix. A flyout with zero outs uses the one-out row; a flyout with one out uses the two-out row; a flyout with two outs creates the third out, so there is no tag-up attempt.

For extra-base attempts after hits, the matrix uses the outs before the swing. These attempts also get the official +5 target bonus when going home and +5 when there were two outs before the swing.

## Steals

Before a plate appearance, the auto-manager may attempt one steal using the advancement decision matrix:

- Runner on first may steal second if second is open.
- Runner on second may steal third if third is open.
- Stealing home is not implemented.
- Stealing third gets a +5 target bonus.
- The defense rolls d20 plus catcher Fielding. The defense must beat the runner target; ties go to the runner.
- A successful or failed steal is logged as its own event. The batter still comes up next unless the steal attempt creates the third out.

## Game Rules

- Games are nine innings.
- Extra innings continue until one team leads after a completed inning.
- The home team does not bat in the bottom of the ninth or later if already ahead.
- The game ends immediately on a home walk-off in the bottom of the ninth or later.
- Lineups cycle in order.
- Tournament games cycle through each team's drafted starters. With the current 2-starter roster, a team's starts alternate starter 1, starter 2, starter 1, starter 2, including the final.
- Pitching uses a planned staff model. The first pitcher is the starter. All later pitchers are one bullpen group, sorted from lowest Control to highest Control so the best bullpen pitcher pitches last.
- Starter target innings are `9 - total bullpen IP`. If the starter must pitch past his own IP, fatigue applies.
- Bullpen pitchers pitch their IP in order. If the game goes into extras, the final bullpen pitcher stays in and becomes tired.
- Fatigue is `-1` to pitch total for each inning or partial inning beyond the pitcher's IP.
- Expert run charging is implemented for fatigue: runs are charged to the pitcher responsible for the runner reaching base, and every 3 charged runs reduce that pitcher's fatigue IP threshold by 1 inning. This does not change the planned staff timing or when bullpen pitchers enter.
- Catcher throw-out mechanics use the catcher's numeric fielding value; there is no separate catcher Arm stat in this prototype.
- Strategy cards are not implemented. Treat them as v4 or later.

## Deferred

- Sacrifice bunts.
- Hit-and-run.
- Manager strategy sliders.
- Fielding checks.
- Official/manual pitching changes.
- 2003+ icons.

## Draft Types

Setup offers two draft types. Both build the same 13-card roster (9 hitters, 2 starters, 2 bullpen) from the same pools; only how cards are claimed differs.

Snake (default): managers pick in turn and the order reverses every round.

Auction: managers take turns nominating a card, then anyone can bid on it.

- Every manager starts with the same budget, default `5000` (a strong 13-card roster sums to roughly 5000 card points, so bids read on the classic Showdown cap scale). The budget is configurable at setup, floored at `65` (13 slots times the minimum bid) and rounded to the bid step.
- Nomination order rotates through the managers top to bottom, skipping anyone whose roster is full. Nominating puts the card on the block with an opening bid of `5` held by the nominator, so a manager can only nominate a card they could legally roster.
- Any other manager may raise by at least `5` (quick raises `+5/+25/+100` or a custom amount). A bid is blocked if the card would not fit the bidder's roster minimums, or if it would leave them unable to pay the `5` minimum for each remaining open slot (`max bid = budget - 5 * open slots after this card`).
- `Sold` awards the card to the standing high bidder at the standing bid and deducts it from their budget. There is no timer; the room decides when bidding is done, like calling going-going-gone at the table.
- An untouched nomination can be canceled. `Undo` steps backward one action: an open lot returns to nomination, a completed sale refunds the price and hands the nomination back.
- `Auto-run next lot` resolves one full lot with proxy bidding: each manager's willingness is their per-slot budget share scaled by how the card's personal valuation compares to the remaining pool of that kind, plus a 15% premium when it fills an open need. The highest-willing manager keeps outbidding until nobody else will pay more, so prices land near the second-highest willingness. `Auto-finish auction` repeats this until every roster is full.
- Draft history shows the price paid next to each card.
- Online rooms currently always create snake drafts; auction is hot-seat local for now. The auction actions (`nominate`, `bid`, `sell`, `cancel-lot`) are already wired through `applyDraftAction`, so the online room flow only needs a `draftType` field at room creation to support it later.

## UI Notes

The app now treats this file as the v1 rule contract. The draft and tournament screens show this as an assumption rather than as a claim about the full original rules.

Current implementation details:

- Draft rooms are saved in browser localStorage.
- A legal MVP roster needs 9 hitters, 2 starters, and 2 bullpen pitchers.
- Tournament rotation uses both drafted starters across games.
- Bench and backup players are intentionally not implemented for now.
- The top roster board supports manual lineup assignment: click a hitter slot to highlight valid destinations, then click a destination to move or swap. Drag/drop uses the same eligibility rules.
- Corner outfielders are one lumped position: cards print `LF/RF` and play either corner at the same fielding score. Bare `LF`/`RF` card labels (hand-built pools, rooms saved before the lump) are rewritten to `LF/RF` when a draft is created or a saved room is loaded, so the draft screen always shows corners as one position and one pool.
- If no printed 1B is available, any hitter can cover first base with Fielding set to exactly `-1`. This is not a subtraction from the card's printed Fielding.
- Manual draft picks are blocked if they would make those minimums impossible.
- Auto-pick scores available players by point value plus roster-need urgency, including the starter/bullpen split.
- Box scores are generated from the simulator event log, and hitter lines track doubles and triples so aggregate SLG/OPS can be computed.
- `Sim N seasons` replays the full round-robin (plus final) N times with seeds `{roomSeed}-batch-season-{n}`, so the same room seed always reproduces the same batch. The batch screen reports title/finals equity, round-robin win distributions, per-player aggregate lines, and sim awards.
- The batch run animates as a title race: ~90 paced frames (slower opening and finish for drama, roughly 15 seconds total), each frame charting cumulative title share per team against a dashed "even draft" parity line. The first ~2% of seasons are computed but not plotted so the chart is not dominated by tiny-sample spikes. `Skip to results` finishes the remaining seasons instantly; the downsampled series (max 160 points) is saved with the results and re-rendered on the results screen.
- Every plate appearance and steal attempt carries a win-probability estimate (`wpBefore`/`wpAfter` on the event log). The model projects the final run differential as a normal distribution: current lead, plus a scaled MLB run-expectancy table for the half in progress, plus 0.5 expected runs per remaining half-inning (variance 1.2 per half, both measured from this engine across the random and real pools). Ties resolve to a coin flip through a continuity band. It is an approximation for storytelling, not a claim about official Showdown odds.
- WPA (win probability added) credits each event's swing to the batter (or the runner on a steal) and debits the pitcher, so offense and defense WPA sum to zero by construction. Hitter box lines also track runs scored and GIDP; the biggest single positive swing of the whole batch is kept with its season, inning, and matchup.
- The awards show is computed from the batch summary: MVP by WPA/season across all players, lowest-ERA starter (min 3 IP/season) and reliever (min 1 IP/season), OBP/HR/R/SB leaders, most GIDP, steal and bust of the draft (draft pick number versus WPA finish rank, busts limited to the first three rounds), and the swing of the sims. Runs allowed are shown as ERA because every run in this engine is earned and charged to a responsible pitcher.
- Batch results are saved with the room and invalidated by any pick, undo, or lineup change, since those change the teams being simulated.
- Duplicate manager names are suffixed (`Sam`, `Sam 2`) at room creation because standings and batch aggregation key on team name.
