#!/usr/bin/env python3
"""Build real-MLB card pools from the Baseball Databank (CC BY-SA).

Pools: full history (career stats), every decade (window stats), and every
franchise (stats accumulated with that club). Thresholds are deliberately low
— the point is a wide swath of players, not an all-star gala. Charts and
ratings derive from each player's real rates, mapped into the fictional card
generator's parameter space; the game recalibrates raw points into printed
prices per save. Slices that can't support a legal starter pack (a common and
a rare at every slot) are dropped.
"""
import csv, hashlib, json, os, sys
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

franch_of = {}
for r in rows("Teams.csv"):
    franch_of[(num(r, "yearID"), r["teamID"])] = r["franchID"]
franch_names = {}
for r in rows("TeamsFranchises.csv"):
    franch_names[r["franchID"]] = r["franchName"]

BAT_KEYS = ["AB", "H", "2B", "3B", "HR", "BB", "SO", "SB", "CS", "G"]
PIT_KEYS = ["G", "GS", "IPouts", "H", "BB", "SO", "HR", "SV"]
POS_COLS = {"G_c": "C", "G_1b": "1B", "G_2b": "2B", "G_3b": "3B", "G_ss": "SS", "G_lf": "LF/RF", "G_rf": "LF/RF", "G_cf": "CF", "G_dh": "DH"}

