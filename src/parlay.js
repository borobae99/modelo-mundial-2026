/* ============================================================
   parlay.js — Armador de parleys (apuestas combinadas)
   ------------------------------------------------------------
   Construye boletos de N legs sobre los 72 partidos de grupos
   en TRES mercados: 1X2 (cuotas reales por casa, parlay_odds.js),
   doble oportunidad (cuota sintetica del 1X2 por dutching) y
   goleadores (anytime scorer, player_odds_2026.js + share de
   goles historico de scorers_2026.js). La probabilidad por leg
   es el ENSAMBLE modelo+mercado (ENSEMBLE_W, el mismo de la
   quiniela); en goleadores el lado mercado es la prob. implicita
   con un descuento de margen declarado (SCORER_DEVIG).
   Tres estrategias:
     - seguro   : maximiza la prob. de cobrar (favoritos claros)
     - valor    : maximiza el EV por leg (prob x mejor cuota)
     - agresivo : cuotas altas que el ensamble no castiga
   Honestidad primero: el boleto muestra SIEMPRE su probabilidad
   de pegarle y su EV; un retorno grande implica prob. chica y el
   margen del corredor se compone leg a leg. La cuota combinada se
   reporta con la MEJOR cuota por leg (line shopping, optimista) y
   con la MEDIANA (una sola casa, realista).
   Los boletos guardados viven en memoria de sesion (exportar /
   importar JSON; sin localStorage por convencion del proyecto) y
   se puntuan contra RESULTS_2026 (results_2026.js, regenerado por
   scripts/fetch_scores_2026.py durante el torneo).
   Depende de: data.js (FIX), quiniela.js (gridProbs, confClass),
   market.js (ENSEMBLE_W), odds_2026.js, parlay_odds.js,
   results_2026.js. Logica pura arriba (smoke_test), DOM abajo.
   ============================================================ */

let parlayTickets=[]; // boletos guardados (memoria de sesion)
let parlayCur=null;   // boleto en construccion {legs:[...]}
let pStratVal='valor',pMdVal=0,pMktVal='all',_poolView=[];

/* ===== logica pura ===== */
// Prob. del ensamble por leg, dinamica (sigue al peso actual de Ajustes).
function legPe(l){return ENSEMBLE_W*l.pm+(1-ENSEMBLE_W)*l.pk;}
// Valor del leg (EV+1) a la cuota MEDIANA entre casas, no a la mejor: rankear por la mejor
// cuota persigue sistematicamente la linea atipica de UNA casa (error/stale) — winner's curse.
// La mejor cuota se usa para PAGAR el boleto (line shopping), no para juzgar el valor.
function legVal(l){return legPe(l)*l.med;}

// Nombres de jugador robustos a acentos y orden ("Raul Jimenez" == "Raúl Jiménez",
// "Son Heung-min" == "Heung-min Son"): minusculas, sin diacriticos, tokens ordenados.
// Une las grafias de The Odds API con las del historico martj42.
function nameKey(s){return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z]+/g,' ').trim().split(' ').sort().join(' ');}
let _scorerIdx=null;
function scorerIndex(){ // nameKey -> {team, share} de scorers_2026.js
  if(_scorerIdx)return _scorerIdx;
  _scorerIdx={};
  if(typeof SCORERS_2026!=='undefined')for(const t in SCORERS_2026)SCORERS_2026[t].forEach(p=>{_scorerIdx[nameKey(p.n)]={team:t,share:p.s};});
  return _scorerIdx;
}
// El mercado de goleadores solo cotiza el "Si" — no se puede de-vig como el 1X2. Se descuenta
// un margen tipico (~15%) de la prob. implicita de la mediana. Aproximacion declarada, no dato.
const SCORER_DEVIG=0.85;

