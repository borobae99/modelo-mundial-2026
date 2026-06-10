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
for (const f of ["data.js", "attack_defense.js", "odds_2026.js", "parlay_odds.js", "scorers_2026.js", "player_odds_2026.js", "results_2026.js", "engine.js", "quiniela.js", "validation.js", "market.js", "parlay.js", "bank.js", "backtest_data.js", "backtest_ad.js", "xg_data.js", "backtest.js", "ui.js"]) {
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
  // 6) benchmark vs mercado
  __results.mkt2022cov = market2022Coverage();
  const dv = devig([2.00,3.40,3.80]);
  __results.devigSum = dv.reduce((a,b)=>a+b,0);
  const em = evalMarket2022();
  __results.mktRps = em ? em.rps : null;
  __results.mktN = em ? em.n : 0;
  __results.mktVig = em ? em.vig : null;
  __results.modelFullRps = evalModel2022(RHO, HFA).rps; // mismo set que el mercado
  __results.outrightTeams = Object.keys(MARKET_2026_OUTRIGHT).length;
  const dvo = devigOutright(MARKET_2026_OUTRIGHT);
  __results.outrightSum = Object.values(dvo).reduce((a,b)=>a+b,0);
  __results.outrightCoversAll = ALL_TEAMS.every(t => t in MARKET_2026_OUTRIGHT);
  // 7) ensamble modelo + mercado
  const erows = ensembleRows2022(RHO, HFA);
  __results.ensRows = erows.length;
  const bl2 = blend([0.5,0.3,0.2],[0.4,0.4,0.2],0.5);
  __results.blendSum = bl2.reduce((a,b)=>a+b,0);
  const cal = calibrateW(erows);
  __results.calW = cal.w;
  __results.ensRps = evalEnsemble(erows, cal.w).rps;
  __results.modRpsCov = evalModel2022(RHO,HFA).rps;
  __results.loo = looEnsembleRps(erows);
  // 8) backtest multi-torneo
  __results.btTours = BACKTEST.length;
  __results.btMatches = BACKTEST.reduce((s,t)=>s+t.matches.length,0);
  const be = evalBacktest(RHO, HFA>0);
  const bci = bootstrapCI(be.eloR, 1000, 0.05, 0.95);
  __results.btRps = be.pooled.elo; __results.btUni = be.pooled.uni; __results.btImpr = 1-be.pooled.elo/be.pooled.uni;
  __results.btCiLo = bci.lo; __results.btCiHi = bci.hi;
  __results.btCiBrackets = bci.lo <= be.pooled.elo && be.pooled.elo <= bci.hi;
  __results.eloScoreLL = be.pooled.eloS; __results.adScoreLL = be.pooled.adS;
  // 9) ataque/defensa (roadmap 3)
  __results.adTeams = Object.keys(AD_RATINGS).length;
  __results.adCoversAll = ALL_TEAMS.every(t => t in AD_RATINGS);
  AD_ON=false; const lElo = lambdas("Brasil","Haiti");
  AD_ON=true;  const lAd = lambdas("Brasil","Haiti");
  __results.adLamSane = lAd[0]>0.12 && lAd[0]<6 && lAd[1]>0.12 && lAd[1]<6;
  __results.adLamDiffers = Math.abs(lAd[0]-lElo[0])>1e-6;
  __results.btAdPooled = be.pooled.ad; __results.btEloPooled = be.pooled.elo; __results.btAdCount = be.adR.length;
  const statAD={}; ALL_TEAMS.forEach(t=>statAD[t]={adv:0,r16:0,qf:0,sf:0,fin:0,champ:0});
  for(let i=0;i<2000;i++) runOne(statAD);
  let totAD=0; ALL_TEAMS.forEach(t=>totAD+=statAD[t].champ);
  __results.adMcSum=totAD; __results.adMcN=2000;
  AD_ON=false;
  // 10) bandas de confianza (roadmap 5)
  RATING_SD=60;
  const bands=runBands(12,800,RATING_SD);
  RATING_SD=0;
  __results.bandsTeams=Object.keys(bands).length;
  const fav=ALL_TEAMS.map(t=>({t,m:bands[t].mean})).sort((a,b)=>b.m-a.m)[0].t;
  const fb=bands[fav];
  __results.bandOrder = fb.lo<=fb.mean && fb.mean<=fb.hi && fb.lo>=0 && fb.hi<=1;
  __results.bandWidth = fb.hi-fb.lo;
  __results.bandFav = fav;
  // 11) chequeo con xG (StatsBomb)
  __results.xgTours = Object.keys(XG_DATA).length;
  let xgM=0; for(const t in XG_DATA) xgM+=Object.keys(XG_DATA[t].m).length;
  __results.xgMatches = xgM;
  const xc = xgCheck(RHO, HFA>0);
  __results.xgN = xc.nm; __results.xgEloGoals = xc.eloVsGoals; __results.xgEloXg = xc.eloVsXg; __results.xgNoise = xc.goalsVsXg;
  // 12) cuotas reales 2026 (The Odds API)
  __results.odds2026Teams = Object.keys(ODDS_2026_OUTRIGHT).length;
  __results.odds2026OutSum = Object.values(ODDS_2026_OUTRIGHT).reduce((a,b)=>a+b,0);
  let cov=0,total=0,sumOk=true;
  for(const g in FIX){FIX[g].forEach(([a,b])=>{total++;const mk=ODDS_2026_MATCHES[[a,b].slice().sort().join('|')];if(mk){cov++;const s=(mk[a]||0)+(mk['draw']||0)+(mk[b]||0);if(Math.abs(s-1)>0.02)sumOk=false;}});}
  __results.odds2026Cov=cov; __results.odds2026Total=total; __results.odds2026SumOk=sumOk;
  ENSEMBLE_W=0.5; qMode='likely'; overrides={};
  const blq=buildBracket(); let usedAny=false;
  Object.values(blq.groups).forEach(gp=>gp.matches.forEach(m=>{if(m.usedMkt)usedAny=true;}));
  __results.quinielaUsesMkt=usedAny;
  // 13) parleys (cuotas por casa + armador + puntuacion)
  __results.parlayMatches=Object.keys(PARLAY_ODDS).length;
  let pxOk=true,bestGeMed=true;
  for(const k in PARLAY_ODDS){const e=PARLAY_ODDS[k];for(const oc in e.px){const[bb,mm]=e.px[oc];if(!(bb>=1.01&&mm>=1.01))pxOk=false;if(bb<mm-1e-9)bestGeMed=false;}}
  __results.parlayPxOk=pxOk; __results.parlayBestGeMed=bestGeMed;
  ENSEMBLE_W=0.5;
  const pool=parlayPool(false);
  __results.parlayPoolH2h=pool.filter(l=>l.mkt==='h2h').length;
  __results.parlayPoolDc=pool.filter(l=>l.mkt==='dc').length;
  __results.parlayPoolScorer=pool.filter(l=>l.mkt==='scorer').length;
  __results.playerOddsMatches=Object.keys(PLAYER_ODDS_2026).length;
  const segL=buildParlayLegs(5,'seguro',pool),valL=buildParlayLegs(5,'valor',pool),agrL=buildParlayLegs(5,'agresivo',pool);
  __results.parlayLegs5=segL.length===5&&valL.length===5&&agrL.length===5;
  __results.parlayUnique=new Set(valL.map(l=>l.key)).size===5&&new Set(agrL.map(l=>l.key)).size===5;
  const sSeg=parlayStats(segL),sVal=parlayStats(valL),sAgr=parlayStats(agrL);
  __results.parlayStatsSane=[sSeg,sVal,sAgr].every(s=>s.pHit>0&&s.pHit<1&&s.comb>1&&s.comb>=s.combMed-1e-9&&isFinite(s.ev));
  __results.parlaySegSafest=sSeg.pHit>=sVal.pHit-1e-9&&sVal.pHit>=sAgr.pHit-1e-9;
  __results.parlayAgrBiggest=sAgr.comb>=sVal.comb-1e-9&&sVal.comb>=sSeg.comb-1e-9;
  __results.parlaySegComb=sSeg.comb; __results.parlaySegHit=sSeg.pHit;
  __results.parlayAgrComb=sAgr.comb; __results.parlayAgrHit=sAgr.pHit;
  __results.parlayValComb=sVal.comb; __results.parlayValHit=sVal.pHit; __results.parlayValEv=sVal.ev;
  // puntuacion: inyectar un resultado real y verificar acierto/fallo/empate (legs 1X2
  // explicitos: el top de 'valor' puede ser un leg de goleador o doble oportunidad)
  const l0=valL[0]; const[pt1,pt2]=l0.key.split('|');
  const h2hLeg=p=>({...l0,mkt:'h2h',pick:p,cover:[p]});
  RESULTS_2026[l0.key]=[2,0]; // gana pt1
  __results.parlayScoreWin=legResult(h2hLeg(pt1))==='win';
  __results.parlayScoreLoss=legResult(h2hLeg(pt2))==='loss';
  RESULTS_2026[l0.key]=[1,1];
  __results.parlayScoreDraw=legResult(h2hLeg('draw'))==='win'&&legResult(h2hLeg(pt1))==='loss';
  const legsOfL0=pool.filter(l=>l.key===l0.key).length;
  __results.parlayPlayedOut=parlayPool(false).length===pool.length-legsOfL0; // partido jugado sale del pool
  // boletos: guardar, estados vivo -> perdido / ganado (con legs 1X2, semantica simple)
  parlayTickets.length=0;
  const valH=buildParlayLegs(2,'valor',pool.filter(l=>l.mkt==='h2h'));
  const tk=saveParlayTicket(valH,100);
  __results.parlayTicketSaved=parlayTickets.length===1&&tk.legs.length===2&&tk.comb>1;
  delete RESULTS_2026[l0.key];
  __results.parlayStPend=ticketStatus(tk).state==='vivo';
  const w0=tk.legs[0],w1=tk.legs[1];
  const winRes=l=>{const[x,y]=l.key.split('|');return l.pick==='draw'?[1,1]:(l.pick===x?[2,0]:[0,2]);};
  const lossRes=l=>{const[x,y]=l.key.split('|');return l.pick===x?[0,2]:[2,0];};
  RESULTS_2026[w0.key]=winRes(w0); RESULTS_2026[w1.key]=lossRes(w1);
  __results.parlayStLost=ticketStatus(tk).state==='perdido'&&ticketStatus(tk).win===1;
  RESULTS_2026[w1.key]=winRes(w1);
  __results.parlayStWon=ticketStatus(tk).state==='ganado';
  delete RESULTS_2026[w0.key]; delete RESULTS_2026[w1.key];
  // exportar / importar JSON
  const ex=exportParlayTickets();
  parlayTickets.length=0;
  __results.parlayRoundtrip=importParlayTickets(ex)===1&&parlayTickets[0].legs.length===2;
  parlayTickets.length=0;
  // jornadas y variantes: el filtro se respeta y cada clic da un boleto distinto
  const v1=nextParlay(5,'valor',1),v2=nextParlay(5,'valor',1);
  __results.parlayMdRespected=v1.legs.length===5&&v1.legs.every(l=>l.md===1)&&v2.legs.every(l=>l.md===1);
  __results.parlayVariantsDiffer=v2.variant===2&&v1.legs.every(l=>!v2.legs.some(x=>x.key===l.key));
  // J1 tiene 24 partidos: las variantes 1-4 agotan 20; la 5 reinicia el ciclo (variante 1)
  nextParlay(5,'valor',1);nextParlay(5,'valor',1);
  __results.parlayCycleResets=nextParlay(5,'valor',1).variant===1;
  // cambiar la configuracion tambien reinicia
  __results.parlayCfgResets=nextParlay(5,'seguro',1).variant===1&&nextParlay(4,'seguro',0).variant===1;
  // 14) doble oportunidad y goleadores
  // dc: 1-3 por partido (se excluyen las de cuota sintetica <= 1.01, favoritos enormes),
  // prob = suma de los dos resultados, cuota sintetica entre 1 y la menor componente
  const dcAll=pool.filter(l=>l.mkt==='dc');
  const dcPerKey={};dcAll.forEach(l=>dcPerKey[l.key]=(dcPerKey[l.key]||0)+1);
  __results.dcPruned=dcAll.length>100&&dcAll.length<=216&&dcAll.every(l=>l.med>1.01)&&Object.values(dcPerKey).every(n=>n>=1&&n<=3);
  const fullKey=Object.keys(dcPerKey).find(k=>dcPerKey[k]===3);
  const m0=pool.find(l=>l.mkt==='h2h'&&l.key===fullKey); // partido con las 3 DC vivas
  const h2h0=pool.filter(l=>l.mkt==='h2h'&&l.key===m0.key);
  const dc0=pool.filter(l=>l.mkt==='dc'&&l.key===m0.key);
  __results.dcCount3=dc0.length===3;
  const dc1x=dc0.find(l=>l.cover.length===2&&l.cover.indexOf(m0.a)>=0&&l.cover.indexOf('draw')>=0);
  const pW0=h2h0.find(l=>l.pick===m0.a),pD0=h2h0.find(l=>l.pick==='draw');
  __results.dcProbSum=Math.abs(dc1x.pm-(pW0.pm+pD0.pm))<1e-9&&Math.abs(dc1x.pk-(pW0.pk+pD0.pk))<1e-9;
  __results.dcOddsSane=dc0.every(l=>l.best>1&&l.med>1&&l.best<=Math.min(...l.cover.map(c=>{const x=h2h0.find(h=>h.pick===c);return x?x.best:99;}))+1e-9);
  // dc: puntuacion con cover (empate: gana 1X y X2, pierde 12)
  RESULTS_2026[m0.key]=[1,1];
  const dcRes=dc0.map(l=>legResult(l));
  __results.dcScoring=dc0.filter((l,i)=>l.cover.indexOf('draw')>=0&&dcRes[i]==='win').length===2&&
                      dc0.filter((l,i)=>l.cover.indexOf('draw')<0&&dcRes[i]==='loss').length===1;
  delete RESULTS_2026[m0.key];
  // goleadores: prob del modelo y mercado sanas; nombres robustos a acentos
  const scs=pool.filter(l=>l.mkt==='scorer');
  __results.scorerProbsSane=scs.every(l=>l.pm>0&&l.pm<1&&l.pk>0&&l.pk<1);
  __results.scorerIfOdds=__results.playerOddsMatches===0||scs.length>0;
  __results.nameKeyOk=nameKey('Raúl Jiménez')===nameKey('Raul Jimenez')&&nameKey('Son Heung-min')===nameKey('Heung-min Son');
  if(scs.length){
    const s0=scs[0];
    RESULTS_2026[s0.key]=[0,0];
    __results.scorer00=legResult(s0)==='loss';            // 0-0: nadie anoto
    RESULTS_2026[s0.key]=[2,1];
    __results.scorerPendSinLista=legResult(s0)==='pend';  // goles sin lista de anotadores
    RESULTS_2026_SCORERS[s0.key]=[s0.player.toUpperCase()];
    __results.scorerWin=legResult(s0)==='win';            // robusto a mayusculas/acentos
    RESULTS_2026_SCORERS[s0.key]=['Otro Jugador'];
    __results.scorerLoss=legResult(s0)==='loss';
    delete RESULTS_2026[s0.key];delete RESULTS_2026_SCORERS[s0.key];
  }else{__results.scorer00=__results.scorerPendSinLista=__results.scorerWin=__results.scorerLoss=true;}
  // filtro de mercado en el armador
  const tDc=nextParlay(4,'seguro',0,'dc'),tSc=nextParlay(3,'valor',0,'scorer');
  __results.mktFilterDc=tDc.legs.length===4&&tDc.legs.every(l=>l.mkt==='dc');
  __results.mktFilterScorer=__results.playerOddsMatches===0||(tSc.legs.length===3&&tSc.legs.every(l=>l.mkt==='scorer'));
  // 15) banca: reto escalera
  const lad=buildLadder(6,'medio',null);
  const GAP=3*3600*1000;
  __results.ladBuild=lad.length===6
    &&lad.every((r,i)=>i===0||new Date(r.kick)-new Date(lad[i-1].kick)>=GAP) // inicio real: cobrar antes del siguiente
    &&lad.every(r=>r.med>=1.4&&r.med<=1.9)                   // banda del perfil
    &&lad.every(r=>r.mkt!=='scorer')                         // sin goleadores
    &&new Set(lad.map(r=>r.key)).size===6;                   // partidos unicos
  __results.ladKickHasTime=lad.every(r=>r.kick.length>10&&!isNaN(new Date(r.kick))); // hora real, no solo dia
  const lst=ladderStats(lad,100);
  const combL=lad.reduce((s,r)=>s*r.best,1),pAllL=lad.reduce((s,r)=>s*legPe(r),1);
  __results.ladMath=Math.abs(lst.final-100*combL)<1e-6&&Math.abs(lst.pAll-pAllL)<1e-12
    &&Math.abs(lst.evAbs-(pAllL*lst.final-100))<1e-6
    &&lst.rows.every((r,i)=>i===0||r.pCum<=lst.rows[i-1].pCum+1e-12)
    &&lst.bestStop>=0&&lst.bestStop<6;
  const L1=nextLadder(5,'conservador'),L2=nextLadder(5,'conservador');
  __results.ladVariants=L2.variant===2&&L1.rungs.every(r=>!L2.rungs.some(x=>x.key===r.key));
  // estado del reto: vivo -> roto / completado (resultados inyectados por cobertura)
  const lt={b0:100,rungs:L1.rungs.map(r=>({...r}))};
  const outsOf=l=>{const[x,y]=l.key.split('|');return[x,'draw',y];};
  const mkRes=(l,out)=>{const[x]=l.key.split('|');return out==='draw'?[1,1]:(out===x?[2,0]:[0,2]);};
  const winOut=l=>l.cover[0],lossOut=l=>outsOf(l).find(o=>l.cover.indexOf(o)<0);
  RESULTS_2026[lt.rungs[0].key]=mkRes(lt.rungs[0],winOut(lt.rungs[0]));
  const sV=ladderStatus(lt);
  __results.ladVivo=sV.state==='vivo'&&sV.step===2&&Math.abs(sV.bank-100*lt.rungs[0].best)<1e-9;
  RESULTS_2026[lt.rungs[1].key]=mkRes(lt.rungs[1],lossOut(lt.rungs[1]));
  const sR=ladderStatus(lt);
  __results.ladRoto=sR.state==='roto'&&sR.bank===0&&sR.step===2;
  lt.rungs.forEach(r=>RESULTS_2026[r.key]=mkRes(r,winOut(r)));
  const sC=ladderStatus(lt);
  __results.ladCompleto=sC.state==='completado'&&Math.abs(sC.bank-100*lt.rungs.reduce((s,r)=>s*r.best,1))<1e-6;
  lt.rungs.forEach(r=>delete RESULTS_2026[r.key]);
  // 16) banca: plan Kelly
  const plan=kellyPlan(1000,0.25,8);
  const kTeams=plan.rows.flatMap(r=>[r.leg.a,r.leg.b]);
  __results.kBuild=plan.rows.length>0&&plan.rows.length<=8
    &&plan.rows.every(r=>r.stake>0&&r.stake<=1000*0.05+1e-9)        // tope 5%
    &&plan.rows.every(r=>legVal(r.leg)>=1.02&&r.pe>=0.40)           // edge minimo + prob plausible
    &&new Set(plan.rows.map(r=>r.leg.key)).size===plan.rows.length  // partidos unicos
    &&new Set(kTeams).size===kTeams.length;                         // una apuesta por seleccion
  const r0=plan.rows[0];
  __results.kFormula=Math.abs(r0.stake-Math.min(1000*0.25*Math.max(0,(r0.pe*r0.o-1)/(r0.o-1)),50))<1e-6;
  __results.kChrono=plan.rows.every((r,i)=>i===0||plan.rows[i-1].leg.kick<=r.leg.kick); // primero lo que empieza primero
  __results.kEv=plan.evAbs>0&&Math.abs(plan.evAbs-plan.rows.reduce((s,r)=>s+r.stake*(r.pe*r.o-1),0))<1e-9;
  __results.kMc=plan.mc&&plan.mc.p5<=plan.mc.p50&&plan.mc.p50<=plan.mc.p95&&plan.mc.pNeg>=0&&plan.mc.pNeg<=1;
  // export/import incluye retos y planes
  bankLadders.length=0;bankPlans.length=0;parlayTickets.length=0;
  saveLadder(L1.rungs,100,'conservador');savePlan(plan,1000,0.25);
  const ex2=exportParlayTickets();
  bankLadders.length=0;bankPlans.length=0;
  importParlayTickets(ex2);
  __results.bankRoundtrip=bankLadders.length===1&&bankPlans.length===1&&bankLadders[0].rungs.length===5;
  bankLadders.length=0;bankPlans.length=0;parlayTickets.length=0;
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
check("Mercado 2022 cubre los 48 partidos de grupos", r.mkt2022cov === 48);
check("De-vig 1X2 normaliza a 1", Math.abs(r.devigSum - 1) < 1e-9);
check("RPS del mercado en rango razonable", r.mktRps > 0.1 && r.mktRps < 0.35);
check("Mercado puntuado sobre 48 partidos", r.mktN === 48);
check("Margen del corredor 2022 positivo y < 25%", r.mktVig > 0 && r.mktVig < 0.25);
check("Outright 2026 cubre 48 equipos", r.outrightTeams === 48 && r.outrightCoversAll);
check("De-vig outright normaliza a 1", Math.abs(r.outrightSum - 1) < 1e-9);
check("Ensamble: 48 partidos con cuota", r.ensRows === 48);
check("Ensamble: blend normaliza a 1", Math.abs(r.blendSum - 1) < 1e-9);
check("Ensamble: peso optimo en [0,1]", r.calW >= 0 && r.calW <= 1);
check("Ensamble optimo <= mejor componente", r.ensRps <= Math.min(r.mktRps, r.modRpsCov) + 1e-9);
check("Ensamble LOO en rango razonable", r.loo > 0.1 && r.loo < 0.35);
check("Backtest: 10 torneos, 338 partidos", r.btTours === 10 && r.btMatches === 338);
check("Backtest RPS agrupado en rango razonable", r.btRps > 0.1 && r.btRps < 0.35);
check("Backtest: el modelo mejora sobre uniforme", r.btRps < r.btUni && r.btImpr > 0);
check("Backtest: IC 90% contiene el RPS agrupado", r.btCiBrackets && r.btCiLo < r.btCiHi);
check("Ataque/Defensa cubre 48 equipos", r.adTeams === 48 && r.adCoversAll);
check("AD: lambdas sanas y distintas del Elo", r.adLamSane && r.adLamDiffers);
check("AD: backtest puntuado sobre 338 partidos", r.btAdCount === 338);
check("AD: RPS agrupado en rango razonable", r.btAdPooled > 0.1 && r.btAdPooled < 0.35);
check("AD: Monte Carlo conserva la masa", r.adMcSum === r.adMcN);
check("Log-loss de marcador sano (Elo y A/D)", r.eloScoreLL > 1 && r.eloScoreLL < 4 && r.adScoreLL > 1 && r.adScoreLL < 4);
check("Bandas: cubre 48 equipos", r.bandsTeams === 48);
check("Bandas: lo <= media <= hi en [0,1]", r.bandOrder);
check("Bandas: ancho positivo con sd>0", r.bandWidth > 0);
check("xG: 4 torneos cargados", r.xgTours === 4);
check("xG: cobertura de partidos razonable", r.xgMatches >= 150);
check("xG: chequeo sano (MAE positivos)", r.xgEloGoals > 0 && r.xgEloXg > 0 && r.xgN >= 150);
check("Cuotas 2026: outright cubre 48 y suma 1", r.odds2026Teams === 48 && Math.abs(r.odds2026OutSum - 1) < 2e-3);
check("Cuotas 2026: cubre los 72 partidos de grupos", r.odds2026Cov === 72 && r.odds2026Total === 72);
check("Cuotas 2026: cada partido (1X2) suma 1", r.odds2026SumOk);
check("Quiniela usa el ensamble con mercado 2026", r.quinielaUsesMkt);
check("Parleys: cuotas por casa cubren 72 partidos", r.parlayMatches === 72);
check("Parleys: precios sanos (>=1.01, mejor >= mediana)", r.parlayPxOk && r.parlayBestGeMed);
check("Parleys: pool 1X2 de 216 legs (72 x 3)", r.parlayPoolH2h === 216);
check("Parleys: pool doble oportunidad sano (1-3 por partido, cuota > 1.01)", r.dcPruned);
check("Parleys: hay legs de goleador si hay cuotas de jugador", r.scorerIfOdds && r.parlayPoolScorer > 0);
check("Parleys: arma 5 legs unicos por estrategia", r.parlayLegs5 && r.parlayUnique);
check("Parleys: stats sanas (prob en (0,1), cuota > 1, EV finito)", r.parlayStatsSane);
check("Parleys: orden seguro >= valor >= agresivo (prob) y al reves (cuota)", r.parlaySegSafest && r.parlayAgrBiggest);
check("Parleys: puntuacion de legs (gana/pierde/empate)", r.parlayScoreWin && r.parlayScoreLoss && r.parlayScoreDraw);
check("Parleys: partido jugado sale del pool", r.parlayPlayedOut);
check("Parleys: boleto vivo -> perdido / ganado", r.parlayTicketSaved && r.parlayStPend && r.parlayStLost && r.parlayStWon);
check("Parleys: exportar/importar JSON conserva boletos", r.parlayRoundtrip);
check("Parleys: el filtro de jornada se respeta al armar", r.parlayMdRespected);
check("Parleys: cada clic propone una variante sin repetir partidos", r.parlayVariantsDiffer);
check("Parleys: el ciclo reinicia al agotar la jornada o cambiar config", r.parlayCycleResets && r.parlayCfgResets);
check("Doble oportunidad: 3 picks por partido, prob = suma del 1X2", r.dcCount3 && r.dcProbSum);
check("Doble oportunidad: cuota sintetica sana (>1, < componentes)", r.dcOddsSane);
check("Doble oportunidad: puntuacion por cobertura (empate gana 1X y X2)", r.dcScoring);
check("Goleadores: prob. modelo y mercado en (0,1)", r.scorerProbsSane);
check("Goleadores: nombres robustos a acentos y orden", r.nameKeyOk);
check("Goleadores: puntuacion (0-0 falla, sin lista pende, anota gana)", r.scorer00 && r.scorerPendSinLista && r.scorerWin && r.scorerLoss);
check("Parleys: filtro de mercado en el armador (dc y goleadores)", r.mktFilterDc && r.mktFilterScorer);
check("Escalera: encadenada por inicio real (>=3h entre escalones)", r.ladBuild);
check("Escalera: kicks traen hora real (no solo dia)", r.ladKickHasTime);
check("Escalera: matematica exacta (banca, prob. acumulada, EV, parada)", r.ladMath);
check("Escalera: variantes sin repetir partidos", r.ladVariants);
check("Escalera: estado vivo -> roto / completado con banca correcta", r.ladVivo && r.ladRoto && r.ladCompleto);
check("Kelly: stakes con tope 5%, edge minimo, partidos unicos", r.kBuild);
check("Kelly: formula f* = (p*o-1)/(o-1) con fraccion", r.kFormula);
check("Kelly: plan en orden cronologico (inicio real)", r.kChrono);
check("Kelly: EV positivo y consistente con los stakes", r.kEv);
check("Kelly: Monte Carlo con percentiles ordenados", r.kMc);
check("Banca: export/import JSON incluye retos y planes", r.bankRoundtrip);

console.log("\nFavorito Monte Carlo:", r.favorite, "| RPS:", r.rps.toFixed(4), "| aciertos:", Math.round(r.hit*100)+"%");
console.log("Backtest RESULTADO (RPS) | Elo:", r.btEloPooled.toFixed(4), "| Ataque/Defensa:", r.btAdPooled.toFixed(4), "| uniforme:", r.btUni.toFixed(4));
console.log("Backtest MARCADOR (log-loss) | Elo:", r.eloScoreLL.toFixed(4), "| Ataque/Defensa:", r.adScoreLL.toFixed(4), "|", (r.adScoreLL < r.eloScoreLL ? "A/D mejora marcadores" : "Elo aguanta"));
console.log("Bandas (sd=60) | favorito:", r.bandFav, "| ancho IC90 campeon:", (r.bandWidth*100).toFixed(1)+" pp");
console.log("Chequeo xG ("+r.xgN+" partidos) | MAE lambda vs goles:", r.xgEloGoals.toFixed(3), "| vs xG:", r.xgEloXg.toFixed(3), "|", (r.xgEloXg < r.xgEloGoals ? "el modelo predice mejor el xG (goles = ruido)" : "—"), "| |goles-xG|/partido:", r.xgNoise.toFixed(2));
console.log("Cuotas 2026 reales | outright 48 equipos (suma "+r.odds2026OutSum.toFixed(3)+") | partidos cubiertos:", r.odds2026Cov+"/"+r.odds2026Total, "| quiniela usa mercado:", r.quinielaUsesMkt);
console.log("Benchmark mercado 2022 | RPS modelo (DC+localia):", r.modelFullRps.toFixed(4), "| RPS mercado:", r.mktRps.toFixed(4), "| margen:", (r.mktVig*100).toFixed(1)+"%", "|", (r.modelFullRps < r.mktRps ? "modelo gana" : "mercado gana"));
console.log("Ensamble | w* optimo:", r.calW.toFixed(2), "| RPS in-sample:", r.ensRps.toFixed(4), "| RPS leave-one-out:", r.loo.toFixed(4));
console.log("Parleys (5 legs) | seguro: cuota", r.parlaySegComb.toFixed(2), "prob", (r.parlaySegHit*100).toFixed(1)+"%", "| valor: cuota", r.parlayValComb.toFixed(2), "prob", (r.parlayValHit*100).toFixed(1)+"%", "EV", (r.parlayValEv*100).toFixed(1)+"%", "| agresivo: cuota", r.parlayAgrComb.toFixed(0), "prob", (r.parlayAgrHit*100).toFixed(2)+"%");
console.log("Mercados | 1X2:", r.parlayPoolH2h, "legs | doble oportunidad:", r.parlayPoolDc, "| goleadores:", r.parlayPoolScorer, "legs en", r.playerOddsMatches, "partidos con cuota de jugador");

const failed = checks.filter(c => !c[1]).length;
if (failed === 0) {
  console.log("\nTODAS LAS PRUEBAS PASARON (" + checks.length + ")");
  process.exit(0);
} else {
  console.log("\n" + failed + " PRUEBA(S) FALLARON");
  process.exit(1);
}
