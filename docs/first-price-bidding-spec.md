# Should a computer bid differently in a first-price room? (Spec)

The auction now has two pricing rules. Under **Vickrey** (the house rule, and still
the default) the high bid wins and pays the second bid plus a point. Under
**first price** the high bid wins and pays itself.

The computer currently bids the same number under both. This spec sets out whether
it should, what the alternatives are, and how to tell a real gain from a mirage.

---

## 1. Why this is a real question

Under Vickrey your bid is a statement and not a cheque. You never pay it, so there
is no reason to name anything but the most you would go to; shading can only lose
you a card you were happy to buy at the price you'd have actually paid. Truthful
bidding is the whole appeal of the rule.

Under first price the bid *is* the cheque. Name your maximum and you capture no
surplus at all: you win exactly the lots you should win, at exactly the price at
which winning was worth nothing to you. Every textbook says shade.

## 2. Why the answer might still be "bid the same number"

`auctionWillingness` does not answer *"what is this card worth?"*. It answers
*"what share of my bankroll have I set aside for it?"* —

```
bid = maxBid × share × aggression × spendDown × poolPremium × depthDamp
share = worth^SHARE_EXPONENT / (worth^SHARE_EXPONENT summed over the best men
                                still coming, down to my open slots)
```

The shares over a manager's remaining slots sum to one. So the number is already a
planned spend: pay it on every card you win and you finish with a full roster and an
empty wallet, which is the plan. Vickrey hands back the gap between the top two bids
and the pacing terms spend that change later.

Two consequences, both of which the study has to respect:

- **A uniform shade barely moves the money.** `auctionPace` and `auctionRoundsFactor`
  both read the budget as it stands. Shade every bid by *k* and budgets drain slower,
  the pacing terms rise, and later bids rise to compensate. The loop is self-correcting,
  so "the computers will go broke early" is not an argument for shading.
- **A uniform shade does not change who wins what.** An auction allocates by relative
  worth. If every seat multiplies by the same *k*, the same cards land in the same
  seats and only the prices move.

That second point is the methodological landmine. See §4.

## 3. The arms

Each arm takes the bid the computer would have made and returns the one it enters.
Legality rails are applied outside the arm: a pass stays a pass, a bid never exceeds
`auctionMaxBid`, and a rebid round's floor is never shaded through.

| Arm | Rule | Rationale |
|---|---|---|
| `true` | bid as it ships | Control. §2's argument, taken at face value. |
| `flat-95` … `flat-55` | `bid × k` | The crude sweep. Finds the shape of the response curve before anything clever is tried. |
| `rivals` | `bid × (n−1)/n`, *n* = managers the lot was opened to | The textbook first-price equilibrium for *independent* values drawn uniformly. Values here are anything but independent — every seat reads the same card through a perturbed copy of the same model — so this should **over**-shade. In as a reference point, not a favourite. |
| `rivals-half` | `bid × (1 − 0.5/n)` | Same shape, damped for how correlated the room's valuations really are. |

Two further arms are **deferred to phase 2**, because unlike the four above they
cannot be written in the harness alone and need real hooks in `draft.js`:

- **`what-it-takes`** — estimate the runner-up bid and bid just over it, capped by
  willingness. This is the interesting one: it makes a first-price room pay Vickrey
  prices, capturing the surplus rather than shading blindly at it. The estimate is
  buildable without peeking — rivals' budgets are public (the budget strip shows
  them), and assuming rivals value a card as I do is an assumption, not a peek. It
  must **not** read rivals' `persona`, which is hidden from the table (cf. the
  no-queue-peek fix).
- **`regret-scaled`** — shade by how little losing costs. `k = 1 − θ × (best
  forthcoming substitute's worth / this card's worth)`: shade hard when a near-equal
  card is still coming, barely at all for a unique stud. Principled, and the
  ingredients already exist (`forthcomingPlayers` + `effectiveWorth`), but it risks
  double-counting `auctionUrgency`, which reads the same scarcity.

## 4. Method, and the three traps

