const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { db } = require('./db');
const { checkPin, makePinHash, pinFraco, pinEmUso } = require('./auth');
const { esc, logAud, adminCountExcept, requireAdmin } = require('./util');
// ===================== ADMIN: aprovacao de cadastros =====================
const pendentesCount = () => db.prepare("SELECT COUNT(*) c FROM users WHERE status='pendente'").get().c;
router.post('/admin/aprovar', (req,res)=>{
  if (!requireAdmin(req,res)) return;
  const nome = String((req.body||{}).nome||'').trim();
  const u = db.prepare("SELECT * FROM users WHERE nome=? AND status='pendente'").get(nome);
  if (!u) return res.status(404).json({ok:false, erro:'cadastro_nao_encontrado'});
  db.prepare("UPDATE users SET status='ativo' WHERE id=?").run(u.id);
  db.prepare('INSERT INTO acoes (event_id, user_nome, acao, detalhe, ts) VALUES (?,?,?,?,?)').run('cadastro', req.user.nome, 'aprovar_cadastro', nome, new Date().toISOString());
  logAud(req.user.nome, 'aprovado', nome);
  res.json({ok:true});
});
router.post('/admin/rejeitar', (req,res)=>{
  if (!requireAdmin(req,res)) return;
  const nome = String((req.body||{}).nome||'').trim();
  const u = db.prepare("SELECT * FROM users WHERE nome=? AND status='pendente'").get(nome);
  if (!u) return res.status(404).json({ok:false, erro:'cadastro_nao_encontrado'});
  db.prepare('DELETE FROM users WHERE id=?').run(u.id);
  db.prepare('INSERT INTO acoes (event_id, user_nome, acao, detalhe, ts) VALUES (?,?,?,?,?)').run('cadastro', req.user.nome, 'rejeitar_cadastro', nome, new Date().toISOString());
  logAud(req.user.nome, 'rejeitado', nome);
  res.json({ok:true});
});
router.post('/admin/editar_nome', (req,res)=>{
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
router.post('/admin/resetar_pin', (req,res)=>{
  if (!requireAdmin(req,res)) return;
  const nome = String((req.body||{}).nome||'').trim();
  const u = db.prepare('SELECT * FROM users WHERE nome=?').get(nome);
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
router.post('/admin/excluir', (req,res)=>{
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
router.post('/me/trocar_pin', (req,res)=>{
  if (!requireUser(req,res)) return;
  const b = req.body || {};
  const atual = String(b.pin_atual||''), novo = String(b.pin_novo||'');
  const fracoNovo = pinFraco(novo);
  if (fracoNovo) return res.status(400).json({ok:false, erro: fracoNovo==='formato' ? 'pin_invalido' : 'pin_fraco', msg: fracoNovo==='formato' ? 'O PIN precisa ter no minimo 6 digitos (apenas numeros).' : MSG_PIN_FRACO});
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!u || !checkPin(atual, u.pin_hash)) return res.status(403).json({ok:false, erro:'pin_atual_incorreto'});
  if (pinEmUso(novo, u.id)) return res.status(409).json({ok:false, erro:'pin_em_uso', msg: MSG_PIN_EM_USO});
  const stored = makePinHash(novo);
  db.prepare('UPDATE users SET pin_hash=?, salt=? WHERE id=?').run(stored, stored.split(':')[0], u.id);
  logAud(u.nome, 'pin_trocado_proprio', u.nome);
  res.json({ok:true});
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

module.exports = { router, usersCardHtml };
