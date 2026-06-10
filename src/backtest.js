/* ============================================================
   backtest.js — Backtest multi-torneo con banda de incertidumbre
   ------------------------------------------------------------
   Roadmap punto 2. Puntúa el motor sobre las fases de grupos de
   10 torneos (Mundiales 2014/18/22, Euros 2016/20/24, Copas
   América 2016/19/21/24) usando fuerzas Elo pre-torneo calculadas
   del histórico (ver scripts/build_backtest.py -> backtest_data.js).

   La gracia frente a validation.js (un solo torneo): reporta el RPS
   por torneo Y un RPS agrupado con BANDA DE INCERTIDUMBRE (IC 90%
   por bootstrap). Una fase de grupos es ruido; 10 torneos y una
   banda dicen si el skill es real o suerte de muestra.

   Depende de validation.js (vLambdas, matchProbs, rpsScore, oVec),
   de engine.js (RHO, HFA) y de backtest_data.js (BACKTEST). Cargar
   después de ambos y antes de ui.js. Render DOM al final; la lógica
   (evalBacktest, bootstrapRpsCI) es pura y se prueba en smoke_test.
   ============================================================ */

// Lambdas [local, visita] de cada motor para un partido del backtest. La localía solo muerde
// en partidos NO neutrales (el anfitrión en cancha propia).
function btLambdasElo(rh,ra,neutral,hfaOn){let h=rh;if(hfaOn&&!neutral)h+=HFA;return vLambdas(h,ra);}
function btLambdasAD(eid,home,away,neutral,hfaOn){
  const E=(typeof BACKTEST_AD!=='undefined')?BACKTEST_AD[eid]:null;if(!E)return null;
  const ra=E.r[home],rb=E.r[away];if(!ra||!rb)return null;
  let la=E.g*ra.a*rb.d,lb=E.g*rb.a*ra.d;if(hfaOn&&!neutral)la*=E.h;
  return[la,lb];
}
// Log-loss del MARCADOR EXACTO: -log P(golesL, golesV) con la rejilla Dixon-Coles. Es la
// métrica que premia acertar el cuánto-cuánto (lo que importa para la quiniela), no solo el 1X2.
function scoreLL(la,lb,gh,ga){
  const M=jointGrid(clampL(la),clampL(lb),RHO);
  const x=Math.min(gh,MAXG),y=Math.min(ga,MAXG);
  return -Math.log(Math.max(1e-9,M[x][y]));
}

// Puntúa todos los torneos con AMBOS motores (Elo y ataque/defensa) sobre los mismos partidos,
// en DOS métricas: RPS (resultado 1X2) y log-loss de marcador. Devuelve series por partido para
// los bootstraps.
function evalBacktest(rho,hfaOn){
  const perTour=[],eloR=[],adR=[],eloS=[],adS=[];let pHitElo=0,pHitAd=0;
  BACKTEST.forEach(tour=>{
    let n=0,sEr=0,sAr=0,sEs=0,sAs=0,sU=0,hE=0,hA=0;
    tour.matches.forEach(([h,a,gh,ga,rh,ra,neutral])=>{
      const o=oVec(gh,ga);
      const lE=btLambdasElo(rh,ra,neutral,hfaOn);
      const lA=btLambdasAD(tour.id,h,a,neutral,hfaOn)||lE; // cae a Elo si falta el equipo
      const pE=matchProbs(clampL(lE[0]),clampL(lE[1]),rho),pA=matchProbs(clampL(lA[0]),clampL(lA[1]),rho);
      const rE=rpsScore(pE,o),rA=rpsScore(pA,o),scE=scoreLL(lE[0],lE[1],gh,ga),scA=scoreLL(lA[0],lA[1],gh,ga);
      sEr+=rE;sAr+=rA;sEs+=scE;sAs+=scA;sU+=rpsScore([1/3,1/3,1/3],o);
      if(pE.indexOf(Math.max(...pE))===o.indexOf(1))hE++;
      if(pA.indexOf(Math.max(...pA))===o.indexOf(1))hA++;
      eloR.push(rE);adR.push(rA);eloS.push(scE);adS.push(scA);n++;
    });
    perTour.push({id:tour.id,label:tour.label,n,elo:sEr/n,ad:sAr/n,uni:sU/n,eloS:sEs/n,adS:sAs/n,hitElo:hE/n,hitAd:hA/n});
    pHitElo+=hE;pHitAd+=hA;
  });
  const sum=arr=>arr.reduce((a,b)=>a+b,0),N=eloR.length;
  const pooled={n:N,elo:sum(eloR)/N,ad:sum(adR)/N,uni:sum(perTour.map(t=>t.uni*t.n))/N,
                eloS:sum(eloS)/N,adS:sum(adS)/N,hitElo:pHitElo/N,hitAd:pHitAd/N};
  return{perTour,pooled,eloR,adR,eloS,adS};
}

