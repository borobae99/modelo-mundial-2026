# Bitácora — Modelo Mundial 2026

Memoria de trabajo para retomar rápido. Resume QUÉ se hizo, QUÉ se descubrió (con honestidad),
y CÓMO seguir. Complementa a `CLAUDE.md` (que es la referencia técnica permanente). Última
actualización: **9 jun 2026**.

> Para verificar que todo sigue funcionando: `node scripts/smoke_test.js` (deben pasar 77 checks).
> Para ver la app: abrir `index.html` en el navegador.

---

## Resumen ejecutivo (dónde estamos)

El modelo base (Elo + Poisson + Dixon-Coles + localía, Monte Carlo) ya estaba. En estas sesiones
se completó casi todo el roadmap y, sobre todo, se construyó el **andamiaje para medir si cada
mejora vale la pena** (backtest multi-torneo con bandas, benchmark de mercado, chequeo con xG).

**Conclusión honesta del conjunto:** el modelo simple es sólido y difícil de batir para
selecciones. Las dos "mejoras estructurales" que probamos **no lo superaron con datos gratis**:
- El **mercado de apuestas** le gana al modelo (era de esperar; es el rival a vencer).
- **Ataque/defensa** separado NO le ganó al Elo de forma significativa (las selecciones juegan
  pocos partidos y los goles son ruidosos).
- El **chequeo con xG** mostró por qué: el modelo predice bien el *proceso* (xG), y su "error"
  es sobre todo varianza de finalización. → **Calibrar sobre xG es la mejora con más potencial**,
  hoy bloqueada solo por el dato (se necesita un feed de pago).

---

## Trabajo por punto del roadmap

### Punto 1 — Benchmark vs mercado (HECHO) · `src/market.js`
- De-vig (cuota → probabilidad implícita, normalización), `overround`.
- **Head-to-head 2022** (pestaña Validación): mercado vs modelo vs uniforme vs ensamble sobre los
  48 partidos de grupos 2022, con RPS/Brier/log-loss/aciertos.
- **Comparación campeón 2026** (pestaña Probabilidades): modelo vs mercado vs ensamble, ordenada
  por ensamble.
- **Hallazgo:** el mercado de cierre le gana al modelo (RPS ~0.221 vs ~0.239).
- **Caveat:** las cuotas 1X2 de 2022 son APROXIMADAS (transcritas, `MARKET_2022_VERIFIED=false`).
  Verificarlas con `scripts/refresh_odds_2022.py` (The Odds API histórico, de pago).
- Cuotas de campeón 2026: BetMGM transcritas (1 jun 2026). **Reemplazables ya por datos reales de
  la API** (ver "Oportunidad nueva").

### Punto 2 — Backtest multi-torneo (HECHO) · `src/backtest.js` + `scripts/build_backtest.py`
- Python descarga el histórico martj42 (`data/results.csv`, ~49k partidos), **calcula el Elo**
  World Football cronológicamente y congela un snapshot pre-torneo por edición → `src/backtest_data.js`.
- 10 torneos (Mundiales 2014/18/22, Euros 2016/20/24, Copas América 2016/19/21/24), 338 partidos
  de grupos. RPS por torneo y agrupado con **IC 90% (bootstrap)**.
- **Hallazgo:** RPS agrupado ~0.194, IC 90% ~[0.18, 0.21], **~18% mejor que el azar**, banda toda
  por debajo → skill real y robusto. (El 2022-solo daba ~3%: era un torneo atípico.)

### Punto 3 — Ataque/Defensa (HECHO) · `scripts/build_attack_defense.py`
- MLE (modelo de Maher, multiplicadores de ataque y defensa, tasa base, localía) sobre el
  histórico, con peso por importancia, vida media 2 años y shrinkage → `src/attack_defense.js`
  (vivo 2026) y `src/backtest_ad.js` (snapshots pre-torneo).
- Toggle **"Ataque/Defensa"** en Ajustes (motor `AD_ON`). El backtest compara Elo vs A/D en RPS
  y en log-loss de marcador, con test bootstrap pareado.
- **Hallazgo:** A/D **NO le gana al Elo de forma significativa** (IC pareado cruza el 0). OFF por
  defecto.

