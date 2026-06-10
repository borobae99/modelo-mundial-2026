/* ============================================================
   quiniela.js — Predicción de un torneo completo (bracket)
   ------------------------------------------------------------
   Llena los 104 partidos para armar una quiniela. Dos modos:
     - 'likely'  : ruta del favorito, determinista. El marcador
                   es el modal CONDICIONADO al resultado más
                   probable (evita el sesgo a empates 1-1).
     - 'random'  : un sorteo único del motor, con azar real.
   Soporta overrides editables por el usuario (picks propios)
   que re-fluyen el cuadro hacia abajo, y una confianza por
   pick. Depende de engine.js (sampleScore, lambdas, jointGrid,
   effR) y data.js (FIX, RO32, RO16, QF, SF, THIRD_SLOTS).
   Render DOM en renderQuiniela() — para uso en navegador.
   ============================================================ */

/* ===== QUINIELA ===== */
let qMode='likely';
let overrides={}; // 'g:G:i'->'A'|'D'|'B' ; 'ko:round:idx'->'a'|'b'

function gridProbs(a,b){const[la,lb]=lambdas(a,b);const M=jointGrid(la,lb,RHO);let pW=0,pD=0,pL=0;for(let x=0;x<=MAXG;x++)for(let y=0;y<=MAXG;y++){if(x>y)pW+=M[x][y];else if(x===y)pD+=M[x][y];else pL+=M[x][y];}return{M,pW,pD,pL};}
function modalOf(M,outcome){let best=-1,bx=0,by=0;for(let x=0;x<=MAXG;x++)for(let y=0;y<=MAXG;y++){const ok=outcome==='W'?x>y:outcome==='D'?x===y:x<y;if(ok&&M[x][y]>best){best=M[x][y];bx=x;by=y;}}return[bx,by];}

function resolveGroupMatch(g,i,a,b){
  if(qMode==='random'){const[ga,gb]=sampleScore(a,b);return{a,b,ga,gb,win:ga>gb?a:(gb>ga?b:null),conf:null,forced:false,usedMkt:false};}
  const{M,pW,pD,pL}=gridProbs(a,b);
  // Ensamble con el mercado 2026: si hay cuotas reales del partido y el peso del modelo < 1,
  // mezcla las probabilidades del modelo con las del mercado (ENSEMBLE_W). El marcador sigue
  // siendo el modal del modelo (el mercado solo da 1X2, no marcadores).
  let bW=pW,bD=pD,bL=pL,usedMkt=false;
  const mk=(typeof ODDS_2026_MATCHES!=='undefined')?ODDS_2026_MATCHES[[a,b].slice().sort().join('|')]:null;
  if(mk&&ENSEMBLE_W<1){const w=ENSEMBLE_W,mW=mk[a]!=null?mk[a]:pW,mD=mk['draw']!=null?mk['draw']:pD,mL=mk[b]!=null?mk[b]:pL;bW=w*pW+(1-w)*mW;bD=w*pD+(1-w)*mD;bL=w*pL+(1-w)*mL;const s=bW+bD+bL||1;bW/=s;bD/=s;bL/=s;usedMkt=true;}
  const ov=overrides['g:'+g+':'+i];let outcome,forced=false;
  if(ov){forced=true;outcome=ov==='A'?'W':ov==='B'?'L':'D';}
  else outcome=bW>=bD&&bW>=bL?'W':bD>=bL?'D':'L';
  const[ga,gb]=modalOf(M,outcome);
  const win=outcome==='W'?a:outcome==='L'?b:null;
  const conf=outcome==='W'?bW:outcome==='D'?bD:bL;
  return{a,b,ga,gb,win,conf,forced,usedMkt};
}
function resolveKO(round,idx,a,b){
  if(qMode==='random'){const[ga,gb]=sampleScore(a,b);let win;if(ga!==gb)win=ga>gb?a:b;else{let p=0.5+(effR(a,b)-effR(b,a))/2000;p=Math.min(0.65,Math.max(0.35,p));win=Math.random()<p?a:b;}return{a,b,ga,gb,win,pen:ga===gb,conf:null,forced:false};}
  const{M,pW,pD,pL}=gridProbs(a,b);
  let penA=0.5+(effR(a,b)-effR(b,a))/2000;penA=Math.min(0.65,Math.max(0.35,penA));
  const advA=pW+pD*penA,advB=pL+pD*(1-penA);
  const ov=overrides['ko:'+round+':'+idx];let forced=false,side;
  if(ov){forced=true;side=ov;}else side=advA>=advB?'a':'b';
  const win=side==='a'?a:b;
  const outcomeMost=pW>=pD&&pW>=pL?'W':pD>=pL?'D':'L';
  let ga,gb,pen=false;
  if(outcomeMost==='D'){[ga,gb]=modalOf(M,'D');pen=true;}
  else if(side==='a'){[ga,gb]=modalOf(M,'W');}
  else{[ga,gb]=modalOf(M,'L');}
  const conf=side==='a'?advA:advB;
  return{a,b,ga,gb,win,pen,conf,forced};
}

