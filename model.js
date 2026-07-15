/* ═══════════ ЗАГРУЗКА ═══════════ */
const SHEETS=['report','rashod','art','log','sht','acr','post','ekon','report2','rashod2','art2','log2','sht2','ekon2','ozon','wbfin_ezfr','wbfin_ef'];
const REQ=['report','rashod','art','log','sht','acr'];
async function fetchCSVdirect(url){ const r=await fetch(url); if(!r.ok)throw new Error('HTTP '+r.status); return await r.text(); }

/* Забирает CSV-тексты всех листов: через воркер (по паролю) либо по прямым ссылкам (локальная отладка) */
async function loadRawTexts(diag){
  const texts={};
  if(CFG.worker){
    const base=CFG.worker.replace(/\/+$/,'');
    let resp;
    try{ resp=await fetch(base+'?sheet=all',{headers:{'X-Access-Key':CFG.pass||''}}); }
    catch(e){ throw new Error('Воркер недоступен: '+e.message); }
    if(resp.status===401) throw new Error('Неверный пароль (401)');
    if(!resp.ok) throw new Error('Воркер вернул '+resp.status);
    let j; try{ j=await resp.json(); }catch(e){ throw new Error('Некорректный ответ воркера'); }
    const data=j.data||{};
    SHEETS.forEach(k=>{ texts[k]=data[k]||''; });
    diag.push({name:'Worker',status:'ok',rows:0,msg:'источник: '+base});
    return texts;
  }
  // прямые ссылки (fallback)
  await Promise.all(SHEETS.filter(k=>CFG[k]).map(async k=>{
    try{ texts[k]=await fetchCSVdirect(CFG[k]); }catch(e){ texts[k]=''; }
  }));
  SHEETS.forEach(k=>{ if(texts[k]===undefined)texts[k]=''; });
  return texts;
}

/* textsOverride — карта {лист: csv-текст}. Передаётся из build/prebuild.mjs (Node).
   Без неё работает старый путь: тянуть CSV через воркер (в браузере больше не используется). */
