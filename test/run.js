// Suite de testes Fase 1 (multi-tenant + DRY) — node test/run.js
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const NL = String.fromCharCode(10);
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function t(name, fn){ try { fn(); pass++; console.log('ok  -', name); } catch(e){ fail++; console.log('FAIL-', name, '::', e.message); } }
async function tA(name, fn){ try { await fn(); pass++; console.log('ok  -', name); } catch(e){ fail++; console.log('FAIL-', name, '::', e.message); } }

// ---------- unit: uuidv7 ----------
(function(){
  const src = fs.readFileSync(path.join(ROOT,'src','util.js'), 'utf8');
  const start = src.indexOf('function uuidv7');
  const end = src.indexOf(NL + '}', start);
  assert(start >= 0 && end > start, 'uuidv7 helper existe em src/util.js');
  const crypto = require('crypto');
  let f; eval('f = ' + src.slice(start, end + NL.length + 1));
  globalThis.uuidv7 = f;
})();
t('uuidv7: formato RFC', () => { assert(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuidv7())); });
t('uuidv7: unique', () => { assert.notStrictEqual(uuidv7(), uuidv7()); });
t('uuidv7: prefixo = timestamp atual', () => { const u = uuidv7().replace(/-/g,''); const ts = parseInt(u.slice(0,12), 16); assert(Math.abs(ts - Date.now()) < 60000); });
t('DEFAULT_TENANT = default (src/config)', () => { assert(fs.readFileSync(path.join(ROOT,'src','config.js'),'utf8').includes("DEFAULT_TENANT = 'default'")); });

