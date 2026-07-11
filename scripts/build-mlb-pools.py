#!/usr/bin/env python3
"""Build real-MLB card pools from the Baseball Databank (CC BY-SA).

Pools: full history (career stats), every decade (window stats), and every
franchise (stats accumulated with that club). Thresholds are deliberately low
— the point is a wide swath of players, not an all-star gala. Charts and
ratings derive from each player's real rates, mapped into the fictional card
generator's parameter space; the game recalibrates raw points into printed
prices per save. Slices that can't support a legal starter pack (a common and
a rare at every slot) are dropped.

Rates are PEAK-WEIGHTED with small-sample regression: a player's seasons in
a slice rank best-first and blend on a geometric ladder (full best season
50%, next 25%, then 12.5%, ...), and the residual weight fills with
league-average rates. One great summer reads "good," not "franchise legend";
a decade of stardom is scored off the prime. See "Peak-weighted sampling".
"""
import csv, hashlib, json, os, sys
from collections import defaultdict

SP = os.path.dirname(os.path.abspath(__file__))
L = os.path.join(SP, "lahman")

def rows(name):
    # utf-8-sig: some databank releases ship with a BOM, which would otherwise
    # corrupt the first header name (yearID) and zero out every year.
    with open(os.path.join(L, name), newline="", encoding="utf-8-sig", errors="replace") as f:
        yield from csv.DictReader(f)

def num(row, key):
    value = row.get(key, "") or "0"
    try:
        return int(value)
    except ValueError:
        return 0

# Name suffixes (Jr./Sr./II) from the Chadwick register + MLB StatsAPI —
# Lahman's People.csv has none, so without these the two Vladimir Guerreros
# collide and the son cards as "Vladimir Guerrero '19" instead of "Jr.".
# See scripts/fetch-name-suffixes.mjs.
try:
    SUFFIXES = json.load(open(os.path.join(SP, "name-suffixes.json")))
except FileNotFoundError:
    SUFFIXES = {}

