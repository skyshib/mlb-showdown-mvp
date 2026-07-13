import { RESULTS } from "../rules/cards.js?v=20260713-h";

// Decoder for the compact real-card tuples in classicCards.js / mlbPools.js.
// Tuple: [id, name, team, year, edition, isPitcher, points, obcOrControl,
//         speedOrIp, positionOrRole, fielding, hand, chart]
// Multi-position hitters carry arrays at the position/fielding slots
// (["2B","SS"] with [3,2]); the first entry is the primary spot.
const CODE_RESULTS = {
  P: RESULTS.PU,
  K: RESULTS.SO,
  G: RESULTS.GB,
  F: RESULTS.FB,
  W: RESULTS.BB,
  S: RESULTS.SINGLE,
  // The real cards' 1B+: a single, plus an automatic uncontested advance to
  // second when it's open.
  "+": RESULTS.SINGLE_PLUS,
  D: RESULTS.DOUBLE,
  T: RESULTS.TRIPLE,
  H: RESULTS.HR
};

function decodeChart(chartString) {
  return chartString.split("|").map((token) => {
    const body = token.slice(1);
    // "21+" stays open-ended, exactly as printed; a d20 just never lands there.
    if (body.endsWith("+")) {
      return { from: Number(body.slice(0, -1)), to: Infinity, result: CODE_RESULTS[token[0]] };
    }
    const [from, to] = body.split("-").map(Number);
    return { from, to, result: CODE_RESULTS[token[0]] };
  });
}

export function decodeCardRows(tuples) {
  return tuples.map((row) => {
    const [id, name, team, year, edition, isPitcher, points, obc, spdIp, posRole, fielding, hand, chartString, foil, mlbam] = row;
    const setTag = edition === "MLB" ? team : `'${String(year).slice(2)} ${edition}`;
    const shared = { id, name, team, setTag, points, real: true, foil: Boolean(foil), mlbam: mlbam ?? null, chart: decodeChart(chartString) };
    if (isPitcher) {
      return { ...shared, kind: "pitcher", role: posRole, throws: hand, control: obc, ip: spdIp };
    }
    const listed = Array.isArray(posRole)
      ? posRole.map((pos, index) => ({ pos, fielding: Number(Array.isArray(fielding) ? fielding[index] : fielding) || 0 }))
      : [{ pos: posRole, fielding: Number(fielding) || 0 }];
    // A DH listing next to a real position is noise — anyone can DH — so the
    // card prints only where he fields. Pure DHs keep the label.
    const fielders = listed.filter((entry) => entry.pos !== "DH");
    const positions = fielders.length ? fielders : listed;
    return {
      ...shared,
      kind: "hitter",
      position: positions[0].pos,
      bats: hand,
      onBase: obc,
      speed: spdIp,
      fielding: positions[0].fielding,
      positions
    };
  });
}
