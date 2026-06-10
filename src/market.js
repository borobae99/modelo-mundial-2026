/* ============================================================
   market.js — Benchmark contra el mercado de apuestas
   ------------------------------------------------------------
   Roadmap punto 1. Convierte cuotas en probabilidades implicitas
   (quita el margen del corredor) y compara al modelo contra el
   mercado de dos formas:

     1) Head-to-head PUNTUABLE sobre los 48 partidos de grupos del
        Mundial 2022 (mismos partidos que validation.js): mercado
        vs modelo vs uniforme, con RPS/Brier/log-loss/aciertos.
        Es el diagnostico clave: si el mercado le gana al modelo,
        conviene apoyarse en las cuotas.

     2) Comparacion DESCRIPTIVA del campeon 2026: probabilidad del
        modelo (Monte Carlo) vs probabilidad implicita del mercado,
        resaltando donde el modelo discrepa (guia para la quiniela).
        2026 aun no se juega: esto no es puntuable, solo divergencia.

   Depende de validation.js (rpsScore, brierScore, llScore, oVec,
   evalCfg, G22) y de engine.js (ALL_TEAMS, RHO, HFA). Render DOM
   al final; la logica (devig, evalMarket2022, devigOutright) es
   pura y se prueba en smoke_test.js. Cargar antes de ui.js.
   ============================================================ */

/* ===== Conversion de cuotas a probabilidad (de-vig) =====
   Cuota decimal d -> prob bruta 1/d. La suma de las brutas supera
   1 por el margen del corredor (overround / "vig"). Lo quitamos por
   normalizacion proporcional (metodo basico): cada bruta / suma.
   Es el de-vig estandar y suficiente para este benchmark; metodos
   mas finos (Shin, odds-ratio) corrigen el sesgo favorito-longshot
   y quedan como mejora futura. */
function impliedRaw(odds){return 1/odds;}
function overround(oddsArr){return oddsArr.reduce((a,o)=>a+1/o,0)-1;}
function devig(oddsArr){const inv=oddsArr.map(o=>1/o);const s=inv.reduce((a,b)=>a+b,0);return inv.map(v=>v/s);}

/* ============================================================
   DATOS 1 — Cuotas 1X2 de cierre, fase de grupos Mundial 2022
   ------------------------------------------------------------
   ADVERTENCIA DE PROCEDENCIA: estas cuotas son APROXIMADAS, un
   consenso de mercado transcrito a mano. NO estan verificadas
   contra un feed (oddsportal renderiza con JS y bloquea scraping;
   no hay CSV libre 1X2 de este torneo). Sirven para demostrar el
   metodo y dar un orden de magnitud, NO para sacar una conclusion
   firme de "el modelo le gana al mercado". Antes de concluir,
   reemplaza este bloque por cuotas verificadas con
   scripts/refresh_odds_2022.py (The Odds API historical).

   Formato: clave "Local|Visitante" (nombres en ingles, igual que
   G22/R22 en validation.js) -> [cuotaLocal, cuotaEmpate, cuotaVisita].
   ============================================================ */
