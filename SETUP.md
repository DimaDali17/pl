# Настройка пребилда (разово)

## 1. Google Drive

```
pl-sources/            ← id этой папки пойдёт в GDRIVE_FOLDER_ID
   ├── EF/     detail_*.xlsx
   └── EZFR/   detail_*.xlsx
```
Компания определяется **именем подпапки**, не именем файла. Другие подпапки скрипт пропустит с warn.

## 2. Сервисный аккаунт

1. console.cloud.google.com → новый проект → включить **Google Drive API**
2. Service Account → Keys → Add key → JSON
3. Расшарить папку `pl-sources` на email вида `...@....iam.gserviceaccount.com`, права «Читатель»

## 3. Секреты GitHub (Settings → Secrets and variables → Actions)

| Имя | Тип | Значение |
|---|---|---|
| `GDRIVE_SA_JSON` | secret | JSON сервисного аккаунта целиком |
| `GDRIVE_FOLDER_ID` | secret | id из URL папки `pl-sources` |
| `SHEET_CSV_URLS` | secret | JSON-карта published-CSV ссылок (ниже) |
| `WBFIN_EF` | **variable** | не задавать. Поставить `1` на приоритете 3 |

`SHEET_CSV_URLS` — одной строкой:

```json
{"report":"https://docs.google.com/…/pub?gid=0&single=true&output=csv",
 "rashod":"…","art":"…","log":"…","sht":"…","acr":"…","post":"…","ekon":"…",
 "report2":"…","rashod2":"…","art2":"…","log2":"…","sht2":"…","ekon2":"…","ozon":"…"}
```

Обязательные листы (иначе сборка падает): `report`, `rashod`, `art`, `log`, `sht`, `acr`.
Лист `wbfin_ezfr` в карту **не входит** — он собирается из xlsx на Диске.

Своя бухгалтерия EZFR — `rashod2` (Расход), `art2` (Артикул), `sht2` (ШТУК), `ekon2` (Экон).
Если `rashod2` пустой, EZFR откатывается на старое поведение (расходы выковыриваются из общего листа).

Каждый лист: Файл → Опубликовать в интернете → нужная вкладка → CSV.

## 4. .gitignore

```
cache/
node_modules/
```

## 5. Рабочий цикл

Новый xlsx в папку на Диске → GitHub → Actions → **Build model.json** → Run workflow.
Через ~1–2 мин `data/model.json` в репозитории обновлён, Pages подхватил.
Понедельник 05:00 UTC — то же самое по расписанию.

## Локальный прогон (без Drive)

```bash
export PL_LOCAL_DIR=./src        # папка с EF/ и EZFR/
export SHEET_CSV_URLS='{"report":"…"}'
node build/prebuild.mjs
```

## Что делает сборка

1. Обход `pl-sources/{EF,EZFR}` через Drive API.
2. Кэш `cache/{fileId}_{modifiedTime}.csv` — файл не качается и не распаковывается повторно.
   При конвертации остаются **19 колонок из 84** (экономит RAM: `toObjects()` держит объект на строку).
3. Склейка: шапка из первого файла, дальше тела; файл с другой шапкой пропускается с warn.
4. `config.js + parsers.js + model.js` исполняются в Node через `vm.runInContext` → `buildModel(texts)`.
   Логика ровно та же, что в браузере — расхождения цифр невозможны.
5. Валидация: `status:'err'` в диагностике или < `MIN_ROWS` (50) строк агрегата → сборка падает.
6. `data/model.json` = `{builtAt, co:{EF,EZFR,OZON}, artByPaG, diag}`.
   `CONS` не пишется — фронт собирает конкатенацией, это экономит половину файла.

## Подводный камень

В `config.js` `M` и `CFG` объявлены через `let` → это **лексические переменные контекста, а не свойства sandbox-объекта**.
`ctx.M` вернёт `undefined`. Читать только выражением: `vm.runInContext('({co:M.co,…})', ctx)`.