people = {}
for r in rows("People.csv"):
    pid = r["playerID"]
    name = f"{r.get('nameFirst') or ''} {r.get('nameLast') or ''}".strip()
    if pid in SUFFIXES:
        name = f"{name} {SUFFIXES[pid]}"
    people[pid] = {
        "name": name,
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
    """One pass: per-season stat lines for the career / franchise / decade
    slices, decade league totals, and year spans. Decade cards pool a
    player's ENTIRE decade regardless of team; franchise cards pool a
    player's entire career with that club regardless of decade. Seasons stay
    separate within each slice (stints within a year merge) so cards can be
    peak-weighted downstream."""
    make = lambda: defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    career, by_franch, by_decade = make(), make(), make()
    decade_totals = defaultdict(lambda: defaultdict(int))
    spans = defaultdict(lambda: [9999, 0])
    for r in rows(source):
        year = num(r, "yearID")
        pid = r["playerID"]
        dec = decade_of(year)
        fid = franch_of.get((year, r.get("teamID", "")), None)
        for k in keys:
            v = num(r, k)
            career[pid][year][k] += v
            by_decade[(pid, dec)][year][k] += v
            decade_totals[dec][k] += v
            if fid:
                by_franch[(pid, fid)][year][k] += v
        for key in (pid, (pid, dec), (pid, fid) if fid else None):
            if key is None:
                continue
            span = spans[key]
            span[0] = min(span[0], year)
            span[1] = max(span[1], year)
    return career, by_franch, by_decade, decade_totals, spans

def accumulate_positions():
    """Full games-by-position tables per slice; position_list() reduces each
    to an eligibility list at build time."""
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
    return career, by_franch, by_decade

def position_list(games, floor=30, share=0.25, cap=3):
    """A card's defensive eligibility, like the real Showdown multi-position
    printings ("2B+3 SS+2"). Primary spot = most games in the slice;
    secondary spots need a real share of the slice's defensive games (>=25%,
    min 30 G) so a September cameo doesn't print on the card. DH never lists
    as a secondary — anyone can DH already."""
    if not games:
        return ["DH"]
    ranked = sorted(games.items(), key=lambda kv: (-kv[1], kv[0]))
    total = sum(games.values())
    out = [ranked[0][0]]
    for pos, g in ranked[1:]:
        if len(out) >= cap:
            break
        if pos != "DH" and g >= floor and g >= share * total:
            out.append(pos)
    return out

def h(pid, salt, lo, hi):
    digest = hashlib.sha1(f"{pid}:{salt}".encode()).digest()
    return lo + digest[0] % (hi - lo + 1)

# Real defensive ratings: FanGraphs Defense runs z-scored by position/era,
# databank range-factor/fielding-pct fallback, catcher arms from real
# caught-stealing rates, Gold Gloves as a bump. See process-defense.py.
try:
    DEF_RATINGS = json.load(open(os.path.join(SP, "defense-ratings.json")))
except FileNotFoundError:
    DEF_RATINGS = {}

try:
    MLBAM = json.load(open(os.path.join(SP, "mlbam-map.json")))
except FileNotFoundError:
    MLBAM = {}

def real_fielding(pid, pos):
    lo, hi = FIELD_RANGE[pos]
    if hi <= lo:
        return lo
    r = DEF_RATINGS.get(pid)
    if not r:
        # No defensive record: a fringe glove, just below band middle.
        return round(lo + (hi - lo) * 0.4)
    if pos == "C" and r.get("cs_z") is not None:
        z = 0.7 * r["cs_z"] + 0.3 * r["z"]   # the engine uses C fielding as the arm
    else:
        z = r["z"]
    z += min(r["gg"], 8) * 0.2
    z = max(-2.0, min(2.75, z))
    return round(lo + (hi - lo) * (z + 2.0) / 4.75)

# Small positional priors on raw footspeed, per the design brief.
SPEED_PRIOR = {"C": -2, "1B": -1, "DH": -1, "2B": 1, "SS": 1, "CF": 2, "3B": 0, "LF/RF": 0}

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
# Bands follow the real 2002-05 print ranges: elite catcher arms reach +14,
# shortstop wizards +7, and the floors sit at 0 so the butchers show.
# Bands match the measured 2000-2005 print ranges from the classic set.
FIELD_RANGE = {"C": (0, 12), "1B": (0, 1), "2B": (0, 6), "3B": (0, 5), "SS": (0, 6), "LF/RF": (0, 3), "CF": (0, 4), "DH": (0, 0)}

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
# The classic Showdown shape: an average matchup is Control 3 vs OB 9 (30%
# batter advantage), with HOT batter charts (65% on-base, outs 1-7) offset by
# STINGY pitcher charts (outs ~1-16). The blend hits the era's league totals:
# 0.30 x 65% + 0.70 x pitcherShare = league OBP, so pitcher charts get
# stingier in dead-ball eras and looser in juiced ones. Both charts keep the
# era's event MIX; strikeouts ride each chart's out share.
ANCHOR_CTRL = 3
ANCHOR_OB = 9
ANCHOR_A = (ANCHOR_OB - ANCHOR_CTRL) / 20
BATTER_ONBASE_SHARE = 0.65
EVENTS = ["BB", "S", "D", "T", "HR"]

def league_split(L):
    """League-average batter and pitcher charts implied by L and the anchor."""
    pitcher_onbase = max(0.05, (L["OBP"] - ANCHOR_A * BATTER_ONBASE_SHARE) / (1 - ANCHOR_A))
    batter_scale = BATTER_ONBASE_SHARE / L["OBP"]
    pitcher_scale = pitcher_onbase / L["OBP"]
    k_of_outs = L["K"] / max(1e-9, 1 - L["OBP"])
    pitcher = {e: L[e] * pitcher_scale for e in EVENTS}
    pitcher["K"] = k_of_outs * (1 - pitcher_onbase)
    batter = {e: L[e] * batter_scale for e in EVENTS}
    batter["K"] = k_of_outs * (1 - BATTER_ONBASE_SHARE)
    return pitcher, batter

def league_tables(decade_totals):
    tables = {}
    for dec, t in decade_totals.items():
        pa = t["AB"] + t["BB"]
        if pa < 50000:
            continue
        singles = t["H"] - t["2B"] - t["3B"] - t["HR"]
        # League footspeed norms: net steals per PA (early decades lack CS
        # entirely — discount raw SB the same way player cards do) and
        # triples per hit. Speed ratings normalize against these, so 1890s
        # scorekeeping can't blow out the scale.
        net = (t["SB"] - t["CS"]) if t["CS"] > 0 else t["SB"] * 0.7
        tables[dec] = {
            "BB": t["BB"] / pa, "S": singles / pa, "D": t["2B"] / pa,
            "T": t["3B"] / pa, "HR": t["HR"] / pa, "K": t["SO"] / pa,
            "OBP": (t["H"] + t["BB"]) / pa,
            "NET": max(0.0, net) / pa, "T_H": t["3B"] / max(1, t["H"]), "PA": pa,
        }
    return tables

# The modern reference the norms rescale to: PA-weighted 1970s-2000s league
# rates. A player who steals at 3x HIS league's clip rates like a modern
# player stealing at 3x the modern clip, whatever the era's bookkeeping.
def speed_reference(tables):
    decs = [d for d in range(1970, 2010, 10) if d in tables]
    total = sum(tables[d]["PA"] for d in decs)
    return {k: sum(tables[d][k] * tables[d]["PA"] for d in decs) / total for k in ("NET", "T_H")}

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

# ---- Peak-weighted sampling ---------------------------------------------------
#
# Slice rates are not raw totals. A player's seasons rank best-first
# (era-relative quality, shrunk toward league so a hot cup of coffee can't
# rank as a "best season") and blend on a geometric ladder: the best full
# season carries 50% weight, the next 25%, and so on. Whatever weight the
# real seasons don't claim goes to LEAGUE-AVERAGE rates. A one-great-summer
# wonder blends about half league average and reads "good," not
# "inner-circle legend" (the John McGraw 1900 Cardinals problem), while a
# ten-year star pads ~0% and is scored off the shape of his prime instead
# of his decline years. Season size is continuous — 250 PA claims half a
# rung, a 700-PA workhorse year claims 1.4 — so partial seasons earn
# partial weight and a tiny scorching September can never grab the top rung.
# Bulk credit fades fast by design: the pad is 50% after one full season,
# 12.5% after three, ~0 after eight. It's a confidence haircut, not a
# career-length reward — five seasons vs three moves a star's card by less
# than a rounding step.
HIT_QUOTA = 500.0    # PA that counts as one full season on the ladder
PIT_QUOTA = 540.0    # IPouts (~180 IP) likewise; relief seasons earn partial rungs
RANK_PRIOR = 120.0   # PA/BF of league ballast when RANKING seasons

WOBA_W = {"BB": 0.7, "S": 0.9, "D": 1.25, "T": 1.6, "HR": 2.0}

def league_of_year(year, fixed=None):
    if fixed is not None:
        return fixed
    dec = decade_of(year)
    return LEAGUE.get(dec) or LEAGUE[min(LEAGUE, key=lambda d: abs(d - dec))]

def hitter_season_score(t, L):
    pa = t["AB"] + t["BB"]
    singles = t["H"] - t["2B"] - t["3B"] - t["HR"]
    val = (WOBA_W["BB"] * t["BB"] + WOBA_W["S"] * singles + WOBA_W["D"] * t["2B"]
           + WOBA_W["T"] * t["3B"] + WOBA_W["HR"] * t["HR"])
    lg = sum(WOBA_W[e] * L[e] for e in EVENTS)
    return (val + lg * RANK_PRIOR) / (pa + RANK_PRIOR) - lg

def pitcher_season_score(t, L):
    bf = t["IPouts"] + t["H"] + t["BB"]
    oba = (t["H"] + t["BB"] + L["OBP"] * RANK_PRIOR) / (bf + RANK_PRIOR)
    return L["OBP"] - oba

def ladder_weights(sizes):
    """Geometric ladder over season-equivalents: the stretch [a, b] of the
    sorted, sized seasons gets weight 2^-a - 2^-b; the tail past the last
    real season is the league-average pad."""
    x = 0.0
    weights = []
    for s in sizes:
        weights.append(2.0 ** -x - 2.0 ** -(x + s))
        x += s
    return weights, 2.0 ** -x

def peak_blend_hitter(years, fixed_league=None):
    """Ladder-weighted per-PA rates, expressed as synthetic totals over the
    player's real PA (downstream math is rate-based; volume only feeds
    thresholds). Returns the totals and the matching league context, blended
    with the same weights so the era backdrop tracks the seasons that count."""
    seasons = [(y, t, t["AB"] + t["BB"]) for y, t in years.items() if t["AB"] + t["BB"] > 0]
    if not seasons:
        return None, None
    seasons.sort(key=lambda s: -hitter_season_score(s[1], league_of_year(s[0], fixed_league)))
    weights, pad = ladder_weights([pa / HIT_QUOTA for _, _, pa in seasons])
    rate, dec_w = defaultdict(float), defaultdict(float)
    for (y, t, pa), w in zip(seasons, weights):
        for k in ("BB", "2B", "3B", "HR", "SO", "SB", "CS"):
            rate[k] += w * t[k] / pa
        rate["S"] += w * (t["H"] - t["2B"] - t["3B"] - t["HR"]) / pa
        dec_w[decade_of(y)] += w
    L = fixed_league if fixed_league is not None else blend_league(LEAGUE, dec_w)
    # The pad is a league-average ghost: on-base mix from the league table,
    # steals at the league net rate (CS 0 — NET already nets them out).
    for k, lg in (("BB", "BB"), ("S", "S"), ("2B", "D"), ("3B", "T"),
                  ("HR", "HR"), ("SO", "K"), ("SB", "NET")):
        rate[k] += pad * L[lg]
    pa_total = sum(pa for _, _, pa in seasons)
    t = {k: rate[k] * pa_total for k in ("BB", "2B", "3B", "HR", "SO", "SB", "CS")}
    t["H"] = (rate["S"] + rate["2B"] + rate["3B"] + rate["HR"]) * pa_total
    t["AB"] = pa_total - t["BB"]
    return t, L

def peak_blend_pitcher(years, fixed_league=None):
    seasons = [(y, t, t["IPouts"] + t["H"] + t["BB"]) for y, t in years.items() if t["IPouts"] > 0]
    if not seasons:
        return None, None
    seasons.sort(key=lambda s: -pitcher_season_score(s[1], league_of_year(s[0], fixed_league)))
    weights, pad = ladder_weights([t["IPouts"] / PIT_QUOTA for _, t, _ in seasons])
    rate, dec_w = defaultdict(float), defaultdict(float)
    for (y, t, bf), w in zip(seasons, weights):
        for k in ("H", "BB", "HR", "SO"):
            rate[k] += w * t[k] / bf
        dec_w[decade_of(y)] += w
    L = fixed_league if fixed_league is not None else blend_league(LEAGUE, dec_w)
    rate["H"] += pad * (L["S"] + L["D"] + L["T"] + L["HR"])
    rate["BB"] += pad * L["BB"]
    rate["HR"] += pad * L["HR"]
    rate["SO"] += pad * L["K"]
    bf_total = sum(bf for _, _, bf in seasons)
    t = {k: rate[k] * bf_total for k in ("H", "BB", "HR", "SO")}
    t["IPouts"] = bf_total - t["H"] - t["BB"]
    # Usage (role, workload, saves) stays real — regression is about rates.
    for k in ("G", "GS", "SV"):
        t[k] = sum(season[k] for _, season, _ in seasons)
    return t, L

# Speed: net steals (efficiency counts) and triples-per-hit as footspeed
# proxies, each normalized to the player's own era and rescaled toward the
# modern reference norm (REF_SPEED), plus a small positional prior. Absolute
# rates would let pre-1900 bookkeeping (steals credited for extra bases,
# dead-ball triples) pin the whole scale. The era factor is square-root
# damped: era gaps are half bookkeeping and strategy (normalize away), half
# real rate signal (keep) — so Ichiro rates a burner against his own league,
# 1890s 100-steal seasons read "fast for his day" instead of "faster than
# Rickey", and the station-to-station 1950s don't inflate into track stars.
# Pre-1951 seasons often lack CS data — when a real base stealer shows zero
# CS, discount volume instead.
def speed_rating(t, pa, pos, L):
    if t["CS"] == 0 and t["SB"] >= 15:
        net = t["SB"] * 0.7
    else:
        net = max(0, t["SB"] - t["CS"])
    net_rate = (net / pa) * (REF_SPEED["NET"] / max(1e-4, L.get("NET", REF_SPEED["NET"]))) ** 0.5
    t3_rate = (t["3B"] / max(1, t["H"])) * (REF_SPEED["T_H"] / max(1e-3, L.get("T_H", REF_SPEED["T_H"]))) ** 0.5
    return clamp(round(8 + SPEED_PRIOR.get(pos, 0) + net_rate * 227.5 + t3_rate * 25), 8, 28)

def build_hitter(pid, t, positions, L):
    pos = positions[0]
    pa = t["AB"] + t["BB"]
    if pa <= 0 or t["AB"] == 0:
        return None
    singles = t["H"] - t["2B"] - t["3B"] - t["HR"]
    b = {"BB": t["BB"] / pa, "S": singles / pa, "D": t["2B"] / pa,
         "T": t["3B"] / pa, "HR": t["HR"] / pa}
    obp = (t["H"] + t["BB"]) / pa
    # OB scales off the ERA-relative on-base gap; the chart backs the league
    # out at that advantage, so OB and chart stay consistent by construction.
    ob = clamp(round(ANCHOR_OB + (obp - L["OBP"]) * 50), 4, 16)
    A = (ob - ANCHOR_CTRL) / 20
    pitcher_league, _ = league_split(L)
    raw = {e: max(0.0, (b[e] - (1 - A) * pitcher_league[e]) / A) * 20 for e in EVENTS}
    onbase_slots = clamp(round(sum(raw.values())), 2, 18)
    bb, s, d, tr, hr = spread(onbase_slots, [raw["BB"], raw["S"], raw["D"], raw["T"], raw["HR"]])
    outs = 20 - onbase_slots
    # Strikeouts back out like everything else: a contact hitter's chart
    # carries fewer K slots than his raw K share would suggest.
    so = clamp(round(max(0.0, ((t["SO"] / pa) - (1 - A) * pitcher_league["K"]) / A) * 20), 0, outs)
    gb = round((outs - so) * 0.55)
    fb = outs - so - gb
    speed = speed_rating(t, pa, pos, L)
    # One fielding per listed position, each from the same defensive record
    # mapped into that position's band. Points price the primary glove.
    fieldings = [real_fielding(pid, p) for p in positions]
    parts = [("K", so), ("G", gb), ("F", fb), ("W", bb), ("S", s), ("D", d), ("T", tr), ("H", hr)]
    power = sum(CHART_POWER[c] * n for c, n in parts)
    points = ob * 20 + fieldings[0] * 7 + max(0, round((speed - 1) * 1.5)) + power
    pos_field = (positions, fieldings) if len(positions) > 1 else (positions[0], fieldings[0])
    return [None, None, None, None, None, 0, points, ob, speed, pos_field[0], pos_field[1], None, chart_string(parts)]

def build_pitcher(pid, t, L, last_year=9999):
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
    raw = [back(allowed_bb, batter_league["BB"]), back(allowed_s, batter_league["S"]),
           back(allowed_d, batter_league["D"] + batter_league["T"]), back(allowed_hr, batter_league["HR"])]
    onbase_slots = clamp(round(sum(raw)), 1, 9)
    bb, s, d, hr = spread(onbase_slots, raw)
    outs = 20 - onbase_slots
    so = clamp(round(max(0.0, ((t["SO"] / bf) - Ap * batter_league["K"]) / (1 - Ap)) * 20), 0, outs)
    pu = clamp(round(outs * 0.12), 0, outs - so)
    rest = outs - so - pu
    gb = round(rest * 0.55)
    fb = rest - gb
    outs_per_g = t["IPouts"] / max(1, t["G"])
    if t["GS"] / max(1, t["G"]) >= 0.4:
        # Swingmen log relief innings too; estimate those out (~1.5 IP per
        # relief outing) so IP reflects innings per START, not per GS-divisor.
        start_outs = max(0.0, t["IPouts"] - (t["G"] - t["GS"]) * 4.5)
        role, ip_card = "SP", clamp(round(start_outs / max(1, t["GS"]) / 3), 4, 9)
    elif outs_per_g >= 9 and last_year >= 1950:
        # Opener-era bulk guys and true swingmen: few official GS, but 3+
        # innings every time out. Lahman's GS undercounts their de facto
        # starts, so rate them as short starters, not monster relievers —
        # otherwise a 2019 Milone outranks every real closer in the pool.
        # Era-gated to the relief-specialist age: before ~1950 every arm
        # worked long, and reclassifying them would leave dead-ball pools
        # with no bullpen at all for the two RP roster slots.
        role, ip_card = "SP", clamp(round(outs_per_g / 3), 4, 9)
    else:
        role, ip_card = "RP", 1 if t["SV"] > 30 or outs_per_g < 5 else 2
    parts = [("P", pu), ("K", so), ("G", gb), ("F", fb), ("W", bb), ("S", s), ("D", d), ("H", hr)]
    power = sum(PIT_POWER[c] * n for c, n in parts)
    points = round((ctrl * 35 + power) * ((ip_card + 4) / 10)) + ip_card * 8
    return [None, None, None, None, None, 1, points, ctrl, ip_card, role, 0, None, chart_string(parts)]

def finish(card, pid, span, metas, tag, hand_key, id_suffix=""):
    team = None
    info = people[pid]
    name = info["name"] or pid
    card[0] = f"mlb-{tag}-{pid}{id_suffix}"
    card[1] = name
    card[2] = f"{team} {span[0]}-{span[1]}" if team else f"{span[0]}-{span[1]}"
    card[3] = str(span[1])
    card[4] = "MLB"
    card[11] = info[hand_key]
    card.append(0)  # foil flag (unused for MLB pools)
    # Official headshots are reliable from ~1990 on; earlier eras use Wikipedia.
    card.append(MLBAM.get(pid) if span[1] >= 1990 else None)
    # Namesakes are disambiguated in a second pass (see disambiguate_names);
    # record what that pass needs so it can pick which printing keeps the
    # plain name and which earns the year suffix.
    metas.append({"card": card, "pid": pid, "base": name, "span0": span[0]})
    return card

# Two genuinely different players can share a name within one slice (both
# Frank Thomases have a career card; both Randy Johnsons pitch and hit). The
# more prominent printing — most card points — keeps the clean name; the rest
# earn a year suffix ("Frank Thomas '51"). Grouping by player id means a
# two-way player's bat and arm halves, which share an id, never suffix each
# other. Card ids are id-based, not name-based, so this only moves display
# names; saved collections still resolve.
def disambiguate_names(metas):
    by_name = defaultdict(list)
    for m in metas:
        by_name[m["base"]].append(m)
    for base, group in by_name.items():
        pids = {m["pid"] for m in group}
        if len(pids) <= 1:
            continue
        prominence = {}
        for m in group:
            prominence[m["pid"]] = max(prominence.get(m["pid"], -1), m["card"][6])
        keep = min(pids, key=lambda p: (-prominence[p], p))
        for m in group:
            if m["pid"] != keep:
                m["card"][1] = f"{base} '{str(m['span0'])[2:]}"

# The runtime assigns rarity by rank within hitters / SP / RP, and the
# starter pack falls back gracefully in thin spots — so a slice only needs
# basic depth: enough of each group, and every position represented in the
# common band (the pack's bread and butter).
def card_positions(c):
    return c[9] if isinstance(c[9], list) else [c[9]]

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
        if sum(1 for c in hitters if pos in card_positions(c)) < 3 or not any(pos in card_positions(c) for c in common):
            return False
    return True

def build_slice(tag, bat_slice, pit_slice, pos_slice, spans, min_pa, min_ipouts, fixed_league=None):
    """Slices hold per-season lines; entry thresholds gate on REAL volume,
    then rates blend through the peak ladder. fixed_league pins the era
    context (single-decade slices); None judges each season against its own
    decade and blends the backdrop by the ladder weights."""
    metas = []
    pool = []
    for key, years in bat_slice.items():
        pid = key if isinstance(key, str) else key[0]
        pa_real = sum(t["AB"] + t["BB"] for t in years.values())
        if pa_real < min_pa or pid not in people:
            continue
        # Pitchers who merely batted a lot (every dead-ball workhorse) don't
        # get hitter cards; true two-way players (Ruth, Ohtani) keep both.
        pit_years = pit_slice.get(key)
        ip_real = sum(t["IPouts"] for t in pit_years.values()) if pit_years else 0
        if ip_real >= pa_real:
            continue
        positions = position_list(pos_slice.get(key))
        t, L = peak_blend_hitter(years, fixed_league)
        card = build_hitter(pid, t, positions, L) if t else None
        if card:
            # Two-way players yield two cards; the bat half's id gets a
            # suffix so both live in one pool (bare id keeps meaning the
            # arm, which is what existing saves resolve to).
            two_way = ip_real >= min_ipouts
            pool.append(finish(card, pid, spans[key], metas, tag, "bats",
                               id_suffix="-bat" if two_way else ""))
    for key, years in pit_slice.items():
        pid = key if isinstance(key, str) else key[0]
        if sum(t["IPouts"] for t in years.values()) < min_ipouts or pid not in people:
            continue
        t, L = peak_blend_pitcher(years, fixed_league)
        card = build_pitcher(pid, t, L, spans[key][1]) if t else None
        if card:
            pool.append(finish(card, pid, spans[key], metas, tag, "throws"))
    disambiguate_names(metas)
    return pool

print("accumulating batting...", file=sys.stderr)
bat_career, bat_franch, bat_decade, bat_lg_totals, bat_spans = accumulate("Batting.csv", BAT_KEYS)
print("accumulating pitching...", file=sys.stderr)
pit_career, pit_franch, pit_decade, _, pit_spans = accumulate("Pitching.csv", PIT_KEYS)
print("accumulating positions...", file=sys.stderr)
pos_career, pos_franch, pos_decade = accumulate_positions()
spans_all = {**bat_spans, **pit_spans}
for key, span in bat_spans.items():
    if key in pit_spans:
        spans_all[key] = [min(span[0], pit_spans[key][0]), max(span[1], pit_spans[key][1])]

LEAGUE = league_tables(bat_lg_totals)
REF_SPEED = speed_reference(LEAGUE)

history = build_slice("all", bat_career, pit_career, pos_career, spans_all, 400, 450)
print(f"history: {len(history)}", file=sys.stderr)

# Decade cards pool the player's whole decade, every team combined. The
# earliest section is "the 1910s & earlier": dedicated relief pitching barely
# exists before 1920 (the 1870s-1900s produce 0-5 RP cards each, under the
# 10 pool_ok needs), so those decades can't stand alone — instead everything
# through 1919 folds into one combined window, one card per player.
EARLIEST = 1910

def merge_early(by_decade):
    merged = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    for (pid, dec), years in by_decade.items():
        if dec <= EARLIEST:
            for y, t in years.items():
                for k, v in t.items():
                    merged[(pid, EARLIEST)][y][k] += v
    return merged

def merge_early_flat(table):
    merged = defaultdict(lambda: defaultdict(int))
    for (pid, dec), g in table.items():
        if dec <= EARLIEST:
            for k, v in g.items():
                merged[(pid, EARLIEST)][k] += v
    return merged

early_bat, early_pit = merge_early(bat_decade), merge_early(pit_decade)
early_pos = merge_early_flat(pos_decade)
early_spans = dict(spans_all)
for key, span in spans_all.items():
    if isinstance(key, tuple) and isinstance(key[1], int) and key[1] <= EARLIEST:
        merged = early_spans.get((key[0], EARLIEST), [9999, 0])
        early_spans[(key[0], EARLIEST)] = [min(merged[0], span[0]), max(merged[1], span[1])]

decades = {}
for start in range(EARLIEST, 2030, 10):
    tag = "00s" if start == 2000 else f"d{start}"
    if start == EARLIEST:
        # No fixed league for the merged window: each season is judged
        # against its own decade — an 1884 hitter against 1880s baseball,
        # not the 1910s — and the backdrop blends by the ladder weights.
        bat, pit, pos, spans, fixed = early_bat, early_pit, early_pos, early_spans, None
    else:
        bat = {k: v for k, v in bat_decade.items() if k[1] == start}
        pit = {k: v for k, v in pit_decade.items() if k[1] == start}
        pos, spans = pos_decade, spans_all
        fixed = LEAGUE.get(start) or LEAGUE[max(LEAGUE)]
    pool = build_slice(tag, bat, pit, pos, spans, 250, 225, fixed_league=fixed)
    if pool_ok(pool):
        decades[start] = pool
    else:
        print(f"  decade {start}s skipped ({len(pool)} cards, too thin)", file=sys.stderr)
print(f"decades kept: {sorted(decades)} sizes {[len(v) for k, v in sorted(decades.items())]}", file=sys.stderr)

franchises = {}
for fid, fname in sorted(franch_names.items()):
    bat = {k: v for k, v in bat_franch.items() if k[1] == fid}
    pit = {k: v for k, v in pit_franch.items() if k[1] == fid}
    # Franchise pools run the loosest gate (250 PA / ~75 IP with the club,
    # matching the decade slices): the whole point is a deep bench of guys
    # who actually wore the uniform, and peak-weighted regression already
    # keeps the short-timers priced like short-timers.
    pool = build_slice(f"f{fid}", bat, pit, pos_franch, spans_all, 250, 225)
    if pool_ok(pool):
        franchises[fid] = pool
    else:
        print(f"  franchise {fid} ({fname}) skipped ({len(pool)})", file=sys.stderr)
print(f"franchises kept: {len(franchises)}", file=sys.stderr)

# ---- Simultaneous two-way bundles ---------------------------------------------
#
# The Ohtani rule: a player whose bat and arm value came AT THE SAME TIME
# merges into one owned card in the app (the halves still roster separately,
# so playing both roles costs both roster slots). Strict career-level test:
# seasons with 100+ PA and 45+ IP at once must hold 40%+ of BOTH career PA
# and career IP. Ohtani and Martin Dihigo pass; Ruth (five overlap seasons
# of twenty-two) and converts like Ankiel stay two separate cards. The
# bundle discount (weaker half at 60%) applies at PRICING time in the app —
# raw points here stay honest so rarity ranks true strength.
def dual_persons():
    out = []
    for card in history:
        if not card[0].endswith("-bat"):
            continue
        pid = card[0][len("mlb-all-"):-len("-bat")]
        pa = {y: t["AB"] + t["BB"] for y, t in bat_career.get(pid, {}).items()}
        ip = {y: t["IPouts"] for y, t in pit_career.get(pid, {}).items()}
        overlap = [y for y in set(pa) & set(ip) if pa[y] >= 100 and ip[y] >= 135]
        tot_pa, tot_ip = sum(pa.values()), sum(ip.values())
        if not overlap or tot_pa <= 0 or tot_ip <= 0:
            continue
        if (sum(pa[y] for y in overlap) / tot_pa >= 0.4
                and sum(ip[y] for y in overlap) / tot_ip >= 0.4):
            out.append(pid)
    return sorted(out)

DUAL_PERSONS = dual_persons()
print(f"dual two-way persons: {[people[p]['name'] for p in DUAL_PERSONS]}", file=sys.stderr)

header = """// Real-MLB card pools built from the Baseball Databank (Chadwick Baseball
// Bureau / Sean Lahman, CC BY-SA 3.0 — https://github.com/chadwickbureau/baseballdatabank).
// Cards derive from each player's real rates (career, decade window, or
// franchise stint), peak-weighted — best seasons count most, small samples
// regress toward league average — and mapped into the fictional generator's
// parameter space.
// Generated by scripts/build-mlb-pools.py; do not hand-edit.
// Tuple: [id, name, yearsActive, lastYear, set, isPitcher, rawPoints,
//         obcOrControl, speedOrIp, positionOrRole, fielding, hand, chart]
// Multi-position hitters carry aligned arrays at the position/fielding
// slots (["2B","SS"] with [3,2]); the first entry is the primary spot.
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
    f.write("// Simultaneous two-way players: one owned card per pool, bat and arm together.\n")
    f.write("export const MLB_DUAL_PERSONS = ")
    f.write(json.dumps(DUAL_PERSONS))
    f.write(";\n")
print("wrote mlbPools.js", file=sys.stderr)