### Punto 5 — Bandas de confianza (HECHO) · `engine.runBands`
- Monte Carlo de dos niveles: perturba las fuerzas (±`RATING_SD` Elo) y propaga la incertidumbre
  → IC 90% de la prob. de campeón (whisker en barras, rango en tabla). Slider en Ajustes.
- **Hallazgo:** con ±30-50 Elo el favorito tiene banda de ~±8-12 pp. Las probabilidades de
  campeón son muy inciertas; un número solo engaña.

### Punto 6 — Ensamble con el mercado (HECHO) · `src/market.js`
- Mezcla lineal `w·modelo + (1-w)·mercado` (peso `ENSEMBLE_W`, manual en Ajustes). Fila en el
  benchmark 2022 y columna en la tabla campeón 2026. Calibración por RPS + leave-one-out.
- **Hallazgo:** sobre 2022 el óptimo es `w*≈0` (usar solo el mercado), pero es poco fiable
  (un solo torneo, el más atípico, y cuotas aproximadas). Por eso se quitó el botón "Calibrar
  con 2022" y `w` quedó manual.

### Extra — xG (DEMOSTRACIÓN HECHA) · `scripts/build_xg.py`
- StatsBomb Open Data (gratis) → xG por partido de WC 2018/22 + Euro 2020/24 (168 partidos) →
  `src/xg_data.js`. "Chequeo con xG" en la pestaña Validación.
- **Hallazgo fuerte:** el λ del modelo se acerca mucho más al xG observado (MAE ~0.56) que a los
  goles (MAE ~0.89). Confirma que el "error" es ruido de finalización y que **calibrar sobre xG
  es lo de mayor potencial**. No mejora 2026 todavía (falta xG del periodo de calibración).

### Punto 4 — Decaimiento temporal (PARCIAL)
- Ya está en la calibración de ataque/defensa (vida media 2 años). Falta llevarlo al Elo y fijar
  la vida media por validación cruzada.

---

## Archivos (qué toca cada cosa)

**Scripts (Python, stdlib, regeneran datos):**
- `scripts/refresh_elo.py` — Elo de eloratings.net → `ELO_OFFICIAL` en data.js.
- `scripts/build_backtest.py` — Elo histórico + snapshots → `src/backtest_data.js`.
- `scripts/build_attack_defense.py` — MLE ataque/defensa → `attack_defense.js` + `backtest_ad.js`.
- `scripts/build_xg.py` — xG StatsBomb → `src/xg_data.js`.
- `scripts/refresh_odds_2022.py` — cuotas 2022 verificadas (The Odds API histórico, de pago).
- `scripts/fetch_odds_2026.py` — cuotas reales 2026 (de-vig) → `src/odds_2026.js` + cache crudo.
- `scripts/build_parlay_odds.py` — precios por casa para parleys (del cache, sin API) → `src/parlay_odds.js`.
- `scripts/build_scorers.py` — share de goles por jugador (martj42, gratis) → `src/scorers_2026.js`.
- `scripts/fetch_player_odds_2026.py` — cuotas de goleadores por evento (~2 créditos/partido) → `src/player_odds_2026.js`.
- `scripts/fetch_scores_2026.py` — marcadores finales + anotadores del torneo → `src/results_2026.js`.
- `scripts/smoke_test.js` — 75 checks. Correr siempre tras tocar lógica.

**Fuente JS (orden de carga):** data → attack_defense → odds_2026 → parlay_odds → scorers_2026 →
player_odds_2026 → results_2026 → engine → quiniela → validation → market → parlay → bank →
backtest_data → backtest_ad → xg_data → backtest → ui.

**Generados (commiteados, NO editar a mano):** `src/backtest_data.js`, `src/attack_defense.js`,
`src/backtest_ad.js`, `src/xg_data.js`, `src/odds_2026.js`, `src/parlay_odds.js`,
`src/scorers_2026.js`, `src/player_odds_2026.js`, `src/results_2026.js`.

**Crudos (ignorados por git, se regeneran):** `data/results.csv`, `data/goalscorers.csv`
(martj42), `data/odds_2026_raw.json`, `data/player_odds_2026_raw.json` (caches de la API).
Excepción: `data/scores_2026.json` (marcadores acumulados, admite correcciones manuales) SÍ se
commitea — no se puede regenerar porque el endpoint de scores solo mira 3 días atrás.

---

