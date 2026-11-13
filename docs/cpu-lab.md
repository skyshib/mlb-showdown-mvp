# The CPU lab

A standing bench for changes to how computers draft. One question, asked the
same way every time: **seat half a room on a tweak and half on the shipped
bidder, and does the tweaked half win more?**

```
node scripts/cpu-lab.mjs list            what is queued, and what is measured already
node scripts/cpu-lab.mjs check           no games: is the bench sound, and does the knob reach
node scripts/cpu-lab.mjs run             measure everything not yet measured
node scripts/cpu-lab.mjs bench           the live bidder against a frozen generation of knobs
node scripts/cpu-lab.mjs report          the table, pooled over every batch ever run
```

## Screen first, then spend

The bench's binding constraint is arithmetic. One pass of the queue over the
whole grid costs about **21 hours** and lands a *single batch* on each pair —
and a single batch is ±1.1 win points at the lone-adopter end, wider than any
effect worth shipping. Spread evenly, a night buys twenty-seven unreadable
numbers. Worse, cost is steeply superlinear in table size (measured over 11
hours of this bench: 3 seats 15s a measurement, 4 seats 29s, 6 seats 81s, 8
seats 182s) and a wide room has more doses to measure, so `a8-classic` and
`a6-classic` alone are ~14 of those 21 hours.

So the work runs in two stages:

```sh
node scripts/cpu-lab.mjs run --stage screen       # every candidate, cheap, wide
node scripts/cpu-lab.mjs screen                   # what that bought, ranked, cut applied
node scripts/cpu-lab.mjs run --stage confirm --tweak ID   # the survivors, properly
```

| | screen | confirm |
| --- | --- | --- |
| cells | the 15 cheap ones | all 17 |
| doses | the far dose only (k = N−1) | the whole adoption curve |
| batches | 1 | 4 |
| cost a candidate | ~7 minutes | ~45 minutes and up |

**Why the far dose is the screen.** At k = N−1 every league hands back the
average of N−1 tweaked chairs rather than one chair's result, so it is the
precise end of the curve — ±0.34 against ±1.11, pooled over 123 tweak×cell
pairs — and it is the end that answers the shipping question, because a change
that helps only while rivals lack it is denial and does not ship. The k = 1 end
is both the noisiest column in the table and the one that flatters a candidate;
screening there is how you spend a week confirming noise.

**The cut**, applied by `screen` rather than left to whoever reads the page:
promote on a pooled |z| ≥ 2 across the screen cells, *or* any single cell at
|z| ≥ 3. The pooled arm is the sharp one (15 cells × 24 leagues is about
±0.15). The per-cell arm exists because pooling has one real failure mode — a
knob that is +2 on narrow boards and −2 on wide ones pools to nothing, and that
knob is interesting. The bar is deliberately loose and the report prints how
many promotions to expect from noise alone, because **nothing ships off the
screen**: a candidate ships by clearing confirm and then reading the same way
on `--holdout` seeds that had no hand in choosing it.

**Bracketing a winner.** A knob that measures as real has been shown to *matter*,
not to be *right* — the bench compared one value against one other value, and the
honest reading of "0.8 → 0.6 is worth +0.42" is "0.6 beats 0.8", never "0.6 is the
answer". `bracket` queues the neighbours:

```sh
node scripts/cpu-lab.mjs bracket --knob poolPremiumThreshold --values 0.5,0.7,0.8
```

They go in through the ideas inbox like any other proposal, so they inherit its
validation, its duplicate check and its provenance, and become candidates
everywhere at once with no file to edit.

**The reversal is queued too, and it is the most interesting one.** Where an older
generation holds a different value for the knob, that value joins the bracket —
because the bench has already measured the move *away* from it and knows what that
was worth. Measuring the move *back*, against the new baseline, must reproduce
that number with the sign flipped. If it doesn't, the effect was never a property
of the knob; it was a property of the comparison, and every number the bench has
produced is worth less than it looks. Nothing else here checks that.

