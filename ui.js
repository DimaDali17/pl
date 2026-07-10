/* ═══════════ UI / ЗАГРУЗКА ═══════════ */
const CFG_KEYS=['worker','pass','report','rashod','art','log','sht','acr','post','ekon'];
function fillSettings(){CFG_KEYS.forEach(k=>{const e=document.getElementById('u_'+k);if(e)e.value=CFG[k]||'';});}
function openSetup(){fillSettings();document.getElementById('setup').classList.add('show');}
function readSettings(){CFG={};CFG_KEYS.forEach(k=>{const e=document.getElementById('u_'+k);CFG[k]=e?e.value.trim():'';});try{localStorage.setItem(LS_KEY,JSON.stringify(CFG));}catch(e){}}
async function saveAndLoad(){readSettings();await load(true);}
async function load(fromSetup){
  const msg=document.getElementById('smsg'); if(fromSetup){msg.className='smsg';msg.textContent='Загрузка…';}
  document.getElementById('reloadBtn').disabled=true;
  try{ await buildModel();
    document.getElementById('fYear').innerHTML=M.years.map(y=>`<option>${y}</option>`).join('');
    document.getElementById('fMonth').innerHTML='<option value="">Все</option>'+MONTHS.map((m,i)=>`<option value="${i+1}">${m}</option>`).join('');
    /* автодополнение поиска артикулов из справочника/продаж */
    const arts=[...new Set(M.obshiy.filter(r=>r.vyks>0||r.zaks>0).map(r=>r.paG))].filter(Boolean).sort();
    document.getElementById('artList').innerHTML=arts.slice(0,1000).map(a=>`<option value="${String(a).replace(/"/g,'&quot;')}">`).join('');
    document.getElementById('placeholder').style.display='none';
    document.getElementById('fbar').style.display='flex';
    document.getElementById('kpi').style.display='grid';
    document.getElementById('matrixSec').style.display='block';
    render(); renderDiag();
    if(fromSetup){msg.className='smsg ok';msg.textContent='Готово ✓';setTimeout(()=>document.getElementById('setup').classList.remove('show'),600);}
  }catch(e){ renderDiag();
    if(fromSetup){msg.className='smsg err';msg.textContent='Ошибка: '+e.message+'\n(см. диагностику)';}
    else{document.getElementById('placeholder').innerHTML='Ошибка: '+e.message+'<div><button class="loadbtn" onclick="openSetup()">Настройки</button></div>';}
  }
  document.getElementById('reloadBtn').disabled=false;
}
function reload(){load(false);}
function toggleDiag(){document.getElementById('diag').classList.toggle('show');renderDiag();}
function renderDiag(){ const d=document.getElementById('diag'); if(!M.diag)return;
  let h='<b>Диагностика загрузки</b><table>';
  M.diag.forEach(x=>{const dot=x.status==='ok'?'ok':x.status==='warn'?'warn':'err';
    h+=`<tr><td><span class="dot ${dot}"></span>${x.name}</td><td>${x.rows} строк</td><td>${x.msg||''}</td></tr>`;});
  h+='</table><div style="margin-top:8px;color:var(--ink3)">Если «ШТ-сопоставление» низкое — сравните строки «ключи расход(перем)» и «ключи ШТУК»: они должны совпадать. Пришлите этот блок — подстрою соединение.</div>';
  d.innerHTML=h;
}
setInterval(()=>{const n=new Date();document.getElementById('clk').textContent=n.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});},1000);
(function init(){ try{const s=localStorage.getItem(LS_KEY);if(s)CFG={...DEFAULTS,...JSON.parse(s)};}catch(e){}
  fillSettings(); if(CFG.worker||CFG.report)load(false); else document.getElementById('setup').classList.add('show'); })();