// IC por bootstrap de la media de un vector (remuestreo con reemplazo).
function bootstrapCI(vals,B,loQ,hiQ){
  const n=vals.length;if(!n)return null;
  const means=[];
  for(let b=0;b<B;b++){let s=0;for(let i=0;i<n;i++)s+=vals[(Math.random()*n)|0];means.push(s/n);}
  means.sort((x,y)=>x-y);
  const q=p=>means[Math.min(means.length-1,Math.max(0,Math.floor(p*means.length)))];
  return{lo:q(loQ),hi:q(hiQ),mean:means.reduce((a,c)=>a+c,0)/means.length};
}
// IC del bootstrap PAREADO de la diferencia ad-elo por partido (mismas muestras): si todo el
// intervalo queda < 0, ataque/defensa mejora de forma significativa.
function bootstrapPairedCI(adM,eloM,B,loQ,hiQ){
  const n=adM.length;if(!n)return null;const diff=adM.map((v,i)=>v-eloM[i]);
  return bootstrapCI(diff,B,loQ,hiQ);
}

// Chequeo con xG (StatsBomb): ¿el λ esperado del modelo se acerca más al xG OBSERVADO que a los
// goles reales? Si sí, el "error" del modelo es sobre todo varianza de finalización (ruido), no
// del modelo — y calibrar sobre xG (en vez de goles) es la mejora con más potencial. MAE en goles
// por observación-equipo (2 por partido), sobre los partidos con xG disponible.
function xgCheck(rho,hfaOn){
  if(typeof XG_DATA==='undefined')return null;
  let n=0,eG=0,eX=0,aG=0,aX=0,gx=0,nm=0;
  BACKTEST.forEach(tour=>{
    const X=XG_DATA[tour.id];if(!X)return;
    tour.matches.forEach(([h,a,gh,ga,rh,ra,neutral])=>{
      const xo=X.m[[h,a].slice().sort().join('|')];if(!xo)return;
      const xh=xo[h],xa=xo[a];if(xh==null||xa==null)return;
      const lE=btLambdasElo(rh,ra,neutral,hfaOn),lA=btLambdasAD(tour.id,h,a,neutral,hfaOn)||lE;
      const e0=clampL(lE[0]),e1=clampL(lE[1]),a0=clampL(lA[0]),a1=clampL(lA[1]);
      eG+=Math.abs(e0-gh)+Math.abs(e1-ga);eX+=Math.abs(e0-xh)+Math.abs(e1-xa);
      aG+=Math.abs(a0-gh)+Math.abs(a1-ga);aX+=Math.abs(a0-xh)+Math.abs(a1-xa);
      gx+=Math.abs(gh-xh)+Math.abs(ga-xa);n+=2;nm++;
    });
  });
  if(!n)return null;
  return{nm,eloVsGoals:eG/n,eloVsXg:eX/n,adVsGoals:aG/n,adVsXg:aX/n,goalsVsXg:gx/nm};
}

