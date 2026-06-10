/* ============================================================
   ui.js — Capa de presentación e interacción (DOM)
   ------------------------------------------------------------
   Render de la tabla de probabilidades, barras de campeón,
   editor de fuerzas (con carga de Elo oficial), ajustes del
   motor (HFA, Dixon-Coles) y navegación por pestañas.
   Orquesta engine.js, quiniela.js y validation.js sobre el
   DOM de index.html. Es el único módulo que toca el navegador
   directamente; engine/quiniela/validation son lógica pura
   (salvo el render embebido). Debe cargarse al final.
   ============================================================ */

// ----- Tabla de probabilidades y barras de campeón -----
let sortKey='champ',sortDir=-1,lastStat=null,lastN=0,lastBands=null;
function drawChampBars(){
  if(!lastStat)return;const N=lastN;
  const arr=ALL_TEAMS.map(t=>({t,c:lastStat[t].champ/N})).sort((a,b)=>b.c-a.c);
  const max=arr[0].c||1;const cb=document.getElementById('champbars');cb.innerHTML='';
  arr.slice(0,12).forEach((o,i)=>{
    const row=document.createElement('div');row.className='cbar';
    const b=lastBands&&lastBands[o.t];
    const band=b?`<div class="cband" style="left:${(b.lo/max*100).toFixed(1)}%;width:${(Math.max(0,b.hi-b.lo)/max*100).toFixed(1)}%"></div>`:'';
    const pct=b?`${(o.c*100).toFixed(1)}<span class="cbandtxt">${(b.lo*100).toFixed(1)}–${(b.hi*100).toFixed(1)}</span>`:`${(o.c*100).toFixed(1)}%`;
    row.innerHTML=`<div class="nm"><span class="rk">${i+1}</span>${o.t}</div><div class="track"><div class="fill" style="width:${(o.c/max*100).toFixed(1)}%"></div>${band}</div><div class="pct">${pct}</div>`;
    cb.appendChild(row);
  });
}
function render(stat,N){lastStat=stat;lastN=N;lastBands=null;document.getElementById('simcount').textContent=N.toLocaleString('es')+' sims';drawChampBars();renderTable();if(typeof renderMarketCompare==='function')renderMarketCompare(stat,N);}
function renderBands(bands){lastBands=bands;drawChampBars();renderTable();}
function renderTable(){if(!lastStat)return;const N=lastN;const rows=ALL_TEAMS.map(t=>({name:t,grp:teamGroup[t],rating:ratings[t],r16:lastStat[t].r16/N,qf:lastStat[t].qf/N,sf:lastStat[t].sf/N,fin:lastStat[t].fin/N,champ:lastStat[t].champ/N}));rows.sort((a,b)=>{let va=a[sortKey],vb=b[sortKey];if(sortKey==='name')return sortDir*va.localeCompare(vb);if(sortKey==='grp')return sortDir*(va<vb?-1:va>vb?1:0);return sortDir*(va-vb);});const tb=document.getElementById('rbody');tb.innerHTML='';rows.forEach(r=>{const tr=document.createElement('tr');const cell=v=>{const pct=v*100;return `<td class="mono heat ${pct>=25?'hot':''}">${pct<0.05?'·':pct.toFixed(1)}</td>`;};const host=HOSTS.has(r.name)?' <span class="hostdot">HOST</span>':'';const cb=lastBands&&lastBands[r.name];const champTxt=(r.champ*100)<0.05?'·':(r.champ*100).toFixed(1);const champBand=cb?` <span class="tband">${(cb.lo*100).toFixed(1)}–${(cb.hi*100).toFixed(1)}</span>`:'';tr.innerHTML=`<td class="team"><span class="gtag" style="background:${GROUP_COLORS[r.grp]}">${r.grp}</span>${r.name}${host}</td><td class="mono" style="color:var(--mut)">${r.grp}</td><td class="mono" style="color:var(--mut)">${r.rating}</td>${cell(r.r16)}${cell(r.qf)}${cell(r.sf)}${cell(r.fin)}<td class="mono" style="color:var(--accent);font-weight:600">${champTxt}${champBand}</td>`;tb.appendChild(tr);});document.querySelectorAll('#rtable th').forEach(th=>th.classList.toggle('sorted',th.dataset.k===sortKey));}
document.querySelectorAll('#rtable th').forEach(th=>th.addEventListener('click',()=>{const k=th.dataset.k;if(sortKey===k)sortDir*=-1;else{sortKey=k;sortDir=(k==='name'||k==='grp')?1:-1;}renderTable();}));