// Pool: legs de tres mercados por partido con cuota, excluyendo los ya jugados:
//  - h2h    : gana A / empate / gana B (cuota real por casa).
//  - dc     : doble oportunidad (1X / 12 / X2) con cuota SINTETICA del 1X2 por dutching
//             (repartir el monto entre los dos resultados: o1*o2/(o1+o2)); la cuota DC real
//             de una casa es muy parecida porque la deriva del mismo 1X2.
//  - scorer : "anota el jugador" (player_goal_scorer_anytime, cuota real). Prob. del modelo
//             por adelgazamiento Poisson: P = 1-exp(-lambda_equipo * share del jugador), con
//             el share historico de scorers_2026.js. Asume que el jugador juega; solo entran
//             jugadores con share conocido (sin modelo no hay leg).
function parlayPool(includePlayed){
  const pool=[];
  if(typeof PARLAY_ODDS==='undefined')return pool;
  for(const g in FIX)FIX[g].forEach(([a,b],i)=>{
    const key=[a,b].slice().sort().join('|');
    const po=PARLAY_ODDS[key];
    const mk=(typeof ODDS_2026_MATCHES!=='undefined')?ODDS_2026_MATCHES[key]:null;
    if(!po||!mk)return;
    if(!includePlayed&&typeof RESULTS_2026!=='undefined'&&RESULTS_2026[key])return;
    const{pW,pD,pL}=gridProbs(a,b);
    const base={key,g,md:Math.floor(i/2)+1,kick:po.kick,a,b};
    const mkW=mk[a]!=null?mk[a]:pW,mkD=mk['draw']!=null?mk['draw']:pD,mkL=mk[b]!=null?mk[b]:pL;
    const pxA=po.px[a],pxD=po.px['draw'],pxB=po.px[b];
    [[a,'Gana '+a,pW,mkW,pxA],['draw','Empate',pD,mkD,pxD],[b,'Gana '+b,pL,mkL,pxB]].forEach(([pick,lbl,pm,pk,px])=>{
      if(px)pool.push({...base,mkt:'h2h',pick,cover:[pick],lbl,pm,pk,best:px[0],med:px[1],book:px[2]});
    });
    if(pxA&&pxD&&pxB){
      const synth=(p,q)=>Math.round(p*q/(p+q)*100)/100;
      [[[a,'draw'],a+' o empate',pW+pD,mkW+mkD,pxA,pxD],
       [['draw',b],'Empate o '+b,pD+pL,mkD+mkL,pxD,pxB],
       [[a,b],a+' o '+b,pW+pL,mkW+mkL,pxA,pxB]].forEach(([cover,lbl,pm,pk,p1,p2])=>{
        const best=synth(p1[0],p2[0]),med=synth(p1[1],p2[1]);
        // la DC de un favorito enorme da cuota sintetica <= 1 (dutching con perdida
        // garantizada); ninguna casa la ofrece y como leg es absurda: fuera del pool
        if(med<=1.01)return;
        pool.push({...base,mkt:'dc',pick:'dc:'+cover.join('/'),cover,lbl,pm,pk,best,med,book:'1X2 sintetica'});
      });
    }
    const pl=(typeof PLAYER_ODDS_2026!=='undefined')?PLAYER_ODDS_2026[key]:null;
    if(pl){
      const idx=scorerIndex();const lam=lambdas(a,b);
      for(const name in pl){
        const inf=idx[nameKey(name)];
        if(!inf||(inf.team!==a&&inf.team!==b))continue;
        const px=pl[name];
        const pm=1-Math.exp(-(inf.team===a?lam[0]:lam[1])*inf.share);
        const pk=Math.min(0.95,(1/px[1])*SCORER_DEVIG);
        pool.push({...base,mkt:'scorer',pick:'anota:'+name,player:name,pteam:inf.team,lbl:'Anota '+name,pm,pk,best:px[0],med:px[1],book:px[2]});
      }
    }
  });
  return pool;
}

