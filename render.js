/* ═══════════ РЕНДЕР P&L ═══════════ */
/* ── Месяцы: мультивыбор + завершённость ── */
function monthCompleted(y,m){
  if(!y)return true;   /* «за всё время» — все месяцы полные */
  const n=new Date(), ny=n.getFullYear(), nm=n.getMonth()+1;
  return (y<ny)||(y===ny&&m<nm);
}
function monthsWithData(y){
  const s=new Set();
  for(const r of M.obshiy){ if((!y||r.y===y)&&(r.vyks||r.zaks||r.vykr||r.dost||r.hran||r.rek||r.perem)) s.add(r.m); }
  return s;
}
function renderMonthChips(){
  const y=+document.getElementById('fYear').value;
  const has=monthsWithData(y);
  const box=document.getElementById('fMonths'); if(!box)return;
  let h='';
  for(let m=1;m<=12;m++){
    const done=monthCompleted(y,m), on=selMonths.has(m), dim=!done;
    const cls=['mchip']; if(on)cls.push('on'); if(dim)cls.push('dim'); if(!has.has(m))cls.push('nodata');
    h+=`<button class="${cls.join(' ')}" onclick="toggleMonth(${m})" title="${dim?'месяц не завершён':''}">${MONTHS[m-1].slice(0,3)}</button>`;
  }
  box.innerHTML=h;
}
function toggleMonth(m){ if(selMonths.has(m))selMonths.delete(m); else selMonths.add(m); renderMonthChips(); render(); }
function monthsDone(){ const y=+document.getElementById('fYear').value; selMonths=new Set(); for(let m=1;m<=12;m++) if(monthCompleted(y,m)) selMonths.add(m); renderMonthChips(); render(); }
function monthsAll(){ selMonths=new Set(); renderMonthChips(); render(); }


let _t; function debouncedRender(){clearTimeout(_t);_t=setTimeout(render,250);}
function setGrp(g){grpMode=g;document.querySelectorAll('#grp button').forEach(b=>b.classList.toggle('on',b.dataset.g===g));render();}
/* Кнопка среза «Всё время»: строки = год-месяц по всей истории, в одном листе */
function ensureAllBtn(){
  const box=document.getElementById('grp'); if(!box)return;
  if(box.querySelector('[data-g="ym"]'))return;
  const proto=box.querySelector('button'); if(!proto)return;
  const b=document.createElement('button');
  b.className=proto.className.replace(/\bon\b/,'').trim();
  b.dataset.g='ym'; b.textContent='Всё время';
  b.title='Все месяцы всех лет одним списком, без фильтра по году';
  b.onclick=()=>setGrp('ym');
  box.appendChild(b);
}
function togglePY(){pyOn=!pyOn;document.getElementById('pyBtn').classList.toggle('act',pyOn);document.getElementById('pyBtn').textContent=pyOn?'✓ прошлый год':'＋ прошлый год';render();}

/* Кнопка «реальные цифры» — только для Ozon и Консолида.
   Создаётся рядом с «＋ прошлый год», разметку в index.html править не нужно. */
/* Светло-золотая прозрачная заливка для колонок «без Баллов» */
function ensureNbStyle(){
  if(document.getElementById('nbStyle'))return;
  const st=document.createElement('style'); st.id='nbStyle';
  st.textContent=`
    #matrix th.nb, #matrix td.nb{ background:rgba(212,175,55,.13); }
    #matrix tr:hover td.nb{ background:rgba(212,175,55,.20); }
    #matrix tr.total td.nb{ background:rgba(212,175,55,.24); }
    #matrix th.nb{ background:rgba(212,175,55,.20); }
    #matrix th.nb.hl, #matrix td.nb.hl{ background:rgba(212,175,55,.26); }`;
  document.head.appendChild(st);
}

