const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { DATA_DIR, DB_FILE, LEGACY_JSON, BACKUP_DIR, DEFAULT_TENANT } = require('./config');
const { runMigrations } = require('./migrations/runner');
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

// ===================== MIGRATIONS (Fase 1: multi-tenant) =====================
runMigrations(db, [require('./migrations/001_tenants'), require('./migrations/002_tenant_id'), require('./migrations/003_master_role'), require('./migrations/004_billing')]);
const allRows = (tenantId) => db.prepare('SELECT * FROM events WHERE tenant_id=? ORDER BY ts ASC').all(tenantId || DEFAULT_TENANT);

// Dedup: chave = webhook_evento + ':' + (venda.id ?? venda.uid ?? hash do body)
function dedupKey(body, tenantId){
  const ev = body && body.webhook_evento || 'outro';
  let id = body && body.venda && (body.venda.id ?? body.venda.uid);
  if (id == null) id = 'hash:' + crypto.createHash('sha1').update(JSON.stringify(body)).digest('hex').slice(0,16);
  return (tenantId || DEFAULT_TENANT) + ':' + ev + ':' + id;
}

const insStmt = db.prepare('INSERT OR IGNORE INTO events (id, origem, evento, venda_id, ts, json, dedup_key, tenant_id) VALUES (?,?,?,?,?,?,?,?)');
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
        insStmt.run(String(e.id), String(e.origem||'desconhecida'), ev, vid==null?null:String(vid), String(e.ts||new Date().toISOString()), JSON.stringify(body), dedupKey(body, DEFAULT_TENANT), DEFAULT_TENANT);
      }
    });
    tx(arr);
    fs.renameSync(LEGACY_JSON, LEGACY_JSON + '.migrated');
    console.log('Migrados', arr.length, 'eventos de events.json para SQLite');
  } catch (e) { console.error('Migracao falhou:', e.message); }
})();

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

module.exports = { db, insStmt, dedupKey, allRows, rowToEvent, doBackup, DEFAULT_TENANT };
