/* ============================================================
   smoke_test.js — Prueba de humo sin navegador
   ------------------------------------------------------------
   Carga los módulos de src/ con un DOM falso mínimo y verifica
   que la lógica central funciona: Monte Carlo conserva la masa
   (suma de campeón = N), la quiniela arma un cuadro completo, y
   el backtest produce métricas. Correr tras cualquier cambio:

       node scripts/smoke_test.js

   Sale con código 0 si todo pasa, 1 si algo falla.
   ============================================================ */
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "src");
const noop = () => {};
function mkEl() {
  return {
    addEventListener: noop,
    classList: { toggle: noop, remove: noop, add: noop, contains: () => false },
    style: {}, textContent: "", innerHTML: "", value: "10000",
    dataset: {}, appendChild: noop, closest: () => null,
    querySelectorAll: () => [],
  };
}
global.document = { getElementById: () => mkEl(), querySelectorAll: () => [], createElement: () => mkEl() };
global.window = { scrollTo: noop };

// cargar en orden de dependencia (igual que index.html)
let combined = "";
for (const f of ["data.js", "engine.js", "quiniela.js", "validation.js", "ui.js"]) {
  combined += fs.readFileSync(path.join(SRC, f), "utf8") + "\n";
}

const checks = [];
function check(name, cond) {
  checks.push([name, !!cond]);
  console.log((cond ? "  OK  " : " FAIL ") + name);
}

combined += `
;(function(){
  globalThis.__results = {};
  // 1) cobertura de datos
  __results.teams = ALL_TEAMS.length;
  __results.elo = Object.keys(ELO_OFFICIAL).length;
  __results.eloVerified = ELO_VERIFIED.size;
  // 2) Monte Carlo conserva la masa
  const N = 5000;
  const stat = {}; ALL_TEAMS.forEach(t => stat[t] = {adv:0,r16:0,qf:0,sf:0,fin:0,champ:0});
  for (let i=0;i<N;i++) runOne(stat);
  let tot=0; ALL_TEAMS.forEach(t => tot += stat[t].champ);
  __results.mcSum = tot; __results.mcN = N;
  __results.favorite = ALL_TEAMS.map(t=>({t,c:stat[t].champ})).sort((a,b)=>b.c-a.c)[0].t;
  // 3) quiniela arma cuadro completo en ambos modos
  qMode='likely';  const bl = buildBracket();
  qMode='random';  const br = buildBracket();
  __results.likelyChamp = bl.champ;
  __results.randomChamp = br.champ;
  __results.groupMatches = Object.values(bl.groups).reduce((s,g)=>s+g.matches.length,0);
  __results.koTies = bl.ro32.length + bl.ro16.length + bl.qf.length + bl.sf.length + 1;
  __results.firstConf = bl.groups['A'].matches[0].conf;
  // 4) overrides re-fluyen
  qMode='likely'; overrides={'ko:final:0':'b'}; const bo = buildBracket();
  __results.overrideForced = bo.final.forced;
  overrides={};
  // 5) backtest produce metricas
  const v = evalCfg(0,0);
  __results.rps = v.rps; __results.hit = v.hit;
})();
`;

eval(combined);
const r = globalThis.__results;

console.log("\n--- Resultados ---");
check("48 selecciones en datos", r.teams === 48);
check("Elo oficial cubre 48", r.elo === 48);
check("Elo: 48 verificadas", r.eloVerified === 48);
check("Monte Carlo conserva la masa (suma campeon = N)", r.mcSum === r.mcN);
check("Quiniela 'likely' produce campeon", typeof r.likelyChamp === "string" && r.likelyChamp.length > 0);
check("Quiniela 'random' produce campeon", typeof r.randomChamp === "string" && r.randomChamp.length > 0);
check("72 partidos de grupos", r.groupMatches === 72);
check("32 llaves eliminatorias (16+8+4+2+final)", r.koTies === 31);
check("Confianza por pick es numero valido", r.firstConf > 0 && r.firstConf <= 1);
check("Override fuerza el resultado", r.overrideForced === true);
check("Backtest RPS en rango razonable", r.rps > 0.1 && r.rps < 0.35);
check("Backtest aciertos > volado (33%)", r.hit > 0.33);

console.log("\nFavorito Monte Carlo:", r.favorite, "| RPS:", r.rps.toFixed(4), "| aciertos:", Math.round(r.hit*100)+"%");

const failed = checks.filter(c => !c[1]).length;
if (failed === 0) {
  console.log("\nTODAS LAS PRUEBAS PASARON (" + checks.length + ")");
  process.exit(0);
} else {
  console.log("\n" + failed + " PRUEBA(S) FALLARON");
  process.exit(1);
}