## Datos y credenciales

- **`env.txt`** (raíz, IGNORADO por git): `ODDS_API_KEY` de The Odds API. **Verificada y funciona**
  (2 jun 2026): plan gratuito, 500 req/mes, ~494 restantes (se usaron ~6 probando+integrando). Si
  se filtró en algún commit, rotarla. La usa `fetch_odds_2026.py` y `refresh_odds_2022.py`.
- **The Odds API cubre el Mundial 2026 EN VIVO** (descubierto al probarla):
  - `soccer_fifa_world_cup_winner` (markets=outrights): cuotas de campeón reales (54 equipos).
  - `soccer_fifa_world_cup` (markets=h2h): **los 72 partidos de grupos ya con cuotas 1X2** y
    20-22 casas cada uno. (Cada llamada cuesta 1 crédito × región.)
- **xG de pago (pendiente):** FBref bloqueado por Cloudflare; para xG de calibración usar
  API-Football (api-sports.io) o Sportmonks (~€10-40/mes, verificar cobertura de eliminatorias),
  o StatsBomb (académico/comercial). Ver `CLAUDE.md` → Fuentes de datos.

---

## Cuotas reales de 2026 (HECHO) · `scripts/fetch_odds_2026.py` + `src/odds_2026.js`

Al probar la API se descubrió que The Odds API cubre el Mundial 2026 en vivo, y se integró:
- `scripts/fetch_odds_2026.py` baja (con la key de env.txt) el mercado de campeón (outright) y los
  **72 partidos de grupos (1X2)**, de-viga por casa y promedia (consenso multi-casa) → `src/odds_2026.js`
  (probabilidades ya sin margen). 72/72 partidos y 48/48 equipos cubiertos. Margen ~6% partidos, ~12% campeón.
- **Tabla campeón (Probabilidades)** ahora usa las cuotas REALES de la API (no las transcritas).
- **Quiniela**: en fase de grupos los picks son el ENSAMBLE modelo+mercado real (peso `ENSEMBLE_W`
  en Ajustes; w=1 = solo modelo). Resuelve en la práctica el ensamble para el caso de uso real.
- Refrescar cuando se quiera con `python3 scripts/fetch_odds_2026.py` (las cuotas cambian a diario).
  Gasta pocos créditos; quedaban ~494/500 tras construirlo.

---

## Parleys (HECHO, 9 jun 2026) · `src/parlay.js` + pestaña "Parleys"

Pestaña nueva que arma boletos combinados (parleys) de N legs (2-12) sobre los 72 partidos de
grupos, con seguimiento de aciertos durante el torneo:
- **Datos**: `scripts/build_parlay_odds.py` lee el cache crudo `data/odds_2026_raw.json` (ya
  estaba, 36 casas por partido) y emite `src/parlay_odds.js` con mejor cuota (+casa) y MEDIANA
  por resultado 1X2. **No gasta créditos de API.** Para refrescar: fetch_odds_2026.py primero.
- **Probabilidad por leg**: el ENSAMBLE modelo+mercado (mismo `ENSEMBLE_W` de la quiniela).
- **Estrategias**: *seguro* (max prob. de cobrar; cuota ~1.6, prob ~54% a 5 legs), *valor*
  (max prob×cuota mediana con piso prob>=40%; cuota ~18, prob ~10%, EV ~+75%), *agresivo*
  (valor entre cuotas mediana 2.5-8; cuota ~10k, prob ~0.05%). Boleto editable (quitar/añadir
  legs desde la tabla "Mejor valor por leg"). El filtro de jornada aplica al armador y a la
  tabla; cada clic en "Armar parley" propone una VARIANTE nueva (sin repetir partidos de las
  propuestas anteriores con la misma config) y reinicia el ciclo al agotar la jornada.
- **Hallazgo metodológico (anti-autoengaño)**: rankear por la MEJOR cuota perseguía líneas
  atípicas de una sola casa (Curazao @100 vs mediana 49) — winner's curse; y sin piso de
  probabilidad el "valor" se concentraba en tapados (Qatar, Irak, Jordania) justo donde el
  modelo discrepa del mercado, que es donde el backtest dice que el mercado tiene razón. Por
  eso: valor a la cuota MEDIANA + pisos/techos. La primera versión "valor" armaba boletos de
  cuota 368,280 con prob ~0% — quedó como advertencia de diseño.
