/* ═══════════ UI / ЗАГРУЗКА ═══════════
   Данные за паролем: model.json лежит в Cloudflare KV, фронт читает его через
   воркер-прокси (pl-proxy) по паролю ACCESS_PASSWORD. В публичном репозитории цифр нет. */

const WORKER='https://pl-proxy.ooo6311ooo.workers.dev';
const DATA_URL=WORKER+'/?data=model';
function getPass(){ try{return sessionStorage.getItem('pl_pass')||'';}catch(e){return '';} }
function setPass(p){ try{sessionStorage.setItem('pl_pass',p);}catch(e){} }

function askPassword(msg){
  const ph=document.getElementById('placeholder');
  ph.style.display='block';
  ph.innerHTML=`<div style="max-width:340px;margin:40px auto;text-align:center">
    <div style="font-size:15px;font-weight:700;margin-bottom:4px">P&amp;L продаж</div>
    <div style="font-size:12px;color:var(--ink3);margin-bottom:16px">${msg||'Введите пароль для доступа к данным'}</div>
    <input id="passInp" type="password" placeholder="пароль" style="width:100%;padding:9px 12px;border:1px solid var(--border2);border-radius:8px;font-size:14px;box-sizing:border-box"
      onkeydown="if(event.key==='Enter')submitPass()">
    <button onclick="submitPass()" style="margin-top:10px;width:100%;padding:9px;border:none;border-radius:8px;background:var(--ink);color:var(--bg3);font-weight:700;cursor:pointer">Войти</button>
  </div>`;
  document.getElementById('fbar').style.display='none';
  document.getElementById('kpi').style.display='none';
  document.getElementById('matrixSec').style.display='none';
  setTimeout(()=>{const i=document.getElementById('passInp');if(i)i.focus();},50);
}
function submitPass(){ const i=document.getElementById('passInp'); if(i){setPass(i.value.trim()); load();} }

async function load(){
  const btn=document.getElementById('reloadBtn'); if(btn)btn.disabled=true;
  const ph=document.getElementById('placeholder');
  const pass=getPass();
  if(!pass){ askPassword(); if(btn)btn.disabled=false; return; }
  ph.style.display='block'; ph.innerHTML='Загрузка данных…';
  try{
    const r=await fetch(DATA_URL,{cache:'no-store',headers:{'X-Access-Key':pass}});
    if(r.status===401){ setPass(''); askPassword('Неверный пароль, попробуйте ещё раз'); if(btn)btn.disabled=false; return; }
    if(r.status===404) throw new Error('Модель ещё не собрана. Запустите GitHub Actions → Build model.json.');
    if(!r.ok) throw new Error('HTTP '+r.status);
    const j=await r.json();

    M.co=j.co;
    M.co.CONS={
      ob:   (j.co.EF?.ob||[]).concat(j.co.EZFR?.ob||[], j.co.OZON?.ob||[]),
      acr:  j.co.EF?.acr  ||[],
      postR:j.co.EF?.postR||[],
    };
    M.artByPaG=j.artByPaG||{};
    M.diag=j.diag||[];
    M.builtAt=j.builtAt;
    applyCompany();

    document.getElementById('fYear').innerHTML=M.years.map(y=>`<option value="${y}">${y}</option>`).join('')+'<option value="0">За всё время</option>';
    monthsDone();
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
      <div style="margin-top:12px;font-size:11px">Данные собираются в GitHub Actions → Build model.json.</div>
      <div style="margin-top:8px"><button onclick="setPass('');askPassword()" style="font-size:11px;padding:4px 10px">Сменить пароль</button></div>`;
  }
  if(btn)btn.disabled=false;
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
