#!/usr/bin/env python3
"""
build_backtest.py — Genera el dataset del backtest multi-torneo (roadmap punto 2).

Qué hace:
  1. Lee el histórico de partidos internacionales (martj42, "International football
     results 1872-2026"): data/results.csv. Si no está, lo descarga.
  2. Calcula el Elo tipo World Football (eloratings.net) de cada selección de forma
     cronológica sobre TODO el histórico: K por tipo de torneo, multiplicador por
     diferencia de goles y ventaja local de 100 puntos. Así las fuerzas pre-torneo
     no se inventan: salen de los resultados previos.
  3. Para cada edición a evaluar, CONGELA un snapshot del Elo justo antes de su primer
     partido y lo usa para todos los partidos de su fase de grupos (igual que
     validation.js con R22: una sola fuerza pre-torneo por equipo).
  4. Filtra solo fases de grupos (las eliminatorias se excluyen: prórroga y penales
     contaminan el marcador a 90 min que mide el modelo).
  5. Emite src/backtest_data.js con las ediciones, sus partidos y las fuerzas Elo.

Por qué Python: desde el roadmap punto 2 la preparación de datos ya no cabe cómoda en
el HTML. El navegador solo puntúa (src/backtest.js); aquí se calcula lo pesado.

Uso:
    python3 scripts/build_backtest.py            # lee/descarga results.csv y escribe el JS
    python3 scripts/build_backtest.py --verify   # además imprime conteos y cordura de Elo
"""
import sys
import os
import csv
import math
import urllib.request

ROOT = os.path.join(os.path.dirname(__file__), "..")
DATA_DIR = os.path.join(ROOT, "data")
CSV_PATH = os.path.join(DATA_DIR, "results.csv")
OUT_PATH = os.path.join(ROOT, "src", "backtest_data.js")
CSV_URL = "https://raw.githubusercontent.com/martj42/international_results/master/results.csv"

# Ediciones a evaluar: (id, nombre_torneo_en_csv, etiqueta_es, inicio, fin_fase_grupos).
# Ventanas verificadas con --verify (el conteo debe igualar los partidos de grupos).
EDITIONS = [
    ("WC2014", "FIFA World Cup", "Mundial 2014", "2014-06-12", "2014-06-26"),
    ("WC2018", "FIFA World Cup", "Mundial 2018", "2018-06-14", "2018-06-28"),
    ("WC2022", "FIFA World Cup", "Mundial 2022", "2022-11-20", "2022-12-02"),
    ("EU2016", "UEFA Euro", "Euro 2016", "2016-06-10", "2016-06-22"),
    ("EU2020", "UEFA Euro", "Euro 2020", "2021-06-11", "2021-06-23"),
    ("EU2024", "UEFA Euro", "Euro 2024", "2024-06-14", "2024-06-26"),
    ("CA2016", "Copa América", "Copa América 2016", "2016-06-03", "2016-06-14"),
    ("CA2019", "Copa América", "Copa América 2019", "2019-06-14", "2019-06-24"),
    ("CA2021", "Copa América", "Copa América 2021", "2021-06-13", "2021-06-28"),
    ("CA2024", "Copa América", "Copa América 2024", "2024-06-20", "2024-07-02"),
]

# K (peso) del Elo World Football por tipo de torneo.
MAJOR_FINALS = {
    "UEFA Euro", "Copa América", "African Cup of Nations", "AFC Asian Cup",
    "Gold Cup", "CONCACAF Championship", "Oceania Nations Cup",
    "FIFA Confederations Cup", "Confederations Cup",
}


def k_weight(t):
    if t == "FIFA World Cup":
        return 60
    if t in MAJOR_FINALS:
        return 50
    if "qualification" in t or t in ("UEFA Nations League", "CONCACAF Nations League"):
        return 40
    if t == "Friendly":
        return 20
    return 30


def gd_mult(gd):
    if gd <= 1:
        return 1.0
    if gd == 2:
        return 1.5
    if gd == 3:
        return 1.75
    return 1.75 + (gd - 3) / 8.0