def decade_of(year):
    return (year // 10) * 10

def accumulate(source, keys):
    """One pass: career / franchise / decade totals and year spans.
    Decade cards pool a player's ENTIRE decade regardless of team; franchise
    cards pool a player's entire career with that club regardless of decade."""
    career, by_franch, by_decade = (defaultdict(lambda: defaultdict(int)) for _ in range(3))
    spans = defaultdict(lambda: [9999, 0])
    for r in rows(source):
        year = num(r, "yearID")
        pid = r["playerID"]
        fid = franch_of.get((year, r.get("teamID", "")), None)
        for k in keys:
            v = num(r, k)
            career[pid][k] += v
            by_decade[(pid, decade_of(year))][k] += v
            if fid:
                by_franch[(pid, fid)][k] += v
        for key in (pid, (pid, decade_of(year)), (pid, fid) if fid else None):
            if key is None:
                continue
            span = spans[key]
            span[0] = min(span[0], year)
            span[1] = max(span[1], year)
    return career, by_franch, by_decade, spans

def accumulate_positions():
    career, by_franch, by_decade = (defaultdict(lambda: defaultdict(int)) for _ in range(3))
    for r in rows("Appearances.csv"):
        year = num(r, "yearID")
        pid = r["playerID"]
        fid = franch_of.get((year, r.get("teamID", "")), None)
        for col, pos in POS_COLS.items():
            g = num(r, col)
            if not g:
                continue
            career[pid][pos] += g
            by_decade[(pid, decade_of(year))][pos] += g
            if fid:
                by_franch[(pid, fid)][pos] += g
    pick = lambda table: {k: max(g, key=g.get) for k, g in table.items() if sum(g.values()) > 0}
    return pick(career), pick(by_franch), pick(by_decade)

def h(pid, salt, lo, hi):
    digest = hashlib.sha1(f"{pid}:{salt}".encode()).digest()
    return lo + digest[0] % (hi - lo + 1)

def clamp(v, lo, hi):
    return max(lo, min(hi, v))

def spread(total, weights):
    ints = [int(w) for w in weights]
    rem = total - sum(ints)
    order = sorted(range(len(weights)), key=lambda i: weights[i] - ints[i], reverse=True)
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
    if cursor <= 20 and out:
        last = out[-1]
        lo = int(last[1:].split("-")[0])
        out[-1] = f"{last[0]}{lo}-20"
    return "|".join(out)

# ---- League-anchored card math ------------------------------------------------
#
# The engine resolves each PA as: batter advantage A = (OB - ctrl)/20, then
# result = A x batterChart + (1-A) x pitcherChart. Anchoring the league at
# ctrl 4 / OB 11, a player's chart is his real rates with the league backed
# out: chart_e = (real_e - (1-A) x league_e) / A. A league-average player gets
# a league-average chart, and any matchup reproduces real rates to first
# order. League context is era-specific (per decade), PA-weighted for slices
# spanning decades — a .350 OBP means more in 1968 than in 1930.
ANCHOR_CTRL = 4
ANCHOR_OB = 11
ANCHOR_A = (ANCHOR_OB - ANCHOR_CTRL) / 20
# Homers live mostly on batter charts: the league's pitcher charts carry only
# this share of the era HR rate, and batter charts carry the surplus. This
# keeps league totals intact while letting punchless hitters actually be
# punchless (their floor is what pitcher charts concede, not the full league).
HR_PITCHER_SHARE = 0.5
EVENTS = ["BB", "S", "D", "T", "HR"]

def league_split(L):
    """The league-average pitcher chart and batter chart implied by L."""
    pitcher = dict(L)
    pitcher["HR"] = L["HR"] * HR_PITCHER_SHARE
    batter = dict(L)
    batter["HR"] = (L["HR"] - (1 - ANCHOR_A) * pitcher["HR"]) / ANCHOR_A
    return pitcher, batter

def league_tables(bat_decade):
    lg = defaultdict(lambda: defaultdict(int))
    for (pid, dec), t in bat_decade.items():
        for k, v in t.items():
            lg[dec][k] += v
    tables = {}
    for dec, t in lg.items():
        pa = t["AB"] + t["BB"]
        if pa < 50000:
            continue
        singles = t["H"] - t["2B"] - t["3B"] - t["HR"]
        tables[dec] = {
            "BB": t["BB"] / pa, "S": singles / pa, "D": t["2B"] / pa,
            "T": t["3B"] / pa, "HR": t["HR"] / pa, "K": t["SO"] / pa,
            "OBP": (t["H"] + t["BB"]) / pa,
        }
    return tables

def blend_league(tables, weights):
    total = sum(w for dec, w in weights.items() if dec in tables)
    if total <= 0:
        return tables[max(tables)]
    blend = defaultdict(float)
    for dec, w in weights.items():
        if dec not in tables:
            continue
        for k, v in tables[dec].items():
            blend[k] += v * (w / total)
    return blend

def build_hitter(pid, t, pos, L):
    pa = t["AB"] + t["BB"]
    if pa <= 0 or t["AB"] == 0:
        return None
    singles = t["H"] - t["2B"] - t["3B"] - t["HR"]
    b = {"BB": t["BB"] / pa, "S": singles / pa, "D": t["2B"] / pa,
         "T": t["3B"] / pa, "HR": t["HR"] / pa}
    obp = (t["H"] + t["BB"]) / pa
    # OB scales off the ERA-relative on-base gap; the chart backs the league
    # out at that advantage, so OB and chart stay consistent by construction.
    ob = clamp(round(ANCHOR_OB + (obp - L["OBP"]) * 50), 6, 15)
    A = (ob - ANCHOR_CTRL) / 20
    pitcher_league, _ = league_split(L)
    raw = {e: max(0.0, (b[e] - (1 - A) * pitcher_league[e]) / A) * 20 for e in EVENTS}
    onbase_slots = clamp(round(sum(raw.values())), 2, 18)
    bb, s, d, tr, hr = spread(onbase_slots, [raw["BB"], raw["S"], raw["D"], raw["T"], raw["HR"]])
    outs = 20 - onbase_slots
    # His chart's out mix follows his real K share of outs.
    out_rate = max(0.02, 1 - obp)
    so = clamp(round(outs * clamp((t["SO"] / pa) / out_rate, 0.05, 0.95)), 0, outs)
    gb = round((outs - so) * 0.55)
    fb = outs - so - gb
    sb650 = t["SB"] / pa * 650
    speed = clamp(round(8 + sb650 * 0.3 + (t["3B"] / max(1, t["H"])) * 30), 6, 22)
    frange = FIELD_RANGE[pos]
    fielding = h(pid, "fld", frange[0], frange[1])
    parts = [("K", so), ("G", gb), ("F", fb), ("W", bb), ("S", s), ("D", d), ("T", tr), ("H", hr)]
    power = sum(CHART_POWER[c] * n for c, n in parts)
    points = ob * 20 + fielding * 7 + max(0, round((speed - 1) * 1.5)) + power
    return [None, None, None, None, None, 0, points, ob, speed, pos, fielding, None, chart_string(parts)]

def build_pitcher(pid, t, L):
    ip = t["IPouts"] / 3
    if ip <= 0:
        return None
    bf = max(t["IPouts"] + t["H"] + t["BB"], 1)
    allowed_bb = t["BB"] / bf
    allowed_hr = t["HR"] / bf
    non_hr = max(0.0, (t["H"] - t["HR"]) / bf)
    # The databank has no doubles-allowed: split non-HR hits by the era's mix
    # (triples fold into doubles — engine pitcher charts carry no 3B).
    xb_share = (L["D"] + L["T"]) / max(1e-9, L["S"] + L["D"] + L["T"])
    allowed_d = non_hr * xb_share
    allowed_s = non_hr - allowed_d
    oba = (t["H"] + t["BB"]) / bf
    ctrl = clamp(round(ANCHOR_CTRL + (L["OBP"] - oba) * 50), 0, 6)
    Ap = (ANCHOR_OB - ctrl) / 20
    _, batter_league = league_split(L)
    back = lambda rate, l: max(0.0, (rate - Ap * l) / (1 - Ap)) * 20
    raw = [back(allowed_bb, L["BB"]), back(allowed_s, L["S"]),
           back(allowed_d, L["D"] + L["T"]), back(allowed_hr, batter_league["HR"])]
    onbase_slots = clamp(round(sum(raw)), 1, 9)
    bb, s, d, hr = spread(onbase_slots, raw)
    outs = 20 - onbase_slots
    out_rate = max(0.02, 1 - oba)
    so = clamp(round(outs * clamp((t["SO"] / bf) / out_rate, 0.05, 0.95)), 0, outs)
    pu = clamp(round(outs * 0.12), 0, outs - so)
    rest = outs - so - pu
    gb = round(rest * 0.55)
    fb = rest - gb
    if t["GS"] / max(1, t["G"]) >= 0.4:
        # Swingmen log relief innings too; estimate those out (~1.5 IP per
        # relief outing) so IP reflects innings per START, not per GS-divisor.
        start_outs = max(0.0, t["IPouts"] - (t["G"] - t["GS"]) * 4.5)
        role, ip_card = "SP", clamp(round(start_outs / max(1, t["GS"]) / 3), 4, 8)
    else:
        role, ip_card = "RP", 1 if t["SV"] > 30 or t["IPouts"] / max(1, t["G"]) < 5 else 2
    parts = [("P", pu), ("K", so), ("G", gb), ("F", fb), ("W", bb), ("S", s), ("D", d), ("H", hr)]
    power = sum(PIT_POWER[c] * n for c, n in parts)
    points = round((ctrl * 35 + power) * ((ip_card + 4) / 10)) + ip_card * 8
    return [None, None, None, None, None, 1, points, ctrl, ip_card, role, 0, None, chart_string(parts)]

def finish(card, pid, span, used_names, tag, hand_key):
    team = None
    id_suffix = ""
    info = people[pid]
    name = info["name"] or pid
    used_names[name] += 1
    if used_names[name] > 1:
        name = f"{name} '{str(span[0])[2:]}"
    card[0] = f"mlb-{tag}-{pid}{id_suffix}"
    card[1] = name
    card[2] = f"{team} {span[0]}-{span[1]}" if team else f"{span[0]}-{span[1]}"
    card[3] = str(span[1])
    card[4] = "MLB"
    card[11] = info[hand_key]
    return card

# The runtime assigns rarity by rank within hitters / SP / RP, and the
# starter pack falls back gracefully in thin spots — so a slice only needs
# basic depth: enough of each group, and every position represented in the
# common band (the pack's bread and butter).
def pool_ok(pool):
    hitters = [c for c in pool if c[5] == 0]
    sps = [c for c in pool if c[5] == 1 and c[9] == "SP"]
    rps = [c for c in pool if c[5] == 1 and c[9] == "RP"]
    if len(hitters) < 40 or len(sps) < 10 or len(rps) < 10:
        return False
    ranked = sorted(hitters, key=lambda c: -c[6])
    n = len(ranked)
    common = [c for i, c in enumerate(ranked) if (i + 1) / n > 0.30]
    for pos in ("C", "1B", "2B", "3B", "SS", "LF/RF", "CF"):
        if sum(1 for c in hitters if c[9] == pos) < 3 or not any(c[9] == pos for c in common):
            return False
    return True

def build_slice(tag, bat_slice, pit_slice, pos_slice, spans, min_pa, min_ipouts, bat_league_of, pit_league_of):
    used_names = defaultdict(int)
    pool = []
    for key, t in bat_slice.items():
        pid = key if isinstance(key, str) else key[0]
        if t["AB"] + t["BB"] < min_pa or pid not in people:
            continue
        pos = pos_slice.get(key, "DH")
        card = build_hitter(pid, t, pos, bat_league_of(key))
        if card:
            pool.append(finish(card, pid, spans[key], used_names, tag, "bats"))
    for key, t in pit_slice.items():
        pid = key if isinstance(key, str) else key[0]
        if t["IPouts"] < min_ipouts or pid not in people:
            continue
        card = build_pitcher(pid, t, pit_league_of(key))
        if card:
            pool.append(finish(card, pid, spans[key], used_names, tag, "throws"))
    return pool

print("accumulating batting...", file=sys.stderr)
bat_career, bat_franch, bat_decade, bat_spans = accumulate("Batting.csv", BAT_KEYS)
print("accumulating pitching...", file=sys.stderr)
pit_career, pit_franch, pit_decade, pit_spans = accumulate("Pitching.csv", PIT_KEYS)
print("accumulating positions...", file=sys.stderr)
pos_career, pos_franch, pos_decade = accumulate_positions()
spans_all = {**bat_spans, **pit_spans}
for key, span in bat_spans.items():
    if key in pit_spans:
        spans_all[key] = [min(span[0], pit_spans[key][0]), max(span[1], pit_spans[key][1])]

LEAGUE = league_tables(bat_decade)

# Era weights: a player's league context blends the decades he actually
# played in, weighted by his PA (hitters) or IP (pitchers) in each.
def era_weights(by_decade, pid, volume_keys):
    weights = defaultdict(float)
    for (p, dec), t in by_decade.items():
        if p == pid:
            weights[dec] += sum(t[k] for k in volume_keys)
    return weights

bat_weight_cache = {}
def bat_league_career(key):
    pid = key if isinstance(key, str) else key[0]
    if pid not in bat_weight_cache:
        bat_weight_cache[pid] = blend_league(LEAGUE, era_weights(bat_decade, pid, ["AB", "BB"]))
    return bat_weight_cache[pid]

pit_weight_cache = {}
def pit_league_career(key):
    pid = key if isinstance(key, str) else key[0]
    if pid not in pit_weight_cache:
        pit_weight_cache[pid] = blend_league(LEAGUE, era_weights(pit_decade, pid, ["IPouts"]))
    return pit_weight_cache[pid]

history = build_slice("all", bat_career, pit_career, pos_career, spans_all, 400, 450, bat_league_career, pit_league_career)
print(f"history: {len(history)}", file=sys.stderr)

# Decade cards pool the player's whole decade, every team combined.
decades = {}
for start in range(1870, 2030, 10):
    tag = "00s" if start == 2000 else f"d{start}"
    bat = {k: v for k, v in bat_decade.items() if k[1] == start}
    pit = {k: v for k, v in pit_decade.items() if k[1] == start}
    league = LEAGUE.get(start) or LEAGUE[max(LEAGUE)]
    pool = build_slice(tag, bat, pit, pos_decade, spans_all, 250, 225, lambda key: league, lambda key: league)
    if pool_ok(pool):
        decades[start] = pool
    else:
        print(f"  decade {start}s skipped ({len(pool)} cards, too thin)", file=sys.stderr)
print(f"decades kept: {sorted(decades)} sizes {[len(v) for k, v in sorted(decades.items())]}", file=sys.stderr)

franchises = {}
for fid, fname in sorted(franch_names.items()):
    bat = {k: v for k, v in bat_franch.items() if k[1] == fid}
    pit = {k: v for k, v in pit_franch.items() if k[1] == fid}
    pool = build_slice(f"f{fid}", bat, pit, pos_franch, spans_all, 400, 350, bat_league_career, pit_league_career)
    if pool_ok(pool):
        franchises[fid] = pool
    else:
        print(f"  franchise {fid} ({fname}) skipped ({len(pool)})", file=sys.stderr)
print(f"franchises kept: {len(franchises)}", file=sys.stderr)

header = """// Real-MLB card pools built from the Baseball Databank (Chadwick Baseball
// Bureau / Sean Lahman, CC BY-SA 3.0 — https://github.com/chadwickbureau/baseballdatabank).
// Cards derive from each player's real rates (career, decade window, or
// franchise stint), mapped into the fictional generator's parameter space.
// Generated by scripts/build-mlb-pools.py; do not hand-edit.
// Tuple: [id, name, yearsActive, lastYear, set, isPitcher, rawPoints,
//         obcOrControl, speedOrIp, positionOrRole, fielding, hand, chart]
"""
def dump(f, name, pool):
    f.write(f"export const {name} = [\n")
    for card in pool:
        f.write(json.dumps(card, separators=(",", ":")) + ",\n")
    f.write("];\n")

with open(os.path.join(SP, "mlbPools.js"), "w") as f:
    f.write(header)
    dump(f, "MLB_HISTORY_ROWS", history)
    f.write("export const MLB_DECADE_ROWS = {\n")
    for start, pool in sorted(decades.items()):
        f.write(f'"{start}": [\n')
        for card in pool:
            f.write(json.dumps(card, separators=(",", ":")) + ",\n")
        f.write("],\n")
    f.write("};\n")
    f.write("export const MLB_FRANCHISE_ROWS = {\n")
    for fid, pool in sorted(franchises.items()):
        f.write(f'"{fid}": [\n')
        for card in pool:
            f.write(json.dumps(card, separators=(",", ":")) + ",\n")
        f.write("],\n")
    f.write("};\n")
    f.write("export const MLB_FRANCHISE_NAMES = ")
    f.write(json.dumps({fid: franch_names[fid] for fid in sorted(franchises)}, indent=None))
    f.write(";\n")
print("wrote mlbPools.js", file=sys.stderr)
