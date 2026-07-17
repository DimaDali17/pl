/* ═══════════ ПАРСЕРЫ ═══════════ */
function parseCSV(text){
  const rows=[];let row=[],field='',q=false;text=text.replace(/\r/g,'');
  for(let i=0;i<text.length;i++){const c=text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){field+='"';i++;} else q=false; } else field+=c; }
    else { if(c==='"')q=true; else if(c===','){row.push(field);field='';} else if(c==='\n'){row.push(field);rows.push(row);row=[];field='';} else field+=c; }
  }
  if(field!==''||row.length){row.push(field);rows.push(row);} return rows;
}
function toObjects(rows){
  if(!rows.length)return[]; const hdr=rows[0].map(h=>String(h).trim()); const out=[];
  for(let i=1;i<rows.length;i++){ const r=rows[i]; if(r.every(c=>String(c).trim()===''))continue;
    const o={}; hdr.forEach((h,j)=>o[h]=r[j]!==undefined?r[j]:''); out.push(o); }
  out._headers=hdr; return out;
}
function num(v){ if(v==null)return 0; if(typeof v==='number')return v;
  let s=String(v).trim(); if(s===''||s==='-')return 0; s=s.replace(/[\s\u00a0\u202f₽%]/g,'');
  const hasDot=s.includes('.'),hasCom=s.includes(',');
  if(hasDot&&hasCom)s=s.replace(/,/g,'');
  else if(hasCom){ const p=s.split(','); if(p[p.length-1].length===3&&p.length>1&&p[0].length<=3)s=s.replace(/,/g,''); else s=s.replace(',','.'); }
  const n=parseFloat(s); return isNaN(n)?0:n;
}
const intn=v=>Math.round(num(v));
function pdate(v){ if(v instanceof Date)return v; if(v==null)return null;
  let s=String(v).trim(); if(!s)return null; let m,d=null;
  if(m=s.match(/^Date\((\d+),(\d+),(\d+)/))d=new Date(+m[1],+m[2],+m[3]);
  else if(m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))d=new Date(+m[1],+m[2]-1,+m[3]);
  else if(m=s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/))d=new Date(+m[3],+m[2]-1,+m[1]);
  else if(m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)){let a=+m[1],b=+m[2]; d=a>12?new Date(+m[3],b-1,a):new Date(+m[3],a-1,b);}
  else if(/^\d{5}(\.\d+)?$/.test(s)){ /* серийный номер даты Excel/Google Sheets (published-CSV) */
    const n=parseFloat(s); if(n>=20000&&n<=80000){ d=new Date(Date.UTC(1899,11,30)+Math.round(n)*86400000); } else d=null; }
  else { const t=new Date(s); d=isNaN(t)?null:t; }
  if(!d||isNaN(d))return null; const y=d.getFullYear(); if(y<2015||y>2100)return null; return d;
}
function col(headers,...names){
  const norm=h=>String(h).toLowerCase().replace(/[\s\u00a0]+/g,' ').replace(/["']/g,'').trim();
  const H=headers.map(h=>({raw:h,n:norm(h)}));
  for(const nm of names){const t=norm(nm);let f=H.find(h=>h.n===t);if(f)return f.raw;}
  for(const nm of names){const t=norm(nm);let f=H.find(h=>h.n.includes(t)||t.includes(h.n));if(f)return f.raw;}
  return null;
}
/* нормализация ключа артикула для соединений */
const nk=s=>String(s==null?'':s).toLowerCase().replace(/[^0-9a-zа-яё]/gi,'');
/* «лёгкая» нормализация: регистр + пробелы + кавычки, но ПУНКТУАЦИЯ сохраняется (как точное совпадение в PBI) */
const lnk=s=>String(s==null?'':s).toLowerCase().replace(/[\s\u00a0\u202f"'`]/g,'');