async function buildModel(textsOverride){
  const diag=[]; M.diag=diag;
  let texts;
  if(textsOverride){
    texts={}; SHEETS.forEach(k=>{ texts[k]=textsOverride[k]||''; });
  } else {
    if(!CFG.worker && !CFG.report) throw new Error('Не задан ни воркер, ни прямые ссылки (см. Настройки).');
    texts=await loadRawTexts(diag);
  }
  const raw={};
  SHEETS.forEach(k=>{ let rows=parseCSV(texts[k]||'');
    if(k==='ozon'){ const hi=rows.findIndex(r=>r.some(c=>/тип начисления|сумма итого/i.test(String(c)))); if(hi>0)rows=rows.slice(hi); }
    raw[k]=toObjects(rows);
    const need=REQ.includes(k);
    diag.push({name:k,status:(raw[k].length?'ok':(need?'err':'warn')),rows:raw[k].length,cols:(raw[k]._headers||[]).length}); });
  if(!raw.report.length||!raw.rashod.length) throw new Error('Не пришли обязательные листы (report/расход). Проверьте пароль и секреты воркера.');

  /* Артикул dim */
  const aH=raw.art._headers||[];
  const c_pred=col(aH,'Предмет'),c_post=col(aH,'Артикул поставщика'),c_glub=col(aH,'Артикул.Глубина','Артикул Глубина'),c_new=col(aH,'Предмет_Новый','Предмет;Новый'),c_scep=col(aH,'Сцепка','Сцепка2');
  const artDim=[]; const artByPostL=new Map(), artByPostA=new Map(); const artByPredArt=new Map();
  let predEmpty=0;
  raw.art.forEach(r=>{
    let predmet=(r[c_pred]||'').trim(); const post=(r[c_post]||'').trim(),glub=(r[c_glub]||'').trim(),pnew=c_new?(r[c_new]||'').trim():'';
    const scep=c_scep?(r[c_scep]||'').trim():'';
    /* если «Предмет» пуст — восстановим из «Сцепка» (Сцепка = Предмет+Артикул поставщика) */
    if(!predmet&&scep&&post&&scep.length>post.length&&nk(scep).endsWith(nk(post))){
      let cut=scep.length; const npost=nk(post); let acc='';
      for(let i=scep.length-1;i>=0;i--){ acc=nk(scep[i])+acc; cut=i; if(acc===npost)break; }
      predmet=scep.slice(0,cut).trim();
    }
    if(!predmet&&scep&&glub&&nk(scep).endsWith(nk(glub))){ predmet=scep.slice(0,scep.length-glub.length).trim(); }
    if(!predmet)predEmpty++;
    const paG=predmet+glub, paP=predmet+post; if(paP===''||paP===';')return;
    const rec={predmet,post,glub,pnew:pnew||predmet,paG,paP,scep}; artDim.push(rec);
    if(post){ artByPostL.set(lnk(post),rec); artByPostA.set(nk(post),rec); }
    artByPredArt.set(nk(predmet)+'|'+nk(post),rec);
  });
  M.artByPaG={}; artDim.forEach(a=>{ M.artByPaG[a.paP]=a; M.artByPaG[a.paG]=a; });
  const smp0=artDim[0]||{};
  diag.push({name:'Артикул (справочник)',status:predEmpty>artDim.length*0.5?'err':'ok',rows:artDim.length,
    msg:`Предмет-колонка: ${c_pred||'—'} · пустых предметов: ${predEmpty} · пример: «${smp0.predmet||''}» + «${smp0.glub||''}» → ключ «${smp0.paG||''}»`});

  /* ── Справочник артикулов EZFR (своя бухгалтерия, лист art2) ──
     Ключи EF и EZFR не перетираем: при совпадении paG приоритет у EF. */
  const artDim2=[];
  if(raw.art2&&raw.art2.length){
    const a2=raw.art2._headers||[];
    const p_pred=col(a2,'Предмет'),p_post=col(a2,'Артикул поставщика'),p_glub=col(a2,'Артикул.Глубина','Артикул Глубина'),p_new=col(a2,'Предмет_Новый','Предмет;Новый');
    raw.art2.forEach(r=>{
      const predmet=(r[p_pred]||'').trim(),post=(r[p_post]||'').trim(),glub=(r[p_glub]||'').trim(),pnew=p_new?(r[p_new]||'').trim():'';
      const paG=predmet+glub,paP=predmet+post; if(paP===''||paP===';')return;
      artDim2.push({predmet,post,glub,pnew:pnew||predmet,paG,paP});
    });
    artDim2.forEach(a=>{ if(M.artByPaG[a.paP]===undefined)M.artByPaG[a.paP]=a; if(M.artByPaG[a.paG]===undefined)M.artByPaG[a.paG]=a; });
    artDim2.forEach(a=>{ if(a.post){ if(!artByPostL.has(lnk(a.post)))artByPostL.set(lnk(a.post),a); if(!artByPostA.has(nk(a.post)))artByPostA.set(nk(a.post),a); } });
    diag.push({name:'Артикул EZFR (art2)',status:'ok',rows:artDim2.length,msg:'своя бухгалтерия EZFR'});
  }

  /* ═══════ Мультикомпанийность: EF (report) · EZFR (report2) · OZON · Консолид ═══════ */
  /* Расход построчно. Пост.расходы и Реклама выделяются, остальное — переменные.
     Реклама делится на ДВА вида по колонке «Конкретнее»:
       rekMP   — реклама на самой площадке (реклама WB, продвижение, джем, буст)
       rekBlog — блогеры и интеграции (всё, что не опознано как площадка)
     Группа «Реклама» их не различает — там и «реклама WB», и «интеграция Коняхина». */
  const RE_MP=/\b(wb|вб|вайлдберриз|wildberries|ozon|озон)\b|продвижен|джем|буст|автореклам|аукцион/i;
  function parseRashod(rr){
    if(!rr||!rr.length)return[];
    const H=rr._headers;
    const x_date=col(H,'Дата'),x_pa=col(H,'Предмет;Артикул продавца','Предмет;Артикул.Глубина','Предмет;Артикул поставщика'),
      x_chto=col(H,'Что'),x_grp=col(H,'Что (группа)','Что группа'),x_kon=col(H,'Конкретнее'),x_sum=col(H,'Сумма');
    return rr.map(r=>{ const s=num(r[x_sum]);
      const isRek=String(r[x_grp]||'').trim()==='Реклама';
      const isPost=String(r[x_chto]||'').trim()==='Пост расходы';
      const kon=x_kon?String(r[x_kon]||'').trim():'';
      const rek=isRek?s:0;
      const rekMP=(isRek&&RE_MP.test(kon))?s:0;
      const rekBlog=isRek?s-rekMP:0;
      const post=isPost?s:0;
      return {date:pdate(r[x_date]),pa:(r[x_pa]||'').trim(),kon,rek,rekMP,rekBlog,post,per:s-rek-post}; }).filter(r=>r.date);
  }
  const xRows =parseRashod(raw.rashod);
  const xRows2=parseRashod(raw.rashod2);   /* своя бухгалтерия EZFR */

  /* Acruals (общий, на EF) */
  const acH=raw.acr._headers||[];
  const ac_d=col(acH,'Дата'),ac_pa=col(acH,'Предмет;Артикул.Глубина','Предмет;Артикул продавца'),ac_v=col(acH,'Акруалс');
  const acGroup=groupBy(raw.acr.map(r=>({date:pdate(r[ac_d]),paG:(r[ac_pa]||'').trim(),acr:intn(r[ac_v])})).filter(r=>r.date),
    r=>keyDP(r.date,r.paG),rs=>({date:rs[0].date,paG:rs[0].paG,acr:sum(rs,'acr')}));

  function parseSales(rr,taxFlat){
    if(!rr||!rr.length)return[]; const H=rr._headers;
    const c_post=col(H,'Артикул поставщика'),c_zakr=col(H,'Сумма заказов минус комиссия WB, руб.','Сумма заказов минус комиссия WB руб'),
      c_zaks=col(H,'Заказано, шт.','Заказано шт'),c_per=col(H,'К перечислению за товар, руб.','К перечислению за товар руб'),
      c_vyks=col(H,'Выкупили, шт.','Выкупили шт'),c_den=col(H,'День','Дата');
    const TAX=new Date(2026,1,1); const out=[];
    rr.forEach(r=>{ const d=pdate(r[c_den]); if(!d)return; const post=(r[c_post]||'').trim();
      const rec=artByPostL.get(lnk(post))||artByPostA.get(nk(post)); const paG=rec?rec.paG:('#'+post);
      const perech=num(r[c_per]); const nalog=taxFlat!=null?Math.round(perech*taxFlat):Math.round(perech*(d>=TAX?0.12:0.07));
      out.push({date:d,paG,zaks:intn(r[c_zaks]),vyks:intn(r[c_vyks]),zakr:num(r[c_zakr]),vykr:perech,kom:0,nalog}); });
    return out;
  }
  function parseLog(rr){
    if(!rr||!rr.length)return[]; const H=rr._headers;
    const c_end=col(H,'Период конец'),c_art=col(H,'Артикул'),c_pr=col(H,'Предмет'),c_hr=col(H,'Хранение'),c_do=col(H,'Доставка');
    const rows=rr.map(r=>{ const rec=artByPredArt.get(nk(r[c_pr])+'|'+nk(r[c_art]));
      return {date:pdate(r[c_end]),paG:rec?rec.paG:('#'+(r[c_pr]||'')+(r[c_art]||'')),hran:num(r[c_hr]),dost:num(r[c_do])}; }).filter(r=>r.date);
    return groupBy(rows,r=>keyDP(r.date,r.paG),rs=>({date:rs[0].date,paG:rs[0].paG,hran:sum(rs,'hran'),dost:sum(rs,'dost')}));
  }
  function buildPU(xr,shtRaw,keyFn,dim){
    const sH2=(shtRaw&&shtRaw._headers)||[];
    const s_pa2=col(sH2,'Предмет;Артикул поставщика','Предмет;Артикул.Глубина','Предмет;Артикул продавца','Предмет;Артикул'),s_qty2=col(sH2,'ШТ поставлено','ШТ');
    const per={},sht={};
    groupBy(xr,r=>keyFn(r.pa),rs=>({k:keyFn(rs[0].pa),per:sum(rs,'per')})).forEach(g=>{if(g.k)per[g.k]=g.per;});
    (shtRaw||[]).forEach(r=>{ const k=keyFn(r[s_pa2]); if(k)sht[k]=(sht[k]||0)+intn(r[s_qty2]); });
    const pu={}; Object.keys(per).forEach(k=>{ if(sht[k])pu[k]=Math.round(per[k]/sht[k]); });
    (dim||artDim).forEach(a=>{ const kP=keyFn(a.paP),kG=keyFn(a.paG); const v=(pu[kP]!==undefined)?pu[kP]:(pu[kG]!==undefined?pu[kG]:undefined); if(v!==undefined){pu[kP]=v;pu[kG]=v;} });
    return pu;
  }
  function buildCo(q2,logGroup,xr,shtRaw,dim){
    const puL=buildPU(xr,shtRaw,lnk,dim), puA=buildPU(xr,shtRaw,nk,dim);
    const xGroup=groupBy(xr,r=>keyDP(r.date,r.pa),rs=>({date:rs[0].date,paG:rs[0].pa,post:sum(rs,'post'),rek:sum(rs,'rek'),rekMP:sum(rs,'rekMP'),rekBlog:sum(rs,'rekBlog')}));
    const comb=[];
    xGroup.forEach(r=>comb.push({date:r.date,paG:r.paG,rek:r.rek,rekMP:r.rekMP,rekBlog:r.rekBlog,post:r.post}));
    q2.forEach(r=>comb.push({date:r.date,paG:r.paG,zaks:r.zaks,vyks:r.vyks,zakr:r.zakr,vykr:r.vykr,nalog:r.nalog}));
    logGroup.forEach(r=>comb.push({date:r.date,paG:r.paG,hran:r.hran,dost:r.dost}));
    return groupBy(comb.filter(r=>r.date),r=>keyDP(r.date,r.paG),rs=>{
      const paG=rs[0].paG,date=rs[0].date,vyks=sum(rs,'vyks');
      let pu=puL[lnk(paG)]; if(pu===undefined)pu=puA[nk(paG)];
      return {paG,y:date.getFullYear(),m:date.getMonth()+1,zaks:sum(rs,'zaks'),vyks,zakr:sum(rs,'zakr'),vykr:sum(rs,'vykr'),
        rek:sum(rs,'rek'),rekMP:sum(rs,'rekMP'),rekBlog:sum(rs,'rekBlog'),
        post:sum(rs,'post'),nalog:sum(rs,'nalog'),hran:sum(rs,'hran'),dost:sum(rs,'dost'),perem:Math.round((pu||0)*vyks)};
    });
  }

  /* ставки налога: EF переходит на 12% с 01.02.2026, EZFR всегда 7% */
  const TAX_EF=(y,m)=>((y>2026||(y===2026&&m>=2))?0.12:0.07);
  const TAX_EZ=()=>0.07;

  const salesEF=parseSales(raw.report,null);
  /* EZFR: если есть еженедельный финотчёт — берём оттуда, иначе старый report2 */
  const salesEZ=parseSales(raw.report2,0.07);
  const ezOwn=xRows2.length>0;   /* у EZFR своя бухгалтерия (лист Расход EZFR) */
  const setEF=new Set(salesEF.map(r=>lnk(r.paG))), setEZ=new Set(salesEZ.map(r=>lnk(r.paG)));
  const xEF=[],xEZ=[];
  if(ezOwn){
    /* Свой лист Расход убирает ретроспективный роутинг: расходы EZFR больше
       не выковыриваются из общего листа, а берутся напрямую из rashod2. */
    xRows.forEach(r=>xEF.push(r));
  } else {
    xRows.forEach(r=>{ const k=lnk(r.pa);
      if(setEZ.has(k)&&!setEF.has(k)){ xEZ.push(Object.assign({},r,{post:0})); } else { xEF.push(r); } });
  }
  /* ── EF: если приехал еженедельный финотчёт WB — собираем как EZFR ──
     Выкупы, комиссия, логистика, хранение, налог → из финотчёта.
     Переменные, реклама, постоянные → из бухгалтерии (лист Расход).
     Заказы → из report (в финотчёте их нет). */
  const efFin=!!(raw.wbfin_ef&&raw.wbfin_ef.length);
  const obEF=efFin?parseWBFin(raw.wbfin_ef,TAX_EF):buildCo(salesEF,parseLog(raw.log),xEF,raw.sht,artDim);

  if(efFin){
    const puLE=buildPU(xEF,raw.sht,lnk,artDim), puAE=buildPU(xEF,raw.sht,nk,artDim);
    let noPU=0;
    for(const r of obEF){
      let pu=puLE[lnk(r.paG)]; if(pu===undefined)pu=puAE[nk(r.paG)];
      if(pu===undefined&&r.vyks)noPU++;
      r.perem=Math.round((pu||0)*r.vyks);
      if(r.rekWB) r.rek-=r.rekWB;   /* удержания WB гасим — реклама идёт из бухгалтерии; штрафы остаются */
    }
    let rekMP=0,rekBlog=0,postBuh=0;
    groupBy(xEF.filter(r=>r.rek||r.post),r=>r.date.getFullYear()+'-'+(r.date.getMonth()+1)+'|'+r.pa,
      rs=>({y:rs[0].date.getFullYear(),m:rs[0].date.getMonth()+1,paG:rs[0].pa,
            rek:sum(rs,'rek'),rekMP:sum(rs,'rekMP'),rekBlog:sum(rs,'rekBlog'),post:sum(rs,'post')}))
      .forEach(g=>{ rekMP+=g.rekMP; rekBlog+=g.rekBlog; postBuh+=g.post;
        obEF.push({paG:g.paG,y:g.y,m:g.m,zaks:0,vyks:0,zakr:0,vykr:0,kom:0,
          rek:g.rek,rekMP:g.rekMP,rekBlog:g.rekBlog,rekWB:0,post:g.post,nalog:0,hran:0,dost:0,perem:0}); });
    /* Заказы из report. ВАЖНО: у артикула за месяц в obEF может быть НЕСКОЛЬКО строк
       (продажи, ПВЗ, компенсации). Раздавать месячный итог заказов в каждую — двоит.
       Поэтому кладём заказы ОТДЕЛЬНЫМИ строками (по одной на месяц-артикул). */
    const omEF={};
    for(const r of salesEF){ if(!r.date)continue;
      const k=r.date.getFullYear()+'|'+(r.date.getMonth()+1)+'|'+r.paG;
      const o=omEF[k]||(omEF[k]={y:r.date.getFullYear(),m:r.date.getMonth()+1,paG:r.paG,zaks:0,zakr:0});
      o.zaks+=r.zaks; o.zakr+=r.zakr; }
    for(const o of Object.values(omEF)){
      obEF.push({paG:o.paG,y:o.y,m:o.m,zaks:o.zaks,zakr:o.zakr,
        vyks:0,vykr:0,kom:0,rek:0,post:0,nalog:0,hran:0,dost:0,perem:0}); }
    const rekWBef=obEF.reduce((s,r)=>s+(r.rekWB||0),0);
    diag.push({name:'EF: финотчёт WB',status:noPU?'warn':'ok',rows:obEF.length,
      msg:`Реклама: площадка ${Math.round(rekMP).toLocaleString('ru-RU')} ₽ + блогеры ${Math.round(rekBlog).toLocaleString('ru-RU')} ₽`
        +` (удержания в финотчёте: ${Math.round(rekWBef).toLocaleString('ru-RU')} ₽) · Пост.Р: ${Math.round(postBuh).toLocaleString('ru-RU')} ₽`
        +(noPU?` · без себестоимости: ${noPU} строк`:'')});
  }
  acGroup.forEach(r=>obEF.push({paG:r.paG,y:r.date.getFullYear(),m:r.date.getMonth()+1,zaks:0,vyks:0,zakr:0,vykr:0,rek:0,post:0,nalog:0,hran:0,dost:0,perem:0}));

  const ezFin=!!(raw.wbfin_ezfr&&raw.wbfin_ezfr.length);
  const obEZ=ezFin?parseWBFin(raw.wbfin_ezfr,TAX_EZ):buildCo(salesEZ,parseLog(raw.log2),xEZ,raw.sht2,artDim2.length?artDim2:artDim);

  /* ── EZFR на финотчёте + своя бухгалтерия: переменные и реклама из rashod2/sht2 ──
     Реклама берётся из БУХГАЛТЕРИИ. «Удержания» WB из финотчёта остаются в поле rekWB —
     показываем их справочно рядом (в скобках), НЕ складываем: это те же деньги. */
  if(ezFin&&ezOwn){
    const dim2=artDim2.length?artDim2:artDim;
    const puL2=buildPU(xRows2,raw.sht2,lnk,dim2), puA2=buildPU(xRows2,raw.sht2,nk,dim2);
    let noPU=0;
    for(const r of obEZ){
      let pu=puL2[lnk(r.paG)]; if(pu===undefined)pu=puA2[nk(r.paG)];
      if(pu===undefined&&r.vyks)noPU++;
      r.perem=Math.round((pu||0)*r.vyks);
      if(r.rekWB) r.rek-=r.rekWB;    /* гасим только «Удержания WB» — штрафы остаются расходом */
    }
    /* Реклама и ПОСТОЯННЫЕ из бухгалтерии EZFR, помесячно по артикулу. */
    let rekMP=0,rekBlog=0,postBuh=0;
    groupBy(xRows2.filter(r=>r.rek||r.post),r=>r.date.getFullYear()+'-'+(r.date.getMonth()+1)+'|'+r.pa,
      rs=>({y:rs[0].date.getFullYear(),m:rs[0].date.getMonth()+1,paG:rs[0].pa,
            rek:sum(rs,'rek'),rekMP:sum(rs,'rekMP'),rekBlog:sum(rs,'rekBlog'),post:sum(rs,'post')}))
      .forEach(g=>{ rekMP+=g.rekMP; rekBlog+=g.rekBlog; postBuh+=g.post;
        obEZ.push({paG:g.paG,y:g.y,m:g.m,zaks:0,vyks:0,zakr:0,vykr:0,kom:0,
          rek:g.rek,rekMP:g.rekMP,rekBlog:g.rekBlog,rekWB:0,post:g.post,nalog:0,hran:0,dost:0,perem:0}); });
    const rekWB=obEZ.reduce((s,r)=>s+(r.rekWB||0),0);
    diag.push({name:'EZFR: своя бухгалтерия',status:noPU?'warn':'ok',rows:xRows2.length,
      msg:`Реклама: площадка ${Math.round(rekMP).toLocaleString('ru-RU')} ₽ + блогеры ${Math.round(rekBlog).toLocaleString('ru-RU')} ₽`
        +` (удержания в финотчёте WB: ${Math.round(rekWB).toLocaleString('ru-RU')} ₽) · Пост.Р: ${Math.round(postBuh).toLocaleString('ru-RU')} ₽`
        +(noPU?` · без себестоимости: ${noPU} строк с выкупами — нет пары в Расход/ШТУК EZFR`:'')});
  }

  /* Заказы EZFR из report2 — отдельными строками (та же защита от двоения, что у EF). */
  if(raw.wbfin_ezfr&&raw.wbfin_ezfr.length&&salesEZ.length){
    const orderMap={};
    for(const r of salesEZ){if(!r.date)continue;
      const key=r.date.getFullYear()+'|'+(r.date.getMonth()+1)+'|'+r.paG;
      const o=orderMap[key]||(orderMap[key]={y:r.date.getFullYear(),m:r.date.getMonth()+1,paG:r.paG,zaks:0,zakr:0});
      o.zaks+=r.zaks; o.zakr+=r.zakr;}
    for(const o of Object.values(orderMap)){
      obEZ.push({paG:o.paG,y:o.y,m:o.m,zaks:o.zaks,zakr:o.zakr,
        vyks:0,vykr:0,kom:0,rek:0,post:0,nalog:0,hran:0,dost:0,perem:0});}
  }

  /* ── parseWBFin: еженедельный финотчёт WB → схема P&L (вариант Б: gross + комиссия) ── */
  /* Логистика WB = Доставка[37] + ПВЗ[28] + Возмещение издержек[58] + Приёмка[62]  */
  /* Хранение отдельно = [60]                                                        */
  /* taxFn(y,m) → ставка налога. EZFR: всегда 7%. EF: 7% до 01.02.2026, далее 12%. */
  function parseWBFin(rr,taxFn){
    if(!rr||!rr.length)return[];
    const H=rr._headers;
    const c_art=col(H,'Артикул поставщика');
    const c_pred=col(H,'Предмет');
    const c_reason=col(H,'Обоснование для оплаты');
    const c_doctype=col(H,'Тип документа');
    const c_date=col(H,'Дата продажи');
    const c_qty=col(H,'Кол-во');
    const c_retail=col(H,'Вайлдберриз реализовал Товар (Пр)','Вайлдберриз реализовал Товар','Вайлдберриз реализовал товар (Пр)');
    const c_pay=col(H,'К перечислению Продавцу за реализованный Товар','К перечислению Продавцу');
    const c_dost=col(H,'Услуги по доставке товара покупателю');
    const c_pvz=col(H,'Возмещение за выдачу и возврат товаров на ПВЗ');
    const c_vozmesh=col(H,'Возмещение издержек по перевозке/по складским операциям с товаром');
    const c_priemka=col(H,'Операции на приемке','Операции на приёмке');
    const c_hran=col(H,'Хранение');
    const c_uderz=col(H,'Удержания');
    const c_shtraf=col(H,'Общая сумма штрафов');
    /* ── детализация комиссии (для вкладок «Разбор» и «Комиссия ВБ») ── */
    const c_rozn=col(H,'Цена розничная');                                    /* [15] за ЕДИНИЦУ → умножаем на Кол-во */
    const c_vv=col(H,'Вознаграждение Вайлдберриз (ВВ), без НДС');            /* [32] */
    const c_vvnds=col(H,'НДС с Вознаграждения Вайлдберриз');                 /* [33] */
    const c_ekv=col(H,'Компенсация платёжных услуг/Комиссия за интеграцию платёжных сервисов',
                     'Компенсация платежных услуг/Комиссия за интеграцию платежных сервисов',
                     'Компенсация платёжных услуг');                          /* [29] эквайринг */
    const c_ekvtype=col(H,'Тип платежа: компенсация платёжных услуг/Комиссия за интеграцию платёжных сервисов',
                          'Тип платежа: компенсация платежных услуг/Комиссия за интеграцию платежных сервисов',
                          'Тип платежа за Эквайринг/Комиссии за организацию платежей');
    /* Эквайринг удержан из «К перечислению» НЕ всегда:
         «Перевыставление эквайринга», «Компенсация платёжных услуг» → удержан, входит в kom
         «Комиссия за организацию платежа с НДС»                     → НЕ удержан, WB выставляет счёт
       Если считать его в kom всегда — тождество kom == ВВ+НДС+эквайринг+ПВЗ рвётся. */
    const EKV_BILLED=/комисси\S* за организацию платеж/i;
    /* ВАЖНО: ПВЗ [28] на строках Продажа/Возврат уже входит в (vykr − К перечислению),
       поэтому здесь он идёт ТОЛЬКО как компонент комиссии. Отдельные строки
       «Возмещение за выдачу…» — другие строки, они идут в dost (логистику). */

    const map={};
    const totals={}; /* хранение и удержания без артикула — по месяцам */
    const ym=d=>d.getFullYear()+'-'+(d.getMonth()+1);

    const getOrCreate=(key,paG,d)=>map[key]||(map[key]={paG,y:d.getFullYear(),m:d.getMonth()+1,
      vyks:0,vykrGross:0,kPerech:0,dost:0,komp:0,
      rozn:0,vv:0,vvNds:0,ekvair:0,ekvBill:0,pvz:0});
    const getTotals=k=>totals[k]||(totals[k]={y:0,m:0,hran:0,rek:0,shtraf:0,priemka:0});
    const resolveArt=art=>{
      const rec=artByPostL.get(lnk(art))||artByPostA.get(nk(art));
      return rec?rec.paG:('#'+art);
    };

    rr.forEach(r=>{
      const d=pdate(r[c_date]); if(!d)return;
      const reason=(r[c_reason]||'').trim();
      const art=(r[c_art]||'').trim();
      const k_ym=ym(d);

      /* ── Продажи / Возвраты / Компенсации ── */
      /* Компенсации: WB ПЛАТИТ продавцу (брак, утеря, подмена). Это не выручка от продажи:
         «ВБ реализовал» = 0, комиссии нет, а «К перечислению» положительное.
         Держать их в продажной ветке нельзя — рвётся тождество
         kom == ВВ+НДС+эквайринг+ПВЗ (kom уходил в минус без компонент). */
      if(reason==='Добровольная компенсация при возврате'||reason==='Компенсация ущерба'){
        const sg=(r[c_doctype]||'').trim()==='Продажа'?1:-1;
        const paG=art?resolveArt(art):'(Компенсации WB)';
        const o=getOrCreate(k_ym+'|'+paG,paG,d);
        o.komp+=sg*num(r[c_pay]);
      }
      else if(reason==='Продажа'||reason==='Возврат'){
        if(!art)return;
        const paG=resolveArt(art);
        const o=getOrCreate(k_ym+'|'+paG,paG,d);
        const qty=intn(r[c_qty]);
        const retail=num(r[c_retail]);
        const pay=num(r[c_pay]);
        const isSale=(r[c_doctype]||'').trim()==='Продажа';
        const sg=isSale?1:-1;
        o.vyks      += sg*qty;
        o.vykrGross += sg*retail;
        o.kPerech   += sg*pay;
        /* компоненты комиссии: ВВ + НДС ВВ + эквайринг + ПВЗ ≡ vykrGross − kPerech */
        o.rozn      += sg*num(r[c_rozn])*qty;
        o.vv        += sg*num(r[c_vv]);
        o.vvNds     += sg*num(r[c_vvnds]);
        const ekvV=num(r[c_ekv]), ekvBilled=EKV_BILLED.test(String(c_ekvtype?(r[c_ekvtype]||''):''));
        o.ekvair    += sg*(ekvBilled?0:ekvV);   /* удержан из выплаты */
        o.ekvBill   += sg*(ekvBilled?ekvV:0);   /* выставлен счётом — вне kom */
        o.pvz       += sg*num(r[c_pvz]);
      }
      /* ── Логистика (доставка по артикулам) ── */
      else if(reason==='Логистика'){
        if(!art)return;
        const paG=resolveArt(art);
        const o=getOrCreate(k_ym+'|'+paG,paG,d);
        o.dost+=num(r[c_dost]);
      }
      /* ── Возмещение за выдачу на ПВЗ (по артикулам если есть) ── */
      else if(reason==='Возмещение за выдачу и возврат товаров на ПВЗ'){
        const v=num(r[c_pvz]);
        if(art){const paG=resolveArt(art);const o=getOrCreate(k_ym+'|'+paG,paG,d);o.dost+=v;}
        else{const t=getTotals(k_ym);t.y=d.getFullYear();t.m=d.getMonth()+1;t.priemka+=v;}
      }
      /* ── Возмещение издержек по перевозке (по артикулам если есть) ── */
      else if(reason==='Возмещение издержек по перевозке/по складским операциям с товаром'){
        const v=num(r[c_vozmesh]);
        if(art){const paG=resolveArt(art);const o=getOrCreate(k_ym+'|'+paG,paG,d);o.dost+=v;}
        else{const t=getTotals(k_ym);t.y=d.getFullYear();t.m=d.getMonth()+1;t.priemka+=v;}
      }
      /* ── Обработка товара / приёмка ── */
      else if(reason==='Обработка товара'){
        const v=num(r[c_priemka]);
        if(art){const paG=resolveArt(art);const o=getOrCreate(k_ym+'|'+paG,paG,d);o.dost+=v;}
        else{const t=getTotals(k_ym);t.y=d.getFullYear();t.m=d.getMonth()+1;t.priemka+=v;}
      }
      /* ── Хранение (без артикула) ── */
      else if(reason==='Хранение'){
        const t=getTotals(k_ym);t.y=d.getFullYear();t.m=d.getMonth()+1;
        t.hran+=num(r[c_hran]);
      }
      /* ── Удержания = WB Продвижение, Джем, опции и пр. ── */
      else if(reason==='Удержание'){
        const t=getTotals(k_ym);t.y=d.getFullYear();t.m=d.getMonth()+1;
        t.rek+=num(r[c_uderz]);
      }
      /* ── Штрафы ── */
      else if(reason==='Штраф'){
        const t=getTotals(k_ym);t.y=d.getFullYear();t.m=d.getMonth()+1;
        t.shtraf+=num(r[c_shtraf]);
      }
    });

    /* Собираем финальные строки */
    const out=[];
    for(const o of Object.values(map)){
      const vykr=Math.round(o.vykrGross);
      /* НЕ клампить в 0: если возвратов больше продаж, WB возвращает комиссию,
         и kom честно отрицательный. Math.max(0,…) рвал тождество
         kom == ВВ+НДС+эквайринг+ПВЗ и раздувал «нераспознано» до тысяч процентов. */
      const kom=Math.round(o.vykrGross-o.kPerech);
      const net=Math.round(o.kPerech);
      const komp=Math.round(o.komp);
      const vv=Math.round(o.vv),vvNds=Math.round(o.vvNds),ekvair=Math.round(o.ekvair),pvz=Math.round(o.pvz);
      const ekvBill=Math.round(o.ekvBill);
      out.push({paG:o.paG,y:o.y,m:o.m,
        zaks:0,vyks:o.vyks,zakr:0,vykr,
        kom,komp,rek:0,post:0,
        /* налог с того, что реально пришло: К перечислению + компенсации */
        nalog:Math.round((net+komp)*(taxFn?taxFn(o.y,o.m):0.07)),
        hran:0,dost:Math.round(o.dost),perem:0,
        /* ── детализация для «Разбор» / «Комиссия ВБ» ── */
        ekvBill,                          /* эквайринг отдельным счётом (НЕ удержан из выплаты) */
        rozn:Math.round(o.rozn),          /* розничная цена до скидки WB */
        vv,vvNds,ekvair,pvz,              /* компоненты комиссии */
        komOther:kom-(vv+vvNds+ekvair+pvz)/* остаток (должен быть ≈0) */
      });
    }
    /* Хранение, удержания, штрафы, приёмка (без артикула) — отдельно по месяцам */
    for(const t of Object.values(totals)){
      if(t.hran) out.push({paG:'(Хранение)',y:t.y,m:t.m,zaks:0,vyks:0,zakr:0,vykr:0,kom:0,rek:0,post:0,nalog:0,hran:Math.round(t.hran),dost:0,perem:0});
      /* rekWB дублирует rek: если у EZFR своя бухгалтерия, rek гасится, а rekWB остаётся для справки */
      if(t.rek)  out.push({paG:'(Удержания WB)',y:t.y,m:t.m,zaks:0,vyks:0,zakr:0,vykr:0,kom:0,rek:Math.round(t.rek),rekWB:Math.round(t.rek),post:0,nalog:0,hran:0,dost:0,perem:0});
      if(t.shtraf) out.push({paG:'(Штрафы)',y:t.y,m:t.m,zaks:0,vyks:0,zakr:0,vykr:0,kom:0,rek:Math.round(t.shtraf),post:0,nalog:0,hran:0,dost:0,perem:0});
      if(t.priemka) out.push({paG:'(Приёмка/ПВЗ)',y:t.y,m:t.m,zaks:0,vyks:0,zakr:0,vykr:0,kom:0,rek:0,post:0,nalog:0,hran:0,dost:Math.round(t.priemka),perem:0});
    }
    return out;
  }

  /* ── Ozon: отчёт по начислениям → схема Общего ── */
  function parseOzon(rr){
    if(!rr||!rr.length)return[];
    const H=rr._headers;
    const c_date=col(H,'Дата начисления'),
          c_grp=col(H,'Группа услуг'),
          c_typ=col(H,'Тип начисления'),
          c_art=col(H,'Артикул'),
          c_qty=col(H,'Количество'),
          c_sum=col(H,'Сумма итого, руб.','Сумма итого руб','Сумма итого');
    if(!c_sum||!c_date)return[];

    const eH=(raw.ekon&&raw.ekon._headers)||[];
    const e_code=col(eH,'Код латиница','Код  латиница','Латиница'),
          e_pa=col(eH,'Предмет;Артикул поставщика','Предмет;Артикул.Глубина','Сцепка'),
          e_art=col(eH,'Артикул поставщика','Артикул'),
          e_rs=col(eH,'Расход-ШТ','Расход-Шт','Расход ШТ');

    const ekonRS={};
    if(e_rs)(raw.ekon||[]).forEach(r=>{
        const rs=num(r[e_rs]);
        [e_code&&r[e_code],e_pa&&r[e_pa],e_art&&r[e_art]].forEach(k=>{
            if(k){const kk=lnk(k);if(kk&&ekonRS[kk]===undefined)ekonRS[kk]=rs;}
        });
    });

    const cleanCode=art=>{
        let a=String(art||'').replace('_XL','_1XL');
        let b=a.split('_')[0];
        let c=b.split('0')[0];
        return c.replace(/TermSocks\.Al-ESS\.(black|blue|grey|pink|purp)\./i,'TermSocks.Al-ESS.');
    };

    /* Классификация по ТИПУ начисления (как в PBI), не по группе */
    const OZ_LOG_TYPES=new Set(["Логистика","Обеспечение материалами для упаковки товара",
      "Обработка возвратов Ozon","Обработка возвратов, отмен и невыкупов партнёрами",
      "Обработка отменённых и невостребованных товаров","Обработка частичного невыкупа",
      "Обратная логистика","Последняя миля","Упаковка товара партнёрами","Эквайринг",
      "Потеря по вине Ozon в логистике",
      "Выдача товара - отмена начисления (Сторно возвратов на ПВЗ)",
      "Логистика - отмена начисления","Доставка до места выдачи - отмена начисления",
      "Бронирование места и персонала для поставки с неполным составом в составе грузоместа",
      "Утилизация товара: Вы не забрали в срок","Утилизация товара: Повреждённые из-за упаковки",
      "Кросс-докинг","Выдача товара","Доставка до места выдачи"]);
    const OZ_REK_TYPES=new Set(["Вывод в топ","Трафареты","Оплата за клик","Продвижение с оплатой за заказ"]);

    const map={};

    rr.forEach(r=>{
        const d=pdate(r[c_date]); if(!d)return;
        const typ=String(r[c_typ]||'').trim();
        const art=String(r[c_art]||'').trim();
        const qty=Math.abs(num(r[c_qty]));
        const s=num(r[c_sum]);

        const base=art.split('_')[0]||art;
        const rec=artByPostL.get(lnk(base))||artByPostA.get(nk(base));
        const paG=rec?rec.paG:base;
        const paP=rec?rec.paP:'';
        const key=d.getFullYear()+'-'+(d.getMonth()+1)+'|'+paG;

        const o=map[key]||(map[key]={
            y:d.getFullYear(),m:d.getMonth()+1,
            paG,paP,base,code:cleanCode(art),
            orderQty:0,salesQty:0,
            salesRub:0,bonusRub:0,returnRub:0,partnerRub:0,
            kom:0,log:0,rek:0
        });

        /* Штуки */
        if(typ==='Выручка') o.salesQty+=qty;
        if(typ==='Логистика') o.orderQty+=qty;

        /* Рубли — единая цепочка по ТИПУ начисления (PBI-совместимо) */
        if(typ==='Выручка') o.salesRub+=s;
        else if(typ==='Баллы за скидки') o.bonusRub+=s;
        else if(typ==='Возврат выручки') o.returnRub+=s;
        else if(typ==='Программы партнёров') o.partnerRub+=s;
        else if(typ==='Вознаграждение за продажу'||typ==='Возврат вознаграждения') o.kom+=s;
        else if(OZ_LOG_TYPES.has(typ)) o.log+=s;
        else if(OZ_REK_TYPES.has(typ)) o.rek+=s;
    });

    const rsFor=o=>{
        let v=ekonRS[lnk(o.code)];
        if(v!==undefined)return v;
        if(o.paP){
            v=ekonRS[lnk(o.paP)];
            if(v!==undefined)return v;
            v=ekonRS[lnk(o.paG)];
            if(v!==undefined)return v;
        }
        v=ekonRS[lnk(o.base)];
        return v||0;
    };

    const vals=Object.values(map);
    const out=vals.map(o=>{
        const vykr=Math.round(o.salesRub+o.bonusRub+o.returnRub+o.partnerRub);
        const price=o.salesQty?vykr/o.salesQty:0;
        return{
            paG:o.paG,y:o.y,m:o.m,
            zaks:o.orderQty,
            vyks:o.salesQty,
            zakr:Math.round(price*o.orderQty),
            vykr,
            kom:Math.round(-o.kom),
            rek:Math.round(-o.rek),
            post:0,
            nalog:Math.round(vykr*((o.y>2026||(o.y===2026&&o.m>=2))?0.12:0.07)),
            hran:0,
            dost:Math.round(-o.log),
            perem:Math.round(rsFor(o)*o.salesQty)
        };
    });
    return out;
  }
  const obOZ=parseOzon(raw.ozon);

  const acForCo=ac=>ac.map(r=>({y:r.date.getFullYear(),m:r.date.getMonth()+1,paG:r.paG,acr:r.acr}));
  const postEF=(raw.post&&raw.post.length)?(function(){const pH=raw.post._headers;const p_s=col(pH,'Сумма'),p_d=col(pH,'Дата');
    return raw.post.map(r=>{const d=pdate(r[p_d]);return d?{y:d.getFullYear(),m:d.getMonth()+1,summa:intn(r[p_s])}:null;}).filter(Boolean);})():[];
  M.co={
    EF:  {ob:obEF, acr:acForCo(acGroup), postR:postEF},
    EZFR:{ob:obEZ, acr:[],               postR:[]},
    OZON:{ob:obOZ, acr:[],               postR:[]},
    CONS:{ob:obEF.concat(obEZ).concat(obOZ), acr:acForCo(acGroup), postR:postEF},
  };
  applyCompany();
  diag.push({name:'Компании',status:'ok',rows:0,msg:`EF: ${obEF.length} строк · EZFR: ${obEZ.length} · Ozon: ${obOZ.length}`});
  const totPerem=(M.obshiy||[]).reduce((s,r)=>s+r.perem,0);
  diag.push({name:'Общий (тек. компания)',status:'ok',rows:(M.obshiy||[]).length,msg:`Σ Переменные = ${Math.round(totPerem).toLocaleString('ru-RU')} · годы: ${M.years.join(', ')}`});
}
function applyCompany(){
  const c=(M.co&&M.co[curCo])||(M.co&&M.co.EF); if(!c)return;
  M.obshiy=c.ob; M.acruals=c.acr; M.postR=c.postR;
  M.years=[...new Set(c.ob.map(r=>r.y))].filter(y=>y>=2018&&y<=(new Date().getFullYear()+1)).sort((a,b)=>b-a);
  M.loaded=true;
}
function keyDP(d,pa){return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate()+'|'+pa;}
function sum(a,f){let s=0;for(const x of a){const v=x[f];if(typeof v==='number')s+=v;}return s;}
function groupBy(arr,kf,af){const m=new Map();for(const x of arr){const k=kf(x);if(!m.has(k))m.set(k,[]);m.get(k).push(x);}const o=[];for(const rs of m.values())o.push(af(rs));return o;}
