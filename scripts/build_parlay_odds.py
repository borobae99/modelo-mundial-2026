#!/usr/bin/env python3
"""
build_parlay_odds.py — Cuotas POR CASA para el armador de parleys (sin gastar API).

Lee el cache crudo que deja fetch_odds_2026.py (data/odds_2026_raw.json: los 72 partidos
de grupos con las cuotas decimales de ~36 casas) y emite src/parlay_odds.js con, por cada
resultado (gana A / empate / gana B):
  - la MEJOR cuota disponible y la casa que la ofrece (line shopping), y
  - la cuota MEDIANA entre casas (lo realista si se arma el boleto en una sola casa).

A diferencia de odds_2026.js (probabilidades de-vig para el modelo), aqui se conservan los
PRECIOS, que es lo que paga un parley. No gasta creditos: si quieres cuotas frescas, corre
primero fetch_odds_2026.py (refresca el cache) y luego este script.

Uso:
    python3 scripts/build_parlay_odds.py
"""
import sys
import os
import json
from statistics import median

sys.path.insert(0, os.path.dirname(__file__))
from fetch_odds_2026 import EN2ES, CAPTURED  # mismo mapeo de nombres y fecha de captura

ROOT = os.path.join(os.path.dirname(__file__), "..")
RAW = os.path.join(ROOT, "data", "odds_2026_raw.json")
OUT = os.path.join(ROOT, "src", "parlay_odds.js")


def main():
    if not os.path.exists(RAW):
        sys.stderr.write("ERROR: falta %s — corre antes scripts/fetch_odds_2026.py\n" % RAW)
        sys.exit(2)
    raw = json.load(open(RAW, encoding="utf-8"))
    events = raw.get("matches", [])

    out = {}
    nbooks = []
    miss = set()
    for ev in events:
        H, A = ev.get("home_team"), ev.get("away_team")
        hs, as_ = EN2ES.get(H), EN2ES.get(A)
        if not hs or not as_:
            miss.update(n for n in (H, A) if n not in EN2ES)
            continue
        # precios por resultado entre casas: {outcome: [(precio, casa), ...]}
        prices = {hs: [], "draw": [], as_: []}
        for bk in ev.get("bookmakers", []):
            for mk in bk.get("markets", []):
                if mk.get("key") != "h2h":
                    continue
                px = {o["name"]: o["price"] for o in mk.get("outcomes", []) if o.get("price")}
                if H in px and A in px and "Draw" in px:
                    prices[hs].append((px[H], bk.get("title", bk.get("key", "?"))))
                    prices["draw"].append((px["Draw"], bk.get("title", bk.get("key", "?"))))
                    prices[as_].append((px[A], bk.get("title", bk.get("key", "?"))))
        if not prices[hs]:
            continue
        nbooks.append(len(prices[hs]))
        px = {}
        for oc, lst in prices.items():
            best = max(lst)  # (precio, casa) — max por precio
            med = median(p for p, _ in lst)
            px[oc] = [round(best[0], 2), round(med, 2), best[1]]
        key = "|".join(sorted([hs, as_]))
        out[key] = {"kick": (ev.get("commence_time") or "")[:10], "px": px}

    if miss:
        sys.stderr.write("ADVERTENCIA: nombres sin mapear: %s\n" % ", ".join(sorted(miss)))

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("/* ============================================================\n")
        f.write("   parlay_odds.js — Cuotas por casa para parleys (GENERADO)\n")
        f.write("   ------------------------------------------------------------\n")
        f.write("   NO editar a mano. scripts/build_parlay_odds.py (lee el cache\n")
        f.write("   data/odds_2026_raw.json que deja fetch_odds_2026.py).\n")
        f.write("   Por pareja ordenada 'A|B' -> {kick:fecha, px:{resultado:\n")
        f.write("   [mejorCuota, cuotaMediana, casaDeLaMejor]}}. 'draw' = empate.\n")
        f.write("   A diferencia de odds_2026.js, aqui van PRECIOS (con margen),\n")
        f.write("   que es lo que paga un boleto real.\n")
        f.write("   ============================================================ */\n")
        f.write('const PARLAY_ODDS_META={source:"The Odds API",captured:"%s",matches:%d,books_avg:%.0f};\n'
                % (CAPTURED, len(out), (sum(nbooks) / len(nbooks)) if nbooks else 0))
        f.write("const PARLAY_ODDS={\n")
        for k in sorted(out):
            e = out[k]
            px = ",".join('"%s":[%.2f,%.2f,%s]' % (oc, v[0], v[1], json.dumps(v[2], ensure_ascii=False))
                          for oc, v in e["px"].items())
            f.write('  "%s":{kick:"%s",px:{%s}},\n' % (k, e["kick"], px))
        f.write("};\n")

    sys.stderr.write("Escrito %s: %d partidos, %.0f casas/partido en promedio.\n"
                     % (OUT, len(out), (sum(nbooks) / len(nbooks)) if nbooks else 0))


if __name__ == "__main__":
    main()
