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
const CACHE_VER = 'v5';   /* поднять при любом изменении WBFIN_COLS — иначе кэш отдаст старые CSV */
const OUT_FILE  = path.join(ROOT, 'data', 'model.json');

/* Только эти колонки едут дальше: 19 из 84.
   Экономит и кэш, и — главное — RAM: toObjects() держит объект на каждую строку.

   WB меняет названия колонок от года к году. Первый элемент — КАНОНИЧЕСКОЕ имя
   (его и пишем в CSV, его ждёт parseWBFin), остальные — синонимы из старых отчётов.
   Если колонку не нашли ни под одним именем — она уедет пустой, и контроль
   сходимости комиссии в конце сборки это поймает. */
const WBFIN_COLS = [
  ['Предмет'],
  ['Артикул поставщика'],
  ['Тип документа'],
  ['Обоснование для оплаты'],
  ['Дата продажи'],
  ['Кол-во'],
  ['Цена розничная'],
  ['Вайлдберриз реализовал Товар (Пр)'],
  ['Возмещение за выдачу и возврат товаров на ПВЗ'],
  /* ВНИМАНИЕ: рядом в отчёте лежат «Размер комиссии за эквайринг…, %» и
     «Тип платежа за Эквайринг…» — это процент и текст, не рубли.
     Матчинг идёт по ТОЧНОМУ имени, так что перепутать нельзя. */
  ['Компенсация платёжных услуг/Комиссия за интеграцию платёжных сервисов',
   'Компенсация платежных услуг/Комиссия за интеграцию платежных сервисов',
   'Эквайринг/Комиссии за организацию платежей',
   'Эквайринг/Комиссия за организацию платежей'],
  ['Вознаграждение Вайлдберриз (ВВ), без НДС'],
  ['НДС с Вознаграждения Вайлдберриз'],
  ['К перечислению Продавцу за реализованный Товар'],
  ['Услуги по доставке товара покупателю'],
  ['Общая сумма штрафов'],
  ['Возмещение издержек по перевозке/по складским операциям с товаром',
   'Возмещение издержек по перевозке'],
  ['Хранение'],
  ['Удержания'],
  ['Операции на приемке', 'Платная приемка', 'Платная приёмка'],
];
const HEAD = WBFIN_COLS.map(c => c[0]);   /* канонические имена — шапка итогового CSV */

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
/* Числа пишем САМИ, с точкой и без разделителей тысяч.
   Нельзя отдавать это на откуп форматированию: «24,417» ниже по течению
   превратится в 24417 (num() решит, что запятая — разделитель тысяч). */
