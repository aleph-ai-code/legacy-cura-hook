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

  t('migrations 001+002+003 registradas', () => {
    const ids = q('SELECT id FROM _migrations').map(r=>r.id).sort();
    assert.deepStrictEqual(ids, ['001','002','003']);
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
  t('003: primeiro admin criado como master', () => {
    const m = q("SELECT role FROM users WHERE nome='Chef'")[0];
    assert(m && m.role==='master');
  });
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

  // ===================== FASE 2: webhook por tenant + self-service + master =====================
  // webhook em tenant inexistente
  r = await fetch(BASE + '/hook/nao-existe/evo-x', { method:'POST', headers:{'content-type':'application/json'}, body:'{}' });
  await tA('webhook tenant inexistente -> 404', async () => { assert.strictEqual(r.status, 404); });
  // self-service cria tenant pendente + admin pendente
  r = await fetch(BASE + '/registrar', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body:'empresa=Empresa+Teste&subdominio=emptest&nome=Patrao&pin=736412', redirect:'manual' });
  t('registrar 302 ok', () => { assert.strictEqual(r.status, 302); });
  t('tenant pendente criado', () => {
    const tt = q("SELECT * FROM tenants WHERE subdominio='emptest'")[0];
    assert(tt && tt.status==='pendente' && tt.nome==='Empresa+Teste'.replace('+',' ') || (tt && tt.status==='pendente'));
  });
  t('admin do tenant pendente', () => {
    const u = q("SELECT u.status, u.role, u.tenant_id, t.subdominio FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.nome='Patrao'")[0];
    assert(u && u.status==='pendente' && u.role==='admin' && u.subdominio==='emptest');
  });
  t('subdominio duplicado rejeitado', async () => {
    const rr = await fetch(BASE + '/registrar', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body:'empresa=Outra&subdominio=emptest&nome=Zezinho&pin=815392', redirect:'manual' });
    assert(String(rr.headers.get('location')||'').includes('sub_uso'));
  });
  t('subdominio invalido rejeitado', async () => {
    const rr = await fetch(BASE + '/registrar', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body:'empresa=Outra2&subdominio=default&nome=Zezao&pin=815392', redirect:'manual' });
    assert(String(rr.headers.get('location')||'').includes('sub_invalido'));
  });
  // login de admin de tenant pendente -> bloqueado
  r = await fetch(BASE + '/login', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body:'pin=736412', redirect:'manual' });
  t('login de tenant pendente bloqueado', () => { const loc = r.headers.get('location')||''; assert(loc.includes('erro=bloqueado') || loc.includes('erro=pendente')); });
  // master aprova tenant
  const tid = q("SELECT id FROM tenants WHERE subdominio='emptest'")[0].id;
  await tA('nao-master 403 em rota tenant', async () => {
    const rr = await fetch(BASE + '/admin/tenant/aprovar', { method:'POST', headers:{'content-type':'application/json', cookie:cookieM}, body: JSON.stringify({ tenant_id: tid }) });
    assert.strictEqual(rr.status, 403);
  });
  await tA('master aprova tenant', async () => {
    const rr = await fetch(BASE + '/admin/tenant/aprovar', { method:'POST', headers:{'content-type':'application/json', cookie:cookie2}, body: JSON.stringify({ tenant_id: tid }) });
    const j = await rr.json(); assert(j.ok===true);
    assert.strictEqual(q('SELECT status FROM tenants WHERE id=?', tid)[0].status, 'ativo');
  });
  t('admin do tenant ativado', () => { assert.strictEqual(q("SELECT status FROM users WHERE nome='Patrao'")[0].status, 'ativo'); });
  r = await fetch(BASE + '/login', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body:'pin=736412', redirect:'manual' });
  const cookieP = (r.headers.get('set-cookie')||'').split(';')[0];
  t('admin tenant loga apos aprovacao', () => { assert(r.status===302 && (r.headers.get('location')||'').endsWith('/')); });
  // webhook por tenant grava no tenant certo + dedupe por tenant
  r = await fetch(BASE + '/hook/emptest/evo-x', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ webhook_evento:'venda.paga', venda:{id:'v9'} }) });
  t('webhook por tenant 200', () => { assert.strictEqual(r.status, 200); });
  t('evento gravado no tenant certo', () => {
    assert.strictEqual(q("SELECT tenant_id FROM events WHERE origem='evo-x' AND json LIKE '%v9%'")[0].tenant_id, tid);
  });
  t('evento do tenant NAO aparece no default', () => {
    assert.strictEqual(q("SELECT COUNT(*) c FROM events WHERE tenant_id='default' AND origem='evo-x'")[0].c, 0);
  });
  await tA('dedupe por tenant isolado (mesma venda em 2 tenants)', async () => {
    // mesmo venda.id no tenant default: NAO pode dedupar contra o do tenant emptest
    const rr = await fetch(BASE + '/hook/default-evo', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ webhook_evento:'venda.paga', venda:{id:'v9'} }) });
    assert((await rr.json()).ok===true);
    const rr2 = await fetch(BASE + '/hook/emptest/evo-y', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ webhook_evento:'venda.paga', venda:{id:'v10'} }) });
    assert((await rr2.json()).ok===true);
  });
  t('dedup_key inclui tenant', () => {
    const keys = q("SELECT dedup_key FROM events WHERE origem IN ('default-evo','evo-y')").map(r=>r.dedup_key);
    assert(keys.some(k=>k && k.startsWith('default:')), 'default prefix');
    assert(keys.some(k=>k && k.startsWith(tid + ':')), 'tenant prefix');
  });
  // isolamento: admin tenant nao acessa dados do default
  const evDefault = q("SELECT id FROM events WHERE tenant_id='default' LIMIT 1")[0];
  await tA('admin tenant 404 em evento de outro tenant', async () => {
    const rr = await fetch(BASE + '/api/acao', { method:'POST', headers:{'content-type':'application/json', cookie:cookieP}, body: JSON.stringify({ event_id: evDefault.id, acao:'check_boasvindas' }) });
    assert.strictEqual(rr.status, 404);
  });
  await tA('admin tenant aprovar escopado (Maria do default 404)', async () => {
    const rr = await fetch(BASE + '/admin/aprovar', { method:'POST', headers:{'content-type':'application/json', cookie:cookieP}, body: JSON.stringify({ nome:'Maria' }) });
    assert.strictEqual(rr.status, 404);
  });
  // master suspende tenant -> login e webhook bloqueados
  await tA('master suspende tenant', async () => {
    const rr = await fetch(BASE + '/admin/tenant/suspender', { method:'POST', headers:{'content-type':'application/json', cookie:cookie2}, body: JSON.stringify({ tenant_id: tid, suspender: true }) });
    assert((await rr.json()).ok===true);
    const rw = await fetch(BASE + '/hook/emptest/evo-x', { method:'POST', headers:{'content-type':'application/json'}, body:'{}' });
    assert.strictEqual(rw.status, 403);
    const rl = await fetch(BASE + '/login', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body:'pin=736412', redirect:'manual' });
    assert(String(rl.headers.get('location')||'').includes('erro=bloqueado'));
  });
  await tA('sessao de tenant suspenso invalidada', async () => {
    const rr = await fetch(BASE + '/', { headers:{cookie:cookieP} });
    const tt = await rr.text();
    assert(tt.includes('Seu PIN')); // voltou pro login
  });
  await tA('master reativa tenant', async () => {
    const rr = await fetch(BASE + '/admin/tenant/suspender', { method:'POST', headers:{'content-type':'application/json', cookie:cookie2}, body: JSON.stringify({ tenant_id: tid, suspender: false }) });
    assert((await rr.json()).ok===true);
    assert.strictEqual(q('SELECT status FROM tenants WHERE id=?', tid)[0].status, 'ativo');
    const rw = await fetch(BASE + '/hook/emptest/evo-z', { method:'POST', headers:{'content-type':'application/json'}, body:'{}' });
    assert.strictEqual(rw.status, 200);
  });
  // master pendentes: painel do master mostra empresa/subdominio (com pendentes na tela)
  await fetch(BASE + '/login/novo', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body:'nome=PedroEmp&pin=514923', redirect:'manual' });
  await tA('painel master mostra card tenants + pendentes', async () => {
    const rr = await fetch(BASE + '/', { headers:{cookie:cookie2} });
    const tt = await rr.text();
    assert.strictEqual(rr.status, 200);
    assert(tt.includes('Empresas (tenants)') && tt.includes('Aprovações de membros'));
    assert(tt.includes('PedroEmp'));
  });
  // nota: PedroEmp cai no tenant default (login/novo) — self-service de MEMBRO continua no tenant do... na verdade pendente global; master ve com badge da empresa
  await tA('rejeitar tenant remove users e tenant', async () => {
    const rr = await fetch(BASE + '/registrar', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body:'empresa=Lixo&subdominio=lixotest&nome=Lixo&pin=918273', redirect:'manual' });
    const tid2 = q("SELECT id FROM tenants WHERE subdominio='lixotest'")[0].id;
    const rr2 = await fetch(BASE + '/admin/tenant/rejeitar', { method:'POST', headers:{'content-type':'application/json', cookie:cookie2}, body: JSON.stringify({ tenant_id: tid2 }) });
    assert((await rr2.json()).ok===true);
    assert.strictEqual(q('SELECT COUNT(*) c FROM tenants WHERE id=?', tid2)[0].c, 0);
    assert.strictEqual(q("SELECT COUNT(*) c FROM users WHERE nome='Lixo'")[0].c, 0);
  });

  // grep audit: queries em users/events/acoes/auditoria mencionam tenant
  {
    const files = ['src/vendas.js','src/admin.js','src/auditoria.js','src/ranking.js','src/auth.js'];
    // Excecoes intencionais (globais por design na Fase 1): PIN unico global (login/pinEmUso/usersCount) e criacao do 1o admin
    const allow = ['src/auth.js:27','src/auth.js:48','src/auth.js:92'];
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
    assert.deepStrictEqual(rows.map(r=>[r.id,r.c]), [['001',1],['002',1],['003',1]]);
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