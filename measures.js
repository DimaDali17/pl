/* ═══════════ ДВИЖОК МЕР ═══════════ */
const DIV=(a,b)=>b?a/b:0;
const prevMonth=(y,m)=>m===1?{y:y-1,m:12}:{y,m:m-1};
function agg(y,mset,filt){ const a={zaks:0,vyks:0,zakr:0,vykr:0,kom:0,rek:0,post:0,nalog:0,hran:0,dost:0,perem:0,
    rozn:0,vv:0,vvNds:0,ekvair:0,pvz:0,komOther:0};
  for(const r of M.obshiy){ if(r.y!==y)continue; if(mset&&!mset.has(r.m))continue; if(filt&&!filt(r))continue;
    a.zaks+=r.zaks;a.vyks+=r.vyks;a.zakr+=r.zakr;a.vykr+=r.vykr;a.kom+=(r.kom||0);a.rek+=r.rek;a.post+=r.post;a.nalog+=r.nalog;a.hran+=r.hran;a.dost+=r.dost;a.perem+=r.perem;
    /* детализация комиссии (есть только у WB-финотчёта; у EF/Ozon — 0) */
    a.rozn+=(r.rozn||0);a.vv+=(r.vv||0);a.vvNds+=(r.vvNds||0);a.ekvair+=(r.ekvair||0);a.pvz+=(r.pvz||0);a.komOther+=(r.komOther||0); }
  return a; }
function acrSum(y,mset,filt){ let s=0; for(const r of M.acruals){ if(r.y!==y)continue; if(mset&&!mset.has(r.m))continue; if(filt&&!filt(r))continue; s+=r.acr; } return s; }
function postRv(y,mArr,filt){ const a=agg(y,new Set(mArr),filt); if(a.post!==0)return a.post;
  if(mArr.length===1){const pm=prevMonth(y,mArr[0]);return agg(pm.y,new Set([pm.m]),filt).post;} return a.post; }
/* правило рекламы применимо к месяцу: с апреля 2026 И только к ЗАВЕРШЁННОМУ месяцу */
function ruleApplies(y,m){
  const now=new Date(),nowY=now.getFullYear(),nowM=now.getMonth()+1;
  const fromApr=(y>2026)||(y===2026&&m>=4);
  const completed=(y<nowY)||(y===nowY&&m<nowM);
  return fromApr&&completed;
}
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
  const pribOper=a.vykr-a.kom-a.perem-a.dost-a.hran-a.nalog;
  const postAkr=pR+acr;
  const pribFact=a.vykr-a.kom-a.perem-a.dost-a.hran-pR-rek-a.nalog-acr;
  return {zaks:a.zaks,vyks:a.vyks,vkp:DIV(a.vyks,a.zaks),zakr:a.zakr,vykr:a.vykr,cena:DIV(a.vykr,a.vyks),
    perem:a.perem,dost:a.dost,drl:DIV(a.dost,a.vykr),hran:a.hran,kom:a.kom,komP:DIV(a.kom,a.vykr),nalog:a.nalog,
    pribOper,pribOperP:DIV(pribOper,a.vykr),postAkr,rek,rekEst,drr:DIV(rek,a.zakr),
    pribFact,pribFactP:DIV(pribFact,a.vykr),
    advCPO:DIV(rek,a.zaks),advCPS:DIV(rek,a.vyks),drrSa:DIV(rek,a.vykr),
    logCPS:DIV(a.dost,a.vyks),stockCPS:DIV(a.hran,a.vyks),dostP:DIV(a.dost,a.vykr),hranP:DIV(a.hran,a.vykr),
    srchek:DIV(a.zakr,a.zaks),acr,
    /* ── разложение выручки и комиссии (WB-финотчёт) ── */
    rozn:a.rozn, skidkaWB:a.rozn-a.vykr, skidkaWBp:DIV(a.rozn-a.vykr,a.rozn),
    vv:a.vv, vvNds:a.vvNds, ekvair:a.ekvair, pvz:a.pvz, komOther:a.komOther,
    kPerech:a.vykr-a.kom,
    vvP:DIV(a.vv,a.rozn), vvNdsP:DIV(a.vvNds,a.rozn), ekvairP:DIV(a.ekvair,a.rozn), pvzP:DIV(a.pvz,a.rozn),
    komRoznP:DIV(a.kom,a.rozn), hasFin:a.rozn>0,
    postR:pR};
}
function predmetOf(paG){const a=M.artByPaG[paG];return a?a.pnew:'(без предмета)';}

