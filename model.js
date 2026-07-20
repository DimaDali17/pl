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

  /* ═══ Артикул dim — читаем ПОЗИЦИОННО ═══
     На листе справочника колонка «Предмет» встречается ДВАЖДЫ: настоящая (индекс 1)
     и служебная в соседней вспомогательной таблице (индекс 6, рядом с «Что»/списком
     предметов). Объектное представление схлопывает одноимённые колонки, и предмет
     мог браться из служебной — отсюда «Проценты», «Вешалки-плечики», «Капоры»
     в качестве предметов. Берём ПЕРВОЕ вхождение каждой колонки по индексу. */
  const artPos=(function(){
    const rows=parseCSV(texts.art||'');
    if(!rows.length)return{rows:[],idx:{},H:[]};
    const H=rows[0].map(x=>String(x==null?'':x).trim());
    const find=(...res)=>{ for(const re of res){ for(let i=0;i<H.length;i++){ if(re.test(H[i]))return i; } } return -1; };
    const idx={
      pred:find(/^Предмет$/i),
      post:find(/^Артикул\s*поставщика$/i,/Артикул\s*поставщика/i),
      glub:find(/^Артикул[.\s]*Глубина$/i,/Артикул[.\s]*Глубина/i),
      pnew:find(/^Предмет[_;]\s*Новый$/i),
      scep:find(/^Сцепка$/i,/^Сцепка/i)
    };
    const g=(r,i)=>i>=0?String(r[i]==null?'':r[i]).trim():'';
    return {H,idx,rows:rows.slice(1).map(r=>({
      predmet:g(r,idx.pred),post:g(r,idx.post),glub:g(r,idx.glub),
      pnew:g(r,idx.pnew),scep:g(r,idx.scep)}))};
  })();
  const c_pred=artPos.H[artPos.idx.pred]||'Предмет',c_post=artPos.H[artPos.idx.post]||'—',
        c_glub=artPos.H[artPos.idx.glub]||'—',c_scep=artPos.H[artPos.idx.scep]||'—';
  const artDim=[]; const artByPostL=new Map(), artByPostA=new Map(); const artByPredArt=new Map();
  let predEmpty=0;
  artPos.rows.forEach(r=>{
    let predmet=r.predmet; const post=r.post,glub=r.glub,pnew=r.pnew;
    const scep=r.scep;
    let predSrc=predmet?'колонка Предмет':'';
    /* если «Предмет» пуст — восстановим из «Сцепка» (Сцепка = Предмет+Артикул поставщика) */
    if(!predmet&&scep&&post&&scep.length>post.length&&nk(scep).endsWith(nk(post))){
      let cut=scep.length; const npost=nk(post); let acc='';
      for(let i=scep.length-1;i>=0;i--){ acc=nk(scep[i])+acc; cut=i; if(acc===npost)break; }
      predmet=scep.slice(0,cut).trim(); predSrc='Сцепка';
    }
    if(!predmet&&scep&&glub&&nk(scep).endsWith(nk(glub))){ predmet=scep.slice(0,scep.length-glub.length).trim(); predSrc='Сцепка'; }
    if(!predmet)predEmpty++;
    const paG=predmet+glub, paP=predmet+post; if(paP===''||paP===';')return;
    const rec={predmet,post,glub,pnew:pnew||predmet,paG,paP,scep,predSrc}; artDim.push(rec);
    if(post){ artByPostL.set(lnk(post),rec); artByPostA.set(nk(post),rec); }
    artByPredArt.set(nk(predmet)+'|'+nk(post),rec);
  });
  M.artByPaG={}; artDim.forEach(a=>{ M.artByPaG[a.paP]=a; M.artByPaG[a.paG]=a; });
  const smp0=artDim[0]||{};
  diag.push({name:'Артикул (справочник)',status:predEmpty>artDim.length*0.5?'err':'ok',rows:artDim.length,
    msg:`Предмет-колонка: ${c_pred||'—'} · пустых предметов: ${predEmpty} · пример: «${smp0.predmet||''}» + «${smp0.glub||''}» → ключ «${smp0.paG||''}»`});

  /* Диагностика справочника: заголовки с индексами, дубли имён и «залипшие» значения
     глубины. Если один и тот же артикул стоит глубиной у многих предметов — колонка
     читается не та (лист с блоками рядом + схлопывание одинаковых заголовков). */
  {const aH2=artPos.H.slice();
   const cnt={}; aH2.forEach(h=>{ if(h)cnt[h]=(cnt[h]||0)+1; });
   const dup=Object.keys(cnt).filter(k=>cnt[k]>1);
   const gc={},pc={};
   artDim.forEach(a=>{ if(a.glub)gc[a.glub]=(gc[a.glub]||0)+1; if(a.post)pc[a.post]=(pc[a.post]||0)+1; });
   const top=o=>Object.keys(o).sort((x,y)=>o[y]-o[x]).slice(0,4).map(k=>`«${k}»×${o[k]}`).join(' · ');
   const gTop=Object.keys(gc).sort((x,y)=>gc[y]-gc[x])[0];
   const bad=gTop&&gc[gTop]>3;
   diag.push({name:'Справочник: колонки',status:(dup.length||bad)?'warn':'ok',rows:artDim.length,
     msg:`заголовки: ${aH2.map((h,i)=>i+':'+(h||'—')).join(' | ')}`
       +` ‖ выбрано ПОЗИЦИОННО: Предмет[${artPos.idx.pred}] · Артикул поставщика[${artPos.idx.post}]`
       +` · Артикул.Глубина[${artPos.idx.glub}] · Сцепка[${artPos.idx.scep}]`
       +(dup.length?` ‖ ⚠ ДУБЛИ ИМЁН: ${dup.join(', ')}`:'')
       +` ‖ частые значения глубины: ${top(gc)||'—'}`
       +` ‖ частые артикулы поставщика: ${top(pc)||'—'}`
       +` ‖ первые строки: ${artDim.slice(0,4).map(a=>`[предмет «${a.predmet}» | арт «${a.post}» | глуб «${a.glub}»]`).join(' ')}`
       +(bad?` ‖ ⚠ глубина «${gTop}» повторяется у ${gc[gTop]} предметов — похоже, колонка читается не та`:'')});}

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

  /* ═══════ УМНАЯ СЦЕПКА ═══════
     Любое написание «Предмет+Артикул» → канонический paG из справочника.
     Порядок попыток:
       1) точное совпадение сцепки без регистра/пробелов (paP / paG / Сцепка)
       2) хвост строки == артикул поставщика или Артикул.Глубина (длинный выигрывает)
     resolvePA(s)      → если не нашли, вернёт исходную строку
     resolvePA(s,'')   → если не нашли, вернёт '' (для финотчёта) */
  const artKeyIndex=new Map(), artSuffix=[];
  [].concat(artDim,artDim2).forEach(a=>{
    [a.paP,a.paG,a.scep].forEach(k=>{ if(k){ const n=nk(k); if(n&&!artKeyIndex.has(n))artKeyIndex.set(n,a); } });
    if(a.post){ const n=nk(a.post); if(n)artSuffix.push([n,a]); }
    if(a.glub){ const n=nk(a.glub); if(n)artSuffix.push([n,a]); }
  });
  artSuffix.sort((x,y)=>y[0].length-x[0].length);   /* длинный артикул выигрывает */
  function resolvePA(s,fallback){
    const rawS=String(s==null?'':s).trim();
    if(!rawS) return fallback===undefined?'':fallback;
    const n=nk(rawS);
    const rec=artKeyIndex.get(n);
    if(rec) return rec.paG;
    for(let i=0;i<artSuffix.length;i++){
      const art=artSuffix[i][0];
      if(art.length>2&&n.endsWith(art)) return artSuffix[i][1].paG;
    }
    return fallback===undefined?rawS:fallback;
  }
  const isResolved=p=>artKeyIndex.has(nk(p));
  /* ── Ключ себестоимости: ТОЛЬКО Артикул.Глубина, без предмета ──
     Предмет у одного артикула в разных листах отличается: в ШТУК «Бандалетки»,
     в финотчёте/справочнике — «Бюстгальтеры», «Колготки», «Капоры». Глубина при
     этом одна. Ключ «Предмет+Глубина» из-за этого рассыпался на 6 разных ключей,
     и себестоимость не находилась ни по одному. */
  function recOf(sv){
    const raw=String(sv==null?'':sv).trim(); if(!raw)return null;
    const n=nk(raw);
    const r=artKeyIndex.get(n); if(r)return r;
    for(let i=0;i<artSuffix.length;i++){ const a=artSuffix[i][0]; if(a.length>2&&n.endsWith(a))return artSuffix[i][1]; }
    return null;
  }
  /* Глубинный ключ записи справочника:
       есть Артикул.Глубина  → она (TB21white и TB21black → TB21black)
       глубины нет           → сам ПРЕДМЕТ («Боди», «Водолазки» — бухгалтерия по предмету)
       нет и предмета        → артикул поставщика (последняя соломинка) */
  const deepKey=r=>r?(nk(r.glub||'')||nk(r.predmet||'')||nk(r.post||'')):'';
  /* глубины, размазанные больше чем по 2 предметам, для расчёта себестоимости
     непригодны — по ним нельзя складывать расход и штуки */
  const glubBad=new Set();
  function glubKey(sv){ const k=deepKey(recOf(sv)); return glubBad.has(k)?'':k; }
  /* ── Канонический ключ строки P&L ──
     Одна глубина = одна строка. TB21white и TB21black схлопываются в TB21black.
     Предмет берём ПЕРВЫЙ по справочнику для этой глубины: у ВБ один и тот же
     артикул приходит под разными предметами («Бюстгальтеры», «Колготки», «Капоры»
     для essбандалеткибеж), и без канона строка рассыпалась на шесть. */
  const glubCanon=new Map();
  [].concat(artDim,artDim2).forEach(a=>{ const g=deepKey(a);
    if(g&&!glubCanon.has(g))glubCanon.set(g,a); });
  /* ВНИМАНИЕ: canonOf НЕ применяется к ключам расчёта. В справочнике одна глубина
     стоит у 13 разных предметов («essбандалеткибеж»), и канонизация стягивала
     несвязанные товары в один ключ — расход переставал сходиться с финотчётом.
     Используется только в диагностике «Глубина: разные предметы». */
  const canonOf=rec=>{ if(!rec)return rec; const g=deepKey(rec);
    return (g&&glubCanon.get(g))||rec; };
  {const multi=new Map();
   [].concat(artDim,artDim2).forEach(a=>{ const g=deepKey(a); if(!g)return;
     if(!multi.has(g))multi.set(g,new Set()); multi.get(g).add(a.predmet); });
   const bad=[...multi.entries()].filter(([g,st])=>st.size>1);
   bad.forEach(([g,st])=>{ if(st.size>2)glubBad.add(g); });
   /* откуда взялся предмет: из колонки «Предмет» или восстановлен из «Сцепки» */
   const srcCnt={};
   [].concat(artDim,artDim2).forEach(a=>{ const k=a.predSrc||'—'; srcCnt[k]=(srcCnt[k]||0)+1; });
   const detail=bad.slice(0,4).map(([g,st])=>{
     const rows=[].concat(artDim,artDim2).filter(a=>deepKey(a)===g);
     const win=glubCanon.get(g);
     return `«${g}»: ${rows.map(a=>`${a.predmet}[${a.predSrc||'—'}]`).slice(0,6).join(' / ')}`
       +` → оставлен «${win?win.predmet:''}»`;
   }).join(' ║ ');
   /* поимённый список: какой артикул под каким предметом записан.
      Это готовый чек-лист для правки справочника. */
   const fix=bad.slice(0,3).map(([g,st])=>{
     const rows=[].concat(artDim,artDim2).filter(a=>deepKey(a)===g);
     return `глубина «${g}»: `+rows.map(a=>`${a.post||'(без арт)'}→«${a.predmet}»`).join(', ');
   }).join(' ║ ');
   if(bad.length) diag.push({name:'Справочник: что чинить',status:'warn',rows:bad.length,
     msg:fix+' ║ у всех строк одной глубины предмет должен быть ОДИН — сейчас он разный, '
       +'и выручка одного товара разносится по нескольким предметам'});
   const noGlub=[].concat(artDim,artDim2).filter(a=>!nk(a.glub||'')).length;
   diag.push({name:'Глубина: разные предметы',status:bad.length?'warn':'ok',rows:bad.length,
     msg:(bad.length?`глубин с несколькими предметами: ${bad.length} (схлопнуты в один ключ) · `+detail
                    :'у каждой глубины один предмет')
       +` ║ без Артикул.Глубина (ключ = предмет): ${noGlub}`
       +` ║ источник предмета: ${Object.entries(srcCnt).map(([k,v])=>k+': '+v).join(' · ')}`});}

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
      /* умная сцепка: приводим ключ расхода к канону справочника */
      return {date:pdate(r[x_date]),pa:resolvePA(r[x_pa]),kon,rek,rekMP,rekBlog,post,per:s-rek-post}; }).filter(r=>r.date);
  }
  const xRows =parseRashod(raw.rashod);
  const xRows2=parseRashod(raw.rashod2);   /* своя бухгалтерия EZFR */

  /* Диагностика постоянных: теперь они идут ТОЛЬКО из Расход/Расход2, поартикульно.
     Отдельный лист «Пост» больше не используется — он давал строки без предмета
     и задваивал суммы, которые уже есть в Расход («Что» = «Пост расходы»). */
  const postRows =xRows.filter(r=>r.post);
  const postRows2=xRows2.filter(r=>r.post);
  const postNoArt =postRows.filter(r=>!isResolved(r.pa)).reduce((s,r)=>s+r.post,0);
  diag.push({name:'Пост.расходы (из Расход)',status:postNoArt?'warn':'ok',rows:postRows.length+postRows2.length,
    msg:`EF: ${Math.round(postRows.reduce((s,r)=>s+r.post,0)).toLocaleString('ru-RU')} ₽ · EZFR: ${Math.round(postRows2.reduce((s,r)=>s+r.post,0)).toLocaleString('ru-RU')} ₽`
      +(postNoArt?` · ⚠ без узнанного артикула: ${Math.round(postNoArt).toLocaleString('ru-RU')} ₽`:'')
      +` · лист «Пост» не используется`});

  /* Acruals (общий, на EF) — ключ через умную сцепку */
  const acH=raw.acr._headers||[];
  const ac_d=col(acH,'Дата'),ac_pa=col(acH,'Предмет;Артикул.Глубина','Предмет;Артикул продавца'),ac_v=col(acH,'Акруалс');
  const acRawKeys=new Set();
  const acGroup=groupBy(raw.acr.map(r=>{
      const rawKey=(r[ac_pa]||'').trim();
      const paG=resolvePA(rawKey);
      if(rawKey&&!isResolved(paG))acRawKeys.add(rawKey);
      return {date:pdate(r[ac_d]),paG,acr:intn(r[ac_v])};
    }).filter(r=>r.date),
    r=>keyDP(r.date,r.paG),rs=>({date:rs[0].date,paG:rs[0].paG,acr:sum(rs,'acr')}));
  /* Диагностика: сколько строк акруалса дошло и на какую сумму — ловит обрезку CSV */
  const acRaw=raw.acr.length;
  const acDated=raw.acr.map(r=>pdate(r[ac_d])).filter(Boolean).length;
  const acByYM={};
  acGroup.forEach(r=>{const k=r.date.getFullYear()+'-'+String(r.date.getMonth()+1).padStart(2,'0');acByYM[k]=(acByYM[k]||0)+r.acr;});
  const acTotal=acGroup.reduce((s,r)=>s+r.acr,0);
  const acMonths=Object.entries(acByYM).sort().map(([k,v])=>`${k}:${Math.round(v).toLocaleString('ru-RU')}`).join(' · ');
  /* сырой образец: что реально лежит в колонке даты (ловит формат published-CSV) */
  const acSample=raw.acr.slice(0,3).map(r=>JSON.stringify(r[ac_d])).join(', ');
  diag.push({name:'Акруалс (лист Acruals)',status:acDated<acRaw*0.9?'warn':'ok',rows:acRaw,
    msg:`строк: ${acRaw} · с датой: ${acDated} · Σ ${Math.round(acTotal).toLocaleString('ru-RU')} ₽`
      +` · колонка даты: ${JSON.stringify(ac_d)} · образец: [${acSample}]`
      +(acDated<acRaw?` · ⚠ ${acRaw-acDated} без даты`:'')
      +(acMonths?` · по месяцам: ${acMonths}`:'')});
  /* Диагностика сцепки: какие ключи акруалса не легли на справочник */
  const acBadSum=acGroup.filter(r=>!isResolved(r.paG)).reduce((s,r)=>s+r.acr,0);
  diag.push({name:'Сцепка акруалса',status:acRawKeys.size?'warn':'ok',rows:acGroup.length,
    msg:`не срезолвилось ключей: ${acRawKeys.size} на ${Math.round(acBadSum).toLocaleString('ru-RU')} ₽`
      +(acRawKeys.size?` · примеры: ${[...acRawKeys].slice(0,5).map(k=>'«'+k+'»').join(', ')}`:' · все ключи легли на справочник')});

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
  /* В листе ШТУК колонка «Артикул поставщика» фактически содержит Артикул.Глубина —
     общий артикул на несколько поставщицких. resolvePA приводит обе стороны
     (Расход и ШТУК) к каноническому paG = Предмет+Артикул.Глубина, а перенос
     pu[paG] → pu[paP] ниже раздаёт себестоимость всем артикулам этой глубины. */
  function buildPU(xr,shtP,keyFn,dim){
    const per={},sht={};
    groupBy(xr,r=>keyFn(r.pa),rs=>({k:keyFn(rs[0].pa),per:sum(rs,'per')})).forEach(g=>{if(g.k)per[g.k]=g.per;});
    (shtP||[]).forEach(p=>{ const k=keyFn(resolvePA(p.k)); if(k)sht[k]=(sht[k]||0)+intn(p.q); });
    /* уровень глубины: суммируем расход и штуки по Артикул.Глубина, без предмета */
    const perG={},shtG={};
    (xr||[]).forEach(r=>{ const g=glubKey(r.pa); if(g)perG[g]=(perG[g]||0)+r.per; });
    (shtP||[]).forEach(p=>{ const g=glubKey(p.k); if(g)shtG[g]=(shtG[g]||0)+intn(p.q); });
    const puG={}; Object.keys(perG).forEach(g=>{ if(shtG[g])puG[g]=Math.round(perG[g]/shtG[g]); });
    const pu={}; Object.keys(per).forEach(k=>{ if(sht[k])pu[k]=Math.round(per[k]/sht[k]); });
    /* прячем исходники для диагностики: enumerable:false, чтобы не мешать перебору ключей */
    Object.defineProperty(pu,'_per',{value:per,enumerable:false});
    Object.defineProperty(pu,'_sht',{value:sht,enumerable:false});
    Object.defineProperty(pu,'_puG',{value:puG,enumerable:false});
    Object.defineProperty(pu,'_perG',{value:perG,enumerable:false});
    Object.defineProperty(pu,'_shtG',{value:shtG,enumerable:false});
    (dim||artDim).forEach(a=>{ const kP=keyFn(a.paP),kG=keyFn(a.paG); const v=(pu[kP]!==undefined)?pu[kP]:(pu[kG]!==undefined?pu[kG]:undefined); if(v!==undefined){pu[kP]=v;pu[kG]=v;} });
    return pu;
  }
  /* ── Фолбэк себестоимости ──
     Лист ШТУК покрывает не все артикулы (особенно снятые с продажи 2021–2023),
     и без пары «Расход ÷ ШТ поставлено» себестоимость выходила НУЛЁМ, а прибыль
     тех лет — завышенной. Считаем среднюю по предмету, затем общую, и подставляем
     их только там, где своей себестоимости нет. Это ОЦЕНКА, не факт. */
  /* ── Лист ШТУК читаем ПОЗИЦИОННО из сырого CSV ──
     На листе ДВА блока с одинаковыми заголовками:
       левый  — «Предмет;Артикул поставщика» + «ШТ по оплатам»   (оплачено поставщику)
       правый — «Предмет;Артикул поставщика» + «ШТ поставлено»   (реально приехало)
     Объектное представление схлопывает дубли имён, и ключ мог браться из ЛЕВОГО
     блока, а количество из ПРАВОГО — то есть артикулу подставлялось чужое число.
     Поэтому берём строго правый блок: последнюю колонку «ШТ поставлено» и
     ближайшую к ней слева колонку-ключ. */
  function shtPairs(csvText,tag){
    const rows=parseCSV(csvText||'');
    if(!rows.length){ return []; }
    const H=rows[0].map(x=>String(x==null?'':x).trim());
    const qIdx=H.map((h,i)=>/^ШТ\s*поставлено/i.test(h)?i:-1).filter(i=>i>=0);
    let qi=qIdx.length?qIdx[qIdx.length-1]:-1;
    if(qi<0){ const alt=H.map((h,i)=>/^ШТ\b/i.test(h)?i:-1).filter(i=>i>=0); qi=alt.length?alt[alt.length-1]:-1; }
    if(qi<0){ diag.push({name:'Лист ШТУК'+(tag?' '+tag:''),status:'err',rows:rows.length-1,
        msg:`не найдена колонка «ШТ поставлено». Заголовки: ${H.filter(Boolean).join(' · ')}`}); return []; }
    let ki=-1;
    for(let i=qi;i>=0;i--){ if(/Предмет\s*;\s*Артикул/i.test(H[i])){ ki=i; break; } }
    if(ki<0){ for(let i=qi;i>=0;i--){ if(/Артикул/i.test(H[i])){ ki=i; break; } } }
    if(ki<0){ diag.push({name:'Лист ШТУК'+(tag?' '+tag:''),status:'err',rows:rows.length-1,
        msg:`не найдена колонка-ключ слева от «${H[qi]}»`}); return []; }
    const out=[],bad=[];
    let tot=0;
    for(let i=1;i<rows.length;i++){
      const k=rows[i][ki], q=rows[i][qi];
      if(k==null||String(k).trim()==='')continue;
      out.push({k,q}); tot+=intn(q);
      if(!isResolved(resolvePA(k)))bad.push(String(k).trim());
    }
    diag.push({name:'Лист ШТУК'+(tag?' '+tag:''),status:bad.length?'warn':'ok',rows:out.length,
      msg:`взят ПРАВЫЙ блок: ключ [${ki}] «${H[ki]}» + кол-во [${qi}] «${H[qi]}»`
        +` · всего колонок ${H.length} · Σ штук ${tot.toLocaleString('ru-RU')}`
        +(bad.length?` · ⚠ ключей вне справочника: ${bad.length} → ${bad.slice(0,6).map(x=>'«'+x+'»').join(', ')}`
                    :' · все ключи легли на справочник')});
    return out;
  }
  const shtEF=shtPairs(texts.sht,''), shtEZ=shtPairs(texts.sht2,'EZFR');

  function buildPUfb(pu,dim){
    const byPred={}, all=[];
    (dim||artDim).forEach(a=>{
      let v=pu[lnk(a.paP)]; if(v===undefined)v=pu[lnk(a.paG)];
      if(v!==undefined&&v>0){ (byPred[a.predmet]=byPred[a.predmet]||[]).push(v); all.push(v); } });
    const avg=arr=>arr.length?Math.round(arr.reduce((x,y)=>x+y,0)/arr.length):0;
    const predAvg={}; Object.keys(byPred).forEach(k=>predAvg[k]=avg(byPred[k]));
    return {predAvg,globalAvg:avg(all)};
  }
  function buildCo(q2,logGroup,xr,shtP,dim){
    const puL=buildPU(xr,shtP,lnk,dim), puA=buildPU(xr,shtP,nk,dim);
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
  {const byY={};
   salesEF.forEach(r=>{const y=r.date.getFullYear();const b=byY[y]||(byY[y]={z:0,v:0});b.z+=r.zaks;b.v+=r.vyks;byY[y]=b;});
   const ry=Object.keys(byY).sort();
   const rz=salesEF.reduce((s,r)=>s+r.zaks,0), rv=salesEF.reduce((s,r)=>s+r.vyks,0);
   diag.push({name:'report: охват',status:ry.length?'ok':'warn',rows:salesEF.length,
     msg:`заказов ${rz.toLocaleString('ru-RU')} шт · выкупов ${rv.toLocaleString('ru-RU')} шт`
       +` · выкупы по годам: ${ry.map(y=>y+':'+byY[y].v.toLocaleString('ru-RU')).join(' · ')}`});}
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
  const obEF=efFin?parseWBFin(raw.wbfin_ef,TAX_EF):buildCo(salesEF,parseLog(raw.log),xEF,shtEF,artDim);

  if(efFin){
    const puLE=buildPU(xEF,shtEF,lnk,artDim), puAE=buildPU(xEF,shtEF,nk,artDim);
    const fbEF=buildPUfb(puLE,artDim);
    /* ── Ставка себестоимости «Прочее» ──
       Часть старых артикулов (Водолазки, Велосипедки) в листе Расход давно слиты
       в «Прочее», а в ШТУК их добавлять не хотим. Поэтому ставку выводим сами:
         затраты «Прочее» (из buildPU._per) ÷ выкуплено штук под ключами «Прочее».
       Если пары нет — откат на общую среднюю. Всё считается из данных, без констант. */
    let puProchee=puLE[lnk('Прочее')];
    if(puProchee===undefined)puProchee=puAE[nk('Прочее')];
    if(puProchee===undefined){ const g=glubKey('Прочее'); if(g)puProchee=puLE._puG[g]; }
    if(puProchee===undefined){
      const perPr=(puLE._per[lnk('Прочее')]||0)+(nk('Прочее')!==lnk('Прочее')?(puAE._per[nk('Прочее')]||0):0);
      let qPr=0; obEF.forEach(r=>{ if(r.vyks&&nk(r.paG).indexOf('прочее')>=0)qPr+=r.vyks; });
      if(perPr>0&&qPr>0)puProchee=Math.round(perPr/qPr);
    }
    if(puProchee===undefined||!(puProchee>0))puProchee=fbEF.globalAvg;   /* последний откат */
    let prQty=0,prSum=0; const prKeys={};
    let noPU=0,fbQty=0,fbSum=0,fbY={},glubQty=0,glubHit=0;
    for(const r of obEF){
      let pu=puLE[lnk(r.paG)]; if(pu===undefined)pu=puAE[nk(r.paG)];
      if(pu===undefined){ const g=glubKey(r.paG);
        if(g&&puLE._puG[g]!==undefined){ pu=puLE._puG[g]; if(r.vyks){glubQty+=r.vyks;glubHit++;} } }
      /* «Прочее»: часть старых артикулов (Водолазки, Велосипедки и пр.) в листе Расход
         давно переименована в «Прочее», своей строки затрат у них нет. Берём
         себестоимость этого сборного ключа — она ближе к правде, чем общая средняя. */
      if(pu===undefined&&puProchee!==undefined){ pu=puProchee;
        if(r.vyks){prQty+=r.vyks;prSum+=puProchee*r.vyks;prKeys[r.paG]=(prKeys[r.paG]||0)+r.vyks;} }
      if(pu===undefined&&r.vyks){
        noPU++;
        const a=M.artByPaG[r.paG];
        const est=(a&&fbEF.predAvg[a.predmet])||fbEF.globalAvg;
        if(est){ pu=est; r.peremEst=1; fbQty+=r.vyks; fbSum+=est*r.vyks;
                 fbY[r.y]=(fbY[r.y]||0)+est*r.vyks; }
      }
      r.perem=Math.round((pu||0)*r.vyks);
      if(r.rekWB) r.rek-=r.rekWB;   /* удержания WB гасим — реклама идёт из бухгалтерии; штрафы остаются */
    }
    {const miss={};
     obEF.forEach(r=>{ if(r.peremEst&&r.vyks) miss[r.paG]=(miss[r.paG]||0)+r.vyks; });
     const cls={'нет в Расход':[],'нет в ШТУК':[],'нет нигде':[]};
     Object.keys(miss).forEach(k=>{
       const kl=lnk(k), kn=nk(k);
       const hasPer=(puLE._per[kl]!==undefined)||(puAE._per[kn]!==undefined);
       const hasSht=(puLE._sht[kl]!==undefined)||(puAE._sht[kn]!==undefined);
       const c=hasPer&&!hasSht?'нет в ШТУК':(!hasPer&&hasSht?'нет в Расход':(!hasPer&&!hasSht?'нет нигде':null));
       if(c)cls[c].push([k,miss[k]]); });
     const fmt=arr=>arr.sort((a,b)=>b[1]-a[1]).slice(0,8)
       .map(([k,v])=>`«${k}» ${v.toLocaleString('ru-RU')} шт`).join(' · ');
     const tot=c=>cls[c].reduce((s2,x)=>s2+x[1],0);
     diag.push({name:'Себестоимость: где дыра',status:Object.keys(miss).length?'warn':'ok',rows:Object.keys(miss).length,
       msg:Object.keys(miss).length
         ? ['нет в ШТУК','нет в Расход','нет нигде'].map(c=>
             `${c}: ${cls[c].length} ключей / ${tot(c).toLocaleString('ru-RU')} шт`
             +(cls[c].length?` → ${fmt(cls[c])}`:'')).join(' ║ ')
         : 'себестоимость нашлась у всех ключей с выкупами'});}
    diag.push({name:'Себестоимость: из «Прочее»',status:prQty?'warn':'ok',rows:Object.keys(prKeys).length,
      msg:puProchee===undefined
        ? '⚠ ставка не определилась'
        : (prQty?`ставка «Прочее» ${Math.round(puProchee).toLocaleString('ru-RU')} ₽/шт применена к `
            +`${prQty.toLocaleString('ru-RU')} шт на ${Math.round(prSum).toLocaleString('ru-RU')} ₽ · `
            +Object.entries(prKeys).sort((a,b)=>b[1]-a[1]).slice(0,6)
              .map(([k,v])=>`«${k}» ${v.toLocaleString('ru-RU')} шт`).join(' · ')
          :`ставка «Прочее» ${Math.round(puProchee).toLocaleString('ru-RU')} ₽/шт · применять не пришлось`)});
    diag.push({name:'Себестоимость: по глубине',status:'ok',rows:glubHit,
      msg:glubQty?`ключ «Предмет+Глубина» не совпал, но нашлась глубина: ${glubQty.toLocaleString('ru-RU')} шт`
                 :'все ключи совпали по «Предмет+Глубина», добор по глубине не понадобился'});
    diag.push({name:'Себестоимость: фолбэк',status:fbQty?'warn':'ok',rows:noPU,
      msg:fbQty?`подставлена средняя по предмету/общая для ${fbQty.toLocaleString('ru-RU')} шт`
            +` на ${Math.round(fbSum).toLocaleString('ru-RU')} ₽`
            +` · по годам: ${Object.keys(fbY).sort().map(y=>y+':'+Math.round(fbY[y]).toLocaleString('ru-RU')).join(' · ')}`
            +` · общая средняя ${fbEF.globalAvg.toLocaleString('ru-RU')} ₽/шт (ОЦЕНКА — уточняется листом ШТУК)`
          :'своя себестоимость нашлась у всех артикулов с выкупами'});
    let rekMP=0,rekBlog=0,postBuh=0;
    groupBy(xEF.filter(r=>r.rek||r.post),r=>r.date.getFullYear()+'-'+(r.date.getMonth()+1)+'|'+r.pa,
      rs=>({y:rs[0].date.getFullYear(),m:rs[0].date.getMonth()+1,paG:rs[0].pa,
            rek:sum(rs,'rek'),rekMP:sum(rs,'rekMP'),rekBlog:sum(rs,'rekBlog'),post:sum(rs,'post')}))
      .forEach(g=>{ rekMP+=g.rekMP; rekBlog+=g.rekBlog; postBuh+=g.post;
        obEF.push({paG:g.paG,y:g.y,m:g.m,zaks:0,vyks:0,zakr:0,vykr:0,kom:0,
          rek:g.rek,rekMP:g.rekMP,rekBlog:g.rekBlog,rekWB:0,post:g.post,nalog:0,hran:0,dost:0,perem:0}); });
    /* Покрытие: месяцы, где report видит выкупы, а финотчёт — нет (дыра в бэкапе) */
    {const finM={},repM={};
     obEF.forEach(r=>{ if(r.vyks)finM[r.y+'-'+String(r.m).padStart(2,'0')]=1; });
     salesEF.forEach(r=>{ if(r.vyks){const k=r.date.getFullYear()+'-'+String(r.date.getMonth()+1).padStart(2,'0');
       repM[k]=(repM[k]||0)+r.vyks;} });
     const holes=Object.keys(repM).filter(k=>!finM[k]).sort();
     diag.push({name:'Финотчёт: дыры в покрытии',status:holes.length?'warn':'ok',rows:holes.length,
       msg:holes.length?`месяцев без финотчёта, но с выкупами в report: ${holes.length} → `
             +holes.map(k=>`${k} (${repM[k].toLocaleString('ru-RU')} шт)`).join(' · ')
             +` · за эти месяцы будут заказы, но нулевая выручка — нужны недельные файлы в бэкап`
           :'финотчёт покрывает все месяцы, где report видит выкупы'});}
    /* ── Выкупы за месяцы, где финотчёта нет вовсе ──
       Бэкап финотчёта начинается не с начала истории (июль–август 2021 отсутствуют).
       За такие месяцы берём выкупы и выручку из report. ВАЖНО: выручка report — это
       «К перечислению» (НЕТТО, после комиссии), а не gross. Помечаем vykrEst=1,
       чтобы такие месяцы было видно и они не выдавались за полноценные. */
    {const finM={};
     obEF.forEach(r=>{ if(r.vyks)finM[r.y+'|'+r.m]=1; });
     const add={};
     salesEF.forEach(r=>{ if(!r.date||!r.vyks)return;
       const k=r.date.getFullYear()+'|'+(r.date.getMonth()+1);
       if(finM[k])return;
       const kk=k+'|'+r.paG;
       const o=add[kk]||(add[kk]={y:r.date.getFullYear(),m:r.date.getMonth()+1,paG:r.paG,v:0,r:0});
       o.v+=r.vyks; o.r+=r.vykr; });
     let n=0,q=0,sum=0;
     Object.values(add).forEach(o=>{ n++; q+=o.v; sum+=o.r;
       /* себестоимость — по тем же справочникам, что и в основном контуре */
       let pu=puLE[lnk(o.paG)]; if(pu===undefined)pu=puAE[nk(o.paG)];
       if(pu===undefined){ const g=glubKey(o.paG); if(g&&puLE._puG[g]!==undefined)pu=puLE._puG[g]; }
       if(pu===undefined){ const a=M.artByPaG[o.paG];
         pu=(a&&fbEF.predAvg[a.predmet])||fbEF.globalAvg; }
       /* выручка из report — это «К перечислению» (нетто), то есть готовая база налога */
       const nal=Math.round(o.r*TAX_EF(o.y,o.m));
       obEF.push({paG:o.paG,y:o.y,m:o.m,zaks:0,vyks:o.v,zakr:0,vykr:Math.round(o.r),vykrEst:1,
         kom:0,rek:0,post:0,nalog:nal,hran:0,dost:0,perem:Math.round((pu||0)*o.v)}); });
     diag.push({name:'Выкупы: добор из report',status:q?'warn':'ok',rows:n,
       msg:q?`за месяцы без финотчёта добрано ${q.toLocaleString('ru-RU')} шт на ${Math.round(sum).toLocaleString('ru-RU')} ₽`
             +` · ⚠ выручка НЕТТО (после комиссии), а не gross — эти месяцы неполноценны`
           :'финотчёт покрывает все месяцы с выкупами'});}
    /* ── Поартикульная сверка выкупов: финотчёт vs report ──
       Ловит природу устойчивой недостачи ~5%: размазана она по всем артикулам
       (значит источники считают выкуп по-разному) или сидит в нескольких
       (значит ключ/маппинг). Берём последний ПОЛНЫЙ год. */
    {const ys=[...new Set(obEF.filter(r=>r.vyks).map(r=>r.y))].sort();
     const yChk=ys.length>1?ys[ys.length-2]:ys[ys.length-1];
     if(yChk){
       const F={},R={};
       obEF.forEach(r=>{ if(r.y===yChk&&r.vyks)F[r.paG]=(F[r.paG]||0)+r.vyks; });
       salesEF.forEach(r=>{ if(r.date&&r.date.getFullYear()===yChk&&r.vyks)R[r.paG]=(R[r.paG]||0)+r.vyks; });
       const keys=[...new Set(Object.keys(F).concat(Object.keys(R)))];
       let less=0,more=0,same=0,sumF=0,sumR=0;
       const d=[];
       keys.forEach(k=>{ const f=F[k]||0,rr=R[k]||0; sumF+=f; sumR+=rr;
         if(f<rr)less++; else if(f>rr)more++; else same++;
         if(rr)d.push([k,f-rr,rr?(f/rr):0,rr]); });
       d.sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
       const med=(()=>{const v=d.filter(x=>x[3]>50).map(x=>x[2]).sort((a,b)=>a-b);
         return v.length?v[Math.floor(v.length/2)]:0;})();
       diag.push({name:`Сверка выкупов ${yChk}: финотчёт vs report`,status:'ok',rows:keys.length,
         msg:`финотчёт ${sumF.toLocaleString('ru-RU')} vs report ${sumR.toLocaleString('ru-RU')} шт`
           +` · артикулов: меньше ${less} · больше ${more} · ровно ${same}`
           +` · медианное отношение (по артикулам >50 шт): ${(med*100).toFixed(1)}%`
           +` · крупнейшие расхождения: `
           +d.slice(0,8).map(([k,dd,rt])=>`«${k}» ${dd>0?'+':''}${dd.toLocaleString('ru-RU')} (${(rt*100).toFixed(0)}%)`).join(' · ')
           +` ║ если медиана ≈95% и «меньше» почти у всех — источники считают выкуп по-разному;`
           +` если расхождение сидит в единицах артикулов — проблема в ключе`});
     }}
    /* Заказы: финотчёт → report → доставки (см. fixOrders) */
    fixOrders(obEF,salesEF,'EF');
    /* ── Хранение: добор из листа «Лог+Хран» ──
       До ~2024 ВБ не включал хранение в финотчёт (обоснования «Хранение» там нет),
       поэтому за те годы колонка ХРАНЕН выходила нулевой, а прибыль — завышенной.
       Берём хранение из листа log ТОЛЬКО за месяцы, где финотчёт его не дал,
       чтобы не задвоить 2025–2026. Доставку не трогаем: её финотчёт даёт всегда. */
    {
      const logG=parseLog(raw.log);
      const finH={},finD={};
      obEF.forEach(r=>{ if(r.hran) finH[r.y+'|'+r.m]=1; if(r.dost) finD[r.y+'|'+r.m]=1; });
      let addH=0,addM={},addD=0;
      logG.forEach(r=>{
        const y=r.date.getFullYear(),m=r.date.getMonth()+1,k=y+'|'+m;
        const h=finH[k]?0:r.hran;          /* хранение — если финотчёт его не дал */
        const d=finD[k]?0:r.dost;          /* доставка — если финотчёта за месяц нет вовсе */
        if(!h&&!d)return;
        addH+=h; addD+=d; if(h)addM[y]=(addM[y]||0)+h;
        obEF.push({paG:r.paG,y,m,zaks:0,vyks:0,zakr:0,vykr:0,kom:0,
          rek:0,post:0,nalog:0,hran:h,dost:d,perem:0});
      });
      diag.push({name:'Хранение: добор из «Лог+Хран»',status:addH?'warn':'ok',rows:logG.length,
        msg:(addD?`доставка добрана ${Math.round(addD).toLocaleString('ru-RU')} ₽ за месяцы без финотчёта · `:'')
          +(addH?`хранение ${Math.round(addH).toLocaleString('ru-RU')} ₽ за месяцы без хранения в финотчёте`
                 :'добирать нечего — финотчёт закрывает все месяцы')
          +(Object.keys(addM).length?` · по годам: ${Object.keys(addM).sort().map(y=>y+':'+Math.round(addM[y]).toLocaleString('ru-RU')).join(' · ')}`:'')});
    }
    /* Себестоимость: где её не нашли — разрез по годам (переменные там занижены) */
    {
      const noY={};
      obEF.forEach(r=>{ if(r.vyks>0&&!r.perem){ const b=noY[r.y]||(noY[r.y]={n:0,v:0}); b.n++; b.v+=r.vyks; noY[r.y]=b; } });
      const ks=Object.keys(noY).sort();
      diag.push({name:'Без себестоимости: по годам',status:ks.length?'warn':'ok',rows:0,
        msg:ks.length?ks.map(y=>`${y}: ${noY[y].n} строк / ${noY[y].v.toLocaleString('ru-RU')} шт`).join(' │ ')
                     :'себестоимость найдена везде'});
    }
    const zaksFin=obEF.reduce((s,r)=>s+(r.zaks||0),0);
    const zaksRep=obEF.reduce((s,r)=>s+(r.zaksRep||0),0);
    const rekWBef=obEF.reduce((s,r)=>s+(r.rekWB||0),0);
    diag.push({name:'EF: финотчёт WB',status:noPU?'warn':'ok',rows:obEF.length,
      msg:`Заказы: финотчёт ${zaksFin.toLocaleString('ru-RU')} шт (report для сверки: ${zaksRep.toLocaleString('ru-RU')} шт)`
        +` · Реклама: площадка ${Math.round(rekMP).toLocaleString('ru-RU')} ₽ + блогеры ${Math.round(rekBlog).toLocaleString('ru-RU')} ₽`
        +` · Пост.Р: ${Math.round(postBuh).toLocaleString('ru-RU')} ₽`
        +(noPU?` · без себестоимости: ${noPU} строк`:'')});
  }
  /* Акруалс в ob: paG теперь канонический, поэтому строка ложится на предмет.
     Поле acr несём с собой — чтобы разрез по предметам мог его показать. */
  acGroup.forEach(r=>obEF.push({paG:r.paG,y:r.date.getFullYear(),m:r.date.getMonth()+1,acr:r.acr,zaks:0,vyks:0,zakr:0,vykr:0,rek:0,post:0,nalog:0,hran:0,dost:0,perem:0}));

  const ezFin=!!(raw.wbfin_ezfr&&raw.wbfin_ezfr.length);
  const obEZ=ezFin?parseWBFin(raw.wbfin_ezfr,TAX_EZ):buildCo(salesEZ,parseLog(raw.log2),xEZ,shtEZ,artDim2.length?artDim2:artDim);

  /* ── EZFR на финотчёте + своя бухгалтерия: переменные и реклама из rashod2/sht2 ──
     Реклама берётся из БУХГАЛТЕРИИ. «Удержания» WB из финотчёта остаются в поле rekWB —
     показываем их справочно рядом (в скобках), НЕ складываем: это те же деньги. */
  if(ezFin&&ezOwn){
    const dim2=artDim2.length?artDim2:artDim;
    const puL2=buildPU(xRows2,shtEZ,lnk,dim2), puA2=buildPU(xRows2,shtEZ,nk,dim2);
    let noPU=0;
    for(const r of obEZ){
      let pu=puL2[lnk(r.paG)]; if(pu===undefined)pu=puA2[nk(r.paG)];
      if(pu===undefined){ const g=glubKey(r.paG); if(g&&puL2._puG[g]!==undefined)pu=puL2._puG[g]; }
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

  /* Заказы EZFR — тот же приоритет: финотчёт → report2 → доставки */
  if(ezFin&&salesEZ.length) fixOrders(obEZ,salesEZ,'EZFR');

  /* ── Заказы: три источника по приоритету ──
     1) финотчёт, строки логистики «К клиенту при продаже/отмене» (2025+)
     2) report / report2 — за месяцы, где ВБ не детализировал прямую логистику
        (2021–2024: в финотчёте только обратная логистика «Возврат (К продавцу)»)
     3) zaksAlt — все доставки строки, если колонки видов логистики нет вовсе
     Заказ,руб считаем через средний чек по gross того же артикул-месяца,
     а НЕ через «Сумма заказов минус комиссия» из report: та величина нетто
     и, подмешанная к gross-выручке, ломает ДРР%. */
  function fixOrders(ob,salesRep,tag){
    const chek={},finYM={},altYM={};
    ob.forEach(r=>{ const k=r.y+'|'+r.m;
      if(r.vyks>0&&r.vykr) chek[k+'|'+r.paG]=r.vykr/r.vyks;
      if(r.zaks) finYM[k]=(finYM[k]||0)+r.zaks;
      if(r.zaksAlt) altYM[k]=(altYM[k]||0)+r.zaksAlt; });
    const repYM={};
    (salesRep||[]).forEach(r=>{ if(!r.date)return;
      const k=r.date.getFullYear()+'|'+(r.date.getMonth()+1)+'|'+r.paG;
      const o=repYM[k]||(repYM[k]={y:r.date.getFullYear(),m:r.date.getMonth()+1,paG:r.paG,zaksRep:0,zakrRep:0});
      o.zaksRep+=r.zaks; o.zakrRep+=r.zakr; });
    const repHas={},repYMsum={};
    Object.values(repYM).forEach(o=>{ const k=o.y+'|'+o.m;
      if(o.zaksRep){repHas[k]=1; repYMsum[k]=(repYMsum[k]||0)+o.zaksRep;} });
    /* ВАЖНО: наличие в финотчёте одной случайной строки «К клиенту» не значит,
       что месяц закрыт. В окт-2022 таких строк было 1, в дек-2023 — 2, и они
       блокировали фолбэк на report, обнуляя весь месяц. Поэтому сравниваем масштаб:
       если финотчёт дал меньше половины от report — доверяем report. */
    const MIN_SHARE=0.5;
    const src={};   /* месяц → откуда взяли заказы */
    Object.keys(finYM).forEach(k=>{src[k]='фин';});
    const useRepYM={};
    Object.keys(repYMsum).forEach(k=>{
      if(!finYM[k]||finYM[k]<repYMsum[k]*MIN_SHARE){ useRepYM[k]=1; src[k]='report'; }
    });
    /* если месяц отдан report — гасим крохи, пришедшие из финотчёта, чтобы не смешивать */
    let wiped=0;
    ob.forEach(r=>{ const k=r.y+'|'+r.m;
      if(useRepYM[k]&&r.zaks){ wiped+=r.zaks; r.zaks=0; r.zakr=0; } });
    for(const o of Object.values(repYM)){
      const k=o.y+'|'+o.m, useRep=!!useRepYM[k];
      ob.push({paG:o.paG,y:o.y,m:o.m,
        zaks:useRep?o.zaksRep:0,
        zakr:useRep?Math.round(o.zaksRep*(chek[k+'|'+o.paG]||0)):0,
        zaksRep:o.zaksRep,zakrRep:o.zakrRep,
        vyks:0,vykr:0,kom:0,rek:0,post:0,nalog:0,hran:0,dost:0,perem:0});
    }
    /* 3) там, где нет ни финотчёта, ни report — поднимаем zaksAlt */
    let promoted=0;
    ob.forEach(r=>{ const k=r.y+'|'+r.m;
      if(r.zaksAlt&&!finYM[k]&&!repHas[k]){
        r.zaks=r.zaksAlt; r.zakr=Math.round(r.zaksAlt*(chek[k+'|'+r.paG]||0));
        promoted+=r.zaksAlt; src[k]='доставки';
      } });
    const cnt={фин:0,report:0,доставки:0};
    Object.values(src).forEach(v=>{cnt[v]=(cnt[v]||0)+1;});
    diag.push({name:tag+': источник заказов',status:'ok',rows:0,
      msg:`месяцев из финотчёта: ${cnt['фин']||0} · из report: ${cnt['report']||0}`
        +` · по доставкам: ${cnt['доставки']||0}`
        +(promoted?` (${promoted.toLocaleString('ru-RU')} шт)`:'')
        +(wiped?` · погашено крох из финотчёта: ${wiped.toLocaleString('ru-RU')} шт`:'')});
  }

  /* ── parseWBFin: еженедельный финотчёт WB → схема P&L (вариант Б: gross + комиссия) ── */
  /* Логистика WB = Доставка + ПВЗ + Возмещение издержек + Приёмка                   */
  /* Хранение отдельно                                                               */
  /* taxFn(y,m) → ставка налога. EZFR: всегда 7%. EF: 7% до 01.02.2026, далее 12%.   */
  /* ДВА ФОРМАТА: новый (русские заголовки) и старый бэкап 2021-2024 (английские).
     Значения полей в обоих форматах русские (Продажа/Возврат/Логистика),
     поэтому достаточно алиасов заголовков. Чего в старом формате НЕТ вовсе:
     Хранение, Удержания, Операции на приемке, Виды логистики. */
  function parseWBFin(rr,taxFn){
    if(!rr||!rr.length)return[];
    const H=rr._headers;
    const c_art=col(H,'Артикул поставщика',"Supplier's Article");
    const c_pred=col(H,'Предмет','Subject');
    const c_reason=col(H,'Обоснование для оплаты','Reason for Payment');
    const c_doctype=col(H,'Тип документа','Document Type');
    const c_date=col(H,'Дата продажи','Sale Date');
    const c_odate=col(H,'Дата заказа покупателем','Order Date by the Buyer','Дата заказа');
    const c_qty=col(H,'Кол-во','Quantity');
    const c_retail=col(H,'Вайлдберриз реализовал Товар (Пр)','Вайлдберриз реализовал Товар','Вайлдберриз реализовал товар (Пр)','Wildberries Realized Goods (Pr)');
    const c_pay=col(H,'К перечислению Продавцу за реализованный Товар','К перечислению Продавцу','Amount to Transfer to the Seller for the Realized Goods');
    const c_dost=col(H,'Услуги по доставке товара покупателю','Services for delivering goods to the buyer');
    /* ЗАКАЗЫ из финотчёта: на строках «Логистика» с видом «К клиенту при продаже/отмене».
       Привязка к месяцу по «Дате продажи» (как выкупы), чтобы месяцы сходились.
       В СТАРОМ формате колонка «Виды логистики» пустая на всех строках → фолбэк ниже. */
    const c_dostQty=col(H,'Количество доставок','Number of Deliveries');
    const c_logType=col(H,'Виды логистики, штрафов и корректировок ВВ','Виды логистики','Types of Logistics, Fines, and Additional Payments');
    const c_pvz=col(H,'Возмещение за выдачу и возврат товаров на ПВЗ','Compensation for the issuance and return of goods at PVZ');
    const c_vozmesh=col(H,'Возмещение издержек по перевозке/по складским операциям с товаром','Compensation for Transportation Costs');
    const c_priemka=col(H,'Операции на приемке','Операции на приёмке');   /* нет в старом формате */
    const c_hran=col(H,'Хранение');                                       /* нет в старом формате */
    const c_uderz=col(H,'Удержания');                                     /* нет в старом формате */
    const c_shtraf=col(H,'Общая сумма штрафов','Total Penalty Amount');
    /* ── детализация комиссии (для вкладок «Разбор» и «Комиссия ВБ») ── */
    const c_rozn=col(H,'Цена розничная','Retail Price');                     /* за ЕДИНИЦУ → умножаем на Кол-во */
    const c_vv=col(H,'Вознаграждение Вайлдберриз (ВВ), без НДС','Wildberries Reward (VV), excluding VAT');
    const c_vvnds=col(H,'НДС с Вознаграждения Вайлдберриз','VAT from Wildberries Reward');
    const c_ekv=col(H,'Компенсация платёжных услуг/Комиссия за интеграцию платёжных сервисов',
                     'Компенсация платежных услуг/Комиссия за интеграцию платежных сервисов',
                     'Компенсация платёжных услуг','Compensation for Acquiring Expenses');
    const c_ekvtype=col(H,'Тип платежа: компенсация платёжных услуг/Комиссия за интеграцию платёжных сервисов',
                          'Тип платежа: компенсация платежных услуг/Комиссия за интеграцию платежных сервисов',
                          'Тип платежа за Эквайринг/Комиссии за организацию платежей');
    /* Эквайринг удержан из «К перечислению» НЕ всегда:
         «Перевыставление эквайринга», «Компенсация платёжных услуг» → удержан, входит в kom
         «Комиссия за организацию платежа с НДС»                     → НЕ удержан, WB выставляет счёт
       Если считать его в kom всегда — тождество kom == ВВ+НДС+эквайринг+ПВЗ рвётся. */
    const EKV_BILLED=/комисси\S* за организацию платеж/i;
    /* ВАЖНО: ПВЗ на строках Продажа/Возврат уже входит в (vykr − К перечислению),
       поэтому здесь он идёт ТОЛЬКО как компонент комиссии. Отдельные строки
       «Возмещение за выдачу…» — другие строки, они идут в dost (логистику). */

    /* Признак старого формата — по отсутствию колонки видов логистики */
    const oldFmt=!c_logType;
    let zaksFallback=0;
    /* Счётчики отброшенных строк — ловят систематическую недостачу выкупов */
    const skip={noDate:0,noArt:0,noArtQty:0,saleQty:0,retQty:0,otherReason:{}};

    const map={};
    const totals={}; /* хранение и удержания без артикула — по месяцам */
    const ym=d=>d.getFullYear()+'-'+(d.getMonth()+1);

    const getOrCreate=(key,paG,d)=>map[key]||(map[key]={paG,y:d.getFullYear(),m:d.getMonth()+1,
      vyks:0,vykrGross:0,kPerech:0,dost:0,komp:0,zaks:0,zaksAlt:0,
      rozn:0,vv:0,vvNds:0,ekvair:0,ekvBill:0,pvz:0});
    const getTotals=k=>totals[k]||(totals[k]={y:0,m:0,hran:0,rek:0,shtraf:0,priemka:0});
    /* Умная сцепка и здесь: если артикул сам по себе не узнан — пробуем «Предмет+Артикул» */
    const resolveArt=(art,pred)=>{
      const rec=artByPostL.get(lnk(art))||artByPostA.get(nk(art));
      if(rec)return rec.paG;
      if(pred){ const p=resolvePA(String(pred).trim()+String(art).trim(),''); if(p)return p; }
      return '#'+art;
    };

    rr.forEach(r=>{
      const d=pdate(r[c_date]);
      if(!d){ const rs0=(r[c_reason]||'').trim();
        if(rs0==='Продажа'||rs0==='Возврат'){skip.noDate+=intn(r[c_qty]);} return; }
      const reason=(r[c_reason]||'').trim();
      const art=(r[c_art]||'').trim();
      const pred=c_pred?(r[c_pred]||'').trim():'';
      const k_ym=ym(d);

      /* ── Продажи / Возвраты / Компенсации ── */
      /* Компенсации: WB ПЛАТИТ продавцу (брак, утеря, подмена). Это не выручка от продажи:
         «ВБ реализовал» = 0, комиссии нет, а «К перечислению» положительное.
         Держать их в продажной ветке нельзя — рвётся тождество
         kom == ВВ+НДС+эквайринг+ПВЗ (kom уходил в минус без компонент). */
      if(reason==='Добровольная компенсация при возврате'||reason==='Компенсация ущерба'){
        const sg=(r[c_doctype]||'').trim()==='Продажа'?1:-1;
        const paG=art?resolveArt(art,pred):'(Компенсации WB)';
        const o=getOrCreate(k_ym+'|'+paG,paG,d);
        o.komp+=sg*num(r[c_pay]);
      }
      else if(reason==='Продажа'||reason==='Возврат'){
        const isSale0=(r[c_doctype]||'').trim()==='Продажа';
        if(isSale0)skip.saleQty+=intn(r[c_qty]); else skip.retQty+=intn(r[c_qty]);
        if(!art){skip.noArt++;skip.noArtQty+=intn(r[c_qty]);return;}
        const paG=resolveArt(art,pred);
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
        const paG=resolveArt(art,pred);
        const o=getOrCreate(k_ym+'|'+paG,paG,d);
        o.dost+=num(r[c_dost]);
        /* заказы = доставки «К клиенту при продаже» + «К клиенту при отмене» (по дате продажи) */
        const lt=String(c_logType?(r[c_logType]||''):'');
        if(lt){
          if(/К клиенту при (продаже|отмене)/i.test(lt)) o.zaks+=intn(r[c_dostQty]);
        } else {
          /* СТАРЫЙ ФОРМАТ (или пустая колонка): вида логистики нет — различить
             «к клиенту» и «от клиента» нечем, берём все доставки строки. */
          const q=intn(r[c_dostQty]); o.zaksAlt+=q; zaksFallback+=q;
        }
      }
      /* ── Возмещение за выдачу на ПВЗ (по артикулам если есть) ── */
      else if(reason==='Возмещение за выдачу и возврат товаров на ПВЗ'){
        const v=num(r[c_pvz]);
        if(art){const paG=resolveArt(art,pred);const o=getOrCreate(k_ym+'|'+paG,paG,d);o.dost+=v;}
        else{const t=getTotals(k_ym);t.y=d.getFullYear();t.m=d.getMonth()+1;t.priemka+=v;}
      }
      /* ── Возмещение издержек по перевозке (по артикулам если есть) ── */
      else if(reason==='Возмещение издержек по перевозке/по складским операциям с товаром'){
        const v=num(r[c_vozmesh]);
        if(art){const paG=resolveArt(art,pred);const o=getOrCreate(k_ym+'|'+paG,paG,d);o.dost+=v;}
        else{const t=getTotals(k_ym);t.y=d.getFullYear();t.m=d.getMonth()+1;t.priemka+=v;}
      }
      /* ── Обработка товара / приёмка ── */
      else if(reason==='Обработка товара'){
        const v=num(r[c_priemka]);
        if(art){const paG=resolveArt(art,pred);const o=getOrCreate(k_ym+'|'+paG,paG,d);o.dost+=v;}
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

    /* Диагностика формата: видно, старый бэкап приехал или новый */
    diag.push({name:'Финотчёт: формат',status:oldFmt?'warn':'ok',rows:rr.length,
      msg:(oldFmt?'СТАРЫЙ формат (англ. заголовки)':'новый формат')
        +` · заголовок «Виды логистики»: ${c_logType?'есть':'НЕТ'}`
        +` · Хранение: ${c_hran?'есть':'НЕТ'} · Удержания: ${c_uderz?'есть':'НЕТ'} · Приёмка: ${c_priemka?'есть':'НЕТ'}`
        +(zaksFallback?` · заказы по фолбэку (все доставки): ${zaksFallback.toLocaleString('ru-RU')} шт`:'')
        +(oldFmt?' · ⚠ хранение/удержания/приёмка в старом формате отсутствуют → расходы занижены':'')});

    /* ── Диагностика по годам: где именно рвётся комиссия ──
       ком% — (gross−net)/gross · «gross без net» — строки с выручкой, но без
       «К перечислению» (признак несостыковки колонок) · «net>gross» — невозможная
       ситуация при корректном чтении. */
    const byY={};
    rr.forEach(r=>{ const d=pdate(r[c_date]); if(!d)return;
      const rs=(r[c_reason]||'').trim();
      if(rs!=='Продажа'&&rs!=='Возврат')return;
      const y=d.getFullYear(); const b=byY[y]||(byY[y]={n:0,g:0,p:0,z:0,neg:0});
      const g=num(r[c_retail]), p=num(r[c_pay]);
      b.n++; b.g+=g; b.p+=p; if(g&&!p)b.z++; if(p>g)b.neg++;
      byY[y]=b; });
    diag.push({name:'Финотчёт: комиссия по годам',status:'ok',rows:0,
      msg:Object.keys(byY).sort().map(y=>{const b=byY[y];
        return `${y}: ком ${b.g?(((b.g-b.p)/b.g)*100).toFixed(1):'—'}% · строк ${b.n}`
          +` · gross без net: ${b.z} · net>gross: ${b.neg}`;}).join(' │ ')});
    {const vy={};
     rr.forEach(r=>{ const d=pdate(r[c_date]); if(!d)return;
       const rs=(r[c_reason]||'').trim(); if(rs!=='Продажа'&&rs!=='Возврат')return;
       const sg=(r[c_doctype]||'').trim()==='Продажа'?1:-1;
       vy[d.getFullYear()]=(vy[d.getFullYear()]||0)+sg*intn(r[c_qty]); });
     diag.push({name:'Финотчёт: выкупы по годам',status:'ok',rows:0,
       msg:Object.keys(vy).sort().map(y=>`${y}: ${vy[y].toLocaleString('ru-RU')} шт`).join(' │ ')});}
    /* ── ЗАМЕР: как легли бы выкупы при привязке к ДАТЕ ЗАКАЗА ──
       Ничего не меняет, только считает. Нужен, чтобы решить, стоит ли
       перевешивать модель с «Даты продажи» на «Дату заказа покупателем». */
    if(c_odate){
      const byS={},byO={}; let noOd=0,tot=0,shift=0;
      rr.forEach(r=>{ const rs=(r[c_reason]||'').trim();
        if(rs!=='Продажа'&&rs!=='Возврат')return;
        const ds=pdate(r[c_date]); if(!ds)return;
        const sg=(r[c_doctype]||'').trim()==='Продажа'?1:-1, q=sg*intn(r[c_qty]);
        tot+=q; byS[ds.getFullYear()]=(byS[ds.getFullYear()]||0)+q;
        const dо=pdate(r[c_odate]);
        if(!dо){noOd+=Math.abs(q);return;}
        byO[dо.getFullYear()]=(byO[dо.getFullYear()]||0)+q;
        if(dо.getFullYear()!==ds.getFullYear()||dо.getMonth()!==ds.getMonth())shift+=Math.abs(q);
      });
      const ys=[...new Set(Object.keys(byS).concat(Object.keys(byO)))].sort();
      diag.push({name:'Замер: привязка к ДАТЕ ЗАКАЗА',status:'ok',rows:0,
        msg:`колонка: ${JSON.stringify(c_odate)} · без даты заказа: ${noOd.toLocaleString('ru-RU')} шт`
          +` · сменили бы месяц: ${shift.toLocaleString('ru-RU')} шт (${tot?(shift/tot*100).toFixed(1):'—'}%)`
          +' ║ выкупы по годам, продажа → заказ: '
          +ys.map(y=>`${y}: ${(byS[y]||0).toLocaleString('ru-RU')} → ${(byO[y]||0).toLocaleString('ru-RU')}`).join(' · ')
          +' ║ сравни правую колонку с «report: охват» — если сойдётся, привязка к заказу даст ту же нарезку, что PBI'});
    }
    diag.push({name:'Финотчёт: потери выкупов',status:(skip.noDate||skip.noArt)?'warn':'ok',rows:0,
      msg:`Продажа ${skip.saleQty.toLocaleString('ru-RU')} шт − Возврат ${skip.retQty.toLocaleString('ru-RU')} шт`
        +` = нетто ${(skip.saleQty-skip.retQty).toLocaleString('ru-RU')} шт`
        +` · отброшено: без даты продажи ${skip.noDate.toLocaleString('ru-RU')} шт`
        +` · без артикула ${skip.noArtQty.toLocaleString('ru-RU')} шт (${skip.noArt} строк)`});
    /* Диагностика видов логистики: какие формулировки реально встречаются */
    if(c_logType){
      const lt={};
      rr.forEach(r=>{ if((r[c_reason]||'').trim()!=='Логистика')return;
        const d=pdate(r[c_date]); if(!d)return;
        const k=d.getFullYear()+' '+(String(r[c_logType]||'').trim()||'(пусто)');
        lt[k]=(lt[k]||0)+intn(r[c_dostQty]); });
      diag.push({name:'Финотчёт: виды логистики',status:'ok',rows:0,
        msg:Object.entries(lt).sort().map(([k,v])=>`${k}: ${v.toLocaleString('ru-RU')}`).join(' │ ')});
    }

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
      /* Заказ,руб из финотчёта: штук заказов × средняя цена выкупа (vykrGross/vyks).
         Цены на строках логистики нет, поэтому оцениваем по среднему чеку того же артикул-месяца. */
      const avgCena=o.vyks?o.vykrGross/o.vyks:0;
      const zakr=Math.round(o.zaks*avgCena);
      out.push({paG:o.paG,y:o.y,m:o.m,
        zaks:o.zaks,zaksAlt:o.zaksAlt,vyks:o.vyks,zakr,vykr,
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
    /* Фолбэк по ГРУППЕ услуг: список типов у Ozon растёт, и раньше всё, чего в нём
       не было, молча исчезало из P&L («Звёздные товары», «Обработка в грузоместе»,
       «Доставка до места выдачи силами Ozon» и пр.). Теперь ничего не теряется. */
    const OZ_GRP_LOG=new Set(['Услуги доставки','Услуги партнёров','Услуги FBO','Другие услуги и штрафы']);
    const OZ_GRP_REK=new Set(['Продвижение и реклама']);
    const OZ_GRP_KOMP=new Set(['Компенсации и декомпенсации']);
    const ozUnk={};   /* тип → сумма, попавшая по фолбэку (для диагностики) */

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
            kom:0,log:0,rek:0,komp:0
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
        else {
            const g=String(r[c_grp]||'').trim();
            if(OZ_GRP_REK.has(g)) o.rek+=s;
            else if(OZ_GRP_KOMP.has(g)) o.komp+=s;
            else o.log+=s;                       /* доставка/партнёры/FBO/штрафы */
            ozUnk[typ]=(ozUnk[typ]||0)+s;
        }
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

    /* ══ Ozon: сопоставимость с WB (вариант Б: gross + реальная комиссия) ══
       «Баллы за скидки» — это компенсация Ozon за скидку, которую он профинансировал.
       Полный аналог СПП у WB: клиент заплатил меньше, площадка доплатила продавцу.

       ВЫКУП,РУБ  = деньги клиента = Выручка + Возврат выручки.
                    Аналог «ВБ реализовал Товар (Пр)». Баллы сюда НЕ входят —
                    их платит площадка, а не покупатель.
       КОМ.МП     = РЕАЛЬНАЯ комиссия = Вознаграждение − Баллы − Программы партнёров.
                    Номинальные 43% берутся с базы «Выручка + Баллы» и неинформативны;
                    важно, сколько перечислено против того, что заплатил клиент.
                    Тождество: Выкуп,руб − Ком.МП = перечислено (до логистики и рекламы).
                    Как и у WB в 2022–2023, комиссия может уйти в минус — это норма.
       НАЛОГ      = с базы «Выручка + Баллы + Партнёры» (баллы — доход продавца),
                    а НЕ с Выкуп,руб. В этом отличие Ozon от WB. */
    const vals=Object.values(map);
    const T={sales:0,bonus:0,ret:0,partner:0,kom:0,komReal:0,vykr:0,tax:0}; const TY={};
    const out=vals.map(o=>{
        /* ВЫКУП,РУБ = цена продавца = Выручка + Баллы за скидки + Программы партнёров.
           Это сумма, с которой Ozon берёт вознаграждение, и она же приходит продавцу
           до удержания комиссии. Раньше я брал только «деньги клиента» (без баллов) —
           тогда комиссия математически обязана уходить в минус, потому что баллы
           больше вознаграждения. Отрицательная комиссия — не факт, а следствие
           выбора знаменателя, поэтому знаменатель приведён к базе комиссии. */
        const vykr=Math.round(o.salesRub+o.bonusRub+o.returnRub+o.partnerRub);
        const cash=Math.round(o.salesRub+o.returnRub);          /* только живые деньги — для «Разбор» */
        const rozn=vykr;
        const comp=Math.round(o.bonusRub+o.partnerRub);
        const komNom=Math.round(-o.kom);                        /* вознаграждение Ozon */
        const kom=komNom;                                       /* комиссия = вознаграждение, без вычета баллов */
        const taxBase=vykr;
        const price=o.salesQty?vykr/o.salesQty:0;
        T.sales+=o.salesRub; T.bonus+=o.bonusRub; T.ret+=o.returnRub; T.partner+=o.partnerRub;
        T.kom+=komNom; T.komReal+=komNom-comp; T.vykr+=vykr; T.tax+=taxBase;
        const b=TY[o.y]||(TY[o.y]={s:0,b:0,k:0,v:0}); b.s+=o.salesRub; b.b+=o.bonusRub; b.k+=komNom; b.v+=vykr;
        return{
            paG:o.paG,y:o.y,m:o.m,
            zaks:o.orderQty,
            vyks:o.salesQty,
            zakr:Math.round(price*o.orderQty),
            vykr,
            kom,
            komNom,                    /* номинальное вознаграждение Ozon (для «Разбор») */
            rozn, cash,                /* rozn = цена продавца · cash = только деньги клиента */
            komp:Math.round(o.komp),   /* компенсации/декомпенсации Ozon */
            bonus:Math.round(o.bonusRub),
            partner:Math.round(o.partnerRub),
            taxBase,
            rek:Math.round(-o.rek),
            post:0,
            nalog:Math.round(taxBase*((o.y>2026||(o.y===2026&&o.m>=2))?0.12:0.07)),
            hran:0,
            dost:Math.round(-o.log),
            perem:Math.round(rsFor(o)*o.salesQty)
        };
    });
    const r0=n=>Math.round(n).toLocaleString('ru-RU');
    diag.push({name:'Ozon: разбор выручки',status:'ok',rows:out.length,
      msg:`Выручка ${r0(T.sales)} · Баллы ${r0(T.bonus)} · Возврат ${r0(T.ret)} · Партнёры ${r0(T.partner)}`
        +` → Выкуп,руб (выручка+баллы) ${r0(T.vykr)} · деньги клиента ${r0(T.sales+T.ret)}`
        +` · Ком.МП номинальная ${r0(T.kom)} (${T.tax?(T.kom/T.tax*100).toFixed(1):'—'}% от базы «выручка+баллы»)`
        +` · если вычесть баллы: ${r0(T.komReal)} (справочно, в P&L НЕ используется)`
        +` · база налога ${r0(T.tax)}`
        });
    diag.push({name:'Ozon: по годам',status:'ok',rows:0,
      msg:Object.keys(TY).sort().map(y=>{const b=TY[y];
        return `${y}: выкуп ${r0(b.v)} · баллы ${b.v?(b.b/b.v*100).toFixed(0):'—'}%`
          +` · комиссия ${r0(b.k)} = ${b.v?(b.k/b.v*100).toFixed(1):'—'}%`;}).join(' │ ')
        +' ║ если % комиссии сильно скачет между годами — в выгрузке не хватает строк «Вознаграждение за продажу»'});
    const unkKeys=Object.keys(ozUnk).sort((a,b)=>Math.abs(ozUnk[b])-Math.abs(ozUnk[a]));
    diag.push({name:'Ozon: типы по фолбэку',status:unkKeys.length?'warn':'ok',rows:unkKeys.length,
      msg:unkKeys.length?`разнесены по ГРУППЕ услуг (раньше терялись): `
            +unkKeys.slice(0,10).map(k=>`${k} ${r0(ozUnk[k])}`).join(' · ')
            +` · Σ ${r0(unkKeys.reduce((a,k)=>a+ozUnk[k],0))}`
          :'все типы опознаны явно'});
    return out;
  }
  const obOZ=parseOzon(raw.ozon);

  const acForCo=ac=>ac.map(r=>({y:r.date.getFullYear(),m:r.date.getMonth()+1,paG:r.paG,acr:r.acr}));
  /* Постоянные расходы больше НЕ берём с отдельного листа «Пост»:
     они уже есть в Расход/Расход2 построчно («Что» = «Пост расходы») и там
     привязаны к артикулу. Лист «Пост» давал строки без предмета и задваивал суммы. */
  const postEF=[];
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
