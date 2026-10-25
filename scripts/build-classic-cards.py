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

# The scouting reports are transcribed by hand, and a handful of rows carry a
# typo: a range that overlaps its neighbour, or a row the printed card doesn't
# have at all. Each of these was re-read off the card scan in card-images-raw/
# and the printed value is what's listed here; a key mapped to None drops a row
# the card never printed. The check below the build catches any new ones.
CHART_FIX = {
    # walk is 4-5 on the card, not 4-6 (ran into the 6-15 single)
    "4-ben-molina-mlb-showdown-2000-1st-edition-pennant-run": {"W": [4, 5]},
    # double is 17-18, not 14-18 (ran into the 12-16 single)
    "29-adam-dunn-mlb-showdown-2002-all-star-game": {"DB": [17, 18]},
    # single is 17-19, not 7-19 (dropped digit, swallowed the 13-16 flyball)
    "50-ramiro-mendoza-mlb-showdown-2001-pennant-run": {"S": [17, 19]},
    # single+ is the single face 17, not 14-17
    "foil-67-austin-kearns-mlb-showdown-2002-pennant-run": {"S+": [17, 17]},
    # groundball is 3-4, not 3-5 (ran into the 5 flyball)
    "76-kevin-barker-mlb-showdown-2000-1st-edition-pennant-run": {"GB": [3, 4]},
    # walk is 8-10, not 8-11 (ran into the 11-18 single)
    "115-juan-uribe-mlb-showdown-2003-base-set": {"W": [8, 10]},
    # groundball is 8-13, not 8-15 (ran into the 14-18 flyball)
    "119-steve-karsay-mlb-showdown-2002-trading-deadline": {"GB": [8, 13]},
    # a 2004 hitter card has no popup row at all
    "foil-125-mike-schmidt-mlb-2004-trading-deadline": {"PU": None},
    # flyball is 4-5, not 4-6 (ran into the 6-10 walk)
    "190-tim-bogar-mlb-showdown-2000-1st-edition": {"FB": [4, 5]},
    # popup is 4-5, not 4-6 (ran into the 6-10 groundball)
    "384-kirk-rueter-mlb-showdown-2000-1st-edition": {"PU": [4, 5]},
}

# The positions column is hand-typed too, and can drop a fielding modifier.
# Each fix below was re-read off the card scan in assets/cards/ and maps a
# printed position to the fielding the card actually shows.
FIELDING_FIX = {
    # the card prints LF/RF +1; the report dropped the +1
    "355-shannon-stewart-mlb-showdown-2002-base-set": {"LF/RF": 1},
}

# Names come off the same hand-typed reports, and a few are plainly wrong: a
# row left in caps lock, a dropped space, a misspelling the card itself does not
# make. Each fix below was checked against the card scan in card-images-raw/ or
# against the site's own card-image filename, which is usually spelt right when
# the row isn't. Only the clear mistakes are listed: where the CARD prints the
# oddity ("GARRETT ANDERSON" in 2004, "VINCENTE PADILLA" in 2003, "KAZUHISHA
# ISHII", "ICHIRO" with no surname, "BEN MOLINA", "TRENIDAD HUBBARD",
# "TIMONIEL PEREZ", "ALEXIS RIOS"), the card wins and the name stands.
NAME_FIX = {
    # left in caps lock, and Eckstein misspelt with it
    "DAVID ECKSTIEN": "David Eckstein",
    "JORGE POSADA": "Jorge Posada",
    "AL Leiter": "Al Leiter",
    # misspellings the card doesn't make
    "Mac Suzaki": "Mac Suzuki",
    "Hebert Perry": "Herbert Perry",
    "Garret Stephenson": "Garrett Stephenson",
    "Jason Christansen": "Jason Christiansen",
    "Mike Tromley": "Mike Trombley",
    "Urgueth Urbina": "Ugueth Urbina",
    "Tevor Hoffman": "Trevor Hoffman",
    "David Delucci": "David Dellucci",
    "Preston Willson": "Preston Wilson",
    "Willy McCovey": "Willie McCovey",
    "Christian Guzman": "Cristian Guzman",
    # both 2001 printings say DAVID JUSTICE on the face; spelling him two ways
    # made him two men to the one-of-each-person rule
    "Dave Justice": "David Justice",
    # one man, one spelling: the apostrophe and the missing space
    "DAngelo Jiminez": "D'Angelo Jimenez",
    "D Angelo Jimenez": "D'Angelo Jimenez",
    "D\u2019Angelo Jimenez": "D'Angelo Jimenez",
    "Jeff D\u2019Amico": "Jeff D'Amico",
    "Ken GriffeyJr.": "Ken Griffey Jr.",
    "Chan HoPark": "Chan Ho Park",
    "Wily MoPena": "Wily Mo Pena",
    "Tony Armas Jr": "Tony Armas Jr.",
    # the cards print every name in capitals, so the capital inside the name is
    # ours to get right
    "Brian Mcrae": "Brian McRae",
    "Delino Deshields": "Delino DeShields",
    "Fred Mcgriff": "Fred McGriff",
    "Jason Larue": "Jason LaRue",
    "Joe Mcewing": "Joe McEwing",
    "John Mcdonald": "John McDonald",
    "Latroy Hawkins": "LaTroy Hawkins",
    "Mark Derosa": "Mark DeRosa",
    "Mark Mcgwire": "Mark McGwire",
    "Mark Mclemore": "Mark McLemore",
    "Mike Dejean": "Mike DeJean",
    "Troy OLeary": "Troy O'Leary",
    "Willie Mcgee": "Willie McGee",
}

