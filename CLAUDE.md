# CLAUDE.md — Memoria del proyecto

Este archivo es el contexto que Claude Code lee al inicio de cada sesión. Resume qué es el
proyecto, cómo está construido, qué decisiones se tomaron y qué falta. Mantenlo actualizado.

> Para retomar trabajo: ver **`BITACORA.md`** (recap cronológico, hallazgos, pendientes y cómo
> seguir). Este archivo es la referencia técnica permanente; la bitácora es el "dónde nos quedamos".

## Qué es

Modelo predictivo del Mundial de fútbol 2026 (48 selecciones). Simula el torneo completo
miles de veces (Monte Carlo) para estimar probabilidades por ronda y campeón, y genera una
**quiniela** llenando los 104 partidos con marcador y ganador. Corre 100% en el navegador,
sin servidor ni build: se abre `index.html` directamente.

El usuario es Jorge, consultor financiero. Idioma del proyecto y de la UI: **español**.
Preferencia explícita: **no usar emojis** en código ni en texto.

## Cómo correrlo

No hay build. Abrir `index.html` en un navegador (o `python3 -m http.server` en la carpeta
y visitar localhost). Los módulos se cargan como `<script src>` en orden de dependencia.

Para probar la lógica sin navegador se usa Node: los módulos son JS plano (variables `const`
en scope global), así que se pueden concatenar y evaluar. Ver "Pruebas" abajo.

## Arquitectura

El proyecto nació como un solo archivo HTML y se separó en módulos. Orden de carga (importa,
porque comparten scope global y hay dependencias):

```
index.html            UI/HTML (markup de las 4 pestañas) + carga de scripts
src/styles.css        Estilos (tema oscuro, tipografía Anton/Sora/Spline Mono)
src/data.js           Constantes: GROUPS, FIX (calendario), DEFAULT_RATINGS,
                      ELO_OFFICIAL, HOSTS, THIRD_SLOTS, RO32/RO16/QF/SF, GROUP_COLORS
src/attack_defense.js GENERADO por build_attack_defense.py. AD_RATINGS (ataque/defensa por
                      equipo), AD_GAMMA, AD_HADV. Lo usa engine si AD_ON. No editar a mano
src/odds_2026.js      GENERADO por fetch_odds_2026.py (The Odds API). Cuotas REALES de 2026 ya
                      de-vig: ODDS_2026_OUTRIGHT (campeón) y ODDS_2026_MATCHES (72 partidos 1X2).
                      Lo usan market.js (tabla campeón) y quiniela.js (ensamble). No editar a mano
src/parlay_odds.js    GENERADO por build_parlay_odds.py (lee el cache data/odds_2026_raw.json,
                      no gasta API). PRECIOS por casa de los 72 partidos: mejor cuota (+casa) y
                      mediana por resultado 1X2. Lo usa parlay.js. No editar a mano
src/scorers_2026.js   GENERADO por build_scorers.py (martj42 goalscorers.csv, gratis). Share de
                      goles por jugador y seleccion (vida media 2 años, shrinkage K=4, sin
                      autogoles). Alimenta P(anota)=1-exp(-lambda*share) en parlay.js
src/player_odds_2026.js GENERADO por fetch_player_odds_2026.py (The Odds API por evento,
                      player_goal_scorer_anytime). Mejor cuota (+casa) y mediana por jugador.
                      Las casas cotizan dias antes de cada partido: re-correr por jornada
src/results_2026.js   GENERADO por fetch_scores_2026.py (The Odds API /scores). Marcadores
                      finales de la fase de grupos 2026 (RESULTS_2026); vacío hasta que arranque
                      el torneo. Lo usa parlay.js para puntuar boletos. No editar a mano
src/engine.js         Motor: estado (ratings, HFA, DC_ON, RHO, AD_ON, RATING_SD), lambdas (Elo
                      o ataque/defensa), jointGrid, sampleScore, knockout, runOne, runModel,
                      runBands (Monte Carlo de 2 niveles para las bandas de confianza)
src/quiniela.js       Bracket determinista/aleatorio, overrides editables, confianza por pick
src/parlay.js         Pestaña Parleys: pool de legs en TRES mercados (1X2 con cuotas reales,
                      doble oportunidad con cuota sintetica del 1X2 por dutching, goleadores
                      anytime con cuota real + share historico), estrategias seguro/valor/
                      agresivo, filtros de jornada y mercado, variantes sin repetir, stats
                      honestas del boleto (prob. de pegarle, EV), boletos en memoria (export/
                      import JSON) puntuados contra RESULTS_2026 (y RESULTS_2026_SCORERS para
                      goleadores). El valor se juzga a la cuota MEDIANA (anti winner's curse)
src/bank.js           Pestaña Banca/Reto: reto escalera (banca completa rodando N escalones
                      con fechas crecientes, matematica exacta, EV de parar por escalon) y
                      plan Kelly fraccionado (apuestas individuales sobre picks plausibles con
                      edge, f* con fraccion y topes, Monte Carlo del P&L). Retos y planes
                      viajan en el export/import JSON de parlay.js
src/validation.js     Backtest vs Mundial 2022 (RPS, Brier, log-loss, aciertos)
src/market.js         Benchmark vs mercado: de-vig (cuotas -> prob), head-to-head 2022
                      (mercado/modelo/uniforme/ensamble) y comparación campeón 2026
                      (modelo/mercado/ensamble). Ensamble = mezcla lineal w*modelo+
                      (1-w)*mercado; w calibrable (ENSEMBLE_W) con RPS y leave-one-out
src/backtest_data.js  GENERADO por scripts/build_backtest.py. 10 torneos, sus partidos de
                      grupos y el Elo pre-torneo calculado del histórico. No editar a mano
src/backtest_ad.js    GENERADO por build_attack_defense.py. Snapshots ataque/defensa pre-torneo
                      por edición (claves en inglés). No editar a mano
src/xg_data.js        GENERADO por build_xg.py. xG observado por partido (StatsBomb), solo
                      torneos grandes (WC 2018/22, Euro 2020/24). No editar a mano
src/backtest.js       Backtest multi-torneo: compara Elo vs Ataque/Defensa en RPS (resultado) y
                      log-loss de marcador, por torneo y agrupado con IC 90% + test pareado.
                      Además un "chequeo con xG" (λ del modelo vs xG observado vs goles)
src/ui.js             render tabla, editor de fuerzas, ajustes del motor, pestañas, arranque
```

