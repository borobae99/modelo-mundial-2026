#!/usr/bin/env python3
"""
build_attack_defense.py — Ratings de ataque/defensa por máxima verosimilitud (roadmap 3).

Qué hace:
  Ajusta el modelo de Maher/Dixon-Coles sobre el histórico martj42 (data/results.csv):
  cada selección tiene un multiplicador de ATAQUE (cuánto marca) y de DEFENSA (cuánto le
  marcan), más una tasa base y una ventaja de localía. A diferencia del Elo (una sola
  fuerza, los goles solo dependen de la DIFERENCIA), esto separa "marca mucho" de "encaja
  poco" — lo que mejora la predicción de MARCADORES, que es lo que importa para la quiniela.

  Modelo (multiplicativo):
    goles_local  ~ Poisson( gamma * H_si_no_neutral * ATK_local * DEF_visita )
    goles_visita ~ Poisson( gamma *                    ATK_visita * DEF_local )
  donde ATK alto = mejor ataque, DEF alto = peor defensa (encaja más). DEF bajo = sólido.

  Ajuste: máxima verosimilitud Poisson por iteración multiplicativa de Maher (converge sin
  tuning), con: peso por importancia del torneo, decaimiento temporal (vida media), shrinkage
  hacia la media para equipos con pocos partidos, y manejo de cancha neutral (sin localía).

  Salidas:
    src/attack_defense.js  -> ratings actuales (a 2026), claves en español, para el simulador
    src/backtest_ad.js     -> snapshots pre-torneo por edición (claves en inglés), para que
                              backtest.js mida si ataque/defensa le gana al Elo.

Uso:
    python3 scripts/build_attack_defense.py            # escribe ambos JS
    python3 scripts/build_attack_defense.py --verify   # además imprime cordura del ajuste
"""
import sys
import os
import csv
import math
from datetime import date

ROOT = os.path.join(os.path.dirname(__file__), "..")
DATA_DIR = os.path.join(ROOT, "data")
CSV_PATH = os.path.join(DATA_DIR, "results.csv")
OUT_LIVE = os.path.join(ROOT, "src", "attack_defense.js")
OUT_BT = os.path.join(ROOT, "src", "backtest_ad.js")

ASOF_LIVE = "2026-06-01"
WINDOW_YEARS = 12          # historia usada (los más viejos pesan poco por el decaimiento)
HALF_LIFE_DAYS = 730       # 2 años: un partido de hace 2 años pesa la mitad (recencia estándar)
PRIOR = 0.5                # shrinkage ligero hacia la media (protege a equipos con pocos partidos)
ITERS = 200

# Mismas ediciones y ventanas de fase de grupos que build_backtest.py.
EDITIONS = [
    ("WC2014", "FIFA World Cup", "2014-06-12"), ("WC2018", "FIFA World Cup", "2018-06-14"),
    ("WC2022", "FIFA World Cup", "2022-11-20"), ("EU2016", "UEFA Euro", "2016-06-10"),
    ("EU2020", "UEFA Euro", "2021-06-11"), ("EU2024", "UEFA Euro", "2024-06-14"),
    ("CA2016", "Copa América", "2016-06-03"), ("CA2019", "Copa América", "2019-06-14"),
    ("CA2021", "Copa América", "2021-06-13"), ("CA2024", "Copa América", "2024-06-20"),
]
ED_WINDOWS = {  # (inicio, fin) de fase de grupos, para listar participantes de cada edición
    "WC2014": ("2014-06-12", "2014-06-26"), "WC2018": ("2018-06-14", "2018-06-28"),
    "WC2022": ("2022-11-20", "2022-12-02"), "EU2016": ("2016-06-10", "2016-06-22"),
    "EU2020": ("2021-06-11", "2021-06-23"), "EU2024": ("2024-06-14", "2024-06-26"),
    "CA2016": ("2016-06-03", "2016-06-14"), "CA2019": ("2019-06-14", "2019-06-24"),
    "CA2021": ("2021-06-13", "2021-06-28"), "CA2024": ("2024-06-20", "2024-07-02"),
}

# Equipo en el dataset (inglés) -> clave del modelo (español), para el archivo vivo.
EN2ES = {
    "Mexico": "Mexico", "South Africa": "Sudafrica", "South Korea": "Corea del Sur",
    "Czech Republic": "Rep. Checa", "Canada": "Canada", "Bosnia and Herzegovina": "Bosnia",
    "Qatar": "Qatar", "Switzerland": "Suiza", "Brazil": "Brasil", "Morocco": "Marruecos",
    "Haiti": "Haiti", "Scotland": "Escocia", "Germany": "Alemania", "Curaçao": "Curazao",
    "Ivory Coast": "Costa de Marfil", "Ecuador": "Ecuador", "United States": "Estados Unidos",
    "Paraguay": "Paraguay", "Australia": "Australia", "Turkey": "Turquia",
    "Netherlands": "Paises Bajos", "Japan": "Japon", "Sweden": "Suecia", "Tunisia": "Tunez",
    "Belgium": "Belgica", "Egypt": "Egipto", "Iran": "Iran", "New Zealand": "Nueva Zelanda",
    "France": "Francia", "Senegal": "Senegal", "Iraq": "Irak", "Norway": "Noruega",
    "Spain": "España", "Cape Verde": "Cabo Verde", "Saudi Arabia": "Arabia Saudi",
    "Uruguay": "Uruguay", "Argentina": "Argentina", "Algeria": "Argelia", "Austria": "Austria",
    "Jordan": "Jordania", "Portugal": "Portugal", "DR Congo": "RD Congo",
    "Uzbekistan": "Uzbekistan", "Colombia": "Colombia", "England": "Inglaterra",
    "Croatia": "Croacia", "Ghana": "Ghana", "Panama": "Panama",
}

