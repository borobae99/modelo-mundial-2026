#!/usr/bin/env python3
"""
fetch_odds_2026.py — Cuotas REALES del Mundial 2026 desde The Odds API.

Baja, con la API key, dos mercados y los convierte en probabilidades de mercado (de-vig,
consenso multi-casa) listos para el modelo:
  - Campeon (soccer_fifa_world_cup_winner, outrights) -> ODDS_2026_OUTRIGHT
  - Partidos de grupos (soccer_fifa_world_cup, h2h)     -> ODDS_2026_MATCHES

De-vig: por cada casa se quita el margen (1/cuota normalizado) y luego se PROMEDIAN las
probabilidades entre casas (mas robusto que promediar cuotas). Emite src/odds_2026.js.

La key se lee de la variable de entorno ODDS_API_KEY o de env.txt (raiz, ignorado por git).
Cada corrida gasta pocos creditos (1 por region por mercado). Las cuotas cambian a diario hasta
el torneo: re-correr cuando se quiera refrescar.

Uso:
    python3 scripts/fetch_odds_2026.py
    python3 scripts/fetch_odds_2026.py --regions eu,uk,us   # mas casas, mas creditos
"""
import sys
import os
import json
import urllib.request
import urllib.parse

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "src", "odds_2026.js")
DATA_DIR = os.path.join(ROOT, "data")
BASE = "https://api.the-odds-api.com/v4"
CAPTURED = "2026-06-02"   # actualizar al refrescar (no hay reloj en el entorno de scripts)

# Nombre en The Odds API (ingles, con variantes) -> clave del modelo (español).
EN2ES = {
    "Mexico": "Mexico", "South Africa": "Sudafrica", "South Korea": "Corea del Sur",
    "Korea Republic": "Corea del Sur", "Czech Republic": "Rep. Checa", "Czechia": "Rep. Checa",
    "Canada": "Canada", "Bosnia & Herzegovina": "Bosnia", "Bosnia and Herzegovina": "Bosnia",
    "Qatar": "Qatar", "Switzerland": "Suiza", "Brazil": "Brasil", "Morocco": "Marruecos",
    "Haiti": "Haiti", "Scotland": "Escocia", "Germany": "Alemania", "Curacao": "Curazao",
    "Curaçao": "Curazao", "Ivory Coast": "Costa de Marfil", "Cote d'Ivoire": "Costa de Marfil",
    "Côte d'Ivoire": "Costa de Marfil", "Ecuador": "Ecuador", "United States": "Estados Unidos",
    "USA": "Estados Unidos", "Paraguay": "Paraguay", "Australia": "Australia", "Turkey": "Turquia",
    "Türkiye": "Turquia", "Turkiye": "Turquia", "Netherlands": "Paises Bajos", "Japan": "Japon",
    "Sweden": "Suecia", "Tunisia": "Tunez", "Belgium": "Belgica", "Egypt": "Egipto", "Iran": "Iran",
    "New Zealand": "Nueva Zelanda", "France": "Francia", "Senegal": "Senegal", "Iraq": "Irak",
    "Norway": "Noruega", "Spain": "España", "Cape Verde": "Cabo Verde", "Cabo Verde": "Cabo Verde",
    "Saudi Arabia": "Arabia Saudi", "Uruguay": "Uruguay", "Argentina": "Argentina",
    "Algeria": "Argelia", "Austria": "Austria", "Jordan": "Jordania", "Portugal": "Portugal",
    "DR Congo": "RD Congo", "Congo DR": "RD Congo", "Uzbekistan": "Uzbekistan", "Colombia": "Colombia",
    "England": "Inglaterra", "Croatia": "Croacia", "Ghana": "Ghana", "Panama": "Panama",
}
OUR48 = set(EN2ES.values())


def get_key():
    k = os.environ.get("ODDS_API_KEY")
    if k:
        return k.strip()
    p = os.path.join(ROOT, "env.txt")
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            if line.startswith("ODDS_API_KEY="):
                return line.strip().split("=", 1)[1]
    return None


def get(path, params):
    url = BASE + path + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode("utf-8", errors="replace")), dict(r.getheaders())


def devig(inv):  # inv = lista de 1/cuota; devuelve probabilidades normalizadas
    s = sum(inv)
    return [x / s for x in inv]