def ensure_csv():
    if os.path.exists(CSV_PATH):
        return
    os.makedirs(DATA_DIR, exist_ok=True)
    sys.stderr.write("Descargando results.csv de martj42...\n")
    req = urllib.request.Request(CSV_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r, open(CSV_PATH, "wb") as f:
        f.write(r.read())


def main():
    verify = "--verify" in sys.argv
    ensure_csv()

    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    rows.sort(key=lambda r: r["date"])  # cronológico

    # snapshots[edition_id] = copia del Elo justo antes del primer partido de esa edición
    snapshots = {}
    edition_start = {eid: start for (eid, _, _, start, _) in EDITIONS}
    elo = {}
    DEF = 1500.0

    def R(t):
        return elo.get(t, DEF)

    for r in rows:
        date = r["date"]
        # tomar snapshot de cada edición cuando el calendario llega a su inicio
        for eid, start in edition_start.items():
            if eid not in snapshots and date >= start:
                snapshots[eid] = dict(elo)
        h, a = r["home_team"], r["away_team"]
        try:
            hs, as_ = int(r["home_score"]), int(r["away_score"])
        except (ValueError, KeyError):
            continue
        neutral = r["neutral"].strip().upper() == "TRUE"
        k = k_weight(r["tournament"]) * gd_mult(abs(hs - as_))
        dr = (R(h) + (0 if neutral else 100)) - R(a)
        we = 1.0 / (10 ** (-dr / 400.0) + 1.0)
        w = 1.0 if hs > as_ else (0.5 if hs == as_ else 0.0)
        delta = k * (w - we)
        elo[h] = R(h) + delta
        elo[a] = R(a) - delta

    # construir ediciones con sus partidos de fase de grupos y fuerzas pre-torneo
    out_editions = []
    for eid, tname, label, start, gend in EDITIONS:
        snap = snapshots.get(eid, {})

        def Rs(t):
            return snap.get(t, DEF)

        matches = []
        for r in rows:
            if r["tournament"] != tname:
                continue
            if not (start <= r["date"] <= gend):
                continue
            h, a = r["home_team"], r["away_team"]
            try:
                hs, as_ = int(r["home_score"]), int(r["away_score"])
            except ValueError:
                continue
            neutral = 1 if r["neutral"].strip().upper() == "TRUE" else 0
            matches.append([h, a, hs, as_, round(Rs(h)), round(Rs(a)), neutral])
        out_editions.append((eid, label, matches))

    if verify:
        sys.stderr.write("\n== Conteo de partidos por edición ==\n")
        total = 0
        for eid, label, matches in out_editions:
            total += len(matches)
            sys.stderr.write("  %-22s %3d partidos\n" % (label, len(matches)))
        sys.stderr.write("  %-22s %3d partidos\n" % ("TOTAL", total))
        sys.stderr.write("\n== Cordura del Elo (snapshot WC2022 vs eloratings nov-2022) ==\n")
        snap = snapshots.get("WC2022", {})
        for t in ["Brazil", "Argentina", "France", "Spain", "England", "Qatar"]:
            sys.stderr.write("  %-12s %d\n" % (t, round(snap.get(t, DEF))))
        sys.stderr.write("\n")

    # emitir JS
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write("/* ============================================================\n")
        f.write("   backtest_data.js — Dataset del backtest multi-torneo (GENERADO)\n")
        f.write("   ------------------------------------------------------------\n")
        f.write("   NO editar a mano. Lo genera scripts/build_backtest.py a partir\n")
        f.write("   del histórico martj42 (International football results). Cada\n")
        f.write("   edición trae sus partidos de FASE DE GRUPOS y la fuerza Elo\n")
        f.write("   pre-torneo (calculada cronológicamente, congelada al inicio).\n")
        f.write("   Formato por partido: [local, visita, golesL, golesV, EloL, EloV, neutral].\n")
        f.write("   Lo consume src/backtest.js. Fuente: martj42/international_results.\n")
        f.write("   ============================================================ */\n")
        f.write('const BACKTEST_META={source:"martj42/international_results",')
        f.write('elo:"World Football Elo calculado del histórico, snapshot pre-torneo"};\n')
        f.write("const BACKTEST=[\n")
        for eid, label, matches in out_editions:
            f.write('  {id:"%s",label:"%s",matches:[\n' % (eid, label))
            for m in matches:
                f.write('    ["%s","%s",%d,%d,%d,%d,%d],\n' % tuple(m))
            f.write("  ]},\n")
        f.write("];\n")

    n = sum(len(m) for _, _, m in out_editions)
    sys.stderr.write("Escrito %s: %d ediciones, %d partidos.\n" % (OUT_PATH, len(out_editions), n))


if __name__ == "__main__":
    main()