- **Seguimiento**: boletos guardados en memoria + export/import JSON (sin localStorage, por
  convención). `scripts/fetch_scores_2026.py` (The Odds API /scores, 2 créditos, ventana 3
  días) acumula marcadores finales en `data/scores_2026.json` y regenera `src/results_2026.js`:
  cada leg se marca acierto/fallo/pendiente y el boleto queda VIVO/GANADO/PERDIDO, con resumen
  P&L. Solo fase de grupos (guard `--until 2026-06-28` para que una revancha de eliminatorias
  no pise la clave 'A|B').
- Smoke test: 44 -> 66 checks (cobertura, precios sanos, orden de estrategias, puntuación,
  estados del boleto, roundtrip JSON, filtros de jornada/mercado, variantes sin repetir,
  doble oportunidad y goleadores).

### Mercados extra: doble oportunidad y goleadores (HECHO, 9 jun 2026)

- **Doble oportunidad (1X / 12 / X2)**: cuota SINTETICA derivada del 1X2 por dutching
  (o₁·o₂/(o₁+o₂) = repartir el monto entre los dos resultados); la DC real de una casa es muy
  parecida porque la deriva del mismo 1X2. Sin gastar API. **Bug encontrado y corregido**: la
  DC de un favorito enorme da cuota sintética <= 1 (pérdida garantizada, "Alemania o empate"
  @0.98) y contaminaba la estrategia "seguro" — se excluyen del pool (cuota mediana > 1.01).
  Tras la poda, "seguro" quedó sano: DC de favoritos @1.02-1.07, 5 legs ≈ cuota 1.47, prob 72%.
- **Goleadores (anytime scorer, "anota en el partido")**: dos piezas nuevas:
  - `scripts/build_scorers.py` (GRATIS, martj42 goalscorers.csv): share de goles por jugador y
    selección, vida media 2 años, sin autogoles, nombres normalizados (unía "Julián Alvarez" /
    "Julián Álvarez"), filtros anti-retirado, y **shrinkage K=4 pseudo-goles** — sin él, el
    "valor" se concentraba en defensas con 2-3 goles de muestra (César Montes et al.). Modelo:
    P(anota) = 1−exp(−λ_equipo·share) (adelgazamiento Poisson). → `src/scorers_2026.js`.
  - `scripts/fetch_player_odds_2026.py` (The Odds API por EVENTO, ~2 créditos/partido con
    uk,eu): mejor cuota y mediana por jugador. Las casas cotizan pocos días antes: correr por
    jornada con `--days`. Primera corrida (9 jun): 15 partidos, 693 cuotas, 30 créditos
    (quedan ~462). → `src/player_odds_2026.js`.
  - Lado mercado del ensamble para goleadores: prob. implícita de la mediana × 0.85
    (`SCORER_DEVIG`, margen aproximado declarado — el mercado de goleadores no se puede
    de-vig como el 1X2 porque solo cotiza el "Sí").
  - Puntuación: `fetch_scores_2026.py` ahora también baja los anotadores del torneo (martj42)
    → `RESULTS_2026_SCORERS`. Reglas: 0-0 = fallo inmediato; goles sin lista aún = pendiente;
    nombres robustos a acentos/orden. El repo de martj42 tarda días en actualizar — paciencia.
- Filtro de **Mercado** en la pestaña (Todos / 1X2 / Doble oportunidad / Goleadores), que
  también respeta el armador y el ciclo de variantes. Máximo un leg por partido entre todos
  los mercados (correlación intra-partido).
- Chequeo de cordura de valor por mercado (sano): % de legs con valor>=1.1 — 1X2 8%, DC 3%,
  goleadores 2%; sin concentración sospechosa tras el shrinkage.

### Banca: reto escalera y plan Kelly (HECHO, 9 jun 2026) · `src/bank.js` + pestaña "Banca / Reto"

