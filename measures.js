/* ═══════════ ДВИЖОК МЕР ═══════════ */
const DIV=(a,b)=>b?a/b:0;
const prevMonth=(y,m)=>m===1?{y:y-1,m:12}:{y,m:m-1};
function agg(y,mset,filt){ const a={zaks:0,zaksRep:0,vyks:0,zakr:0,vykr:0,kom:0,rek:0,post:0,nalog:0,hran:0,dost:0,perem:0,
    rozn:0,vv:0,vvNds:0,ekvair:0,pvz:0,komOther:0,rekWB:0,rekMP:0,rekBlog:0,komp:0,ekvBill:0,
    komNom:0,bonus:0,partner:0,taxBase:0,cash:0};
  for(const r of M.obshiy){ if(y&&r.y!==y)continue; if(mset&&!mset.has(r.m))continue; if(filt&&!filt(r))continue;
    a.zaks+=r.zaks;a.zaksRep+=(r.zaksRep||0);a.vyks+=r.vyks;a.zakr+=r.zakr;a.vykr+=r.vykr;a.kom+=(r.kom||0);a.rek+=r.rek;a.post+=r.post;a.nalog+=r.nalog;a.hran+=r.hran;a.dost+=r.dost;a.perem+=r.perem;
    /* детализация комиссии (есть только у WB-финотчёта; у EF/Ozon — 0) */
    a.komp+=(r.komp||0);a.ekvBill+=(r.ekvBill||0);
    a.rekWB+=(r.rekWB||0);a.rekMP+=(r.rekMP||0);a.rekBlog+=(r.rekBlog||0);
    a.rozn+=(r.rozn||0);a.vv+=(r.vv||0);a.vvNds+=(r.vvNds||0);a.ekvair+=(r.ekvair||0);a.pvz+=(r.pvz||0);a.komOther+=(r.komOther||0);
    /* Ozon: номинальное вознаграждение, баллы, программы партнёров, база налога */
    a.komNom+=(r.komNom||0);a.bonus+=(r.bonus||0);a.partner+=(r.partner||0);a.taxBase+=(r.taxBase||0);a.cash+=(r.cash||0); }
  return a; }
function acrSum(y,mset,filt){ let s=0; for(const r of M.acruals){ if(y&&r.y!==y)continue; if(mset&&!mset.has(r.m))continue; if(filt&&!filt(r))continue; s+=r.acr; } return s; }
function postRv(y,mArr,filt){ const a=agg(y,new Set(mArr),filt); if(a.post!==0)return a.post;
  if(mArr.length===1){const pm=prevMonth(y,mArr[0]);return agg(pm.y,new Set([pm.m]),filt).post;} return a.post; }
/* правило рекламы применимо к месяцу: с апреля 2026 И только к ЗАВЕРШЁННОМУ месяцу */
function ruleApplies(y,m){
  const now=new Date(),nowY=now.getFullYear(),nowM=now.getMonth()+1;
  const fromApr=(y>2026)||(y===2026&&m>=4);
  const completed=(y<nowY)||(y===nowY&&m<nowM);
  return fromApr&&completed;
}
/* ── Ozon: два представления ──
   НОМИНАЛЬНОЕ (по умолчанию): Выкуп,руб = Выручка + Баллы + Партнёры (база, с которой
     Ozon берёт вознаграждение), Ком.МП = вознаграждение ≈ 43%.
   РЕАЛЬНОЕ (кнопка «реальные цифры»): Выкуп,руб = только деньги клиента,
     Ком.МП = Вознаграждение − Баллы (баллы — это как СПП у WB, площадка их возвращает),
     ДРЛ% и ДРР% считаются от реальной выручки. */
let ozReal=false;
function toggleOzReal(){ ozReal=!ozReal;
  const b=document.getElementById('ozBtn');
  if(b){ b.classList.toggle('act',ozReal); b.textContent=ozReal?'✓ реальные цифры':'＋ реальные цифры'; }
  render(); }

