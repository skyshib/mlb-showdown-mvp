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
  "+": RESULTS.SINGLE,
  D: RESULTS.DOUBLE,
  T: RESULTS.TRIPLE,
  H: RESULTS.HR
};

function decodeChart(chartString) {
  return chartString.split("|").map((token) => {
    const [from, to] = token.slice(1).split("-").map(Number);
    return { from, to, result: CODE_RESULTS[token[0]] };
  });
}

export function decodeCardRows(tuples) {
  return tuples.map((row) => {
    const [id, name, team, year, edition, isPitcher, points, obc, spdIp, posRole, fielding, hand, chartString] = row;
    const setTag = edition === "MLB" ? team : `'${String(year).slice(2)} ${edition}`;
    const shared = { id, name, team, setTag, points, real: true, chart: decodeChart(chartString) };
    if (isPitcher) {
      return { ...shared, kind: "pitcher", role: posRole, throws: hand, control: obc, ip: spdIp };
    }
    return { ...shared, kind: "hitter", position: posRole, bats: hand, onBase: obc, speed: spdIp, fielding };
  });
}
