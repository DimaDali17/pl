/* ═══════════ ЗАГРУЗКА ═══════════ */
const SHEETS=['report','rashod','art','log','sht','acr','post','ekon','report2','log2','sht2','ekon2','ozon'];
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

async function buildModel(){
  const diag=[]; M.diag=diag;
  if(!CFG.worker && !CFG.report) throw new Error('Не задан ни воркер, ни прямые ссылки (см. Настройки).');
  const texts=await loadRawTexts(diag);
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

  /* ═══════ Мультикомпанийность: EF (report) · EZFR (report2) · OZON · Консолид ═══════ */
  /* расход построчно (ОБЩИЙ лист, поартикульно) */
  const xH=raw.rashod._headers;
  const x_date=col(xH,'Дата'),x_pa=col(xH,'Предмет;Артикул продавца','Предмет;Артикул.Глубина','Предмет;Артикул поставщика'),
    x_chto=col(xH,'Что'),x_grp=col(xH,'Что (группа)','Что группа'),x_sum=col(xH,'Сумма');
  const xRows=raw.rashod.map(r=>{ const s=num(r[x_sum]);
    const rek=(String(r[x_grp]||'').trim()==='Реклама')?s:0; const post=(String(r[x_chto]||'').trim()==='Пост расходы')?s:0;
    return {date:pdate(r[x_date]),pa:(r[x_pa]||'').trim(),rek,post,per:s-rek-post}; }).filter(r=>r.date);

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
      const perech=num(r[c_per]); const nalog=taxFlat!=null?Math.round(perech*taxFlat):Math.round(perech*(d>=TAX?0.11:0.07));
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
  function buildPU(xr,shtRaw,keyFn){
    const sH2=(shtRaw&&shtRaw._headers)||[];
    const s_pa2=col(sH2,'Предмет;Артикул поставщика','Предмет;Артикул.Глубина','Предмет;Артикул продавца','Предмет;Артикул'),s_qty2=col(sH2,'ШТ поставлено','ШТ');
    const per={},sht={};
    groupBy(xr,r=>keyFn(r.pa),rs=>({k:keyFn(rs[0].pa),per:sum(rs,'per')})).forEach(g=>{if(g.k)per[g.k]=g.per;});
    (shtRaw||[]).forEach(r=>{ const k=keyFn(r[s_pa2]); if(k)sht[k]=(sht[k]||0)+intn(r[s_qty2]); });
    const pu={}; Object.keys(per).forEach(k=>{ if(sht[k])pu[k]=Math.round(per[k]/sht[k]); });
    artDim.forEach(a=>{ const kP=keyFn(a.paP),kG=keyFn(a.paG); const v=(pu[kP]!==undefined)?pu[kP]:(pu[kG]!==undefined?pu[kG]:undefined); if(v!==undefined){pu[kP]=v;pu[kG]=v;} });
    return pu;
  }
  function buildCo(q2,logGroup,xr,shtRaw){
    const puL=buildPU(xr,shtRaw,lnk), puA=buildPU(xr,shtRaw,nk);
    const xGroup=groupBy(xr,r=>keyDP(r.date,r.pa),rs=>({date:rs[0].date,paG:rs[0].pa,post:sum(rs,'post'),rek:sum(rs,'rek')}));
    const comb=[];
    xGroup.forEach(r=>comb.push({date:r.date,paG:r.paG,rek:r.rek,post:r.post}));
    q2.forEach(r=>comb.push({date:r.date,paG:r.paG,zaks:r.zaks,vyks:r.vyks,zakr:r.zakr,vykr:r.vykr,nalog:r.nalog}));
    logGroup.forEach(r=>comb.push({date:r.date,paG:r.paG,hran:r.hran,dost:r.dost}));
    return groupBy(comb.filter(r=>r.date),r=>keyDP(r.date,r.paG),rs=>{
      const paG=rs[0].paG,date=rs[0].date,vyks=sum(rs,'vyks');
      let pu=puL[lnk(paG)]; if(pu===undefined)pu=puA[nk(paG)];
      return {paG,y:date.getFullYear(),m:date.getMonth()+1,zaks:sum(rs,'zaks'),vyks,zakr:sum(rs,'zakr'),vykr:sum(rs,'vykr'),
        rek:sum(rs,'rek'),post:sum(rs,'post'),nalog:sum(rs,'nalog'),hran:sum(rs,'hran'),dost:sum(rs,'dost'),perem:Math.round((pu||0)*vyks)};
    });
  }

  const salesEF=parseSales(raw.report,null), salesEZ=parseSales(raw.report2,0.07);
  const setEF=new Set(salesEF.map(r=>lnk(r.paG))), setEZ=new Set(salesEZ.map(r=>lnk(r.paG)));
  const xEF=[],xEZ=[];
  xRows.forEach(r=>{ const k=lnk(r.pa);
    if(setEZ.has(k)&&!setEF.has(k)){ xEZ.push(Object.assign({},r,{post:0})); } else { xEF.push(r); } });
  const obEF=buildCo(salesEF,parseLog(raw.log),xEF,raw.sht);
  acGroup.forEach(r=>obEF.push({paG:r.paG,y:r.date.getFullYear(),m:r.date.getMonth()+1,zaks:0,vyks:0,zakr:0,vykr:0,rek:0,post:0,nalog:0,hran:0,dost:0,perem:0}));
  const obEZ=buildCo(salesEZ,parseLog(raw.log2),xEZ,raw.sht2);

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

    const map={};

    rr.forEach(r=>{
        const d=pdate(r[c_date]); if(!d)return;
        const grp=String(r[c_grp]||'').trim();
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
            kom:0,
            log:0,rek:0,voz:0
        });

        if(typ==='Выручка') o.salesQty+=qty;
        if(typ==='Логистика') o.orderQty+=qty;

        if(typ==='Выручка') o.salesRub+=s;
        else if(typ==='Баллы за скидки') o.bonusRub+=s;
        else if(typ==='Возврат выручки') o.returnRub+=s;
        else if(typ==='Программы партнёров') o.partnerRub+=s;
        else if(typ==='Вознаграждение за продажу'||typ==='Возврат вознаграждения') o.kom+=s;

        if(grp==='Услуги доставки'||grp==='Услуги партнёров'||grp==='Услуги FBO'||grp==='Другие услуги и штрафы') o.log+=s;
        else if(grp==='Продвижение и реклама') o.rek+=s;
        else if(grp==='Возвраты'||grp==='Компенсации и декомпенсации') o.voz+=s;
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
            kom:Math.round(o.kom),
            rek:Math.round(-o.rek),
            post:0,
            nalog:Math.round(vykr*0.07),
            hran:0,
            dost:Math.round(-(o.log+o.voz)),
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