function meas(y,mArr,filt){
  const isAgg=(filt==null)||filt.agg===true;
  const mset=new Set(mArr); const a=agg(y,mset,filt); const acr=acrSum(y,mset,filt); const pR=postRv(y,mArr,filt);
  let rek=a.rek, rekEst=false;
  if(isAgg && curCo!=='EZFR' && curCo!=='OZON'){
    rek=0;
    for(const m of mArr){ let r=agg(y,new Set([m]),filt).rek;
      if(ruleApplies(y,m)&&r<30000){ r=300000; if(mArr.length===1)rekEst=true; }
      rek+=r; }
  }
  /* Ozon в режиме «реальные цифры»: подменяем выручку и комиссию */
  const ozR=(curCo==='OZON'||curCo==='CONS')&&ozReal&&a.komNom;
  const vykr = ozR ? a.cash : a.vykr;
  const kom  = ozR ? (a.komNom-a.bonus-a.partner) : a.kom;
  /* komp — компенсации WB (брак/утеря/подмена) и компенсации/декомпенсации Ozon:
     это ДОХОД, прибавляется */
  const pribOper=vykr-kom-a.perem-a.dost-a.hran-a.nalog+a.komp;
  const postAkr=pR+acr;
  const pribFact=vykr-kom-a.perem-a.dost-a.hran-pR-rek-a.nalog-acr+a.komp;
  const drrBase = ozR ? vykr : a.zakr;   /* в реальном режиме ДРР считаем от реальной выручки */
  return {zaks:a.zaks,vyks:a.vyks,vkp:DIV(a.vyks,a.zaks),zakr:a.zakr,vykr,cena:DIV(vykr,a.vyks),
    perem:a.perem,dost:a.dost,drl:DIV(a.dost,vykr),hran:a.hran,kom,komP:DIV(kom,vykr),nalog:a.nalog,
    pribOper,pribOperP:DIV(pribOper,vykr),postAkr,rek,rekEst,drr:DIV(rek,drrBase),
    pribFact,pribFactP:DIV(pribFact,vykr),
    advCPO:DIV(rek,a.zaks),advCPS:DIV(rek,a.vyks),drrSa:DIV(rek,vykr),
    logCPS:DIV(a.dost,a.vyks),stockCPS:DIV(a.hran,a.vyks),dostP:DIV(a.dost,vykr),hranP:DIV(a.hran,vykr),
    srchek:DIV(a.zakr,a.zaks),acr,
    /* ── разложение выручки и комиссии (WB-финотчёт) ── */
    rozn:a.rozn, skidkaWB:a.rozn-a.vykr, skidkaWBp:DIV(a.rozn-a.vykr,a.rozn),
    vv:a.vv, vvNds:a.vvNds, ekvair:a.ekvair, pvz:a.pvz, komOther:a.komOther,
    kPerech:a.vykr-a.kom,
    vvP:DIV(a.vv,a.rozn), vvNdsP:DIV(a.vvNds,a.rozn), ekvairP:DIV(a.ekvair,a.rozn), pvzP:DIV(a.pvz,a.rozn),
    komRoznP:DIV(a.kom,a.rozn), hasFin:a.rozn>0,
    /* ── разложение Ozon: номинальная комиссия vs реальная ── */
    komNom:a.komNom, bonus:a.bonus, partner:a.partner, taxBase:a.taxBase, cash:a.cash,
    ozReal:!!ozR, komNomP:DIV(a.komNom,a.vykr), bonusP:DIV(a.bonus,a.vykr),
    komRealP:DIV(a.komNom-a.bonus-a.partner,a.cash),
    /* «Удержания WB» из финотчёта — справочно рядом с рекламой из бухгалтерии (не складываются) */
    komp:a.komp, ekvBill:a.ekvBill, zaksRep:a.zaksRep,
    rekWB:a.rekWB, rekDiff:a.rekWB?(a.rek-a.rekWB):0,
    /* реклама в разрезе: площадка vs блогеры (из листа Расход, колонка «Конкретнее») */
    rekMP:a.rekMP, rekBlog:a.rekBlog,
    rekMPp:DIV(a.rekMP,a.rek), rekBlogP:DIV(a.rekBlog,a.rek),
    drrMP:DIV(a.rekMP,a.vykr), drrBlog:DIV(a.rekBlog,a.vykr),
    postR:pR};
}
function predmetOf(paG){const a=M.artByPaG[paG];return a?a.pnew:'(без предмета)';}

/* ═══════════ ФОРМАТ ═══════════ */
const fi=n=>(n==null||isNaN(n))?'—':Math.round(n).toLocaleString('ru-RU');
const fp=n=>(n==null||isNaN(n))?'—':Math.round(n*100)+'%';
const fp1=n=>(n==null||isNaN(n))?'—':(n*100).toFixed(1).replace('.',',')+'%';
const f2=n=>(n==null||isNaN(n))?'—':n.toFixed(2).replace('.',',');

/* ═══════════ ПОДПИСИ, ЗАВИСЯЩИЕ ОТ ПЛОЩАДКИ ═══════════
   COLS остаётся тем же массивом, но `l` и `t` — геттеры: они читают curCo
   в момент отрисовки. Поэтому при смене компании подписи меняются сами,
   и render.js трогать не нужно. */