// Arma N legs segun la estrategia, maximo un leg por partido.
//  - seguro   : maximiza la prob. de cobrar (pe), sin mirar la cuota.
//  - valor    : maximiza el valor (pe x mediana) sobre resultados PLAUSIBLES (pe >= 0.40).
//               Sin el piso, el "valor" se concentra en tapados donde el modelo discrepa
//               del mercado — y el backtest dice que ahi el mercado suele tener razon.
//  - agresivo : maximiza el valor entre cuotas ALTAS pero plausibles (mediana 2.5-8,
//               valor >= 0.95): retorno grande con los underdogs y empates menos
//               castigados por el ensamble. El techo de 8 evita perseguir tapados
//               extremos donde ni el modelo ni el de-vig son confiables.
// Si el filtro no alcanza para N legs, completa con lo mejor del resto.
function buildParlayLegs(n,strategy,pool){
  pool=pool||parlayPool(false);
  const byVal=(x,y)=>legVal(y)-legVal(x);
  let ranked;
  if(strategy==='seguro')ranked=pool.slice().sort((x,y)=>legPe(y)-legPe(x));
  else if(strategy==='agresivo'){
    const fits=l=>l.med>=2.5&&l.med<=8&&legVal(l)>=0.95;
    const ok=pool.filter(fits).sort(byVal);
    const rest=pool.filter(l=>!fits(l)).sort(byVal);
    ranked=ok.concat(rest);
  }
  else{ // 'valor'
    const ok=pool.filter(l=>legPe(l)>=0.40).sort(byVal);
    const rest=pool.filter(l=>legPe(l)<0.40).sort(byVal);
    ranked=ok.concat(rest);
  }
  const used=new Set(),legs=[];
  for(const l of ranked){
    if(used.has(l.key))continue;
    legs.push(l);used.add(l.key);
    if(legs.length>=n)break;
  }
  legs.sort((x,y)=>x.kick<y.kick?-1:x.kick>y.kick?1:0);
  return legs;
}

// Genera la SIGUIENTE variante del boleto: respeta los filtros de jornada (md=0 -> todas) y
// de mercado ('all' -> todos) y excluye los partidos ya propuestos con esta misma
// configuracion, asi cada clic da un boleto distinto. Al agotarse, reinicia el ciclo.
let pUsedKeys=new Set(),pVariant=0,pLastCfg='';
function nextParlay(n,strategy,md,mkt){
  mkt=mkt||'all';
  const cfg=n+'|'+strategy+'|'+md+'|'+mkt;
  if(cfg!==pLastCfg){pUsedKeys=new Set();pVariant=0;pLastCfg=cfg;}
  const pool=parlayPool(false).filter(l=>(!md||l.md===md)&&(mkt==='all'||l.mkt===mkt));
  let avail=pool.filter(l=>!pUsedKeys.has(l.key));
  if(new Set(avail.map(l=>l.key)).size<n){pUsedKeys=new Set();pVariant=0;avail=pool;}
  const legs=buildParlayLegs(n,strategy,avail);
  legs.forEach(l=>pUsedKeys.add(l.key));
  pVariant++;
  return{legs,md,mkt,variant:pVariant};
}

// Stats del boleto: cuota combinada (mejor y mediana), prob. de pegarle y EV.
// El producto asume independencia entre partidos (cierto en el motor: marcadores
// independientes dadas las fuerzas; entre grupos distintos es exacto).
function parlayStats(legs){
  let comb=1,combMed=1,pHit=1,pMod=1,pMkt=1;
  legs.forEach(l=>{comb*=l.best;combMed*=l.med;pHit*=legPe(l);pMod*=l.pm;pMkt*=l.pk;});
  return{comb,combMed,pHit,pMod,pMkt,ev:pHit*comb-1,evMed:pHit*combMed-1};
}

