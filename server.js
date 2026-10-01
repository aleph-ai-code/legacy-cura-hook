const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const app = express();
const DATA_DIR = process.env.DATA_DIR || '/data';
const DB_FILE = path.join(DATA_DIR, 'events.db');
const LEGACY_JSON = process.env.DATA_FILE || path.join(DATA_DIR, 'events.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

// ===================== SQLITE =====================
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  origem TEXT NOT NULL,
  evento TEXT,
  venda_id TEXT,
  ts TEXT NOT NULL,
  json TEXT NOT NULL,
  dedup_key TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_evento_ts ON events(evento, ts);
CREATE INDEX IF NOT EXISTS idx_events_origem ON events(origem);
`);
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_events_dedup ON events(dedup_key)');

// Dedup: chave = webhook_evento + ':' + (venda.id ?? venda.uid ?? hash do body)
function dedupKey(body){
  const ev = body && body.webhook_evento || 'outro';
  let id = body && body.venda && (body.venda.id ?? body.venda.uid);
  if (id == null) id = 'hash:' + crypto.createHash('sha1').update(JSON.stringify(body)).digest('hex').slice(0,16);
  return ev + ':' + id;
}

const insStmt = db.prepare('INSERT OR IGNORE INTO events (id, origem, evento, venda_id, ts, json, dedup_key) VALUES (?,?,?,?,?,?,?)');
const allRows = () => db.prepare('SELECT * FROM events ORDER BY ts ASC').all();
const rowToEvent = (r) => { let body={}; try{ body=JSON.parse(r.json); }catch(e){} return { id:r.id, origem:r.origem, ts:r.ts, body }; };

// Migração do events.json legado
(function migrate(){
  try {
    if (!fs.existsSync(LEGACY_JSON)) return;
    const arr = JSON.parse(fs.readFileSync(LEGACY_JSON, 'utf8'));
    const tx = db.transaction((items) => {
      for (const e of items) {
        const body = e.body || {};
        const ev = body.webhook_evento || 'outro';
        const vid = body.venda && (body.venda.id ?? body.venda.uid);
        insStmt.run(String(e.id), String(e.origem||'desconhecida'), ev, vid==null?null:String(vid), String(e.ts||new Date().toISOString()), JSON.stringify(body), dedupKey(body));
      }
    });
    tx(arr);
    fs.renameSync(LEGACY_JSON, LEGACY_JSON + '.migrated');
    console.log('Migrados', arr.length, 'eventos de events.json para SQLite');
  } catch (e) { console.error('Migracao falhou:', e.message); }
})();
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
app.use(express.json({limit:'2mb'}));
app.use(express.text({type:'*/*', limit:'2mb'}));

// ===================== LOGIN (Opção A: senha + cookie assinado) =====================
const PAINEL_PASSWORD = process.env.PAINEL_PASSWORD || 'L3g@cy';
const AUTH_SECRET = process.env.PAINEL_SECRET || 'legacy-painel-secret-v1';
const AUTH_COOKIE = 'painel_auth';
function authToken(){ return crypto.createHmac('sha256', AUTH_SECRET).update(PAINEL_PASSWORD).digest('hex'); }
function safeEq(a,b){ const A=Buffer.from(String(a==null?'':a)), B=Buffer.from(String(b==null?'':b)); return A.length===B.length && crypto.timingSafeEqual(A,B); }
function isValidAuth(req){
  const m = new RegExp('(?:^|;\\s*)' + AUTH_COOKIE + '=([a-f0-9]{64})').exec(req.headers.cookie || '');
  return !!m && safeEq(m[1], authToken());
}
function loginPage(err){
  return '<!doctype html><html lang=pt-BR><head><meta charset=utf-8><title>LEGACY · Acesso restrito</title><meta name=viewport content="width=device-width,initial-scale=1"><style>' +
  'body{font-family:system-ui,-apple-system,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#17251d;color:#f7f3e9;line-height:1.5}' +
  '.card{background:#213629;border:1px solid rgba(212,165,63,.45);border-radius:14px;padding:32px;box-shadow:0 4px 16px rgba(0,0,0,.4);text-align:center;min-width:300px}' +
  'h1{font-size:28px;font-weight:800;letter-spacing:5px;margin:0 0 4px;color:#eecf7e}' +
  'p{color:#a8b0a0;font-size:12px;margin:0 0 24px;letter-spacing:1px}' +
  'input{width:100%;padding:8px 12px;border-radius:8px;border:1px solid rgba(212,165,63,.4);background:#17251d;color:#f7f3e9;font-size:14px;outline:none;box-sizing:border-box;text-align:center;line-height:1.4}' +
  'input:focus{border-color:#d4a53f}' +
  'button{margin-top:16px;width:100%;padding:8px;border:0;border-radius:8px;background:#d4a53f;color:#1a1033;font-weight:600;font-size:14px;cursor:pointer;line-height:1.4}' +
  'button:hover{filter:brightness(1.08)}' +
  '.err{color:#e08a8a;font-size:12px;margin-top:12px;min-height:14px}' +
  '</style></head><body><div class=card><h1>LEGACY</h1><p>Acesso restrito</p>' +
  '<form method=post action=/login><input type=password name=senha placeholder="Senha" autofocus required><button>Entrar</button>' +
  '<div class=err>' + (err ? 'Senha incorreta. Tente novamente.' : '') + '</div></form></div></body></html>';
}
// Middleware: tudo exige cookie, EXCETO webhook (EVO não autentica) e login/logout
app.use((req,res,next)=>{
  if (req.path.startsWith('/hook/')) return next();
  if (req.method==='POST' && (req.path==='/login' || req.path==='/logout')) return next();
  if (req.path==='/favicon.ico') return res.status(404).end();
  if (isValidAuth(req)) return next();
  res.status(200).setHeader('Content-Type','text/html; charset=utf-8');
  return res.send(loginPage(req.query && req.query.erro ? true : false));
});
app.post('/login', (req,res)=>{
  let senha = '';
  const raw = typeof req.body === 'string' ? req.body : (req.body && req.body.senha ? req.body.senha : '');
  if (typeof raw === 'string'){ try { senha = new URLSearchParams(raw).get('senha') || ''; } catch(e){ senha = raw; } }
  if (safeEq(senha, PAINEL_PASSWORD)){
    res.setHeader('Set-Cookie', AUTH_COOKIE + '=' + authToken() + '; Max-Age=2592000; HttpOnly; Path=/');
    return res.redirect(302, '/');
  }
  return res.redirect(302, '/?erro=1');
});
app.post('/logout', (req,res)=>{
  res.setHeader('Set-Cookie', AUTH_COOKIE + '=; Max-Age=0; HttpOnly; Path=/');
  return res.redirect(302, '/');
});

// Recebe QUALQUER POST em /hook/:origem — responde 200 sempre
app.post('/hook/:origem', (req,res)=>{
  let body = req.body;
  if (typeof body === 'string'){ try{ body = JSON.parse(body); }catch(e){} }
  const id = Date.now()+'-'+Math.random().toString(36).slice(2,7);
  const origem = req.params.origem;
  const ts = new Date().toISOString();
  const ev = body && body.webhook_evento || 'outro';
  const vid = body && body.venda && (body.venda.id ?? body.venda.uid);
  const info = insStmt.run(id, origem, ev, vid==null?null:String(vid), ts, JSON.stringify(body), dedupKey(body));
  if (info.changes === 0) return res.status(200).json({ok:true, dedupe:true});
  res.status(200).json({ok:true});
});

// Export CSV
function csvField(v){
  let sv = v==null ? '' : String(v);
  if (/[",\n\r]/.test(sv)) sv = '"' + sv.replace(/"/g,'""') + '"';
  return sv;
}
app.get('/export.csv', (req,res)=>{
  const filtro = req.query.evento || 'todos';
  let a = allRows().map(rowToEvent);
  if (filtro==='venda.paga' || filtro==='carrinho.abandonado') a = a.filter(e=>e.body && e.body.webhook_evento===filtro);
  const header = ['webhook_evento','venda.id','data','status','cliente.nome','cliente.cpf','cliente.email','cliente.whatsapp','produto.nome','valor','forma_pagamento','origem','link_recuperacao'];
  const lines = [header.join(',')];
  for (const e of a){
    const b = e.body || {}, cli = b.cliente||{}, prod = b.produto||{}, v = b.venda||{}, c = b.carrinho||{};
    const valor = Number(c.total_venda) || Number(b.valor) || '';
    lines.push([
      b.webhook_evento, v.id ?? v.uid ?? '', e.ts, v.status ?? b.status ?? '',
      cli.nome, cli.cpf ?? cli.documento, cli.email, cli.whatsapp ?? cli.telefone,
      prod.nome, valor, v.forma_pagamento ?? b.forma_pagamento, e.origem, c.link_recuperacao
    ].map(csvField).join(','));
  }
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="vendas-legacy.csv"');
  res.send('\ufeff' + lines.join('\r\n'));
});

// ===================== TIMEZONE (exibicao em America/Fortaleza) =====================
const TZ = 'America/Fortaleza';
const dayFmt = new Intl.DateTimeFormat('en-CA', {timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit'}); // YYYY-MM-DD
const hourFmt = new Intl.DateTimeFormat('en-GB', {timeZone: TZ, hour:'numeric', hour12:false});
function localDay(ts){ try { return dayFmt.format(new Date(ts)); } catch(e){ return String(ts).slice(0,10); } }
function localHour(ts){ try { return Number(hourFmt.format(new Date(ts))); } catch(e){ return new Date(ts).getHours(); } }
function fmtDT(ts){ try { return new Date(ts).toLocaleString('pt-BR',{timeZone:TZ}); } catch(e){ return String(ts); } }
function fmtTime(ts){ try { return new Date(ts).toLocaleTimeString('pt-BR',{timeZone:TZ}); } catch(e){ return String(ts); } }
function fmtCardDT(ts){ try { const t=new Date(ts); const day=localDay(t), today=localDay(Date.now()), yest=localDay(Date.now()-86400000); const hora=fmtTime(t).slice(0,5); if(day===today) return 'hoje às '+hora; if(day===yest) return 'ontem às '+hora; return day.split('-').reverse().slice(0,2).join('/')+' às '+hora; } catch(e){ return fmtDT(ts); } }

// ===================== BACKUP DIARIO =====================
function doBackup(){
  try {
    const d = localDay(Date.now());
    const dest = path.join(BACKUP_DIR, 'events-' + d + '.db');
    fs.copyFileSync(DB_FILE, dest);
    const files = fs.readdirSync(BACKUP_DIR).filter(f=>f.startsWith('events-')&&f.endsWith('.db')).sort();
    while (files.length > 30) fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
    return path.basename(dest);
  } catch(e){ console.error('backup erro:', e.message); return null; }
}
setInterval(doBackup, 24*60*60*1000);
app.get('/backup', (req,res)=>{
  const f = doBackup();
  if (!f) return res.status(500).json({ok:false});
  res.json({ok:true, file:f});
});

// ===================== GRAFICO SVG (vendas pagas) =====================
function chartCard(title, inner){
  return '<div class="card chart-card"><h3>' + title + '</h3>' + inner + '</div>';
}
function salesChart(){
  const rows = db.prepare("SELECT ts FROM events WHERE evento='venda.paga'").all();
  const byDay = {}, byHour = {};
  const now = new Date();
  for (let i=13;i>=0;i--){ const d=new Date(now.getTime() - i*86400000); byDay[localDay(d)]=0; }
  for (let h=0;h<24;h++) byHour[h]=0;
  const todayKey = localDay(now);
  for (const r of rows){
    const t = new Date(r.ts);
    const day = localDay(r.ts);
    if (day in byDay) byDay[day]++;
    if (day===todayKey) byHour[localHour(r.ts)]++;
  }
  const W=1010,PAD=8,BW=(W-2*PAD)/14-8;
  const H=170,maxD=Math.max(1,...Object.values(byDay));
  let svgD = '';
  Object.entries(byDay).forEach(([day,cnt],i)=>{
    const h=(H-40)*cnt/maxD, x=PAD+i*(BW+8), y=H-28-h;
    svgD += '<rect x="'+x+'" y="'+y+'" width="'+BW+'" height="'+Math.max(h,cnt?2:0)+'" rx="3" fill="#d4a53f"><title>'+day+': '+cnt+'</title></rect>';
    if (cnt) svgD += '<text x="'+(x+BW/2)+'" y="'+(y-4)+'" font-size="10" fill="#a8b0a0" text-anchor="middle">'+cnt+'</text>';
    svgD += '<text x="'+(x+BW/2)+'" y="'+(H-12)+'" font-size="10" fill="#8f9c8f" text-anchor="middle">'+day.slice(5)+'</text>';
  });
  const svgDay = '<svg width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Vendas por dia">'+svgD+'</svg>';
  const HH=150,bw=(W-2*PAD)/24-3,maxH=Math.max(1,...Object.values(byHour));
  let svgH = '';
  Object.entries(byHour).forEach(([hr,cnt],i)=>{
    const h=(HH-40)*cnt/maxH, x=PAD+i*(bw+3), y=HH-28-h;
    svgH += '<rect x="'+x+'" y="'+y+'" width="'+bw+'" height="'+Math.max(h,cnt?2:0)+'" rx="2" fill="#d4a53f"><title>'+hr+'h: '+cnt+'</title></rect>';
    if (cnt) svgH += '<text x="'+(x+bw/2)+'" y="'+(y-4)+'" font-size="10" fill="#a8b0a0" text-anchor="middle">'+cnt+'</text>';
    if (hr%3===0) svgH += '<text x="'+(x+bw/2)+'" y="'+(HH-10)+'" font-size="10" fill="#8f9c8f" text-anchor="middle">'+hr+'h</text>';
  });
  const svgHour = '<svg width="'+W+'" height="'+HH+'" viewBox="0 0 '+W+' '+HH+'" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Vendas por hora (hoje)">'+svgH+'</svg>';
  return chartCard('Vendas por dia (14 dias)', svgDay) + chartCard('Vendas por hora (hoje)', svgHour);
}

function startOfToday(){ return Date.parse(localDay(Date.now()) + 'T00:00:00-03:00'); } // meia-noite America/Fortaleza (UTC-3, sem DST)
function fmtBRL(centavos, moeda){
  const cur = moeda || 'BRL';
  try { return (centavos/100).toLocaleString('pt-BR',{style:'currency',currency:cur}); } catch(e){ return 'R$ ' + (centavos/100).toFixed(2); }
}

// ===================== PAINEL LEGACY (design pass: grid, ritmo, hierarquia) =====================
const PAGE = `<!doctype html><html lang=pt-BR><head><meta charset=utf-8><title>LEGACY · Painel de Vendas</title><meta name=viewport content="width=device-width,initial-scale=1"><style>
:root{--gold:#d4a53f;--gold2:#eecf7e;--bg:#17251d;--card:#213629;--line:rgba(212,165,63,.25);--txt:#f7f3e9;--mut:#a8b0a0}
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;margin:0;background:var(--bg);color:var(--txt);font-size:14px;line-height:1.5}
.wrap{max-width:1100px;margin:0 auto;padding:0 24px}
header{border-bottom:1px solid var(--line);padding:24px 0 16px}
.htop{display:flex;align-items:baseline;gap:16px;flex-wrap:wrap}
h1{margin:0;font-size:28px;font-weight:800;letter-spacing:5px;color:var(--gold2)}
.sub{font-size:14px;color:var(--mut)}
.live{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--mut)}
.dot{width:8px;height:8px;border-radius:50%;background:#39d98a}
.clock{font-variant-numeric:tabular-nums;color:var(--mut)}
.sair{color:var(--mut);font-size:12px;text-decoration:none;margin-left:8px}
.sair:hover{color:var(--gold2)}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:24px 0 8px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 20px;box-shadow:0 1px 3px rgba(0,0,0,.35)}
.kpi .lbl{font-size:12px;color:var(--mut)}
.kpi .val{font-size:28px;font-weight:700;margin-top:4px;color:var(--txt);line-height:1.2}
.kpi .sub{font-size:12px;color:var(--mut);margin-top:2px}
.bar{display:flex;gap:16px;align-items:center;padding:24px 0 16px}
.filters{display:flex;gap:8px}
.filters a{padding:8px 14px;border-radius:8px;border:1px solid var(--line);color:var(--gold2);text-decoration:none;font-size:13px;line-height:1.4}
.filters a:hover{background:rgba(212,165,63,.1)}
.filters a.on{background:var(--gold);color:#1a1033;font-weight:600;border-color:var(--gold)}
#q{flex:1;min-width:200px;background:var(--card);border:1px solid var(--line);color:var(--txt);border-radius:8px;padding:8px 12px;font-size:14px;line-height:1.4;outline:none}
#q:focus{border-color:var(--gold)}
.btn-csv{padding:8px 14px;border-radius:8px;border:1px solid var(--line);color:var(--gold2);text-decoration:none;font-size:13px;line-height:1.4;white-space:nowrap}
.btn-csv:hover{background:rgba(212,165,63,.1)}
.charts{display:grid;gap:16px;padding-bottom:8px}
.chart-card h3{margin:0 0 12px;font-size:16px;font-weight:600;color:var(--txt)}
.chart-card svg{width:100%;height:auto;display:block}
#feed{padding:16px 0 40px}
.ev{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.35)}
.ev .meta{color:var(--mut);font-size:12px;margin-bottom:8px}
.ev .fields{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.f{font-size:14px}
.f .who{font-weight:600}
.f .prod{color:var(--mut);font-size:13px}
.f a{color:var(--gold2);text-decoration:none}
.badge{padding:2px 8px;border-radius:6px;font-size:12px;font-weight:600}
.b-gold{background:rgba(212,165,63,.15);color:var(--gold2);border:1px solid var(--line)}
.b-orange{background:rgba(205,137,0,.15);color:#ffc46b;border:1px solid rgba(205,137,0,.35)}
.b-gray{background:rgba(255,255,255,.05);color:var(--mut);border:1px solid rgba(255,255,255,.1)}
.hl{margin-top:8px;font-size:16px;font-weight:600;color:var(--gold2)}
.btn{display:inline-block;margin-top:8px;background:var(--gold);color:#1a1033;font-weight:600;padding:8px 16px;border-radius:8px;text-decoration:none;font-size:13px}
.chartbar{display:flex;padding:12px 0 0}
.btn-charts{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;border:1px solid var(--line);color:var(--gold2);text-decoration:none;font-size:13px;cursor:pointer;background:transparent;line-height:1.4}
.btn-charts:hover{background:rgba(212,165,63,.1)}
.btn-charts.on{background:var(--gold);color:#1a1033;font-weight:600;border-color:var(--gold)}
.charts{position:fixed;top:64px;left:50%;transform:translateX(-50%);width:min(1060px,94vw);max-height:78vh;overflow:auto;z-index:60;display:none;background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:16px 20px;box-shadow:0 12px 40px rgba(0,0,0,.6)}
.charts.open{display:grid;gap:16px}
.charts-head{display:flex;align-items:center;justify-content:space-between;margin:0 0 4px}
.charts-head h3{margin:0;font-size:16px;color:var(--gold2)}
.btn-close{padding:6px 12px;border-radius:8px;border:1px solid var(--line);background:var(--gold);color:#1a1033;font-weight:600;font-size:13px;cursor:pointer;text-decoration:none;line-height:1.4}
@media(max-width:640px){.charts.open{inset:0;top:0;left:0;transform:none;width:100%;max-height:100%;border-radius:0;padding:12px 16px}}
.btn:hover{filter:brightness(1.08)}
details{margin-top:8px}summary{cursor:pointer;color:var(--mut);font-size:12px}pre{margin:8px 0 0;white-space:pre-wrap;word-break:break-all;font-size:12px;color:#cfd8c6;background:#122019;border-radius:8px;padding:12px}
.empty{color:var(--mut);text-align:center;padding:40px 0;font-size:14px}
@media(max-width:900px){.kpis{grid-template-columns:repeat(2,1fr)}}
@media(max-width:640px){
.wrap{padding:0 16px}
.htop{gap:8px}h1{font-size:20px;letter-spacing:3px}
.kpis{gap:8px;padding:16px 0 8px}
.bar{flex-direction:column;align-items:stretch;gap:8px}
#q{min-width:0}
.charts{gap:8px}
.ev{padding:12px 16px;margin-bottom:8px}
}
</style></head><body>
<header><div class=wrap><div class=htop><h1>LEGACY</h1><span class=sub>Painel de Vendas</span><div class=live><span class=dot></span>ao vivo<span class=clock id=clock>--:--:--</span><form action=/logout method=post style=display:none id=lo></form><a class=sair href="#" onclick="document.getElementById('lo').submit();return false">sair</a></div></div></div></header>
<div class=wrap>
<div class=kpis>
<div class="card kpi"><div class=lbl>Faturamento hoje</div><div class=val>__FAT__</div><div class=sub>__PGD__ vendas pagas</div></div>
<div class="card kpi"><div class=lbl>Vendas pagas hoje</div><div class=val>__PGD__</div><div class=sub>__PGT__ no total</div></div>
<div class="card kpi"><div class=lbl>Carrinhos abandonados hoje</div><div class=val>__CRD__</div><div class=sub>__CRT__ no total</div></div>
<div class="card kpi"><div class=lbl>Eventos hoje</div><div class=val>__TTD__</div><div class=sub>__TOT__ no total</div></div>
</div>
<div class=chartbar><a id=btn-charts class=btn-charts href=#>📈 Gráficos · __CHARTMINI__</a></div>
<div class=bar>
<div class=filters><a href="/?evento=todos" class="__C0__">Todos</a><a href="/?evento=venda.paga" class="__C1__">Pagas</a><a href="/?evento=carrinho.abandonado" class="__C2__">Abandonados</a></div>
<input id=q placeholder="Buscar por nome, whatsapp ou produto…" oninput="fltr()">
<a class=btn-csv href="/export.csv?evento=__EVENC__">Exportar CSV</a>
</div>
<div id=feed>__FEED__</div>
<div class=charts id=charts-drawer><div class=charts-head><h3>📈 Gráficos</h3><a id=charts-close class=btn-close href=#>✕ Fechar</a></div>__CHART__</div>
</div>
<script>
function nowClock(){return new Date().toLocaleTimeString('pt-BR',{timeZone:'America/Fortaleza'})}
setInterval(function(){var c=document.getElementById('clock');if(c)c.textContent=nowClock()},1000);
(function(){var c=document.getElementById('clock');if(c)c.textContent=nowClock()})();
const qi=document.getElementById('q');qi.value=sessionStorage.getItem('legacy_q')||'';
function fltr(){const q=qi.value.toLowerCase();sessionStorage.setItem('legacy_q',q);document.querySelectorAll('.ev').forEach(el=>{el.style.display=el.dataset.s.includes(q)?'':'none'})}
fltr();
(function(){
var drawer=document.getElementById('charts-drawer'),btnC=document.getElementById('btn-charts');
function applyCharts(){var open=sessionStorage.getItem('legacy_charts')==='1';drawer.classList.toggle('open',open);btnC.classList.toggle('on',open);}
btnC.addEventListener('click',function(e){e.preventDefault();sessionStorage.setItem('legacy_charts',sessionStorage.getItem('legacy_charts')==='1'?'0':'1');applyCharts();});
document.getElementById('charts-close').addEventListener('click',function(e){e.preventDefault();sessionStorage.setItem('legacy_charts','0');applyCharts();});
applyCharts();
})();
setTimeout(()=>{location.href=location.pathname+(location.search||'')},15000);
</script></body></html>`;

app.get('/', (req,res)=>{
  const filtro = req.query.evento || 'todos';
  const all = allRows().slice(-5000).map(rowToEvent);
  const t0 = startOfToday();
  const evo = all.filter(e=>!e.dedup && e.body && e.body.webhook_evento);
  const fatHoje = evo.filter(e=>e.body.webhook_evento==='venda.paga' && new Date(e.ts).getTime()>=t0)
    .reduce((s,e)=> s + (Number(e.body.carrinho && e.body.carrinho.total_venda) || Number(e.body.valor) || 0), 0);
  const stats = {
    fatHoje: fmtBRL(fatHoje),
    pagasDia: evo.filter(e=>e.body.webhook_evento==='venda.paga' && new Date(e.ts).getTime()>=t0).length,
    pagasTotal: evo.filter(e=>e.body.webhook_evento==='venda.paga').length,
    carrDia: evo.filter(e=>e.body.webhook_evento==='carrinho.abandonado' && new Date(e.ts).getTime()>=t0).length,
    carrTotal: evo.filter(e=>e.body.webhook_evento==='carrinho.abandonado').length,
    totalDia: all.filter(e=>!e.dedup && new Date(e.ts).getTime()>=t0).length,
    total: all.filter(e=>!e.dedup).length
  };
  let a = all.slice(-300).reverse();
  if (filtro==='venda.paga' || filtro==='carrinho.abandonado') a = a.filter(e=>e.body && e.body.webhook_evento===filtro);

  const card = (e)=>{
    const b = e.body || {};
    if (!b.webhook_evento){
      return '<div class=ev data-s="'+esc(JSON.stringify(b).toLowerCase())+'"><div class=meta>#'+esc(e.id)+' · <b>'+esc(e.origem)+'</b> · '+fmtCardDT(e.ts)+'</div><details><summary>payload</summary><pre>'+esc(JSON.stringify(b,null,2))+'</pre></details></div>';
    }
    const cli = b.cliente || {}, prod = b.produto || {}, venda = b.venda || {}, c = b.carrinho || {};
    const hora = fmtTime(e.ts);
    const badge = b.webhook_evento==='venda.paga' ? '<span class="badge b-gold">✅ venda.paga</span>'
      : b.webhook_evento==='carrinho.abandonado' ? '<span class="badge b-orange">🛒 carrinho.abandonado</span>'
      : '<span class="badge b-gray">'+esc(b.webhook_evento)+'</span>';
    const wa = cli.whatsapp ? String(cli.whatsapp).replace(/\D/g,'') : '';
    const waLink = wa ? '<a href="https://wa.me/'+esc(wa)+'" target=_blank rel=noopener>📱 '+esc(cli.whatsapp)+'</a>' : (cli.whatsapp? '📱 '+esc(cli.whatsapp):'');
    let extra = '';
    if (b.webhook_evento === 'venda.paga'){
      const v = Number(c.total_venda) || Number(b.valor);
      if (v) extra += '<div class=hl>💰 '+fmtBRL(v, c.moeda)+'</div>';
    }
    if (b.webhook_evento === 'carrinho.abandonado'){
      const mins = c.criado_em ? Math.max(0,Math.floor((Date.now()-new Date(c.criado_em).getTime())/60000)) : null;
      if (c.total_venda) extra += '<div class=hl>💰 '+fmtBRL(c.total_venda, c.moeda)+(mins!=null?' · há '+mins+' min':'')+'</div>';
      else if (mins!=null) extra += '<div class=hl>há '+mins+' min</div>';
      if (c.link_recuperacao) extra += '<a class=btn href="'+esc(c.link_recuperacao)+'" target=_blank rel=noopener>🔗 Recuperar</a>';
    }
    const searchable = JSON.stringify([cli.nome,cli.whatsapp,prod.nome]).toLowerCase();
    return '<div class=ev data-s="'+esc(searchable)+'"><div class=meta>#'+esc(e.id)+' · 🕒 <span title="'+esc(fmtDT(e.ts))+'">'+fmtCardDT(e.ts)+'</span></div>'
      + '<div class=fields>'+badge
      + (cli.nome?' <span class="f who">👤 '+esc(cli.nome)+'</span>':'')
      + (cli.whatsapp?' <span class=f>'+waLink+'</span>':'')
      + (prod.nome?' <span class="f prod">📦 '+esc(prod.nome)+'</span>':'')
      + (venda.forma_pagamento?' <span class="f prod">💳 '+esc(venda.forma_pagamento)+'</span>':'')
      + '</div>' + extra
      + '<details><summary>payload</summary><pre>'+esc(JSON.stringify(b,null,2))+'</pre></details></div>';
  };

  const feed = a.map(card).join('') || '<div class=empty>Nenhum evento ainda. Faça um POST em /hook/teste.</div>';
  const cls = f => (filtro===f?'on':'');
  let out = PAGE
    .replace('__FAT__', stats.fatHoje)
    .replace(/__PGD__/g, stats.pagasDia).replace('__PGT__', stats.pagasTotal)
    .replace('__CRD__', stats.carrDia).replace('__CRT__', stats.carrTotal)
    .replace('__TOT__', stats.total).replace('__TTD__', stats.totalDia)
    .replace('__C0__', cls('todos')).replace('__C1__', cls('venda.paga')).replace('__C2__', cls('carrinho.abandonado'))
    .replace('__EVENC__', encodeURIComponent(filtro))
    .replace('__CHARTMINI__', stats.pagasDia + (stats.pagasDia===1 ? ' venda hoje' : ' vendas hoje'))
    .replace('__CHART__', salesChart())
    .replace('__FEED__', feed);
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.send(out);
});
app.listen(3210, ()=>console.log('Hook collector Legacy on :3210 (SQLite)'));
