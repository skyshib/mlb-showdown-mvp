#!/usr/bin/env python3
"""Build real-MLB card pools from the Baseball Databank (CC BY-SA).

Two pools: full history (career stats) and the 2000s decade (2000-2009 stats
only). Thresholds are deliberately low — the point is a wide swath of players,
not an all-star gala. Charts and ratings derive from each player's real rates,
mapped into the same parameter space as the fictional card generator so the
engine's balance carries over. Raw quality points use the generator's formula;
the game recalibrates them into printed prices per save.
"""
import csv, hashlib, json, os, re, sys
from collections import defaultdict

SP = os.path.dirname(os.path.abspath(__file__))
L = os.path.join(SP, "lahman")

def rows(name):
    with open(os.path.join(L, name), newline="", encoding="utf-8", errors="replace") as f:
        yield from csv.DictReader(f)

def num(row, key):
    value = row.get(key, "") or "0"
    try:
        return int(value)
    except ValueError:
        return 0

people = {}
for r in rows("People.csv"):
    people[r["playerID"]] = {
        "name": f"{r.get('nameFirst') or ''} {r.get('nameLast') or ''}".strip(),
        "bats": (r.get("bats") or "R")[:1] or "R",
        "throws": (r.get("throws") or "R")[:1] or "R",
    }

BAT_KEYS = ["AB", "H", "2B", "3B", "HR", "BB", "SO", "SB", "CS", "G"]
PIT_KEYS = ["G", "GS", "IPouts", "H", "BB", "SO", "HR", "SV"]
POS_COLS = {"G_c": "C", "G_1b": "1B", "G_2b": "2B", "G_3b": "3B", "G_ss": "SS", "G_lf": "LF/RF", "G_rf": "LF/RF", "G_cf": "CF", "G_dh": "DH"}

def aggregate(source, keys, year_min=None, year_max=None):
    totals = defaultdict(lambda: defaultdict(int))
    years = defaultdict(lambda: [9999, 0])
    for r in rows(source):
        year = num(r, "yearID")
        if year_min and (year < year_min or year > year_max):
            continue
        pid = r["playerID"]
        for k in keys:
            totals[pid][k] += num(r, k)
        span = years[pid]
        span[0] = min(span[0], year)
        span[1] = max(span[1], year)
    return totals, years

def positions_for(year_min=None, year_max=None):
    games = defaultdict(lambda: defaultdict(int))
    for r in rows("Appearances.csv"):
        year = num(r, "yearID")
        if year_min and (year < year_min or year > year_max):
            continue
        for col, pos in POS_COLS.items():
            games[r["playerID"]][pos] += num(r, col)
    return {pid: max(g, key=g.get) for pid, g in games.items() if sum(g.values()) > 0}

def h(pid, salt, lo, hi):
    """Deterministic pseudo-random int in [lo, hi] from the player id."""
    digest = hashlib.sha1(f"{pid}:{salt}".encode()).digest()
    return lo + digest[0] % (hi - lo + 1)

def clamp(v, lo, hi):
    return max(lo, min(hi, v))

def spread(total, weights):
    """Round `weights` (already summing to ~total) to ints summing to total."""
    raw = [(w, i) for i, w in enumerate(weights)]
    ints = [int(w) for w, _ in raw]
    rem = total - sum(ints)
    order = sorted(range(len(raw)), key=lambda i: raw[i][0] - ints[i], reverse=True)
    for i in range(abs(rem)):
        ints[order[i % len(order)]] += 1 if rem > 0 else -1
    return [max(0, v) for v in ints]

CHART_POWER = {"K": -4, "G": -2, "F": -2, "W": 4, "S": 5, "D": 9, "T": 11, "H": 14}
PIT_POWER = {"P": 8, "K": 10, "G": 8, "F": 6, "W": -5, "S": -7, "D": -11, "H": -16}
FIELD_RANGE = {"C": (3, 9), "1B": (0, 1), "2B": (1, 5), "3B": (0, 3), "SS": (1, 5), "LF/RF": (0, 2), "CF": (1, 3), "DH": (0, 0)}