// Puntuacion contra resultados reales: 'pend' | 'win' | 'loss'.
// 1X2 y doble oportunidad se juzgan con el marcador (cover = resultados que cubren el pick);
// goleadores con la lista de anotadores (RESULTS_2026_SCORERS, sin autogoles). Si hubo goles
// pero los anotadores aun no llegan al historico, queda pendiente.
function legResult(l){
  if(typeof RESULTS_2026==='undefined')return 'pend';
  const r=RESULTS_2026[l.key];if(!r)return 'pend';
  if(l.mkt==='scorer'){
    if(r[0]===0&&r[1]===0)return 'loss'; // 0-0: nadie anoto
    const sc=(typeof RESULTS_2026_SCORERS!=='undefined')?RESULTS_2026_SCORERS[l.key]:null;
    if(!sc)return 'pend';
    const k=nameKey(l.player);
    return sc.some(n=>nameKey(n)===k)?'win':'loss';
  }
  const[t1,t2]=l.key.split('|');
  const out=r[0]>r[1]?t1:r[1]>r[0]?t2:'draw';
  const cover=l.cover||[l.pick]; // boletos viejos (solo 1X2) no traen cover
  return cover.indexOf(out)>=0?'win':'loss';
}
function ticketStatus(t){
  let win=0,loss=0,pend=0;
  t.legs.forEach(l=>{const s=legResult(l);if(s==='win')win++;else if(s==='loss')loss++;else pend++;});
  return{win,loss,pend,state:loss>0?'perdido':pend>0?'vivo':'ganado'};
}

// Guardar congela los terminos del boleto (cuota y prob. al momento de "apostar").
function saveParlayTicket(legs,stake){
  const s=parlayStats(legs);
  parlayTickets.push({id:parlayTickets.length+1,legs:legs.map(l=>({...l})),stake,
                      comb:s.comb,combMed:s.combMed,pHit:s.pHit});
  return parlayTickets[parlayTickets.length-1];
}
// El export incluye tambien los retos escalera y planes Kelly de bank.js (si esta cargado).
function exportParlayTickets(){
  return JSON.stringify({app:'modelo-mundial-2026',tickets:parlayTickets,
    ladders:(typeof bankLadders!=='undefined')?bankLadders:[],
    plans:(typeof bankPlans!=='undefined')?bankPlans:[]},null,1);
}
function importParlayTickets(json){
  const d=JSON.parse(json);
  if(!d)return 0;
  let n=0;
  if(Array.isArray(d.tickets)){parlayTickets=d.tickets;n+=parlayTickets.length;}
  if(typeof bankLadders!=='undefined'&&Array.isArray(d.ladders)){bankLadders=d.ladders;n+=bankLadders.length;}
  if(typeof bankPlans!=='undefined'&&Array.isArray(d.plans)){bankPlans=d.plans;n+=bankPlans.length;}
  if(typeof renderBank==='function')renderBank();
  return n;
}

/* ===== render (DOM) ===== */
function pf$(v){return '$'+Math.round(v).toLocaleString('es');}
// kick ISO (UTC) -> "dd/mm hh:mm" en la zona horaria del navegador del que mira.
function fmtKick(k){const d=new Date(k);if(isNaN(d))return String(k).slice(5,16);const p=n=>String(n).padStart(2,'0');return p(d.getDate())+'/'+p(d.getMonth()+1)+' '+p(d.getHours())+':'+p(d.getMinutes());}
function pfPct(p){const x=p*100;return (x>=10?x.toFixed(0):x>=1?x.toFixed(1):x.toFixed(2))+'%';}
function pfOdds(o){return o>=1000?Math.round(o).toLocaleString('es'):o>=100?o.toFixed(0):o.toFixed(2);}
function legChip(s){
  if(s==='win')return '<span class="cf hi">acierto</span>';
  if(s==='loss')return '<span class="cf lo">fallo</span>';
  return '<span class="cf">pendiente</span>';
}
// Celda del pick con contexto del mercado (equipo del goleador / doble oportunidad).
function pickCellHtml(l){
  const sub=l.mkt==='scorer'?l.pteam:l.mkt==='dc'?'doble oportunidad':'';
  return `<td style="text-align:left;font-weight:600">${l.lbl}${sub?`<span class="plk">${sub}</span>`:''}</td>`;
}
function pStake(){const v=parseFloat(document.getElementById('pStake').value);return isNaN(v)||v<=0?100:v;}

