#!/usr/bin/env python3
"""
fetch_player_odds_2026.py — Cuotas REALES de goleadores (anytime scorer) del Mundial 2026.

The Odds API solo sirve los mercados de jugador por EVENTO (endpoint /events/{id}/odds), y
cada llamada cuesta creditos = mercados x regiones (con uk,eu son 2 por partido). Ademas las
casas cotizan goleadores pocos dias antes de cada partido. Por eso este script baja solo los
eventos de los PROXIMOS --days dias (default 4) y ACUMULA en data/player_odds_2026_raw.json:
re-correrlo cada pocos dias durante el torneo para ir cubriendo las jornadas.

Por jugador toma la MEJOR cuota (+casa) y la MEDIANA entre casas del mercado
player_goal_scorer_anytime (anota en el partido, 90 min; los penales cuentan, los autogoles no).
Emite src/player_odds_2026.js para la pestaña Parleys.

Uso:
    python3 scripts/fetch_player_odds_2026.py                 # proximos 4 dias
    python3 scripts/fetch_player_odds_2026.py --days 7        # mas ventana, mas creditos
    python3 scripts/fetch_player_odds_2026.py --regions uk    # menos creditos por evento
    python3 scripts/fetch_player_odds_2026.py --offline       # solo regenera el .js del JSON
"""
import sys
import os
import json
import urllib.request
import urllib.parse
from statistics import median

sys.path.insert(0, os.path.dirname(__file__))
from fetch_odds_2026 import EN2ES, get_key

ROOT = os.path.join(os.path.dirname(__file__), "..")
STORE = os.path.join(ROOT, "data", "player_odds_2026_raw.json")
OUT = os.path.join(ROOT, "src", "player_odds_2026.js")
BASE = "https://api.the-odds-api.com/v4"
MARKET = "player_goal_scorer_anytime"


def get(path, params):
    url = BASE + path + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode("utf-8", errors="replace")), dict(r.getheaders())


def main():
    days = 4
    if "--days" in sys.argv:
        days = int(sys.argv[sys.argv.index("--days") + 1])
    regions = "uk,eu"
    if "--regions" in sys.argv:
        regions = sys.argv[sys.argv.index("--regions") + 1]
    offline = "--offline" in sys.argv

    store = {}
    if os.path.exists(STORE):
        store = json.load(open(STORE, encoding="utf-8"))

    if not offline:
        key = get_key()
        if not key:
            sys.stderr.write("ERROR: falta ODDS_API_KEY (env.txt o variable de entorno).\n")
            sys.exit(2)
        events, _ = get("/sports/soccer_fifa_world_cup/events", {"apiKey": key})  # gratis
        events.sort(key=lambda e: e.get("commence_time", ""))
        if not events:
            sys.stderr.write("Sin eventos proximos.\n")
            sys.exit(0)
        # ventana: desde el primer evento proximo, +days dias (sin reloj local)
        first = events[0]["commence_time"][:10]
        y, m, d = map(int, first.split("-"))
        from datetime import date, timedelta
        until = (date(y, m, d) + timedelta(days=days)).isoformat()
        sel = [e for e in events if e["commence_time"][:10] <= until]
        sys.stderr.write("Eventos en ventana (%s a %s): %d (~%d creditos)\n"
                         % (first, until, len(sel), len(sel) * len(regions.split(","))))
        rem = "?"
        miss = set()
        got = 0
        for ev in sel:
            hs, as_ = EN2ES.get(ev.get("home_team")), EN2ES.get(ev.get("away_team"))
            if not hs or not as_:
                miss.update(n for n in (ev.get("home_team"), ev.get("away_team")) if n not in EN2ES)
                continue
            try:
                d_, h = get("/sports/soccer_fifa_world_cup/events/%s/odds" % ev["id"],
                            {"apiKey": key, "regions": regions, "markets": MARKET, "oddsFormat": "decimal"})
            except Exception as ex:
                sys.stderr.write("  %s vs %s: sin mercado (%s)\n" % (hs, as_, ex))
                continue
            rem = h.get("x-requests-remaining", rem)
            prices = {}  # jugador -> [(precio, casa)]
            for bk in d_.get("bookmakers", []):
                for mk in bk.get("markets", []):
                    if mk.get("key") != MARKET:
                        continue
                    for o in mk.get("outcomes", []):
                        if o.get("name") != "Yes" or not o.get("price"):
                            continue
                        pl = (o.get("description") or "").strip()
                        if pl:
                            prices.setdefault(pl, []).append((o["price"], bk.get("title", "?")))
            if not prices:
                continue
            px = {}
            for pl, lst in prices.items():
                best = max(lst)
                px[pl] = [round(best[0], 2), round(median(p for p, _ in lst), 2), best[1]]
            k = "|".join(sorted([hs, as_]))
            store[k] = {"kick": ev["commence_time"][:10], "books": len(d_.get("bookmakers", [])), "px": px}
            got += 1
        if miss:
            sys.stderr.write("ADVERTENCIA: nombres sin mapear: %s\n" % ", ".join(sorted(miss)))
        os.makedirs(os.path.dirname(STORE), exist_ok=True)
        json.dump(store, open(STORE, "w", encoding="utf-8"), ensure_ascii=False, indent=1, sort_keys=True)
        sys.stderr.write("Partidos con goleadores: %d nuevos/actualizados (total %d). Creditos restantes: %s\n"
                         % (got, len(store), rem))

    last = max((v.get("kick", "") for v in store.values()), default=None)
    n_players = sum(len(v["px"]) for v in store.values())
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("/* ============================================================\n")
        f.write("   player_odds_2026.js — Cuotas de goleadores (GENERADO)\n")
        f.write("   ------------------------------------------------------------\n")
        f.write("   NO editar a mano. scripts/fetch_player_odds_2026.py (The Odds\n")
        f.write("   API, mercado player_goal_scorer_anytime, por evento). Por\n")
        f.write("   pareja 'A|B' -> {jugador: [mejorCuota, cuotaMediana, casa]}.\n")
        f.write("   Las casas cotizan pocos dias antes de cada partido: re-correr\n")
        f.write("   el script durante el torneo para cubrir cada jornada.\n")
        f.write("   ============================================================ */\n")
        f.write('const PLAYER_ODDS_META={source:"The Odds API",market:"%s",matches:%d,players:%d,last:%s};\n'
                % (MARKET, len(store), n_players, json.dumps(last)))
        f.write("const PLAYER_ODDS_2026={\n")
        for k in sorted(store):
            px = store[k]["px"]
            pairs = ",".join('"%s":[%.2f,%.2f,%s]' % (pl.replace('"', "'"), v[0], v[1],
                             json.dumps(v[2], ensure_ascii=False)) for pl, v in sorted(px.items()))
            f.write('  "%s":{%s},\n' % (k, pairs))
        f.write("};\n")
    sys.stderr.write("Escrito %s: %d partidos, %d cuotas de jugador.\n" % (OUT, len(store), n_players))


if __name__ == "__main__":
    main()
