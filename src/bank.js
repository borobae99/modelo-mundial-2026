/* ============================================================
   bank.js — Banca: reto escalera y plan Kelly fraccionado
   ------------------------------------------------------------
   Dos formas de buscar profit con un monto especifico, con la
   matematica enfrente (no promesas):

   RETO ESCALERA: la banca completa va al escalon 1; si gana, todo
   al 2, y asi N veces. Fechas estrictamente crecientes (hay que
   liquidar antes del siguiente). Banca final = B0 * prod(cuotas);
   prob. de completar = prod(prob. del ensamble) — cae multiplica-
   tivamente. La tabla muestra el EV de PARAR en cada escalon: con
   legs de valor el EV sube mientras pe*cuota>1, pero la varianza
   explota; parar tambien es estrategia. Cada apuesta es individual
   y secuencial, asi que SI aplica line shopping (mejor cuota por
   escalon). Sin goleadores: jugarse toda la banca a una alineacion
   no es aceptable.

   PLAN KELLY: apuestas INDIVIDUALES (no combinadas) sobre los
   picks con valor a cuota mediana (>=2% de edge). Stake por
   criterio de Kelly f* = (pe*o-1)/(o-1) a la mejor cuota, con
   fraccion (1/4 por defecto) y tope del 5% de la banca por pick:
   pe es una estimacion del ensamble, no la verdad — sobre-apostar
   un edge ilusorio quiebra mas rapido que no apostar. El Kelly
   simultaneo exacto no es aditivo; fraccion + tope es la
   aproximacion practica. Monte Carlo (Bernoulli independientes)
   para la distribucion del P&L.

   Depende de parlay.js (parlayPool, legPe, legVal, legResult,
   helpers de formato) y de los datos que este ya usa. Los retos y
   planes guardados viajan en el MISMO export/import JSON de la
   pestaña Parleys. Logica pura arriba (smoke_test), DOM abajo.
   ============================================================ */

let bankLadders=[]; // retos guardados (memoria de sesion)
let bankPlans=[];   // planes Kelly guardados
let lProfileVal='medio';

/* ===== reto escalera ===== */
// Banda de cuota (mediana) por escalon segun perfil: el conservador escala despacio con
// favoritos; el agresivo dobla casi cada escalon pero la prob. de completar se desploma.
const LADDER_BANDS={conservador:[1.15,1.45],medio:[1.4,1.9],agresivo:[1.8,3.0]};

// candidatos: 1X2 y doble oportunidad (goleadores NO: toda la banca a una alineacion, no)
function ladderCandidates(){return parlayPool(false).filter(l=>l.mkt!=='scorer');}

// Arma la escalera: por cada fecha (ascendente) el mejor candidato POR VALOR dentro de la
// banda del perfil; un partido por escalon y fechas estrictamente crecientes.
function buildLadder(steps,profile,exclude){
  const[lo,hi]=LADDER_BANDS[profile]||LADDER_BANDS.medio;
  const byDate={};
  ladderCandidates().forEach(l=>{
    if(l.med<lo||l.med>hi)return;
    if(exclude&&exclude.has(l.key))return;
    (byDate[l.kick]=byDate[l.kick]||[]).push(l);
  });
  const rungs=[];
  for(const d of Object.keys(byDate).sort()){
    if(rungs.length>=steps)break;
    const cands=byDate[d].filter(l=>!rungs.some(r=>r.key===l.key)).sort((x,y)=>legVal(y)-legVal(x));
    if(cands.length)rungs.push(cands[0]);
  }
  return rungs;
}

// Variantes como en los parleys: cada clic excluye los partidos ya propuestos con la misma
// configuracion; al agotarse, reinicia el ciclo.
let lUsed=new Set(),lVariant=0,lCfg='';
function nextLadder(steps,profile){
  const cfg=steps+'|'+profile;
  if(cfg!==lCfg){lUsed=new Set();lVariant=0;lCfg=cfg;}
  let rungs=buildLadder(steps,profile,lUsed);
  if(rungs.length<steps){lUsed=new Set();lVariant=0;rungs=buildLadder(steps,profile,null);}
  rungs.forEach(r=>lUsed.add(r.key));
  lVariant++;
  return{rungs,profile,variant:lVariant};
}