def chart_string(parts):
    out = []
    cursor = 1
    for code, slots in parts:
        if slots <= 0:
            continue
        out.append(f"{code}{cursor}-{cursor + slots - 1}")
        cursor += slots
    # extend the last entry to 20 if rounding left a gap
    if cursor <= 20 and out:
        last = out[-1]
        code = last[0]
        lo = int(last[1:].split("-")[0])
        out[-1] = f"{code}{lo}-20"
    return "|".join(out)

def build_hitter(pid, t, era):
    pa = t["AB"] + t["BB"]
    if pa <= 0 or t["AB"] == 0:
        return None
    obp = (t["H"] + t["BB"]) / pa
    outs = clamp(round(8.5 - (obp - 0.320) * 50), 2, 11)
    remaining = 20 - outs
    walk_share = t["BB"] / max(1, t["BB"] + t["H"])
    walks = clamp(round(remaining * walk_share), 0, remaining - 1)
    hits = remaining - walks
    hshare = lambda k: t[k] / max(1, t["H"])
    hr, tr, db = spread(hits, [hits * hshare("HR"), hits * hshare("3B"), hits * hshare("2B")])
    singles = hits - hr - tr - db
    if singles < 0:
        db += singles
        singles = 0
    outs_so = clamp(round(outs * (t["SO"] / max(1, t["AB"] - t["H"]))), 0, outs)
    gb = round((outs - outs_so) * 0.55)
    fb = outs - outs_so - gb
    on_base = clamp(round(6 + (obp - 0.270) * 60), 6, 15)
    sb650 = t["SB"] / pa * 650
    speed = clamp(round(8 + sb650 * 0.3 + hshare("3B") * 30), 6, 22)
    pos = era["pos"].get(pid, "DH")
    frange = FIELD_RANGE[pos]
    fielding = h(pid, "fld", frange[0], frange[1])
    chart = chart_string([("K", outs_so), ("G", gb), ("F", fb), ("W", walks), ("S", singles), ("D", db), ("T", tr), ("H", hr)])
    power = sum(CHART_POWER[c] * n for c, n in [("K", outs_so), ("G", gb), ("F", fb), ("W", walks), ("S", singles), ("D", db), ("T", tr), ("H", hr)])
    points = on_base * 20 + fielding * 7 + max(0, round((speed - 1) * 1.5)) + power
    return [None, None, None, None, None, 0, points, on_base, speed, pos, fielding, None, chart]

def build_pitcher(pid, t):
    ip = t["IPouts"] / 3
    if ip <= 0:
        return None
    whip = (t["H"] + t["BB"]) / ip
    k9 = t["SO"] * 9 / ip
    control = clamp(round(3.5 + (1.32 - whip) * 5), 0, 6)
    outs = clamp(round(15.5 + (1.32 - whip) * 5), 11, 19)
    remaining = 20 - outs
    walk_share = t["BB"] / max(1, t["BB"] + t["H"])
    walks = clamp(round(remaining * walk_share), 0, remaining)
    hits = remaining - walks
    hr = clamp(round(hits * (t["HR"] / max(1, t["H"]))), 0, hits)
    db = clamp(round((hits - hr) * 0.3), 0, hits - hr)
    singles = hits - hr - db
    so_share = clamp(k9 / 24, 0.10, 0.55)
    so = round(outs * so_share)
    pu = clamp(round(outs * 0.12), 0, outs - so)
    rest = outs - so - pu
    gb = round(rest * 0.55)
    fb = rest - gb
    starter = t["GS"] / max(1, t["G"]) >= 0.4
    if starter:
        ip_card = clamp(round(t["IPouts"] / max(1, t["GS"]) / 3), 4, 8)
        role = "SP"
    else:
        ip_card = 1 if t["SV"] > 30 or t["IPouts"] / max(1, t["G"]) < 5 else 2
        role = "RP"
    chart = chart_string([("P", pu), ("K", so), ("G", gb), ("F", fb), ("W", walks), ("S", singles), ("D", db), ("H", hr)])
    power = sum(PIT_POWER[c] * n for c, n in [("P", pu), ("K", so), ("G", gb), ("F", fb), ("W", walks), ("S", singles), ("D", db), ("H", hr)])
    points = round((control * 35 + power) * ((ip_card + 4) / 10)) + ip_card * 8
    return [None, None, None, None, None, 1, points, control, ip_card, role, 0, None, chart]