const CO_TXT={
  OZON:{
    zaks:{l:'Заказ,шт',t:'Заказы Ozon = количество на строках начислений типа «Логистика». Выкупы — строки «Выручка».'},
    vyks:{t:'Выкуплено штук = количество на строках «Выручка» из отчёта по начислениям Ozon.'},
    vkp:{t:'Выкупаемость = Выкуп,шт ÷ Заказ,шт. Заказы считаются по строкам логистики, поэтому доля приблизительная.'},
    zakr:{t:'Сумма заказов ≈ Заказ,шт × средняя цена выкупа (деньги клиента ÷ выкуп,шт).'},
    vykr:{l:'Выкуп,руб',t:'По умолчанию — Выручка + Баллы за скидки + Программы партнёров (база вознаграждения Ozon). Кнопка «реальные цифры» переключает на ДЕНЬГИ КЛИЕНТА = «Выручка» + «Возврат выручки». Баллы за скидки сюда НЕ входят: их платит Ozon, а не покупатель. Прямой аналог «Вайлдберриз реализовал Товар (Пр)» — за счёт этого средний чек и все проценты сопоставимы с WB.'},
    cena:{t:'Средний чек по живым деньгам = Выкуп,руб ÷ Выкуп,шт. Баллы Ozon в него не входят, поэтому он ниже «цены продавца».'},
    dost:{l:'Дставка',t:'Логистика и услуги Ozon: группы «Услуги доставки», «Услуги партнёров», «Услуги FBO», «Другие услуги и штрафы» (логистика, обратная логистика, эквайринг, ПВЗ, приёмка, звёздные товары и пр.). Классификация с фолбэком по группе — ни один тип начисления не теряется.'},
    drl:{t:'Доля логистики = Доставка ÷ Выкуп,руб. У Ozon выше, чем у WB: знаменатель — только живые деньги, без баллов.'},
    hran:{l:'Хранен',t:'У Ozon отдельной статьи хранения в начислениях нет — складские услуги входят в группу «Услуги FBO» и учтены в Доставке.'},
    kom:{l:'Ком.МП',t:'Комиссия маркетплейса. По умолчанию — НОМИНАЛЬНАЯ: вознаграждение Ozon (~43% от базы «Выручка + Баллы»). Кнопка «реальные цифры» переключает на РЕАЛЬНУЮ = «Вознаграждение за продажу» − «Баллы за скидки» − «Программы партнёров». Номинальные ~43% берутся с базы «выручка + баллы» и неинформативны: часть их Ozon возвращает баллами. Может быть отрицательной — как СПП у WB в 2022–2023. Помесячно скачет, потому что баллы приходят с лагом к вознаграждению; за год сходится.'},
    komP:{l:'Ком%',t:'Реальная комиссия Ozon ÷ Выкуп,руб (деньги клиента).'},
    nalog:{l:'Налог',t:'Налог УСН с базы «Выручка + Баллы за скидки + Программы партнёров» — для ФНС баллы это доход продавца. Важно: база ШИРЕ, чем Выкуп,руб. Ставка: 7% до 01.02.2026, далее 12%.'},
    pribOper:{t:'Операционная прибыль = Выкуп,руб − Ком.Ozon − Переменные − Доставка − Налог + Компенсации Ozon.'},
    postAkr:{l:'Пост+акр',t:'Постоянные расходы и акруалс ведутся только по EF — у Ozon пусто.'},
    rek:{l:'Реклама',t:'Реклама Ozon из начислений: группа «Продвижение и реклама» (Оплата за клик, Трафареты, Вывод в топ, Продвижение с оплатой за заказ).'},
    drr:{t:'Доля рекламы = Реклама ÷ Заказ,руб.'},
    pribFact:{t:'Чистая прибыль = Выкуп,руб − Ком.Ozon − Переменные − Доставка − Налог − Реклама + Компенсации.'}
  },
  EZFR:{
    nalog:{t:'Налог УСН 7% от («К перечислению» + компенсации) — у EZFR ставка не менялась.'}
  }
};
function _ct(k,f){
  const co=(typeof curCo!=='undefined')?curCo:null;
  const o=(co&&CO_TXT[co])?CO_TXT[co][k]:null;
  return (o&&o[f]!=null)?o[f]:null;
}
function COL(k,l,f,t,extra){
  const o=Object.assign({k,f},extra||{});
  Object.defineProperty(o,'l',{get(){return _ct(k,'l')||l;},enumerable:true});
  Object.defineProperty(o,'t',{get(){return _ct(k,'t')||t;},enumerable:true});
  return o;
}