`scripts/first-price-shade.mjs`. One auction per league, first-price, one arm per seat,
all seats sharing a persona so the arm is the only difference. Each league is simmed
and every arm's win% recorded.

**Trap 1 — the wrong harness.** `bidder-duel.mjs` upgrades every seat at once. Per §2
that is *blind* to a uniform shade by construction: it would read zero for a shade worth
ten points against a table that did not get it. The arms must be seated against each
other. (This is valuation-ab's design; the differences are that every arm runs out of
the working tree, so there is no frozen baseline module to keep in step, and that a
Latin square over *N* arms in *N* seats cancels the seat exactly within each block of
*N* leagues where valuation-ab only alternates two configurations.)

**Trap 2 — no null.** `--null` seats the same arm everywhere and files the rows under
the seat's *label*. The spread it reports is the harness's own noise floor through the
same rotation, and nothing narrower than it is a result. valuation-ab's null once read
−10.10 when it had to be 0; a cell run without one proves nothing.

**Trap 3 — the result that is really a pacing change.** `--pricing vickrey` is the
falsification control. Shading must **lose** under Vickrey — you forfeit cards at prices
you were happy to pay, and get nothing back, because you weren't going to pay your bid
anyway. An arm that wins under *both* rules is not measuring first-price strategy; it is
a pacing tweak wearing a shade's clothes, and belongs in a different study.

### The metric, and the known failure mode

Win% is primary, but the table also reports **seated value** (a neutral model's value
summed over the nine, the rotation and the pen), **spent**, and **cards**. This is
because of a result already on the books: *forcing budget pacing makes the bidder worse,
because the freed money dilutes into bench depth.* A shade is a budget-pacing change
by another name, and under random nomination (unlimited rosters) the saved money has
somewhere useless to go. The three extra columns catch that directly — a shade that
"wins" while seated value falls and card count climbs has found the same trap again.

Under a **capped** roster the money has nowhere to go at all; it just goes unspent, and
money left at the last out is money you never had. So both room shapes have a reason the
shade might fail, and they are different reasons. Both get a cell.

### Cells

A cell is ~4 minutes at 400 leagues × 600 games, so breadth is cheap.

| | Pricing | Arms | Purpose |
|---|---|---|---|
| A | first | `true, flat-95, flat-90, flat-80` | Main sweep, fine end |
| B | first | `true, flat-70, rivals-half, rivals` | Main sweep, coarse end |
| C | first | A's arms, `--null` | Noise floor |
| D | vickrey | A's arms | Falsification |

If A or B shows anything, it must then survive: a second independent league set
(`--tag`), the capped-roster room, `--universe mlb-history` (per the archetype result,
win% orderings invert by universe), and a budget other than $1500.

## 5. What ships, and what doesn't

A shade only ships if it (a) beats `true` in a mixed first-price table by more than the
null's spread, (b) **loses** under Vickrey, and (c) does not win by diluting into bench
depth. If the honest answer is "the planned-spend number is already right", that is a
perfectly good result and the code stays as it is — the pricing rule is a house rule
for humans to play with, not a thing the computer has to be re-taught.

Note that the usual "must also clear the absolute head-to-head" rule does **not** apply
here, and that is not a loophole. That rule exists because a change shipping to all CPUs
can win a mirrored duel purely by denial. A shade is different in kind: by §2 the
all-shaded table is *provably* flat, because allocation is unchanged. The mixed table is
not the weaker test here, it is the only test — the question "should a computer shade?"
is inherently a question about playing against someone who doesn't, which in a
first-price room includes every human at the table.

---

# Results (2026-10-13)

`scripts/first-price-shade.mjs`, fictional unless noted, 4 seats, $1500, 15-man roster
(4 SP), balanced persona, random nomination, 600 sim games a league. Every figure below
is **null-corrected**: each arm is compared against *itself* in a `--null` run on the
same seeds with the same rotation, which cancels the label artifact exactly. The four
corrected figures in a cell sum to zero, as they must.

## 1. Uniform shading is dead