**The throne.** The shipped bidder is the throne, and `accepted` is not a
resting place. The rule accepting a candidate means it beat whoever was on the
throne *at the time* — so the moment anything ships, that sentence is about a
bidder that no longer exists. An accepted candidate therefore goes back to the
**front of the queue** and has to win again against the new control before it
can take the throne itself.

`list` and `run` both show it, and `run` measures challengers first, strongest
claim first:

```
THE THRONE is tuned-2026-11-13 — its last ship moved poolPremiumThreshold
4 challenger(s), measured first by every run until they are settled:
  arm-balance-parity          +0.49 over 22 readings against tuned-2026-11-10 — must win again
  pool-premium-threshold-0-7  +0.41 over 48 readings ... RIVAL for the same knob
```

It is **derived from the record, not hand-flagged**, so it cannot go stale: a
candidate is a challenger whenever the stopping rule reads `accept` on it under
any norm and it has not since been settled.

**`RIVAL` is the distinction that matters.** Two candidates moving the *same*
knob are in a succession fight — only one value can ship, so beating the throne
means replacing it. Candidates moving *different* knobs are not rivals: they
would ship alongside the throne, and winning means clearing the bar *on top of*
the shipped change rather than instead of it. Only the first kind is a contest.

**Which bidder a reading was taken against.** Every row carries `baseline`: the
name of the generation whose knobs were the *shipped defaults* when it was
measured. This is not the same as `versus`, which is who sat in the **control
chairs** because somebody asked for them. `baseline` is who the control chairs
were *by default* — and shipping a knob changes that for everything measured
afterwards.

So a ship splits the record in two, and the halves must never be pooled:
"candidate against a 0.8 bidder" and "candidate against a 0.5 bidder" are two
different experiments that would otherwise average into one meaningless number.
Every reader partitions on it and says what it set aside:

| surface | what it shows |
| --- | --- |
| `list` | counts are against today's bidder; an **older norm** column holds what the last ship stranded |
| `report` | pools only the current norm and prints how many rows it quarantined, and under which generation |
| `screen` | names the bidder in its header, and after a ship says *nothing measured against this bidder* rather than *nothing measured* |
| `ship` | all five checks read the current norm only, and the message names the bidder when a check has no rows |
| `cpu-lab.html` | the room-control key includes the baseline, and a banner fires when you are looking at a stale bucket |

`--baseline <generation>` reads an older bucket on purpose. It is **read-only**:
a run always measures against the live defaults, because that is who the control
chairs actually are.

Expect a ship to cost most of the record — it stranded 23,760 leagues on
2026-11-13 — and plan on re-screening the queue rather than carrying on.

**A shipped candidate cannot be its own control.** Once a knob's value *is* the
default, `--mode identical` with no `--versus` compares a table against a copy of
itself and reads zero for a reason that has nothing to do with the knob. `ship`
drops such rows instead of counting them as a pass or a fail, and tells you to
name the generation from before the ship:

```sh
node scripts/cpu-lab.mjs run --tweak <id> --mode identical --versus tuned-2026-11-10
```

**Settled candidates.** A tweak carrying `settled:` in the queue is one the
bench has answered. A sweep leaves it alone; naming it with `--tweak` re-opens
it. A bench whose queue only grows spends its nights re-measuring what it knows.

## Watching it

`cpu-lab.html`, served by the project's own dev server, is the live view:

```sh
npm run serve          # or npm run online
open http://127.0.0.1:5177/cpu-lab.html
```

It reads `/api/cpu-lab` every five seconds and shows, in this order: whether the
bench is sound (the fixtures, as a pass/fail strip — nothing below it means
anything until they pass), the live bidder against each frozen generation, the
adoption curve, a candidate × board matrix, **what each candidate changes**, and
the full numbers.

