#!/usr/bin/env python3
"""
build_xg.py — xG observado por partido desde StatsBomb Open Data (gratis).

Para qué: demostrar el valor del xG (expected goals) con datos limpios y gratuitos. StatsBomb
Open Data solo cubre torneos grandes (Mundial 2018/2022, Euro 2020/2024 de los del backtest),
NO eliminatorias ni amistosos, así que sirve para ILUSTRAR (¿los goles se desvían mucho del xG?
¿el λ del modelo predice mejor el xG que los goles?), no para recalibrar las fuerzas de 2026
(eso necesitaría xG del periodo de calibración -> FBref está bloqueado por Cloudflare, o un feed
de pago; ver CLAUDE.md / memoria).

Qué hace: por cada torneo cubierto baja la lista de partidos, filtra la fase de grupos por fecha,
descarga los eventos y suma el statsbomb_xg de los tiros por equipo. Emite src/xg_data.js con el
xG por partido (clave por pareja de equipos ordenada, para no depender de quién figura de local).

Uso:
    python3 scripts/build_xg.py            # baja y escribe src/xg_data.js (+ resumen de ruido)
    python3 scripts/build_xg.py --only WC2022   # solo un torneo (más rápido para probar)
"""
import sys
import os
import json
import time
import urllib.request

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "src", "xg_data.js")
RAW = "https://raw.githubusercontent.com/statsbomb/open-data/master/data"

# (id, competition_id, season_id, etiqueta, inicio_grupos, fin_grupos)
TOURS = [
    ("WC2018", 43, 3, "Mundial 2018", "2018-06-14", "2018-06-28"),
    ("WC2022", 43, 106, "Mundial 2022", "2022-11-20", "2022-12-02"),
    ("EU2020", 55, 43, "Euro 2020", "2021-06-11", "2021-06-23"),
    ("EU2024", 55, 282, "Euro 2024", "2024-06-14", "2024-06-26"),
]

# Nombre StatsBomb -> nombre martj42 (el de backtest_data.js). Solo lo que difiere.
SB2MART = {
    "Republic of Ireland": "Republic of Ireland", "Czechia": "Czech Republic",
    "Türkiye": "Turkey", "North Macedonia": "North Macedonia",
    "South Korea": "South Korea", "United States": "United States",
    "IR Iran": "Iran", "Korea Republic": "South Korea",
}


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8", errors="replace"))


def name(n):
    return SB2MART.get(n, n)


def match_xg(mid):
    ev = fetch_json("%s/events/%d.json" % (RAW, mid))
    xg = {}
    for e in ev:
        if e.get("type", {}).get("name") == "Shot":
            t = e["team"]["name"]
            xg[t] = xg.get(t, 0.0) + e.get("shot", {}).get("statsbomb_xg", 0.0)
    return xg


def main():
    only = None
    if "--only" in sys.argv:
        only = sys.argv[sys.argv.index("--only") + 1]

    out = {}
    noise = []  # (|goles-xG|) para el resumen
    for tid, comp, season, label, start, end in TOURS:
        if only and tid != only:
            continue
        sys.stderr.write("== %s (%s) ==\n" % (label, tid))
        matches = fetch_json("%s/matches/%d/%d.json" % (RAW, comp, season))
        grp = [m for m in matches if start <= m["match_date"] <= end]
        sys.stderr.write("  %d partidos de fase de grupos\n" % len(grp))
        tour = {}
        for i, m in enumerate(grp):
            mid = m["match_id"]
            h = name(m["home_team"]["home_team_name"])
            a = name(m["away_team"]["away_team_name"])
            hs, as_ = m["home_score"], m["away_score"]
            try:
                xg = match_xg(mid)
            except Exception as ex:
                sys.stderr.write("  WARN sin eventos %d: %s\n" % (mid, ex))
                continue
            # remapear claves de xg a nombres martj42
            xgm = {name(k): v for k, v in xg.items()}
            hk, ak = sorted([h, a])
            tour["%s|%s" % (hk, ak)] = {h: round(xgm.get(m["home_team"]["home_team_name"], xgm.get(h, 0.0)), 3),
                                       a: round(xgm.get(m["away_team"]["away_team_name"], xgm.get(a, 0.0)), 3)}
            noise.append(abs((hs + as_) - (tour["%s|%s" % (hk, ak)][h] + tour["%s|%s" % (hk, ak)][a])))
            time.sleep(0.05)
            if (i + 1) % 12 == 0:
                sys.stderr.write("  ...%d/%d\n" % (i + 1, len(grp)))
        out[tid] = {"label": label, "m": tour}

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("/* ============================================================\n")
        f.write("   xg_data.js — xG observado por partido (GENERADO, StatsBomb Open Data)\n")
        f.write("   ------------------------------------------------------------\n")
        f.write("   NO editar a mano. scripts/build_xg.py. Solo torneos que cubre\n")
        f.write("   StatsBomb gratis (Mundial 2018/22, Euro 2020/24), fase de grupos.\n")
        f.write("   Clave: pareja de equipos ordenada -> {equipo: xG}. Nombres martj42\n")
        f.write("   (igual que backtest_data.js). Lo consume backtest.js (chequeo xG).\n")
        f.write("   ============================================================ */\n")
        f.write("const XG_DATA={\n")
        for tid in out:
            f.write('  "%s":{label:"%s",m:{\n' % (tid, out[tid]["label"]))
            for k, v in out[tid]["m"].items():
                pairs = ",".join('"%s":%.3f' % (t, x) for t, x in v.items())
                f.write('    "%s":{%s},\n' % (k, pairs))
            f.write("  }},\n")
        f.write("};\n")

    n = sum(len(out[t]["m"]) for t in out)
    avg = sum(noise) / len(noise) if noise else 0
    sys.stderr.write("\nEscrito %s: %d torneos, %d partidos con xG.\n" % (OUT, len(out), n))
    sys.stderr.write("Ruido medio |goles - xG| por partido: %.2f goles (esa es la varianza de"
                     " finalización que el xG quita).\n" % avg)


if __name__ == "__main__":
    main()