/* ===== Render (DOM) — requiere los contenedores de index.html ===== */
function renderBacktest(){
  const tb=document.getElementById('btbody');if(!tb||typeof BACKTEST==='undefined')return;
  const hfaOn=HFA>0;
  const res=evalBacktest(RHO,hfaOn);
  const ciElo=bootstrapCI(res.eloR,4000,0.05,0.95);
  const ciAd=bootstrapCI(res.adR,4000,0.05,0.95);
  const ciD=bootstrapPairedCI(res.adR,res.eloR,4000,0.05,0.95);
  const ciS=bootstrapPairedCI(res.adS,res.eloS,4000,0.05,0.95); // marcador: ad - elo
  tb.innerHTML='';
  res.perTour.forEach(t=>{
    const d=(t.ad-t.elo)/t.elo*100; // negativo = ataque/defensa mejor
    const tr=document.createElement('tr');
    tr.innerHTML=`<td class="lab">${t.label}</td><td class="mono">${t.n}</td><td class="mono">${t.elo.toFixed(4)}</td><td class="mono">${t.ad.toFixed(4)}</td><td class="mono" style="color:${d<0?'var(--green)':d>0?'var(--red)':'var(--mut)'}">${d>0?'+':''}${d.toFixed(1)}%</td><td class="mono">${(t.hitAd*100).toFixed(0)}%</td>`;
    tb.appendChild(tr);
  });
  const p=res.pooled,dP=(p.ad-p.elo)/p.elo*100,tr=document.createElement('tr');tr.className='best';
  tr.innerHTML=`<td class="lab">Todos (agrupado)</td><td class="mono">${p.n}</td><td class="mono">${p.elo.toFixed(4)}</td><td class="mono">${p.ad.toFixed(4)}</td><td class="mono">${dP>0?'+':''}${dP.toFixed(1)}%</td><td class="mono">${(p.hitAd*100).toFixed(0)}%</td>`;
  tb.appendChild(tr);
  const dS=(p.adS-p.eloS)/p.eloS*100,scoreBeats=p.adS<p.eloS,scoreSig=ciS.hi<0;
  const read=document.getElementById('btread');
  if(read)read.innerHTML=`<b>Lectura — dos preguntas distintas.</b><br>
  <b>1) ¿Quién gana? (RPS, resultado 1X2)</b> sobre <b>${p.n} partidos de ${res.perTour.length} torneos</b> (uniforme ${p.uni.toFixed(4)}): Elo <b>${p.elo.toFixed(4)}</b> [${ciElo.lo.toFixed(4)}, ${ciElo.hi.toFixed(4)}], Ataque/Defensa <b>${p.ad.toFixed(4)}</b> [${ciAd.lo.toFixed(4)}, ${ciAd.hi.toFixed(4)}]; diferencia ${dP>0?'+':''}${dP.toFixed(1)}% (IC pareado [${ciD.lo.toFixed(4)}, ${ciD.hi.toFixed(4)}]). ${p.ad<p.elo?(ciD.hi<0?'A/D gana, significativo.':'A/D va por delante pero no es concluyente.'):'<b>Empatan / el Elo aguanta</b>: una sola fuerza ya captura casi toda la señal de quién gana.'}<br>
  <b>2) ¿Qué marcador? (log-loss del resultado exacto, lo que importa para la quiniela)</b>: Elo <b>${p.eloS.toFixed(4)}</b>, Ataque/Defensa <b>${p.adS.toFixed(4)}</b> → <b>${dS>0?'+':''}${dS.toFixed(1)}%</b> (IC pareado [${ciS.lo.toFixed(4)}, ${ciS.hi.toFixed(4)}]). ${scoreBeats?(scoreSig?'<b>Aquí Ataque/Defensa sí le gana al Elo, de forma significativa</b> (todo el intervalo &lt; 0): separar cuánto marca de cuánto encaja predice mejor los marcadores. Es el caso de uso del modo A/D para la quiniela.':'Ataque/Defensa va por delante en marcadores, aunque el intervalo cruza el 0.'):'En esta muestra el Elo también aguanta en marcadores.'}<br>
  <span style="color:var(--mut)">${hfaOn?'Localía activa.':'Localía desactivada.'} Ambos con Dixon-Coles ρ=${RHO.toFixed(2)}; fuerzas calculadas del histórico y congeladas pre-torneo. El RPS solo mide el 1X2; por eso la fila "Δ A/D" de la tabla puede no mejorar aunque el marcador sí.</span>`;
  renderXgCheck();
}

// Chequeo con xG en la pestaña Validación (debajo del backtest).
function renderXgCheck(){
  const el=document.getElementById('xgread');if(!el)return;
  const x=xgCheck(RHO,HFA>0);
  if(!x){el.innerHTML='<b>Chequeo con xG.</b> Genera src/xg_data.js con scripts/build_xg.py para activarlo.';return;}
  const better=x.eloVsXg<x.eloVsGoals;
  el.innerHTML=`<b>Chequeo con xG (StatsBomb, ${x.nm} partidos de Mundial 2018/22 y Euro 2020/24).</b> El λ esperado del modelo (Elo) se acerca ${better?'<b>más al xG observado</b>':'más a los goles'} (MAE ${x.eloVsXg.toFixed(3)}) que a los goles reales (MAE ${x.eloVsGoals.toFixed(3)}). ${better?'O sea: el modelo predice bien el <b>proceso</b> (cuántas ocasiones se generan); buena parte de su "error" es <b>varianza de finalización</b> —goles que entran o no por azar—, no fallo del modelo.':''} El desajuste medio <b>|goles − xG| es ${x.goalsVsXg.toFixed(2)} goles por partido</b>: ese ruido es lo que el xG limpia. Es coherente con que calibrar sobre goles (ataque/defensa) no superara al Elo, y apunta a que <b>calibrar sobre xG es la mejora con más potencial</b> — hoy bloqueada por datos: StatsBomb solo cubre torneos (no eliminatorias), FBref está protegido por Cloudflare, y el periodo de calibración necesitaría un feed de pago. Esto ilustra el valor del xG; no recalibra 2026.`;
}