const MARKET_2022_VERIFIED=false; // ponlo en true cuando pegues un feed real
const MARKET_2022={
  "Qatar|Ecuador":[3.40,3.10,2.20], "England|Iran":[1.30,5.50,11.0],
  "Senegal|Netherlands":[4.20,3.50,1.85], "USA|Wales":[2.45,3.10,3.20],
  "Argentina|Saudi Arabia":[1.16,7.50,17.0], "Denmark|Tunisia":[1.70,3.50,5.50],
  "Mexico|Poland":[2.30,3.10,3.50], "France|Australia":[1.28,5.75,11.0],
  "Morocco|Croatia":[4.00,3.10,2.10], "Germany|Japan":[1.40,4.75,8.50],
  "Spain|Costa Rica":[1.18,7.00,17.0], "Belgium|Canada":[1.45,4.30,7.50],
  "Switzerland|Cameroon":[1.80,3.40,4.75], "Uruguay|South Korea":[1.85,3.20,4.75],
  "Portugal|Ghana":[1.30,5.25,10.0], "Brazil|Serbia":[1.42,4.50,8.00],
  "Wales|Iran":[2.45,3.20,3.10], "Qatar|Senegal":[4.50,3.60,1.80],
  "Netherlands|Ecuador":[1.70,3.40,5.50], "England|USA":[1.60,3.70,6.00],
  "Tunisia|Australia":[2.30,3.00,3.50], "Poland|Saudi Arabia":[1.95,3.20,4.20],
  "France|Denmark":[2.00,3.40,3.80], "Argentina|Mexico":[1.70,3.30,5.50],
  "Japan|Costa Rica":[1.70,3.50,5.25], "Belgium|Morocco":[1.55,3.90,7.00],
  "Croatia|Canada":[1.65,3.70,5.50], "Spain|Germany":[2.40,3.30,3.05],
  "Cameroon|Serbia":[3.10,3.40,2.30], "South Korea|Ghana":[2.20,3.30,3.40],
  "Brazil|Switzerland":[1.55,3.80,7.00], "Portugal|Uruguay":[2.40,3.20,3.10],
  "Ecuador|Senegal":[2.70,3.10,2.80], "Netherlands|Qatar":[1.22,6.50,13.0],
  "Iran|USA":[3.40,3.20,2.25], "Wales|England":[4.00,3.40,1.95],
  "Australia|Denmark":[4.20,3.40,1.90], "Tunisia|France":[4.75,3.60,1.75],
  "Poland|Argentina":[5.50,3.80,1.62], "Saudi Arabia|Mexico":[4.50,3.40,1.83],
  "Croatia|Belgium":[3.10,3.20,2.40], "Canada|Morocco":[3.30,3.30,2.20],
  "Japan|Spain":[4.50,3.60,1.80], "Costa Rica|Germany":[9.00,5.25,1.33],
  "South Korea|Portugal":[4.50,3.60,1.80], "Ghana|Uruguay":[4.20,3.50,1.85],
  "Serbia|Switzerland":[2.60,3.40,2.75], "Cameroon|Brazil":[6.50,4.20,1.55]
};

/* ============================================================
   DATOS 2 — Cuotas de campeon Mundial 2026 (outright)
   ------------------------------------------------------------
   Fuente: BetMGM, capturado el 1 de junio de 2026. Cobertura: las
   48 selecciones. Cuotas originales en formato americano/fraccional
   (ej. +450, 14-1) convertidas a DECIMAL aqui. Clave en espanol
   (las que usa el modelo). Estas si son citables; el outright tiene
   un margen alto (~30-50%) por la cola de tapados, que el de-vig
   reparte proporcionalmente.
   ============================================================ */
const MARKET_2026_BOOK="BetMGM";
const MARKET_2026_DATE="1 jun 2026";
const MARKET_2026_OUTRIGHT={
  "Francia":5.50,"España":5.50,"Inglaterra":7.50,"Argentina":9.00,"Brasil":9.00,
  "Portugal":10.0,"Alemania":15.0,"Paises Bajos":21.0,"Noruega":26.0,"Belgica":34.0,
  "Colombia":36.0,"Marruecos":41.0,"Estados Unidos":41.0,"Japon":51.0,"Uruguay":51.0,
  "Croacia":67.0,"Ecuador":67.0,"Mexico":67.0,"Senegal":67.0,"Suecia":67.0,
  "Suiza":67.0,"Turquia":67.0,"Austria":101.0,"Canada":151.0,"Paraguay":151.0,
  "Rep. Checa":201.0,"Costa de Marfil":201.0,"Argelia":251.0,"Bosnia":251.0,"Egipto":251.0,
  "Ghana":251.0,"Corea del Sur":251.0,"Escocia":251.0,"Australia":501.0,"Iran":501.0,
  "Tunez":501.0,"RD Congo":751.0,"Cabo Verde":1001.0,"Irak":1001.0,"Jordania":1001.0,
  "Nueva Zelanda":1001.0,"Panama":1001.0,"Qatar":1001.0,"Arabia Saudi":1001.0,"Sudafrica":1001.0,
  "Uzbekistan":1001.0,"Curazao":2501.0,"Haiti":2501.0
};

