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
    """One pass: career / franchise / decade-stint totals and year spans.
    Decade cards are player-TEAM stints — a decade key is (pid, fid, decade),
    so a mid-decade trade produces separate cards with separate years."""
    career, by_franch, by_stint = (defaultdict(lambda: defaultdict(int)) for _ in range(3))
    spans = defaultdict(lambda: [9999, 0])
    for r in rows(source):
        year = num(r, "yearID")
        pid = r["playerID"]
        fid = franch_of.get((year, r.get("teamID", "")), None)
        for k in keys:
            v = num(r, k)
            career[pid][k] += v
            if fid:
                by_franch[(pid, fid)][k] += v
                by_stint[(pid, fid, decade_of(year))][k] += v
        for key in (pid, (pid, fid) if fid else None, (pid, fid, decade_of(year)) if fid else None):
            if key is None:
                continue
            span = spans[key]
            span[0] = min(span[0], year)
            span[1] = max(span[1], year)
    return career, by_franch, by_stint, spans

def accumulate_positions():
    career, by_franch, by_stint = (defaultdict(lambda: defaultdict(int)) for _ in range(3))
    for r in rows("Appearances.csv"):
        year = num(r, "yearID")
        pid = r["playerID"]
        fid = franch_of.get((year, r.get("teamID", "")), None)
        for col, pos in POS_COLS.items():
            g = num(r, col)
            if not g:
                continue
            career[pid][pos] += g
            if fid:
                by_franch[(pid, fid)][pos] += g
                by_stint[(pid, fid, decade_of(year))][pos] += g
    pick = lambda table: {k: max(g, key=g.get) for k, g in table.items() if sum(g.values()) > 0}
    return pick(career), pick(by_franch), pick(by_stint)

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

def build_hitter(pid, t, pos):
    pa = t["AB"] + t["BB"]
    if pa <= 0 or t["AB"] == 0:
        return None
    obp = (t["H"] + t["BB"]) / pa
    outs = clamp(round(8.5 - (obp - 0.320) * 50), 2, 11)
    remaining = 20 - outs
    walks = clamp(round(remaining * (t["BB"] / max(1, t["BB"] + t["H"]))), 0, remaining - 1)
    hits = remaining - walks
    share = lambda k: t[k] / max(1, t["H"])
    hr, tr, db = spread(hits, [hits * share("HR"), hits * share("3B"), hits * share("2B")])
    singles = hits - hr - tr - db
    if singles < 0:
        db += singles
        singles = 0
    so = clamp(round(outs * (t["SO"] / max(1, t["AB"] - t["H"]))), 0, outs)
    gb = round((outs - so) * 0.55)
    fb = outs - so - gb
    on_base = clamp(round(6 + (obp - 0.270) * 60), 6, 15)
    speed = clamp(round(8 + (t["SB"] / pa * 650) * 0.3 + share("3B") * 30), 6, 22)
    frange = FIELD_RANGE[pos]
    fielding = h(pid, "fld", frange[0], frange[1])
    parts = [("K", so), ("G", gb), ("F", fb), ("W", walks), ("S", singles), ("D", db), ("T", tr), ("H", hr)]
    power = sum(CHART_POWER[c] * n for c, n in parts)
    points = on_base * 20 + fielding * 7 + max(0, round((speed - 1) * 1.5)) + power
    return [None, None, None, None, None, 0, points, on_base, speed, pos, fielding, None, chart_string(parts)]