function cellToStr(v) {
  if (v == null) return '';
  if (v instanceof Date) {
    const p = n => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  if (typeof v === 'number') return String(v);          /* точка, всегда */
  return String(v);
}

function xlsxToCSV(buf, fname) {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false });
  if (!aoa.length) { warn(`${fname}: пустой лист`); return ''; }

  const head = aoa[0].map(norm);
  const idx = WBFIN_COLS.map(aliases => {
    for (const a of aliases) { const j = head.indexOf(norm(a)); if (j >= 0) return j; }
    return -1;
  });
  const miss = WBFIN_COLS.filter((c, i) => idx[i] < 0).map(c => c[0]);
  if (miss.length) {
    warn(`${fname}: нет колонок → ${miss.join(' | ')}`);
    /* подсказка: что похожее вообще есть в этом файле */
    const hints = aoa[0].filter(h => /эквайр|платеж|платёж|приемк|приёмк|комисси/i.test(String(h)));
    if (hints.length) warn(`   похожие колонки в файле: ${hints.join(' | ')}`);
  }

  const out = [HEAD];
  for (let i = 1; i < aoa.length; i++) {
    const r = aoa[i];
    out.push(idx.map(j => (j < 0 ? '' : cellToStr(r[j]))));
  }

  /* ── Самоконтроль на уровне ОДНОГО файла ──
     На строках Продажа/Возврат должно выполняться:
        ВБ реализовал − К перечислению == ВВ + НДС + эквайринг + ПВЗ
     Если нет — в этом отчёте есть ещё одна статья, которую мы не забираем.
     Показываем ВСЕ колонки файла с ненулевыми суммами, чтобы её было видно. */
  const at = name => HEAD.indexOf(name);
  const iReason = at('Обоснование для оплаты'), iType = at('Тип документа');
  const iRetail = at('Вайлдберриз реализовал Товар (Пр)'), iPay = at('К перечислению Продавцу за реализованный Товар');
  const iVV = at('Вознаграждение Вайлдберриз (ВВ), без НДС'), iNDS = at('НДС с Вознаграждения Вайлдберриз');
  const iEkv = at('Компенсация платёжных услуг/Комиссия за интеграцию платёжных сервисов');
  const iPvz = at('Возмещение за выдачу и возврат товаров на ПВЗ');
  const N = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isNaN(n) ? 0 : n; };
  let kom = 0, comp = 0;
  for (let i = 1; i < out.length; i++) {
    const r = out[i];
    if (r[iReason] !== 'Продажа' && r[iReason] !== 'Возврат') continue;
    const sg = r[iType] === 'Продажа' ? 1 : -1;
    kom += sg * (N(r[iRetail]) - N(r[iPay]));
    comp += sg * (N(r[iVV]) + N(r[iNDS]) + N(r[iEkv]) + N(r[iPvz]));
  }
  const gap = kom - comp;
  if (Math.abs(gap) > Math.max(50, Math.abs(kom) * 0.01)) {
    warn(`${fname}: тождество не сходится на ${Math.round(gap)} ₽ (kom ${Math.round(kom)} vs компоненты ${Math.round(comp)})`);

    /* Ищем ВИНОВНИКА: колонку, которую мы не забираем и чья знаковая сумма
       по строкам Продажа/Возврат совпадает с расхождением. Это и есть недостающая статья. */
    const taken = new Set(idx.filter(j => j >= 0));
    const cand = [];
    aoa[0].forEach((h, j) => {
      if (taken.has(j)) return;                         /* уже забираем (в т.ч. по синониму) */
      if (/%|№|срок|штрих|баркод|шк|chrtid|srid|^id$|номер|кол-во|количество|коэффициент/i.test(String(h))) return;
      let sum = 0;
      for (let i = 1; i < aoa.length; i++) {
        const reason = aoa[i][idx[iReason]], type = aoa[i][idx[iType]];
        if (reason !== 'Продажа' && reason !== 'Возврат') continue;
        const v = aoa[i][j];
        if (typeof v === 'number') sum += (type === 'Продажа' ? 1 : -1) * v;
      }
      if (Math.abs(sum) > 1) cand.push([h, sum, Math.abs(sum + gap)]);   /* gap отрицательный → ищем sum ≈ -gap */
    });
    cand.sort((a, b) => a[2] - b[2]);
    warn(`   кандидаты (ищем сумму ≈ ${Math.round(-gap)} ₽):`);
    cand.slice(0, 6).forEach(([h, sum, d]) => {
      const hit = d < Math.max(5, Math.abs(gap) * 0.02) ? '  ★ СОВПАЛО' : '';
      warn(`     ${Math.round(sum).toString().padStart(10)} ₽  ${h}${hit}`);
    });
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
        fields: 'nextPageToken, files(id,name,mimeType,modifiedTime)',
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
  const GS = 'application/vnd.google-apps.spreadsheet';
  for (const f of folders) {
    const co = f.name.trim().toUpperCase();
    if (co !== 'EF' && co !== 'EZFR') { warn(`папка «${f.name}» пропущена (ожидаю EF или EZFR)`); continue; }
    const files = await children(f.id, `mimeType!='application/vnd.google-apps.folder'`);
    /* берём и настоящие .xlsx, и те, что Google при загрузке сконвертировал в Google-таблицы */
    for (const x of files.filter(x => /\.xlsx?$/i.test(x.name) || x.mimeType === GS)) {
      const isGS = x.mimeType === GS;
      out.push({ co, name: x.name, id: x.id, modifiedTime: x.modifiedTime, isGS,
        read: async () => {
          /* Google-таблицы забираем как XLSX, а НЕ как CSV.
             Экспорт в CSV пишет числа в локали документа: «24,417» — три знака после
             запятой, и num() принимает запятую за разделитель тысяч → 24417 (×1000).
             В xlsx числа лежат числами, локали нет. */
          const r = isGS
            ? await drive.files.export(
                { fileId: x.id, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
                { responseType: 'arraybuffer' })
            : await drive.files.get({ fileId: x.id, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
          return Buffer.from(r.data);
        } });
    }
  }
  const nGS = out.filter(f => f.isGS).length;
  if (nGS) warn(`${nGS} файлов — Google-таблицы (конвертированные). Забираю через export XLSX.`);
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
    const key = `${CACHE_VER}_${f.id}_${String(f.modifiedTime).replace(/[^0-9a-zA-Z]/g, '')}.csv`;
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

/* ═══════════ ДИАГНОСТИКА ДОСТУПА К DRIVE ═══════════ */
async function diagnoseDrive() {
  if (process.env.PL_LOCAL_DIR) return;
  const { google } = await import('googleapis');
  const sa = JSON.parse(process.env.GDRIVE_SA_JSON);
  console.log(`\n── Диагностика Drive ──`);
  console.log(`Сервисный аккаунт: ${sa.client_email}`);
  const auth = new google.auth.GoogleAuth({ credentials: sa, scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
  const drive = google.drive({ version: 'v3', auth });
  const root = process.env.GDRIVE_FOLDER_ID;

  try {
    const r = await drive.files.get({ fileId: root, fields: 'id,name,mimeType,owners(emailAddress)', supportsAllDrives: true });
    console.log(`Папка видна: «${r.data.name}» (${r.data.mimeType})`);
    if (r.data.mimeType !== 'application/vnd.google-apps.folder')
      console.log(`⚠ Это НЕ папка. GDRIVE_FOLDER_ID указывает на файл.`);
  } catch (e) {
    console.log(`✖ Папка НЕ видна: ${e.message}`);
    console.log(`  → либо GDRIVE_FOLDER_ID неверный, либо папка не расшарена на ${sa.client_email}`);
    die('нет доступа к папке на Диске');
  }

  const r = await drive.files.list({
    q: `'${root}' in parents and trashed=false`,
    fields: 'files(id,name,mimeType)', pageSize: 100,
    supportsAllDrives: true, includeItemsFromAllDrives: true,
  });
  if (!r.data.files.length) {
    console.log(`Внутри папки: пусто (для сервисного аккаунта).`);
    die('папка пуста — расшарена не та папка?');
  }
  console.log(`Внутри папки:`);
  const subs = [];
  r.data.files.forEach(f => {
    const isDir = f.mimeType === 'application/vnd.google-apps.folder';
    const isCut = f.mimeType === 'application/vnd.google-apps.shortcut';
    console.log(`  ${isDir ? '[папка]' : isCut ? '[ярлык]' : '[файл] '} ${f.name}${isCut ? '  ← ярлык, нужна сама папка' : ''}`);
    if (isDir) subs.push(f);
  });

  const want = subs.filter(f => ['EF', 'EZFR'].includes(f.name.trim().toUpperCase()));
  if (!want.length) die('нет подпапок с именами EF и EZFR — см. список выше');

  /* заглядываем внутрь EF/EZFR: что там вообще лежит */
  for (const f of want) {
    const c = await drive.files.list({
      q: `'${f.id}' in parents and trashed=false`,
      fields: 'files(name,mimeType)', pageSize: 20,
      supportsAllDrives: true, includeItemsFromAllDrives: true,
    });
    console.log(`\nВнутри «${f.name}»: ${c.data.files.length ? c.data.files.length + '+ объектов' : 'ПУСТО'}`);
    c.data.files.slice(0, 10).forEach(x => {
      const isSheet = x.mimeType === 'application/vnd.google-apps.spreadsheet';
      const isXlsx = /\.xlsx?$/i.test(x.name);
      const mark = isXlsx ? 'xlsx  ' : isSheet ? 'Sheets' : '?     ';
      console.log(`  [${mark}] ${x.name}`);
    });
    if (!c.data.files.length) console.log(`  → файлы ещё не загружены в эту папку`);
  }
  die('в EF/EZFR не найдено ни одного xlsx / Google-таблицы — см. содержимое выше');
}

/* ═══════════ MAIN ═══════════ */
const t0 = Date.now();
const files = await listSources();
log(`источников на Диске: ${files.length}`);
if (!files.length) await diagnoseDrive();

const texts = await fetchSheets();
texts.wbfin_ezfr = await buildWbfin(files, 'EZFR');
/* EF на финотчёте WB. Отключается через WBFIN_EF=0 — откатывает EF на report+log. */
if (process.env.WBFIN_EF !== '0') texts.wbfin_ef = await buildWbfin(files, 'EF');

/* Без финотчёта model.js МОЛЧА откатится на report2 и выдаст другие цифры.
   Лучше упасть, чем выложить правдоподобную неправду. */
if (!texts.wbfin_ezfr && process.env.ALLOW_NO_WBFIN !== '1')
  die('EZFR: финотчёт не собран (0 файлов на Диске). Модель откатилась бы на report2 и дала другие цифры.');

const M = await runModel(texts);

/* ── валидация: лучше упасть, чем выложить тихо разъехавшиеся цифры ── */
const errs = (M.diag || []).filter(d => d.status === 'err');
if (errs.length) die('обязательные листы пустые: ' + errs.map(d => d.name).join(', '));
if (!M.co) die('buildModel не собрал M.co');
/* Порог — защита от «источник не доехал», а не от малого кабинета.
   EZFR это десяток артикулов × несколько месяцев ≈ 30 строк агрегата. */
const MIN_ROWS = +(process.env.MIN_ROWS ?? 10);
for (const co of ['EF', 'EZFR', 'OZON']) {
  const n = (M.co[co]?.ob || []).length;
  log(`${co}: ${n} строк агрегата`);
  if (co !== 'OZON' && n < MIN_ROWS) die(`${co}: подозрительно мало строк (${n} < ${MIN_ROWS}) — источник не доехал?`);
}

/* Контроль разложения комиссии: ВВ + НДС + эквайринг + ПВЗ должны в сумме
   давать ровно kom (= ВБ реализовал − К перечислению). Если нет — числа испорчены
   по дороге (локаль, кодировка, не та колонка). Именно так ловится «×1000». */
const R = n => Math.round(n).toLocaleString('ru-RU');
for (const co of ['EF', 'EZFR']) {
  const ob = (M.co[co]?.ob || []);
  const komSum = ob.reduce((s, r) => s + (r.kom || 0), 0);
  const otherSum = ob.reduce((s, r) => s + Math.abs(r.komOther || 0), 0);
  const vykr = ob.reduce((s, r) => s + (r.vykr || 0), 0);
  if (!komSum) continue;
  const drift = otherSum / komSum;
  log(`${co}: выручка ${R(vykr)} ₽ · комиссия ${R(komSum)} ₽ · нераспознано ${R(otherSum)} ₽ (${(drift * 100).toFixed(2)}%)`);

  if (drift > 0.001) {
    /* где именно расходится: по годам, затем по месяцам худшего года */
    const acc = (rows) => rows.reduce((a, r) => ({
      vykr: a.vykr + (r.vykr || 0), kom: a.kom + (r.kom || 0),
      comp: a.comp + (r.vv || 0) + (r.vvNds || 0) + (r.ekvair || 0) + (r.pvz || 0),
      other: a.other + (r.komOther || 0),          /* СО ЗНАКОМ */
      abs: a.abs + Math.abs(r.komOther || 0),
    }), { vykr: 0, kom: 0, comp: 0, other: 0, abs: 0 });

    const years = [...new Set(ob.map(r => r.y))].sort();
    console.log(`   ${co}: нераспознанная комиссия по годам (знак: + = kom больше суммы компонент):`);
    for (const y of years) {
      const b = acc(ob.filter(r => r.y === y));
      if (!b.kom && !b.abs) continue;
      const p = b.kom ? b.abs / b.kom * 100 : 0;
      console.log(`     ${y}: ${(b.other >= 0 ? '+' : '') + R(b.other)} ₽ из ${R(b.kom)} ₽ (${p.toFixed(2)}%)`);
    }
    const worstY = years.map(y => [y, acc(ob.filter(r => r.y === y)).abs]).sort((a, b) => b[1] - a[1])[0][0];
    const months = [...new Set(ob.filter(r => r.y === worstY).map(r => r.m))].sort((a, b) => a - b);
    const worstM = months.map(m => [m, acc(ob.filter(r => r.y === worstY && r.m === m)).abs]).sort((a, b) => b[1] - a[1])[0][0];
    const b = acc(ob.filter(r => r.y === worstY && r.m === worstM));
    console.log(`   Худший месяц ${worstM}.${worstY} — обе стороны уравнения:`);
    console.log(`     ВБ реализовал (vykr):        ${R(b.vykr).padStart(14)} ₽`);
    console.log(`     К перечислению (vykr − kom): ${R(b.vykr - b.kom).padStart(14)} ₽`);
    console.log(`     kom = vykr − К перечислению: ${R(b.kom).padStart(14)} ₽`);
    console.log(`     ВВ+НДС+эквайринг+ПВЗ:        ${R(b.comp).padStart(14)} ₽   ← должно совпасть с kom`);
    console.log(`     расхождение:                 ${R(b.other).padStart(14)} ₽`);
  }
  if (drift > (+(process.env.KOM_TOL ?? 0.01))) die(`${co}: разложение комиссии не сходится — см. разбивку выше`);
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