function ensureOzBtn(){
  const py=document.getElementById('pyBtn'); if(!py)return;
  let b=document.getElementById('ozBtn');
  const need=(curCo==='OZON'||curCo==='CONS');
  if(!b&&need){
    b=document.createElement('button');
    b.id='ozBtn'; b.className=py.className;
    b.title='Приставляет справа второй набор колонок: выручка без баллов Ozon, '
      +'комиссия = Вознаграждение − Баллы, ДРЛ% и ДРР% от неё же. Основные колонки не меняются.';
    b.textContent='＋ без Баллов';
    b.onclick=toggleNoBonus;
    py.parentNode.insertBefore(b,py.nextSibling);
  }
  if(b){ b.style.display=need?'':'none';
         b.classList.toggle('act',need&&typeof noBonus!=='undefined'&&noBonus);
         b.textContent=(need&&noBonus)?'✓ без Баллов':'＋ без Баллов'; }
}

/* Колонки: основные + (по кнопке) набор «без Баллов» справа */
function activeCols(){
  const nb=(curCo==='OZON'||curCo==='CONS')&&typeof noBonus!=='undefined'&&noBonus;
  if(!nb)return COLS;
  const byK={}; COLS_NB.forEach(c=>byK[c.k]=c);
  const out=[];
  COLS.forEach(c=>{ out.push(c);
    const nbk=NB_AFTER[c.k];               /* парная колонка встаёт сразу справа */
    if(nbk&&byK[nbk])out.push(byK[nbk]); });
  return out;
}
/* Универсальные подписи в навигации: «Комиссия ВБ» → «Комиссия», прочие ВБ → МП */
function fixNavLabels(){
  document.querySelectorAll('#tabs button, #tabs a, nav button, nav a').forEach(el=>{
    const t=(el.textContent||'').trim();
    if(/^Комиссия\s*(ВБ|WB)$/i.test(t)) el.textContent='Комиссия';
    else if(/\bВБ\b/.test(t)) el.textContent=t.replace(/\bВБ\b/g,'МП');
  });
}