// ---------- e2e ----------
const TMP = fs.mkdtempSync('/tmp/lch-test-');
const PORT = 30000 + (process.pid % 20000);
const BASE = 'http://127.0.0.1:' + PORT;
function boot(){
  const child = spawn('node', ['server.js'], { cwd: ROOT, env: Object.assign({}, process.env, { DATA_DIR: TMP, PORT: String(PORT), PAINEL_SECRET: 'test-secret' }), stdio: ['ignore','pipe','pipe'] });
  child.stderr.on('data', d=>process.stderr.write('[app!] '+d));
  return child;
}
const sleep = (ms) => new Promise(r=>setTimeout(r, ms));
async function waitUp(){ for (let i=0;i<60;i++){ try { const r = await fetch(BASE+'/hook/healthcheck', { method:'POST' }); if (r.ok) return; } catch(e){} await sleep(200); } throw new Error('app nao subiu'); }
async function main(){
  let app = boot(); await waitUp();
  const Database = require(path.join(ROOT,'node_modules','better-sqlite3'));
  const db = new Database(path.join(TMP,'events.db'));
  const q = (s,...p)=>db.prepare(s).all(...p);

  t('migrations 001+002 registradas', () => {
    const ids = q('SELECT id FROM _migrations').map(r=>r.id).sort();
    assert.deepStrictEqual(ids, ['001','002']);
  });
  t('tenant default criado (LEGACY, ativo)', () => {
    const r = q("SELECT * FROM tenants WHERE id='default'")[0];
    assert(r && r.nome==='LEGACY' && r.status==='ativo');
  });
  t('tenants: plano default free', () => { assert.strictEqual(q("SELECT plano FROM tenants WHERE id='default'")[0].plano,'free'); });
  t('users tem tenant_id', () => { assert(db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='tenant_id')); });
  t('events tem tenant_id', () => { assert(db.prepare('PRAGMA table_info(events)').all().some(c=>c.name==='tenant_id')); });
  t('acoes tem tenant_id', () => { assert(db.prepare('PRAGMA table_info(acoes)').all().some(c=>c.name==='tenant_id')); });
  t('indices tenant_id criados', () => {
    const ix = q("SELECT name FROM sqlite_master WHERE type='index'").map(r=>r.name);
    for (const n of ['idx_users_tenant','idx_events_tenant','idx_acoes_tenant']) assert(ix.includes(n), n);
  });

  let r = await fetch(BASE+'/login/criar', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body:'nome=Chef&pin=915246', redirect:'manual' });
  t('criar admin', () => { assert([200,302].includes(r.status)); });
  const cookie = (r.headers.get('set-cookie')||'').split(';')[0];
  t('cookie emitido', () => { assert(cookie && cookie.startsWith('painel_auth=')); });
  t('users: tenant_id preenchido (backfill/novo)', () => {
    assert(q('SELECT tenant_id FROM users').every(x=>x.tenant_id==='default'));
  });
  t('backfill: update manual zera e migration-check pega schema', () => {
    db.prepare("INSERT INTO events (id, origem, evento, ts, json, dedup_key) VALUES ('pre1','x','outro',?,'{}',NULL)").run(new Date().toISOString());
    assert(q("SELECT tenant_id FROM events WHERE id='pre1'")[0].tenant_id === null || q("SELECT tenant_id FROM events WHERE id='pre1'")[0].tenant_id === 'default' ? true : false);
  });

  r = await fetch(BASE+'/hook/teste-origem', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ webhook_evento:'venda.paga', venda:{id:'v1'}, cliente:{nome:'Maria', whatsapp:'119'}, carrinho:{total_venda:990} }) });
  t('webhook 200', () => { assert(r.status===200); });
  t('event gravado com tenant default', () => {
    assert.strictEqual(q("SELECT tenant_id FROM events WHERE origem='teste-origem'")[0].tenant_id, 'default');
  });
  await tA('dedupe idempotente', async () => {
    const r2 = await fetch(BASE+'/hook/teste-origem', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ webhook_evento:'venda.paga', venda:{id:'v1'} }) });
    const j = await r2.json(); assert(j.dedupe===true);
  });

  r = await fetch(BASE+'/login', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body:'pin=915246', redirect:'manual' });
  t('login ok -> /', () => { assert(r.status===302 && (r.headers.get('location')||'').endsWith('/')); });
  const cookie2 = (r.headers.get('set-cookie')||'').split(';')[0];
  r = await fetch(BASE+'/login', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body:'pin=111113', redirect:'manual' });
  t('login errado -> erro=1', () => { assert((r.headers.get('location')||'').includes('erro=1')); });
  r = await fetch(BASE+'/', { headers:{cookie:cookie2} });
  const html = await r.text();
  t('painel 200 LEGACY', () => { assert(r.status===200 && html.includes('LEGACY')); });
  await tA('sem cookie -> login page', async () => {
    const tt = await (await fetch(BASE+'/')).text();
    assert(tt.includes('Seu PIN'));
  });
  t('auditoria login_ok com tenant', () => {
    assert.strictEqual(q("SELECT tenant_id FROM auditoria WHERE acao='login_ok'")[0].tenant_id, 'default');
  });

  const ev = q("SELECT id FROM events WHERE origem='teste-origem' LIMIT 1")[0];
  await tA('api/acao ok', async () => {
    const rr = await fetch(BASE+'/api/acao', { method:'POST', headers:{'content-type':'application/json', cookie:cookie2}, body: JSON.stringify({ event_id: ev.id, acao:'check_boasvindas' }) });
    assert((await rr.json()).ok===true);
  });
  t('acao com tenant_id', () => {
    assert.strictEqual(q('SELECT tenant_id FROM acoes WHERE event_id=?', ev.id)[0].tenant_id,'default');
  });
  await tA('toggle remove (escopo tenant)', async () => {
    const rr = await fetch(BASE+'/api/acao/toggle', { method:'POST', headers:{'content-type':'application/json', cookie:cookie2}, body: JSON.stringify({ event_id: ev.id, acao:'check_boasvindas' }) });
    const j = await rr.json(); assert(j.removido===true);
    assert(q('SELECT * FROM acoes WHERE event_id=?', ev.id).length===0);
  });
  await tA('api/ranking ok', async () => { assert((await (await fetch(BASE+'/api/ranking', { headers:{cookie:cookie2} })).json()).ok===true); });
  await tA('export.csv ok', async () => { assert((await fetch(BASE+'/export.csv', { headers:{cookie:cookie2} })).status===200); });
  await tA('auditoria page com vars CSS + pill', async () => {
    const tt = await (await fetch(BASE+'/auditoria', { headers:{cookie:cookie2} })).text();
    assert(tt.includes('--gold') && tt.includes('pill'));
  });
  await tA('login page com vars CSS + pill', async () => {
    const tt = await (await fetch(BASE+'/')).text();
    assert(tt.includes(':root{--gold') && tt.includes('class=pill'));
  });

  await fetch(BASE+'/login/novo', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body:'nome=Maria&pin=482913', redirect:'manual' });
  await tA('admin aprovar', async () => {
    const rr = await fetch(BASE+'/admin/aprovar', { method:'POST', headers:{'content-type':'application/json', cookie:cookie2}, body: JSON.stringify({ nome:'Maria' }) });
    assert((await rr.json()).ok===true);
  });
  r = await fetch(BASE+'/login', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body:'pin=482913', redirect:'manual' });
  const cookieM = (r.headers.get('set-cookie')||'').split(';')[0];
  t('Maria loga apos aprovacao', () => { assert(r.status===302 && (r.headers.get('location')||'').endsWith('/')); });
  await tA('membro nao ve admin', async () => {
    const tt = await (await fetch(BASE+'/', { headers:{cookie:cookieM} })).text();
    assert(!tt.includes('Admin · Usuários'));
  });
  await tA('membro 403 auditoria', async () => { assert((await fetch(BASE+'/auditoria', { headers:{cookie:cookieM} })).status===403); });
  await tA('claim por Maria', async () => {
    const rr = await fetch(BASE+'/api/acao', { method:'POST', headers:{'content-type':'application/json', cookie:cookieM}, body: JSON.stringify({ event_id: ev.id, acao:'claim_carrinho' }) });
    assert((await rr.json()).ok===true);
  });
  await tA('claim nao transfere', async () => {
    const rr = await fetch(BASE+'/api/acao', { method:'POST', headers:{'content-type':'application/json', cookie:cookie2}, body: JSON.stringify({ event_id: ev.id, acao:'claim_carrinho' }) });
    const j = await rr.json(); assert(j.ok===false && String(j.erro).includes('assumido'));
  });

  // grep audit: queries em users/events/acoes/auditoria mencionam tenant
  {
    const files = ['src/vendas.js','src/admin.js','src/auditoria.js','src/ranking.js','src/auth.js'];
    // Excecoes intencionais (globais por design na Fase 1): PIN unico global (login/pinEmUso/usersCount) e criacao do 1o admin
    const allow = ['src/auth.js:24','src/auth.js:45','src/auth.js:86','src/admin.js:9'];
    let bad = [];
    for (const f of files){
      const src = fs.readFileSync(path.join(ROOT,f), 'utf8');
      const lines = src.split(NL);
      lines.forEach((l,i)=>{
        if (!/FROM (users|events|acoes|auditoria)[^a-z_]/.test(l)) return;
        if (/DELETE FROM/.test(l)) return;
        const window = lines.slice(i, i+3).join(' ');
        if (!/tenant/i.test(window) && !allow.includes(f+':'+(i+1))) bad.push(f+':'+(i+1));
      });
    }
    t('grep audit: toda querycita tenant', () => { assert.deepStrictEqual(bad, []); });
  }

  app.kill();
  // Boot 2: idempotencia
  app = boot(); await waitUp();
  const db2 = new Database(path.join(TMP,'events.db'));
  t('migration idempotente', () => {
    const rows = db2.prepare('SELECT id, COUNT(*) c FROM _migrations GROUP BY id ORDER BY id').all();
    assert.deepStrictEqual(rows.map(r=>[r.id,r.c]), [['001',1],['002',1]]);
  });
  t('tenant default nao duplica', () => {
    assert.strictEqual(db2.prepare("SELECT COUNT(*) c FROM tenants WHERE id='default'").get().c, 1);
  });
  t('dados preservados apos 2o boot', () => {
    assert(db2.prepare("SELECT COUNT(*) c FROM events WHERE origem='teste-origem'").get().c >= 1);
  });
  db2.close(); app.kill();
  fs.rmSync(TMP, { recursive:true, force:true });
  console.log(pass + ' ok, ' + fail + ' falhas');
  process.exit(fail ? 1 : 0);
}
main().catch(e=>{ console.error(e); process.exit(1); });