Dependencias: engine usa data + attack_defense (si AD_ON); quiniela y validation usan
engine+data; market usa validation (rpsScore, oVec, evalCfg, G22/R22) + engine; parlay usa
quiniela (gridProbs, confClass) + market (ENSEMBLE_W) + parlay_odds + results_2026; backtest usa
validation (vLambdas, matchProbs, rpsScore, oVec) + engine + backtest_data + backtest_ad; ui
usa todo. Orden de carga: data -> attack_defense -> odds_2026 -> parlay_odds -> scorers_2026 ->
player_odds_2026 -> results_2026 -> engine -> quiniela -> validation -> market -> parlay ->
bank -> backtest_data -> backtest_ad -> xg_data -> backtest -> ui (último, arranca buildEditor).

## El modelo (lo esencial)

- **Fuerza**: cada selección tiene un rating tipo Elo. Diferencia de ~170 puntos = +1 gol
  esperado. `DEFAULT_RATINGS` son estimaciones base editables; `ELO_OFFICIAL` son los valores
  reales de eloratings.net.
- **Goles por partido**: Poisson con media `lambda = 1.33 +/- dif/170`, acotada (modo Elo).
- **Modo Ataque/Defensa** (`AD_ON`, roadmap 3): alterna a `lambda = AD_GAMMA * (localía si
  anfitrión) * ataque * defensa_rival`, con ataque/defensa por equipo calibrados por máxima
  verosimilitud del histórico (`attack_defense.js`). Separa "marca mucho" de "encaja poco".
  Por defecto OFF: el backtest dice que no le gana al Elo de forma significativa (ver abajo).