// Matematica exacta de la escalera (no hace falta simular): banca y probabilidad acumulada
// por escalon, y EV absoluto de "llegar hasta aqui y parar" (= pCum*banca - B0).
function ladderStats(rungs,b0){
  let bank=b0,p=1;const rows=[];
  rungs.forEach(r=>{
    p*=legPe(r);
    const bankOut=bank*r.best;
    rows.push({bankIn:bank,bankOut,pCum:p,evStop:p*bankOut-b0});
    bank=bankOut;
  });
  let bestStop=0;rows.forEach((r,i)=>{if(r.evStop>rows[bestStop].evStop)bestStop=i;});
  return{rows,final:bank,pAll:p,evAbs:p*bank-b0,bestStop};
}

// Estado del reto contra resultados reales: vivo (esperando el escalon k) / roto / completado.
function ladderStatus(ld){
  let bank=ld.b0,step=0;
  for(const r of ld.rungs){
    const res=legResult(r);
    if(res==='win'){bank*=r.best;step++;}
    else if(res==='loss')return{state:'roto',step:step+1,bank:0};
    else return{state:'vivo',step:step+1,bank};
  }
  return{state:'completado',step:ld.rungs.length,bank};
}

function saveLadder(rungs,b0,profile){
  const st=ladderStats(rungs,b0);
  bankLadders.push({id:bankLadders.length+1,b0,profile,rungs:rungs.map(r=>({...r})),
                    final:st.final,pAll:st.pAll});
  return bankLadders[bankLadders.length-1];
}

/* ===== plan Kelly fraccionado ===== */
const KELLY_EDGE_MIN=1.02; // edge minimo a cuota MEDIANA (robusto, no persigue una casa)
const KELLY_P_MIN=0.40;    // solo resultados plausibles: en tapados el "edge" suele ser el
                           // modelo discrepando del mercado, y ahi el mercado tiene razon
const KELLY_CAP=0.05;      // tope por pick: 5% de la banca

function kellyPlan(bank,frac,maxPicks){
  // maximo una apuesta por SELECCION (ademas de por partido): si el edge nace de una sola
  // creencia del modelo (p. ej. "Qatar esta subvaluado"), apostarlo tres veces no diversifica
  // — multiplica el mismo error. El Monte Carlo asume independencia; esto la hace defendible.
  const used=new Set(),picks=[];
  parlayPool(false).filter(l=>legVal(l)>=KELLY_EDGE_MIN&&legPe(l)>=KELLY_P_MIN)
    .sort((x,y)=>legVal(y)-legVal(x)).forEach(l=>{
    if(picks.length>=maxPicks||used.has(l.key)||used.has(l.a)||used.has(l.b))return;
    used.add(l.key);used.add(l.a);used.add(l.b);picks.push(l);
  });
  const rows=picks.map(l=>{
    const pe=legPe(l),o=l.best;
    const f=Math.max(0,(pe*o-1)/(o-1)); // Kelly a la cuota que de verdad tomas (la mejor)
    const stake=Math.min(bank*f*frac,bank*KELLY_CAP);
    return{leg:l,pe,o,f,stake,ev:stake*(pe*o-1)};
  }).filter(r=>r.stake>=1);
  return{rows,evAbs:rows.reduce((s,r)=>s+r.ev,0),exposure:rows.reduce((s,r)=>s+r.stake,0),
         mc:rows.length?planMC(rows,5000):null};
}
// Distribucion del P&L del plan: Bernoulli independientes (partidos distintos).
function planMC(rows,sims){
  const res=[];
  for(let i=0;i<sims;i++){
    let pnl=0;
    rows.forEach(r=>{pnl+=Math.random()<r.pe?r.stake*(r.o-1):-r.stake;});
    res.push(pnl);
  }
  res.sort((a,b)=>a-b);
  const q=p=>res[Math.floor(p*(res.length-1))];
  return{p5:q(0.05),p50:q(0.5),p95:q(0.95),pNeg:res.filter(x=>x<0).length/res.length};
}
function savePlan(plan,bank,frac){
  bankPlans.push({id:bankPlans.length+1,bank,frac,
                  picks:plan.rows.map(r=>({leg:{...r.leg},stake:r.stake,o:r.o,pe:r.pe})),
                  evAbs:plan.evAbs,exposure:plan.exposure});
  return bankPlans[bankPlans.length-1];
}
// P&L realizado del plan guardado (apuestas independientes, no todo-o-nada).
function planStatus(p){
  let pnl=0,pend=0,win=0,loss=0;
  p.picks.forEach(r=>{
    const s=legResult(r.leg);
    if(s==='win'){pnl+=r.stake*(r.o-1);win++;}
    else if(s==='loss'){pnl-=r.stake;loss++;}
    else pend++;
  });
  return{pnl,pend,win,loss};
}