**The page plots the curve and nothing else.** Rows from `mixed` and `identical`
stay in the file and `report` still prints them, but they answer a different
question and are not mixed into the page's numbers, its verdicts or its tiles.
The one whole-table measurement it still reads is the `null` fixture's, which is
a fact about the bench rather than a finding about a candidate: a change that
changes nothing, which has to come out at exactly zero.

Wherever a candidate is named — in a running job, under its curve, in the
tables — it carries its knobs as `starterDiscount 0.65 → 1`, and the "what each
candidate changes" table gives every knob a one-line description out of
`CPU_TUNABLE_NOTES`. Nobody watching a run should have to open the source to
find out what the thing being measured is.

A section with nothing in it hides itself, and a column of dashes drops out of
the table, so the page shows the readings that were actually taken rather than
the ones that could have been.

A run in flight shows up on it within five seconds: each lab process keeps a
heartbeat beside the results saying which league of which measurement it has
reached, and a heartbeat nobody has touched for two minutes is treated as a
process that is gone. The page is read-only — it never starts or stops anything
— so leaving it open while a night's queue works costs the run nothing.

The endpoint is gated the way `/api/stats` is: open on a machine that sets no
`STATS_TOKEN`, and `?token=…` where one is set.

Results accumulate in `data/cpu-lab/results.jsonl` (gitignored). Nothing is ever
rewritten: a re-run adds a fresh batch on new seeds, and `report` pools them, so
precision grows the longer the bench runs and every number can be traced back to
the commit that produced it.

## The files

| file | what it is |
| --- | --- |
| `src/rules/cpuTunables.js` | every knob a drafting computer turns, with the shipped value, and the frozen generations |
| `scripts/cpu-lab-tweaks.mjs` | the queue of candidates, plus the three fixtures |
| `scripts/cpu-lab-ideas.jsonl` | the ideas inbox: proposals filed from outside the bench, read into the queue ([how](cpu-lab-ideas.md)) |
| `scripts/cpu-lab-cells.mjs` | the grid of rooms every tweak is measured in |
| `scripts/cpu-lab.mjs` | the bench: the two measurements, the verdicts, the record |
| `scripts/cpu-fingerprint.mjs` | every bid and pick in nine fixed rooms, hashed |
| `test/cpu-fingerprint.test.js` | the guard: the shipped bidder must match `test/fixtures/cpu-fingerprint.txt` |
| `cpu-lab.html` | the live view, fed by `/api/cpu-lab` (`scripts/cpuLab.js`) |

## Generations, and the way back

The defaults in `cpuTunables.js` are a moving target — moving them is the point
of the lab — so a result measured against "the defaults" stops meaning anything
the moment they change. `CPU_KNOB_GENERATIONS` is the fixed thing to measure
against, and the thing to go back to: the whole knob set written out as literal
numbers and then never touched.

| generation | what it is |
| --- | --- |
| `tuned-2026-11-10` | every number the bidder shipped with the day the lab was built (`acc9aae`), as tuned by three years of paired studies |
| `naive` | the tuning backed out — starters at face value, the bankroll split in proportion to worth, no premium on a stud, no reach for a hole, no discount on a bench card |

```sh
# the absolute scale: what the tuning is worth altogether
node scripts/cpu-lab.mjs bench

# the drift read: is the live bidder still better than the generation it came from?
node scripts/cpu-lab.mjs bench --versus tuned-2026-11-10

# and measure a new candidate against a control that cannot drift under it
node scripts/cpu-lab.mjs run --tweak share-steep --versus tuned-2026-11-10
```

`bench` is the `null` fixture run against a generation: nothing is changed
relative to the *live* defaults, so what it measures is the live bidder against
that generation, across the whole grid.

### Why this is the overfitting check

Each candidate is chosen because it beat the bidder *as it stood when the
candidate was measured*, on the seeds the bench happened to use. Ship five of
them and the five were each selected against a different control, on seeds that
had a hand in picking them. Two readings catch what that does:

- **`bench --versus tuned-...`** measures the accumulated difference in one
  shot, on fresh seeds. A pile of individually-promising tweaks that reads flat
  or negative here was fitted to its own seeds, and the generation is still
  sitting in the file to go back to.
- **`--holdout`** moves every seed into a separate namespace. Confirm a winner
  there and it is a winner on seeds that had no hand in choosing it.

A knob preset can only take **knob** drift back. If the bidder's code changed
shape, restoring the numbers does not restore the old behavior — which is what
the `fingerprint` field on each generation is for: it is the digest
`cpu-fingerprint.mjs` printed for the tree that shipped it, and a fingerprint
that no longer reproduces tells you the code moved, not just the knobs.

**Changing a shipped default?** Record a new generation beside the old one — do
not edit the old numbers, they are the revert path. `test/cpu-tunables.test.js`
fails until some generation matches the live defaults, so there is always a
named thing to go back to.

## Adding a tweak

A tweak is a name, a note saying what it claims, and knobs out of
`cpuTunables.js`:

```js
{
  id: "closer-cooler",
  note: "the best reliever at 2.0x a starter's point rather than 2.5x",
  params: { relieverTopRate: 2 }
}
```

Append it to `TWEAKS` and run. A knob that does not exist throws, which is
deliberate — a misspelled knob reads as a perfect null, and a null is a
believable result.

**From outside the bench**, there is a second way in that needs no edit to this
file: `scripts/cpu-lab-ideas.jsonl`, an append-only inbox any agent can file to.

```
node scripts/cpu-lab.mjs idea --id pen-arm-cheaper --knobs '{"relieverDepthRate":0.5}' \
  --note "the arms behind the closer at half a starter's rate" \
  --room misty-fox-open --why "seat 3 paid $182 for a 29-inning arm two lots from the end"
```

The queue reads that file at import, so a filed idea is a candidate everywhere
at once — `list`, `run`, the page — carrying the room and the observation that
prompted it. It is validated on the way in, and a line that cannot be used is
reported rather than thrown, because the online server imports this path.
[The brief for an agent filing one](cpu-lab-ideas.md).

**A structural change, not just a number**, goes in the same way: add a knob to
`CPU_TUNABLE_DEFAULTS` holding the *shipped* behavior (`false`, or the current
constant), write the new branch behind it, and queue a tweak that turns it on.
The bench then measures the new code against the old inside one room, with no
worktrees and no baseline modules to keep in sync.

## What it does and why

### The archetypes are off

Every seat wears the same persona, so the only difference across a table is the
tweak. This is not tidiness. A persona's win% is almost entirely a fact about
the *field* it sits in rather than about how well it drafts — the slugger is
−5.3 in the standings and −0.35 in absolute strength — so a tweak measured
against a mixed field is measured against the loudest thing in the room.
`--persona rotate` puts the archetypes back for a final check.

`--perturb 0` goes further and turns off the seeded wobble on a manager's
weights, making every seat of an archetype think identically. Quieter, and less
like a real room; the default keeps the shipped 0.25.

### The adoption curve (`--mode dose`, the default)

One room, **k** of its N chairs on the tweak, and the number read off it is
**what those chairs won: their own win% against the room's par.** Run it at
every k and you get a curve.

| k | what it reads |
| --- | --- |
| 1 | the lone innovator, with every mispriced card still on the board — the most flattering number a tweak ever gets |
| N/2 | the half-and-half table |
| N−1 | the holdout's view: everybody has it but one chair, which is the case for shipping it to all |

A curve that holds flat across k is an edge that survives adoption. One that
fades toward zero only existed while rivals did not have it.

Every point is **relative by construction, and that is the design rather than a
limitation**: the seats of one room average out between them whatever happens,
which is exactly why some chairs stay untweaked — tweak all N and there is
nobody left to win it from. Par is the room's own mean rather than a flat 50%,
because a batch schedule does not deal every team exactly the same number of
games and the room misses 50% by 0.12–0.16 win points otherwise.