Dos formas de buscar profit con un monto específico, con la matemática enfrente:
- **Reto escalera**: la banca completa rueda escalón a escalón con fechas estrictamente
  crecientes (hay que cobrar antes del siguiente). Perfiles por banda de cuota mediana
  (conservador 1.15-1.45 / medio 1.4-1.9 / agresivo 1.8-3.0), pick por valor dentro de banda,
  sin goleadores (toda la banca a una alineación, no). Matemática EXACTA (sin simulación):
  banca = B0·Πcuotas, prob = Πpe, y columna **"EV si paras aquí"** con la mejor parada marcada
  — parar también es estrategia. Con datos del 9 jun: conservador $100→$518 (prob 21%), medio
  $100→$2,514 (4.6%), agresivo $100→$13,014 (1.3%). Variantes sin repetir, estados
  VIVO (banca acumulada) / ROTO / COMPLETADO contra resultados reales.
- **Plan Kelly fraccionado**: apuestas individuales sobre picks plausibles (pe>=0.40) con
  edge >=2% a cuota mediana; f* = (pe·o−1)/(o−1) a la mejor cuota × fracción (¼ default),
  tope 5% por pick y **máximo una apuesta por selección**. Monte Carlo (5,000 corridas) para
  el P&L: p5/p50/p95 y prob. de acabar abajo. **Trampa encontrada y corregida**: sin el piso
  de prob. y el límite por selección, el plan concentraba 3 apuestas en Qatar + Irak +
  Jordania — el mismo error del modelo apostado tres veces, con un MC "independiente" que
  mentía. Tras el fix: 7 picks diversificados, $239 en juego de $1,000, EV +$37, P(abajo) 33%.
- Retos y planes se guardan y viajan en el MISMO export/import JSON de la pestaña Parleys.
- **Fix de cronología (feedback de Jorge, 9 jun)**: `parlay_odds.js` ahora guarda el kick con
  HORA real (UTC), no solo el día. La escalera encadena por inicio real (>=3h entre escalones,
  permite dos el mismo día si los horarios alcanzan) y el plan Kelly se lista en orden
  cronológico — nunca un partido posterior antes que uno anterior. La UI muestra fecha y hora
  en la zona horaria del que mira (fmtKick).
- Smoke test: 66 -> 77 checks.

---

## Pendientes (resumen para retomar)

1. ~~[ALTA] Integrar cuotas reales de 2026~~ **HECHO** (ver sección arriba).
2. **[MEDIA] xG de calibración (de pago)** → recalibrar `build_attack_defense.py` con xG como
   objetivo y medir en el backtest si por fin supera al Elo. (La evidencia del chequeo xG dice que
   es la mejora con más potencial.)
3. **[MEDIA] Refrescar cuotas 2026 cerca del torneo** (`fetch_odds_2026.py`) — cambian a diario;
   re-correr antes de armar la quiniela final. Considerar `--regions eu,uk,us` para más casas.
   Después correr `build_parlay_odds.py` (mismo snapshot para los parleys).
3b. **[ALTA durante el torneo] Marcadores cada <=3 días** (`fetch_scores_2026.py`, 2 créditos)
   para que los boletos de la pestaña Parleys se puntúen solos (la ventana del endpoint es de
   3 días: si se deja pasar más, completar a mano en `data/scores_2026.json` + `--offline`).
   Trae también los anotadores (martj42, gratis) para los legs de goleador.
3c. **[ALTA durante el torneo] Cuotas de goleadores por jornada**
   (`fetch_player_odds_2026.py`, ~2 créditos/partido): las casas cotizan pocos días antes de
   cada partido. Primera corrida hecha el 9 jun (15 partidos de J1, quedan ~462 créditos).
4. **[MEDIA] Verificar cuotas 2022** (`refresh_odds_2022.py`, histórico de pago) para firmar el
   benchmark de mercado y poner `MARKET_2022_VERIFIED=true`.
5. **[BAJA] Ensamble multi-torneo histórico**: calibrar `w` con cuotas de varios torneos pasados
   (The Odds API histórico, de pago, desde ~mediados 2020). Para 2026 ya no hace falta: el ensamble
   per-partido usa el mercado real de cada juego.
6. **[BAJA] Decaimiento temporal en el Elo** + validación cruzada de la vida media.
7. **[BAJA] Mejoras de bandas**: σ por equipo (según partidos recientes) y bandas para las rondas.

Memorias estructuradas relacionadas en
`~/.claude/projects/-Users-jorgemier-Desktop-modelo-mundial-2026/memory/`:
`ensemble-calibracion-multitorneo-pendiente`, `xg-datos-disponibilidad`.
