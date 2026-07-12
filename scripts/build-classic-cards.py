#!/usr/bin/env python3
"""Emit src/data/classicCards.js from the parsed scouting-report facts."""
import json, os, re, sys

SP = os.path.dirname(os.path.abspath(__file__))
cards = json.load(open(os.path.join(SP, "classic-raw.json")))

# Unique-name -> MLBAM id, for official headshots on the real cards.
import csv as _csv
try:
    _mlbam = json.load(open(os.path.join(SP, "mlbam-map.json")))
    _names = {}
    for _r in _csv.DictReader(open(os.path.join(SP, "lahman", "People.csv"), encoding="utf-8-sig")):
        _n = f"{_r.get('nameFirst') or ''} {_r.get('nameLast') or ''}".strip()
        if _n in _names:
            _names[_n] = None  # ambiguous name: skip
        else:
            _names[_n] = _mlbam.get(_r["playerID"])
    NAME_MLBAM = {k: v for k, v in _names.items() if v}
except FileNotFoundError:
    NAME_MLBAM = {}

RESULT_CODE = {"PU": "P", "SO": "K", "GB": "G", "FB": "F", "W": "W", "S": "S", "S+": "+", "DB": "D", "TR": "T", "HR": "H"}
SPEED_LETTERS = {"A": 20, "B": 15, "C": 10}
VALID_POSITIONS = ("C", "1B", "2B", "3B", "SS", "LF/RF", "CF", "DH")
# The utility printings expand to every spot the real rules let them play:
# OF is any outfield position, IF any infield. First entry = primary.
POS_EXPAND = {"LF-RF": ["LF/RF"], "OF": ["CF", "LF/RF"], "IF": ["SS", "2B", "3B", "1B"], "---": ["DH"]}

def parse_positions(positions):
    """Every position printed on the card with its fielding, in print order:
    "2B+3 | SS+2" keeps both spots, a hyphenated pair ("2B-SS+3") shares the
    one printed rating, and OF/IF expand per the real rules."""
    out = []
    for token in positions.split("|"):
        token = token.replace(" ", "").replace("&nbsp;", "")
        if not token:
            continue
        m = re.match(r"^([A-Za-z0-9\-]+?)\s*([+-]\d+)?$", token)
        raw = (m.group(1) if m else token).strip("-") or "---"
        fielding = int(m.group(2)) if m and m.group(2) else 0
        expanded = POS_EXPAND.get(raw) or [POS_EXPAND.get(part, [part])[0] for part in raw.split("-")]
        for pos in expanded:
            if pos not in VALID_POSITIONS:
                pos = "DH"
            if not any(existing == pos for existing, _ in out):
                out.append((pos, fielding))
    return out or [("DH", 0)]

def chart_rows(chart):
    """Rows as printed on the card; hi None means an open range ("21+")."""
    rows = []
    for key, rng in chart.items():
        if key not in RESULT_CODE:
            return None
        rows.append((rng[0], rng[1], RESULT_CODE[key]))
    rows.sort(key=lambda r: r[0])
    # verify contiguous coverage of 1..20; extend earlier rows over small gaps
    fixed = []
    cursor = 1
    for lo, hi, code in rows:
        if lo > cursor and fixed:
            prev = fixed[-1]
            fixed[-1] = (prev[0], lo - 1, prev[2])
        elif lo > cursor:
            lo = 1
        fixed.append((lo, hi, code))
        cursor = max(cursor, (hi if hi is not None else 30) + 1)
    if fixed and fixed[-1][1] is not None and fixed[-1][1] < 20:
        last = fixed[-1]
        fixed[-1] = (last[0], 20, last[2])
    return fixed

seen_ids = set()
out = []
skipped = 0
for card in cards:
    rows = chart_rows(card["chart"])
    if not rows:
        skipped += 1
        continue
    try:
        obc = int(card["obc"])
        spd_raw = card["spd"].strip()
        spd = SPEED_LETTERS.get(spd_raw, None)
        if spd is None:
            spd = int(spd_raw)
    except ValueError:
        skipped += 1
        continue
    base_id = re.sub(r"[^a-z0-9]+", "-", f"sd-{card['year'][2:]}-{card['edition']}-{card['number']}-{card['name']}".lower()).strip("-")
    card_id = base_id
    n = 2
    while card_id in seen_ids:
        card_id = f"{base_id}-{n}"
        n += 1
    seen_ids.add(card_id)
    chart_str = "|".join(f"{code}{lo}+" if hi is None else f"{code}{lo}-{hi}" for lo, hi, code in rows)
    # The card year rides with the name ("Mike Caruso '02") unless the printed
    # name already carries one (Super Season cards like "Jeff Kent '98").
    display = card["name"] if re.search(r"'\d\d$", card["name"]) else f"{card['name']} '{card['year'][2:]}"
    foil = 1 if card.get("foil") else 0
    if card["pitcher"]:
        role = "SP" if card["positions"].split("|")[0].strip().startswith("Starter") else "RP"
        out.append([card_id, display, card["team"], card["year"], card["edition"], 1, card["points"], obc, min(max(spd, 1), 9), role, 0, card["hand"], chart_str, foil, NAME_MLBAM.get(card["name"])])
    else:
        plist = parse_positions(card["positions"])
        pos = [p for p, _ in plist] if len(plist) > 1 else plist[0][0]
        fielding = [f for _, f in plist] if len(plist) > 1 else plist[0][1]
        out.append([card_id, display, card["team"], card["year"], card["edition"], 0, card["points"], obc, min(max(spd, 5), 28), pos, fielding, card["hand"], chart_str, foil, NAME_MLBAM.get(card["name"])])

print(f"emitting {len(out)} cards ({skipped} skipped)", file=sys.stderr)

header = """// Real MLB Showdown cards (2000-2005), compiled from public scouting-report
// data (game-mechanical facts: points, on-base/control, speed/IP, positions,
// and chart ranges). Generated by a scraper+builder script; do not hand-edit.
// Tuple: [id, name, team, year, edition, isPitcher, points, obcOrControl,
//         speedOrIp, positionOrRole, fielding, hand, chart]
// Multi-position hitters carry aligned arrays at the position/fielding
// slots (["2B","SS"] with [3,2]), matching the card's printed listings.
// Chart codes: P=PU K=SO G=GB F=FB W=BB S/+=1B D=2B T=3B H=HR
"""
with open(os.path.join(SP, "classicCards.js"), "w") as f:
    f.write(header)
    f.write("export const CLASSIC_CARD_ROWS = [\n")
    for row in out:
        f.write(json.dumps(row, separators=(",", ":")) + ",\n")
    f.write("];\n")
print("wrote classicCards.js", file=sys.stderr)