def build_pool(tag, year_min=None, year_max=None, min_pa=400, min_ipouts=450):
    bat, bat_years = aggregate("Batting.csv", BAT_KEYS, year_min, year_max)
    pit, pit_years = aggregate("Pitching.csv", PIT_KEYS, year_min, year_max)
    era = {"pos": positions_for(year_min, year_max)}
    used_names = defaultdict(int)
    pool = []
    for pid, t in bat.items():
        if t["AB"] + t["BB"] < min_pa or pid not in people:
            continue
        # two-way edge: skip hitters who were mainly pitchers
        if era["pos"].get(pid) is None and pid in pit and pit[pid]["IPouts"] > (t["AB"] + t["BB"]):
            continue
        card = build_hitter(pid, t, era)
        if not card:
            continue
        finish(card, pid, bat_years[pid], used_names, tag, "bats")
        pool.append(card)
    for pid, t in pit.items():
        if t["IPouts"] < min_ipouts or pid not in people:
            continue
        card = build_pitcher(pid, t)
        if not card:
            continue
        finish(card, pid, pit_years[pid], used_names, tag, "throws")
        pool.append(card)
    return pool

def finish(card, pid, span, used_names, tag, hand_key):
    info = people[pid]
    name = info["name"] or pid
    used_names[name] += 1
    if used_names[name] > 1:
        name = f"{name} '{str(span[0])[2:]}"
    card[0] = f"mlb-{tag}-{pid}"
    card[1] = name
    card[2] = f"{span[0]}-{span[1]}"
    card[3] = str(span[1])
    card[4] = "MLB"
    card[11] = info["bats" if hand_key == "bats" else "throws"] or "R"

history = build_pool("all", None, None, min_pa=400, min_ipouts=450)
decade = build_pool("00s", 2000, 2009, min_pa=250, min_ipouts=225)
print(f"history: {len(history)} cards | 2000s: {len(decade)}", file=sys.stderr)
for tag, pool in (("history", history), ("2000s", decade)):
    hitters = [c for c in pool if c[5] == 0]
    pitchers = [c for c in pool if c[5] == 1]
    pos = defaultdict(int)
    for c in hitters:
        pos[c[9]] += 1
    print(f"  {tag}: hitters {len(hitters)} {dict(pos)} | SP {sum(1 for c in pitchers if c[9]=='SP')} RP {sum(1 for c in pitchers if c[9]=='RP')}", file=sys.stderr)

header = """// Real-MLB card pools built from the Baseball Databank (Chadwick Baseball
// Bureau / Sean Lahman, CC BY-SA 3.0 — https://github.com/chadwickbureau/baseballdatabank).
// Cards are derived from each player's real career (or 2000-2009) rates,
// mapped into the fictional generator's parameter space. Generated file.
// Tuple: [id, name, yearsActive, lastYear, set, isPitcher, rawPoints,
//         obcOrControl, speedOrIp, positionOrRole, fielding, hand, chart]
"""
with open(os.path.join(SP, "mlbPools.js"), "w") as f:
    f.write(header)
    for name, pool in (("MLB_HISTORY_ROWS", history), ("MLB_2000S_ROWS", decade)):
        f.write(f"export const {name} = [\n")
        for card in pool:
            f.write(json.dumps(card, separators=(",", ":")) + ",\n")
        f.write("];\n")
print("wrote mlbPools.js", file=sys.stderr)
