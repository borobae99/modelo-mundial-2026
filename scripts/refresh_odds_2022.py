#!/usr/bin/env python3
"""
refresh_odds_2022.py — Cuotas 1X2 de cierre VERIFICADAS de la fase de grupos del
Mundial 2022, para reemplazar el seed aproximado de src/market.js (MARKET_2022).

Por que existe: el benchmark vs mercado (roadmap punto 1) solo es concluyente con
cuotas reales. No hay un CSV libre con las 1X2 partido-a-partido de este torneo
(oddsportal usa JS y bloquea scraping), asi que market.js arranca con un consenso
aproximado, transcrito a mano y marcado como NO verificado. Este script trae las
cuotas reales desde The Odds API (https://the-odds-api.com), endpoint HISTORICO.

Requisitos:
  - Una API key de The Odds API con acceso a datos historicos (plan de pago; el
    endpoint /historical no esta en el plan gratuito). Pasala por --key o la
    variable de entorno ODDS_API_KEY.

Como funciona (sin incrustar horarios a mano):
  1. Lista los eventos historicos del Mundial 2022 (sport_key soccer_fifa_world_cup)
     en la ventana de fase de grupos, leyendo commence_time del propio API.
  2. Para cada evento, pide el snapshot de cuotas h2h en su commence_time (cierre)
     y promedia las casas (regions=eu) en [local, empate, visita].
  3. Mapea los nombres del API a las claves que usa el modelo (igual que G22/R22)
     y emite el bloque MARKET_2022 listo para pegar en src/market.js.

Uso:
    python3 scripts/refresh_odds_2022.py --key TU_API_KEY        # imprime el dict JS
    ODDS_API_KEY=... python3 scripts/refresh_odds_2022.py        # idem con env var
    python3 scripts/refresh_odds_2022.py --key ... --json        # JSON crudo
    python3 scripts/refresh_odds_2022.py --key ... --save        # guarda crudos en data/

Tras correrlo: pega el bloque en src/market.js (const MARKET_2022={...}), pon
MARKET_2022_VERIFIED=true y desaparece el aviso de "aproximadas" en la UI.
"""
import sys
import os
import json
import urllib.request
import urllib.parse

BASE = "https://api.the-odds-api.com/v4"
SPORT = "soccer_fifa_world_cup"
REGIONS = "eu"
MARKET = "h2h"
DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")

# Ventana de la fase de grupos del Mundial 2022 (UTC). Las eliminatorias se excluyen:
# prorroga y penales contaminan el 1X2 a 90 min que mide el modelo.
GROUP_FROM = "2022-11-20T00:00:00Z"
GROUP_TO = "2022-12-03T00:00:00Z"

# Nombre del API (ingles) -> clave del modelo (igual que en G22/R22 de validation.js).
# Solo hace falta listar lo que difiere; el resto se deja igual.
NAME_MAP = {
    "United States": "USA", "USA": "USA",
    "South Korea": "South Korea", "Korea Republic": "South Korea",
    "IR Iran": "Iran", "Iran": "Iran",
    "Saudi Arabia": "Saudi Arabia", "Costa Rica": "Costa Rica",
}


def api_name(n):
    return NAME_MAP.get(n, n)


def get(path, params):
    qs = urllib.parse.urlencode(params)
    url = BASE + path + "?" + qs
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode("utf-8", errors="replace"))


def avg_h2h(event, home, away):
    """Promedia la cuota h2h de todas las casas en [local, empate, visita]."""
    accH, accD, accA, n = 0.0, 0.0, 0.0, 0
    for bk in event.get("bookmakers", []):
        for mk in bk.get("markets", []):
            if mk.get("key") != "h2h":
                continue
            price = {o["name"]: o["price"] for o in mk.get("outcomes", [])}
            if home in price and away in price and "Draw" in price:
                accH += price[home]; accD += price["Draw"]; accA += price[away]; n += 1
    if n == 0:
        return None
    return [round(accH / n, 2), round(accD / n, 2), round(accA / n, 2)]


def main():
    key = None
    if "--key" in sys.argv:
        key = sys.argv[sys.argv.index("--key") + 1]
    key = key or os.environ.get("ODDS_API_KEY")
    if not key:
        sys.stderr.write("ERROR: falta la API key. Usa --key o ODDS_API_KEY.\n")
        sys.exit(2)
    save = "--save" in sys.argv
    as_json = "--json" in sys.argv

    # 1) eventos historicos de la ventana de grupos (commence_time lo da el API)
    events = get("/historical/sports/%s/events" % SPORT,
                 {"apiKey": key, "dateFormat": "iso",
                  "commenceTimeFrom": GROUP_FROM, "commenceTimeTo": GROUP_TO,
                  "date": GROUP_TO})
    # el endpoint historico envuelve la respuesta en {timestamp, data:[...]}
    ev_list = events.get("data", events) if isinstance(events, dict) else events

    out, missing = {}, []
    raw = {}
    for ev in ev_list:
        eid = ev.get("id"); home = ev.get("home_team"); away = ev.get("away_team")
        ctime = ev.get("commence_time")
        if not (eid and home and away and ctime):
            continue
        # 2) snapshot de cuotas en el cierre (commence_time)
        snap = get("/historical/sports/%s/events/%s/odds" % (SPORT, eid),
                   {"apiKey": key, "regions": REGIONS, "markets": MARKET,
                    "oddsFormat": "decimal", "dateFormat": "iso", "date": ctime})
        data = snap.get("data", snap) if isinstance(snap, dict) else snap
        raw[eid] = data
        odds = avg_h2h(data if isinstance(data, dict) else {}, home, away)
        kh, ka = api_name(home), api_name(away)
        if odds is None:
            missing.append((kh, ka))
        else:
            out["%s|%s" % (kh, ka)] = odds

    if save:
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(os.path.join(DATA_DIR, "odds_2022_raw.json"), "w", encoding="utf-8") as f:
            json.dump(raw, f, ensure_ascii=False, indent=2)

    if missing:
        sys.stderr.write("ADVERTENCIA: sin h2h para %d partidos:\n" % len(missing))
        for kh, ka in missing:
            sys.stderr.write("  %s vs %s\n" % (kh, ka))
        sys.stderr.write("Revisa NAME_MAP o la cobertura de casas en ese snapshot.\n\n")

    if as_json:
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return

    print("// Pegar en src/market.js. Cuotas 1X2 de cierre (promedio EU) de The Odds API.")
    print("// Cobertura: %d/48 partidos de grupos. Pon MARKET_2022_VERIFIED=true." % len(out))
    print("const MARKET_2022={")
    items = list(out.items())
    for i in range(0, len(items), 2):
        chunk = items[i:i + 2]
        line = ", ".join('"%s":[%s]' % (k, ",".join("%.2f" % x for x in v)) for k, v in chunk)
        print("  " + line + ("," if i + 2 < len(items) else ""))
    print("};")


if __name__ == "__main__":
    main()
