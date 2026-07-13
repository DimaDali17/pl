/* ═══════════════════════════════════════════════════════════════
   prebuild.mjs — собирает data/model.json
   Drive (detail_*.xlsx) + Google Sheets (справочники) → buildModel() в Node

   ENV:
     GDRIVE_SA_JSON    JSON сервисного аккаунта (целиком, одной строкой)
     GDRIVE_FOLDER_ID  id папки pl-sources (внутри подпапки EF/ и EZFR/)
     SHEET_CSV_URLS    JSON: {"report":"https://…/pub?output=csv", "rashod":"…", …}
     WBFIN_EF          "1" — подключить лист wbfin_ef (пока EF на старой схеме → не нужно)
     PL_LOCAL_DIR      локальный тест: путь к папке с EF/ и EZFR/ вместо Drive
   ═══════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import * as XLSX from 'xlsx';

const ROOT      = process.cwd();   /* Actions запускает из корня репо; скрипт может лежать где угодно */
const CACHE_DIR = path.join(ROOT, 'cache');
const OUT_FILE  = path.join(ROOT, 'data', 'model.json');

/* Только эти колонки едут дальше: 19 из 84.
   Экономит и кэш, и — главное — RAM: toObjects() держит объект на каждую строку. */
const WBFIN_COLS = [
  'Предмет','Артикул поставщика','Тип документа','Обоснование для оплаты','Дата продажи','Кол-во',
  'Цена розничная','Вайлдберриз реализовал Товар (Пр)',
  'Возмещение за выдачу и возврат товаров на ПВЗ',
  'Компенсация платёжных услуг/Комиссия за интеграцию платёжных сервисов',
  'Вознаграждение Вайлдберриз (ВВ), без НДС','НДС с Вознаграждения Вайлдберриз',
  'К перечислению Продавцу за реализованный Товар','Услуги по доставке товара покупателю',
  'Общая сумма штрафов','Возмещение издержек по перевозке/по складским операциям с товаром',
  'Хранение','Удержания','Операции на приемке',
];
const norm = s => String(s ?? '').toLowerCase().replace(/[\s\u00a0]+/g, ' ').replace(/[«»"']/g, '').trim();

const log  = (...a) => console.log('•', ...a);
const warn = (...a) => console.log('⚠', ...a);
const die  = m => { console.error('✖ ' + m); process.exit(1); };

/* ═══════════ CSV ═══════════ */
const esc = v => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const toCSV = aoa => aoa.map(r => r.map(esc).join(',')).join('\n');

/* xlsx (buffer) → csv-текст только из нужных колонок */
function xlsxToCSV(buf, fname) {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true, dateNF: 'yyyy-mm-dd' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, dateNF: 'yyyy-mm-dd', blankrows: false });
  if (!aoa.length) { warn(`${fname}: пустой лист`); return ''; }

  const head = aoa[0].map(norm);
  const idx = WBFIN_COLS.map(c => head.indexOf(norm(c)));
  const miss = WBFIN_COLS.filter((c, i) => idx[i] < 0);
  if (miss.length) warn(`${fname}: нет колонок → ${miss.join(' | ')}`);

  const out = [WBFIN_COLS];
  for (let i = 1; i < aoa.length; i++) {
    const r = aoa[i];
    out.push(idx.map(j => (j < 0 ? '' : (r[j] ?? ''))));
  }
  return toCSV(out);
}

