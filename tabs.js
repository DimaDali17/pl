/* ═══════════ ВКЛАДКИ ═══════════ */
function switchCo(c){
  curCo=c; applyCompany();
  const yl=document.getElementById('fYear'); const cur=yl.value;
  yl.innerHTML=M.years.map(y=>`<option>${y}</option>`).join('');
  if(M.years.includes(+cur))yl.value=cur;
  const arts=[...new Set(M.obshiy.filter(r=>r.vyks>0||r.zaks>0).map(r=>r.paG))].filter(Boolean).sort();
  document.getElementById('artList').innerHTML=arts.slice(0,1000).map(a=>`<option value="${String(a).replace(/"/g,'&quot;')}">`).join('');
  if(curTab==='pl')render(); else renderTab();
}
function tab(p){ curTab=p; document.querySelectorAll('#tabs .tab').forEach(t=>t.classList.toggle('on',t.dataset.p===p));
  ['pl','profit','adv','log','fix','check','razbor','komwb','insights'].forEach(x=>document.getElementById('page-'+x).style.display=x===p?'block':'none');
  document.getElementById('grpWrap').style.display=p==='pl'?'flex':'none';
  document.getElementById('pyWrap').style.display=p==='pl'?'flex':'none';
  if(M.loaded){ if(p==='pl')render(); else renderTab(); }
}
function monthTable(cols,y,q,months){
  const searchOK=r=>!q||r.paG.toLowerCase().includes(q); searchOK.agg=true;
  const rowM = months||[1,2,3,4,5,6,7,8,9,10,11,12]; const allM=[1,2,3,4,5,6,7,8,9,10,11,12];
  let h='<thead><tr><th>Месяц</th>'+cols.map(c=>`<th title="${c.t||c.l}">${c.l}</th>`).join('')+'</tr></thead><tbody>';
  rowM.forEach(m=>{ h+=`<tr><td>${MONTHS[m-1]}</td>`+cols.map(c=>`<td>${c.fn([m],searchOK)}</td>`).join('')+'</tr>'; });
  h+=`<tr class="total"><td>${months&&months.length<12?'Итог':'Всего'}</td>`+cols.map(c=>`<td>${c.fn(rowM,searchOK)}</td>`).join('')+'</tr></tbody>';
  return h;
}
/* разрез по предметам / артикулам (артикулы <100 заказов → «Прочее») */
function breakdownTable(cols,y,q,dim,months){
  const searchOK=r=>!q||r.paG.toLowerCase().includes(q); searchOK.agg=true;
  const mset=new Set(months||[1,2,3,4,5,6,7,8,9,10,11,12]);
  const acc={},ord={};
  for(const r of M.obshiy){ if(r.y!==y||!mset.has(r.m)||!searchOK(r))continue; const d=dim==='predmet'?predmetOf(r.paG):r.paG; acc[d]=(acc[d]||0)+r.vykr; ord[d]=(ord[d]||0)+r.zaks; }
  let dims=Object.keys(acc).sort((a,b)=>acc[b]-acc[a]); let rows;
  const mArr=[...mset];
  if(dim==='artikul'){ const big=dims.filter(d=>ord[d]>=100),small=dims.filter(d=>ord[d]<100);
    rows=big.map(D=>({label:D,filt:r=>r.paG===D&&searchOK(r)}));
    if(small.length){const sset=new Set(small);rows.push({label:`Прочее (${small.length} арт. <100)`,filt:r=>sset.has(r.paG)&&searchOK(r)});}
  } else { rows=dims.map(D=>({label:D,filt:r=>predmetOf(r.paG)===D&&searchOK(r)})); }
  cols=cols.filter(c=>!c.noBreak);
  const head=dim==='predmet'?'Предмет':'Артикул';
  let h=`<thead><tr><th>${head}</th>`+cols.map(c=>`<th title="${c.t||c.l}">${c.l}</th>`).join('')+'</tr></thead><tbody>';
  rows.forEach(r=>{ h+=`<tr><td title="${r.label}">${r.label}</td>`+cols.map(c=>`<td>${c.fn(mArr,r.filt)}</td>`).join('')+'</tr>'; });
  h+=`<tr class="total"><td>Всего</td>`+cols.map(c=>`<td>${c.fn(mArr,searchOK)}</td>`).join('')+'</tr></tbody>';
  return h;
}
function section(ttl,sub,tableHtml){return `<div class="sec"><div class="sh"><div class="st">${ttl}</div><div class="sm2">${sub||''}</div></div><div class="sw"><table>${tableHtml}</table></div></div>`;}
function tabTables(el,chart,title,sub,cols,y,q,months){
  const per = months&&months.length<12? ' · '+MONTHS[months[0]-1] : '';
  el.innerHTML=chart
    +section(`${title} по месяцам · ${y}`,sub,monthTable(cols,y,q,months))
    +section(`${title} по предметам · ${y}${per}`,'',breakdownTable(cols,y,q,'predmet',months))
    +section(`${title} по артикулам · ${y}${per}`,'артикулы <100 заказов → «Прочее»',breakdownTable(cols,y,q,'artikul',months));
}
const kf=v=>!v?'':(Math.abs(v)>=1000?Math.round(v/1000)+'к':Math.round(v));
/* пропорциональный график: столбцы (левая шкала) + линия (правая шкала), подписи над столбцами и точками */
function chartBL(labels,bars,line,o){
  o=o||{}; const W=920,H=225,pL=6,pR=6,pT=26,pB=22,iw=W-pL-pR,ih=H-pT-pB,n=labels.length,bw=iw/n;
  const maxB=Math.max(1,...bars.map(v=>Math.abs(v)||0));
  const lv=line.filter(v=>isFinite(v)&&v>0); const maxL=Math.max(1,...lv);
  const bx=i=>pL+bw*i+bw*0.28,bwid=bw*0.44,by=v=>pT+ih-(Math.max(0,v)/maxB*ih);
  const lx=i=>pL+bw*i+bw*0.5,ly=v=>pT+ih-(v/maxL*ih);
  const bc=o.barColor||'var(--blue)',lc=o.lineColor||'var(--amber)',lf=o.lineFmt||(v=>Math.round(v)),bf=o.barFmt;
  let s=`<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;font-family:Comfortaa">`;
  for(let g=1;g<=3;g++){const yy=(pT+ih-ih*g/4).toFixed(1);s+=`<line x1="${pL}" y1="${yy}" x2="${W-pR}" y2="${yy}" stroke="var(--border)" stroke-width="1"/>`;}
  bars.forEach((v,i)=>{const h=Math.max(0,v)/maxB*ih;s+=`<rect x="${bx(i).toFixed(1)}" y="${by(v).toFixed(1)}" width="${bwid.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${bc}" opacity="0.5"/>`;
    if(bf&&v)s+=`<text x="${lx(i).toFixed(1)}" y="${(by(v)-4).toFixed(1)}" text-anchor="middle" font-size="9.5" fill="var(--ink3)" font-weight="700">${bf(v)}</text>`;});
  const seg=[];line.forEach((v,i)=>{if(isFinite(v)&&v>0)seg.push(`${lx(i).toFixed(1)},${ly(v).toFixed(1)}`);});
  if(seg.length>1)s+=`<polyline points="${seg.join(' ')}" fill="none" stroke="${lc}" stroke-width="2.5"/>`;
  line.forEach((v,i)=>{if(isFinite(v)&&v>0){s+=`<circle cx="${lx(i).toFixed(1)}" cy="${ly(v).toFixed(1)}" r="3" fill="${lc}"/>`;
    s+=`<text x="${lx(i).toFixed(1)}" y="${(ly(v)-7).toFixed(1)}" text-anchor="middle" font-size="10" fill="var(--ink2)" font-weight="700">${lf(v)}</text>`;}});
  labels.forEach((L,i)=>{s+=`<text x="${lx(i).toFixed(1)}" y="${H-6}" text-anchor="middle" font-size="9.5" fill="var(--ink3)">${L}</text>`;});
  return s+'</svg>';
}
function chartCard(title,legend,svg){return `<div class="chartbox" style="margin-bottom:14px"><div class="chartttl">${title}</div><div class="leg">${legend}</div><div class="svgbox">${svg}</div></div>`;}
const legItem=(c,txt,op)=>`<span><i style="background:${c};${op?'opacity:'+op:''}"></i>${txt}</span>`;
const mns3=MONTHS.map(x=>x.slice(0,3));
function renderTab(){
  const y=+document.getElementById('fYear').value;
  const q=document.getElementById('fSearch').value.trim().toLowerCase();
  const mSel=document.getElementById('fMonth').value;
  const el=document.getElementById('page-'+curTab);
  const searchOK=r=>!q||r.paG.toLowerCase().includes(q); searchOK.agg=true;
  const all=[1,2,3,4,5,6,7,8,9,10,11,12];
  const sM = mSel?[+mSel]:all;
  const base=[
    {l:'Заказ,шт',t:'Заказано штук',fn:(m,f)=>fi(meas(y,m,f).zaks)},
    {l:'Выкуп,шт',t:'Выкуплено штук',fn:(m,f)=>fi(meas(y,m,f).vyks)},
    {l:'Вкп%',t:'Выкуп,шт ÷ Заказ,шт',fn:(m,f)=>fp(meas(y,m,f).vkp)},
  ];
  if(curTab==='adv'){
    const rekM=all.map(m=>meas(y,[m],searchOK).rek), drrM=all.map(m=>meas(y,[m],searchOK).drr);
    const chart=chartCard(`Реклама и ДРР.Or% по месяцам · ${y}`,
      legItem('var(--amber)','Реклама, ₽',.7)+legItem('var(--blue)','ДРР.Or%'),
      chartBL(mns3,rekM,drrM,{barColor:'var(--amber)',lineColor:'var(--blue)',lineFmt:v=>(v*100).toFixed(1)+'%',barFmt:kf}));
    const cols=[
      {l:'Выкуп,шт',t:'Выкуплено штук',fn:(m,f)=>fi(meas(y,m,f).vyks)},
      {l:'Выкуп,руб',t:'Выручка (К перечислению за товар)',fn:(m,f)=>fi(meas(y,m,f).vykr)},
      {l:'Реклама',t:'Расходы на рекламу (лист расход, группа «Реклама»). Для завершённых месяцев c апр.2026: если <30 000 ₽ → 300 000 ₽ (оценка)',fn:(m,f)=>fi(meas(y,m,f).rek)},
      {l:'Рекл.ВБ',t:'Реклама на площадке: строки листа Расход, где «Конкретнее» = реклама WB / продвижение / джем',fn:(m,f)=>fi(meas(y,m,f).rekMP)},
      {l:'Блогеры',t:'Внешнее продвижение: интеграции, блогеры — всё, что в «Конкретнее» не опознано как площадка',fn:(m,f)=>fi(meas(y,m,f).rekBlog)},
      {l:'Блог%',t:'Доля блогеров в рекламе',fn:(m,f)=>fp1(meas(y,m,f).rekBlogP)},
      {l:'Удерж.WB',t:'«Удержания» из финотчёта WB (WB Продвижение, Джем). Справочно — это те же деньги, что «Рекл.ВБ» в бухгалтерии, НЕ складываются',fn:(m,f)=>{const v=meas(y,m,f).rekWB;return v?fi(v):'—';}},
      {l:'ДРР.Sa%',t:'Реклама ÷ Выкуп,руб (ДРР от продаж)',fn:(m,f)=>fp1(meas(y,m,f).drrSa)},
      {l:'ДРР.Or%',t:'Реклама ÷ Заказ,руб (ДРР от заказов)',fn:(m,f)=>fp1(meas(y,m,f).drr)},
      {l:'Adv.CPO',t:'Реклама ÷ Заказ,шт (стоимость на заказ)',fn:(m,f)=>fi(meas(y,m,f).advCPO)},
      {l:'Adv.CPS',t:'Реклама ÷ Выкуп,шт (стоимость на продажу)',fn:(m,f)=>fi(meas(y,m,f).advCPS)},
    ];
    tabTables(el,chart,'Реклама','ДРР.Order — от заказов · ДРР.Sale — от выкупов',cols,y,q,sM);
  } else if(curTab==='log'){
    const dostM=all.map(m=>meas(y,[m],searchOK).dost), cpsM=all.map(m=>meas(y,[m],searchOK).logCPS);
    const chart=chartCard(`Доставка и Log.CPS по месяцам · ${y}`,
      legItem('var(--blue)','Доставка, ₽',.6)+legItem('var(--amber)','Log.CPS (на выкуп)'),
      chartBL(mns3,dostM,cpsM,{barColor:'var(--blue)',lineColor:'var(--amber)',lineFmt:v=>Math.round(v),barFmt:kf}));
    const cols=base.concat([
      {l:'Доставка',t:'Доставка (лист Лог+Хран)',fn:(m,f)=>fi(meas(y,m,f).dost)},
      {l:'Хранение',t:'Хранение (лист Лог+Хран)',fn:(m,f)=>fi(meas(y,m,f).hran)},
      {l:'Дост%',t:'Доставка ÷ Выкуп,руб',fn:(m,f)=>fp1(meas(y,m,f).dostP)},
      {l:'Хран%',t:'Хранение ÷ Выкуп,руб',fn:(m,f)=>fp1(meas(y,m,f).hranP)},
      {l:'Log.CPS',t:'Доставка ÷ Выкуп,шт',fn:(m,f)=>fi(meas(y,m,f).logCPS)},
      {l:'Stock.CPS',t:'Хранение ÷ Выкуп,шт',fn:(m,f)=>f2(meas(y,m,f).stockCPS)},
    ]);
    tabTables(el,chart,'Логистика','CPS — стоимость на 1 выкуп',cols,y,q,sM);
  } else if(curTab==='fix'){
    const hasPost=M.postR.length>0;
    const postSum=(mArr)=>{const ms=new Set(mArr);return M.postR.filter(r=>r.y===y&&ms.has(r.m)).reduce((s,r)=>s+r.summa,0);};
    const postM=all.map(m=>meas(y,[m],searchOK).postAkr);
    const chart=chartCard(`Пост.Р(+акр) по месяцам · ${y}`,legItem('#5B3FA0','Пост.Р(+акр), ₽',.6),
      chartBL(mns3,postM,all.map(_=>NaN),{barColor:'#5B3FA0',barFmt:kf}));
    const cols=base.concat([
      {l:'Постоянные',t:'Постоянные расходы (лист расход, «Пост расходы») с откатом на пр. месяц если 0',fn:(m,f)=>fi(meas(y,m,f).postAkr-meas(y,m,f).acr)},
      {l:'Акруалс',t:'Акруалс (отдельный лист Acruals)',fn:(m,f)=>fi(meas(y,m,f).acr)},
      {l:'Пост.Р(+акр)',t:'Постоянные + Акруалс',fn:(m,f)=>fi(meas(y,m,f).postAkr)},
      {l:'Fix.CPO',noBreak:1,t:'Постоянные всего ÷ Заказ,шт всего — осмысленно только на уровне «Всего», не по артикулам',fn:(m,f)=>{const M0=meas(y,m,f);const ps=hasPost?postSum(m):(M0.postAkr-M0.acr);return fi(DIV(ps,M0.zaks));}},
    ]);
    tabTables(el,chart,'Постоянные расходы',hasPost?'Fix.CPO из «ПОСТ затраты архив»':'Fix.CPO — добавьте лист «ПОСТ затраты архив»',cols,y,q,sM);
  } else if(curTab==='check'){
    const bars=all.map(m=>meas(y,[m],searchOK).zaks);
    const line=all.map(m=>meas(y,[m],searchOK).srchek);
    const chart=chartCard(`Заказ,шт и Ср.Чек по месяцам · ${y}`,
      legItem('var(--blue)','Заказ,шт',.5)+legItem('var(--amber)','Ср.Чек Заказа'),
      chartBL(mns3,bars,line,{barColor:'var(--blue)',lineColor:'var(--amber)',lineFmt:v=>Math.round(v),barFmt:kf}));
    const cols=[
      {l:'Заказ,шт',t:'Заказано штук',fn:(m,f)=>fi(meas(y,m,f).zaks)},
      {l:'Выкуп,шт',t:'Выкуплено штук',fn:(m,f)=>fi(meas(y,m,f).vyks)},
      {l:'Вкп%',t:'Выкуп,шт ÷ Заказ,шт',fn:(m,f)=>fp(meas(y,m,f).vkp)},
      {l:'Ср.Чек Заказа',t:'Заказ,руб ÷ Заказ,шт',fn:(m,f)=>fi(meas(y,m,f).srchek)},
      {l:'Цена (Выкуп)',t:'Выкуп,руб ÷ Выкуп,шт',fn:(m,f)=>fi(meas(y,m,f).cena)},
      {l:'Ср.Чек PY',t:'Ср.Чек Заказа прошлого года',fn:(m,f)=>fi(meas(y-1,m,f).srchek)},
    ];
    tabTables(el,chart,'Средний чек','Ср.Чек Заказа = Заказ,руб ÷ Заказ,шт',cols,y,q,sM);
  } else if(curTab==='razbor'){
    renderRazbor(el,y,q,sM);
  } else if(curTab==='komwb'){
    renderKomWB(el,y,q,sM);
  } else if(curTab==='profit'){
    renderProfit(el,y,q);
  } else if(curTab==='insights'){
    renderInsights(el,y,q);
  }
}
function renderProfit(el,y,q){
  const searchOK=r=>!q||r.paG.toLowerCase().includes(q); searchOK.agg=true;
  const all=[1,2,3,4,5,6,7,8,9,10,11,12];
  const nowY=new Date().getFullYear(),curMonth=(y===nowY)?Math.max(1,new Date().getMonth()):12;
  const ytd=all.filter(m=>m<=curMonth);
  const byYear=M.years.slice().sort((a,b)=>a-b).map(yy=>({y:yy,v:meas(yy,all,searchOK).pribFact}));
  const maxY=Math.max(1,...byYear.map(x=>Math.abs(x.v)));
  const yearBars=byYear.map(x=>`<div class="barrow"><div class="lbl">${x.y}</div><div class="track"><div class="fill ${x.v<0?'neg':''}" style="width:${Math.abs(x.v)/maxY*100}%"></div></div><div class="num">${fi(x.v)}</div></div>`).join('');
  const byYtd=M.years.slice().sort((a,b)=>a-b).map(yy=>({y:yy,v:meas(yy,ytd,searchOK).pribFact}));
  const maxYt=Math.max(1,...byYtd.map(x=>Math.abs(x.v)));
  const ytdBars=byYtd.map(x=>`<div class="barrow"><div class="lbl">${x.y} (янв–${MONTHS[curMonth-1].slice(0,3).toLowerCase()})</div><div class="track"><div class="fill ${x.v<0?'neg':''}" style="width:${Math.abs(x.v)/maxYt*100}%"></div></div><div class="num">${fi(x.v)}</div></div>`).join('');
  const cur=all.map(m=>meas(y,[m],searchOK).pribFact), prv=all.map(m=>meas(y-1,[m],searchOK).pribFact);
  const mom=chartGrouped(mns3,cur,prv,v=>v?(v/1e6).toFixed(1).replace('.',','):'');
  el.innerHTML=`
    <div class="chartgrid">
      <div class="chartbox"><div class="chartttl">Прибыль.Факт по годам</div><div style="max-width:460px">${yearBars}</div></div>
      <div class="chartbox"><div class="chartttl">Прибыль YTD (янв → ${MONTHS[curMonth-1].toLowerCase()})</div><div style="max-width:460px">${ytdBars}</div></div>
    </div>
    <div class="chartbox"><div class="chartttl">Помесячно, млн ₽: ${y} vs ${y-1}</div>
      <div class="leg">${legItem('var(--green)',y,'')+legItem('#B7D9C4',y-1,'')}</div>
      <div style="max-width:760px">${mom}</div></div>`;
}
/* сгруппированные столбцы: две серии рядом в слоте, с нулевой осью и подписями */
function chartGrouped(labels,s1,s2,fmt){
  const W=760,H=190,pL=8,pR=8,pT=22,pB=26,iw=W-pL-pR,ih=H-pT-pB,n=labels.length,bw=iw/n;
  const vals=s1.concat(s2).map(v=>v||0);
  const maxV=Math.max(0,...vals),minV=Math.min(0,...vals),range=(maxV-minV)||1;
  const zy=pT+ih*(maxV/range);
  const hOf=v=>Math.abs(v)/range*ih;
  const bwid=bw*0.30,gap=bw*0.08;
  let s=`<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;font-family:Comfortaa">`;
  s+=`<line x1="${pL}" y1="${zy.toFixed(1)}" x2="${W-pR}" y2="${zy.toFixed(1)}" stroke="var(--border2)" stroke-width="1"/>`;
  labels.forEach((L,i)=>{ const cx=pL+bw*i+bw/2;
    [[s1[i],'var(--green)','var(--red)',-1],[s2[i],'#B7D9C4','#E3AFAF',1]].forEach(([v,colPos,colNeg,side])=>{
      const val=v||0,h=hOf(val),x=side<0?cx-bwid-gap/2:cx+gap/2,yy=val>=0?zy-h:zy,col=val<0?colNeg:colPos;
      s+=`<rect x="${x.toFixed(1)}" y="${yy.toFixed(1)}" width="${bwid.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${col}"/>`;
      if(val)s+=`<text x="${(x+bwid/2).toFixed(1)}" y="${(val>=0?yy-3:zy+h+9).toFixed(1)}" text-anchor="middle" font-size="8" fill="${val<0?'var(--red)':'var(--ink3)'}" font-weight="700">${fmt(val)}</text>`;
    });
    s+=`<text x="${cx.toFixed(1)}" y="${H-6}" text-anchor="middle" font-size="9" fill="var(--ink3)">${L}</text>`;
  });
  return s+'</svg>';
}