def main():
    key = get_key()
    if not key:
        sys.stderr.write("ERROR: falta ODDS_API_KEY (env.txt o variable de entorno).\n")
        sys.exit(2)
    regions = "eu"
    if "--regions" in sys.argv:
        regions = sys.argv[sys.argv.index("--regions") + 1]

    miss = set()

    def name(n):
        es = EN2ES.get(n)
        if not es:
            miss.add(n)
        return es

    # ---- partidos (h2h) ----
    matches_raw, h = get("/sports/soccer_fifa_world_cup/odds/",
                         {"apiKey": key, "regions": regions, "markets": "h2h", "oddsFormat": "decimal"})
    rem = h.get("x-requests-remaining", "?")
    matches = {}
    nbooks_m = []
    margins_m = []
    for ev in matches_raw:
        H, A = ev.get("home_team"), ev.get("away_team")
        hs, as_ = name(H), name(A)
        probs = []
        for bk in ev.get("bookmakers", []):
            for mk in bk.get("markets", []):
                if mk.get("key") != "h2h":
                    continue
                price = {o["name"]: o["price"] for o in mk.get("outcomes", [])}
                if H in price and A in price and "Draw" in price:
                    inv = [1 / price[H], 1 / price["Draw"], 1 / price[A]]
                    margins_m.append(sum(inv) - 1)
                    probs.append(devig(inv))
        if not probs or not hs or not as_:
            continue
        avg = [sum(p[i] for p in probs) / len(probs) for i in range(3)]
        s = sum(avg)
        avg = [x / s for x in avg]
        nbooks_m.append(len(probs))
        a1, a2 = sorted([hs, as_])
        matches["%s|%s" % (a1, a2)] = {hs: round(avg[0], 4), "draw": round(avg[1], 4), as_: round(avg[2], 4)}

    # ---- campeon (outrights) ----
    win_raw, h2 = get("/sports/soccer_fifa_world_cup_winner/odds/",
                      {"apiKey": key, "regions": regions, "markets": "outrights", "oddsFormat": "decimal"})
    rem = h2.get("x-requests-remaining", rem)
    team_probs = {}
    margins_o = []
    nbooks_o = 0
    for ev in win_raw:
        for bk in ev.get("bookmakers", []):
            for mk in bk.get("markets", []):
                if mk.get("key") != "outrights":
                    continue
                prices = {o["name"]: o["price"] for o in mk.get("outcomes", []) if o.get("price")}
                if not prices:
                    continue
                nbooks_o += 1
                inv = {t: 1 / p for t, p in prices.items()}
                s = sum(inv.values())
                margins_o.append(s - 1)
                for t, v in inv.items():
                    es = name(t)
                    if es:
                        team_probs.setdefault(es, []).append(v / s)
    outright = {es: sum(ps) / len(ps) for es, ps in team_probs.items() if es in OUR48}
    so = sum(outright.values())
    outright = {k: round(v / so, 5) for k, v in outright.items()}  # renormalizar sobre las 48

    os.makedirs(DATA_DIR, exist_ok=True)
    json.dump({"matches": matches_raw, "winner": win_raw}, open(os.path.join(DATA_DIR, "odds_2026_raw.json"), "w"))

    avgmar_m = (sum(margins_m) / len(margins_m)) if margins_m else 0
    avgmar_o = (sum(margins_o) / len(margins_o)) if margins_o else 0
    if miss:
        sys.stderr.write("ADVERTENCIA: nombres sin mapear (revisar EN2ES): %s\n" % ", ".join(sorted(miss)))

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("/* ============================================================\n")
        f.write("   odds_2026.js — Cuotas REALES del Mundial 2026 (GENERADO)\n")
        f.write("   ------------------------------------------------------------\n")
        f.write("   NO editar a mano. scripts/fetch_odds_2026.py (The Odds API).\n")
        f.write("   Probabilidades de mercado YA SIN MARGEN (de-vig, consenso multi-casa).\n")
        f.write("   ODDS_2026_OUTRIGHT: campeon (clave español, suman 1 sobre las 48).\n")
        f.write("   ODDS_2026_MATCHES: por pareja ordenada 'A|B' -> {equipo:probGana, draw:probEmpate}.\n")
        f.write("   Las cuotas cambian a diario: re-generar para refrescar.\n")
        f.write("   ============================================================ */\n")
        f.write('const ODDS_2026_META={source:"The Odds API",captured:"%s",regions:"%s",'
                'matches:%d,books_match_avg:%.0f,books_winner:%d,vig_match:%.4f,vig_winner:%.4f};\n'
                % (CAPTURED, regions, len(matches), (sum(nbooks_m) / len(nbooks_m)) if nbooks_m else 0,
                   nbooks_o, avgmar_m, avgmar_o))
        f.write("const ODDS_2026_OUTRIGHT={\n")
        for es in sorted(outright, key=lambda k: -outright[k]):
            f.write('  "%s":%.5f,\n' % (es, outright[es]))
        f.write("};\n")
        f.write("const ODDS_2026_MATCHES={\n")
        for k in sorted(matches):
            obj = matches[k]
            pairs = ",".join('"%s":%.4f' % (t, p) for t, p in obj.items())
            f.write('  "%s":{%s},\n' % (k, pairs))
        f.write("};\n")

    sys.stderr.write("Escrito %s: %d partidos, %d equipos en outright. Creditos restantes: %s\n"
                     % (OUT, len(matches), len(outright), rem))
    sys.stderr.write("Margen medio: partidos %.1f%%, campeon %.1f%%.\n" % (avgmar_m * 100, avgmar_o * 100))


if __name__ == "__main__":
    main()