function buildBracket(){
  const groups={};const W={},R={},thirdsAll=[];
  for(const g in GROUPS){
    const st={};GROUPS[g].forEach(t=>st[t]={p:0,gf:0,ga:0});
    const matches=FIX[g].map(([a,b],i)=>{const r=resolveGroupMatch(g,i,a,b);st[a].gf+=r.ga;st[a].ga+=r.gb;st[b].gf+=r.gb;st[b].ga+=r.ga;if(r.ga>r.gb)st[a].p+=3;else if(r.gb>r.ga)st[b].p+=3;else{st[a].p++;st[b].p++;}return r;});
    const rk=GROUPS[g].slice().sort((a,b)=>{if(st[b].p!==st[a].p)return st[b].p-st[a].p;const ga=st[a].gf-st[a].ga,gb=st[b].gf-st[b].ga;if(gb!==ga)return gb-ga;if(st[b].gf!==st[a].gf)return st[b].gf-st[a].gf;return ratings[b]-ratings[a];});
    groups[g]={matches,rk,st};W[g]=rk[0];R[g]=rk[1];const t=rk[2];thirdsAll.push({team:t,grp:g,p:st[t].p,gd:st[t].gf-st[t].ga,gf:st[t].gf});
  }
  thirdsAll.sort((a,b)=>{if(b.p!==a.p)return b.p-a.p;if(b.gd!==a.gd)return b.gd-a.gd;if(b.gf!==a.gf)return b.gf-a.gf;return ratings[b.team]-ratings[a.team];});
  const q=thirdsAll.slice(0,8);const qSet=new Set(q.map(t=>t.team));
  const ts=assignThirds(q);const usedSet=new Set(ts.filter(Boolean));let idx=0;
  for(let s=0;s<8;s++){if(!ts[s]){while(idx<q.length&&usedSet.has(q[idx].team))idx++;if(idx<q.length){ts[s]=q[idx].team;usedSet.add(q[idx].team);}}}
  const ro32def=RO32();const rs=s=>{const[t,k]=s;return t==="W"?W[k]:t==="R"?R[k]:ts[k];};
  const ro32=ro32def.map((m,i)=>{const a=rs(m[0]),b=rs(m[1]);return resolveKO('ro32',i,a,b);});
  const ro32w=ro32.map(m=>m.win);
  const ro16=RO16.map(([x,y],i)=>resolveKO('ro16',i,ro32w[x],ro32w[y]));
  const ro16w=ro16.map(m=>m.win);
  const qf=QF.map(([x,y],i)=>resolveKO('qf',i,ro16w[x],ro16w[y]));
  const qfw=qf.map(m=>m.win);
  const sf=SF.map(([x,y],i)=>resolveKO('sf',i,qfw[x],qfw[y]));
  const sfw=sf.map(m=>m.win);
  const sfl=sf.map(m=>m.win===m.a?m.b:m.a);
  const fin=resolveKO('final',0,sfw[0],sfw[1]);
  const third=resolveKO('third',0,sfl[0],sfl[1]);
  return{groups,qSet,ro32,ro16,qf,sf,final:fin,third,champ:fin.win};
}
function tag(g){return `<span class="gtag" style="background:${GROUP_COLORS[g]}">${g}</span>`;}
function confClass(c){return c>=0.6?'hi':c>=0.4?'mid':'lo';}
function confChip(c){if(c==null)return '';return `<span class="cf ${confClass(c)}">${Math.round(c*100)}%</span>`;}

