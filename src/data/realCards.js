import { RESULTS } from "../rules/cards.js";

// Decoder for the compact real-card tuples in classicCards.js / mlbPools.js.
// Tuple: [id, name, team, year, edition, isPitcher, points, obcOrControl,
//         speedOrIp, positionOrRole, fielding, hand, chart]
const CODE_RESULTS = {
  P: RESULTS.PU,
  K: RESULTS.SO,
  G: RESULTS.GB,
  F: RESULTS.FB,
  W: RESULTS.BB,
  S: RESULTS.SINGLE,
  // The real cards' 1B+ (single, runners take an extra base) plays as a
  // double here — the engine has no auto-advance single.
  "+": RESULTS.DOUBLE,
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
    const [id, name, team, year, edition, isPitcher, points, obc, spdIp, posRole, fielding, hand, chartString, foil] = row;
    const setTag = edition === "MLB" ? team : `'${String(year).slice(2)} ${edition}`;
    const shared = { id, name, team, setTag, points, real: true, foil: Boolean(foil), chart: decodeChart(chartString) };
    if (isPitcher) {
      return { ...shared, kind: "pitcher", role: posRole, throws: hand, control: obc, ip: spdIp };
    }
    return { ...shared, kind: "hitter", position: posRole, bats: hand, onBase: obc, speed: spdIp, fielding };
  });
}