/* ═══════════ КОЛОНКИ ТАБЛИЦЫ ═══════════ */
const COLS=[
  COL('zaks','Заказ,шт',fi,'Заказано штук. Приоритет источников: 1) финотчёт WB — доставки «К клиенту при продаже» + «К клиенту при отмене» (2025+); 2) лист report — за месяцы, где ВБ не детализировал прямую логистику (2021–2024); 3) все доставки строки, если колонки видов логистики нет. Привязка по дате продажи.'),
  COL('vyks','Выкуп,шт',fi,'Выкуплено штук = Продажи − Возвраты. Источник: финотчёт WB (строки «Продажа»/«Возврат», колонка «Кол-во»).'),
  COL('vkp','Вкп%',fp,'Выкупаемость = Выкуп,шт ÷ Заказ,шт. Заказы и выкупы могут приходить из разных источников — при рассинхроне артикулов % может искажаться.'),
  COL('zakr','Заказ,руб',fi,'Сумма заказов ≈ Заказ,шт × средняя цена выкупа (Выкуп,руб ÷ Выкуп,шт) того же артикул-месяца. Цены на строках логистики нет, поэтому это ОЦЕНКА, а не измеренная величина.'),
  COL('vykr','Выкуп,руб',fi,'Выручка (gross) = «Вайлдберриз реализовал Товар (Пр)» из финотчёта. Это то, что заплатил покупатель, до удержаний WB. Продажи − Возвраты.',{bar:'bl'}),
  COL('cena','Ср.Чек',fi,'Средняя цена выкупа = Выкуп,руб ÷ Выкуп,шт.'),
  COL('perem','Перемен',fi,'Переменные расходы (себестоимость) = PU × Выкуп,шт, где PU = Σ(закупка из листа Расход) ÷ Σ(ШТ поставлено из листа ШТУК). Считается по всей истории — новая поставка меняет PU ретроспективно.'),
  COL('dost','Дставка',fi,'Логистика WB из финотчёта = Услуги по доставке + отдельные строки возмещения ПВЗ + Возмещение издержек по перевозке + Приёмка. ПВЗ, удержанный при продаже, сюда НЕ входит — он внутри Ком.МП.'),
  COL('drl','ДРЛ%',fp,'Доля логистики = Доставка ÷ Выкуп,руб.'),
  COL('hran','Хранен',fi,'Хранение из финотчёта WB (обоснование «Хранение»). За 2021–2024 финотчёт хранение не содержал — там оно добирается из листа «Лог+Хран» за те месяцы, где финотчёт его не дал.'),
  COL('kom','Ком.МП',fi,'Комиссия маркетплейса = «ВБ реализовал» − «К перечислению» = ВВ + НДС с ВВ + эквайринг (удержанный) + ПВЗ. Может быть отрицательной: в 2022–2023 WB компенсировал СПП, и продавец получал больше, чем цена продажи.'),
  COL('komP','Ком%',fp1,'Комиссия МП ÷ Выкуп,руб.'),
  COL('nalog','Налог',fi,'Налог УСН от («К перечислению» + компенсации). EF: 7% до 01.02.2026, далее 12%. EZFR: 7% всегда.'),
  COL('pribOper','Пр.Опер',fi,'Операционная прибыль = Выкуп,руб − Ком.МП − Переменные − Доставка − Хранение − Налог + Компенсации WB.'),
  COL('pribOperP','Оп%',fp,'Операционная прибыль ÷ Выкуп,руб.',{hl:1}),
  COL('postAkr','Пост+акр',fi,'Постоянные расходы (лист Расход, «Что» = «Пост расходы», поартикульно; с откатом на пред. месяц, если 0) + Акруалс (лист Acruals). Отдельный лист «Пост» больше не используется.'),
  COL('rek','Реклама',fi,'Реклама из листа Расход (группа «Реклама»): площадка (WB Продвижение/Джем) + блогеры/интеграции. Удержания WB из финотчёта показаны справочно во вкладке «Реклама», в прибыль не входят.'),
  COL('drr','ДРР%',fp1,'Доля рекламы = Реклама ÷ Заказ,руб.'),
  COL('pribFact','Пр.Факт(асс)',fi,'Чистая прибыль = Пр.Опер − Пост+акр − Реклама. Полностью: Выкуп,руб − Ком.МП − Переменные − Доставка − Хранение − Налог − Пост.Р − Акруалс − Реклама + Компенсации.',{bar:'pf'}),
  COL('pribFactP','Ф%',fp,'Чистая прибыль ÷ Выкуп,руб.',{hl:1})
];
