/* ============================================================
   engine.js — Motor de goles y simulación Monte Carlo
   ------------------------------------------------------------
   Modelo Poisson con dos correcciones:
     - Ventaja de localía (HFA) para anfitriones (MEX/USA/CAN)
     - Corrección Dixon-Coles (RHO) sobre marcadores bajos
   Expone: lambdas, sampleScore, knockout, jointGrid, runOne
   (un torneo completo) y el estado mutable: ratings, HFA,
   DC_ON, RHO, más ALL_TEAMS y teamGroup.

   Validado contra la fase de grupos del Mundial 2022
   (ver validation.js). Depende de las constantes de data.js.
   ============================================================ */

// ----- Estado mutable del modelo (editable desde la UI) -----
let ratings={...DEFAULT_RATINGS};
let HFA=50, DC_ON=true, RHO=-0.13;

const ALL_TEAMS=Object.keys(DEFAULT_RATINGS);
const teamGroup={};for(const g in GROUPS)GROUPS[g].forEach(t=>teamGroup[t]=g);

/* ===== motor de goles: HFA + Dixon-Coles ===== */
const BASE=1.33,DIV=170,MAXG=8;
function clampL(x){return Math.min(6,Math.max(0.12,x));}
function effR(team,opp){let r=ratings[team];if(HFA>0&&HOSTS.has(team)&&!HOSTS.has(opp))r+=HFA;return r;}
function lambdas(a,b){const sup=(effR(a,b)-effR(b,a))/DIV;return[clampL(BASE+sup/2),clampL(BASE-sup/2)];}
function poisson(l){let L=Math.exp(-l),k=0,p=1;do{k++;p*=Math.random();}while(p>L);return k-1;}
function poissonPmf(k,l){let p=Math.exp(-l);for(let i=1;i<=k;i++)p*=l/i;return p;}
function tauDC(x,y,la,lb,rho){if(x===0&&y===0)return 1-la*lb*rho;if(x===0&&y===1)return 1+la*rho;if(x===1&&y===0)return 1+lb*rho;if(x===1&&y===1)return 1-rho;return 1;}
function jointGrid(la,lb,rho){const pa=[],pb=[];for(let k=0;k<=MAXG;k++){pa.push(poissonPmf(k,la));pb.push(poissonPmf(k,lb));}let s=0;const M=[];for(let x=0;x<=MAXG;x++){M.push([]);for(let y=0;y<=MAXG;y++){let v=pa[x]*pb[y]*tauDC(x,y,la,lb,rho);if(v<0)v=0;M[x].push(v);s+=v;}}for(let x=0;x<=MAXG;x++)for(let y=0;y<=MAXG;y++)M[x][y]/=s;return M;}
const _dcCache={};
function dcSample(la,lb){const key=Math.round(la*20)+"_"+Math.round(lb*20)+"_"+RHO;let cdf=_dcCache[key];if(!cdf){const M=jointGrid(la,lb,RHO);cdf=[];let acc=0;for(let x=0;x<=MAXG;x++)for(let y=0;y<=MAXG;y++){acc+=M[x][y];cdf.push([acc,x,y]);}_dcCache[key]=cdf;}const r=Math.random();for(let i=0;i<cdf.length;i++)if(r<=cdf[i][0])return[cdf[i][1],cdf[i][2]];return[0,0];}
function sampleScore(a,b){const[la,lb]=lambdas(a,b);return DC_ON?dcSample(la,lb):[poisson(la),poisson(lb)];}
function knockout(a,b){const[ga,gb]=sampleScore(a,b);if(ga>gb)return a;if(gb>ga)return b;let p=0.5+(effR(a,b)-effR(b,a))/2000;p=Math.min(0.65,Math.max(0.35,p));return Math.random()<p?a:b;}