/* ===== render (DOM) ===== */
let ladderCur=null,planCur=null;
function lB0(){const v=parseFloat(document.getElementById('lAmount').value);return isNaN(v)||v<=0?100:v;}
function kB0(){const v=parseFloat(document.getElementById('kBank').value);return isNaN(v)||v<=0?1000:v;}
function pf$c(v){return '$'+(Math.round(v*100)/100).toLocaleString('es');}

function renderLadderCur(){
  const box=document.getElementById('lTicketBox');if(!box)return;
  const save=document.getElementById('lSave');
  if(!ladderCur||!ladderCur.rungs.length){
    box.innerHTML='<div class="empty">Elige monto, escalones y perfil y pulsa "Armar escalera".</div>';
    if(save)save.disabled=true;
    document.getElementById('lMeta').textContent='—';
    return;
  }
  const b0=lB0(),rungs=ladderCur.rungs,st=ladderStats(rungs,b0);
  let rows='';
  rungs.forEach((r,i)=>{
    const s=st.rows[i],pe=legPe(r);
    rows+=`<tr${i===st.bestStop?' style="box-shadow:inset 3px 0 0 var(--green)"':''}><td class="mono" style="color:var(--mut)">${i+1}</td>`+
      `<td class="mono">${r.kick.slice(5)}<span class="plk">J${r.md}</span></td>`+
      `<td class="team">${tag(r.g)}${r.a} – ${r.b}</td>`+
      pickCellHtml(r)+
      `<td class="mono">${r.best.toFixed(2)}<span class="plk">${r.book}</span></td>`+
      `<td class="mono"><span class="cf ${confClass(pe)}">${pfPct(pe)}</span></td>`+
      `<td class="mono">${pf$c(s.bankIn)} → <b>${pf$c(s.bankOut)}</b></td>`+
      `<td class="mono">${pfPct(s.pCum)}</td>`+
      `<td class="mono" style="color:${s.evStop>=0?'var(--green)':'var(--red)'}">${s.evStop>=0?'+':''}${pf$c(s.evStop).replace('$-','-$')}</td></tr>`;
  });
  box.innerHTML=
    `<div class="pstats">`+
    `<div class="pstat-card"><div class="k">Si completas los ${rungs.length}</div><div class="v">${pf$c(st.final)}</div><div class="s">desde ${pf$c(b0)}</div></div>`+
    `<div class="pstat-card"><div class="k">Prob. de completar</div><div class="v"><span class="cf ${confClass(st.pAll)}" style="font-size:15px">${pfPct(st.pAll)}</span></div><div class="s">todo o nada: si un escalon falla, banca 0</div></div>`+
    `<div class="pstat-card"><div class="k">Valor esperado</div><div class="v" style="color:${st.evAbs>=0?'var(--green)':'var(--red)'}">${st.evAbs>=0?'+':''}${pf$c(st.evAbs).replace('$-','-$')}</div><div class="s">del reto completo</div></div>`+
    `<div class="pstat-card"><div class="k">Mejor parada por EV</div><div class="v">escalon ${st.bestStop+1}</div><div class="s">${pf$c(st.rows[st.bestStop].bankOut)} con prob. ${pfPct(st.rows[st.bestStop].pCum)}</div></div>`+
    `</div>`+
    `<div class="tablewrap" style="margin-top:14px"><table class="ptable"><thead><tr><th>#</th><th>Fecha</th><th class="team">Partido</th><th style="text-align:left">Pick</th><th>Cuota</th><th>Prob.</th><th>Banca</th><th>Prob. acum.</th><th>EV si paras</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  if(save)save.disabled=rungs.length<2;
  document.getElementById('lMeta').textContent=rungs.length+' escalones · '+ladderCur.profile+(ladderCur.variant?' · variante '+ladderCur.variant:'');
}

function renderLadders(){
  const wrap=document.getElementById('lLadders');if(!wrap)return;
  document.getElementById('lCount').textContent=bankLadders.length+(bankLadders.length===1?' reto':' retos');
  if(!bankLadders.length){wrap.innerHTML='<div class="empty">Sin retos guardados.</div>';return;}
  wrap.innerHTML='';
  bankLadders.forEach(ld=>{
    const st=ladderStatus(ld);
    const cls=st.state==='completado'?'hi':st.state==='roto'?'lo':'mid';
    let rows='';
    ld.rungs.forEach((r,i)=>{
      rows+=`<div class="ptleg"><span class="n">${i+1}. ${r.a} – ${r.b}<span class="plk mono">${r.kick.slice(5)}</span></span><span class="p">${r.lbl} <span class="mono" style="color:var(--mut)">@${r.best.toFixed(2)}</span></span>${legChip(legResult(r))}</div>`;
    });
    const card=document.createElement('div');card.className='ptk';
    card.innerHTML=`<div class="phd"><b>Reto #${ld.id}</b><span class="mono" style="color:var(--mut)">${ld.rungs.length} escalones · ${pf$c(ld.b0)} → ${pf$c(ld.final)} · prob. ${pfPct(ld.pAll)}</span><span class="cf ${cls}">${st.state.toUpperCase()}</span><span class="mono" style="color:var(--mut)">banca ${pf$c(st.bank)}${st.state==='vivo'?' · va en el escalon '+st.step:''}</span><button class="pdel" data-lid="${ld.id}" title="Borrar reto">x</button></div><div class="ptlegs">${rows}</div>`;
    wrap.appendChild(card);
  });
}

