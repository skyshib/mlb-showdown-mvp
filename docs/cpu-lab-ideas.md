# Proposing a tweak from a room

*For an agent — or a person — who has just finished reading one room and thinks
something about how the computers drafted it was wrong.*

The bench in [`docs/cpu-lab.md`](cpu-lab.md) can measure anything you can name,
but it cannot think of what to measure. That part happens where the evidence is:
in a finished draft, where a bid sits beside the card it bought and you can see
the two don't match. This is how that observation gets handed over.

## File it

```
node scripts/cpu-lab.mjs idea \
  --id pen-arm-cheaper \
  --knobs '{"relieverDepthRate":0.5}' \
  --note "the arms behind the closer at half a starter's rate" \
  --room misty-fox-open \
  --why "seat 3 paid \$182 for a 29-inning arm two lots from the end, more than the room's best reliever went for" \
  --by "room-analysis agent"
```

That appends one line to `scripts/cpu-lab-ideas.jsonl` and the proposal is a
candidate from that moment — `cpu-lab.mjs list` prints it, the next `run` with
budget measures it across the whole grid, and it appears on `cpu-lab.html`
beside every other candidate with your `why` attached. Nothing else to do, and
nobody to ask.

The file is **append-only JSONL**, so several agents can file at once without
treading on each other, and no proposal is ever edited away. You may write the
line yourself instead of using the CLI — but the CLI validates before it writes,
and a refusal now is cheaper than a null in the morning.

## What gets refused

| refusal | what it means |
| --- | --- |
| `no such knob — relieverDepthRte` | the knob list is in `src/rules/cpuTunables.js`; `cpu-lab.mjs list` prints every one with the value that ships today |
| `the same knobs are already queued as "share-flat"` | somebody is already asking this; go read its result instead |
| `every knob is already the shipped value` | the proposal changes nothing |
| `the name "jiggle" is already a fixture` | pick another name |
| `note must say in a line what the idea claims` | see below |

A malformed line already in the file never breaks anything — it is skipped,
reported by `list`, and shown on the page. It is also never measured, so check
`list` after you file.

## What makes a proposal worth an hour

**It has to be a knob.** The bench measures by seating some chairs on different
numbers inside one auction. A change that isn't expressible as a number in
`cpuTunables.js` can still be measured here, but somebody has to add the knob
first — write the new branch behind a knob whose shipped value is the *current*
behavior, and propose turning it on. Say so in the `why` and it will get picked
up.

**The `why` is the point.** The measurement will tell us whether the number is
better. It will never tell us why anyone thought to try it, and in a month that
is the thing that decides what to do next. Write the observation, with the
numbers in it:

> good: "seat 3 paid $182 for a 29-inning arm two lots from the end, more than
> the room's best reliever went for"
>
> useless: "reliever pricing may be suboptimal"

**One knob at a time, usually.** Two knobs in one proposal measure their sum,
and if it reads +1.2 nobody knows which half earned it. Move two together only
when one alone would mean something different — `wobble-off` sets
`aggressionFloor` and `aggressionSpan` together because moving either alone
changes the *average* bid as well as its spread, which is a different experiment.

**A hunch is allowed.** The queue is cheap and the bench runs overnight; the
cost of a wrong idea is an hour of a machine nobody is using. The cost of a
plausible idea nobody wrote down is that it gets re-derived every six months.

## What you will get back

Each proposal is measured as an **adoption curve**: the same room with 1 of N
chairs on the tweak, then 2 of N, up to N−1, across eleven boards. The statistic
is the tweaked chairs' own win% against the room's par. Two readings matter and
they are usually different numbers:

- **lone adopter** (k=1) — what it is worth when you are the only one doing it.
  A change that scores here and nowhere else is *denial*: it reaches earlier and
  leaves rivals the dregs. That is not an improvement to ship to every computer.
- **last holdout** (k=N−1) — what it is worth once everyone has it. This is the
  precise end of the curve and the one that decides whether it ships.

Read them on `cpu-lab.html`, or `node scripts/cpu-lab.mjs report --tweak <id>`.

Before you believe any of it, look at the three fixtures at the top of that
page: `null` must read exactly 0.00, `jiggle` says what this bench pays for a
change worth nothing, and `no-starter-discount` must read clearly negative. If
those are not right, no candidate's number means anything.
