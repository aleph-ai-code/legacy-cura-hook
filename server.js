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
const SCHEMA = [
'CREATE TABLE IF NOT EXISTS events (',
'  id TEXT PRIMARY KEY,',
'  origem TEXT NOT NULL,',
'  evento TEXT,',
'  venda_id TEXT,',
'  ts TEXT NOT NULL,',
'  json TEXT NOT NULL,',
'  dedup_key TEXT',
');',
'CREATE INDEX IF NOT EXISTS idx_events_evento_ts ON events(evento, ts);',
'CREATE INDEX IF NOT EXISTS idx_events_origem ON events(origem);',
'CREATE TABLE IF NOT EXISTS users (',
'  id INTEGER PRIMARY KEY AUTOINCREMENT,',
'  nome TEXT UNIQUE NOT NULL,',
'  pin_hash TEXT NOT NULL,',
"  salt TEXT NOT NULL DEFAULT '',",
"  status TEXT NOT NULL DEFAULT 'ativo',",
"  role TEXT NOT NULL DEFAULT 'membro',",
'  criado_em TEXT NOT NULL',
');',
'CREATE TABLE IF NOT EXISTS acoes (',
'  id INTEGER PRIMARY KEY AUTOINCREMENT,',
'  event_id TEXT NOT NULL,',
'  user_nome TEXT NOT NULL,',
'  acao TEXT NOT NULL,',
'  detalhe TEXT,',
'  ts TEXT NOT NULL',
');',
'CREATE INDEX IF NOT EXISTS idx_acoes_event ON acoes(event_id, acao);',
'CREATE TABLE IF NOT EXISTS auditoria (',
'  id INTEGER PRIMARY KEY AUTOINCREMENT,',
'  ts TEXT NOT NULL,',
'  usuario TEXT,',
'  acao TEXT NOT NULL,',
'  sobre TEXT,',
'  detalhe TEXT',
');',
'CREATE INDEX IF NOT EXISTS idx_auditoria_ts ON auditoria(ts);',
].join('\n');
db.exec(SCHEMA);
try { db.exec("ALTER TABLE users ADD COLUMN salt TEXT NOT NULL DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'ativo'"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'membro'"); } catch(e) {}
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

// ===================== USUARIOS + LOGIN (nome + PIN) =====================
const PAINEL_PASSWORD = process.env.PAINEL_PASSWORD || 'L3g@cy';
const AUTH_SECRET = process.env.PAINEL_SECRET || 'legacy-painel-secret-v1';
const AUTH_COOKIE = 'painel_auth';
function hashPin(pin, salt){ return crypto.scryptSync(String(pin), salt, 64).toString('hex'); }
function makePinHash(pin){ const salt = crypto.randomBytes(16).toString('hex'); return salt + ':' + hashPin(pin, salt); }
function checkPin(pin, stored){ try { const parts = String(stored).split(':'); const h = hashPin(pin, parts[0]); return !!parts[1] && crypto.timingSafeEqual(Buffer.from(h,'hex'), Buffer.from(parts[1],'hex')); } catch(e){ return false; } }
function safeEq(a,b){ const A=Buffer.from(String(a==null?'':a)), B=Buffer.from(String(b==null?'':b)); return A.length===B.length && crypto.timingSafeEqual(A,B); }
const usersCount = () => db.prepare('SELECT COUNT(*) c FROM users').get().c;
function logAud(usuario, acao, sobre, detalhe){ try { db.prepare('INSERT INTO auditoria (ts, usuario, acao, sobre, detalhe) VALUES (?,?,?,?,?)').run(new Date().toISOString(), usuario==null?null:String(usuario), String(acao), sobre==null?null:String(sobre).slice(0,200), detalhe==null?null:String(detalhe).slice(0,500)); } catch(e){ console.error('auditoria:', e.message); } }
function adminCountExcept(nome){ return db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin' AND nome != ?").get(nome).c; }

function sign(payload){ return crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex'); }
function makeToken(user){
  const exp = Date.now() + 30*24*3600*1000;
  const payload = Buffer.from(JSON.stringify({ id: user.id, nome: user.nome, exp })).toString('base64url');
  return payload + '.' + sign(payload);
}
function parseToken(tok){
  try {
    const s = String(tok);
    const idx = s.indexOf('.');
    if (idx < 0) return null;
    const payload = s.slice(0, idx), sig = s.slice(idx+1);
    if (!safeEq(sig, sign(payload))) return null;
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!d.exp || d.exp < Date.now()) return null;
  const u = db.prepare('SELECT id, nome, status, role FROM users WHERE id=?').get(d.id);
  return (u && u.nome === d.nome && u.status === 'ativo') ? u : null;
  } catch(e){ return null; }
}
function getAuth(req){
  const re = new RegExp('(?:^|;\\s*)' + AUTH_COOKIE + '=([A-Za-z0-9_.-]+)');
  const m = re.exec(req.headers.cookie || '');
  return m ? parseToken(m[1]) : null;
}

function inputCss(){
  return 'input{width:100%;padding:8px 12px;border-radius:8px;border:1px solid rgba(212,165,63,.4);background:#17251d;color:#f7f3e9;font-size:14px;outline:none;box-sizing:border-box;text-align:center;line-height:1.4}' +
  'input:focus{border-color:#d4a53f}' +
  'button{margin-top:16px;width:100%;padding:8px;border:0;border-radius:8px;background:#d4a53f;color:#1a1033;font-weight:600;font-size:14px;cursor:pointer;line-height:1.4}' +
  'button:hover{filter:brightness(1.08)}' +
  '.err{color:#e08a8a;font-size:12px;margin-top:12px;min-height:14px}' +
  '.alt{margin-top:24px;border-top:1px solid rgba(212,165,63,.25);padding-top:20px}' +
  '.alt h2{font-size:13px;color:#eecf7e;margin:0 0 12px;letter-spacing:1px;font-weight:600}' +
  '.hint{color:#a8b0a0;font-size:11px;margin-top:6px}';
}
function pageShell(title, inner){
  return '<!doctype html><html lang=pt-BR><head><meta charset=utf-8><title>LEGACY · ' + title + '</title><meta name=viewport content="width=device-width,initial-scale=1"><style>' +
  'body{font-family:system-ui,-apple-system,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#17251d;color:#f7f3e9;line-height:1.5}' +
  '.card{background:#213629;border:1px solid rgba(212,165,63,.45);border-radius:14px;padding:32px;box-shadow:0 4px 16px rgba(0,0,0,.4);text-align:center;min-width:320px;max-width:360px}' +
  'h1{font-size:28px;font-weight:800;letter-spacing:5px;margin:0 0 4px;color:#eecf7e}' +
  'p{color:#a8b0a0;font-size:12px;margin:0 0 24px;letter-spacing:1px}' + inputCss() +
  '</style></head><body><div class=card><h1>LEGACY</h1><p>Acesso restrito</p>' + inner + '</div></body></html>';
}
// Primeiro acesso: criar admin. Depois: entrar ou 'Sou novo aqui' com PIN-admin.
function loginPage(err, mode){
  mode = mode || (usersCount() === 0 ? 'criar' : 'login');
  if (mode === 'criar'){
    return pageShell('Criar acesso',
      '<p>Primeiro acesso · crie seu acesso</p>' +
      '<form method=post action=/login/criar>' +
      '<input type=text name=nome placeholder="Seu nome" autofocus required maxlength=60>' +
      '<input type=password name=pin placeholder="PIN (6 dígitos)" required inputmode=numeric maxlength=6 style="margin-top:12px">' +
      '<button>Criar meu acesso</button><div class=err>' + (err ? 'Nome já existe ou PIN inválido (6 dígitos).' : '') + '</div></form>');
  }
  return pageShell('Acesso restrito',
    '<form method=post action=/login>' +
    '<input type=text name=nome placeholder="Nome" autofocus required maxlength=60>' +
    '<input type=password name=pin placeholder="PIN (6 dígitos)" required inputmode=numeric maxlength=6 style="margin-top:12px">' +
    '<button>Entrar</button><div class=err>' + (err==='login' ? 'Nome ou PIN incorretos.' : (err==='novo' ? 'Não foi possível criar o acesso (nome em uso ou PIN inválido).' : (err==='admin' ? 'PIN de administrador incorreto.' : (err==='pendente' ? 'Cadastro aguardando aprovação do admin.' : (err==='existe' ? 'Nome já existe ou PIN inválido (6 dígitos).' : (err==='ok' ? 'Cadastro criado! Aguarde a aprovação do admin.' : (err==='bloqueado' ? 'Acesso bloqueado. Fale com o administrador.' : ''))))))) + '</div></form>' +
    '<div class=alt><h2>SOU NOVO AQUI</h2>' +
    '<form method=post action=/login/novo>' +
    '<input type=text name=nome placeholder="Seu nome" required maxlength=60>' +
    '<input type=password name=pin placeholder="PIN (6 dígitos)" required inputmode=numeric maxlength=6 style="margin-top:12px">' +
    '<button>Criar acesso</button><div class=hint>Seu cadastro ficará aguardando aprovação do admin.</div></form></div>');
}
// Middleware: tudo exige cookie, EXCETO webhook (EVO não autentica) e login/logout
app.use((req,res,next)=>{
  if (req.path.startsWith('/hook/')) return next();
  if (req.method==='POST' && (req.path==='/login' || req.path==='/login/criar' || req.path==='/login/novo' || req.path==='/logout')) return next();
  if (req.path==='/favicon.ico') return res.status(404).end();
  const user = getAuth(req);
  if (user){ req.user = user; return next(); }
  if (req.path.startsWith('/api/')) return res.status(401).json({ok:false, erro:'nao_autenticado'});
  const errMap = { '1':'login', 'novo':'novo', 'admin':'admin', 'criar':'criar', 'pendente':'pendente', 'existe':'existe', 'ok':'ok', 'bloqueado':'bloqueado' };
  res.status(200).setHeader('Content-Type','text/html; charset=utf-8');
  return res.send(loginPage(errMap[req.query && req.query.erro] || '', req.query && req.query.modo === 'criar' ? 'criar' : undefined));
});
function setAuthCookie(res, user){ res.setHeader('Set-Cookie', AUTH_COOKIE + '=' + makeToken(user) + '; Max-Age=2592000; HttpOnly; Path=/'); }
function formFields(req){
  const raw = typeof req.body === 'string' ? req.body : (req.body && typeof req.body === 'object' ? req.body : {});
  if (typeof raw === 'string'){ try { const p = new URLSearchParams(raw); return { nome: p.get('nome')||'', pin: p.get('pin')||'', pin_admin: p.get('pin_admin')||'' }; } catch(e){ return { nome:'', pin:'', pin_admin:'' }; } }
  return { nome: raw.nome||'', pin: raw.pin||'', pin_admin: raw.pin_admin||'' };
}
app.post('/login', (req,res)=>{
  const f = formFields(req);
  const nomeL = String(f.nome||'').trim();
  const u = db.prepare('SELECT * FROM users WHERE nome = ?').get(nomeL);
  if (u && u.status === 'pendente') return res.redirect(302, '/?erro=pendente');
  if (u && u.status === 'bloqueado'){ logAud(nomeL, 'login_bloqueado', nomeL); return res.redirect(302, '/?erro=bloqueado'); }
  if (u && u.status === 'ativo' && checkPin(f.pin, u.pin_hash)){ logAud(nomeL, 'login_ok', nomeL); setAuthCookie(res, u); return res.redirect(302, '/'); }
  logAud(nomeL, 'login_falho', nomeL);
  return res.redirect(302, '/?erro=1');
});
app.post('/login/criar', (req,res)=>{
  const f = formFields(req);
  const nome = String(f.nome||'').trim();
  if (usersCount() > 0 || !nome || !/^\d{6}$/.test(f.pin)) return res.redirect(302, '/?erro=1&modo=criar');
  try {
    const stored = makePinHash(f.pin); const info = db.prepare("INSERT INTO users (nome, pin_hash, salt, status, role, criado_em) VALUES (?,?,?,?,?,?)").run(nome, stored, stored.split(':')[0], 'ativo', 'admin', new Date().toISOString());
    logAud(nome, 'cadastro_criado', nome, 'primeiro acesso (admin)');
    setAuthCookie(res, { id: info.lastInsertRowid, nome });
    return res.redirect(302, '/');
  } catch(e){ return res.redirect(302, '/?erro=1&modo=criar'); }
});
app.post('/login/novo', (req,res)=>{
  const f = formFields(req);
  const nome = String(f.nome||'').trim();
  if (!nome || !/^\d{6}$/.test(f.pin)) return res.redirect(302, '/?erro=existe');
  try {
    const stored = makePinHash(f.pin);
    db.prepare("INSERT INTO users (nome, pin_hash, salt, status, role, criado_em) VALUES (?,?,?,?,?,?)").run(nome, stored, stored.split(':')[0], 'pendente', 'membro', new Date().toISOString());
    logAud(nome, 'cadastro_criado', nome, 'aguardando aprovacao');
    return res.redirect(302, '/?erro=ok');
  } catch(e){ return res.redirect(302, '/?erro=existe'); }
});

// ===================== ADMIN: aprovacao de cadastros =====================
function requireAdmin(req,res){ if (!req.user || req.user.role !== 'admin'){ res.status(403).json({ok:false, erro:'restrito_admin'}); return false; } return true; }
const pendentesCount = () => db.prepare("SELECT COUNT(*) c FROM users WHERE status='pendente'").get().c;
app.post('/admin/aprovar', (req,res)=>{
  if (!requireAdmin(req,res)) return;
  const nome = String((req.body||{}).nome||'').trim();
  const u = db.prepare("SELECT * FROM users WHERE nome=? AND status='pendente'").get(nome);
  if (!u) return res.status(404).json({ok:false, erro:'cadastro_nao_encontrado'});
  db.prepare("UPDATE users SET status='ativo' WHERE id=?").run(u.id);
  db.prepare('INSERT INTO acoes (event_id, user_nome, acao, detalhe, ts) VALUES (?,?,?,?,?)').run('cadastro', req.user.nome, 'aprovar_cadastro', nome, new Date().toISOString());
  logAud(req.user.nome, 'aprovado', nome);
  res.json({ok:true});
});
app.post('/admin/rejeitar', (req,res)=>{
  if (!requireAdmin(req,res)) return;
  const nome = String((req.body||{}).nome||'').trim();
  const u = db.prepare("SELECT * FROM users WHERE nome=? AND status='pendente'").get(nome);
  if (!u) return res.status(404).json({ok:false, erro:'cadastro_nao_encontrado'});
  db.prepare('DELETE FROM users WHERE id=?').run(u.id);
  db.prepare('INSERT INTO acoes (event_id, user_nome, acao, detalhe, ts) VALUES (?,?,?,?,?)').run('cadastro', req.user.nome, 'rejeitar_cadastro', nome, new Date().toISOString());
  logAud(req.user.nome, 'rejeitado', nome);
  res.json({ok:true});
});
app.post('/admin/editar_nome', (req,res)=>{
  if (!requireAdmin(req,res)) return;
  const b = req.body||{};
  const nome = String(b.nome||'').trim(), novo = String(b.novo_nome||'').trim();
  if (!nome || !novo || nome===novo) return res.status(400).json({ok:false, erro:'parametros_invalidos'});
  const u = db.prepare('SELECT * FROM users WHERE nome=?').get(nome);
  if (!u) return res.status(404).json({ok:false, erro:'usuario_nao_encontrado'});
  if (db.prepare('SELECT 1 FROM users WHERE nome=?').get(novo)) return res.status(409).json({ok:false, erro:'nome_ja_existe'});
  db.prepare('UPDATE users SET nome=? WHERE id=?').run(novo, u.id);
  logAud(req.user.nome, 'nome_editado', nome, 'novo nome: ' + novo);
  res.json({ok:true});
});
app.post('/admin/resetar_pin', (req,res)=>{
  if (!requireAdmin(req,res)) return;
  const nome = String((req.body||{}).nome||'').trim();
  const u = db.prepare('SELECT * FROM users WHERE nome=?').get(nome);
  if (!u) return res.status(404).json({ok:false, erro:'usuario_nao_encontrado'});
  const pin = String(Math.floor(100000 + Math.random()*900000));
  const stored = makePinHash(pin);
  db.prepare('UPDATE users SET pin_hash=?, salt=? WHERE id=?').run(stored, stored.split(':')[0], u.id);
  logAud(req.user.nome, 'pin_reset', nome);
  res.json({ok:true, pin});
});
app.post('/admin/bloquear', (req,res)=>{
  if (!requireAdmin(req,res)) return;
  const b = req.body||{}; const nome = String(b.nome||'').trim();
  const u = db.prepare('SELECT * FROM users WHERE nome=?').get(nome);
  if (!u) return res.status(404).json({ok:false, erro:'usuario_nao_encontrado'});
  const bloquear = !(b.bloquear === false || b.bloquear === 'false');
  if (bloquear){
    if (u.nome === req.user.nome) return res.status(403).json({ok:false, erro:'nao_pode_bloquear_a_si_mesmo'});
    if (u.role === 'admin' && adminCountExcept(nome) === 0) return res.status(403).json({ok:false, erro:'ultimo_admin'});
    db.prepare("UPDATE users SET status='bloqueado' WHERE id=?").run(u.id);
    logAud(req.user.nome, 'bloqueado', nome);
  } else {
    db.prepare("UPDATE users SET status='ativo' WHERE id=?").run(u.id);
    logAud(req.user.nome, 'desbloqueado', nome);
  }
  res.json({ok:true});
});
app.post('/admin/excluir', (req,res)=>{
  if (!requireAdmin(req,res)) return;
  const nome = String((req.body||{}).nome||'').trim();
  const u = db.prepare('SELECT * FROM users WHERE nome=?').get(nome);
  if (!u) return res.status(404).json({ok:false, erro:'usuario_nao_encontrado'});
  if (u.nome === req.user.nome) return res.status(403).json({ok:false, erro:'nao_pode_excluir_a_si_mesmo'});
  if (u.role === 'admin' && adminCountExcept(nome) === 0) return res.status(403).json({ok:false, erro:'ultimo_admin'});
  db.prepare('DELETE FROM users WHERE id=?').run(u.id);
  logAud(req.user.nome, 'excluido', nome);
  res.json({ok:true});
});
// Usuario troca o PROPRIO PIN (logado)
app.post('/me/trocar_pin', (req,res)=>{
  if (!requireUser(req,res)) return;
  const b = req.body || {};
  const atual = String(b.pin_atual||''), novo = String(b.pin_novo||'');
  if (!/^\d{6}$/.test(novo)) return res.status(400).json({ok:false, erro:'pin_invalido'});
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!u || !checkPin(atual, u.pin_hash)) return res.status(403).json({ok:false, erro:'pin_atual_incorreto'});
  const stored = makePinHash(novo);
  db.prepare('UPDATE users SET pin_hash=?, salt=? WHERE id=?').run(stored, stored.split(':')[0], u.id);
  logAud(u.nome, 'pin_trocado_proprio', u.nome);
  res.json({ok:true});
});

app.get('/auditoria', (req,res)=>{
  if (!requireAdmin(req,res)) return;
  const fUsuario = String(req.query.usuario||''), fTipo = String(req.query.tipo||'');
  let sql = 'SELECT * FROM auditoria WHERE 1=1'; const params=[];
  if (fUsuario){ sql += ' AND usuario=?'; params.push(fUsuario); }
  if (fTipo){ sql += ' AND acao=?'; params.push(fTipo); }
  sql += ' ORDER BY id DESC LIMIT 500';
  const rows = db.prepare(sql).all(...params);
  const usuarios = db.prepare('SELECT DISTINCT usuario FROM auditoria ORDER BY usuario').all().map(r=>r.usuario).filter(Boolean);
  const tipos = db.prepare('SELECT DISTINCT acao FROM auditoria ORDER BY acao').all().map(r=>r.acao);
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.send(auditoriaPage(rows, usuarios, tipos, fUsuario, fTipo));
});
app.get('/auditoria.csv', (req,res)=>{
  if (!requireAdmin(req,res)) return;
  const fUsuario = String(req.query.usuario||''), fTipo = String(req.query.tipo||'');
  let sql = 'SELECT * FROM auditoria WHERE 1=1'; const params=[];
  if (fUsuario){ sql += ' AND usuario=?'; params.push(fUsuario); }
  if (fTipo){ sql += ' AND acao=?'; params.push(fTipo); }
  sql += ' ORDER BY id ASC';
  const rows = db.prepare(sql).all(...params);
  const lines = ['data_hora_fortaleza,usuario,acao,sobre,detalhe'];
  for (const r of rows) lines.push([fmtDT(r.ts), r.usuario, r.acao, r.sobre, r.detalhe].map(csvField).join(','));
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="auditoria.csv"');
  res.send('\ufeff' + lines.join('\r\n'));
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

// ===================== API DE ACOES (modo operacao) =====================
const ACAO_VALIDA = new Set(['check_boasvindas','check_removido_vip','check_onboarding_ok','claim_carrinho','resultado_conquistou','resultado_nao','nota']);
function requireUser(req,res){ if (!req.user){ res.status(401).json({ok:false, erro:'nao_autenticado'}); return false; } return true; }
app.post('/api/acao', (req,res)=>{
  if (!requireUser(req,res)) return;
  const b = req.body || {};
  const eventId = String(b.event_id||'');
  if (!eventId || !ACAO_VALIDA.has(b.acao)) return res.status(400).json({ok:false, erro:'parametros_invalidos'});
  const exists = db.prepare('SELECT 1 FROM events WHERE id=?').get(eventId);
  if (!exists) return res.status(404).json({ok:false, erro:'evento_nao_encontrado'});
  const lastOfAcao = db.prepare('SELECT * FROM acoes WHERE event_id=? AND acao=? ORDER BY id DESC LIMIT 1').get(eventId, b.acao);
  if (b.acao === 'claim_carrinho'){
    if (lastOfAcao){
      if (lastOfAcao.user_nome !== req.user.nome) return res.status(403).json({ok:false, erro:'lead assumido por ' + lastOfAcao.user_nome, assumido_por: lastOfAcao.user_nome});
      return res.json({ok:true, assumido_por: req.user.nome});
    }
  }
  if (b.acao === 'resultado_conquistou' || b.acao === 'resultado_nao' || b.acao === 'nota'){
    const claim = db.prepare("SELECT * FROM acoes WHERE event_id=? AND acao='claim_carrinho' ORDER BY id DESC LIMIT 1").get(eventId);
    if (!claim) return res.status(403).json({ok:false, erro:'lead ainda nao assumido'});
    if (claim.user_nome !== req.user.nome) return res.status(403).json({ok:false, erro:'lead assumido por ' + claim.user_nome});
  }
  if (lastOfAcao && (b.acao === 'resultado_conquistou' || b.acao === 'resultado_nao')) return res.status(409).json({ok:false, erro:'resultado ja registrado (use toggle)'});
  db.prepare('INSERT INTO acoes (event_id, user_nome, acao, detalhe, ts) VALUES (?,?,?,?,?)')
    .run(eventId, req.user.nome, b.acao, b.detalhe ? String(b.detalhe).slice(0,500) : null, new Date().toISOString());
  logAud(req.user.nome, b.acao, eventId, b.detalhe || null);
  res.json({ok:true});
});
app.post('/api/acao/toggle', (req,res)=>{
  if (!requireUser(req,res)) return;
  const b = req.body || {};
  const eventId = String(b.event_id||'');
  if (!eventId || !ACAO_VALIDA.has(b.acao)) return res.status(400).json({ok:false, erro:'parametros_invalidos'});
  const last = db.prepare('SELECT id FROM acoes WHERE event_id=? AND acao=? ORDER BY id DESC LIMIT 1').get(eventId, b.acao);
  if (last){ db.prepare('DELETE FROM acoes WHERE id=?').run(last.id); return res.json({ok:true, removido:true}); }
  if (b.acao === 'claim_carrinho') return res.status(404).json({ok:false, erro:'nada_para_remover'});
  db.prepare('INSERT INTO acoes (event_id, user_nome, acao, detalhe, ts) VALUES (?,?,?,?,?)')
    .run(eventId, req.user.nome, b.acao, b.detalhe ? String(b.detalhe).slice(0,500) : null, new Date().toISOString());
  logAud(req.user.nome, b.acao, eventId, b.detalhe || null);
  return res.json({ok:true, marcado:true});
});

// Export CSV
function csvField(v){
  let sv = v==null ? '' : String(v);
  if (/[",\n\r]/.test(sv)) sv = '"' + sv.replace(/"/g,'""') + '"';
  return sv;
}
// Helpers de acoes por evento/venda
const CHECKS = ['check_boasvindas','check_removido_vip','check_onboarding_ok'];
function acoesForKeys(keys){
  const out = {};
  const stmt = db.prepare('SELECT * FROM acoes WHERE event_id=? ORDER BY id ASC');
  for (const k of keys){ if (k) out[k] = stmt.all(String(k)); }
  return out;
}
function lastOf(list, acao){ for (let i=list.length-1;i>=0;i--) if (list[i].acao===acao) return list[i]; return null; }
function onboardingInfo(list){
  const done = [];
  for (const c of CHECKS){ const a = lastOf(list, c); if (a) done.push(a); }
  const n = done.length;
  const status = n===0 ? '🟡 Pendente' : (n===3 ? '✅ Completo' : '🔵 Em processo');
  return { n, status, done };
}
app.get('/export.csv', (req,res)=>{
  const filtro = req.query.evento || 'todos';
  let a = allRows().map(rowToEvent);
  if (filtro==='venda.paga' || filtro==='carrinho.abandonado') a = a.filter(e=>e.body && e.body.webhook_evento===filtro);
  const keys = [];
  for (const e of a){ const v=(e.body&&e.body.venda)||{}; keys.push(e.id, v.id != null ? String(v.id) : null); }
  const amap = acoesForKeys(keys);
  const header = ['webhook_evento','venda.id','data','status','cliente.nome','cliente.cpf','cliente.email','cliente.whatsapp','produto.nome','valor','forma_pagamento','origem','link_recuperacao','onboarding_status','onboarding_por','carrinho_assumido_por','carrinho_resultado','ultima_acao_por'];
  const lines = [header.join(',')];
  for (const e of a){
    const b = e.body || {}, cli = b.cliente||{}, prod = b.produto||{}, v = b.venda||{}, c = b.carrinho||{};
    const valor = Number(c.total_venda) || Number(b.valor) || '';
    const list = amap[e.id] || (v.id != null ? amap[String(v.id)] : []) || [];
    const ob = onboardingInfo(list);
    const claim = lastOf(list, 'claim_carrinho');
    const rWin = lastOf(list, 'resultado_conquistou'), rLose = lastOf(list, 'resultado_nao');
    const resultado = rWin && (!rLose || rWin.id > rLose.id) ? 'conquistou' : (rLose && (!rWin || rLose.id > rWin.id) ? 'nao' : '');
    const ultima = list.length ? list[list.length-1].user_nome : '';
    lines.push([
      b.webhook_evento, v.id ?? v.uid ?? '', e.ts, v.status ?? b.status ?? '',
      cli.nome, cli.cpf ?? cli.documento, cli.email, cli.whatsapp ?? cli.telefone,
      prod.nome, valor, v.forma_pagamento ?? b.forma_pagamento, e.origem, c.link_recuperacao,
      b.webhook_evento==='venda.paga' ? ob.status : '',
      b.webhook_evento==='venda.paga' && ob.done.length ? ob.done.map(x=>x.user_nome).join(' / ') : '',
      claim ? claim.user_nome : '',
      resultado,
      ultima
    ].map(csvField).join(','));
  }
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="vendas-legacy.csv"');
  res.send('\ufeff' + lines.join('\r\n'));
});

// ===== Auditoria: descricao legivel + resumo do dia =====
const ACAO_TXT = {
  login_ok:['entrou no sistema',''], login_falho:['tentou entrar (PIN incorreto)',''], login_bloqueado:['tentou entrar (bloqueado)',''],
  cadastro_criado:['criou o cadastro',''], aprovado:['aprovou o cadastro de','nome'], rejeitado:['rejeitou o cadastro de','nome'],
  nome_editado:['editou o nome de','nome'], pin_reset:['resetou o PIN de','nome'], pin_trocado_proprio:['trocou o próprio PIN',''],
  bloqueado:['bloqueou','nome'], desbloqueado:['desbloqueou','nome'], excluido:['excluiu','nome'],
  check_boasvindas:['validou boas-vindas da venda','id'], check_removido_vip:['validou remoção do VIP da venda','id'], check_onboarding_ok:['validou onboarding da venda','id'],
  claim_carrinho:['assumiu o carrinho da venda','id'], resultado_conquistou:['✅ conquistou a venda','id'], resultado_nao:['❌ não conquistou a venda','id'], nota:['anotou na venda','id']
};
function auditDesc(r){
  const def = ACAO_TXT[r.acao];
  if (!def) return (r.usuario||'-') + ' · ' + r.acao + (r.sobre ? ' ('+r.sobre+')' : '') + (r.detalhe ? ' — '+r.detalhe : '');
  let s = (r.usuario||'-') + ' ' + def[0];
  if (def[1]==='id' && r.sobre) s += ' #' + r.sobre;
  else if (def[1]==='nome' && r.sobre) s += ' ' + r.sobre;
  if (r.acao==='nota' && r.detalhe) s += ': “' + r.detalhe + '”';
  return s;
}
function auditResumo(){
  const t0 = new Date(startOfToday()).toISOString();
  const m = {};
  for (const r of db.prepare('SELECT acao, COUNT(*) c FROM auditoria WHERE ts >= ? GROUP BY acao').all(t0)) m[r.acao]=r.c;
  const sum = keys => keys.reduce((s,k)=>s+(m[k]||0),0);
  return { logins: sum(['login_ok']), checks: sum(['check_boasvindas','check_removido_vip','check_onboarding_ok']), claims: sum(['claim_carrinho']), resultados: sum(['resultado_conquistou','resultado_nao']) };
}
function auditResumoHtml(){
  const r = auditResumo();
  const pl = (n,s)=> n===1 ? s : s+'s';
  return '<div style="margin:12px 0;padding:10px 14px;border-radius:10px;background:#213629;border:1px solid rgba(212,165,63,.25)">📌 <b>Hoje:</b> '+r.logins+' '+pl(r.logins,'login')+', '+r.checks+' '+pl(r.checks,'check')+' validado'+(r.checks===1?'':'s')+', '+r.claims+' carrinh'+(r.claims===1?'o':'os')+' assumid'+(r.claims===1?'o':'os')+', '+r.resultados+' resultado'+(r.resultados===1?'':'s')+'</div>';
}
function auditTableHtml(rows){
  const trs = rows.map(r=>'<tr><td>'+esc(auditDesc(r))+'</td><td style="color:#a8b0a0;white-space:nowrap">'+esc(fmtHHMM(r.ts))+'</td></tr>').join('');
  return '<table><tr><th>O que aconteceu</th><th style="width:70px">Hora</th></tr>' + (trs || '<tr><td colspan=2 style="color:#a8b0a0">Sem registros.</td></tr>') + '</table>';
}
function auditoriaPage(rows, usuarios, tipos, fUsuario, fTipo){
  const opt = (list, sel) => '<option value="">todos</option>' + list.map(v=>'<option'+(v===sel?' selected':'')+' value="'+esc(v)+'">'+esc(v)+'</option>').join('');
  return '<!doctype html><html lang=pt-BR><head><meta charset=utf-8><title>LEGACY · Auditoria</title><meta name=viewport content="width=device-width,initial-scale=1"><style>body{font-family:system-ui,sans-serif;margin:0;background:#17251d;color:#f7f3e9;font-size:13px;line-height:1.5}.wrap{max-width:1100px;margin:0 auto;padding:24px}h1{color:#eecf7e;letter-spacing:3px;font-size:22px;margin:0 0 8px}select,button{padding:6px 10px;border-radius:8px;border:1px solid rgba(212,165,63,.4);background:#17251d;color:#f7f3e9;cursor:pointer}button{background:#d4a53f;color:#1a1033;font-weight:600}table{width:100%;border-collapse:collapse;margin-top:16px}th{color:#a8b0a0;text-align:left;padding:6px 8px;border-bottom:1px solid rgba(212,165,63,.25)}td{padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.05)}a{color:#eecf7e}</style></head><body><div class=wrap><h1>📜 AUDITORIA</h1>' + auditResumoHtml() + '<p><a href="/">← voltar ao painel</a> · <a href="/auditoria.csv">⬇️ baixar CSV</a></p><form method=get style="margin-top:12px"><select name=usuario>'+opt(usuarios,fUsuario)+'</select> <select name=tipo>'+opt(tipos,fTipo)+'</select> <button>Filtrar</button></form>' + auditTableHtml(rows) + '</div></body></html>';
}

// ===================== TIMEZONE (exibicao em America/Fortaleza) =====================
const TZ = 'America/Fortaleza';
const dayFmt = new Intl.DateTimeFormat('en-CA', {timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit'}); // YYYY-MM-DD
const hourFmt = new Intl.DateTimeFormat('en-GB', {timeZone: TZ, hour:'numeric', hour12:false});
function localDay(ts){ try { return dayFmt.format(new Date(ts)); } catch(e){ return String(ts).slice(0,10); } }
function localHour(ts){ try { return Number(hourFmt.format(new Date(ts))); } catch(e){ return new Date(ts).getHours(); } }
function fmtDT(ts){ try { return new Date(ts).toLocaleString('pt-BR',{timeZone:TZ}); } catch(e){ return String(ts); } }
function fmtTime(ts){ try { return new Date(ts).toLocaleTimeString('pt-BR',{timeZone:TZ}); } catch(e){ return String(ts); } }
function fmtHHMM(ts){ try { return fmtTime(ts).slice(0,5); } catch(e){ return String(ts); } }
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
  Object.entries(byDay).forEach(function(en,i){
    const day=en[0], cnt=en[1];
    const h=(H-40)*cnt/maxD, x=PAD+i*(BW+8), y=H-28-h;
    svgD += '<rect x="'+x+'" y="'+y+'" width="'+BW+'" height="'+Math.max(h,cnt?2:0)+'" rx="3" fill="#d4a53f"><title>'+day+': '+cnt+'</title></rect>';
    if (cnt) svgD += '<text x="'+(x+BW/2)+'" y="'+(y-4)+'" font-size="10" fill="#a8b0a0" text-anchor="middle">'+cnt+'</text>';
    svgD += '<text x="'+(x+BW/2)+'" y="'+(H-12)+'" font-size="10" fill="#8f9c8f" text-anchor="middle">'+day.slice(5)+'</text>';
  });
  const svgDay = '<svg width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Vendas por dia">'+svgD+'</svg>';
  const HH=150,bw=(W-2*PAD)/24-3,maxH=Math.max(1,...Object.values(byHour));
  let svgH = '';
  Object.entries(byHour).forEach(function(en,i){
    const hr=en[0], cnt=en[1];
    const h=(HH-40)*cnt/maxH, x=PAD+i*(bw+3), y=HH-28-h;
    svgH += '<rect x="'+x+'" y="'+y+'" width="'+bw+'" height="'+Math.max(h,cnt?2:0)+'" rx="2" fill="#d4a53f"><title>'+hr+'h: '+cnt+'</title></rect>';
    if (cnt) svgH += '<text x="'+(x+bw/2)+'" y="'+(y-4)+'" font-size="10" fill="#a8b0a0" text-anchor="middle">'+cnt+'</text>';
    if (hr%3===0) svgH += '<text x="'+(x+bw/2)+'" y="'+(HH-10)+'" font-size="10" fill="#8f9c8f" text-anchor="middle">'+hr+'h</text>';
  });
  const svgHour = '<svg width="'+W+'" height="'+HH+'" viewBox="0 0 '+W+' '+HH+'" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Vendas por hora (hoje)">'+svgH+'</svg>';
  return chartCard('Vendas por dia (14 dias)', svgDay) + chartCard('Vendas por hora (hoje)', svgHour);
}
// Recuperação por pessoa (drawer)
function recoveryTable(){
  const claims = db.prepare("SELECT event_id, user_nome FROM acoes WHERE acao='claim_carrinho' ORDER BY id ASC").all();
  const per = {};
  for (const c of claims){
    if (!per[c.user_nome]) per[c.user_nome] = { a:new Set(), c:new Set() };
    per[c.user_nome].a.add(c.event_id);
  }
  const wins = db.prepare("SELECT event_id, user_nome FROM acoes WHERE acao='resultado_conquistou' ORDER BY id ASC").all();
  const loses = db.prepare("SELECT event_id, user_nome FROM acoes WHERE acao='resultado_nao' ORDER BY id ASC").all();
  const lastResult = {};
  for (const r of wins.concat(loses).sort((a,b)=>a.id-b.id)) lastResult[r.event_id] = r;
  for (const r of Object.values(lastResult)){
    if (r.acao !== 'resultado_conquistou') continue;
    let claim = null;
    for (const c of claims){ if (c.event_id === r.event_id) claim = c; }
    if (claim && per[claim.user_nome]) per[claim.user_nome].c.add(r.event_id);
  }
  const rows = Object.keys(per).map(function(nome){
    const p = per[nome];
    const a = p.a.size, c = p.c.size, pct = a ? Math.round(c*100/a) : 0;
    return { nome, a, c, pct };
  }).sort((x,y)=> y.c-x.c || y.a-x.a);
  if (!rows.length) return chartCard('Recuperação por pessoa', '<div style="color:#a8b0a0;text-align:center;padding:16px 0;font-size:13px">Nenhum lead assumido ainda.</div>');
  let html = '<table class=recov><tr><th>Nome</th><th>Assumidos</th><th>Conquistados</th><th>%</th></tr>';
  for (const r of rows) html += '<tr><td>'+esc(r.nome)+'</td><td>'+r.a+'</td><td>'+r.c+'</td><td>'+r.pct+'%</td></tr>';
  html += '</table>';
  return chartCard('Recuperação por pessoa', html);
}

// ===================== RANKING DO TIME (drawer) =====================
function rankPer(since){
  const all = db.prepare('SELECT user_nome, acao FROM acoes WHERE ts >= ?').all(new Date(since).toISOString());
  const onb = {}, claims = {}, wins = {}, tot = {};
  for (const r of all){
    const u = r.user_nome || '?';
    tot[u] = (tot[u]||0)+1;
    if (CHECKS.includes(r.acao)) onb[u] = (onb[u]||0)+1;
    if (r.acao === 'claim_carrinho') claims[u] = (claims[u]||0)+1;
    if (r.acao === 'resultado_conquistou') wins[u] = (wins[u]||0)+1;
  }
  const onbRows = Object.keys(onb).map(u=>({nome:u, val:onb[u], sub:onb[u]+' check'+(onb[u]===1?'':'s')})).sort((a,b)=>b.val-a.val);
  const recRows = Object.keys(claims).map(u=>{
    const a = claims[u]||0, c = wins[u]||0, pct = a ? Math.round(c*100/a) : 0;
    return {nome:u, val:a+c, sub:a+' assumid'+(a===1?'o':'os')+' · '+c+' conquistad'+(c===1?'o':'os')+' · '+pct+'%'};
  }).sort((a,b)=>b.val-a.val);
  const totRows = Object.keys(tot).map(u=>({nome:u, val:tot[u], sub:tot[u]+' açõe'+(tot[u]===1?'s':'s').replace('1 ações','1 ação')})).sort((a,b)=>b.val-a.val);
  return { onb: onbRows, rec: recRows, tot: totRows };
}
function svgRank(list){
  if (!list.length) return '<div style="color:#a8b0a0;text-align:center;padding:16px 0;font-size:13px">Nenhuma ação no período ainda.</div>';
  const W=640, RH=34, H=list.length*RH+12;
  const max = Math.max(1, ...list.map(r=>r.val));
  let s = '';
  list.forEach(function(r,i){
    const y = i*RH+8, bw = Math.max(4, (W-330)*r.val/max);
    s += '<rect x="190" y="'+y+'" width="'+bw+'" height="20" rx="4" fill="#d4a53f"><title>'+esc(r.nome)+': '+r.val+'</title></rect>';
    s += '<text x="182" y="'+(y+14)+'" font-size="12" fill="#f7f3e9" text-anchor="end">'+esc(r.nome)+(i===0 && r.val>0 ? ' 👑' : '')+'</text>';
    s += '<text x="'+(196+bw)+'" y="'+(y+14)+'" font-size="11" fill="#a8b0a0">'+esc(r.sub)+'</text>';
  });
  return '<svg width="100%" viewBox="0 0 '+W+' '+H+'" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" role="img">'+s+'</svg>';
}
function rankPeriodHtml(p){
  return chartCard('✅ Onboarding (checks validados)', svgRank(p.onb))
    + chartCard('🛒 Recuperação (assumidos · conquistados · taxa)', svgRank(p.rec))
    + chartCard('🔥 Atividade (ações no sistema)', svgRank(p.tot));
}
function rankingDrawerHtml(){
  const hoje = rankPer(startOfToday()), d7 = rankPer(Date.now() - 7*86400000);
  return '<div class=charts id=ranking-drawer><div class=charts-head><h3>🏆 Ranking do Time</h3><a id=rank-close class=btn-close href=#>✕ Fechar</a></div>'
    + '<div class=rkbtns><a href=# class="rk-btn on" data-p=hoje>Hoje</a><a href=# class=rk-btn data-p=d7>7 dias</a></div>'
    + '<div id=rk-hoje>' + rankPeriodHtml(hoje) + '</div>'
    + '<div id=rk-d7 hidden>' + rankPeriodHtml(d7) + '</div></div>';
}
// Endpoint JSON do ranking (protegido por login)
app.get('/api/ranking', (req,res)=>{
  if (!requireUser(req,res)) return;
  const p = String(req.query.periodo||'hoje') === 'd7' ? 'd7' : 'hoje';
  const r = rankPer(p === 'd7' ? Date.now() - 7*86400000 : startOfToday());
  res.json({ok:true, periodo:p, onboarding:r.onb, recuperacao:r.rec, atividade:r.tot});
});

function usersCardHtml(req){
  const usersAll = db.prepare('SELECT nome, status, role, criado_em FROM users ORDER BY id ASC').all();
  let urows = '';
  for (const uu of usersAll){
    const self = uu.nome === req.user.nome;
    urows += '<tr><td>' + esc(uu.nome) + (self ? ' <span class="badge b-gray">você</span>' : '') + '</td>'
      + '<td>' + (uu.status==='ativo' ? '<span class="badge b-green">ativo</span>' : uu.status==='pendente' ? '<span class="badge b-orange">pendente</span>' : '<span class="badge b-gray">bloqueado</span>') + '</td>'
      + '<td>' + (uu.role==='admin' ? '🛡️ admin' : 'membro') + '</td>'
      + '<td style="text-align:right;white-space:nowrap">';
    const bstyle = 'margin:0 4px 0 0;background:transparent;color:var(--gold2);border:1px solid var(--line)';
    urows += '<button class=btn style="'+bstyle+'" onclick="admEditarNome(&#39;' + esc(uu.nome) + '&#39;)">✏️ nome</button>'
      + '<button class=btn style="'+bstyle+'" onclick="admResetPin(&#39;' + esc(uu.nome) + '&#39;)">🔑 PIN</button>';
    if (!self){
      if (uu.status==='ativo' || uu.status==='pendente'){
        urows += '<button class=btn style="margin:0 4px 0 0;background:transparent;color:#ffc46b;border:1px solid var(--line)" onclick="admBloquear(&#39;' + esc(uu.nome) + '&#39;,true)">🚫 bloquear</button>';
      } else {
        urows += '<button class=btn style="margin:0 4px 0 0;background:#39d98a" onclick="admBloquear(&#39;' + esc(uu.nome) + '&#39;,false)">✅ desbloquear</button>';
      }
      urows += '<button class=btn style="margin:0;background:#b04a4a;color:#fff" onclick="admExcluir(&#39;' + esc(uu.nome) + '&#39;)">🗑️ excluir</button>';
    }
    urows += '</td></tr>';
  }
  return '<div class=card style="margin:16px 0"><h3 style="margin:0 0 12px;font-size:16px;color:var(--gold2)">🛡️ Admin · Usuários (' + usersAll.length + ')</h3><table class=recov><tr><th>Nome</th><th>Status</th><th>Papel</th><th></th></tr>' + urows + '</table><p style="margin:12px 0 0"><a class=btn-csv href="/auditoria">📜 Auditoria</a></p></div>';
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
.who{color:var(--gold2);font-size:12px;font-weight:600}
.sair{color:var(--mut);font-size:12px;text-decoration:none;margin-left:8px}
.sair:hover{color:var(--gold2)}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:24px 0 8px}
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
table.recov{width:100%;border-collapse:collapse;font-size:13px}
table.recov th{color:var(--mut);text-align:left;font-weight:600;padding:6px 8px;border-bottom:1px solid var(--line)}
table.recov td{padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.05)}
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
.b-green{background:rgba(57,217,138,.12);color:#7fe0ae;border:1px solid rgba(57,217,138,.3)}
.b-blue{background:rgba(80,150,255,.12);color:#8fbaff;border:1px solid rgba(80,150,255,.3)}
.hl{margin-top:8px;font-size:16px;font-weight:600;color:var(--gold2)}
.btn{display:inline-block;margin-top:8px;background:var(--gold);color:#1a1033;font-weight:600;padding:8px 16px;border-radius:8px;text-decoration:none;font-size:13px;border:0;cursor:pointer}
.ob{margin-top:10px;display:flex;flex-direction:column;gap:6px}
.ob label{display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer}
.ob input[type=checkbox]{width:16px;height:16px;accent-color:#d4a53f;cursor:pointer}
.ob .doneby{color:var(--mut);font-size:12px}
.claim{margin-top:10px;font-size:13px}
.claim .assumed{color:#8fbaff;font-weight:600}
.opbtns{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap}
.opbtns button{padding:6px 12px;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--gold2);font-size:12px;font-weight:600;cursor:pointer}
.opbtns button:hover{background:rgba(212,165,63,.1)}
.opbtns button.ok{border-color:rgba(57,217,138,.4);color:#7fe0ae}
.opbtns button.no{border-color:rgba(224,138,138,.4);color:#e08a8a}
.opbtns input{background:#17251d;border:1px solid var(--line);color:var(--txt);border-radius:8px;padding:6px 10px;font-size:12px;outline:none}
.nota{margin-top:6px;font-size:12px;color:var(--mut)}
.chartbar{display:flex;padding:12px 0 0;gap:8px}
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
.rkbtns{display:flex;gap:8px;margin:4px 0}
.rkbtns a{padding:6px 16px;border-radius:999px;border:1px solid var(--line);color:var(--gold2);text-decoration:none;font-size:12px;font-weight:600;line-height:1.4}
.rkbtns a:hover{background:rgba(212,165,63,.1)}
.rkbtns a.on{background:var(--gold);color:#1a1033;border-color:var(--gold);font-weight:700}
.tabs{display:flex;gap:8px;margin:14px 0 0;flex-wrap:wrap}
.tabs a.tab{padding:8px 20px;border-radius:999px;border:1px solid var(--line);color:var(--gold2);text-decoration:none;font-size:13px;font-weight:600;line-height:1.4}
.tabs a.tab:hover{background:rgba(212,165,63,.1)}
.tabs a.tab.on{background:var(--gold);color:#1a1033;border-color:var(--gold);font-weight:700}
[hidden]{display:none!important}
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
<header><div class=wrap><div class=htop><h1>LEGACY</h1><span class=sub>Painel de Vendas</span><div class=live><span class=dot></span>ao vivo<span class=clock id=clock>--:--:--</span><span class=who>· __USER__</span>__ADMINBADGE__<form action=/logout method=post style=display:none id=lo></form><a class=sair href="#" onclick="trocarPin();return false">🔑 Trocar meu PIN</a><a class=sair href="#" onclick="document.getElementById('lo').submit();return false">sair</a></div><nav class=tabs>__TABS__</nav></div></header>
<div class=wrap><div id=sec-vendas>
<div class=kpis>
<div class="card kpi"><div class=lbl>Faturamento hoje</div><div class=val>__FAT__</div><div class=sub>__PGD__ vendas pagas</div></div>
<div class="card kpi"><div class=lbl>Vendas pagas hoje</div><div class=val>__PGD__</div><div class=sub>__PGT__ no total</div></div>
<div class="card kpi"><div class=lbl>Carrinhos abandonados hoje</div><div class=val>__CRD__</div><div class=sub>__CRT__ no total</div></div>
<div class="card kpi"><div class=lbl>Eventos hoje</div><div class=val>__TTD__</div><div class=sub>__TOT__ no total</div></div>
<div class="card kpi"><div class=lbl>⚠️ Onboarding pendente</div><div class=val>__OBP__</div><div class=sub>vendas pagas sem checklist completo</div></div>
<div class="card kpi"><div class=lbl>🛠️ Recuperação</div><div class=val>__RCV__</div><div class=sub>__RCVC__ conquistados · __RCVP__% conversão</div></div>
</div>
<div class=chartbar><a id=btn-charts class=btn-charts href=#>📈 Gráficos · __CHARTMINI__</a><a id=btn-ranking class=btn-charts href=#>🏆 Ranking</a></div>
<div class=bar>
<div class=filters><a href="/?evento=todos" class="__C0__">Todos</a><a href="/?evento=venda.paga" class="__C1__">Pagas</a><a href="/?evento=carrinho.abandonado" class="__C2__">Abandonados</a></div>
<input id=q placeholder="Buscar por nome, whatsapp ou produto…" oninput="fltr()">
<a class=btn-csv href="/export.csv?evento=__EVENC__">Exportar CSV</a>
</div>
<div id=sec-admin hidden>__ADMIN__</div>
<div id=sec-auditoria hidden>__AUDIT__</div>
<div id=feed>__FEED__</div></div>
<div class=charts id=charts-drawer><div class=charts-head><h3>📈 Gráficos</h3><a id=charts-close class=btn-close href=#>✕ Fechar</a></div>__CHART__</div>
__RANK__
</div>
<script>
function nowClock(){return new Date().toLocaleTimeString('pt-BR',{timeZone:'America/Fortaleza'})}
setInterval(function(){var c=document.getElementById('clock');if(c)c.textContent=nowClock()},1000);
(function(){var c=document.getElementById('clock');if(c)c.textContent=nowClock()})();
const qi=document.getElementById('q');qi.value=sessionStorage.getItem('legacy_q')||'';
function fltr(){const q=qi.value.toLowerCase();sessionStorage.setItem('legacy_q',q);document.querySelectorAll('.ev').forEach(el=>{el.style.display=el.dataset.s.includes(q)?'':'none'})}
fltr();
function postAcao(url,data){fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json()).then(j=>{if(j.ok){location.reload()}else{alert(j.erro||'Erro')}}).catch(e=>alert('Erro de rede'))}
function doAcao(ev,acao,detalhe){postAcao('/api/acao',{event_id:ev,acao:acao,detalhe:detalhe})}
function doAdmin(act,nome){postAcao('/admin/'+act,{nome:nome})}
function undoAcao(ev,acao){postAcao('/api/acao/toggle',{event_id:ev,acao:acao})}
(function(){
function adminPost(url,data,cb){fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json()).then(j=>{if(j.ok){if(cb){cb(j)}else{location.reload()}}else{alert(j.erro||'Erro')}}).catch(e=>alert('Erro de rede'))}
function admEditarNome(nome){var n=prompt('Novo nome para '+nome+':',nome);if(n&&n.trim()&&n!==nome)adminPost('/admin/editar_nome',{nome:nome,novo_nome:n.trim()})}
function admResetPin(nome){if(confirm('Resetar PIN de '+nome+'? Um novo PIN de 6 dígitos será gerado.'))adminPost('/admin/resetar_pin',{nome:nome},function(j){alert('Novo PIN de '+nome+': '+j.pin)})}
function admBloquear(nome,bloq){adminPost('/admin/bloquear',{nome:nome,bloquear:bloq})}
function admExcluir(nome){if(confirm('Excluir usuário '+nome+'? As ações antigas permanecem na auditoria.'))adminPost('/admin/excluir',{nome:nome})}
function setTab(t){var ok=false;document.querySelectorAll('.tab').forEach(function(a){var on=a.dataset.tab===t;if(on)ok=true;a.classList.toggle('on',on)});if(!ok)t='vendas';['sec-vendas','sec-admin','sec-auditoria'].forEach(function(id){var s=document.getElementById(id);if(s)s.hidden=id!=='sec-'+t});sessionStorage.setItem('legacy_tab',t)}
(function(){var t=sessionStorage.getItem('legacy_tab')||'vendas';setTab(document.querySelector('.tab[data-tab="'+t+'"]')?t:'vendas')})();
function trocarPin(){var a=prompt('PIN atual:');if(!a)return;var n1=prompt('Novo PIN (6 dígitos):');if(!n1)return;if(!/^\d{6}$/.test(n1)){alert('O novo PIN precisa ter 6 dígitos.');return}var n2=prompt('Confirme o novo PIN:');if(n1!==n2){alert('Os PINs não conferem.');return}fetch('/me/trocar_pin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin_atual:a,pin_novo:n1})}).then(function(r){return r.json()}).then(function(j){if(j.ok){alert('PIN alterado com sucesso!')}else{alert(j.erro==='pin_atual_incorreto'?'PIN atual incorreto.':(j.erro||'Erro'))}}).catch(function(){alert('Erro de rede')})}
var drawer=document.getElementById('charts-drawer'),btnC=document.getElementById('btn-charts');
function applyCharts(){var open=sessionStorage.getItem('legacy_charts')==='1';drawer.classList.toggle('open',open);btnC.classList.toggle('on',open);}
btnC.addEventListener('click',function(e){e.preventDefault();sessionStorage.setItem('legacy_charts',sessionStorage.getItem('legacy_charts')==='1'?'0':'1');applyCharts();});
document.getElementById('charts-close').addEventListener('click',function(e){e.preventDefault();sessionStorage.setItem('legacy_charts','0');applyCharts();});
applyCharts();
})();
(function(){
var rdrawer=document.getElementById('ranking-drawer'),btnR=document.getElementById('btn-ranking');
if(!rdrawer||!btnR)return;
function applyRankP(){var p=sessionStorage.getItem('legacy_rankp')||'hoje';document.getElementById('rk-hoje').hidden=p!=='hoje';document.getElementById('rk-d7').hidden=p!=='d7';document.querySelectorAll('.rk-btn').forEach(function(b){b.classList.toggle('on',b.dataset.p===p)})}
function applyRank(){var open=sessionStorage.getItem('legacy_rank')==='1';rdrawer.classList.toggle('open',open);btnR.classList.toggle('on',open);applyRankP()}
btnR.addEventListener('click',function(e){e.preventDefault();sessionStorage.setItem('legacy_rank',sessionStorage.getItem('legacy_rank')==='1'?'0':'1');applyRank();});
document.getElementById('rank-close').addEventListener('click',function(e){e.preventDefault();sessionStorage.setItem('legacy_rank','0');applyRank();});
document.querySelectorAll('.rk-btn').forEach(function(b){b.addEventListener('click',function(e){e.preventDefault();sessionStorage.setItem('legacy_rankp',b.dataset.p);applyRankP();})});
applyRank();
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
  // KPIs de operação
  const paidEvents = evo.filter(e=>e.body.webhook_evento==='venda.paga');
  const cartEvents = evo.filter(e=>e.body.webhook_evento==='carrinho.abandonado');
  const keys = [];
  for (const e of paidEvents.concat(cartEvents)){ const v=e.body.venda||{}; keys.push(e.id, v.id != null ? String(v.id) : null); }
  const amap = acoesForKeys(keys);
  let obPend = 0;
  for (const e of paidEvents){ const v=e.body.venda||{}; const list = amap[e.id] || (v.id != null ? amap[String(v.id)] : []) || []; if (onboardingInfo(list).n < 3) obPend++; }
  const claimedIds = new Set();
  for (const e of cartEvents){ const list = amap[e.id] || []; if (lastOf(list,'claim_carrinho')) claimedIds.add(e.id); }
  let conquistados = 0;
  for (const idE of claimedIds){ const list = amap[idE] || []; const w = lastOf(list,'resultado_conquistou'), l = lastOf(list,'resultado_nao'); if (w && (!l || w.id > l.id)) conquistados++; }
  const rcvPct = claimedIds.size ? Math.round(conquistados*100/claimedIds.size) : 0;
  const stats = {
    fatHoje: fmtBRL(fatHoje),
    pagasDia: paidEvents.filter(e=>new Date(e.ts).getTime()>=t0).length,
    pagasTotal: paidEvents.length,
    carrDia: cartEvents.filter(e=>new Date(e.ts).getTime()>=t0).length,
    carrTotal: cartEvents.length,
    totalDia: all.filter(e=>!e.dedup && new Date(e.ts).getTime()>=t0).length,
    total: all.filter(e=>!e.dedup).length,
    obPend, rcvA: claimedIds.size, rcvC: conquistados, rcvPct
  };
  let a = all.slice(-300).reverse();
  if (filtro==='venda.paga' || filtro==='carrinho.abandonado') a = a.filter(e=>e.body && e.body.webhook_evento===filtro);

  const card = (e)=>{
    const b = e.body || {};
    const isEvo = String(e.origem||'').startsWith('evo-');
    if (!b.webhook_evento && !isEvo){
      return '<div class=ev data-s="'+esc(JSON.stringify(b).toLowerCase())+'"><div class=meta>#'+esc(e.id)+' · <b>'+esc(e.origem)+'</b> · '+fmtCardDT(e.ts)+'</div><details><summary>payload</summary><pre>'+esc(JSON.stringify(b,null,2))+'</pre></details></div>';
    }
    const cli = b.cliente || {}, prod = b.produto || {}, venda = b.venda || {}, c = b.carrinho || {};
    const badge = b.webhook_evento==='venda.paga' ? '<span class="badge b-gold">✅ venda.paga</span>'
      : b.webhook_evento==='carrinho.abandonado' ? '<span class="badge b-orange">🛒 carrinho.abandonado</span>'
      : '<span class="badge b-gray">'+esc(b.webhook_evento)+'</span>';
    const wa = cli.whatsapp ? String(cli.whatsapp).replace(/\D/g,'') : '';
    const waLink = wa ? '<a href="https://wa.me/'+esc(wa)+'" target=_blank rel=noopener>📱 '+esc(cli.whatsapp)+'</a>' : (cli.whatsapp? '📱 '+esc(cli.whatsapp):'');
    let extra = '';
    const list = amap[e.id] || [];
    if (b.webhook_evento === 'venda.paga' || !b.webhook_evento){
      const v = Number(c.total_venda) || Number(b.valor);
      if (v) extra += '<div class=hl>💰 '+fmtBRL(v, c.moeda)+'</div>';
      const ob = onboardingInfo(list);
      const stBadge = ob.n===3 ? '<span class="badge b-green">✅ Completo</span>' : ob.n>0 ? '<span class="badge b-blue">🔵 Em processo</span>' : '<span class="badge b-orange">🟡 Pendente</span>';
      extra += '<div class=ob><div>'+stBadge+'</div>';
      const labels = [['check_boasvindas','Lead no grupo de boas-vindas'],['check_removido_vip','Removido do grupo VIP com msg'],['check_onboarding_ok','Onboarding concluído']];
      for (const par of labels){
        const acao = par[0], label = par[1];
        const doneA = lastOf(list, acao);
        if (doneA){
          extra += '<label><input type=checkbox checked onchange="undoAcao(\''+esc(e.id)+'\',\''+acao+'\')">'+esc(label)+' <span class=doneby>✓ por '+esc(doneA.user_nome)+' às '+fmtHHMM(doneA.ts)+'</span></label>';
        } else {
          extra += '<label><input type=checkbox onchange="doAcao(\''+esc(e.id)+'\',\''+acao+'\')">'+esc(label)+'</label>';
        }
      }
      extra += '</div>';
    }
    if (b.webhook_evento === 'carrinho.abandonado' || !b.webhook_evento){
      const mins = c.criado_em ? Math.max(0,Math.floor((Date.now()-new Date(c.criado_em).getTime())/60000)) : null;
      if (c.total_venda) extra += '<div class=hl>💰 '+fmtBRL(c.total_venda, c.moeda)+(mins!=null?' · há '+mins+' min':'')+'</div>';
      else if (mins!=null) extra += '<div class=hl>há '+mins+' min</div>';
      if (c.link_recuperacao) extra += '<a class=btn href="'+esc(c.link_recuperacao)+'" target=_blank rel=noopener>🔗 Recuperar</a>';
      const claim = lastOf(list, 'claim_carrinho');
      extra += '<div class=claim>';
      if (!claim){
        extra += '<div class=opbtns><button onclick="doAcao(\''+esc(e.id)+'\',\'claim_carrinho\')">🙋 Assumir lead</button></div>';
      } else {
        const w = lastOf(list,'resultado_conquistou'), l = lastOf(list,'resultado_nao');
        const resultado = w && (!l || w.id > l.id) ? 'conquistou' : (l && (!w || l.id > w.id) ? 'nao' : null);
        extra += '<div>🙋 Assumido por <span class=assumed>'+esc(claim.user_nome)+'</span> às '+fmtHHMM(claim.ts)+'</div>';
        const isClaimer = req.user && req.user.nome === claim.user_nome;
        if (resultado){
          extra += '<div>Resultado: ' + (resultado==='conquistou' ? '<span class="badge b-green">✅ Conquistou</span>' : '<span class="badge b-gray">❌ Não conquistou</span>') + '</div>';
        } else if (isClaimer){
          extra += '<div class=opbtns><button class=ok onclick="doAcao(\''+esc(e.id)+'\',\'resultado_conquistou\')">✅ Conquistou</button>'
            + '<button class=no onclick="doAcao(\''+esc(e.id)+'\',\'resultado_nao\')">❌ Não conquistou</button>'
            + '<input id=nota-'+esc(e.id)+' placeholder="Observação (opcional)">'
            + '<button onclick="doAcao(\''+esc(e.id)+'\',\'nota\',document.getElementById(\'nota-'+esc(e.id)+'\').value)">💬 Nota</button></div>';
        }
      }
      for (const n of list){ if (n.acao==='nota' && n.detalhe) extra += '<div class=nota>💬 '+esc(n.user_nome)+': '+esc(n.detalhe)+'</div>'; }
      extra += '</div>';
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
  const isAdmin = req.user && req.user.role === 'admin';
  let adminBadge = '', adminHtml = '', auditHtml = '';
  const tabs = '<a href="#" class="tab on" data-tab=vendas onclick="setTab(&#39;vendas&#39;);return false">Vendas</a>'
    + (isAdmin ? '<a href="#" class=tab data-tab=admin onclick="setTab(&#39;admin&#39;);return false">Admin</a><a href="#" class=tab data-tab=auditoria onclick="setTab(&#39;auditoria&#39;);return false">Auditoria</a>' : '');
  if (isAdmin){
    const pend = db.prepare("SELECT nome, criado_em FROM users WHERE status='pendente' ORDER BY id ASC").all();
    if (pend.length){
      adminBadge = ' <a href="#" class="badge b-orange" style="text-decoration:none;margin-left:8px" onclick="setTab(&#39;admin&#39;);return false">⏳ ' + pend.length + ' aprovaç' + (pend.length===1?'ão':'ões') + ' pendente' + (pend.length===1?'':'s') + '</a>';
      let rows = '';
      for (const p of pend){
        rows += '<tr><td>' + esc(p.nome) + '</td><td>' + fmtCardDT(p.criado_em) + '</td>'
          + '<td style="text-align:right"><button class="btn" style="margin:0 8px 0 0;background:#39d98a" onclick="doAdmin(&#39;aprovar&#39;,&#39;' + esc(p.nome) + '&#39;)">Aprovar</button>'
          + '<button class="btn" style="margin:0;background:#b04a4a;color:#fff" onclick="doAdmin(&#39;rejeitar&#39;,&#39;' + esc(p.nome) + '&#39;)">Rejeitar</button></td></tr>';
      }
      adminHtml = '<div class=card style="margin:16px 0"><h3 style="margin:0 0 12px;font-size:16px;color:var(--gold2)">🛡️ Admin · Aprovações (' + pend.length + ')</h3>'
        + '<table class=recov><tr><th>Nome</th><th>Cadastrado</th><th></th></tr>' + rows + '</table>';
    }
    if (!adminHtml) adminHtml = '<div class=card style="margin:16px 0"><h3 style="margin:0 0 12px;font-size:16px;color:var(--gold2)">🛡️ Admin · Aprovações (0)</h3><div style="color:var(--mut);font-size:13px">Nenhum cadastro pendente. 🎉</div></div>';
    else adminHtml += '<p style="margin:8px 0 0;font-size:12px;color:var(--mut)">Nenhum outro cadastro pendente.</p>';
    adminHtml += '</div>';
  }
  if (isAdmin){
    adminHtml += usersCardHtml(req);
    const auditRows = db.prepare('SELECT * FROM auditoria ORDER BY id DESC LIMIT 100').all();
    auditHtml = '<div class=card style="margin:16px 0"><div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px"><h3 style="margin:0;font-size:16px;color:var(--gold2)">📜 Auditoria</h3><a class=btn-csv href="/auditoria">Abrir página completa (filtros + CSV)</a></div>' + auditResumoHtml() + auditTableHtml(auditRows) + '</div>';
  }
  const cls = f => (filtro===f?'on':'');
  let out = PAGE
    .replace('__USER__', esc(req.user ? req.user.nome : ''))
    .replace('__FAT__', stats.fatHoje)
    .replace(/__PGD__/g, stats.pagasDia).replace('__PGT__', stats.pagasTotal)
    .replace('__CRD__', stats.carrDia).replace('__CRT__', stats.carrTotal)
    .replace('__TOT__', stats.total).replace('__TTD__', stats.totalDia)
    .replace('__OBP__', stats.obPend)
    .replace('__RCV__', stats.rcvA + ' assumidos').replace('__RCVC__', stats.rcvC).replace('__RCVP__', stats.rcvPct)
    .replace('__C0__', cls('todos')).replace('__C1__', cls('venda.paga')).replace('__C2__', cls('carrinho.abandonado'))
    .replace('__EVENC__', encodeURIComponent(filtro))
    .replace('__CHARTMINI__', stats.pagasDia + (stats.pagasDia===1 ? ' venda hoje' : ' vendas hoje'))
    .replace('__CHART__', salesChart() + recoveryTable())
    .replace('__RANK__', rankingDrawerHtml())
    .replace('__TABS__', tabs)
    .replace('__ADMINBADGE__', adminBadge)
    .replace('__ADMIN__', adminHtml)
    .replace('__AUDIT__', auditHtml)
    .replace('__FEED__', feed);
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.send(out);
});
const PORT = Number(process.env.PORT) || 3210;
app.listen(PORT, ()=>console.log('Hook collector Legacy on :' + PORT + ' (SQLite, modo operacao)'));