/* ===== Benchmark 1: head-to-head 2022 (puntuable) ===== */
// Probabilidad de mercado [W,D,L] para un partido, ya sin margen.
function marketProbs2022(home,away){const o=MARKET_2022[home+"|"+away];return o?devig(o):null;}
// Cobertura: cuantos de los 48 partidos de G22 tienen cuota.
function market2022Coverage(){return G22.reduce((n,[h,a])=>n+(MARKET_2022[h+"|"+a]?1:0),0);}
// Puntua al mercado sobre los partidos cubiertos, con las mismas metricas que el modelo.
function evalMarket2022(){
  let sR=0,sB=0,sL=0,hit=0,n=0,vig=0;
  G22.forEach(([h,a,gh,ga])=>{
    const o=MARKET_2022[h+"|"+a];if(!o)return;
    const p=devig(o),ov=oVec(gh,ga);
    sR+=rpsScore(p,ov);sB+=brierScore(p,ov);sL+=llScore(p,ov);
    if(p.indexOf(Math.max(...p))===ov.indexOf(1))hit++;
    vig+=overround(o);n++;
  });
  return n?{rps:sR/n,brier:sB/n,logloss:sL/n,hit:hit/n,n,vig:vig/n}:null;
}
// Uniforme (sin informacion) sobre los MISMOS partidos cubiertos, para comparar justo.
function evalUniform2022(){
  let sR=0,sB=0,sL=0,n=0;const u=[1/3,1/3,1/3];
  G22.forEach(([h,a,gh,ga])=>{if(!MARKET_2022[h+"|"+a])return;const ov=oVec(gh,ga);sR+=rpsScore(u,ov);sB+=brierScore(u,ov);sL+=llScore(u,ov);n++;});
  return n?{rps:sR/n,brier:sB/n,logloss:sL/n,hit:1/3,n}:null;
}
// Modelo sobre los MISMOS partidos cubiertos (evalCfg de validation.js usa los 48; si la
// cobertura fuera parcial, recalculamos aqui para mantener la comparacion 1:1).
function evalModel2022(rho,hfa){
  let sR=0,sB=0,sL=0,hit=0,n=0;
  G22.forEach(([h,a,gh,ga])=>{
    if(!MARKET_2022[h+"|"+a])return;
    let rh=R22[h],ra=R22[a];
    if(hfa){if(HOST22.has(h)&&!HOST22.has(a))rh+=hfa;if(HOST22.has(a)&&!HOST22.has(h))ra+=hfa;}
    const[la,lb]=vLambdas(rh,ra);const p=matchProbs(la,lb,rho),ov=oVec(gh,ga);
    sR+=rpsScore(p,ov);sB+=brierScore(p,ov);sL+=llScore(p,ov);
    if(p.indexOf(Math.max(...p))===ov.indexOf(1))hit++;n++;
  });
  return n?{rps:sR/n,brier:sB/n,logloss:sL/n,hit:hit/n,n}:null;
}

/* ===== Benchmark 2: campeon 2026 (descriptivo) ===== */
// Reparte el margen del outright: cada 1/cuota / suma de 1/cuota.
function devigOutright(odds){const ts=Object.keys(odds);const inv=ts.map(t=>1/odds[t]);const s=inv.reduce((a,b)=>a+b,0);const out={};ts.forEach((t,i)=>out[t]=inv[i]/s);return out;}
function outright2026Vig(){return Object.values(MARKET_2026_OUTRIGHT).reduce((a,o)=>a+1/o,0)-1;}

/* ===== Ensamble modelo + mercado (roadmap punto 6) =====
   Mezcla lineal (linear pool): p = w*modelo + (1-w)*mercado, con w el peso del
   MODELO. Como es combinacion convexa de dos distribuciones, la mezcla ya suma 1.
   Idea: el mercado de cierre suele ganar, pero el modelo aporta algo de senal
   independiente; promediarlos reduce el error. El peso se calibra sobre los 48
   partidos de 2022 (lo unico puntuable) y se reporta tambien con leave-one-out,
   que es el numero honesto porque w se ajusta en la misma muestra. */
let ENSEMBLE_W=0.5; // peso del modelo (0 = solo mercado, 1 = solo modelo)
function blend(pm,pk,w){return pm.map((v,i)=>w*v+(1-w)*pk[i]);}