function renderPlanCur(){
  const box=document.getElementById('kPlanBox');if(!box)return;
  const save=document.getElementById('kSave');
  if(!planCur||!planCur.rows.length){
    box.innerHTML='<div class="empty">Elige banca y fraccion de Kelly y pulsa "Generar plan". Si no hay picks con edge >= 2% a cuota mediana, el plan honesto es no apostar.</div>';
    if(save)save.disabled=true;
    return;
  }
  const p=planCur;let rows='';
  p.rows.forEach((r,i)=>{
    const l=r.leg;
    rows+=`<tr><td class="mono" style="color:var(--mut)">${i+1}</td>`+
      `<td class="team">${tag(l.g)}${l.a} – ${l.b}<span class="plk mono">J${l.md} · ${l.kick.slice(5)}</span></td>`+
      pickCellHtml(l)+
      `<td class="mono">${r.o.toFixed(2)}<span class="plk">${l.book}</span></td>`+
      `<td class="mono"><span class="cf ${confClass(r.pe)}">${pfPct(r.pe)}</span></td>`+
      `<td class="mono">${(r.f*100).toFixed(1)}%</td>`+
      `<td class="mono" style="font-weight:600">${pf$c(r.stake)}</td>`+
      `<td class="mono" style="color:var(--green)">+${pf$c(r.ev)}</td></tr>`;
  });
  const mc=p.mc;
  box.innerHTML=
    `<div class="pstats">`+
    `<div class="pstat-card"><div class="k">En juego</div><div class="v">${pf$c(p.exposure)}</div><div class="s">${p.rows.length} apuestas individuales</div></div>`+
    `<div class="pstat-card"><div class="k">EV del plan</div><div class="v" style="color:var(--green)">+${pf$c(p.evAbs)}</div><div class="s">si el ensamble esta bien calibrado</div></div>`+
    (mc?`<div class="pstat-card"><div class="k">P&L tipico (p50)</div><div class="v">${mc.p50>=0?'+':''}${pf$c(mc.p50).replace('$-','-$')}</div><div class="s">90% entre ${pf$c(mc.p5).replace('$-','-$')} y +${pf$c(mc.p95)}</div></div>`+
    `<div class="pstat-card"><div class="k">Prob. de acabar abajo</div><div class="v"><span class="cf ${mc.pNeg<0.4?'hi':mc.pNeg<0.55?'mid':'lo'}" style="font-size:15px">${pfPct(mc.pNeg)}</span></div><div class="s">Monte Carlo, 5,000 corridas</div></div>`:'')+
    `</div>`+
    `<div class="tablewrap" style="margin-top:14px"><table class="ptable"><thead><tr><th>#</th><th class="team">Partido</th><th style="text-align:left">Pick</th><th>Cuota</th><th>Prob. ens.</th><th>Kelly f*</th><th>Apostar</th><th>EV</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  if(save)save.disabled=false;
}

function renderPlans(){
  const wrap=document.getElementById('kPlans');if(!wrap)return;
  document.getElementById('kCount').textContent=bankPlans.length+(bankPlans.length===1?' plan':' planes');
  if(!bankPlans.length){wrap.innerHTML='<div class="empty">Sin planes guardados.</div>';return;}
  wrap.innerHTML='';
  bankPlans.forEach(p=>{
    const st=planStatus(p);
    let rows='';
    p.picks.forEach(r=>{
      rows+=`<div class="ptleg"><span class="n">${r.leg.a} – ${r.leg.b}<span class="plk mono">J${r.leg.md}</span></span><span class="p">${r.leg.lbl} <span class="mono" style="color:var(--mut)">${pf$c(r.stake)} @${r.o.toFixed(2)}</span></span>${legChip(legResult(r.leg))}</div>`;
    });
    const cls=st.pend>0?'mid':st.pnl>=0?'hi':'lo';
    const lbl=st.pend>0?'EN CURSO':(st.pnl>=0?'GANANCIA':'PERDIDA');
    const card=document.createElement('div');card.className='ptk';
    card.innerHTML=`<div class="phd"><b>Plan #${p.id}</b><span class="mono" style="color:var(--mut)">${p.picks.length} picks · en juego ${pf$c(p.exposure)} de ${pf$c(p.bank)} (Kelly x${p.frac})</span><span class="cf ${cls}">${lbl}</span><span class="mono" style="color:${st.pnl>=0?'var(--green)':'var(--red)'}">P&L ${st.pnl>=0?'+':''}${pf$c(st.pnl).replace('$-','-$')}</span><span class="mono" style="color:var(--mut)">${st.win} OK · ${st.loss} mal · ${st.pend} pend.</span><button class="pdel" data-pid="${p.id}" title="Borrar plan">x</button></div><div class="ptlegs">${rows}</div>`;
    wrap.appendChild(card);
  });
}