# The search table's edition column files every Pennant Run and Trading
# Deadline card under its year's base-set code; the store slug names the set
# the card actually came in. The id keeps the column's code — it is what the
# card-image map is keyed by — and only the displayed edition is corrected.
# Subset codes (SS, CC, RS, promos) are already more specific than the slug
# and stand as they are.
def display_edition(card):
    if card["edition"] in ("1st", "UL"):
        if "pennant-run" in card["slug"]:
            return "PR"
        if "trading-deadline" in card["slug"]:
            return "TD"
    return card["edition"]

def fixed_chart(card):
    """The card's chart with any known transcription typo corrected."""
    chart = dict(card["chart"])
    for key, rng in CHART_FIX.get(card["slug"], {}).items():
        if rng is None:
            chart.pop(key, None)
        else:
            chart[key] = rng
    return chart

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
    rows = chart_rows(fixed_chart(card))
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
    # The id keeps the spelling the report was filed under, typo and all: it is
    # what the card-image map is keyed by, and a renamed id loses the card's
    # scan. The NAME the game shows, and the headshot lookup behind it, use the
    # corrected spelling.
    name = NAME_FIX.get(card["name"], card["name"])
    # The card year rides with the name ("Mike Caruso '02") unless the printed
    # name already carries one (Super Season cards like "Jeff Kent '98").
    display = name if re.search(r"'\d\d$", name) else f"{name} '{card['year'][2:]}"
    foil = 1 if card.get("foil") else 0
    if card["pitcher"]:
        role = "SP" if card["positions"].split("|")[0].strip().startswith("Starter") else "RP"
        out.append([card_id, display, card["team"], card["year"], display_edition(card), 1, card["points"], obc, min(max(spd, 1), 9), role, 0, card["hand"], chart_str, foil, NAME_MLBAM.get(name)])
    else:
        plist = parse_positions(card["positions"])
        fix = FIELDING_FIX.get(card["slug"])
        if fix:
            plist = [(p, fix.get(p, f)) for p, f in plist]
        pos = [p for p, _ in plist] if len(plist) > 1 else plist[0][0]
        fielding = [f for _, f in plist] if len(plist) > 1 else plist[0][1]
        out.append([card_id, display, card["team"], card["year"], display_edition(card), 0, card["points"], obc, min(max(spd, 5), 28), pos, fielding, card["hand"], chart_str, foil, NAME_MLBAM.get(name)])

# A chart is a partition of the die: every face 1..20 reads exactly one row.
# A row that overlaps its neighbour still resolves (the lookup takes the first
# match) but prints two ranges over the same faces on the card face and counts
# twice everywhere a chart is weighed, so it has to be caught here.
bad = []
for row in out:
    chart_str = row[12]
    spans = []
    for token in chart_str.split("|"):
        m = re.match(r"^(.)(\d+)(?:-(\d+)|(\+))$", token)
        lo, hi = int(m.group(2)), (int(m.group(3)) if m.group(3) else 99)
        spans.append((lo, hi))
    spans.sort()
    if spans[0][0] != 1 or any(spans[i][0] != spans[i - 1][1] + 1 for i in range(1, len(spans))) or spans[-1][1] < 20:
        bad.append(f"{row[0]}: {chart_str}")
if bad:
    print(f"WARNING: {len(bad)} charts do not tile 1-20 — add them to CHART_FIX:", file=sys.stderr)
    for line in bad:
        print(f"  {line}", file=sys.stderr)

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