- **Bandas de confianza** (`RATING_SD`, roadmap 5): `runBands` corre un Monte Carlo de dos
  niveles — cada sorteo perturba las fuerzas con ruido gaussiano (±RATING_SD Elo) y simula el
  torneo — y reporta el IC 90% de la prob. de campeón (whisker en las barras, rango en la tabla).
  Propaga la incertidumbre de las fuerzas a las salidas. Por defecto 0 (off). Se expresa en Elo.
- **Dixon-Coles** (`RHO=-0.13`): corrige la correlación en marcadores bajos (0-0, 1-1) que el
  Poisson simple subestima. Implementado como rejilla conjunta normalizada (`jointGrid`).
- **Ventaja de localía** (`HFA=50` Elo): se suma a MEX/USA/CAN cuando NO juegan entre sí.
- **Fase de grupos**: puntos -> dif. de goles -> goles a favor. Avanzan 1ro, 2do y los 8
  mejores terceros, asignados a sus llaves por backtracking respetando `THIRD_SLOTS`.
- **Eliminatorias**: mismo motor; empate se decide en "penales" (prob ~0.5 con leve sesgo
  por fuerza).
- **Quiniela modo "Más probable"**: marcador = modal CONDICIONADO al resultado más probable
  (no redondeo de goles esperados — eso forzaba demasiados 1-1). Determinista. En la fase de
  grupos, si hay cuotas reales de 2026 (`ODDS_2026_MATCHES`) y `ENSEMBLE_W<1`, el resultado se
  elige con el ENSAMBLE modelo+mercado (el marcador sigue siendo el modal del modelo). w=1 en
  Ajustes = solo modelo.
- **Quiniela modo "Escenario aleatorio"**: un sorteo único del motor con azar real.
- **Confianza por pick**: probabilidad del resultado/avance elegido. Verde >=60%, ámbar
  40-60%, rojo <40%. Es la guía para decidir dónde arriesgar en la quiniela.
- **Overrides**: el usuario puede fijar resultados (grupos) o ganadores (cuadro); el bracket
  re-fluye hacia abajo. Guardados en el objeto `overrides`.