function renderParlayTicket(){
  const box=document.getElementById('pTicketBox');if(!box)return;
  const save=document.getElementById('pSave');
  if(!parlayCur||!parlayCur.legs.length){
    box.innerHTML='<div class="empty">Elige legs y estrategia y pulsa "Armar parley", o agrega legs desde la tabla de valor.</div>';
    if(save)save.disabled=true;
    document.getElementById('pMeta').textContent='—';
    return;
  }
  const legs=parlayCur.legs,s=parlayStats(legs),stake=pStake();
  let rows='';
  legs.forEach((l,i)=>{
    const pe=legPe(l),v=legVal(l);
    rows+=`<tr><td class="mono" style="color:var(--mut)">${i+1}</td>`+
      `<td class="team">${tag(l.g)}${l.a} – ${l.b}<span class="plk mono">J${l.md} · ${fmtKick(l.kick)}</span></td>`+
      pickCellHtml(l)+
      `<td class="mono">${l.best.toFixed(2)}<span class="plk">${l.book}</span></td>`+
      `<td class="mono"><span class="cf ${confClass(pe)}">${pfPct(pe)}</span></td>`+
      `<td class="mono" style="color:${v>=1?'var(--green)':'var(--red)'}">${(v*100).toFixed(0)}%</td>`+
      `<td><button class="pdel" data-ri="${i}" title="Quitar leg">x</button></td></tr>`;
  });
  const evCol=s.ev>=0?'var(--green)':'var(--red)';
  box.innerHTML=
    `<div class="pstats">`+
    `<div class="pstat-card"><div class="k">Cuota combinada</div><div class="v">${pfOdds(s.comb)}</div><div class="s">mediana ${pfOdds(s.combMed)} (una casa)</div></div>`+
    `<div class="pstat-card"><div class="k">Retorno si pega</div><div class="v">${pf$(stake*s.comb)}</div><div class="s">apostando ${pf$(stake)}</div></div>`+
    `<div class="pstat-card"><div class="k">Prob. de pegarle</div><div class="v"><span class="cf ${confClass(s.pHit)}" style="font-size:15px">${pfPct(s.pHit)}</span></div><div class="s">modelo ${pfPct(s.pMod)} · mercado ${pfPct(s.pMkt)}</div></div>`+
    `<div class="pstat-card"><div class="k">Valor esperado</div><div class="v" style="color:${evCol}">${s.ev>=0?'+':''}${(s.ev*100).toFixed(1)}%</div><div class="s">con mediana ${s.evMed>=0?'+':''}${(s.evMed*100).toFixed(1)}%</div></div>`+
    `</div>`+
    `<div class="tablewrap" style="margin-top:14px"><table class="ptable"><thead><tr><th>#</th><th class="team">Partido</th><th style="text-align:left">Pick</th><th>Mejor cuota</th><th>Prob. ens.</th><th>Valor</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  if(save)save.disabled=legs.length<2;
  const mktLbl={h2h:'1X2',dc:'doble op.',scorer:'goleadores'};
  document.getElementById('pMeta').textContent=legs.length+' legs'+(parlayCur.md?' · J'+parlayCur.md:'')+(parlayCur.mkt&&parlayCur.mkt!=='all'?' · '+mktLbl[parlayCur.mkt]:'')+(parlayCur.variant?' · variante '+parlayCur.variant:'')+' · ens. '+Math.round(ENSEMBLE_W*100)+'% modelo';
}

function renderParlayPool(){
  const tb=document.getElementById('pPoolBody');if(!tb)return;
  const all=parlayPool(false);
  const pool=all.filter(l=>(pMdVal===0||l.md===pMdVal)&&(pMktVal==='all'||l.mkt===pMktVal));
  pool.sort((x,y)=>legVal(y)-legVal(x));
  _poolView=pool.slice(0,24);
  const inCur=new Set(parlayCur?parlayCur.legs.map(l=>l.key):[]);
  tb.innerHTML='';
  if(!_poolView.length){tb.innerHTML='<tr><td colspan="7" class="empty">'+(pMktVal==='scorer'?'Sin cuotas de goleadores para ese filtro: las casas cotizan pocos dias antes de cada partido (corre scripts/fetch_player_odds_2026.py).':'Sin cuotas cargadas (regenera src/parlay_odds.js).')+'</td></tr>';return;}
  _poolView.forEach((l,i)=>{
    const pe=legPe(l),v=legVal(l);
    const tr=document.createElement('tr');
    tr.innerHTML=`<td class="team">${tag(l.g)}${l.a} – ${l.b}<span class="plk mono">J${l.md} · ${fmtKick(l.kick)}</span></td>`+
      pickCellHtml(l)+
      `<td class="mono">${l.best.toFixed(2)}<span class="plk">${l.book}</span></td>`+
      `<td class="mono">${l.med.toFixed(2)}</td>`+
      `<td class="mono"><span class="cf ${confClass(pe)}">${pfPct(pe)}</span></td>`+
      `<td class="mono" style="color:${v>=1?'var(--green)':'var(--red)'};font-weight:600">${(v*100).toFixed(0)}%</td>`+
      `<td>${inCur.has(l.key)?'<span class="plk">en boleto</span>':`<button class="padd" data-pi="${i}">+</button>`}</td>`;
    tb.appendChild(tr);
  });
  const st=document.getElementById('pStat');
  if(st&&typeof PARLAY_ODDS_META!=='undefined'){
    const sc=all.filter(l=>l.mkt==='scorer').length;
    st.textContent=all.length+' legs ('+sc+' de goleador) · cuotas '+PARLAY_ODDS_META.captured;
  }
}

function renderParlayTickets(){
  const wrap=document.getElementById('pTickets');if(!wrap)return;
  document.getElementById('pCount').textContent=parlayTickets.length+(parlayTickets.length===1?' boleto':' boletos');
  if(!parlayTickets.length){
    wrap.innerHTML='<div class="empty">Sin boletos guardados. Arma un parley y pulsa "Guardar boleto". Exporta a JSON para conservarlos entre sesiones.</div>';
    document.getElementById('pSummary').innerHTML='';
    return;
  }
  wrap.innerHTML='';
  let staked=0,returned=0,decided=0,won=0,live=0;
  parlayTickets.forEach(t=>{
    const st=ticketStatus(t);
    staked+=t.stake;
    if(st.state==='ganado'){returned+=t.stake*t.comb;decided++;won++;}
    else if(st.state==='perdido')decided++;
    else live++;
    let rows='';
    t.legs.forEach(l=>{
      rows+=`<div class="ptleg"><span class="n">${l.a} – ${l.b}<span class="plk mono">J${l.md}</span></span><span class="p">${l.lbl} <span class="mono" style="color:var(--mut)">@${l.best.toFixed(2)}</span></span>${legChip(legResult(l))}</div>`;
    });
    const cls=st.state==='ganado'?'hi':st.state==='perdido'?'lo':'mid';
    const card=document.createElement('div');card.className='ptk';
    card.innerHTML=`<div class="phd"><b>Boleto #${t.id}</b><span class="mono" style="color:var(--mut)">${t.legs.length} legs · ${pf$(t.stake)} → ${pf$(t.stake*t.comb)} · prob. ${pfPct(t.pHit)}</span><span class="cf ${cls}">${st.state.toUpperCase()}</span><span class="mono" style="color:var(--mut)">${st.win}/${t.legs.length} aciertos</span><button class="pdel" data-tid="${t.id}" title="Borrar boleto">x</button></div><div class="ptlegs">${rows}</div>`;
    wrap.appendChild(card);
  });
  const pnl=returned-parlayTickets.filter(t=>ticketStatus(t).state!=='vivo').reduce((s,t)=>s+t.stake,0);
  document.getElementById('pSummary').innerHTML=
    `<span class="pill">Boletos <b>${parlayTickets.length}</b></span>`+
    `<span class="pill">Apostado <b>${pf$(staked)}</b></span>`+
    `<span class="pill">Vivos <b>${live}</b></span>`+
    `<span class="pill">Ganados <b>${won}/${decided||0}</b></span>`+
    `<span class="pill">P&L decidido <b style="color:${pnl>=0?'var(--green)':'var(--red)'}">${pnl>=0?'+':''}${pf$(pnl).replace('$-','-$')}</b></span>`;
}