| arm | fictional first (800 lg) | mlb-history first (250 lg) | vickrey (400 lg) |
|---|---|---|---|
| `true` | **+0.57** | **+0.79** | **+2.15** |
| `flat-95` | −0.03 | −0.39 | +0.69 |
| `flat-90` | +0.14 | −0.11 | +0.07 |
| `flat-80` | −0.69 | −0.29 | −2.90 |

A second, harder field (400 lg, fictional, first): `true` **+2.62**, `rivals-half`
+1.28, `rivals` −1.51, `flat-70` −2.39.

The control is the best arm in **every** cell. Mild shades are indistinguishable from
bidding the plan; hard shades cost points monotonically; the textbook (n−1)/n rule is
among the worst, as the correlated-values argument predicted.

**Why: the pacing loop rejects it.** Realised spend, `true` $1474 against `flat-80`
$1447 — a 20% cut in every bid moves actual spend **1.8%**. `auctionPace` and
`auctionRoundsFactor` read the live budget, so shading drains slower, the pacing terms
rise, and later bids rise to compensate. A uniform shade is a disturbance a closed loop
with strong negative feedback simply absorbs. This is a better explanation than §2's
"the planned-spend number is already a first-price bid", and it predicts §2's remaining
hole: the loop regulates the AGGREGATE and has no per-card term, so it cannot reject a
shade that moves money *between* cards.

## 2. Differential shading: the ceiling is real, the heuristic is not

The `oracle` arm cheats — it reads every rival's willingness and bids one over the best
of them, winning exactly the lots it would have won at exactly the Vickrey price. It is
unshippable by construction; it is the ceiling on every "guess the runner-up" strategy.

| arm | first price | vickrey |
|---|---|---|
| `true` | +1.32 | +4.69 |
| `oracle` | **+5.29** | +4.58 |
| `regret-20` | −2.52 | −2.57 |
| `regret-35` | −4.09 | −6.71 |

**oracle − true: +3.97 under first price, −0.11 under Vickrey.**

That second number is the study's best evidence that the harness measures what it
claims. Under Vickrey the oracle is a *provable* no-op: bidding `min(W, bestRival+1)`
wins the same lots and pays the same second price as bidding `W`, so it must tie the
control exactly. It does, to within a tenth of a point — a theorem the harness was never
told about, recovered from simulation. Trap 3 passes as cleanly as it can.

So roughly **four win points sit on the table in a first-price room**, and they are
genuinely first-price-specific. The `regret` arms do not collect any of them: shading by
the best substitute anywhere on the board overstates how available substitutes are (the
real test is `forthcomingPlayers`, weighted by the chance a card actually comes up), so
it degenerates into a flat shade and is punished like one.

## 3. Verdict

**Nothing ships.** The computer keeps bidding the same number under both rules. No
legitimate strategy tested beats it, and the only arm that does is one no bidder could
play.

**What is still open** is narrow and worth naming: a runner-up estimator built from
public information only — rivals' budgets and rosters, read through the bidder's own
valuation model. Measured against the +3.97 ceiling, it either captures a worthwhile
share of it or it does not.

One warning for whoever runs that. Every cell above seats **one shared persona**, which
flatters an estimator that assumes rivals value cards as it does — it would be very
nearly right here and much less right in a real room, where each CPU is dealt its own
archetype. A phase-3 cell must run mixed personas, or it will measure its own
assumption. It must also not read rivals' `persona`, which is hidden from the table.

---

# Phase 3 — a legitimate runner-up estimator (2026-10-13)

`est` bids one over the best rival, where that rival's number is reconstructed from
what the table can SEE: his budget and his roster, priced through the bidder's own
valuation model. It never reads his hidden archetype. Graded under `--persona mixed`,
because with one archetype across the table the assumption it rests on is nearly true
and it collapses into the oracle.

## Where the money is

The first-price premium — what paying Vickrey prices would save — is **22.4% of every
budget**. Of it, **98.2% sits on contested lots** (mean top-to-second gap $21.50);
uncontested lots are 4% of the board and 1.8% of the premium. So "bid the floor when
nobody else wants the card", the easy and robust half of the oracle, is worth nothing,
and the entire prize is the hard estimation problem. Under Vickrey an unwanted card
costs $1 however hard you bid, which is why the shipped bidder never needed to notice
them; it still doesn't.

