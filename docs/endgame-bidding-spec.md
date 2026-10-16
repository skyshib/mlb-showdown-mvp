# Should a computer shove on its last roster slot? (Spec and result)

Money left at the last out is money you never had. In a **capped** room it is not
even dilutable into bench depth — the roster is full, so it simply goes unspent.
So the endgame looks like free money lying on the table: on your final hole,
whatever you do not spend is spent nowhere, and the bid can only win you a card.

It is not free money. This is the study that says so.

**This is not a pricing-rule question.** The leak is twice as large under Vickrey
as under first price, so `--pricing` is a cell here and not the subject.
`docs/first-price-bidding-spec.md` settles the shading question separately.

Harness: `scripts/endgame-bidding.mjs`.

---

## 1. The leak is real, and bigger than it looks

Manual nomination, capped 15-man roster (4 SP, 2 RP — so all fifteen men field),
4 seats, $1500, fictional, balanced persona, 40 leagues:

| | carried out of the draft | seats carrying $100+ |
|---|---|---|
| first price | $142 mean ($57 median) | 38% |
| Vickrey | $300 mean ($208 median) | 75% |

Vickrey leaks more because the winner pays the second bid and keeps the gap.

On a computer's **final hole**, under first price:

| bid | willingness | its legal max | the field's max | bid / max |
|---|---|---|---|---|
| $49.70 | $85.90 | $134.70 | $417.30 | 50.2% |

It loses 185 of those lots. **47 of them (25.4%) went for a price it could legally
have beaten, and in every one of the 47 it carried that money out of the draft.**

## 2. Why it happens — the denominator is a plan for a draft that cannot happen

`auctionWillingness` sets a bid as `maxBid × share`, where share is the card's
worth over the worth of the best men still expected, down to the manager's open
slots. With one hole left that denominator is a single card: **the best one left
on the board.** Under manual nomination `forthcomingPlayers` gives every unpicked
card an even chance, so "the board" means all of it.

Measured at the last hole (30 leagues, first price):

| | value | points |
|---|---|---|
| the card on the block | 150.5 | 167 |
| the best card still on the board | 339.2 | 435 |

- his legal max **$109**; the field's **$446**
- **outgunned by the field on 86%** of these lots
- the card on the block is the best one left **1%** of the time
- lots left in the whole draft: **8.8**

So a manager with $109 holds back 58% of it for a 435-point stud, against rivals
holding $446, in a draft with nine lots to go. He will not get that card. The
patience is priced off a market he cannot buy in.

That is a genuine modelling flaw, and it is the reason the endgame bid is low.
It is **not** the reason the endgame bid is wrong, because it isn't.

## 3. The arms

Legality rails outside each arm: a pass stays a pass, no bid clears
`auctionMaxBid`, a rebid floor is never cut through.

| arm | rule |
|---|---|
| `true` | the bidder as it ships (control) |
| `allin-1` | one hole left → bid `min(maxBid, richestRival+1)` |
| `allin-2`, `allin-3` | the same at two and three holes |
| `allin-1-top75` | one hole left **and** the card is ≥75% of the best on the board → shove. Keeps the stopping rule, drops only the pretence that the money has a later use |
| `spend-1` | one hole left → bid the whole remaining bankroll. The maximal intervention: carries out $0 |

`allin-3` was dropped after a pilot read **−3.02**: shoving with three holes open
buys the first acceptable card three times and fills nothing well.

## 4. Results — null-corrected

400 leagues × 600 games (mlb-history 250), 4 seats, manual nomination, capped
15-man, balanced persona, Latin square over 4 seats. Every figure is the cell
minus a `--null` run on the same seeds through the same rotation.

| arm | first $1500 | vickrey $1500 | first $3000 | mlb-history |
|---|---|---|---|---|
| `true` | −0.09 | −0.03 | −0.05 | −0.11 |
| `allin-1` | +0.04 | +0.01 | +0.05 | +0.07 |
| `allin-1-top75` | −0.06 | −0.04 | −0.07 | −0.01 |
| `spend-1` | **+0.10** | +0.07 | +0.07 | +0.05 |

**Nothing is outside ±0.11 win points**, in any room shape, including the $3000
room where $312 a seat goes unspent and `spend-1` burns every dollar of it.

### Run the null, part two

The uncorrected tables are a trap worth recording. At $3000, `spend-1` reads
**+1.35 against the control** — and the null, where every seat is the control,
reads **+1.23** for the same label. On mlb-history `allin-1` reads +1.05 raw and
+0.87 null. The whole apparent effect is seat artifact. A cell run without a
matched null here would have shipped a null as a win point and a third.

### The absolute duel

Every seat on one arm, each seat's roster against its own counterpart off the
same seed (first price, $3000, 250 leagues × 4 seats):

| duel | edge |
|---|---|
| a table of `spend-1` vs a table of `true` | **−0.11** (±0.13) |
| `true` vs `true` (null) | +0.04 (±0.13) |

## 5. Why — what the dead money actually buys

Every seat on one arm, 60 leagues × 4 seats, and the card each seat ends up with
in its final hole:

| table | carried out | last man's value | last man's points | seated value |
|---|---|---|---|---|
| **first price** | | | | |
| `true` | $141 | **100.6** | 85 | **4069** |
| shove to the ceiling | $121 | 80.0 | 69 | **4069** |
| `spend-1` | **$0** | 80.0 | 69 | **4069** |
| **Vickrey** | | | | |
| `true` | $251 | **64.6** | 59 | **4079** |
| shove to the ceiling | $235 | 54.3 | 52 | **4079** |
| `spend-1` | $235 | 54.3 | 52 | **4079** |

Seated value is **identical to the point** across all three tables, and the man
the shover ends up with is **worse** — 100.6 against 80.0, an 85-point card
against a 69-point one.

Both halves of the "no downside" argument fail, and they fail for different
reasons:

- **There is a downside.** Bidding your maximum on your last hole closes that
  hole on the first card you want rather than on the best one still coming. The
  low bid is a stopping rule, and the stopping rule earns a better fifteenth man
  than shoving does. The unspent money is the *residue of having waited*, not a
  failure to spend.
- **The money could not have bought anything anyway.** On its last hole a
  computer is outgunned by the field 86% of the time. The lots it loses, it loses
  to a richer rival however hard it bids; the lots it wins, it wins at the lower
  bid too. The 25% of losses that *were* beatable are one or two lots a draft,
  and they move the fifteenth man by a few points of a four-thousand-point team.

## 6. Verdict

**Nothing ships.** The computer keeps its endgame bid.

The flaw in §2 is real — with one hole left the share denominator prices a card
against a stud the manager has no money for — and it is still not worth
correcting, because the correction is measured at zero four ways and the arm that
captures *all* of the dead money loses the absolute duel. If it is ever fixed it
should be fixed as a correctness matter, labelled as such, and not expected to
pay (cf. the redundant-reliever repricing, shipped at +0.09/+0.03).

Two notes for whoever reads a live room and thinks the endgame looks soft:

- Under first price, a low late bid is often **deliberate and correct**.
  `cpuSealedBid` caps at one dollar over the richest answer the live field could
  legally make, because the winner pays his own number. When the room has nothing
  left to answer with, that collapses to the minimum — a computer buying a card
  for $1 on the last lot is the design working, not a bug.
- Carried-out money is not a scoreboard. A table that carries out $0 fields
  exactly the same team as one that carries out $141, and a worse last man.

---

*Diagnostic probes used for §1, §2 and §5 are one-off and not kept; the cells in
§4 are reproducible from `scripts/endgame-bidding.mjs` with the flags named there.*