function render(){
  if(!M.loaded)return;
  ensureNbStyle(); ensureOzBtn(); ensureAllBtn(); fixNavLabels();
  if(curTab!=='pl'){renderTab();return;}
  const y=+document.getElementById('fYear').value;
  const q=document.getElementById('fSearch').value.trim().toLowerCase();
  const slicerMonths=selMonths.size?[...selMonths].sort((a,b)=>a-b):[1,2,3,4,5,6,7,8,9,10,11,12];
  const searchOK=r=>!q||r.paG.toLowerCase().includes(q); searchOK.agg=true;

  /* строки в зависимости от среза */
  let rows=[];
  if(grpMode==='ym'){
    /* Все месяцы всей истории. Фильтр по году и чипсы месяцев игнорируются. */
    const seen=new Set();
    for(const r of M.obshiy){ if(!searchOK(r))continue;
      if(r.vyks||r.zaks||r.vykr||r.dost||r.hran||r.rek||r.perem) seen.add(r.y+'-'+String(r.m).padStart(2,'0')); }
    rows=[...seen].sort().map(k=>{ const yy=+k.slice(0,4), mm=+k.slice(5);
      return {label:`${MONTHS[mm-1].slice(0,3)} ${yy}`,v:meas(yy,[mm],searchOK),py:null}; });
  } else if(grpMode==='month'){
    rows=slicerMonths.map(m=>({label:MONTHS[m-1],v:meas(y,[m],searchOK),py:pyOn?meas(y-1,[m],searchOK):null}));
  } else {
    const dimOf = grpMode==='predmet'? (r=>predmetOf(r.paG)) : (r=>r.paG);
    const acc={},ord={}; const mset=new Set(slicerMonths);
    for(const r of M.obshiy){ if(r.y!==y||!mset.has(r.m)||!searchOK(r))continue; const d=dimOf(r); acc[d]=(acc[d]||0)+r.vykr; ord[d]=(ord[d]||0)+r.zaks; }
    let dims=Object.keys(acc).sort((a,b)=>acc[b]-acc[a]);
    if(grpMode==='artikul'){
      /* Показываем ВСЕ артикулы. Схлопывание «<100 заказов → Прочее» убрано:
         оно прятало и мелочь, и артикулы с битым ключом, из-за чего проблемы
         в данных было не видно. */
      rows=dims.map(D=>({label:D,v:meas(y,slicerMonths,r=>r.paG===D&&searchOK(r)),py:pyOn?meas(y-1,slicerMonths,r=>r.paG===D&&searchOK(r)):null}));
    } else {
      rows=dims.map(D=>({label:D,v:meas(y,slicerMonths,r=>predmetOf(r.paG)===D&&searchOK(r)),py:pyOn?meas(y-1,slicerMonths,r=>predmetOf(r.paG)===D&&searchOK(r)):null}));
    }
  }
  /* Итог: незавершённые месяцы (текущий и будущие) в сумму НЕ входят. */
  const totMonths=slicerMonths.filter(m=>monthCompleted(y,m));
  const tot=(grpMode==='ym')
    ? {label:'Всего за всё время',v:meas(0,[1,2,3,4,5,6,7,8,9,10,11,12],searchOK),py:null}
    : {label:'Всего',v:meas(y,totMonths,searchOK),py:pyOn?meas(y-1,totMonths,searchOK):null};

  /* max для баров */
  const CL=activeCols();
  const mx={};CL.filter(c=>c.bar).forEach(c=>mx[c.k]=Math.max(1,...rows.map(r=>Math.abs(r.v[c.k]))));

  /* header */
  const firstCol = grpMode==='ym'?'Период':grpMode==='month'?'Месяц':grpMode==='predmet'?'Предмет':'Артикул';
  let h='<thead><tr><th>'+firstCol+'</th>';
  CL.forEach(c=>{ h+=`<th class="${(c.hl?'hl ':'')+(c.nb?'nb':'')}" title="${c.t||c.l}">${c.l}</th>`; if(pyOn)h+=`<th class="py${c.nb?' nb':''}" title="${c.l} за прошлый год">${c.l} ᴾʸ</th>`; });
  h+='</tr></thead><tbody>';

  const cell=(c,v,isPY)=>{
    const val=v[c.k]; let inner=c.f(val);
    let cls=(c.hl?'hl ':'')+(isPY?'py ':'')+(c.nb?'nb ':'');
    if((c.k==='pribFact'||c.k==='nbPribFact')&&!isPY)cls+=val>0?'pos ':val<0?'neg ':'';
    if(c.k==='rek'&&!isPY&&v.rekEst)cls+='est ';
    let bar='';
    if(c.bar&&!isPY){ const w=Math.abs(val)/mx[c.k]*100; const col=c.bar==='bl'?'bl':(val>=0?'g':'r'); bar=`<span class="bar ${col}" style="width:${w}%"></span>`; }
    const tip=(c.k==='rek'&&v.rekEst)?' title="оценка: факт < 30 000 → подставлено 300 000"':'';
    return `<td class="${cls.trim()}"${tip}>${bar}<span class="v">${inner}</span></td>`;
  };
  const y2=+document.getElementById('fYear').value;
  const rowHtml=(r,isTot)=>{
    const empty=!isTot&&r.v.vyks===0&&r.v.zaks===0&&r.v.vykr===0;
    const incomplete=!isTot&&grpMode==='month'&&(()=>{const mi=MONTHS.indexOf(r.label)+1;return mi>0&&!monthCompleted(y2,mi);})();
    let s=`<tr class="${isTot?'total':''} ${empty?'empty':''} ${incomplete?'incomplete':''}"><td title="${r.label}${incomplete?' — месяц не завершён, в итог не входит':''}">${r.label}${incomplete?' <span class=\'inctag\'>идёт</span>':''}</td>`;
    CL.forEach(c=>{ s+=cell(c,r.v,false); if(pyOn)s+=cell(c,r.py,true); });
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
  document.getElementById('matrixTtl').textContent = grpMode==='ym'?'P&L за всё время (по месяцам)':grpMode==='month'?'P&L по месяцам':grpMode==='predmet'?'P&L по предметам':'P&L по артикулам';
  const msLbl=selMonths.size&&selMonths.size<12?' · '+[...selMonths].sort((a,b)=>a-b).map(m=>MONTHS[m-1].slice(0,3)).join(','):'';
  const ymLbl=(grpMode==='ym')?'вся история':'';
  const ozLbl=((curCo==='OZON'||curCo==='CONS')&&typeof noBonus!=='undefined'&&noBonus)?' · + колонки без баллов':'';
  document.getElementById('matrixSub').textContent=(ymLbl||`год ${y}${msLbl}`)+(q?' · '+q:'')+ozLbl;
  document.getElementById('fInfo').textContent=`Общий: ${M.obshiy.length} строк`;
}
