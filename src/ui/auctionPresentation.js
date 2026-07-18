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

  // hitterPositions lists the primary spot first, so a utility card filters the
  // board to where he mostly plays rather than washing the filter out to "all".
  const positions = hitterPositions(player);
  return {
    type: "hitter",
    position: normalizeFilterPosition(positions[0].pos)
  };
}

function normalizeFilterPosition(position) {
  return isCornerOutfielder(position) ? CORNER_OUTFIELD_POSITION : position;
}