MAJOR_FINALS = {"UEFA Euro", "Copa América", "African Cup of Nations", "AFC Asian Cup",
                "Gold Cup", "CONCACAF Championship", "Oceania Nations Cup",
                "FIFA Confederations Cup", "Confederations Cup"}


def importance(t):
    if t == "FIFA World Cup":
        return 1.0
    if t in MAJOR_FINALS:
        return 0.9
    if "qualification" in t or t in ("UEFA Nations League", "CONCACAF Nations League"):
        return 0.7
    if t == "Friendly":
        return 0.4
    return 0.6


def to_ord(s):
    y, m, d = s.split("-")
    return date(int(y), int(m), int(d)).toordinal()


def load_rows():
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def geomean(vals):
    return math.exp(sum(math.log(v) for v in vals) / len(vals))


def fit_ad(rows, asof):
    """Ajusta ATK/DEF por MLE sobre los partidos en [asof-WINDOW, asof)."""
    asof_ord = to_ord(asof)
    cutoff_ord = asof_ord - WINDOW_YEARS * 365
    M = []  # (home, away, x, y, w, neutral)
    for r in rows:
        d = r["date"]
        try:
            do = to_ord(d)
        except Exception:
            continue
        if not (cutoff_ord <= do < asof_ord):
            continue
        try:
            x, y = int(r["home_score"]), int(r["away_score"])
        except (ValueError, KeyError):
            continue
        neutral = r["neutral"].strip().upper() == "TRUE"
        w = importance(r["tournament"]) * (0.5 ** ((asof_ord - do) / HALF_LIFE_DAYS))
        M.append((r["home_team"], r["away_team"], x, y, w, neutral))

    teams = sorted({m[0] for m in M} | {m[1] for m in M})
    A = {t: 1.0 for t in teams}
    B = {t: 1.0 for t in teams}
    GS = {t: 0.0 for t in teams}
    GC = {t: 0.0 for t in teams}
    games = {t: [] for t in teams}  # (opp, w, is_home, neutral)
    tot_w = tot_g = 0.0
    for (h, a, x, y, w, nt) in M:
        GS[h] += w * x; GC[h] += w * y
        GS[a] += w * y; GC[a] += w * x
        games[h].append((a, w, True, nt))
        games[a].append((h, w, False, nt))
        tot_w += w; tot_g += w * (x + y)
    gbar = tot_g / (2 * tot_w) if tot_w else 1.3
    gamma, H = gbar, 1.35

    for _ in range(ITERS):
        # ataque: goles marcados observados / esperados
        for t in teams:
            denom = 0.0
            for (opp, w, home, nt) in games[t]:
                hf = (H if (home and not nt) else 1.0)
                denom += w * gamma * hf * B[opp]
            A[t] = (GS[t] + PRIOR * gbar) / (denom + PRIOR * gbar)
        gm = geomean(A.values())
        for t in teams:
            A[t] /= gm
        gamma *= gm
        # defensa: goles encajados observados / esperados (DEF alto = encaja más)
        for t in teams:
            denom = 0.0
            for (opp, w, home, nt) in games[t]:
                # t local encaja la visita (sin H); t visita encaja al local (con H si no neutral)
                hf = (1.0 if home else (H if not nt else 1.0))
                denom += w * gamma * hf * A[opp]
            B[t] = (GC[t] + PRIOR * gbar) / (denom + PRIOR * gbar)
        gm = geomean(B.values())
        for t in teams:
            B[t] /= gm
        gamma *= gm
        # ventaja de localía (solo partidos no neutrales)
        numH = denH = 0.0
        for (h, a, x, y, w, nt) in M:
            if nt:
                continue
            numH += w * x
            denH += w * gamma * A[h] * B[a]
        if denH > 0:
            H = numH / denH
        # tasa base
        numG = denG = 0.0
        for (h, a, x, y, w, nt) in M:
            hf = (H if not nt else 1.0)
            numG += w * (x + y)
            denG += w * (hf * A[h] * B[a] + A[a] * B[h])
        if denG > 0:
            gamma = numG / denG

    return A, B, gamma, H, teams, M