/* ═══════════ ИСТОЧНИКИ: Drive или локальная папка ═══════════ */
async function listSources() {
  if (process.env.PL_LOCAL_DIR) {
    const base = process.env.PL_LOCAL_DIR, out = [];
    for (const co of ['EF', 'EZFR']) {
      const dir = path.join(base, co);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir).filter(f => /\.xlsx?$/i.test(f) && !f.startsWith('~$'))) {
        const p = path.join(dir, f), st = fs.statSync(p);
        out.push({ co, name: f, id: 'local_' + Buffer.from(p).toString('hex').slice(0, 16),
                   modifiedTime: String(st.mtimeMs | 0), read: async () => fs.readFileSync(p) });
      }
    }
    return out;
  }

  const { google } = await import('googleapis');
  const sa = JSON.parse(process.env.GDRIVE_SA_JSON || die('нет GDRIVE_SA_JSON'));
  const auth = new google.auth.GoogleAuth({ credentials: sa, scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
  const drive = google.drive({ version: 'v3', auth });
  const root = process.env.GDRIVE_FOLDER_ID || die('нет GDRIVE_FOLDER_ID');

  const children = async (parent, q) => {
    const out = [];
    let pageToken;
    do {
      const r = await drive.files.list({
        q: `'${parent}' in parents and trashed=false and ${q}`,
        fields: 'nextPageToken, files(id,name,modifiedTime)',
        pageSize: 1000, pageToken,
        supportsAllDrives: true, includeItemsFromAllDrives: true,
      });
      out.push(...r.data.files);
      pageToken = r.data.nextPageToken;
    } while (pageToken);
    return out;
  };

  const folders = await children(root, `mimeType='application/vnd.google-apps.folder'`);
  const out = [];
  for (const f of folders) {
    const co = f.name.trim().toUpperCase();
    if (co !== 'EF' && co !== 'EZFR') { warn(`папка «${f.name}» пропущена (ожидаю EF или EZFR)`); continue; }
    const files = await children(f.id, `mimeType!='application/vnd.google-apps.folder'`);
    for (const x of files.filter(x => /\.xlsx?$/i.test(x.name))) {
      out.push({ co, name: x.name, id: x.id, modifiedTime: x.modifiedTime,
        read: async () => {
          const r = await drive.files.get({ fileId: x.id, alt: 'media', supportsAllDrives: true },
                                          { responseType: 'arraybuffer' });
          return Buffer.from(r.data);
        } });
    }
  }
  return out;
}

/* ═══════════ СКЛЕЙКА: кэш по fileId+modifiedTime ═══════════ */
async function buildWbfin(files, co) {
  const mine = files.filter(f => f.co === co).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  if (!mine.length) { warn(`${co}: файлов нет`); return ''; }

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const parts = [];
  let hit = 0, miss = 0;

  for (const f of mine) {
    const key = `${f.id}_${String(f.modifiedTime).replace(/[^0-9a-zA-Z]/g, '')}.csv`;
    const cp = path.join(CACHE_DIR, key);
    let csv;
    if (fs.existsSync(cp)) { csv = fs.readFileSync(cp, 'utf8'); hit++; }
    else {
      csv = xlsxToCSV(await f.read(), f.name);
      fs.writeFileSync(cp, csv);
      miss++;
    }
    if (csv.trim()) parts.push(csv);
  }
  log(`${co}: ${mine.length} файлов (кэш ${hit}, распаковано ${miss})`);

  /* шапка из первого, дальше только тела; шапки сверяем */
  const head = parts[0].slice(0, parts[0].indexOf('\n'));
  const body = [];
  parts.forEach((p, i) => {
    const nl = p.indexOf('\n');
    if (p.slice(0, nl) !== head) warn(`${co}: шапка файла #${i + 1} отличается — пропущен`);
    else if (nl >= 0) body.push(p.slice(nl + 1));
  });
  const csv = head + '\n' + body.join('\n');
  log(`${co}: строк ${csv.split('\n').length - 1}, ${(Buffer.byteLength(csv) / 1e6).toFixed(1)} МБ`);
  return csv;
}

/* ═══════════ СПРАВОЧНИКИ ИЗ GOOGLE SHEETS ═══════════ */
async function fetchSheets() {
  const urls = JSON.parse(process.env.SHEET_CSV_URLS || '{}');
  const texts = {};
  await Promise.all(Object.entries(urls).map(async ([k, url]) => {
    if (!url) return;
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) die(`лист «${k}»: HTTP ${r.status}`);
    texts[k] = await r.text();
    log(`лист ${k}: ${(Buffer.byteLength(texts[k]) / 1e6).toFixed(2)} МБ`);
  }));
  return texts;
}

/* ═══════════ ЗАПУСК model.js В NODE ═══════════ */
/* Скрипты могут лежать и в корне репо, и в js/ — ищем сами */
function srcPath(f) {
  for (const d of ['', 'js']) {
    const p = path.join(ROOT, d, f);
    if (fs.existsSync(p)) return p;
  }
  die(`не найден ${f} (искал в корне и в js/)`);
}

async function runModel(texts) {
  const ctx = vm.createContext({
    console, fetch, URL, TextDecoder, Promise, Math, Date, JSON, Set, Map,
    Object, Array, String, Number, Boolean, isNaN, isFinite, parseFloat, parseInt, Error,
    setTimeout, clearTimeout,
    /* шимы: config.js/model.js их не трогают на верхнем уровне, но пусть будут */
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: { getElementById: () => null, querySelectorAll: () => [] },
  });
  ctx.globalThis = ctx;
  for (const f of ['config.js', 'parsers.js', 'model.js']) {
    vm.runInContext(fs.readFileSync(srcPath(f), 'utf8'), ctx, { filename: f });
  }
  ctx.__texts = texts;
  await vm.runInContext('buildModel(__texts)', ctx);
  /* ВАЖНО: в config.js `M` объявлена через let → это лексическая переменная контекста,
     а НЕ свойство sandbox-объекта. ctx.M будет undefined. Достаём выражением. */
  return vm.runInContext('({co:M.co, artByPaG:M.artByPaG, diag:M.diag})', ctx);
}

/* ═══════════ MAIN ═══════════ */
const t0 = Date.now();
const files = await listSources();
log(`источников на Диске: ${files.length}`);

const texts = await fetchSheets();
texts.wbfin_ezfr = await buildWbfin(files, 'EZFR');
if (process.env.WBFIN_EF === '1') texts.wbfin_ef = await buildWbfin(files, 'EF');

const M = await runModel(texts);

/* ── валидация: лучше упасть, чем выложить тихо разъехавшиеся цифры ── */
const errs = (M.diag || []).filter(d => d.status === 'err');
if (errs.length) die('обязательные листы пустые: ' + errs.map(d => d.name).join(', '));
if (!M.co) die('buildModel не собрал M.co');
const MIN_ROWS = +(process.env.MIN_ROWS ?? 50);
for (const co of ['EF', 'EZFR', 'OZON']) {
  const n = (M.co[co]?.ob || []).length;
  log(`${co}: ${n} строк агрегата`);
  if (co !== 'OZON' && n < MIN_ROWS) die(`${co}: подозрительно мало строк (${n} < ${MIN_ROWS}) — источник не доехал?`);
}

/* CONS не пишем: это конкатенация трёх — фронт соберёт сам, экономим ~половину файла */
const out = {
  builtAt: new Date().toISOString(),
  co: { EF: M.co.EF, EZFR: M.co.EZFR, OZON: M.co.OZON },
  artByPaG: M.artByPaG,
  diag: M.diag,
};
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(out));
log(`data/model.json — ${(fs.statSync(OUT_FILE).size / 1e6).toFixed(2)} МБ за ${((Date.now() - t0) / 1000).toFixed(1)} с`);