/* ═══════════ ФОРМАТ ═══════════ */
const fi=n=>(n==null||isNaN(n))?'—':Math.round(n).toLocaleString('ru-RU');
const fp=n=>(n==null||isNaN(n))?'—':Math.round(n*100)+'%';
const fp1=n=>(n==null||isNaN(n))?'—':(n*100).toFixed(1).replace('.',',')+'%';
const f2=n=>(n==null||isNaN(n))?'—':n.toFixed(2).replace('.',',');

/* ═══════════ КОЛОНКИ ТАБЛИЦЫ ═══════════ */
const COLS=[
  {k:'zaks',l:'Заказ,шт',f:fi,t:'Заказано штук (лист report / «2»)'},
  {k:'vyks',l:'Выкуп,шт',f:fi,t:'Выкуплено штук (report / «2»)'},
  {k:'vkp',l:'Вкп%',f:fp,t:'Выкуп ÷ Заказ (в штуках)'},
  {k:'zakr',l:'Заказ,руб',f:fi,t:'Сумма заказов минус комиссия WB, руб.'},
  {k:'vykr',l:'Выкуп,руб',f:fi,bar:'bl',t:'К перечислению за товар, руб. (выручка)'},
  {k:'cena',l:'Ср.Чек',f:fi,t:'Цена = Выкуп,руб ÷ Выкуп,шт'},
  {k:'perem',l:'Перемен',f:fi,t:'Перемен на штуку (Σпеременных ÷ ШТ поставлено) × Выкуп,шт'},
  {k:'dost',l:'Дставка',f:fi,t:'Доставка (лист Лог+Хран)'},
  {k:'drl',l:'ДРЛ%',f:fp,t:'Доля логистики = Доставка ÷ Выкуп,руб'},
  {k:'hran',l:'Хранен',f:fi,t:'Хранение (лист Лог+Хран)'},
  {k:'kom',l:'Ком.МП',f:fi,t:'Комиссия маркетплейса (Ozon: отрицательная; WB: 0, вшита в выручку)'},
  {k:'komP',l:'Ком%',f:fp1,t:'Комиссия МП ÷ Выкуп,руб'},
  {k:'nalog',l:'Налог',f:fi,t:'Налог: 7% до 01.02.2026, далее 11% от К перечислению'},
  {k:'pribOper',l:'Пр.Опер',f:fi,t:'Операционная прибыль = Выкуп,руб − Ком.МП − Переменные − Доставка − Хранение − Налог'},
  {k:'pribOperP',l:'Оп%',f:fp,hl:1,t:'Прибыль.Опер ÷ Выкуп,руб'},
  {k:'postAkr',l:'Пост+акр',f:fi,t:'Постоянные (с откатом на пр. месяц, если 0) + Акруалс'},
  {k:'rek',l:'Реклама',f:fi,t:'Расходы на рекламу (при включённом правиле <30к → 300к)'},
  {k:'drr',l:'ДРР%',f:fp1,t:'Доля рекламы = Реклама ÷ Заказ,руб'},
  {k:'pribFact',l:'Пр.Факт(асс)',f:fi,bar:'pf',t:'Факт = Выкуп,руб − Ком.МП − Перем − Доставка − Хранение − Пост.Р − Реклама − Налог − Акруалс'},
  {k:'pribFactP',l:'Ф%',f:fp,hl:1,t:'Прибыль.Факт(асс.) ÷ Выкуп,руб'}
];