def participants(rows, eid):
    start, end = ED_WINDOWS[eid]
    tname = next(t for (i, t, _) in EDITIONS if i == eid)
    s = set()
    for r in rows:
        if r["tournament"] == tname and start <= r["date"] <= end:
            s.add(r["home_team"]); s.add(r["away_team"])
    return s


def main():
    verify = "--verify" in sys.argv
    rows = load_rows()

    # ---- ajuste vivo (2026) ----
    A, B, gamma, H, teams, M = fit_ad(rows, ASOF_LIVE)
    live = {}
    missing = []
    for en, es in EN2ES.items():
        if en in A:
            live[es] = (A[en], B[en])
        else:
            missing.append(en)
    if missing:
        sys.stderr.write("ADVERTENCIA: sin datos para %d equipos: %s\n" % (len(missing), ", ".join(missing)))

    if verify:
        sys.stderr.write("\n== Ajuste vivo: gamma=%.3f H=%.3f, %d equipos, %d partidos ==\n" % (gamma, H, len(teams), len(M)))
        top_atk = sorted(((A[t], t) for t in teams if t in EN2ES), reverse=True)[:6]
        top_def = sorted(((B[t], t) for t in teams if t in EN2ES))[:6]
        sys.stderr.write("Mejor ATAQUE: " + ", ".join("%s %.2f" % (t, v) for v, t in top_atk) + "\n")
        sys.stderr.write("Mejor DEFENSA (DEF baja): " + ", ".join("%s %.2f" % (t, v) for v, t in top_def) + "\n")

    with open(OUT_LIVE, "w", encoding="utf-8") as f:
        f.write("/* ============================================================\n")
        f.write("   attack_defense.js — Ratings ataque/defensa (GENERADO, roadmap 3)\n")
        f.write("   ------------------------------------------------------------\n")
        f.write("   NO editar a mano. Lo genera scripts/build_attack_defense.py por\n")
        f.write("   máxima verosimilitud sobre el histórico martj42. ATK alto = mejor\n")
        f.write("   ataque; DEF alto = peor defensa (encaja más), DEF baja = sólida.\n")
        f.write("   Modelo: lambda = AD_GAMMA * (AD_HADV si local no-neutral) * ATK * DEF_rival.\n")
        f.write("   Lo consume engine.js (modo AD_ON). Claves en español.\n")
        f.write("   ============================================================ */\n")
        f.write('const AD_META={source:"martj42/international_results",asof:"%s",halflife_days:%d,window_years:%d};\n'
                % (ASOF_LIVE, HALF_LIFE_DAYS, WINDOW_YEARS))
        f.write("const AD_GAMMA=%.4f, AD_HADV=%.4f;\n" % (gamma, H))
        f.write("const AD_RATINGS={\n")
        # ordenar como data.js (por grupos) no es necesario; alfabético español
        for es in sorted(live):
            a, b = live[es]
            f.write('  "%s":{atk:%.3f,def:%.3f},\n' % (es, a, b))
        f.write("};\n")

    # ---- snapshots por torneo (para el backtest) ----
    bt = {}
    for eid, tname, start in EDITIONS:
        A, B, gamma, H, teams, M = fit_ad(rows, start)
        parts = participants(rows, eid)
        r = {t: (A.get(t, 1.0), B.get(t, 1.0)) for t in parts}
        bt[eid] = (gamma, H, r)
        if verify:
            sys.stderr.write("  %s: gamma=%.3f H=%.3f, %d participantes, ajuste sobre %d partidos\n"
                             % (eid, gamma, H, len(parts), len(M)))

    with open(OUT_BT, "w", encoding="utf-8") as f:
        f.write("/* ============================================================\n")
        f.write("   backtest_ad.js — Snapshots ataque/defensa pre-torneo (GENERADO)\n")
        f.write("   ------------------------------------------------------------\n")
        f.write("   NO editar a mano. scripts/build_attack_defense.py. Por edición:\n")
        f.write("   gamma (g), localía (h) y ratings {a:atk,d:def} de los participantes,\n")
        f.write("   ajustados con datos SOLO previos al torneo. Claves en inglés (igual\n")
        f.write("   que backtest_data.js). Lo consume backtest.js para medir AD vs Elo.\n")
        f.write("   ============================================================ */\n")
        f.write("const BACKTEST_AD={\n")
        for eid, _, _ in EDITIONS:
            gamma, H, r = bt[eid]
            f.write('  "%s":{g:%.4f,h:%.4f,r:{' % (eid, gamma, H))
            f.write(",".join('"%s":{a:%.3f,d:%.3f}' % (t, a, b) for t, (a, b) in sorted(r.items())))
            f.write("}},\n")
        f.write("};\n")

    sys.stderr.write("Escrito %s (%d equipos) y %s (%d ediciones).\n"
                     % (OUT_LIVE, len(live), OUT_BT, len(bt)))


if __name__ == "__main__":
    main()
