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

  const positions = hitterPositions(player);
  return {
    type: "hitter",
    position: positions.length === 1
      ? normalizeFilterPosition(positions[0].pos)
      : "all"
  };
}

function normalizeFilterPosition(position) {
  return isCornerOutfielder(position) ? CORNER_OUTFIELD_POSITION : position;
}
