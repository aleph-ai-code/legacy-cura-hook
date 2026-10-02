const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { db } = require('./db');
const { checkPin, makePinHash, pinFraco, pinEmUso } = require('./auth');
const { esc, logAud, adminCountExcept, requireAdmin, isMaster, fmtCardDT, DEFAULT_TENANT } = require('./util');
const { tenantsCardHtml } = require('./tenants');
const tenantOf = (req) => (req.user && req.user.tenant_id) || DEFAULT_TENANT;
// ===================== ADMIN: aprovacao de cadastros =====================
router.post('/admin/aprovar', (req,res)=>{
  if (!requireAdmin(req,res)) return;
  const nome = String((req.body||{}).nome||'').trim();
  const u = db.prepare("SELECT * FROM users WHERE nome=? AND status='pendente' AND tenant_id=?").get(nome, tenantOf(req));
  if (!u) return res.status(404).json({ok:false, erro:'cadastro_nao_encontrado'});
  db.prepare("UPDATE users SET status='ativo' WHERE id=?").run(u.id);
  db.prepare('INSERT INTO acoes (event_id, user_nome, acao, detalhe, ts, tenant_id) VALUES (?,?,?,?,?,?)').run('cadastro', req.user.nome, 'aprovar_cadastro', nome, new Date().toISOString(), tenantOf(req));
  logAud(req.user.nome, 'aprovado', nome);
  res.json({ok:true});
});
router.post('/admin/rejeitar', (req,res)=>{
  if (!requireAdmin(req,res)) return;
  const nome = String((req.body||{}).nome||'').trim();
  const u = db.prepare("SELECT * FROM users WHERE nome=? AND status='pendente' AND tenant_id=?").get(nome, tenantOf(req));
  if (!u) return res.status(404).json({ok:false, erro:'cadastro_nao_encontrado'});
  db.prepare('DELETE FROM users WHERE id=?').run(u.id);
  db.prepare('INSERT INTO acoes (event_id, user_nome, acao, detalhe, ts, tenant_id) VALUES (?,?,?,?,?,?)').run('cadastro', req.user.nome, 'rejeitar_cadastro', nome, new Date().toISOString(), tenantOf(req));
  logAud(req.user.nome, 'rejeitado', nome);
  res.json({ok:true});
});
router.post('/admin/editar_nome', (req,res)=>{
  if (!requireAdmin(req,res)) return;
  const b = req.body||{};
  const nome = String(b.nome||'').trim(), novo = String(b.novo_nome||'').trim();
  if (!nome || !novo || nome===novo) return res.status(400).json({ok:false, erro:'parametros_invalidos'});
  const u = db.prepare('SELECT * FROM users WHERE nome=? AND tenant_id=?').get(nome, tenantOf(req));
  if (!u) return res.status(404).json({ok:false, erro:'usuario_nao_encontrado'});
  if (db.prepare('SELECT 1 FROM users WHERE nome=? AND tenant_id=?').get(novo, tenantOf(req))) return res.status(409).json({ok:false, erro:'nome_ja_existe'});
  db.prepare('UPDATE users SET nome=? WHERE id=?').run(novo, u.id);
  logAud(req.user.nome, 'nome_editado', nome, 'novo nome: ' + novo);
  res.json({ok:true});
});
router.post('/admin/resetar_pin', (req,res)=>{
  if (!requireAdmin(req,res)) return;
  const nome = String((req.body||{}).nome||'').trim();
  const u = db.prepare('SELECT * FROM users WHERE nome=? AND tenant_id=?').get(nome, tenantOf(req));
  if (!u) return res.status(404).json({ok:false, erro:'usuario_nao_encontrado'});
  let pin;
  do { pin = String(crypto.randomInt(100000, 1000000)); } while (pinFraco(pin) || pinEmUso(pin, u.id));
  const stored = makePinHash(pin);
  db.prepare('UPDATE users SET pin_hash=?, salt=? WHERE id=?').run(stored, stored.split(':')[0], u.id);
  logAud(req.user.nome, 'pin_reset', nome);
  res.json({ok:true, pin});
});
router.post('/admin/bloquear', (req,res)=>{
  if (!requireAdmin(req,res)) return;
  const b = req.body||{}; const nome = String(b.nome||'').trim();
  const u = db.prepare('SELECT * FROM users WHERE nome=? AND tenant_id=?').get(nome, tenantOf(req));
  if (!u) return res.status(404).json({ok:false, erro:'usuario_nao_encontrado'});
  const bloquear = !(b.bloquear === false || b.bloquear === 'false');
  if (bloquear){
    if (u.nome === req.user.nome) return res.status(403).json({ok:false, erro:'nao_pode_bloquear_a_si_mesmo'});
    if (u.role === 'admin' && adminCountExcept(nome, tenantOf(req)) === 0) return res.status(403).json({ok:false, erro:'ultimo_admin'});
    db.prepare("UPDATE users SET status='bloqueado' WHERE id=?").run(u.id);
    logAud(req.user.nome, 'bloqueado', nome);
  } else {
    db.prepare("UPDATE users SET status='ativo' WHERE id=?").run(u.id);
    logAud(req.user.nome, 'desbloqueado', nome);
  }
  res.json({ok:true});
});
router.post('/admin/excluir', (req,res)=>{
  if (!requireAdmin(req,res)) return;
  const nome = String((req.body||{}).nome||'').trim();
  const u = db.prepare('SELECT * FROM users WHERE nome=? AND tenant_id=?').get(nome, tenantOf(req));
  if (!u) return res.status(404).json({ok:false, erro:'usuario_nao_encontrado'});
  if (u.nome === req.user.nome) return res.status(403).json({ok:false, erro:'nao_pode_excluir_a_si_mesmo'});
  if (u.role === 'admin' && adminCountExcept(nome) === 0) return res.status(403).json({ok:false, erro:'ultimo_admin'});
  db.prepare('DELETE FROM users WHERE id=?').run(u.id);
  logAud(req.user.nome, 'excluido', nome);
  res.json({ok:true});
});
// Usuario troca o PROPRIO PIN (logado)
router.post('/me/trocar_pin', (req,res)=>{
  if (!requireUser(req,res)) return;
  const b = req.body || {};
  const atual = String(b.pin_atual||''), novo = String(b.pin_novo||'');
  const fracoNovo = pinFraco(novo);
  if (fracoNovo) return res.status(400).json({ok:false, erro: fracoNovo==='formato' ? 'pin_invalido' : 'pin_fraco', msg: fracoNovo==='formato' ? 'O PIN precisa ter no minimo 6 digitos (apenas numeros).' : MSG_PIN_FRACO});
  const u = db.prepare('SELECT * FROM users WHERE id=? AND tenant_id=?').get(req.user.id, tenantOf(req));
  if (!u || !checkPin(atual, u.pin_hash)) return res.status(403).json({ok:false, erro:'pin_atual_incorreto'});
  if (pinEmUso(novo, u.id)) return res.status(409).json({ok:false, erro:'pin_em_uso', msg: MSG_PIN_EM_USO});
  const stored = makePinHash(novo);
  db.prepare('UPDATE users SET pin_hash=?, salt=? WHERE id=?').run(stored, stored.split(':')[0], u.id);
  logAud(u.nome, 'pin_trocado_proprio', u.nome);
  res.json({ok:true});
});