// Filas {pm,pk,ov}: prob. del modelo, del mercado y resultado real, por partido con cuota.
function ensembleRows2022(rho,hfa){
  const rows=[];
  G22.forEach(([h,a,gh,ga])=>{
    const o=MARKET_2022[h+"|"+a];if(!o)return;
    let rh=R22[h],ra=R22[a];
    if(hfa){if(HOST22.has(h)&&!HOST22.has(a))rh+=hfa;if(HOST22.has(a)&&!HOST22.has(h))ra+=hfa;}
    const[la,lb]=vLambdas(rh,ra);
    rows.push({pm:matchProbs(la,lb,rho),pk:devig(o),ov:oVec(gh,ga)});
  });
  return rows;
}
// RPS medio del ensamble al peso w (skip = indice a excluir, -1 para usar todos).
function meanRpsEns(rows,w,skip){let s=0,n=0;for(let i=0;i<rows.length;i++){if(i===skip)continue;s+=rpsScore(blend(rows[i].pm,rows[i].pk,w),rows[i].ov);n++;}return n?s/n:Infinity;}
// Peso optimo in-sample (grid 0..1 paso 0.01) que minimiza el RPS del ensamble.
function calibrateW(rows){let bw=0,br=Infinity;for(let i=0;i<=100;i++){const w=i/100,r=meanRpsEns(rows,w,-1);if(r<br){br=r;bw=w;}}return{w:bw,rps:br};}
// Metricas del ensamble a un peso dado.
function evalEnsemble(rows,w){let sR=0,sB=0,sL=0,hit=0;rows.forEach(r=>{const p=blend(r.pm,r.pk,w);sR+=rpsScore(p,r.ov);sB+=brierScore(p,r.ov);sL+=llScore(p,r.ov);if(p.indexOf(Math.max(...p))===r.ov.indexOf(1))hit++;});const n=rows.length;return n?{rps:sR/n,brier:sB/n,logloss:sL/n,hit:hit/n,n,w}:null;}
// RPS honesto leave-one-out: cada partido se puntua con el w optimo de los otros 47.
function looEnsembleRps(rows){let s=0;for(let i=0;i<rows.length;i++){let bw=0,br=Infinity;for(let k=0;k<=100;k++){const w=k/100,r=meanRpsEns(rows,w,i);if(r<br){br=r;bw=w;}}s+=rpsScore(blend(rows[i].pm,rows[i].pk,bw),rows[i].ov);}return rows.length?s/rows.length:null;}

/* ============================================================
   RENDER (DOM) — requiere los contenedores de index.html
   ============================================================ */

// Pestana Validacion: tabla uniforme vs modelo vs mercado vs ensamble sobre 2022.
function renderMarketBenchmark(){
  const tb=document.getElementById('mktbbody');if(!tb)return;
  const m=evalMarket2022(),uni=evalUniform2022(),mod=evalModel2022(RHO,HFA);
  if(!m||!mod){tb.innerHTML='<tr><td class="lab">Sin cuotas cargadas</td><td colspan="4" class="mono">—</td></tr>';return;}
  const erows=ensembleRows2022(RHO,HFA);
  const cal=calibrateW(erows);                 // peso optimo in-sample
  const ens=evalEnsemble(erows,ENSEMBLE_W);    // ensamble al peso actual del usuario
  const loo=looEnsembleRps(erows);             // RPS honesto fuera de muestra
  const rows=[["Sin informacion (uniforme)",uni,''],["Modelo (DC + localia)",mod,''],
              ["Mercado (cuotas de cierre)",m,MARKET_2022_VERIFIED?'':' <span class="cf lo" title="Cuotas aproximadas, sin verificar">aprox.</span>'],
              ["Ensamble ("+Math.round(ENSEMBLE_W*100)+"% modelo)",ens,' <span class="cf hi" title="Mezcla modelo+mercado">mezcla</span>']];
  const bestRps=Math.min(...rows.map(r=>r[1].rps));
  tb.innerHTML='';
  rows.forEach(([lab,o,note])=>{
    const tr=document.createElement('tr');if(Math.abs(o.rps-bestRps)<1e-9)tr.className='best';
    tr.innerHTML=`<td class="lab">${lab}${note}</td><td class="mono">${o.rps.toFixed(4)}</td><td class="mono">${o.brier.toFixed(4)}</td><td class="mono">${o.logloss.toFixed(4)}</td><td class="mono">${(o.hit*100).toFixed(0)}%</td>`;
    tb.appendChild(tr);
  });
  const beatsBoth=ens.rps<m.rps&&ens.rps<mod.rps;
  const mktBeatsModel=m.rps<mod.rps;
  const read=document.getElementById('mktbread');
  if(read)read.innerHTML=`<b>Lectura.</b> Sobre estos ${m.n} partidos, el <b>${mktBeatsModel?'mercado le gana al modelo':'modelo le gana al mercado'}</b> en RPS (${m.rps.toFixed(4)} vs ${mod.rps.toFixed(4)}). El <b>ensamble</b> al peso actual (w=${ENSEMBLE_W.toFixed(2)}, peso del modelo) da RPS <b>${ens.rps.toFixed(4)}</b> y ${beatsBoth?'<b>le gana a los dos componentes</b>':'no mejora al mejor componente'}. El peso óptimo sobre esta muestra es <b>w*=${cal.w.toFixed(2)}</b> (RPS ${cal.rps.toFixed(4)}), pero <b>solo se calibra con 2022</b> (el único torneo con cuotas) — preliminar: calibrar sobre una sola muestra, y la más atípica, no es confiable. <b>El número honesto es el leave-one-out: RPS ${loo!=null?loo.toFixed(4):'—'}</b> (cada partido puntuado con el w óptimo de los otros 47); el óptimo in-sample siempre se ve mejor de lo que generaliza. Con w bajo el ensamble es casi el mercado; el modelo aporta poco aquí porque es el componente débil — el ensamble luce más cuando los dos están parejos o hay más muestra (roadmap 2). ${MARKET_2022_VERIFIED?'':'<b>Aviso:</b> las cuotas 2022 son aproximadas (sin verificar) — refréscalas con scripts/refresh_odds_2022.py antes de concluir.'}`;
}