Tables of different sizes are plotted against the **share** of the room carrying
the tweak, so 1-of-3 and 2-of-6 sit in the same place.

### The two whole-table reads (`--mode both`)

| column | what it is |
| --- | --- |
| **mixed** | one room, half the seats tweaked. Mirrored over both parities, so every seat is tweaked in exactly one of the two rooms and no chair or nomination slot can carry the result. This is the k = N/2 point of the curve, measured by a different seat assignment — and it is the one the `null` fixture needs, because its parity mirror makes a change that does nothing cancel to exactly zero. |
| **identical** | the same room drafted twice off one seed, all-tweaked and all-shipped, each roster then playing its **own** counterpart from the other room. The only reading here that is not relative: it is the one way to ask whether a *table* of tweaked computers is better than a table of shipped ones, since within any single room that question has no answer. |
| **denial** | mixed − identical: what the change wins only by taking cards off rivals. | A change that only reaches earlier and leaves rivals the dregs
scores in the curve and nothing in identical — that is how the 1.3x reliever lift
(+1.5 to +4.9 mixed, 49.6–49.9% identical) and the first-price runner-up
estimator (+3.65 mixed, −2.43 identical) were caught, and both were reverted.
Anything shipping to *all* computers has to clear identical. Reading identical
alone misses that a live table is not uniform.

Units: win-point differences, tweaked side minus shipped side, one observation
per league. The interval is 95% on the league-level spread.

### The pool size is the table size

The deck is dealt to the room, so three managers see a thin board where every
lot matters and eight see a wide one with real alternatives at every spot. A
knob can be right at one width and wrong at another — the five-man-rotation
starter discount was — so the grid runs 3, 4, 6 and 8 seats, three card sets,
both nomination rules, both pricing rules, short and long rosters, capped and
open pens, and the snake as well as the auction: seventeen cells, eleven
auction and six snake.

Most of the queue never reaches the snake, and that is correct rather than a
gap: `shareExponent` splits a bankroll and a snake draft has no bankroll. `run`
reach-checks every (tweak, cell) pair and skips the ones that cannot move a
roster or a price, so an auction knob banks no meaningless zero in a snake room.
What the snake cells measure is the knobs the snake scorer actually reads.

| cell | table | board | room |
| --- | --- | --- | --- |
| `a3-classic` | 3 | classic | auction, random nomination, open pen |
| `a4-classic` | 4 | classic | the reference cell |
| `a6-classic` | 6 | classic | |
| `a8-classic` | 8 | classic | pen capped at 3 |
| `a4-manual` | 4 | classic | manual nomination, 2-man pen |
| `a4-first` | 4 | classic | first-price lots |
| `a4-fiction` | 4 | fictional | |
| `a4-history` | 4 | mlb-history | |
| `a4-short` | 4 | classic | 13 men, 2 starters, $1000 |
| `a4-pen2` | 4 | classic | pen capped at 2 — the default room's shape |
| `a4-long` | 4 | classic | 20 men, $2000 — where depth bidding actually happens |
| `s4-classic` | 4 | classic | snake |
| `s6-classic` | 6 | classic | snake |
| `s8-classic` | 8 | classic | snake |
| `s4-long` | 4 | classic | snake, 20 picks — the only cell where a pick upgrades nothing |
| `s4-history` | 4 | mlb-history | snake |
| `s6-fiction` | 6 | fictional | snake, 13 men, 2 starters |

### The two fixtures

They run first, every time, and both earn their keep.

- **`null`** changes nothing. The rooms come out bit-identical, so the **mixed**
  column must print `0.00` exactly; anything else is state leaking between rooms
  — the valuation-model cache is the usual culprit — and not a result. Its
  **identical** column is *not* zero and is not meant to be: there each roster
  plays a copy of itself, so what it prints is the simulator's own noise at the
  games count you chose, and no candidate's identical number means anything
  until it clears that.
