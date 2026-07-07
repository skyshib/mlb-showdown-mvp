#!/usr/bin/env python3
"""Parse scraped showdowncards.com search pages into a compact card dataset.

Only game-mechanical facts are extracted (numbers and ranges) — no images or
prose from the site.
"""
import json, os, re, sys

PAGES = os.path.join(os.path.dirname(__file__), "pages")
ROW_RE = re.compile(r"<tr>\s*<td bgcolor='#CC0033'.*?</table>\s*</td>\s*</tr>", re.S)
CELL_RE = re.compile(r"<td[^>]*>(.*?)</td>", re.S)
CHART_TABLE_RE = re.compile(r"<table border='1px'.*?</table>", re.S)
TAG_RE = re.compile(r"<[^>]+>")

SPEED_LETTERS = {"A": 20, "B": 15, "C": 10}
EDITIONS = {"1st": "1st Edition", "UL": "Unlimited", "ASG": "All-Star Game", "PR": "Pennant Run", "TD": "Trading Deadline", "P": "Promo"}

def text(cell):
    return TAG_RE.sub(" ", cell).replace("&nbsp;", " ").strip()

def parse_range(token):
    token = token.strip()
    if not token or token == "-":
        return None
    if token.endswith("+"):  # "20+" means that number and everything above
        return [int(token[:-1]), None]
    parts = token.split("-")
    if not parts[0].isdigit():
        return None
    lo = int(parts[0])
    hi = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else lo
    return [lo, hi]

def parse_chart(table_html):
    rows = re.findall(r"<tr.*?</tr>", table_html, re.S)
    if len(rows) < 2:
        return None
    heads = [text(c) for c in CELL_RE.findall(rows[0])]
    vals = [text(c) for c in CELL_RE.findall(rows[1])]
    if len(heads) != len(vals):
        return None
    chart = {}
    for head, val in zip(heads, vals):
        rng = parse_range(val)
        if rng:
            chart[head] = rng
    return chart

def main():
    cards = []
    seen = {}
    for fname in sorted(os.listdir(PAGES)):
        html = open(os.path.join(PAGES, fname), encoding="utf-8", errors="replace").read()
        for row in ROW_RE.findall(html):
            cells = CELL_RE.findall(row)
            plain = [text(c) for c in cells]
            # locate the name cell (contains a /store/ link)
            m = re.search(r"href='\.\./store/([^']+)'>\s*([^<]+)</a>\s*<br>\s*([^<]+)", row)
            if not m:
                continue
            slug, raw_name, team = m.group(1), m.group(2).strip(), m.group(3).strip()
            chart_html = CHART_TABLE_RE.search(row)
            chart = parse_chart(chart_html.group(0)) if chart_html else None
            if not chart:
                continue
            # cells: [marker, number, edition, name, points, year, obc, spd/ip, positions, hand, icon, chart]
            try:
                number = plain[1]
                edition = plain[2]
                points = int(plain[4])
                year = "20" + plain[5].strip("'")
                obc = plain[6]
                spd = plain[7]
                positions = text(cells[8].replace("<br>", " | "))
                hand = plain[9]
            except (IndexError, ValueError):
                continue
            name = re.sub(r"^\*+\s*", "", raw_name).strip()
            is_foil = slug.startswith("foil-")
            key = (year, edition, number, name)
            if key in seen:
                # A foil printing of a card we already kept: mark the base
                # card as having a foil version instead of duplicating it.
                if is_foil:
                    seen[key]["foil"] = True
                continue
            is_pitcher = "PU" in chart or positions.split("|")[0].strip().split("+")[0].strip() in ("Starter", "Reliever", "Closer")
            record = {
                "slug": slug, "name": name, "team": team, "year": year,
                "edition": edition, "number": number, "points": points,
                "obc": obc, "spd": spd, "positions": positions, "hand": hand,
                "pitcher": is_pitcher, "chart": chart, "foil": is_foil,
            }
            seen[key] = record
            cards.append(record)
    print(f"parsed {len(cards)} unique cards", file=sys.stderr)
    json.dump(cards, open(os.path.join(os.path.dirname(__file__), "classic-raw.json"), "w"))

main()
