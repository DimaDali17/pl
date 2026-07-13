/* ═══════════ UI / ЗАГРУЗКА ═══════════
   Данные приходят готовым агрегатом: data/model.json собирается в GitHub Actions
   (build/prebuild.mjs). Ни воркера, ни пароля, ни CSV в браузере больше нет. */

const DATA_URL='data/model.json';

async function load(){
  const btn=document.getElementById('reloadBtn'); btn.disabled=true;
  const ph=document.getElementById('placeholder');
  ph.style.display='block'; ph.innerHTML='Загрузка данных…';
  try{
    const r=await fetch(DATA_URL+'?v='+Date.now(),{cache:'no-store'});
    if(!r.ok) throw new Error('HTTP '+r.status+' — data/model.json не найден. Запустите workflow «Build model.json».');
    const j=await r.json();

    M.co=j.co;
    /* CONS в JSON не пишется (это конкатенация трёх) — собираем на месте */
    M.co.CONS={
      ob:   (j.co.EF?.ob||[]).concat(j.co.EZFR?.ob||[], j.co.OZON?.ob||[]),
      acr:  j.co.EF?.acr  ||[],
      postR:j.co.EF?.postR||[],
    };
    M.artByPaG=j.artByPaG||{};
    M.diag=j.diag||[];
    M.builtAt=j.builtAt;
    applyCompany();

    document.getElementById('fYear').innerHTML=M.years.map(y=>`<option>${y}</option>`).join('');
    document.getElementById('fMonth').innerHTML='<option value="">Все</option>'+MONTHS.map((m,i)=>`<option value="${i+1}">${m}</option>`).join('');
    refreshArtList();

    ph.style.display='none';
    document.getElementById('fbar').style.display='flex';
    document.getElementById('kpi').style.display='grid';
    document.getElementById('matrixSec').style.display='block';
    if(curTab==='pl')render(); else renderTab();
    renderDiag();
  }catch(e){
    M.loaded=false;
    ph.style.display='block';
    ph.innerHTML=`Не удалось загрузить данные.<br><b>${e.message}</b>
      <div style="margin-top:12px;font-size:11px">Данные пересобираются в GitHub Actions → workflow «Build model.json».</div>`;
  }
  btn.disabled=false;
}
function reload(){ load(); }

function refreshArtList(){
  const arts=[...new Set(M.obshiy.filter(r=>r.vyks>0||r.zaks>0).map(r=>r.paG))].filter(Boolean).sort();
  document.getElementById('artList').innerHTML=arts.slice(0,1000).map(a=>`<option value="${String(a).replace(/"/g,'&quot;')}">`).join('');
}

function toggleDiag(){ document.getElementById('diag').classList.toggle('show'); renderDiag(); }
function renderDiag(){
  const d=document.getElementById('diag'); if(!M.diag)return;
  const built=M.builtAt?new Date(M.builtAt).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
  let h=`<b>Диагностика сборки</b> <span style="color:var(--ink3)">· данные собраны ${built}</span><table>`;
  M.diag.forEach(x=>{ const dot=x.status==='ok'?'ok':x.status==='warn'?'warn':'err';
    h+=`<tr><td><span class="dot ${dot}"></span>${x.name}</td><td>${x.rows} строк</td><td>${x.msg||''}</td></tr>`; });
  h+='</table><div style="margin-top:8px;color:var(--ink3)">Сборка идёт в GitHub Actions: Drive → CSV-кэш → buildModel() → data/model.json.</div>';
  d.innerHTML=h;
}

setInterval(()=>{const n=new Date();document.getElementById('clk').textContent=n.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});},1000);
load();