- **`no-starter-discount`** pays full price for a narrow board's starters. A
  paired study says that discount is worth +1.5 to +6.4 win points, so this must
  read clearly **negative** — it is the positive control, and a bench that
  cannot reproduce a known result cannot be trusted with an unknown one.
- **`jiggle`** re-draws the per-card bid wobble from the **same distribution**
  off a different seed. Same floor, same width, same mean bid: an identical
  bidder in a different auction, so all that moves is which close lots he
  happens to win, and whatever it reads is what this bench pays for a change
  worth nothing.

  It was `aggressionFloor: 0.8601` — a hundredth of a percent on every bid —
  until 2026-11-11, and `check` showed why that was useless: it moved **0 of 8
  rosters** at `a4-classic` and 0 of 8 on the snake. On most of the grid the
  placebo was a second null, and printed the null's numbers to two decimals. A
  placebo that does not fire tells you nothing about what noise looks like.
  Under the salt it moves every roster in every auction cell.

  **The snake has no placebo**, and cannot have one: its chooser takes the
  highest score with no random term anywhere, so there is nothing to re-seed and
  no neutral perturbation to make. On snake cells the fixtures are `null` and
  the positive control, which is the honest set.

### `check` before you spend a night

`check` plays no games. It drafts two rooms per cell off one seed and compares
the rosters and the prices, which answers three things cheaply:

- **determinism** — an untweaked room drafted twice must come out identical.
- **reach** — a tweak that moves no roster and no price in a cell cannot move a
  win% there, so `run` skips it and says `INERT` rather than spending an hour
  measuring a zero. Plenty of knobs are inert somewhere: the snake does not bid,
  an uncapped pen never reaches the branch that prices a surplus arm, and a room
  whose picks run out never reaches an endgame.
- **shape** — a tweak that moves a lot of money and no rosters is a price
  change, not an allocation change, and in a Vickrey room that is usually
  nothing.

## The verdict line

Strength first, because the record is full of changes that looked good in one
column:

| line | meaning |
| --- | --- |
| `SHIP-WORTHY` | stronger head to head **and** at a mixed table |
| `promising` | stronger head to head; the mixed read is still inside its interval |
| `DENIAL ONLY` | wins at a mixed table and nothing head to head — do not ship it to every computer |
| `REJECT` | weaker than the shipped bidder head to head |
| `null so far` | inside its interval; needs more batches, or it is nothing |

## Cost

One league is two drafted rooms plus the games. At the defaults (24 leagues,
1500 games a team) a four-seat cell costs 70–90 seconds a mode, and the wider
tables more, so a candidate across the whole grid is roughly an hour. Ways to
spend less:

- `--cells a4-classic,a8-classic` while a candidate is still a guess, then the
  whole grid once it looks real.
- `--minutes 480` to work the queue overnight and stop on its own. Finished rows
  are already on disk, so an interrupted run loses nothing but the row it was in
  the middle of.
- `--batches 3` to deepen everything in one invocation.

## Proving a refactor changed nothing

`scripts/cpu-fingerprint.mjs` writes down every bid by every manager on every
lot, and every pick in order, and hashes it. Two trees that agree card for card
and dollar for dollar are the same drafter — which no win% comparison can show,
because the bench's own noise floor is wider than most real effects.

```sh
git worktree add --detach /tmp/base HEAD
node scripts/cpu-fingerprint.mjs --tree /tmp/base > /tmp/before.txt
# ...edit the bidder...
node scripts/cpu-fingerprint.mjs | diff /tmp/before.txt -
```

## How this relates to the older harnesses

`scripts/valuation-sweep.mjs`, `scripts/valuation-ab.mjs` and
`scripts/bidder-duel.mjs` ask the same questions by running two module trees
side by side, which is the only way to measure a change that cannot be reduced
to a knob. They remain correct and they remain the right tool for a sprawling
rewrite. The lab is for everything else: it needs no baseline worktree, it holds
two opinions inside one room, it covers a wider grid, and it keeps its answers.
