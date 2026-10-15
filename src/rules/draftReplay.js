// A filed auction, turned back into the moves that settled it.
//
// The draft book keeps every lot and every sealed bid (see draftRecord), which
// is enough to play the night again over the same endpoints a live room uses —
// but it is not a transcript of the ACTIONS, and two things stand between the
// two:
//
// - Under random nomination nobody nominates. The queue turns the next card
//   over itself, in the order the seed laid it out, and the room refuses a
//   nomination outright. The log is in that same order, so the lot already on
//   the block is the lot being replayed and there is nothing to send.
// - A tie at the top went to a sealed REBID on the night, and the record keeps
//   each manager's LAST bid — which is the tied amount over again when the
//   rebid tied too and a seeded coin flip settled it. Entered once, the lot
//   ties and then sits there waiting on a rebid nobody is going to send, and
//   the next lot's bids land on the card still on the block. So the tied bids
//   go in a second time: same amounts, same flip, same winner at the same
//   price, and the lot closes where it closed.
//
// Swept lots are left out — a sweep is the room handing out replacements when
// the bidding is over, and a replay that reaches the same end sweeps itself.
export function replayLots(record) {
  const queued = record?.nomination === "random";
  return (record?.auction?.log ?? [])
    .filter((entry) => !entry.swept)
    .map((entry) => {
      const bids = Object.entries(entry.bids ?? {});
      const actions = queued ? [] : [{ type: "nominate", playerId: entry.playerId }];
      for (const [managerId, amount] of bids) actions.push({ type: "seal-bid", managerId, amount });
      const live = bids.filter(([, amount]) => amount > 0);
      const top = live.reduce((best, [, amount]) => Math.max(best, amount), 0);
      const tied = live.filter(([, amount]) => amount === top);
      if (tied.length > 1) {
        for (const [managerId] of tied) actions.push({ type: "seal-bid", managerId, amount: top });
      }
      return actions;
    });
}
