#!/usr/bin/env python3
"""
build_scorers.py — Share de goles por jugador para el mercado de goleadores (GRATIS).

Descarga el historico de goleadores de martj42 (goalscorers.csv, mismo repo que results.csv)
y calcula, por seleccion, que fraccion de los goles del equipo anota cada jugador (share),
con decaimiento temporal (vida media 2 años) y excluyendo autogoles. Emite src/scorers_2026.js.

El share alimenta el modelo de "anota en el partido" de la pestaña Parleys:
    P(jugador anota) = 1 - exp(-lambda_equipo * share)
(adelgazamiento Poisson: si el equipo anota lambda goles y el jugador suele meter el s% de
ellos, sus goles son Poisson con media lambda*s). Asume que juega el partido completo — las
alineaciones reales no se conocen; el filtro practico es que las casas solo cotizan convocados.

Filtros anti-jugador-retirado: ultimo gol hace <= 30 meses, >= 2 goles en la ventana,
share >= 0.02, top 12 por seleccion.

Uso:
    python3 scripts/build_scorers.py
    python3 scripts/build_scorers.py --verify   # imprime los top por seleccion
"""
import sys
import os
import csv
import urllib.request
import unicodedata
from datetime import date

sys.path.insert(0, os.path.dirname(__file__))
from fetch_odds_2026 import EN2ES  # mismo mapeo de nombres (martj42 usa ingles)

ROOT = os.path.join(os.path.dirname(__file__), "..")
CSV_URL = "https://raw.githubusercontent.com/martj42/international_results/master/goalscorers.csv"
CSV_PATH = os.path.join(ROOT, "data", "goalscorers.csv")
OUT = os.path.join(ROOT, "src", "scorers_2026.js")

HALF_LIFE_DAYS = 730     # vida media del peso (2 años), igual que ataque/defensa
WINDOW_YEARS = 8         # mas alla de esto el peso ya es despreciable
LAST_GOAL_MAX_DAYS = 913 # ~30 meses sin marcar -> probablemente fuera del ciclo
MIN_GOALS = 2            # goles crudos minimos en la ventana
MIN_SHARE = 0.02
TOP_N = 12
# Shrinkage del share hacia 0: s = w_jugador / (w_equipo + K). Con pocos goles ponderados
# (defensas con 2-3 goles en amistosos) el share crudo sobreestima la prob. de anotar en
# un Mundial; los pseudo-goles del denominador castigan mas a la muestra chica y casi
# nada a un Mbappe/Kane. Sin esto, el "valor" de goleadores se concentraba en defensas.
K_SHRINK = 4.0


def parse_date(s):
    y, m, d = s.split("-")
    return date(int(y), int(m), int(d))


def name_key(s):
    """Clave de jugador robusta a acentos y orden ('Julián Álvarez' == 'Julian Alvarez',
    'Son Heung-min' == 'Heung-min Son'): minusculas, sin diacriticos, tokens ordenados.
    El historico trae grafias duplicadas que parten el share del mismo jugador."""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = "".join(c if c.isalpha() else " " for c in s)
    return " ".join(sorted(s.split()))


def main():
    verify = "--verify" in sys.argv
    if not os.path.exists(CSV_PATH):
        sys.stderr.write("Descargando goalscorers.csv (martj42)...\n")
        os.makedirs(os.path.dirname(CSV_PATH), exist_ok=True)
        req = urllib.request.Request(CSV_URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=60) as r, open(CSV_PATH, "wb") as f:
            f.write(r.read())

    rows = []
    ref = None
    with open(CSV_PATH, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            try:
                d = parse_date(row["date"])
            except Exception:
                continue
            if ref is None or d > ref:
                ref = d
            rows.append((d, row))
    cutoff = date(ref.year - WINDOW_YEARS, ref.month, ref.day)

    # goles ponderados por equipo y por jugador (sin autogoles; penales SI cuentan
    # para "anota en el partido"). El jugador se agrega por nombre NORMALIZADO.
    team_w = {}                       # equipo ES -> goles ponderados
    player = {}                       # (equipo ES, clave jugador) -> [w, goles, ultimo gol, {grafia: conteo}]
    for d, row in rows:
        if d < cutoff or row.get("own_goal") == "TRUE":
            continue
        es = EN2ES.get(row.get("team", ""))
        name = (row.get("scorer") or "").strip()
        if not es or not name:
            continue
        w = 0.5 ** ((ref - d).days / HALF_LIFE_DAYS)
        team_w[es] = team_w.get(es, 0.0) + w
        rec = player.setdefault((es, name_key(name)), [0.0, 0, d, {}])
        rec[0] += w
        rec[1] += 1
        if d > rec[2]:
            rec[2] = d
        rec[3][name] = rec[3].get(name, 0) + 1

    out = {}
    for (es, _), (w, n, last, spellings) in player.items():
        if n < MIN_GOALS or (ref - last).days > LAST_GOAL_MAX_DAYS or team_w.get(es, 0) <= 0:
            continue
        s = w / (team_w[es] + K_SHRINK)  # share con shrinkage (ver K_SHRINK)
        if s < MIN_SHARE:
            continue
        name = max(spellings, key=spellings.get)  # la grafia mas frecuente
        out.setdefault(es, []).append({"n": name, "s": round(s, 4)})
    for es in out:
        out[es] = sorted(out[es], key=lambda p: -p["s"])[:TOP_N]

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("/* ============================================================\n")
        f.write("   scorers_2026.js — Share de goles por jugador (GENERADO)\n")
        f.write("   ------------------------------------------------------------\n")
        f.write("   NO editar a mano. scripts/build_scorers.py (martj42\n")
        f.write("   goalscorers.csv, vida media 2 años, sin autogoles).\n")
        f.write("   Por seleccion (clave español): [{n:jugador, s:share}]. El share\n")
        f.write("   es la fraccion de los goles del equipo que anota el jugador;\n")
        f.write("   P(anota) = 1-exp(-lambda*s) en parlay.js. Asume que juega.\n")
        f.write("   ============================================================ */\n")
        f.write('const SCORERS_META={source:"martj42 goalscorers",ref:"%s",teams:%d};\n'
                % (ref.isoformat(), len(out)))
        f.write("const SCORERS_2026={\n")
        for es in sorted(out):
            items = ",".join('{n:"%s",s:%.4f}' % (p["n"].replace('"', "'"), p["s"]) for p in out[es])
            f.write('  "%s":[%s],\n' % (es, items))
        f.write("};\n")

    n_players = sum(len(v) for v in out.values())
    sys.stderr.write("Escrito %s: %d selecciones, %d jugadores (ref %s).\n"
                     % (OUT, len(out), n_players, ref.isoformat()))
    if verify:
        for es in sorted(out):
            tops = ", ".join("%s %.0f%%" % (p["n"], p["s"] * 100) for p in out[es][:4])
            sys.stderr.write("  %-16s %s\n" % (es, tops))


if __name__ == "__main__":
    main()
