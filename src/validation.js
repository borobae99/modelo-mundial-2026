/* ============================================================
   validation.js — Arnés de backtest (skill del modelo)
   ------------------------------------------------------------
   Aplica el motor a los 48 partidos de la fase de grupos del
   Mundial 2022 usando fuerzas pre-torneo, y los puntúa con RPS,
   Brier, log-loss y % de aciertos vs una línea base uniforme.
   Compara: Poisson simple / +Dixon-Coles / +DC+localía.

   LIMITACIÓN: una sola fase de grupos (y de las más atípicas).
   El siguiente paso de rigor es ampliar a 2014/2018/Euros/Copa
   América con el dataset histórico (ver CLAUDE.md, roadmap).
   Datos de resultados verificados; fuerzas pre-torneo son
   estimaciones tipo Elo de eloratings.net (nov. 2022).
   ============================================================ */

/* ===== VALIDACION: backtest Mundial 2022 (fase de grupos) ===== */
const R22={"Brazil":2169,"Argentina":2141,"Spain":2048,"Netherlands":2040,"France":2005,"Portugal":2003,"Belgium":1989,"Denmark":1971,"Germany":1965,"Croatia":1912,"England":1920,"Switzerland":1902,"Uruguay":1935,"Mexico":1813,"USA":1798,"Senegal":1763,"Iran":1797,"Japan":1815,"Serbia":1808,"Morocco":1810,"Poland":1755,"South Korea":1748,"Ecuador":1765,"Wales":1790,"Australia":1719,"Tunisia":1687,"Costa Rica":1650,"Cameroon":1700,"Canada":1690,"Ghana":1632,"Saudi Arabia":1638,"Qatar":1680};
const HOST22=new Set(["Qatar"]);
const G22=[["Qatar","Ecuador",0,2],["England","Iran",6,2],["Senegal","Netherlands",0,2],["USA","Wales",1,1],["Argentina","Saudi Arabia",1,2],["Denmark","Tunisia",0,0],["Mexico","Poland",0,0],["France","Australia",4,1],["Morocco","Croatia",0,0],["Germany","Japan",1,2],["Spain","Costa Rica",7,0],["Belgium","Canada",1,0],["Switzerland","Cameroon",1,0],["Uruguay","South Korea",0,0],["Portugal","Ghana",3,2],["Brazil","Serbia",2,0],["Wales","Iran",0,2],["Qatar","Senegal",1,3],["Netherlands","Ecuador",1,1],["England","USA",0,0],["Tunisia","Australia",0,1],["Poland","Saudi Arabia",2,0],["France","Denmark",2,1],["Argentina","Mexico",2,0],["Japan","Costa Rica",0,1],["Belgium","Morocco",0,2],["Croatia","Canada",4,1],["Spain","Germany",1,1],["Cameroon","Serbia",3,3],["South Korea","Ghana",2,3],["Brazil","Switzerland",1,0],["Portugal","Uruguay",2,0],["Ecuador","Senegal",1,2],["Netherlands","Qatar",2,0],["Iran","USA",0,1],["Wales","England",0,3],["Australia","Denmark",1,0],["Tunisia","France",1,0],["Poland","Argentina",0,2],["Saudi Arabia","Mexico",1,2],["Croatia","Belgium",0,0],["Canada","Morocco",1,2],["Japan","Spain",2,1],["Costa Rica","Germany",2,4],["South Korea","Portugal",2,1],["Ghana","Uruguay",0,2],["Serbia","Switzerland",2,3],["Cameroon","Brazil",1,0]];
function vLambdas(ra,rb){const sup=(ra-rb)/DIV;return[clampL(BASE+sup/2),clampL(BASE-sup/2)];}
function matchProbs(la,lb,rho){const M=jointGrid(la,lb,rho);let w=0,d=0,l=0;for(let x=0;x<=MAXG;x++)for(let y=0;y<=MAXG;y++){if(x>y)w+=M[x][y];else if(x===y)d+=M[x][y];else l+=M[x][y];}return[w,d,l];}
function oVec(gh,ga){return gh>ga?[1,0,0]:gh===ga?[0,1,0]:[0,0,1];}
function rpsScore(p,o){let c1=0,c2=0,s=0;for(let i=0;i<2;i++){c1+=p[i];c2+=o[i];s+=(c1-c2)**2;}return s/2;}
function brierScore(p,o){let s=0;for(let i=0;i<3;i++)s+=(p[i]-o[i])**2;return s;}
function llScore(p,o){const i=o.indexOf(1);return -Math.log(Math.max(1e-9,p[i]));}
function evalCfg(rho,hfa){let sR=0,sB=0,sL=0,hit=0;G22.forEach(([h,a,gh,ga])=>{let rh=R22[h],ra=R22[a];if(hfa){if(HOST22.has(h)&&!HOST22.has(a))rh+=hfa;if(HOST22.has(a)&&!HOST22.has(h))ra+=hfa;}const[la,lb]=vLambdas(rh,ra);const p=matchProbs(la,lb,rho);const o=oVec(gh,ga);sR+=rpsScore(p,o);sB+=brierScore(p,o);sL+=llScore(p,o);const pred=p.indexOf(Math.max(...p));if(pred===o.indexOf(1))hit++;});const n=G22.length;return{rps:sR/n,brier:sB/n,logloss:sL/n,hit:hit/n};}
function runValidation(){
  document.getElementById('vhfa').textContent='+'+HFA;
  document.getElementById('vrho').textContent=(RHO<0?'−':'')+Math.abs(RHO).toFixed(2);
  const uni={rps:G22.reduce((s,[h,a,gh,ga])=>s+rpsScore([1/3,1/3,1/3],oVec(gh,ga)),0)/G22.length,brier:G22.reduce((s,[h,a,gh,ga])=>s+brierScore([1/3,1/3,1/3],oVec(gh,ga)),0)/G22.length,logloss:Math.log(3),hit:1/3};
  const base=evalCfg(0,0);
  const dc=evalCfg(RHO,0);
  const full=evalCfg(RHO,HFA);
  const rows=[["Sin información (uniforme)",uni],["Poisson simple",base],["+ Dixon-Coles",dc],["+ Dixon-Coles + localía",full]];
  const bestRps=Math.min(...rows.map(r=>r[1].rps));
  const tb=document.getElementById('vbody');tb.innerHTML='';
  rows.forEach(([lab,o])=>{const tr=document.createElement('tr');if(Math.abs(o.rps-bestRps)<1e-9)tr.className='best';tr.innerHTML=`<td class="lab">${lab}</td><td class="mono">${o.rps.toFixed(4)}</td><td class="mono">${o.brier.toFixed(4)}</td><td class="mono">${o.logloss.toFixed(4)}</td><td class="mono">${(o.hit*100).toFixed(0)}%</td>`;tb.appendChild(tr);});
  const impUni=((1-base.rps/uni.rps)*100).toFixed(1);
  const impDc=((1-dc.rps/base.rps)*100);
  const hfaSign=full.rps<dc.rps;
  document.getElementById('vread').innerHTML=`<b>Lectura.</b> El modelo tiene <b>skill real pero modesto</b>: acierta el resultado del ${(base.hit*100).toFixed(0)}% de los partidos frente al 33% de un volado, y su RPS mejora un <b>${impUni}%</b> sobre no tener información. <b>Dixon-Coles</b> ${impDc>0.5?`aporta una mejora pequeña (${impDc.toFixed(1)}% de RPS)`:`apenas mueve la aguja en esta muestra (${impDc.toFixed(2)}%)`}: su valor es teórico y se nota más en marcadores que en el resultado. <b>La localía ${hfaSign?'ayuda':'perjudica'} aquí</b> porque el anfitrión de 2022, Qatar, era débil y perdió sus tres partidos —darle bono empeora el pronóstico—. No se puede validar la localía con un host flojo; está justificada por la literatura (~+0.3 gol en casa) y es relevante para 2026, donde los anfitriones son de nivel medio. Sube y baja el "bono anfitrión" en Ajustes y observa cómo cambia esta tabla: es el modelo midiéndose a sí mismo.`;
}
