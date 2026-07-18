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

// Online, only the seat connected to this client may enter a sealed bid.
// Offline, human seats share the screen while CPU seats bid automatically.
// `undefined` deliberately means offline; `null` is an online spectator.
export function canEnterAuctionBid(manager, onlineManagerId) {
  if (!manager) return false;
  if (onlineManagerId !== undefined) return manager.id === onlineManagerId;
  return !manager.cpu;
}

function normalizeFilterPosition(position) {
  return isCornerOutfielder(position) ? CORNER_OUTFIELD_POSITION : position;
}
