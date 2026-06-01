#!/usr/bin/env python3
"""
refresh_elo.py — Descarga el Elo actual de las 48 selecciones desde eloratings.net.

eloratings.net sirve su tabla en vivo como TSV:
  - World.tsv      -> filas: rank, rank, CODIGO_PAIS, rating, ...
  - en.teams.tsv   -> CODIGO_PAIS \\t Nombre (en inglés)

Este script cruza ambos, mapea los nombres ingleses a las claves en español que usa el
modelo, e imprime el bloque ELO_OFFICIAL listo para pegar en src/data.js.

Uso:
    python3 scripts/refresh_elo.py            # imprime el dict JS
    python3 scripts/refresh_elo.py --json     # imprime JSON crudo
    python3 scripts/refresh_elo.py --save     # guarda crudos en data/ y emite el dict

Tras correrlo: pega el bloque en src/data.js (const ELO_OFFICIAL = {...}) y actualiza la
fecha de captura en CLAUDE.md.
"""
import sys
import os
import json
import urllib.request

BASE = "https://www.eloratings.net"
UA = {"User-Agent": "Mozilla/5.0"}
DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")

# Clave en el modelo (español) -> nombre en eloratings (inglés), con variantes alternativas.
NAME_MAP = {
    "Mexico": ["Mexico"], "Sudafrica": ["South Africa"], "Corea del Sur": ["South Korea", "Korea Republic"],
    "Rep. Checa": ["Czechia", "Czech Republic"], "Canada": ["Canada"], "Bosnia": ["Bosnia and Herzegovina"],
    "Qatar": ["Qatar"], "Suiza": ["Switzerland"], "Brasil": ["Brazil"], "Marruecos": ["Morocco"],
    "Haiti": ["Haiti"], "Escocia": ["Scotland"], "Alemania": ["Germany"], "Curazao": ["Curacao", "Curaçao"],
    "Costa de Marfil": ["Ivory Coast", "Cote d'Ivoire", "Côte d'Ivoire"], "Ecuador": ["Ecuador"],
    "Estados Unidos": ["United States", "USA"], "Paraguay": ["Paraguay"], "Australia": ["Australia"],
    "Turquia": ["Turkey", "Türkiye", "Turkiye"], "Paises Bajos": ["Netherlands"], "Japon": ["Japan"],
    "Suecia": ["Sweden"], "Tunez": ["Tunisia"], "Belgica": ["Belgium"], "Egipto": ["Egypt"],
    "Iran": ["Iran"], "Nueva Zelanda": ["New Zealand"], "Francia": ["France"], "Senegal": ["Senegal"],
    "Irak": ["Iraq"], "Noruega": ["Norway"], "España": ["Spain"], "Cabo Verde": ["Cape Verde", "Cabo Verde"],
    "Arabia Saudi": ["Saudi Arabia"], "Uruguay": ["Uruguay"], "Argentina": ["Argentina"],
    "Argelia": ["Algeria"], "Austria": ["Austria"], "Jordania": ["Jordan"], "Portugal": ["Portugal"],
    "RD Congo": ["DR Congo", "Congo DR", "Democratic Republic of the Congo"], "Uzbekistan": ["Uzbekistan"],
    "Colombia": ["Colombia"], "Inglaterra": ["England"], "Croacia": ["Croatia"], "Ghana": ["Ghana"],
    "Panama": ["Panama"],
}

# Orden por grupos para que el bloque salga legible (igual que en data.js).
ORDER = ["Mexico","Sudafrica","Corea del Sur","Rep. Checa","Canada","Bosnia","Qatar","Suiza",
         "Brasil","Marruecos","Haiti","Escocia","Alemania","Curazao","Costa de Marfil","Ecuador",
         "Estados Unidos","Paraguay","Australia","Turquia","Paises Bajos","Japon","Suecia","Tunez",
         "Belgica","Egipto","Iran","Nueva Zelanda","Francia","Senegal","Irak","Noruega",
         "España","Cabo Verde","Arabia Saudi","Uruguay","Argentina","Argelia","Austria","Jordania",
         "Portugal","RD Congo","Uzbekistan","Colombia","Inglaterra","Croacia","Ghana","Panama"]


def fetch(path):
    req = urllib.request.Request(BASE + path, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="replace")


def main():
    save = "--save" in sys.argv
    as_json = "--json" in sys.argv

    teams_tsv = fetch("/en.teams.tsv")
    world_tsv = fetch("/World.tsv")

    if save:
        os.makedirs(DATA_DIR, exist_ok=True)
        open(os.path.join(DATA_DIR, "en.teams.tsv"), "w", encoding="utf-8").write(teams_tsv)
        open(os.path.join(DATA_DIR, "World.tsv"), "w", encoding="utf-8").write(world_tsv)

    code2name = {}
    for line in teams_tsv.splitlines():
        p = line.split("\t")
        if len(p) >= 2:
            code2name[p[0]] = p[1]

    rating_by_name = {}
    for line in world_tsv.splitlines():
        f = line.split("\t")
        if len(f) >= 4 and f[3].lstrip("-").isdigit():
            name = code2name.get(f[2])
            if name:
                rating_by_name[name] = int(f[3])

    out, missing = {}, []
    for es, candidates in NAME_MAP.items():
        val = next((rating_by_name[c] for c in candidates if c in rating_by_name), None)
        if val is None:
            missing.append((es, candidates))
        else:
            out[es] = val

    if missing:
        sys.stderr.write("ADVERTENCIA: no se encontraron " + str(len(missing)) + " selecciones:\n")
        for es, c in missing:
            sys.stderr.write("  " + es + " (probado: " + ", ".join(c) + ")\n")
        sys.stderr.write("Revisa NAME_MAP; eloratings pudo cambiar la grafia.\n\n")

    if as_json:
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return

    # emitir el bloque JS listo para pegar
    print("// Pegar en src/data.js. Capturado de eloratings.net. Cobertura: %d/48." % len(out))
    print("const ELO_OFFICIAL={")
    chunk = []
    for i, t in enumerate(ORDER):
        if t in out:
            chunk.append('"%s":%d' % (t, out[t]))
        if len(chunk) == 4 or i == len(ORDER) - 1:
            print("  " + ",".join(chunk) + ("," if i != len(ORDER) - 1 else ""))
            chunk = []
    print("};")


if __name__ == "__main__":
    main()
