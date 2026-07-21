/* ═══════════ РАЗБОР (waterfall) + КОМИССИЯ МП ═══════════
   Работает на данных финотчёта WB (parseWBFin): поля rozn, vv, vvNds, ekvair, pvz.
   Для кабинетов без финотчёта (EF пока, OZON) показывает заглушку.
   Вызывается из renderTab(): renderRazbor(el,y,q,sM) / renderKomWB(el,y,q,sM)
   ═══════════════════════════════════════════════════════════ */

/* ── шаги разложения: base — стартовая величина, sub — вычитаемое, res — промежуточный итог ── */
function rzSteps(k){
  const st=[
    {l:'Розничная цена',           v:k.rozn,      t:'base'},
    {l:'Скидка МП',                v:-k.skidkaWB, t:'sub', n:'за счёт площадки — не наш расход'},
    {l:'Реализовано (выручка)',    v:k.vykr,      t:'res'},
    {l:'Вознаграждение МП',        v:-(k.vv+k.ekvair+k.pvz), t:'sub',
       n:`что удерживает площадка (без НДС) · в т.ч. базовое ${fi(k.vv)} · эквайринг ${fi(k.ekvair)} · ПВЗ ${fi(k.pvz)}`},
    {l:'НДС с вознаграждения',     v:-k.vvNds,    t:'sub'},
  ];
  if(Math.abs(k.komOther)>1) st.push({l:'Прочие удержания',v:-k.komOther,t:'sub',n:'не разложено по компонентам'});
  st.push(
    {l:'К перечислению',           v:k.kPerech,   t:'res'},
    {l:'Логистика',                v:-k.dost,     t:'sub'},
    {l:'Хранение',                 v:-k.hran,     t:'sub'},
    {l:'Налог',                    v:-k.nalog,    t:'sub'});
  if(k.perem) st.push({l:'Переменные',v:-k.perem,t:'sub'});
  if(k.komp)  st.push({l:'Компенсации МП',v:k.komp,t:'add',n:'площадка платит за брак/утерю — доход, прибавляется'});
  st.push({l:'Пр.Опер',            v:k.pribOper,  t:'res'});
  if(k.rek)     st.push({l:'Реклама',v:-k.rek,t:'sub',
                  n:k.rekWB?`из бухгалтерии; в финотчёте площадки удержано ${fi(k.rekWB)} ₽`:''});
  if(k.postAkr) st.push({l:'Пост.Р + акруалс',      v:-k.postAkr,t:'sub'});
  st.push({l:'Пр.Факт',            v:k.pribFact,  t:'res'});
  return st;
}

/* ── горизонтальный waterfall ── */
function chartWaterfall(k){
  const st=rzSteps(k);
  const W=920,BH=24,GAP=7,PADL=185,PADR=130,H=st.length*(BH+GAP)+10;
  const base=Math.max(k.rozn,1), sc=(W-PADL-PADR)/base;
  let run=0,y=6,s=`<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;font-family:Comfortaa">`;
  st.forEach(step=>{
    let x0,w,col;
    if(step.t==='sub'||step.t==='add'){
      const from=run; run+=step.v;              /* sub: v<0 (расход) · add: v>0 (доход) */
      x0=PADL+run*sc; w=(from-run)*sc;
      col=(step.v>=0)?'var(--green)':'var(--red)';
    } else {
      run=step.v; x0=PADL; w=step.v*sc;
      col=(step.t==='base')?'var(--blue)':'var(--green)';
    }
    if(w<0){x0+=w;w=-w;}
    w=Math.max(w,1.5);
    const pct=k.rozn?Math.abs(step.v)/k.rozn*100:0;
    s+=`<text x="${PADL-8}" y="${y+16}" text-anchor="end" font-size="10.5" font-weight="700" fill="var(--ink2)">${step.l}</text>`
     + `<rect x="${x0.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${BH}" rx="3" fill="${col}" opacity="${step.t==='sub'?0.55:0.75}"/>`
     + `<text x="${(x0+w+7).toFixed(1)}" y="${y+16}" font-size="10" font-weight="700" fill="var(--ink2)">${fi(step.v)}</text>`
     + `<text x="${W-4}" y="${y+16}" text-anchor="end" font-size="9.5" fill="var(--ink3)">${pct.toFixed(1).replace('.',',')}%</text>`;
    y+=BH+GAP;
  });
  return s+'</svg>';
}