function simulateGroup(teams){const st={};teams.forEach(t=>st[t]={p:0,gf:0,ga:0});for(let i=0;i<teams.length;i++)for(let j=i+1;j<teams.length;j++){const[x,y]=sampleScore(teams[i],teams[j]);st[teams[i]].gf+=x;st[teams[i]].ga+=y;st[teams[j]].gf+=y;st[teams[j]].ga+=x;if(x>y)st[teams[i]].p+=3;else if(y>x)st[teams[j]].p+=3;else{st[teams[i]].p++;st[teams[j]].p++;}}const ranked=teams.slice().sort((a,b)=>{if(st[b].p!==st[a].p)return st[b].p-st[a].p;const gda=st[a].gf-st[a].ga,gdb=st[b].gf-st[b].ga;if(gdb!==gda)return gdb-gda;if(st[b].gf!==st[a].gf)return st[b].gf-st[a].gf;return Math.random()-0.5;});return{ranked,st};}
function assignThirds(thirds){const res=new Array(8).fill(null),used=new Array(thirds.length).fill(false);function bt(s){if(s===8)return true;for(let i=0;i<thirds.length;i++){if(used[i])continue;if(THIRD_SLOTS[s].allowed.includes(thirds[i].grp)){used[i]=true;res[s]=thirds[i].team;if(bt(s+1))return true;used[i]=false;res[s]=null;}}return false;}bt(0);return res;}
function runOne(stat){const W={},R={},thirdsAll=[];for(const g in GROUPS){const{ranked,st}=simulateGroup(GROUPS[g]);W[g]=ranked[0];R[g]=ranked[1];const t=ranked[2];thirdsAll.push({team:t,grp:g,p:st[t].p,gd:st[t].gf-st[t].ga,gf:st[t].gf});}thirdsAll.sort((a,b)=>{if(b.p!==a.p)return b.p-a.p;if(b.gd!==a.gd)return b.gd-a.gd;if(b.gf!==a.gf)return b.gf-a.gf;return Math.random()-0.5;});const q=thirdsAll.slice(0,8);const ts=assignThirds(q);const usedSet=new Set(ts.filter(Boolean));let idx=0;for(let s=0;s<8;s++){if(!ts[s]){while(idx<q.length&&usedSet.has(q[idx].team))idx++;if(idx<q.length){ts[s]=q[idx].team;usedSet.add(q[idx].team);}}}const adv=new Set();for(const g in GROUPS){adv.add(W[g]);adv.add(R[g]);}q.forEach(t=>adv.add(t.team));adv.forEach(t=>stat[t].adv++);const ro32=RO32();const rs=s=>{const[t,k]=s;return t==="W"?W[k]:t==="R"?R[k]:ts[k];};const ro32w=[];for(let i=0;i<16;i++){const w=knockout(rs(ro32[i][0]),rs(ro32[i][1]));ro32w.push(w);stat[w].r16++;}const ro16w=RO16.map(([x,y])=>{const w=knockout(ro32w[x],ro32w[y]);stat[w].qf++;return w;});const qfw=QF.map(([x,y])=>{const w=knockout(ro16w[x],ro16w[y]);stat[w].sf++;return w;});const sfw=SF.map(([x,y])=>{const w=knockout(qfw[x],qfw[y]);stat[w].fin++;return w;});const champ=knockout(sfw[0],sfw[1]);stat[champ].champ++;}
let running=false;
function runModel(){if(running)return;running=true;const N=parseInt(document.getElementById('nsim').value);const stat={};ALL_TEAMS.forEach(t=>stat[t]={adv:0,r16:0,qf:0,sf:0,fin:0,champ:0});const btn=document.getElementById('run');btn.disabled=true;const fill=document.getElementById('progfill'),ps=document.getElementById('pstat');let done=0;const batch=Math.max(200,Math.floor(N/40));function step(){const end=Math.min(done+batch,N);for(;done<end;done++)runOne(stat);const pc=done/N;fill.style.width=(pc*100).toFixed(1)+'%';ps.textContent=Math.round(pc*100)+'%';if(done<N)setTimeout(step,0);else{render(stat,N);btn.disabled=false;running=false;ps.textContent='listo';}}step();}