// Pestana Probabilidades: tabla campeon modelo vs mercado vs ensamble 2026 (al correr el modelo).
// El ensamble (w*modelo + (1-w)*mercado, ambos suman 1 -> la mezcla tambien) es la mejor
// estimacion de produccion; la tabla se ordena por el. La columna Dif. = modelo - mercado
// senala donde el modelo discrepa (oportunidad para apartar la quiniela de la linea).
function renderMarketCompare(stat,N){
  const tb=document.getElementById('mktbody');if(!tb)return;
  const real=(typeof ODDS_2026_OUTRIGHT!=='undefined');
  const mkt=real?ODDS_2026_OUTRIGHT:devigOutright(MARKET_2026_OUTRIGHT),w=ENSEMBLE_W;
  const book=document.getElementById('mktbook');
  if(book)book.textContent=(real?('The Odds API · '+ODDS_2026_META.captured+' · '+ODDS_2026_META.books_winner+' casas'):(MARKET_2026_BOOK+' · '+MARKET_2026_DATE))+' · ens. '+Math.round(w*100)+'% modelo';
  const rows=ALL_TEAMS.map(t=>{const model=stat[t].champ/N,market=mkt[t]||0;return{t,model,market,ens:w*model+(1-w)*market};}).sort((a,b)=>b.ens-a.ens);
  tb.innerHTML='';
  rows.forEach(r=>{
    const diff=(r.model-r.market)*100; // puntos porcentuales
    const tr=document.createElement('tr');
    const host=HOSTS.has(r.t)?' <span class="hostdot">HOST</span>':'';
    const sign=diff>0?'+':'';
    const pf=v=>(v*100)<0.05?'·':(v*100).toFixed(1);
    tr.innerHTML=`<td class="team"><span class="gtag" style="background:${GROUP_COLORS[teamGroup[r.t]]}">${teamGroup[r.t]}</span>${r.t}${host}</td><td class="mono">${pf(r.model)}</td><td class="mono">${pf(r.market)}</td><td class="mono" style="color:var(--accent);font-weight:600">${pf(r.ens)}</td><td class="mono" style="color:${diff>0?'var(--green)':diff<0?'var(--red)':'var(--mut)'}">${Math.abs(diff)<0.05?'·':sign+diff.toFixed(1)}</td>`;
    tb.appendChild(tr);
  });
  const vg=document.getElementById('mktvig');if(vg)vg.textContent=(real?ODDS_2026_META.vig_winner*100:outright2026Vig()*100).toFixed(0)+'%';
}