/* ── таблица «шаги × месяцы» ── */
function rzStepTable(y,searchOK,months){
  const totK=meas(y,months,searchOK), steps=rzSteps(totK);
  const perM=months.map(m=>rzSteps(meas(y,[m],searchOK)));
  let h='<thead><tr><th>Показатель</th>'
    +months.map(m=>`<th>${MONTHS[m-1].slice(0,3)}</th>`).join('')
    +'<th>Итого</th><th title="доля от розничной цены">% розн.</th></tr></thead><tbody>';
  steps.forEach((s,i)=>{
    const cls=s.t==='res'?'total':(s.t==='base'?'rzbase':'');
    const nm=s.t==='sub'?`<span class="rzsub">${s.l}</span>`:(s.t==='add'?`<span class="rzadd">${s.l}</span>`:s.l);
    h+=`<tr class="${cls}"${s.n?` title="${s.n}"`:''}><td>${nm}</td>`
      +perM.map(P=>`<td>${fi(P[i]?P[i].v:0)}</td>`).join('')
      +`<td>${fi(s.v)}</td><td class="hl">${totK.rozn?fp1(Math.abs(s.v)/totK.rozn):'—'}</td></tr>`;
  });
  return h+'</tbody>';
}

/* ═══════════ ВКЛАДКА «РАЗБОР» ═══════════ */
function renderRazbor(el,y,q,sM){
  const searchOK=r=>!q||r.paG.toLowerCase().includes(q); searchOK.agg=true;
  const K=meas(y,sM,searchOK);
  if(!K.rozn){ el.innerHTML=rzStub(); return; }
  const per=sM.length<12?' · '+MONTHS[sM[0]-1]:'';
  const chart=chartCard(`Waterfall · ${y}${per}`,
    legItem('var(--blue)','Розничная цена',.75)+legItem('var(--red)','Расходы / скидка',.55)+legItem('var(--green)','Итоги',.75),
    chartWaterfall(K));
  el.innerHTML=section(`Разбор по месяцам · ${y}`,
      `розничная → скидка МП → выручка → комиссия → логистика → налог → прибыль · комиссия ${fp1(K.komRoznP)} от розничной, ${fp1(K.komP)} от реализованной`,
      rzStepTable(y,searchOK,sM))
    +chart
    +section(`Разбор по предметам · ${y}${per}`,'',breakdownTable(rzCols(y),y,q,'predmet',sM))
    +section(`Разбор по артикулам · ${y}${per}`,'',breakdownTable(rzCols(y),y,q,'artikul',sM));
}