This also explains why the flat shades were a null rather than a small win: the gap
averages 23% of price but varies per lot, so a uniform 10% shade forfeits exactly the
lots where the gap is under 10% to save a tenth on the rest.

## It works, and it still must not ship

Two independent seed sets, 400 leagues each, null-corrected, against the control:

| arm | set O | set T | pooled |
|---|---|---|---|
| `oracle` (cheats) | +8.79 | +8.76 | **+8.8** |
| `est` | +4.02 | +3.28 | **+3.65** |
| `est-hedge` | +3.52 | +1.85 | +2.7 |

`est` captures 41% of the ceiling. Paying over the estimate is worse than estimating
sharply, so the hedge is dropped. Both controls pass: the oracle reads **+0.21** under
Vickrey where theory demands exactly 0, and `est` reads **−2.90** — it loses when
shading buys nothing, which is the signature of a genuine first-price strategy.

**The absolute test rejects it.** Each league driven twice off one seed, every seat on
one arm, each seat's roster played against its own counterpart:

| duel (first price, mixed personas, 250 lg x 4 seats) | edge |
|---|---|
| a table of `est` vs a table of `true` | **−2.43 pts** (±0.52) |
| `true` vs `true` (null) | +0.01 (±0.13) |

So `est` beats rivals who lack it by +3.65 and makes the whole table worse by 2.43 when
everybody has it. That is denial, and the standing rule rejects it.

The roster figures say why, and say something stranger besides:

| table | seated | cards | spent |
|---|---|---|---|
| all `true`, first price | 3739 | 18.1 | $1478 |
| all `true`, vickrey | 3734 | 18.2 | $1414 |
| all `est`, first price | 3695 | 18.7 | **$1413** |

A table of estimators pays **the Vickrey price level, to the dollar** — with a perfect
estimate the top bidder bids `second + 1`, the argmax is preserved, and the house rule
is arbitraged out of existence. But the estimate is not perfect: it sometimes under-bids
and loses lots it should win, and the recovered surplus dilutes into bench depth (cards
up, seated value down). The better a computer plays first price, the less first price
means — and the imperfection costs more than the surplus is worth.

## The pricing rule is nearly a no-op for an all-computer table

Compare the two all-`true` rows above: 3739 seated / 18.1 cards against 3734 / 18.2.
Identical rosters. With identical bids the rule changes only the transfer, and money
left at the last out is worth nothing, so the 22.4% premium burns surplus rather than
buying anyone a worse team. (An earlier reading of this as "fewer and worse cards" was
taken off cells where other seats were shading, and was wrong.)

## But it does move the archetypes

All-`true` tables, mixed personas, both seed sets:

| archetype | first price | vickrey | swing |
|---|---|---|---|
| ace | 51.14 | 51.19 | — |
| balanced | 51.07 | 50.60 | −0.5 |
| purist | **49.45** | **50.98** | **+1.5 under vickrey** |
| slugger | 48.43 | 47.39 | −1.0 under vickrey |

Replicated in both sets, same direction and magnitude. **Not** because the purist's
lots are less contested: the per-lot discount is near uniform (purist 24.8%, ace 24.6%,
slugger 24.0%, balanced 22.1%). It is because he collects it far more often — the
purist wins **18.8 lots a draft against the slugger's 13.2**, spreading his budget where
the slugger concentrates it, so he has about 50% more surplus to lose when the rule stops
handing it to him. Vickrey rewards the archetype that buys the most cards.

This belongs with the known result that archetype standings are field-dependent and
invert by universe. It is a fact about the house rule, not about the bidder, and it is
the one thing in this study a player would actually want to know.

## Final verdict

The computer keeps bidding the same number under both rules. Uniform shading loses;
the only strategy that wins in a mixed table fails the absolute test and dissolves the
house rule while doing it. The rule stays what it was meant to be — a thing for humans
to play with.