function renderQuiniela(){
  const b=buildBracket();const editable=(qMode==='likely');
  const gw=document.getElementById('qgroups');gw.innerHTML='';
  for(const g in GROUPS){
    const data=b.groups[g];const card=document.createElement('div');card.className='qcard';
    let mh='';data.matches.forEach((m,i)=>{
      const cls='qm'+(editable?' clk':'')+(m.forced?' forced':'');
      mh+=`<div class="${cls}" data-gk="g:${g}:${i}"><span class="ta ${m.win===m.a?'w':''}">${m.a}</span><span class="scwrap"><span class="sc">${m.ga} – ${m.gb}</span>${confChip(m.conf)}</span><span class="tb ${m.win===m.b?'w':''}">${m.b}</span></div>`;
    });
    let sh='';data.rk.forEach((t,i)=>{const s=data.st[t];const adv=b.qSet.has(t);let pc='';if(i===0)pc='p1';else if(i===1)pc='p2';else if(i===2)pc=adv?'p3y':'p3n';else pc='p4';sh+=`<tr><td class="tn"><span class="pos ${pc}">${i+1}</span>${t}</td><td class="mono">${s.p}</td><td class="mono">${s.gf}:${s.ga}</td></tr>`;});
    card.innerHTML=`<div class="ghd">${tag(g)}<h3>Grupo ${g}</h3></div><div class="qmatches">${mh}</div><div class="qstand"><table><tr><th style="text-align:left">Pos</th><th>Pts</th><th>GF:GC</th></tr>${sh}</table></div>`;
    gw.appendChild(card);
  }
  const rounds=[{lbl:"Dieciseisavos",ties:b.ro32,r:'ro32'},{lbl:"Octavos",ties:b.ro16,r:'ro16'},{lbl:"Cuartos",ties:b.qf,r:'qf'},{lbl:"Semifinales",ties:b.sf,r:'sf'},{lbl:"Final",ties:[b.final],r:'final'}];
  const bw=document.getElementById('qbracket');bw.innerHTML='';
  rounds.forEach(rd=>{
    const col=document.createElement('div');col.className='rnd'+(rd.ties.length<=2?' center':'');col.innerHTML=`<div class="rlbl">${rd.lbl}</div>`;
    rd.ties.forEach((t,i)=>{
      const wa=t.win===t.a,wb=t.win===t.b;const div=document.createElement('div');div.className='tie'+(t.forced?' forced':'');
      const ec=editable?' clk':'';
      div.innerHTML=`<div class="tieside ${wa?'win':''}${ec}" data-ko="${rd.r}:${i}" data-side="a"><span class="tn">${tag(teamGroup[t.a])}${t.a}</span><span class="g">${t.ga}</span></div><div class="tieside ${wb?'win':''}${ec}" data-ko="${rd.r}:${i}" data-side="b"><span class="tn">${tag(teamGroup[t.b])}${t.b}</span><span class="g">${t.gb}</span></div><div class="tieconf">${t.pen?'<span class="pen">'+t.win+' en penales</span>':''}${t.conf!=null?'<span class="cf '+confClass(t.conf)+'">pasa '+t.win+' '+Math.round(t.conf*100)+'%</span>':''}</div>`;
      col.appendChild(div);
    });
    bw.appendChild(col);
  });
  const th=b.third;const wa=th.win===th.a;
  document.getElementById('qthird').innerHTML=`<div style="max-width:240px"><div style="font-family:'Spline Sans Mono';font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--mut);margin-bottom:6px">Tercer lugar</div><div class="tie"><div class="tieside ${wa?'win':''}"><span class="tn">${th.a}</span><span class="g">${th.ga}</span></div><div class="tieside ${!wa?'win':''}"><span class="tn">${th.b}</span><span class="g">${th.gb}</span></div>${th.pen?`<div class="tieconf"><span class="pen">${th.win} en penales</span></div>`:''}</div></div>`;
  document.getElementById('qchamp').innerHTML=`<div class="champ-banner"><div class="lab">Campeón del Mundo 2026</div><div class="nm">${b.champ}</div><div class="sub">Grupo ${teamGroup[b.champ]} · final ${b.final.a} ${b.final.ga}–${b.final.gb} ${b.final.b}${b.final.pen?' (pen)':''}</div></div>`;
  document.getElementById('qchampSec').classList.remove('hidden');document.getElementById('qkoSec').classList.remove('hidden');
  const nOv=Object.keys(overrides).length;
  const ens=(qMode==='likely'&&typeof ODDS_2026_MATCHES!=='undefined'&&ENSEMBLE_W<1)?' · grupos: '+Math.round(ENSEMBLE_W*100)+'% modelo + mercado 2026':'';
  document.getElementById('qstat').textContent=(qMode==='likely'?'ruta del favorito':'sorteo aleatorio')+ens+(nOv?' · '+nOv+' pick'+(nOv>1?'s':'')+' tuyo'+(nOv>1?'s':''):'');
}
let qGenerated=false;
function genq(){qGenerated=true;renderQuiniela();}
document.getElementById('genq').addEventListener('click',genq);
document.getElementById('reroll').addEventListener('click',()=>{if(qMode==='likely'){document.getElementById('qstat').textContent='usa "Escenario aleatorio" para variar';return;}renderQuiniela();});
document.getElementById('resetOv').addEventListener('click',()=>{overrides={};if(qGenerated)renderQuiniela();});
document.querySelectorAll('#qmode button').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('#qmode button').forEach(x=>x.classList.remove('on'));btn.classList.add('on');qMode=btn.dataset.m;if(qGenerated)renderQuiniela();}));
// edicion: delegacion de clicks
document.getElementById('qgroups').addEventListener('click',e=>{if(qMode!=='likely')return;const row=e.target.closest('.qm');if(!row)return;const k=row.dataset.gk;const cur=overrides[k];const cyc={undefined:'A','A':'D','D':'B','B':undefined};const nx=cyc[cur];if(nx===undefined)delete overrides[k];else overrides[k]=nx;renderQuiniela();});
document.getElementById('qbracket').addEventListener('click',e=>{if(qMode!=='likely')return;const sd=e.target.closest('.tieside');if(!sd||!sd.dataset.ko)return;const k='ko:'+sd.dataset.ko;const side=sd.dataset.side;if(overrides[k]===side)delete overrides[k];else overrides[k]=side;renderQuiniela();});