// ----- Editor de fuerzas y ajustes del motor -----
function buildEditor(){const grid=document.getElementById('grpgrid');grid.innerHTML='';for(const g in GROUPS){const card=document.createElement('div');card.className='gcard';card.innerHTML=`<h3>${tag(g)}Grupo ${g}</h3>`;GROUPS[g].forEach(t=>{const row=document.createElement('div');row.className='rrow';const host=HOSTS.has(t)?' <span class="hostdot">HOST</span>':'';const ver=ELO_VERIFIED.has(t)?' <span class="verdot" title="Elo verificado del top-20 publicado">VER</span>':'';const ad=(typeof AD_RATINGS!=='undefined')&&AD_RATINGS[t];const adt=ad?` title="Ataque ${ad.atk.toFixed(2)} · Defensa ${ad.def.toFixed(2)} (menor = mejor)"`:'';row.innerHTML=`<span${adt}>${t}${host}${ver}</span>`;const inp=document.createElement('input');inp.type='number';inp.value=ratings[t];inp.min=1300;inp.max=2300;inp.addEventListener('change',()=>{const v=parseInt(inp.value);if(!isNaN(v))ratings[t]=v;});row.appendChild(inp);card.appendChild(row);});grid.appendChild(card);}}
document.getElementById('resetRatings').addEventListener('click',()=>{ratings={...DEFAULT_RATINGS};buildEditor();});
document.getElementById('loadElo').addEventListener('click',()=>{let n=0;for(const t in ELO_OFFICIAL){if(t in ratings){ratings[t]=ELO_OFFICIAL[t];n++;}}buildEditor();const v=ELO_VERIFIED.size;document.getElementById('eloStat').textContent=n+' cargados · '+v+' verificados';});
document.getElementById('run').addEventListener('click',runModel);
/* ajustes motor */
document.getElementById('setHfa').addEventListener('change',e=>{const v=parseInt(e.target.value);if(!isNaN(v))HFA=v;});
document.getElementById('setRho').addEventListener('change',e=>{const v=parseFloat(e.target.value);if(!isNaN(v))RHO=v;Object.keys(_dcCache).forEach(k=>delete _dcCache[k]);});
document.querySelectorAll('#setDc button').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('#setDc button').forEach(x=>x.classList.remove('on'));btn.classList.add('on');DC_ON=btn.dataset.v==='1';}));
document.querySelectorAll('#setAd button').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('#setAd button').forEach(x=>x.classList.remove('on'));btn.classList.add('on');AD_ON=btn.dataset.v==='1';}));
document.getElementById('setRsd').addEventListener('change',e=>{let v=parseFloat(e.target.value);if(isNaN(v))v=0;v=Math.min(150,Math.max(0,v));RATING_SD=v;e.target.value=v;});
/* ensamble modelo + mercado */
function refreshEnsembleViews(){if(lastStat&&typeof renderMarketCompare==='function')renderMarketCompare(lastStat,lastN);if(typeof renderMarketBenchmark==='function')renderMarketBenchmark();if(typeof renderParlay==='function')renderParlay();}
document.getElementById('setEnsW').addEventListener('change',e=>{let v=parseFloat(e.target.value);if(isNaN(v))return;v=Math.min(1,Math.max(0,v));ENSEMBLE_W=v;e.target.value=v;document.getElementById('ensStat').textContent='peso '+v.toFixed(2);refreshEnsembleViews();});

// ----- Navegación por pestañas -----
document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));t.classList.add('active');['prob','quin','parlay','bank','valid','ratings'].forEach(id=>document.getElementById('tab-'+id).classList.toggle('hidden',id!==t.dataset.tab));if(t.dataset.tab==='valid'){runValidation();if(typeof renderBacktest==='function')renderBacktest();if(typeof renderMarketBenchmark==='function')renderMarketBenchmark();}if(t.dataset.tab==='parlay'&&typeof renderParlay==='function')renderParlay();if(t.dataset.tab==='bank'&&typeof renderBank==='function')renderBank();window.scrollTo({top:0,behavior:'smooth'});}));

// ----- Arranque -----
buildEditor();