function renderBank(){renderLadderCur();renderLadders();renderPlanCur();renderPlans();}

/* ===== eventos ===== */
document.getElementById('lBuild').addEventListener('click',()=>{
  const steps=parseInt(document.getElementById('lSteps').value)||6;
  ladderCur=nextLadder(steps,lProfileVal);
  renderLadderCur();
});
document.querySelectorAll('#lProfile button').forEach(btn=>btn.addEventListener('click',()=>{
  document.querySelectorAll('#lProfile button').forEach(x=>x.classList.remove('on'));
  btn.classList.add('on');lProfileVal=btn.dataset.p;
}));
document.getElementById('lAmount').addEventListener('change',()=>renderLadderCur());
document.getElementById('lSave').addEventListener('click',()=>{
  if(!ladderCur||ladderCur.rungs.length<2)return;
  saveLadder(ladderCur.rungs,lB0(),ladderCur.profile);
  ladderCur=null;
  renderLadderCur();renderLadders();
});
document.getElementById('lLadders').addEventListener('click',e=>{
  const b=e.target.closest('.pdel');if(!b)return;
  bankLadders=bankLadders.filter(l=>l.id!==parseInt(b.dataset.lid));
  renderLadders();
});
document.getElementById('kBuild').addEventListener('click',()=>{
  const frac=parseFloat(document.querySelector('#kFrac button.on')?.dataset.f)||0.25;
  const maxP=parseInt(document.getElementById('kMax').value)||8;
  planCur=kellyPlan(kB0(),frac,maxP);
  planCur.frac=frac;
  renderPlanCur();
});
document.querySelectorAll('#kFrac button').forEach(btn=>btn.addEventListener('click',()=>{
  document.querySelectorAll('#kFrac button').forEach(x=>x.classList.remove('on'));
  btn.classList.add('on');
}));
document.getElementById('kSave').addEventListener('click',()=>{
  if(!planCur||!planCur.rows.length)return;
  savePlan(planCur,kB0(),planCur.frac||0.25);
  planCur=null;
  renderPlanCur();renderPlans();
});
document.getElementById('kPlans').addEventListener('click',e=>{
  const b=e.target.closest('.pdel');if(!b)return;
  bankPlans=bankPlans.filter(p=>p.id!==parseInt(b.dataset.pid));
  renderPlans();
});
