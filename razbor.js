/* ═══════════ РАЗБОР (waterfall) + КОМИССИЯ ВБ ═══════════
   Работает на данных финотчёта WB (parseWBFin): поля rozn, vv, vvNds, ekvair, pvz.
   Для кабинетов без финотчёта (EF пока, OZON) показывает заглушку.
   Вызывается из renderTab(): renderRazbor(el,y,q,sM) / renderKomWB(el,y,q,sM)
   ═══════════════════════════════════════════════════════════ */

/* ── шаги разложения: base — стартовая величина, sub — вычитаемое, res — промежуточный итог ── */
function rzSteps(k){
  const st=[
    {l:'Розничная цена',           v:k.rozn,      t:'base'},
    {l:'Скидка WB',                v:-k.skidkaWB, t:'sub', n:'за счёт WB — не наш расход'},
    {l:'ВБ реализовал (выручка)',  v:k.vykr,      t:'res'},
    {l:'ВВ без НДС',               v:-k.vv,       t:'sub'},
    {l:'НДС с ВВ',                 v:-k.vvNds,    t:'sub'},
    {l:'Эквайринг',                v:-k.ekvair,   t:'sub'},
    {l:'ПВЗ',                      v:-k.pvz,      t:'sub'},
  ];
  if(Math.abs(k.komOther)>1) st.push({l:'Прочие удержания',v:-k.komOther,t:'sub',n:'не разложено по компонентам'});
  st.push(
    {l:'К перечислению',           v:k.kPerech,   t:'res'},
    {l:'Логистика',                v:-k.dost,     t:'sub'},
    {l:'Хранение',                 v:-k.hran,     t:'sub'},
    {l:'Налог',                    v:-k.nalog,    t:'sub'});
  if(k.perem) st.push({l:'Переменные',v:-k.perem,t:'sub'});
  if(k.komp)  st.push({l:'Компенсации WB',v:k.komp,t:'add',n:'WB платит за брак/утерю — доход, прибавляется'});
  st.push({l:'Пр.Опер',            v:k.pribOper,  t:'res'});
  if(k.rek)     st.push({l:'Реклама',v:-k.rek,t:'sub',
                  n:k.rekWB?`из бухгалтерии; в финотчёте WB удержано ${fi(k.rekWB)} ₽`:''});
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
      `розничная → скидка WB → выручка → комиссия → логистика → налог → прибыль · комиссия ${fp1(K.komRoznP)} от розничной, ${fp1(K.komP)} от реализованной`,
      rzStepTable(y,searchOK,sM))
    +chart
    +section(`Разбор по предметам · ${y}${per}`,'',breakdownTable(rzCols(y),y,q,'predmet',sM))
    +section(`Разбор по артикулам · ${y}${per}`,'артикулы <100 заказов → «Прочее»',breakdownTable(rzCols(y),y,q,'artikul',sM));
}

/* ═══════════ ВКЛАДКА «КОМИССИЯ ВБ» ═══════════ */
function rzCols(y){
  return [
    {l:'Розничная',    t:'Цена розничная × Кол-во (до скидки WB)',        fn:(m,f)=>fi(meas(y,m,f).rozn)},
    {l:'Скидка WB',    t:'Розничная − ВБ реализовал. За счёт WB, не наш расход', fn:(m,f)=>fi(meas(y,m,f).skidkaWB)},
    {l:'ВБ реализ.',   t:'«Вайлдберриз реализовал Товар (Пр)» — что заплатил покупатель', fn:(m,f)=>fi(meas(y,m,f).vykr)},
    {l:'ВВ без НДС',   t:'Вознаграждение Вайлдберриз без НДС',            fn:(m,f)=>fi(meas(y,m,f).vv)},
    {l:'НДС с ВВ',     t:'НДС с вознаграждения Вайлдберриз',              fn:(m,f)=>fi(meas(y,m,f).vvNds)},
    {l:'Эквайринг',    t:'Компенсация платёжных услуг',                   fn:(m,f)=>fi(meas(y,m,f).ekvair)},
    {l:'ПВЗ',          t:'Возмещение за выдачу и возврат товаров на ПВЗ', fn:(m,f)=>fi(meas(y,m,f).pvz)},
    {l:'Ком.итого',    t:'ВБ реализовал − К перечислению = ВВ + НДС + Эквайринг + ПВЗ', fn:(m,f)=>fi(meas(y,m,f).kom)},
    {l:'Эквайр.счёт',  t:'Эквайринг типа «Комиссия за организацию платежа» — НЕ удержан из выплаты, WB выставляет его отдельным счётом. В прибыли пока НЕ учитывается', fn:(m,f)=>{const v=meas(y,m,f).ekvBill;return v?fi(v):'—';}},
    {l:'Компенс',      t:'Компенсации WB продавцу за брак/утерю/подмену (обоснования «Добровольная компенсация при возврате», «Компенсация ущерба»). Доход — прибавляется к прибыли', fn:(m,f)=>{const v=meas(y,m,f).komp;return v?fi(v):'—';}},
    {l:'Ком%розн',     t:'Комиссия ÷ Розничная цена',                     fn:(m,f)=>fp1(meas(y,m,f).komRoznP)},
    {l:'Ком%реализ',   t:'Комиссия ÷ ВБ реализовал',                      fn:(m,f)=>fp1(meas(y,m,f).komP)},
  ];
}
function renderKomWB(el,y,q,sM){
  const searchOK=r=>!q||r.paG.toLowerCase().includes(q); searchOK.agg=true;
  const K=meas(y,sM,searchOK);
  if(!K.rozn){ el.innerHTML=rzStub(); return; }
  const all=[1,2,3,4,5,6,7,8,9,10,11,12];
  const komM=all.map(m=>meas(y,[m],searchOK).kom);
  const pctM=all.map(m=>meas(y,[m],searchOK).komRoznP);
  const chart=chartCard(`Комиссия WB и её доля от розничной · ${y}`,
    legItem('var(--red)','Комиссия, ₽',.55)+legItem('var(--blue)','Ком% от розничной'),
    chartBL(mns3,komM,pctM,{barColor:'var(--red)',lineColor:'var(--blue)',lineFmt:v=>(v*100).toFixed(1)+'%',barFmt:kf}));
  const sub=`структура: ВВ ${fp1(K.vvP)} · НДС ${fp1(K.vvNdsP)} · эквайринг ${fp1(K.ekvairP)} · ПВЗ ${fp1(K.pvzP)} — от розничной`
    +(Math.abs(K.komOther)>1?` · ⚠ не разложено: ${fi(K.komOther)} ₽`:'');
  tabTables(el,chart,'Комиссия WB',sub,rzCols(y),y,q,sM);
}

function rzStub(){
  return `<div class="scaffold"><b>Нет данных финотчёта WB для кабинета «${curCo}».</b><br><br>
    Разбор и детализация комиссии строятся из еженедельного финансового отчёта WB (parseWBFin).
    Сейчас он подключён только для <b>EZFR</b> (секрет <code>WBFIN_EZFR_URL</code>).<br>
    Для EF нужен секрет <code>WBFIN_EF_URL</code> — см. приоритет 3.</div>`;
}