- **Parleys (pestaña Parleys)**: arma boletos de N legs sobre los 72 partidos de grupos en tres
  mercados: **1X2** (cuotas reales por casa), **doble oportunidad** (cuota sintética del 1X2
  por dutching o₁·o₂/(o₁+o₂); se excluyen las de cuota <=1.01, favoritos enormes) y
  **goleadores** anytime (cuota real por evento; prob. del modelo = 1−exp(−λ·share), share
  histórico martj42 con vida media 2 años y shrinkage K=4; mercado del ensamble = implícita de
  la mediana × 0.85 de margen declarado, `SCORER_DEVIG`). Estrategias: *seguro* (max prob. de
  cobrar), *valor* (max prob×cuota mediana sobre picks plausibles, prob>=40%), *agresivo* (valor
  entre cuotas mediana 2.5-8). Decisiones anti-autoengaño: el valor se juzga a la cuota MEDIANA
  entre casas (rankear por la mejor persigue líneas atípicas de una casa — winner's curse) y con
  pisos/techos de probabilidad (sin ellos el "valor" se concentra en tapados donde el modelo
  discrepa del mercado, y ahí el mercado suele tener razón; en goleadores, en defensas con 2-3
  goles de muestra — de ahí el shrinkage). Máximo un leg por partido (los mercados del mismo
  partido están correlacionados). El boleto muestra siempre su prob. de pegarle y EV; el pago
  se reporta con la mejor cuota (line shopping) y con la mediana (una sola casa). Boletos en
  memoria de sesión + export/import JSON (sin localStorage); se puntúan contra `RESULTS_2026`
  (goleadores contra `RESULTS_2026_SCORERS`; 0-0 = fallo, goles sin lista aún = pendiente).
- **Banca / Reto (bank.js)**: dos formas de buscar profit con un monto específico, con la
  matemática enfrente. **Reto escalera**: la banca completa rueda escalón a escalón (fechas
  estrictamente crecientes — hay que cobrar antes del siguiente; perfiles por banda de cuota
  mediana: conservador 1.15-1.45, medio 1.4-1.9, agresivo 1.8-3.0; dentro de banda elige por
  valor; sin goleadores — toda la banca a una alineación no). Matemática exacta: banca final =
  B0·Πcuotas, prob = Πpe, y columna "EV si paras aquí" (= pCum·banca − B0) con la mejor parada
  marcada — parar también es estrategia. **Plan Kelly fraccionado**: apuestas individuales
  sobre picks plausibles (pe>=0.40) con edge >=2% a cuota mediana, f* = (pe·o−1)/(o−1) a la
  mejor cuota × fracción (¼ default) con tope 5% por pick y MÁXIMO UNA APUESTA POR SELECCIÓN
  (un edge que nace de una sola creencia del modelo no se diversifica apostándolo tres veces);
  Monte Carlo (5,000 corridas) para la distribución del P&L (p5/p50/p95, prob. de acabar
  abajo). Retos y planes se guardan, se puntúan con resultados reales y viajan en el mismo
  export/import JSON.

## Datos y su procedencia

- **Estructura del torneo** (grupos, calendario, repechaje, cuadro): revista *World Soccer —
  World Cup 2026 Special*. Es estructura fija, no se simula el sorteo.
- **ELO_OFFICIAL**: extraído en vivo de eloratings.net (archivo `World.tsv` + `en.teams.tsv`),
  capturado en **junio 2026**. Las 48 selecciones son valores reales, no estimaciones.
  Refrescar con `scripts/refresh_elo.py` (ver abajo).
- **Backtest 2022 (validation.js)**: resultados de la fase de grupos del Mundial 2022
  (verificados); fuerzas pre-torneo son Elo de eloratings.net de nov. 2022.
- **Backtest multi-torneo (backtest_data.js, generado)**: histórico *martj42 — International
  football results* (~49k partidos, descargado a `data/results.csv`, ignorado por git). El Elo
  pre-torneo de cada equipo se **calcula** del histórico con `scripts/build_backtest.py` (Elo
  World Football: K por torneo, multiplicador de goles, ventaja local), no se inventa. 10
  ediciones, solo fases de grupos.
- **Ratings ataque/defensa (attack_defense.js + backtest_ad.js, generados)**: calibrados por
  máxima verosimilitud sobre el mismo histórico con `scripts/build_attack_defense.py` (modelo de
  Maher: ataque, defensa, tasa base, localía; pesos por importancia, vida media 2 años, shrinkage
  ligero). El archivo vivo es a 2026 (claves español); los snapshots son pre-torneo por edición.
- **xG observado (xg_data.js, generado)**: StatsBomb Open Data vía `scripts/build_xg.py`. GRATIS
  pero solo torneos grandes (Mundial 2018/22, Euro 2020/24), fase de grupos — NO eliminatorias ni
  amistosos, así que ilustra el valor del xG pero NO sirve para recalibrar 2026. Para eso haría
  falta xG del periodo de calibración: FBref está bloqueado por Cloudflare (no scrapeable simple),
  así que requiere feed de pago — ver "Fuentes de datos útiles".
- **Cuotas REALES de 2026 (odds_2026.js, GENERADO desde The Odds API)**: campeón (outright) y los
  72 partidos de grupos (1X2), ya de-vig (consenso multi-casa). Es la fuente PRIMARIA para la
  comparación de campeón y el ensamble de la quiniela. Refrescar con `scripts/fetch_odds_2026.py`
  (usa la key de env.txt). Fallback si no existe: las cuotas transcritas de BetMGM (abajo).
- **Precios por casa para parleys (parlay_odds.js, GENERADO)**: `build_parlay_odds.py` lee el
  cache crudo `data/odds_2026_raw.json` (lo deja fetch_odds_2026.py) y extrae mejor cuota (+casa)
  y mediana por resultado — PRECIOS con margen, que es lo que paga un boleto. No gasta créditos;
  para refrescar: primero fetch_odds_2026.py, luego build_parlay_odds.py.
- **Marcadores finales 2026 (results_2026.js, GENERADO)**: `fetch_scores_2026.py` (The Odds API
  /scores, 2 créditos por corrida, ventana de 3 días — correr al menos cada 3 días durante el
  torneo). Acumula en `data/scores_2026.json` (ahí van también correcciones manuales) y solo
  guarda fase de grupos (hasta `--until`, default 2026-06-28). El mismo script baja los
  ANOTADORES del torneo (martj42 goalscorers.csv, gratis, con días de retraso) para puntuar
  los legs de goleador.
- **Share de goles por jugador (scorers_2026.js, GENERADO)**: `build_scorers.py` sobre martj42
  goalscorers.csv (~44k goles, gratis). Agrega por nombre normalizado (acentos/orden), pondera
  con vida media de 2 años, excluye autogoles, shrinkage K=4 pseudo-goles y filtros
  anti-retirado (último gol <=30 meses). 48 selecciones, ~430 jugadores.
- **Cuotas de goleadores 2026 (player_odds_2026.js, GENERADO)**: `fetch_player_odds_2026.py`
  (The Odds API, mercado `player_goal_scorer_anytime`, solo por evento: ~2 créditos/partido con
  uk,eu). Las casas cotizan pocos días antes de cada partido — correr por jornada con `--days`.
  Acumula en `data/player_odds_2026_raw.json`.
- **Cuotas de campeón 2026 transcritas (market.js, MARKET_2026_OUTRIGHT)**: BetMGM, 1 jun 2026,
  48 selecciones. Solo fallback ahora que odds_2026.js trae datos reales multi-casa.
- **Cuotas 1X2 de cierre 2022 (market.js, MARKET_2022)**: por ahora **APROXIMADAS** (consenso
  de mercado transcrito a mano, `MARKET_2022_VERIFIED=false`). No hay CSV libre 1X2 de este
  torneo (oddsportal usa JS y bloquea scraping). Bastan para el método y un orden de magnitud,
  NO para concluir. Reemplazar por datos verificados con `scripts/refresh_odds_2022.py`
  (The Odds API, endpoint histórico) y poner `MARKET_2022_VERIFIED=true`.

## Estado de validación (honesto)

Tras el backtest multi-torneo (roadmap 2), el panorama es más favorable de lo que sugería 2022
solo. Hallazgos:
- **Multi-torneo (10 ediciones, 338 partidos de grupos)**: RPS agrupado ~0.194, **IC 90%
  ~[0.180, 0.210]**, una mejora del **~18%** sobre el uniforme, con toda la banda por debajo.
  Skill real y robusto. Por torneo varía mucho (RPS ~0.14 a ~0.24): las Copas América son muy
  predecibles (mejora 25-38%), mientras que **2022 (-0.4%) y Euro 2016 (+0.8%) fueron outliers
  caóticos**. Eso explica por qué el backtest de 2022-solo (~3% de mejora) subestimaba el skill:
  era de los torneos más atípicos. Lección: reportar la banda, no un torneo.
- **Mercado (2022, cuotas aproximadas)**: el mercado de cierre le gana al modelo (RPS ~0.221 vs
  ~0.239) y el ensamble óptimo ignora al modelo (w*≈0). El mercado es el rival a vencer.
- **Ataque/Defensa vs Elo (roadmap 3)**: sobre los 10 torneos NO le gana al Elo de forma
  significativa, ni en resultado (RPS 0.195 vs 0.194) ni en marcador (log-loss 2.797 vs 2.810;
  IC pareado ~[-0.057, +0.030], cruza el 0). El punto estimado favorece levísimamente a A/D en
  marcadores, pero no es concluyente. Lección honesta: en selecciones (pocos partidos por equipo)
  los parámetros extra de ataque/defensa no rinden frente a un Elo único bien regularizado. La
  hipótesis del roadmap 3 NO se confirma; el arnés permitió decirlo con datos, no con fe.
- **xG (chequeo, StatsBomb, 168 partidos de WC 2018/22 + Euro 2020/24)**: el λ esperado del modelo
  se acerca MUCHO más al xG observado (MAE ~0.56) que a los goles reales (MAE ~0.89); el desajuste
  |goles − xG| ~1.5 por partido. Es decir, el modelo predice bien el PROCESO y gran parte de su
  "error" es varianza de finalización (ruido), no del modelo. Esto explica por qué calibrar sobre
  goles no superó al Elo y señala que **calibrar sobre xG es la mejora con más potencial** — hoy
  bloqueada por datos (se necesita xG del periodo de calibración, solo vía feed de pago).
- Dixon-Coles mejora marcadores más que resultados (delta pequeño en RPS).
- La localía EMPEORA el backtest de 2022 (el anfitrión Qatar era débil), pero está justificada
  por la literatura (~+0.3 gol en casa) y es relevante para 2026.

## Roadmap (en orden de valor)

1. ~~**Benchmark vs mercado de apuestas**~~ **(hecho — market.js)**: cuotas -> prob. implícitas
   (de-vig por normalización). Head-to-head puntuable sobre los 48 partidos de grupos 2022
   (mercado vs modelo vs uniforme, en la pestaña Validación) y comparación descriptiva del
   campeón 2026 (modelo vs mercado, en Probabilidades). **Hallazgo con cuotas aproximadas: el
   mercado de cierre le gana al modelo** (RPS ~0.221 vs ~0.239, el mercado ~7.5% mejor) — la
   conclusión esperada y el motivo de los puntos 6 (ensamble) y 2 (más muestra). Pendiente:
   verificar las cuotas 2022 (`refresh_odds_2022.py`) para firmar el número; de-vig más fino
   (Shin/odds-ratio) como mejora.
2. ~~**Backtest multi-torneo**~~ **(hecho — backtest.js)**: 10 ediciones (Mundiales 2014/18/22,
   Euros 2016/20/24, Copas América 2016/19/21/24), fases de grupos, con Elo pre-torneo calculado
   del histórico martj42 por `scripts/build_backtest.py`. Reporta RPS por torneo y agrupado con
   **IC 90% por bootstrap** (banda, no número único). Resultado: ~18% de mejora sobre uniforme,
   skill robusto (ver "Estado de validación"). Pendiente opcional: añadir más torneos (Copa Asia,
   Copa África, Nations League) y separar por confederación.
3. ~~**Ratings ataque/defensa separados**~~ **(hecho — attack_defense.js)**: calibrados por
   máxima verosimilitud (Maher) sobre el histórico, con `build_attack_defense.py`. Toggle
   `Ataque/Defensa` en Ajustes (afecta simulador y quiniela); comparación Elo vs A/D en el
   backtest (RPS + log-loss de marcador, con test pareado). **Hallazgo honesto: NO le gana al
   Elo de forma significativa** en selecciones (ver "Estado de validación") — la mejora teórica
   en marcadores no se materializa con tan pocos partidos por equipo. Queda como opción (OFF por
   defecto). Posible mejora: fijar ataque/defensa con suavizado bayesiano jerárquico o ajustar
   τ de Dixon-Coles conjuntamente.
4. **Decaimiento temporal**: parcialmente hecho — la calibración de ataque/defensa ya pondera por
   vida media (2 años). Falta llevarlo al Elo y validar la vida media por validación cruzada.
5. ~~**Bandas de confianza**~~ **(hecho — engine.runBands)**: Monte Carlo de dos niveles que
   perturba las fuerzas (±`RATING_SD` Elo, slider en Ajustes) y propaga la incertidumbre a la
   prob. de campeón, mostrando IC 90% (whisker en barras, rango en tabla). Hallazgo: con ±30-50
   Elo el favorito tiene una banda de ~±8-12 pp — las probabilidades de campeón son MUY inciertas,
   un recordatorio sano. Pendiente: σ por equipo (data-driven, según partidos recientes) en vez
   de uno global; bandas también para las rondas, no solo campeón.
6. ~~**Ensamble con el mercado**~~ **(hecho — market.js)**: mezcla lineal `w*modelo +
   (1-w)*mercado` (peso del modelo `ENSEMBLE_W`, ajustable manualmente en Ajustes). Fila Ensamble
   en el benchmark 2022 y columna Ensamble en la tabla campeón 2026
   (ordena por ella; es la mejor estimación de producción). Calibración por grid-search de RPS
   + **leave-one-out** para el número honesto. **Hallazgo (cuotas aproximadas): w\*≈0** — sobre
   2022 lo óptimo es ignorar el modelo y usar el mercado (ens = mercado, RPS ~0.221; LOO
   ~0.221). Es lo esperado cuando el modelo es el componente débil: el ensamble lucirá cuando
   el modelo mejore (punto 3) o haya más muestra (punto 2), y con cuotas verificadas.
   **PENDIENTE (decisión Jorge, 1 jun 2026):** el peso `w` se calibra solo con 2022 (único torneo
   con cuotas) — poco confiable. Extenderlo a varios torneos quedó pendiente; por eso se quitó el
   botón "Calibrar con 2022" y `w` es manual. Hay API key de The Odds API en `env.txt` (ignorado
   por git) para cuando se retome. Ver memoria del proyecto.

Nota: del punto 2 en adelante ya no cabe cómodo en un solo HTML; conviene un pipeline de datos
en Python (scripts/) que calcule ratings y escriba a `src/data.js`.

## Fuentes de datos útiles

- eloratings.net — Elo de selecciones (mejor predictor de un número). Ver refresh_elo.py.
- Kaggle martj42 "International football results 1872-2026" — ~49k partidos, CSV gratis.
- StatsBomb Open Data (GitHub) — eventos con xG GRATIS, pero solo torneos grandes (no
  eliminatorias/amistosos). Ver build_xg.py.
- The Odds API / datasets con odds — para el benchmark de mercado. Hay key en `env.txt`.
- **xG internacional para CALIBRAR (de pago, pendiente)**: FBref/Opta tiene xG de
  eliminatorias/amistosos/Nations League pero NO es scrapeable (Cloudflare) ni vendible directo.
  Opciones de pago: **API-Football (api-sports.io)** y **Sportmonks** (xG en planes ~€10-40/mes,
  cobertura internacional variable — verificar que incluyan eliminatorias antes de pagar);
  **StatsBomb** (acceso académico/comercial, a veces gratis para investigación si se solicita);
  **Stats Perform/Opta** (enterprise, caro). Con cualquiera, recalibrar attack_defense sobre xG.

## Convenciones

- Nombres de equipos en español como claves (ej. "Paises Bajos", "Rep. Checa"). El mapeo a
  nombres de eloratings (inglés) vive en `scripts/refresh_elo.py`.
- Sin dependencias de runtime ni framework. Vanilla JS. No usar localStorage (rompe en algunos
  entornos de preview; si se necesita persistencia, usar variables en memoria de sesión).
- Mantener cada módulo enfocado; la lógica (engine/quiniela/validation) separada del DOM (ui).

## Pruebas

No hay framework de test todavía. Para validar cambios en la lógica sin navegador:

```bash
# concatenar módulos y ejecutar en Node con un DOM falso mínimo
node scripts/smoke_test.js
```

`scripts/smoke_test.js` carga los módulos, corre el Monte Carlo (verifica que la suma de
campeón = N), arma una quiniela, corre el backtest, el benchmark vs mercado (cobertura de las
48 cuotas 2022, de-vig que normaliza a 1, RPS del mercado, outright de 48 equipos) y el
ensamble (blend que suma 1, peso óptimo en [0,1], ensamble óptimo <= mejor componente, LOO), el
backtest multi-torneo (10 torneos/338 partidos, RPS agrupado, IC 90% que bracketea la media) y
ataque/defensa (cubre 48, lambdas sanas y distintas del Elo, Monte Carlo conserva masa, log-loss
de marcador sano) y las bandas de confianza (cubre 48, lo<=media<=hi en [0,1], ancho positivo con
σ>0), el chequeo con xG (4 torneos, cobertura y MAE sanos), las cuotas reales de 2026 (outright
48/suma 1, 72 partidos cubiertos, la quiniela usa el ensamble) y los parleys (cuotas por casa
cubren 72, precios sanos, pools por mercado — 216 legs 1X2, DC podada a cuota>1.01, goleadores
si hay cuotas de jugador —, estrategias ordenadas seguro>=valor>=agresivo en prob., puntuación
gana/pierde/empate por cobertura, goleadores con nombres robustos a acentos y 0-0/pendiente,
boleto vivo->perdido/ganado, export/import JSON, filtros de jornada y mercado respetados,
variantes sin repetir partidos con reinicio de ciclo), y la banca (escalera con fechas
crecientes/banda/matemática exacta/estados vivo-roto-completado, Kelly con topes y fórmula
verificada, Monte Carlo con percentiles ordenados, export/import con retos y planes). Son 75
checks; si algo se rompe al refactorizar, falla ahí. Nota: los archivos generados (`backtest_data.js`,
`attack_defense.js`, `backtest_ad.js`, `xg_data.js`, `odds_2026.js`, `parlay_odds.js`,
`scorers_2026.js`, `player_odds_2026.js`, `results_2026.js`) deben existir — regenerarlos con
sus scripts si faltan (build_backtest.py, build_attack_defense.py, build_xg.py,
fetch_odds_2026.py, build_parlay_odds.py, build_scorers.py, fetch_player_odds_2026.py,
fetch_scores_2026.py).

## Tareas típicas para Claude Code

- "Refresca el Elo": correr `scripts/refresh_elo.py`, pegar el dict resultante en
  `src/data.js` (ELO_OFFICIAL) y actualizar la fecha de captura en este archivo.
- "Verifica las cuotas 2022": correr `scripts/refresh_odds_2022.py --key ...` (necesita API key
  histórica de The Odds API), pegar el bloque `MARKET_2022` en `src/market.js` y poner
  `MARKET_2022_VERIFIED=true`.
- "Refresca las cuotas de campeón 2026": actualizar `MARKET_2026_OUTRIGHT` (y la fecha
  `MARKET_2026_DATE`) en `src/market.js` desde una casa citable (ahora BetMGM).
- "Recalibra ataque/defensa": correr `python3 scripts/build_attack_defense.py` (reescribe
  `src/attack_defense.js` y `src/backtest_ad.js`). `--verify` imprime gamma, localía y los mejores
  ataques/defensas. Hiperparámetros (vida media, shrinkage) arriba del script.
- "Regenera el xG (StatsBomb)": correr `python3 scripts/build_xg.py` (baja eventos de StatsBomb y
  reescribe `src/xg_data.js`; `--only WC2022` para uno solo). Tarda (descarga ~168 partidos).
- "Refresca las cuotas reales de 2026": correr `python3 scripts/fetch_odds_2026.py` (usa la key de
  env.txt; gasta pocos créditos). Reescribe `src/odds_2026.js`. `--regions eu,uk,us` para más casas.
  Actualizar `CAPTURED` en el script. Las cuotas cambian a diario hasta el torneo. Después correr
  `python3 scripts/build_parlay_odds.py` para que los parleys usen el mismo snapshot.
- "Baja los marcadores del torneo": correr `python3 scripts/fetch_scores_2026.py` (2 créditos,
  ventana de 3 días — al menos cada 3 días durante el Mundial). Reescribe `src/results_2026.js`
  (marcadores + anotadores de martj42) y los boletos de la pestaña Parleys se puntúan solos.
  Correcciones manuales en `data/scores_2026.json` + `--offline`.
- "Refresca las cuotas de goleadores": correr `python3 scripts/fetch_player_odds_2026.py`
  (~2 créditos por partido en ventana; `--days N` para la ventana, `--regions uk` para gastar
  menos). Correr antes de cada jornada: las casas cotizan goleadores pocos días antes.
- "Recalibra los shares de goleo": correr `python3 scripts/build_scorers.py` (gratis, baja
  goalscorers.csv de martj42 si falta; `--verify` imprime los top por selección).
- "Regenera el backtest multi-torneo": correr `python3 scripts/build_backtest.py` (descarga
  `data/results.csv` si falta y reescribe `src/backtest_data.js`). `--verify` imprime conteos y
  cordura del Elo. Para añadir torneos, editar `EDITIONS` (con su ventana de fase de grupos).
- "Agrega ataque/defensa": tocar engine.js (lambdas) y data.js (estructura de ratings).
- "Amplía el backtest": tocar validation.js + un script Python que prepare los datos.
- Cualquier cambio de lógica: correr smoke_test.js antes de dar por hecho que funciona.