function renderParlay(){renderParlayTicket();renderParlayPool();renderParlayTickets();}

/* ===== eventos ===== */
document.getElementById('pBuild').addEventListener('click',()=>{
  const n=parseInt(document.getElementById('pnLegs').value)||5;
  parlayCur=nextParlay(n,pStratVal,pMdVal,pMktVal);
  renderParlayTicket();renderParlayPool();
});
document.getElementById('pMkt').addEventListener('change',e=>{pMktVal=e.target.value||'all';renderParlayPool();});
document.querySelectorAll('#pStrat button').forEach(btn=>btn.addEventListener('click',()=>{
  document.querySelectorAll('#pStrat button').forEach(x=>x.classList.remove('on'));
  btn.classList.add('on');pStratVal=btn.dataset.s;
}));
document.getElementById('pMd').addEventListener('change',e=>{pMdVal=parseInt(e.target.value)||0;renderParlayPool();});
document.getElementById('pStake').addEventListener('change',()=>renderParlayTicket());
document.getElementById('pSave').addEventListener('click',()=>{
  if(!parlayCur||parlayCur.legs.length<2)return;
  saveParlayTicket(parlayCur.legs,pStake());
  parlayCur=null;
  renderParlay();
});
// quitar leg del boleto en construccion
document.getElementById('pTicketBox').addEventListener('click',e=>{
  const b=e.target.closest('.pdel');if(!b||!parlayCur)return;
  parlayCur.legs.splice(parseInt(b.dataset.ri),1);
  renderParlayTicket();renderParlayPool();
});
// agregar leg desde la tabla de valor
document.getElementById('pPool').addEventListener('click',e=>{
  const b=e.target.closest('.padd');if(!b)return;
  const l=_poolView[parseInt(b.dataset.pi)];if(!l)return;
  if(!parlayCur)parlayCur={legs:[]};
  if(parlayCur.legs.some(x=>x.key===l.key))return; // un leg por partido
  parlayCur.legs.push(l);
  parlayCur.legs.sort((x,y)=>x.kick<y.kick?-1:x.kick>y.kick?1:0);
  renderParlayTicket();renderParlayPool();
});
// borrar boleto guardado
document.getElementById('pTickets').addEventListener('click',e=>{
  const b=e.target.closest('.pdel');if(!b)return;
  parlayTickets=parlayTickets.filter(t=>t.id!==parseInt(b.dataset.tid));
  renderParlayTickets();
});
// exportar / importar JSON (persistencia entre sesiones sin localStorage)
document.getElementById('pExport').addEventListener('click',()=>{
  const blob=new Blob([exportParlayTickets()],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download='boletos_parley.json';a.click();URL.revokeObjectURL(a.href);
});
document.getElementById('pImport').addEventListener('change',e=>{
  const f=e.target.files&&e.target.files[0];if(!f)return;
  const rd=new FileReader();
  rd.onload=()=>{try{const n=importParlayTickets(rd.result);document.getElementById('pStat').textContent=n+' boletos importados';renderParlayTickets();}catch(_){document.getElementById('pStat').textContent='JSON invalido';}};
  rd.readAsText(f);e.target.value='';
});
