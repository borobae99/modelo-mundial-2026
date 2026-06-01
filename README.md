# Modelo Predictivo · Mundial 2026

Simulador del Mundial de fútbol 2026 (48 selecciones). Estima probabilidades por ronda y
campeón mediante Monte Carlo, y genera una quiniela completa con los 104 partidos. Corre
entero en el navegador, sin servidor ni build.

## Uso rápido

Abrir `index.html` en un navegador. O, para evitar restricciones de carga local de scripts:

```bash
cd modelo-mundial-2026
python3 -m http.server 8000
# abrir http://localhost:8000
```

## Pestañas

- **Probabilidades** — corre N simulaciones (2k a 50k) y muestra favoritos al título y
  probabilidad de cada selección de llegar a cada ronda.
- **Quiniela / Bracket** — llena el torneo partido por partido. Modo "Más probable" (ruta del
  favorito, determinista) o "Escenario aleatorio". Cada pick muestra su confianza, y se pueden
  editar a mano: tocar un partido de grupo o un equipo del cuadro re-calcula todo hacia abajo.
- **Validación** — backtest del modelo contra la fase de grupos del Mundial 2022 (RPS, Brier,
  log-loss, aciertos).
- **Ajustes y fuerza** — editar los ratings de las 48 selecciones, cargar el Elo oficial de
  eloratings.net, y ajustar el motor (ventaja de localía, Dixon-Coles).

## Estructura

```
index.html          markup + carga de módulos
src/styles.css      estilos
src/data.js         estructura del torneo + fuerzas (constantes)
src/engine.js       motor Poisson + Dixon-Coles + localía + Monte Carlo
src/quiniela.js     bracket, picks editables, confianza
src/validation.js   backtest Mundial 2022
src/ui.js           render, editor, pestañas
scripts/            utilidades (refresco de Elo, smoke test)
data/               datos crudos descargados (no versionados)
```

Detalles del modelo, decisiones de diseño y roadmap: ver `CLAUDE.md`.

## Metodología (resumen)

Goles por partido con Poisson (`lambda = 1.33 +/- dif_fuerza/170`), corrección Dixon-Coles
para marcadores bajos, y ventaja de localía para los anfitriones (México, EE.UU., Canadá). La
estructura del torneo proviene del *World Soccer — World Cup 2026 Special*; las fuerzas, de
eloratings.net. Es un marco de escenarios, no un pronóstico cerrado.

## Pruebas

```bash
node scripts/smoke_test.js
```
