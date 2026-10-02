const express = require('express');
const router = express.Router();
const { db } = require('./db');
const { esc, requireMaster, uuidv7, fmtCardDT } = require('./util');
// ===================== TENANTS: resolucao + routes master =====================
function resolveTenant(idOrSub){
  if (!idOrSub) return null;
  return db.prepare('SELECT * FROM tenants WHERE id=? OR subdominio=?').get(String(idOrSub), String(idOrSub)) || null;
}
function tenantAtivo(t){ return !!t && t.status === 'ativo'; }
const SUB_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;
const RESERVADOS = new Set(['default','healthcheck','www','admin','api','app','hook','login','logout','registrar','auditoria','export','backup','me']);
function subValido(sub){ return SUB_RE.test(String(sub||'')) && !RESERVADOS.has(String(sub)); }
function subLivre(sub){ return !db.prepare('SELECT 1 FROM tenants WHERE subdominio=?').get(String(sub)); }

function criarTenant({ nome, subdominio }){
  const id = 't-' + uuidv7();
  db.prepare("INSERT INTO tenants (id, nome, subdominio, plano, status, criado_em) VALUES (?,?,?,?,?,?)")
    .run(id, String(nome).slice(0,120), String(subdominio), 'free', 'pendente', new Date().toISOString());
  return db.prepare('SELECT * FROM tenants WHERE id=?').get(id);
}

// ===== Rotas MASTER: aprovacao/gerenciamento de tenants =====
router.post('/admin/tenant/aprovar', (req,res)=>{
  if (!requireMaster(req,res)) return;
  const id = String((req.body||{}).tenant_id||'');
  const t = db.prepare("SELECT * FROM tenants WHERE id=? AND status='pendente'").get(id);
  if (!t) return res.status(404).json({ok:false, erro:'tenant_nao_encontrado'});
  db.prepare("UPDATE tenants SET status='ativo' WHERE id=?").run(t.id);
  // admin do tenant (auto-cadastro) sai de pendente -> ativo
  db.prepare("UPDATE users SET status='ativo' WHERE tenant_id=? AND status='pendente' AND role='admin'").run(t.id);
  db.prepare('INSERT INTO auditoria (ts, usuario, acao, sobre, detalhe, tenant_id) VALUES (?,?,?,?,?,?)')
    .run(new Date().toISOString(), req.user.nome, 'tenant_aprovado', t.nome, 'subdominio: ' + t.subdominio, t.id);
  res.json({ok:true});
});
router.post('/admin/tenant/rejeitar', (req,res)=>{
  if (!requireMaster(req,res)) return;
  const id = String((req.body||{}).tenant_id||'');
  const t = db.prepare("SELECT * FROM tenants WHERE id=? AND status='pendente'").get(id);
  if (!t) return res.status(404).json({ok:false, erro:'tenant_nao_encontrado'});
  db.prepare('DELETE FROM users WHERE tenant_id=?').run(t.id);
  db.prepare('DELETE FROM tenants WHERE id=?').run(t.id);
  db.prepare('INSERT INTO auditoria (ts, usuario, acao, sobre, detalhe, tenant_id) VALUES (?,?,?,?,?,?)')
    .run(new Date().toISOString(), req.user.nome, 'tenant_rejeitado', t.nome, 'subdominio: ' + t.subdominio, t.id);
  res.json({ok:true});
});
router.post('/admin/tenant/suspender', (req,res)=>{
  if (!requireMaster(req,res)) return;
  const b = req.body||{};
  const id = String(b.tenant_id||'');
  const suspender = !(b.suspender === false || b.suspender === 'false');
  const t = db.prepare('SELECT * FROM tenants WHERE id=?').get(id);
  if (!t || t.id === 'default') return res.status(404).json({ok:false, erro:'tenant_nao_encontrado'});
  if (t.status === 'pendente') return res.status(409).json({ok:false, erro:'tenant_pendente_use_aprovar_rejeitar'});
  const novo = suspender ? 'suspenso' : 'ativo';
  db.prepare('UPDATE tenants SET status=? WHERE id=?').run(novo, t.id);
  db.prepare('INSERT INTO auditoria (ts, usuario, acao, sobre, detalhe, tenant_id) VALUES (?,?,?,?,?,?)')
    .run(new Date().toISOString(), req.user.nome, suspender ? 'tenant_suspenso' : 'tenant_reativado', t.nome, '', t.id);
  res.json({ok:true, status: novo});
});

// ===== Card HTML: tenants (master) =====
function tenantStatusBadge(st){
  return st==='ativo' ? '<span class="badge b-green">ativo</span>'
    : st==='pendente' ? '<span class="badge b-orange">pendente</span>'
    : st==='suspenso' ? '<span class="badge b-gray">suspenso</span>'
    : '<span class="badge b-gray">' + esc(st) + '</span>';
}
function tenantsCardHtml(req){
  const tenants = db.prepare('SELECT * FROM tenants ORDER BY criado_em ASC').all();
  const pendCount = db.prepare("SELECT COUNT(*) c FROM tenants WHERE status='pendente'").get().c;
  let rows = '';
  for (const t of tenants){
    const nUsers = db.prepare('SELECT COUNT(*) c FROM users WHERE tenant_id=?').get(t.id).c;
    const nEvents = db.prepare('SELECT COUNT(*) c FROM events WHERE tenant_id=?').get(t.id).c;
    rows += '<tr><td>' + esc(t.nome) + (t.id==='default' ? ' <span class="badge b-gray">padrão</span>' : '')
      + '</td><td><code>' + esc(t.subdominio||'-') + '</code></td><td>' + tenantStatusBadge(t.status)
      + '</td><td>' + nUsers + ' user(s) · ' + nEvents + ' evento(s)</td><td style="text-align:right;white-space:nowrap">';
    if (t.id !== 'default'){
      if (t.status === 'pendente'){
        rows += '<button class="btn btn-ok" onclick="doTenant(&#39;aprovar&#39;,&#39;' + esc(t.id) + '&#39;)">Aprovar</button>'
          + '<button class="btn btn-danger" onclick="doTenant(&#39;rejeitar&#39;,&#39;' + esc(t.id) + '&#39;)">Rejeitar</button>';
      } else if (t.status === 'ativo'){
        rows += '<button class="btn btn-warn" onclick="doTenant(&#39;suspender&#39;,&#39;' + esc(t.id) + '&#39;,true)">⏸ suspender</button>';
      } else if (t.status === 'suspenso'){
        rows += '<button class="btn btn-ok" onclick="doTenant(&#39;suspender&#39;,&#39;' + esc(t.id) + '&#39;,false)">▶ reativar</button>';
      }
    }
    rows += '</td></tr>';
  }
  return '<div class=card style="margin:16px 0"><h3 style="margin:0 0 12px;font-size:16px;color:var(--gold2)">🏢 Empresas (tenants)'
    + (pendCount ? ' <span class="badge b-orange">' + pendCount + ' pendente' + (pendCount===1?'':'s') + '</span>' : '')
    + '</h3><table class=recov><tr><th>Empresa</th><th>Subdomínio</th><th>Status</th><th>Uso</th><th></th></tr>' + rows + '</table>'
    + '<p class=mut-note>Webhook por empresa: <code>POST /hook/&lt;subdominio|id&gt;/&lt;origem&gt;</code></p></div>';
}

module.exports = { router, resolveTenant, tenantAtivo, subValido, subLivre, criarTenant, tenantsCardHtml, tenantStatusBadge };
