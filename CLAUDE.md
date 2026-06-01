# CLAUDE.md — Memoria del proyecto

Este archivo es el contexto que Claude Code lee al inicio de cada sesión. Resume qué es el
proyecto, cómo está construido, qué decisiones se tomaron y qué falta. Mantenlo actualizado.

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
src/engine.js         Motor: estado (ratings, HFA, DC_ON, RHO), lambdas, jointGrid,
                      sampleScore, knockout, simulateGroup, assignThirds, runOne, runModel
src/quiniela.js       Bracket determinista/aleatorio, overrides editables, confianza por pick
src/validation.js     Backtest vs Mundial 2022 (RPS, Brier, log-loss, aciertos)
src/ui.js             render tabla, editor de fuerzas, ajustes del motor, pestañas, arranque
```

Dependencias: engine usa data; quiniela y validation usan engine+data; ui usa todo. Por eso
`ui.js` se carga al final y llama `buildEditor()` al arrancar.

## El modelo (lo esencial)

- **Fuerza**: cada selección tiene un rating tipo Elo. Diferencia de ~170 puntos = +1 gol
  esperado. `DEFAULT_RATINGS` son estimaciones base editables; `ELO_OFFICIAL` son los valores
  reales de eloratings.net.
- **Goles por partido**: Poisson con media `lambda = 1.33 +/- dif/170`, acotada.
- **Dixon-Coles** (`RHO=-0.13`): corrige la correlación en marcadores bajos (0-0, 1-1) que el
  Poisson simple subestima. Implementado como rejilla conjunta normalizada (`jointGrid`).
- **Ventaja de localía** (`HFA=50` Elo): se suma a MEX/USA/CAN cuando NO juegan entre sí.
- **Fase de grupos**: puntos -> dif. de goles -> goles a favor. Avanzan 1ro, 2do y los 8
  mejores terceros, asignados a sus llaves por backtracking respetando `THIRD_SLOTS`.
- **Eliminatorias**: mismo motor; empate se decide en "penales" (prob ~0.5 con leve sesgo
  por fuerza).
- **Quiniela modo "Más probable"**: marcador = modal CONDICIONADO al resultado más probable
  (no redondeo de goles esperados — eso forzaba demasiados 1-1). Determinista.
- **Quiniela modo "Escenario aleatorio"**: un sorteo único del motor con azar real.
- **Confianza por pick**: probabilidad del resultado/avance elegido. Verde >=60%, ámbar
  40-60%, rojo <40%. Es la guía para decidir dónde arriesgar en la quiniela.
- **Overrides**: el usuario puede fijar resultados (grupos) o ganadores (cuadro); el bracket
  re-fluye hacia abajo. Guardados en el objeto `overrides`.

## Datos y su procedencia

- **Estructura del torneo** (grupos, calendario, repechaje, cuadro): revista *World Soccer —
  World Cup 2026 Special*. Es estructura fija, no se simula el sorteo.
- **ELO_OFFICIAL**: extraído en vivo de eloratings.net (archivo `World.tsv` + `en.teams.tsv`),
  capturado en **junio 2026**. Las 48 selecciones son valores reales, no estimaciones.
  Refrescar con `scripts/refresh_elo.py` (ver abajo).
- **Backtest (validation.js)**: resultados de la fase de grupos del Mundial 2022 (verificados);
  fuerzas pre-torneo son Elo de eloratings.net de nov. 2022.

## Estado de validación (honesto)

El modelo tiene skill real pero modesto: ~56% de aciertos de resultado vs 33% de un volado,
RPS ~2.8% mejor que no tener información, sobre la fase de grupos 2022. Hallazgos:
- Dixon-Coles mejora marcadores más que resultados (delta pequeño en RPS).
- La localía EMPEORA el backtest de 2022 porque el anfitrión (Qatar) era débil; está
  justificada por la literatura (~+0.3 gol en casa) y es relevante para 2026.
- Una sola fase de grupos NO es validación robusta. Es el marco, no la conclusión.

## Roadmap (en orden de valor)

1. **Benchmark vs mercado de apuestas**: invertir cuotas -> probabilidades implícitas, medir
   si el modelo le gana. Es el diagnóstico clave: si no le gana, conviene usar las cuotas.
2. **Backtest multi-torneo**: ampliar validation.js a 2014/2018/Euros/Copa América con el
   dataset histórico de Kaggle (martj42, "International football results 1872-2026"). Reportar
   RPS con banda de incertidumbre, no un número único.
3. **Ratings ataque/defensa separados**: la única mejora estructural que de verdad ayuda a la
   quiniela (mejora marcadores). Calibrar por máxima verosimilitud sobre el histórico.
4. **Decaimiento temporal** en la calibración (partidos recientes pesan más).
5. **Bandas de confianza** en las probabilidades (distribución sobre ratings, propagada).
6. **Ensamble con el mercado** (promedio ponderado modelo + cuotas).

Nota: del punto 2 en adelante ya no cabe cómodo en un solo HTML; conviene un pipeline de datos
en Python (scripts/) que calcule ratings y escriba a `src/data.js`.

## Fuentes de datos útiles

- eloratings.net — Elo de selecciones (mejor predictor de un número). Ver refresh_elo.py.
- Kaggle martj42 "International football results 1872-2026" — ~49k partidos, CSV gratis.
- StatsBomb Open Data (GitHub) — eventos con xG, incluye Mundiales (avanzado).
- The Odds API / datasets con odds — para el benchmark de mercado.

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
campeón = N), arma una quiniela y corre el backtest. Si algo se rompe al refactorizar, falla ahí.

## Tareas típicas para Claude Code

- "Refresca el Elo": correr `scripts/refresh_elo.py`, pegar el dict resultante en
  `src/data.js` (ELO_OFFICIAL) y actualizar la fecha de captura en este archivo.
- "Agrega ataque/defensa": tocar engine.js (lambdas) y data.js (estructura de ratings).
- "Amplía el backtest": tocar validation.js + un script Python que prepare los datos.
- Cualquier cambio de lógica: correr smoke_test.js antes de dar por hecho que funciona.
