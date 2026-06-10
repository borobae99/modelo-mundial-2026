#!/usr/bin/env python3
"""
fetch_scores_2026.py — Marcadores FINALES y goleadores del Mundial 2026.

Dos fuentes, un archivo de salida (src/results_2026.js):
  1. MARCADORES: The Odds API /scores (2 creditos por corrida con daysFrom). El endpoint solo
     mira hasta 3 dias atras, asi que hay que correrlo al menos cada 3 dias durante el torneo.
  2. GOLEADORES: martj42 goalscorers.csv (GitHub, gratis) — para puntuar los legs de "anota el
     jugador" de la pestaña Parleys (sin autogoles; ese repo se actualiza con dias de retraso:
     mientras tanto los legs de goleador quedan "pendiente").

Todo se ACUMULA en data/scores_2026.json (formato {"matches": {...}, "scorers": {...}});
correcciones manuales ahi y re-correr con --offline.

Solo guarda partidos que empiezan hasta --until (por defecto 2026-06-28, fin de la fase de
grupos): evita que una revancha de eliminatorias entre los mismos equipos pise el resultado
de grupos (la clave es la pareja ordenada 'A|B').

Uso:
    python3 scripts/fetch_scores_2026.py              # baja marcadores + goleadores (2 creditos)
    python3 scripts/fetch_scores_2026.py --days 2     # ventana de daysFrom (1-3)
    python3 scripts/fetch_scores_2026.py --offline    # solo regenera el .js del JSON local
"""
import sys
import os
import csv
import json
import urllib.request
import urllib.parse

sys.path.insert(0, os.path.dirname(__file__))
from fetch_odds_2026 import EN2ES, get_key  # mismo mapeo de nombres y lectura de env.txt

ROOT = os.path.join(os.path.dirname(__file__), "..")
STORE = os.path.join(ROOT, "data", "scores_2026.json")
SCORERS_URL = "https://raw.githubusercontent.com/martj42/international_results/master/goalscorers.csv"
SCORERS_CSV = os.path.join(ROOT, "data", "goalscorers.csv")
OUT = os.path.join(ROOT, "src", "results_2026.js")
BASE = "https://api.the-odds-api.com/v4"
UNTIL_DEFAULT = "2026-06-28"   # fin de la fase de grupos
TOURNAMENT_START = "2026-06-11"


def fetch_scores(key, days):
    params = {"apiKey": key, "daysFrom": days}
    url = BASE + "/sports/soccer_fifa_world_cup/scores/?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode("utf-8", errors="replace")), dict(r.getheaders())


def update_matches(store, key, days, until):
    events, h = fetch_scores(key, days)
    rem = h.get("x-requests-remaining", "?")
    miss = set()
    added = 0
    for ev in events:
        if not ev.get("completed"):
            continue
        start = (ev.get("commence_time") or "")[:10]
        if start > until:
            continue  # ya no es fase de grupos
        hs = EN2ES.get(ev.get("home_team"))
        as_ = EN2ES.get(ev.get("away_team"))
        if not hs or not as_:
            miss.update(n for n in (ev.get("home_team"), ev.get("away_team")) if n not in EN2ES)
            continue
        goals = {}
        for s in ev.get("scores") or []:
            es = EN2ES.get(s.get("name"))
            if es is not None and s.get("score") is not None:
                goals[es] = int(s["score"])
        if hs not in goals or as_ not in goals:
            continue
        t1, t2 = sorted([hs, as_])
        k = "%s|%s" % (t1, t2)
        if k not in store["matches"]:
            added += 1
        store["matches"][k] = {"goals": [goals[t1], goals[t2]], "date": start}
    if miss:
        sys.stderr.write("ADVERTENCIA: nombres sin mapear: %s\n" % ", ".join(sorted(miss)))
    sys.stderr.write("Marcadores: %d nuevos (total %d). Creditos restantes: %s\n"
                     % (added, len(store["matches"]), rem))


