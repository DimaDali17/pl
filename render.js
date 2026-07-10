/* ═══════════ РЕНДЕР P&L ═══════════ */
let _t; function debouncedRender(){clearTimeout(_t);_t=setTimeout(render,250);}
function setGrp(g){grpMode=g;document.querySelectorAll('#grp button').forEach(b=>b.classList.toggle('on',b.dataset.g===g));render();}
function togglePY(){pyOn=!pyOn;document.getElementById('pyBtn').classList.toggle('act',pyOn);document.getElementById('pyBtn').textContent=pyOn?'✓ прошлый год':'＋ прошлый год';render();}

function render(){
  if(!M.loaded)return;
  if(curTab!=='pl'){renderTab();return;}
  const y=+document.getElementById('fYear').value;
  const mSel=document.getElementById('fMonth').value;
  const q=document.getElementById('fSearch').value.trim().toLowerCase();
  const slicerMonths=mSel?[+mSel]:[1,2,3,4,5,6,7,8,9,10,11,12];
  const searchOK=r=>!q||r.paG.toLowerCase().includes(q); searchOK.agg=true;

  /* строки в зависимости от среза */
  let rows=[];
  if(grpMode==='month'){
    rows=slicerMonths.map(m=>({label:MONTHS[m-1],v:meas(y,[m],searchOK),py:pyOn?meas(y-1,[m],searchOK):null}));
  } else {
    const dimOf = grpMode==='predmet'? (r=>predmetOf(r.paG)) : (r=>r.paG);
    const acc={},ord={}; const mset=new Set(slicerMonths);
    for(const r of M.obshiy){ if(r.y!==y||!mset.has(r.m)||!searchOK(r))continue; const d=dimOf(r); acc[d]=(acc[d]||0)+r.vykr; ord[d]=(ord[d]||0)+r.zaks; }
    let dims=Object.keys(acc).sort((a,b)=>acc[b]-acc[a]);
    if(grpMode==='artikul'){
      const big=dims.filter(d=>ord[d]>=100), small=dims.filter(d=>ord[d]<100);
      rows=big.map(D=>({label:D,v:meas(y,slicerMonths,r=>r.paG===D&&searchOK(r)),py:pyOn?meas(y-1,slicerMonths,r=>r.paG===D&&searchOK(r)):null}));
      if(small.length){ const sset=new Set(small);
        rows.push({label:`Прочее (${small.length} арт. <100 заказов)`,v:meas(y,slicerMonths,r=>sset.has(r.paG)&&searchOK(r)),py:pyOn?meas(y-1,slicerMonths,r=>sset.has(r.paG)&&searchOK(r)):null}); }
    } else {
      rows=dims.map(D=>({label:D,v:meas(y,slicerMonths,r=>predmetOf(r.paG)===D&&searchOK(r)),py:pyOn?meas(y-1,slicerMonths,r=>predmetOf(r.paG)===D&&searchOK(r)):null}));
    }
  }
  const tot={label:'Всего',v:meas(y,slicerMonths,searchOK),py:pyOn?meas(y-1,slicerMonths,searchOK):null};

  /* max для баров */
  const mx={};COLS.filter(c=>c.bar).forEach(c=>mx[c.k]=Math.max(1,...rows.map(r=>Math.abs(r.v[c.k]))));

  /* header */
  const firstCol = grpMode==='month'?'Месяц':grpMode==='predmet'?'Предмет':'Артикул';
  let h='<thead><tr><th>'+firstCol+'</th>';
  COLS.forEach(c=>{ h+=`<th class="${c.hl?'hl':''}" title="${c.t||c.l}">${c.l}</th>`; if(pyOn)h+=`<th class="py" title="${c.l} за прошлый год">${c.l} ᴾʸ</th>`; });
  h+='</tr></thead><tbody>';

  const cell=(c,v,isPY)=>{
    const val=v[c.k]; let inner=c.f(val);
    let cls=(c.hl?'hl ':'')+(isPY?'py ':'');
    if(c.k==='pribFact'&&!isPY)cls+=val>0?'pos ':val<0?'neg ':'';
    if(c.k==='rek'&&!isPY&&v.rekEst)cls+='est ';
    let bar='';
    if(c.bar&&!isPY){ const w=Math.abs(val)/mx[c.k]*100; const col=c.bar==='bl'?'bl':(val>=0?'g':'r'); bar=`<span class="bar ${col}" style="width:${w}%"></span>`; }
    const tip=(c.k==='rek'&&v.rekEst)?' title="оценка: факт < 30 000 → подставлено 300 000"':'';
    return `<td class="${cls.trim()}"${tip}>${bar}<span class="v">${inner}</span></td>`;
  };
  const rowHtml=(r,isTot)=>{
    const empty=!isTot&&r.v.vyks===0&&r.v.zaks===0&&r.v.vykr===0;
    let s=`<tr class="${isTot?'total':''} ${empty?'empty':''}"><td title="${r.label}">${r.label}</td>`;
    COLS.forEach(c=>{ s+=cell(c,r.v,false); if(pyOn)s+=cell(c,r.py,true); });
    return s+'</tr>';
  };
  rows.forEach(r=>h+=rowHtml(r,false)); h+=rowHtml(tot,true); h+='</tbody>';
  document.getElementById('matrix').innerHTML=h;

  /* KPI — сравнение YTD (янв → последний полный месяц) */
  const nowY=new Date().getFullYear(),nowM=new Date().getMonth()+1;
  const lastFull = (y===nowY)? Math.max(1,nowM-1) : 12;
  const ytdMonths=[];for(let m=1;m<=lastFull;m++)ytdMonths.push(m);
  const curYTD=meas(y,ytdMonths,searchOK).pribFact, prvYTD=meas(y-1,ytdMonths,searchOK).pribFact;
  const yoy2= prvYTD? (curYTD-prvYTD)/Math.abs(prvYTD):null;
  const perLabel = `к ${y-1} (янв–${MONTHS[lastFull-1].slice(0,3).toLowerCase()})`;
  const kpi=[
    {l:'Выручка (Выкуп,руб)',v:fi(tot.v.vykr)},
    {l:'Прибыль.Факт (асс.)',v:fi(tot.v.pribFact),c:tot.v.pribFact>=0?'g':'r',d:yoy2!=null?`<span class="${yoy2>=0?'du':'dd'}">${yoy2>=0?'▲':'▼'} ${fp1(Math.abs(yoy2))}</span> ${perLabel}`:''},
    {l:'Рентабельность (асс.)',v:fp(tot.v.pribFactP),c:tot.v.pribFactP>=0?'g':'r'},
    {l:'Выкуп %',v:fp(tot.v.vkp)}
  ];
  document.getElementById('kpi').innerHTML=kpi.map(k=>`<div class="mc"><div class="ml">${k.l}</div><div class="mv ${k.c||''}">${k.v}</div>${k.d?`<div class="md">${k.d}</div>`:''}</div>`).join('');
  document.getElementById('matrixTtl').textContent = grpMode==='month'?'P&L по месяцам':grpMode==='predmet'?'P&L по предметам':'P&L по артикулам (заказы ≥100, остальное → Прочее)';
  document.getElementById('matrixSub').textContent=`год ${y}${mSel?' · '+MONTHS[+mSel-1]:''}${q?' · '+q:''}`;
  document.getElementById('fInfo').textContent=`Общий: ${M.obshiy.length} строк`;
}