def build_pitcher(pid, t):
    ip = t["IPouts"] / 3
    if ip <= 0:
        return None
    whip = (t["H"] + t["BB"]) / ip
    k9 = t["SO"] * 9 / ip
    control = clamp(round(3.5 + (1.32 - whip) * 5), 0, 6)
    outs = clamp(round(15.5 + (1.32 - whip) * 5), 11, 19)
    remaining = 20 - outs
    walks = clamp(round(remaining * (t["BB"] / max(1, t["BB"] + t["H"]))), 0, remaining)
    hits = remaining - walks
    hr = clamp(round(hits * (t["HR"] / max(1, t["H"]))), 0, hits)
    db = clamp(round((hits - hr) * 0.3), 0, hits - hr)
    singles = hits - hr - db
    so = round(outs * clamp(k9 / 24, 0.10, 0.55))
    pu = clamp(round(outs * 0.12), 0, outs - so)
    rest = outs - so - pu
    gb = round(rest * 0.55)
    fb = rest - gb
    if t["GS"] / max(1, t["G"]) >= 0.4:
        role, ip_card = "SP", clamp(round(t["IPouts"] / max(1, t["GS"]) / 3), 4, 8)
    else:
        role, ip_card = "RP", 1 if t["SV"] > 30 or t["IPouts"] / max(1, t["G"]) < 5 else 2
    parts = [("P", pu), ("K", so), ("G", gb), ("F", fb), ("W", walks), ("S", singles), ("D", db), ("H", hr)]
    power = sum(PIT_POWER[c] * n for c, n in parts)
    points = round((control * 35 + power) * ((ip_card + 4) / 10)) + ip_card * 8
    return [None, None, None, None, None, 1, points, control, ip_card, role, 0, None, chart_string(parts)]

def finish(card, pid, span, used_names, tag, hand_key, team=None, id_suffix=""):
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

def build_slice(tag, bat_slice, pit_slice, pos_slice, spans, min_pa, min_ipouts, team_of=None):
    used_names = defaultdict(int)
    pool = []
    for key, t in bat_slice.items():
        pid = key if isinstance(key, str) else key[0]
        if t["AB"] + t["BB"] < min_pa or pid not in people:
            continue
        pos = pos_slice.get(key, "DH")
        card = build_hitter(pid, t, pos)
        if card:
            team = team_of(key) if team_of else None
            suffix = f"-{key[1]}" if team_of else ""
            pool.append(finish(card, pid, spans[key], used_names, tag, "bats", team, suffix))
    for key, t in pit_slice.items():
        pid = key if isinstance(key, str) else key[0]
        if t["IPouts"] < min_ipouts or pid not in people:
            continue
        card = build_pitcher(pid, t)
        if card:
            team = team_of(key) if team_of else None
            suffix = f"-{key[1]}" if team_of else ""
            pool.append(finish(card, pid, spans[key], used_names, tag, "throws", team, suffix))
    return pool

print("accumulating batting...", file=sys.stderr)
bat_career, bat_franch, bat_stint, bat_spans = accumulate("Batting.csv", BAT_KEYS)
print("accumulating pitching...", file=sys.stderr)
pit_career, pit_franch, pit_stint, pit_spans = accumulate("Pitching.csv", PIT_KEYS)
print("accumulating positions...", file=sys.stderr)
pos_career, pos_franch, pos_stint = accumulate_positions()
spans_all = {**bat_spans, **pit_spans}
for key, span in bat_spans.items():
    if key in pit_spans:
        spans_all[key] = [min(span[0], pit_spans[key][0]), max(span[1], pit_spans[key][1])]

history = build_slice("all", bat_career, pit_career, pos_career, spans_all, 400, 450)
print(f"history: {len(history)}", file=sys.stderr)

# Decade cards are per-team stints: the card names its club, and its years
# and stats cover only that player's run with that club inside the decade.
decades = {}
for start in range(1870, 2030, 10):
    tag = "00s" if start == 2000 else f"d{start}"
    bat = {k: v for k, v in bat_stint.items() if k[2] == start}
    pit = {k: v for k, v in pit_stint.items() if k[2] == start}
    pool = build_slice(tag, bat, pit, pos_stint, spans_all, 200, 180, team_of=lambda key: key[1])
    if pool_ok(pool):
        decades[start] = pool
    else:
        print(f"  decade {start}s skipped ({len(pool)} cards, too thin)", file=sys.stderr)
print(f"decades kept: {sorted(decades)} sizes {[len(v) for k, v in sorted(decades.items())]}", file=sys.stderr)

franchises = {}
for fid, fname in sorted(franch_names.items()):
    bat = {k: v for k, v in bat_franch.items() if k[1] == fid}
    pit = {k: v for k, v in pit_franch.items() if k[1] == fid}
    pool = build_slice(f"f{fid}", bat, pit, pos_franch, spans_all, 400, 350)
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