def update_scorers(store, until):
    # baja el goalscorers.csv fresco (gratis) y extrae los anotadores del torneo
    sys.stderr.write("Descargando goalscorers.csv (martj42)...\n")
    req = urllib.request.Request(SCORERS_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r, open(SCORERS_CSV, "wb") as f:
        f.write(r.read())
    n = 0
    with open(SCORERS_CSV, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            d = row.get("date", "")
            if d < TOURNAMENT_START or d > until or row.get("own_goal") == "TRUE":
                continue
            hs, as_ = EN2ES.get(row.get("home_team", "")), EN2ES.get(row.get("away_team", ""))
            name = (row.get("scorer") or "").strip()
            if not hs or not as_ or not name:
                continue
            k = "|".join(sorted([hs, as_]))
            lst = store["scorers"].setdefault(k, [])
            if name not in lst:
                lst.append(name)
                n += 1
    sys.stderr.write("Goleadores del torneo: %d anotadores en %d partidos.\n"
                     % (n, len(store["scorers"])))


def main():
    days = 3
    if "--days" in sys.argv:
        days = max(1, min(3, int(sys.argv[sys.argv.index("--days") + 1])))
    until = UNTIL_DEFAULT
    if "--until" in sys.argv:
        until = sys.argv[sys.argv.index("--until") + 1]
    offline = "--offline" in sys.argv

    store = {"matches": {}, "scorers": {}}
    if os.path.exists(STORE):
        loaded = json.load(open(STORE, encoding="utf-8"))
        if "matches" in loaded:
            store = loaded
            store.setdefault("scorers", {})
        else:  # formato viejo (dict plano de partidos)
            store["matches"] = loaded

    if not offline:
        key = get_key()
        if not key:
            sys.stderr.write("ERROR: falta ODDS_API_KEY (env.txt o variable de entorno).\n")
            sys.exit(2)
        update_matches(store, key, days, until)
        try:
            update_scorers(store, until)
        except Exception as ex:
            sys.stderr.write("ADVERTENCIA: no se pudieron bajar los goleadores (%s); "
                             "los legs de goleador quedan pendientes.\n" % ex)
        os.makedirs(os.path.dirname(STORE), exist_ok=True)
        json.dump(store, open(STORE, "w", encoding="utf-8"), ensure_ascii=False, indent=1, sort_keys=True)

    matches, scorers = store["matches"], store["scorers"]
    last_update = max((v.get("date") or "" for v in matches.values()), default=None)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("/* ============================================================\n")
        f.write("   results_2026.js — Marcadores finales del Mundial 2026 (GENERADO)\n")
        f.write("   ------------------------------------------------------------\n")
        f.write("   NO editar a mano. scripts/fetch_scores_2026.py (The Odds API\n")
        f.write("   /scores + martj42 goalscorers.csv) lo regenera durante el\n")
        f.write("   torneo; correcciones manuales en data/scores_2026.json y\n")
        f.write("   re-correr con --offline.\n")
        f.write("   Por pareja ordenada 'A|B' -> [golesDeA, golesDeB] (A y B en\n")
        f.write("   orden alfabetico). RESULTS_2026_SCORERS: misma clave -> lista\n")
        f.write("   de anotadores (sin autogoles), para los legs de goleador.\n")
        f.write("   Solo partidos TERMINADOS de la fase de grupos.\n")
        f.write("   ============================================================ */\n")
        f.write('const RESULTS_2026_META={source:"The Odds API + martj42",updated:%s,completed:%d};\n'
                % (json.dumps(last_update), len(matches)))
        f.write("const RESULTS_2026={\n")
        for k in sorted(matches):
            g = matches[k]["goals"]
            f.write('  "%s":[%d,%d],\n' % (k, g[0], g[1]))
        f.write("};\n")
        f.write("const RESULTS_2026_SCORERS={\n")
        for k in sorted(scorers):
            names = ",".join(json.dumps(n, ensure_ascii=False) for n in scorers[k])
            f.write('  "%s":[%s],\n' % (k, names))
        f.write("};\n")
    sys.stderr.write("Escrito %s: %d partidos terminados, %d con goleadores.\n"
                     % (OUT, len(matches), len(scorers)))


if __name__ == "__main__":
    main()