// Pendencias de membros: admin do tenant ve o seu; master ve todos (com nome da empresa)
function pendentesHtml(req){
  const master = isMaster(req.user);
  let rows = '';
  const pend = master
    ? db.prepare("SELECT u.nome, u.criado_em, u.tenant_id, t.nome empresa FROM users u LEFT JOIN tenants t ON t.id=u.tenant_id WHERE u.status='pendente' ORDER BY u.id ASC").all()
    : db.prepare("SELECT nome, criado_em, tenant_id, ? empresa FROM users WHERE status='pendente' AND tenant_id=? ORDER BY id ASC").all('', tenantOf(req));
  for (const p of pend){
    rows += '<tr><td>' + esc(p.nome) + (master && p.empresa ? ' <span class="badge b-blue">' + esc(p.empresa) + '</span>' : '') + '</td><td>' + fmtCardDT(p.criado_em) + '</td>'
      + '<td style="text-align:right"><button class="btn btn-ok" onclick="doAdmin(&#39;aprovar&#39;,&#39;' + esc(p.nome) + '&#39;)">Aprovar</button>'
      + '<button class="btn btn-danger" onclick="doAdmin(&#39;rejeitar&#39;,&#39;' + esc(p.nome) + '&#39;)">Rejeitar</button></td></tr>';
  }
  const n = pend.length;
  return '<div class=card style="margin:16px 0"><h3 style="margin:0 0 12px;font-size:16px;color:var(--gold2)">🛡️ Admin · Aprovações de membros (' + n + ')</h3>'
    + (n ? '<table class=recov><tr><th>Nome</th><th>Cadastrado</th><th></th></tr>' + rows + '</table>'
         : '<div style="color:var(--mut);font-size:13px">Nenhum cadastro pendente. 🎉</div>') + '</div>';
}
function usersCardHtml(req){
  const usersAll = db.prepare('SELECT nome, status, role, criado_em FROM users WHERE tenant_id=? ORDER BY id ASC').all(tenantOf(req));
  let urows = '';
  for (const uu of usersAll){
    const self = uu.nome === req.user.nome;
    const papel = uu.role==='master' ? '👑 master' : (uu.role==='admin' ? '🛡️ admin' : 'membro');
    urows += '<tr><td>' + esc(uu.nome) + (self ? ' <span class="badge b-gray">você</span>' : '') + '</td>'
      + '<td>' + (uu.status==='ativo' ? '<span class="badge b-green">ativo</span>' : uu.status==='pendente' ? '<span class="badge b-orange">pendente</span>' : '<span class="badge b-gray">bloqueado</span>') + '</td>'
      + '<td>' + papel + '</td>'
      + '<td style="text-align:right;white-space:nowrap">';
    urows += '<button class="btn btn-ghost" onclick="admEditarNome(&#39;' + esc(uu.nome) + '&#39;)">✏️ nome</button>'
      + '<button class="btn btn-ghost" onclick="admResetPin(&#39;' + esc(uu.nome) + '&#39;)">🔑 PIN</button>';
    if (!self){
      if (uu.status==='ativo' || uu.status==='pendente'){
        urows += '<button class="btn btn-warn" onclick="admBloquear(&#39;' + esc(uu.nome) + '&#39;,true)">🚫 bloquear</button>';
      } else {
        urows += '<button class="btn btn-ok" onclick="admBloquear(&#39;' + esc(uu.nome) + '&#39;,false)">✅ desbloquear</button>';
      }
      urows += '<button class="btn btn-danger" onclick="admExcluir(&#39;' + esc(uu.nome) + '&#39;)">🗑️ excluir</button>';
    }
    urows += '</td></tr>';
  }
  return '<div class=card style="margin:16px 0"><h3 style="margin:0 0 12px;font-size:16px;color:var(--gold2)">🛡️ Admin · Usuários (' + usersAll.length + ')</h3><table class=recov><tr><th>Nome</th><th>Status</th><th>Papel</th><th></th></tr>' + urows + '</table><p style="margin:12px 0 0"><a class=btn-csv href="/auditoria">📜 Auditoria</a></p></div>';
}

module.exports = { router, usersCardHtml, pendentesHtml };
