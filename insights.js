/* ═══════════ ИНСАЙТЫ (шаблонный пересказ цифр, без ИИ) ═══════════ */
function renderInsights(el,y,q){
  const searchOK=r=>!q||r.paG.toLowerCase().includes(q); searchOK.agg=true;
  const now=new Date(),nowY=now.getFullYear(),nowM=now.getMonth()+1;
  const lastM=(y<nowY)?12:(nowM-1);
  if(lastM<1){ el.innerHTML='<div class="scaffold">Для '+y+' ещё нет завершённых месяцев для анализа.</div>'; return; }
  const mName=MONTHS[lastM-1];
  const A=meas(y,[lastM],searchOK);
  const pm=lastM>1?{yy:y,mm:lastM-1}:{yy:y-1,mm:12};
  const P=meas(pm.yy,[pm.mm],searchOK), Yq=meas(y-1,[lastM],searchOK);
  const ytdM=[];for(let i=1;i<=lastM;i++)ytdM.push(i);
  const YT=meas(y,ytdM,searchOK), YTp=meas(y-1,ytdM,searchOK);
  const pc=(c,p)=>{ if(p==null||!isFinite(p)||p===0)return null; return (c-p)/Math.abs(p); };
  const ar=(c,p)=>{ const d=pc(c,p); if(d==null)return '<span style="color:var(--ink3)">н/д</span>'; return `<span class="${d>=0?'pos':'neg'}">${d>=0?'▲ +':'▼ '}${(d*100).toFixed(0)}%</span>`; };
  const pp=(c,p)=>{ const d=(c-p)*100; return `<span class="${d>=0?'pos':'neg'}">${d>=0?'+':''}${d.toFixed(1)} п.п.</span>`; };
  const preds=[...new Set(M.obshiy.filter(r=>r.y===y&&r.m===lastM&&searchOK(r)).map(r=>predmetOf(r.paG)))];
  const pr=preds.map(P0=>({p:P0,v:meas(y,[lastM],r=>predmetOf(r.paG)===P0&&searchOK(r)).pribFact})).sort((a,b)=>b.v-a.v);
  const top=pr.slice(0,3), bot=pr.filter(x=>x.v<0).slice(-3).reverse();
  const fixcpo=DIV(A.postAkr-A.acr,A.zaks);
  const card=(l,v,d)=>`<div class="mc"><div class="ml">${l}</div><div class="mv" style="font-size:20px">${v}</div>${d?`<div class="md">${d}</div>`:''}</div>`;
  const block=(ttl,lines,full)=>`<div class="insb${full?' full':''}"><div class="insh">${ttl}</div>${lines.map(t=>`<div class="insl">${t}</div>`).join('')}</div>`;

  el.innerHTML=`
    <div class="sh"><div class="st">Инсайты · ${mName} ${y}</div><div class="sm2">последний завершённый месяц · пересказ таблиц и графиков (генерируется автоматически)</div></div>
    <div class="mg" style="margin-bottom:16px">
      ${card('Выручка (Выкуп,руб)',fi(A.vykr),`м/м ${ar(A.vykr,P.vykr)} · г/г ${ar(A.vykr,Yq.vykr)}`)}
      ${card('Прибыль.Факт (асс.)',fi(A.pribFact),`м/м ${ar(A.pribFact,P.pribFact)} · г/г ${ar(A.pribFact,Yq.pribFact)}`)}
      ${card('Рентабельность',fp(A.pribFactP),`м/м ${pp(A.pribFactP,P.pribFactP)}`)}
      ${card('Выкупаемость',fp(A.vkp),`м/м ${pp(A.vkp,P.vkp)}`)}
    </div>
    <div class="inscol">
      ${block('💰 Итоги месяца',[
        `Выручка <b>${fi(A.vykr)} ₽</b>, чистая прибыль <b>${fi(A.pribFact)} ₽</b>, рентабельность <b>${fp(A.pribFactP)}</b>.`,
        `К предыдущему месяцу (${MONTHS[pm.mm-1]}): выручка ${ar(A.vykr,P.vykr)}, прибыль ${ar(A.pribFact,P.pribFact)}.`,
        `К тому же месяцу год назад (${mName} ${y-1}): выручка ${ar(A.vykr,Yq.vykr)}, прибыль ${ar(A.pribFact,Yq.pribFact)}.`,
        `Нарастающим итогом январь–${mName}: прибыль <b>${fi(YT.pribFact)} ₽</b> против <b>${fi(YTp.pribFact)} ₽</b> год назад (${ar(YT.pribFact,YTp.pribFact)}).`,
        `Лидеры по прибыли: ${top.map(x=>`<b>${x.p}</b> (${fi(x.v)} ₽)`).join(', ')||'—'}.${bot.length?` Убыточные: ${bot.map(x=>`<b>${x.p}</b> (${fi(x.v)} ₽)`).join(', ')}.`:''}`,
      ],true)}
      ${block('📣 Реклама',[
        `Затраты на рекламу <b>${fi(A.rek)} ₽</b> (м/м ${ar(A.rek,P.rek)}, г/г ${ar(A.rek,Yq.rek)}).${A.rekEst?' ⚠ оценка 300 000 ₽ (записано <30к).':''}`,
        `ДРР от продаж <b>${fp1(A.drrSa)}</b>, от заказов <b>${fp1(A.drr)}</b>.`,
        `Стоимость привлечения: CPO <b>${fi(A.advCPO)} ₽</b>/заказ, CPS <b>${fi(A.advCPS)} ₽</b>/выкуп.`,
      ])}
      ${block('🚚 Логистика',[
        `Доставка <b>${fi(A.dost)} ₽</b> (<b>${fp1(A.dostP)}</b> от выручки), хранение <b>${fi(A.hran)} ₽</b> (<b>${fp1(A.hranP)}</b>).`,
        `Log.CPS <b>${fi(A.logCPS)} ₽</b>/выкуп, Stock.CPS <b>${f2(A.stockCPS)} ₽</b>/выкуп.`,
      ])}
      ${block('🏠 Постоянные расходы',[
        `Пост.Р(+акр) <b>${fi(A.postAkr)} ₽</b> = постоянные <b>${fi(A.postAkr-A.acr)} ₽</b> + акруалс <b>${fi(A.acr)} ₽</b>.`,
        `Fix.CPO <b>${fi(fixcpo)} ₽</b>/заказ.`,
      ])}
      ${block('🧾 Средний чек',[
        `Средний чек заказа <b>${fi(A.srchek)} ₽</b> (м/м ${ar(A.srchek,P.srchek)}, г/г ${ar(A.srchek,Yq.srchek)}), цена выкупа <b>${fi(A.cena)} ₽</b>.`,
        `Выкупаемость <b>${fp(A.vkp)}</b> (м/м ${pp(A.vkp,P.vkp)}, г/г ${pp(A.vkp,Yq.vkp)}).`,
      ])}
    </div>`;
}