/* ═══════════ ВКЛАДКА «КОМИССИЯ» ═══════════ */
function rzCols(y){
  return [
    {l:'Розничная',    t:'Цена розничная × Кол-во (до скидки площадки)',        fn:(m,f)=>fi(meas(y,m,f).rozn)},
    {l:'Скидка МП',    t:'Розничная − Реализовано. За счёт площадки, не наш расход', fn:(m,f)=>fi(meas(y,m,f).skidkaWB)},
    {l:'Реализовано',  t:'Выручка площадки — что заплатил покупатель (у WB «Вайлдберриз реализовал Товар (Пр)»)', fn:(m,f)=>fi(meas(y,m,f).vykr)},
    {l:'Вознаграждение МП',t:'Полное вознаграждение площадки без НДС = базовое ВВ + эквайринг + ПВЗ (что WB удерживает с нас)', fn:(m,f)=>{const k=meas(y,m,f);return fi(k.vv+k.ekvair+k.pvz);}},
    {l:'в т.ч. базовое',t:'Вознаграждение Вайлдберриз (ВВ) без НДС — базовая часть', fn:(m,f)=>fi(meas(y,m,f).vv)},
    {l:'в т.ч. эквайринг',t:'Компенсация платёжных услуг — часть вознаграждения площадки', fn:(m,f)=>fi(meas(y,m,f).ekvair)},
    {l:'в т.ч. ПВЗ',   t:'Возмещение за выдачу и возврат товаров на ПВЗ — часть вознаграждения площадки', fn:(m,f)=>fi(meas(y,m,f).pvz)},
    {l:'НДС с возн.',  t:'НДС с вознаграждения маркетплейса',              fn:(m,f)=>fi(meas(y,m,f).vvNds)},
    {l:'Ком.итого',    t:'Реализовано − К перечислению = Вознаграждение МП (уже с эквайрингом и ПВЗ) + НДС', fn:(m,f)=>fi(meas(y,m,f).kom)},
    {l:'Эквайр.счёт',  t:'Эквайринг типа «Комиссия за организацию платежа» — НЕ удержан из выплаты, площадка выставляет его отдельным счётом. В прибыли пока НЕ учитывается', fn:(m,f)=>{const v=meas(y,m,f).ekvBill;return v?fi(v):'—';}},
    {l:'Компенс',      t:'Компенсации площадки продавцу за брак/утерю/подмену (обоснования «Добровольная компенсация при возврате», «Компенсация ущерба»). Доход — прибавляется к прибыли', fn:(m,f)=>{const v=meas(y,m,f).komp;return v?fi(v):'—';}},
    {l:'Ком%розн',     t:'Комиссия ÷ Розничная цена',                     fn:(m,f)=>fp1(meas(y,m,f).komRoznP)},
    {l:'Ком%реализ',   t:'Комиссия ÷ Реализовано',                      fn:(m,f)=>fp1(meas(y,m,f).komP)},
  ];
}
function renderKomWB(el,y,q,sM){
  const searchOK=r=>!q||r.paG.toLowerCase().includes(q); searchOK.agg=true;
  const K=meas(y,sM,searchOK);
  if(!K.rozn){ el.innerHTML=rzStub(); return; }
  const all=[1,2,3,4,5,6,7,8,9,10,11,12];
  const komM=scopeSeries((yy,mm)=>meas(yy,mm,searchOK).kom);
  const pctM=scopeSeries((yy,mm)=>meas(yy,mm,searchOK).komRoznP);
  const chart=chartCard(`Комиссия МП и её доля от розничной · ${scopeTtl(y)}`,
    legItem('var(--red)','Комиссия, ₽',.55)+legItem('var(--blue)','Ком% от розничной'),
    chartBL(scopeAxis(),komM,pctM,{barColor:'var(--red)',lineColor:'var(--blue)',lineFmt:v=>(v*100).toFixed(1)+'%',barFmt:kf,leftTitle:'₽',rightTitle:'Ком %',lineMax:0.5}));
  const sub=`структура: вознаграждение ${fp1(K.vvP+K.ekvairP+K.pvzP)} (в т.ч. базовое ${fp1(K.vvP)} · эквайринг ${fp1(K.ekvairP)} · ПВЗ ${fp1(K.pvzP)}) · НДС ${fp1(K.vvNdsP)} — от розничной`
    +(Math.abs(K.komOther)>1?` · ⚠ не разложено: ${fi(K.komOther)} ₽`:'');
  tabTables(el,chart,'Комиссия',sub,rzCols(y),y,q,sM);
}

function rzStub(){
  return `<div class="scaffold"><b>Нет данных финотчёта для кабинета «${curCo}».</b><br><br>
    Разбор и детализация комиссии строятся из еженедельного финансового отчёта маркетплейса.
    Для Ozon разложение по компонентам комиссии недоступно: в отчёте по начислениям
    вознаграждение приходит одной строкой, без разбивки на вознаграждение / НДС / эквайринг / ПВЗ.
    Смотрите вкладку P&amp;L и кнопку «без Баллов».</div>`;
}
