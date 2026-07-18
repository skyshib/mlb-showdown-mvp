import { hitterPositions } from "../rules/cards.js";
import { CORNER_OUTFIELD_POSITION, isCornerOutfielder } from "../rules/draft.js";

export function nominatedPlayerFilter(player) {
  if (!player) return null;
  if (player.kind === "pitcher") {
    return {
      type: "pitcher",
      position: player.role === "SP" ? "SP" : "RP"
    };
  }

  // A utility card could fill any of several holes, so the board stays on all
  // hitters rather than hiding the other spots he's eligible for. A card with a
  // single listed position filters down to just that position.
  const positions = hitterPositions(player);
  return {
    type: "hitter",
    position: positions.length > 1 ? "all" : normalizeFilterPosition(positions[0].pos)
  };
}

function normalizeFilterPosition(position) {
  return isCornerOutfielder(position) ? CORNER_OUTFIELD_POSITION : position;
}
