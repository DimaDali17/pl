/* ═══════════ CONFIG ═══════════ */
/* НИКАКИХ ссылок на таблицы в коде — они в секретах воркера.
   Здесь только пусто: конфиг вводится в «Настройках» и хранится в localStorage этого браузера. */
const DEFAULTS={ worker:'', pass:'', report:'',rashod:'',art:'',log:'',sht:'',acr:'',post:'',ekon:'' };
const LS_KEY='pl_cfg_v3';
let CFG={...DEFAULTS};
const MONTHS=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
let M={obshiy:[],acruals:[],postR:[],years:[],loaded:false,diag:[],artByPaG:{}};
let grpMode='month', pyOn=false, curTab='pl', curCo='EF';
let selMonths=new Set();   /* выбранные месяцы (1..12); пусто = все */
