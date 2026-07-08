#!/usr/bin/env python3
"""Combine defensive signals into one rating per player.

Sources, best first:
- FanGraphs career Defense runs (their exported leaderboard data), z-scored
  within position and era window, innings-weighted across windows.
- Databank range factor + fielding percentage vs position/decade baselines
  (fallback where FanGraphs coverage is missing).
- Catcher arms use real caught-stealing rates (databank) blended with FG.
- Gold Gloves (databank awards) counted separately for a bump.

Emits defense-ratings.json: { lahmanID: {"z": float, "gg": int, "cs_z": float|null} }
"""
import csv, json, os, sys
from collections import defaultdict

SP = os.path.dirname(os.path.abspath(__file__))
L = os.path.join(SP, "lahman")

POS_NORM = {"LF": "LF/RF", "RF": "LF/RF", "OF": "LF/RF", "CF": "CF", "C": "C",
            "1B": "1B", "2B": "2B", "3B": "3B", "SS": "SS"}

def zscores(values):
    if len(values) < 8:
        return {}
    keys = list(values)
    nums = [values[k] for k in keys]
    mean = sum(nums) / len(nums)
    var = sum((v - mean) ** 2 for v in nums) / len(nums)
    sd = var ** 0.5 or 1.0
    return {k: (values[k] - mean) / sd for k in keys}

# ---- FanGraphs Defense runs ----------------------------------------------------
fg_rows = json.load(open(os.path.join(SP, "fg-defense-raw.json")))
fg_map = json.load(open(os.path.join(SP, "fg-id-map.json")))
by_group = defaultdict(dict)   # (window, pos) -> pid -> rate
inn_of = defaultdict(float)    # (window, pos, pid) -> innings
for r in fg_rows:
    pid = fg_map.get(str(r["fg"]))
    pos = POS_NORM.get(r["pos"] or "")
    inn = float(r["inn"] or 0)
    if not pid or not pos or inn < 900:
        continue
    rate = float(r["def"] or 0) / inn * 1350   # runs per full season
    key = (r["window"], pos)
    # a player can appear at LF and RF in one window; innings-weight merge
    if pid in by_group[key]:
        prev_inn = inn_of[(r["window"], pos, pid)]
        by_group[key][pid] = (by_group[key][pid] * prev_inn + rate * inn) / (prev_inn + inn)
        inn_of[(r["window"], pos, pid)] += inn
    else:
        by_group[key][pid] = rate
        inn_of[(r["window"], pos, pid)] = inn

fg_z = defaultdict(lambda: [0.0, 0.0])  # pid -> [weighted z sum, weight]
for key, table in by_group.items():
    for pid, z in zscores(table).items():
        w = inn_of[(key[0], key[1], pid)]
        fg_z[pid][0] += z * w
        fg_z[pid][1] += w

# ---- Databank range factor / fielding pct fallback -----------------------------
def num(row, key):
    try:
        return int(row.get(key) or 0)
    except ValueError:
        return 0

field = defaultdict(lambda: defaultdict(int))  # (pid, pos, decade) -> sums
cs_tot = defaultdict(lambda: defaultdict(int)) # (pid, decade) -> SB/CS against (catchers)
for r in csv.DictReader(open(os.path.join(L, "Fielding.csv"))):
    pos = POS_NORM.get(r.get("POS") or "")
    if not pos:
        continue
    dec = (num(r, "yearID") // 10) * 10
    t = field[(r["playerID"], pos, dec)]
    for k in ("G", "PO", "A", "E"):
        t[k] += num(r, k)
    if pos == "C":
        c = cs_tot[(r["playerID"], dec)]
        c["SB"] += num(r, "SB")
        c["CS"] += num(r, "CS")

rf_groups = defaultdict(dict)
fp_groups = defaultdict(dict)
for (pid, pos, dec), t in field.items():
    if t["G"] < 40:
        continue
    chances = t["PO"] + t["A"]
    rf_groups[(pos, dec)][pid] = chances / t["G"]
    if chances + t["E"] > 0:
        fp_groups[(pos, dec)][pid] = chances / (chances + t["E"])

db_z = defaultdict(lambda: [0.0, 0.0])
for groups, weight in ((rf_groups, 0.7), (fp_groups, 0.3)):
    for key, table in groups.items():
        for pid, z in zscores(table).items():
            g = field[(pid, key[0], key[1])]["G"]
            db_z[pid][0] += max(-2.5, min(2.5, z)) * g * weight
            db_z[pid][1] += g * weight

# ---- Catcher arms ---------------------------------------------------------------
cs_groups = defaultdict(dict)
for (pid, dec), c in cs_tot.items():
    attempts = c["SB"] + c["CS"]
    if attempts >= 60:
        cs_groups[dec][pid] = c["CS"] / attempts
cs_z = defaultdict(lambda: [0.0, 0.0])
for dec, table in cs_groups.items():
    for pid, z in zscores(table).items():
        attempts = cs_tot[(pid, dec)]["SB"] + cs_tot[(pid, dec)]["CS"]
        cs_z[pid][0] += z * attempts
        cs_z[pid][1] += attempts

# ---- Gold Gloves ----------------------------------------------------------------
gg = defaultdict(int)
for r in csv.DictReader(open(os.path.join(L, "AwardsPlayers.csv"))):
    if (r.get("awardID") or "").strip() == "Gold Glove":
        gg[r["playerID"]] += 1

# ---- Combine --------------------------------------------------------------------
out = {}
pids = set(fg_z) | set(db_z) | set(cs_z) | set(gg)
for pid in pids:
    fgv = fg_z[pid][0] / fg_z[pid][1] if fg_z[pid][1] else None
    dbv = db_z[pid][0] / db_z[pid][1] if db_z[pid][1] else None
    if fgv is not None and dbv is not None:
        z = 0.7 * fgv + 0.3 * dbv
    else:
        z = fgv if fgv is not None else (dbv if dbv is not None else 0.0)
    csv_ = cs_z[pid][0] / cs_z[pid][1] if cs_z[pid][1] else None
    out[pid] = {"z": round(max(-2.5, min(2.5, z)), 3), "gg": gg.get(pid, 0),
                "cs_z": round(max(-2.5, min(2.5, csv_)), 3) if csv_ is not None else None}

json.dump(out, open(os.path.join(SP, "defense-ratings.json"), "w"))
fg_covered = sum(1 for p in out.values() if p is not None)
print(f"ratings for {len(out)} players | FG-covered {sum(1 for pid in out if fg_z[pid][1] > 0)} | catcher arms {sum(1 for p in out.values() if p['cs_z'] is not None)} | GG holders {sum(1 for p in out.values() if p['gg'])}", file=sys.stderr)
for name, pid in [("Ozzie Smith", "smithoz01"), ("Derek Jeter", "jeterde01"), ("Willie Mays", "mayswi01"), ("Ivan Rodriguez", "rodriiv01"), ("Mike Piazza", "piazzmi01"), ("Adam Dunn", "dunnad01"), ("Brooks Robinson", "robinbr01")]:
    print(f"  {name}: {out.get(pid)}", file=sys.stderr)
