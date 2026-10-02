// Fase 3: planos + billing (Mercado Pago scaffolding)
// - statusPlano/tenantBloqueado: master e tenant default NUNCA bloqueados
// - exigePlanoAtivo: middleware do painel (trial/plano expirado -> pagina de renove)
// - limites: max_users (bloqueia criacao), max_events_mes (grava com over_limit=1, nunca perde venda)
// - POST /webhook/pagamento: rota livre; sem MP_ACCESS_TOKEN = modo seco (loga, 200, nao ativa)
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { db } = require('./db');
const { PLANOS, MP, DEFAULT_TENANT } = require('./config');
const { esc, logAud, requireMaster, isMaster, fmtCardDT } = require('./util');

const DIA = 24*3600*1000;
const isoPlusDays = (d) => new Date(Date.now() + d*DIA).toISOString();
function tenantPorId(id){ if (!id) return null; try { return db.prepare('SELECT * FROM tenants WHERE id=?').get(id) || null; } catch(e){ return null; } }

// status do plano de um tenant
function statusPlano(t){
  if (!t || t.id === DEFAULT_TENANT || t.plano === 'master') return { livre: true, motivo: null, plano: 'master' };
  const now = Date.now();
  if (t.pago_ate && Date.parse(t.pago_ate) >= now) return { livre: true, motivo: null, plano: t.plano };
  if (t.trial_ate && Date.parse(t.trial_ate) >= now) return { livre: true, motivo: null, plano: t.plano };
  return { livre: false, motivo: t.pago_ate ? 'plano_expirado' : 'trial_expirado', plano: t.plano };
}
const tenantBloqueado = (t) => !statusPlano(t).livre;
function linkPagamento(plano){ return plano === 'pro' ? (MP.plan_link_pro || MP.plan_link_basico) : MP.plan_link_basico; }

// pagina de bloqueio (dados preservados, link de pagamento configuravel)
function planoExpiradoPage(req, res, t){
  const link = linkPagamento(t && t.plano);
  res.status(200).setHeader('Content-Type','text/html; charset=utf-8');
  res.send('<!doctype html><html lang=pt-BR><head><meta charset=utf-8><title>Plano expirado</title>'
    + '<meta name=viewport content="width=device-width,initial-scale=1">'
    + '<style>body{font-family:system-ui,sans-serif;background:#17251d;color:#f7f3e9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}'
    + '.card{background:#213629;border:1px solid rgba(212,165,63,.45);border-radius:14px;padding:32px;max-width:420px;text-align:center}'
    + 'h1{color:#eecf7e;font-size:22px}p{color:#a8b0a0;font-size:13px}'
    + 'a.btn{display:inline-block;margin-top:16px;padding:10px 18px;border-radius:8px;background:#d4a53f;color:#1a1033;font-weight:600;text-decoration:none}</style></head>'
    + '<body><div class=card><h1>⛔ Plano expirado — renove</h1>'
    + '<p>Seu período de acesso terminou, mas todos os seus dados estão preservados. Renove o plano para voltar a usar o painel.</p>'
    + (link ? '<a class=btn href="' + esc(link) + '">💳 Renovar plano</a>' : '')
    + '<p style="margin-top:14px"><a href="/logout" style="color:#eecf7e;font-size:12px">sair</a></p></div></body></html>');
}

// middleware: bloqueia painel de tenant com trial/plano expirado (master nunca)
function exigePlanoAtivo(req, res, next){
  const t = tenantPorId((req.user && req.user.tenant_id) || DEFAULT_TENANT);
  if (isMaster(req.user) || statusPlano(t).livre) return next();
  return planoExpiradoPage(req, res, t);
}

// ===== limites do plano =====
function podeAdicionarUser(tenantId){
  const t = tenantPorId(tenantId || DEFAULT_TENANT);
  const p = t && PLANOS[t.plano];
  if (!p || p.max_users == null) return true;
  return db.prepare('SELECT COUNT(*) c FROM users WHERE tenant_id=?').get(t.id).c < p.max_users;
}
function limiteEventos(tenantId){
  const t = tenantPorId(tenantId || DEFAULT_TENANT);
  const p = t && PLANOS[t.plano];
  return p && p.max_events_mes != null ? p.max_events_mes : null;
}
function eventosNoMes(tenantId){
  const d = new Date();
  const ini = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
  return db.prepare('SELECT COUNT(*) c FROM events WHERE tenant_id=? AND ts>=?').get(tenantId || DEFAULT_TENANT, ini).c;
}
function temRecurso(tenantId, recurso){
  const t = tenantPorId(tenantId || DEFAULT_TENANT);
  if (!t) return true;
  if (t.id === DEFAULT_TENANT || t.plano === 'master') return true;
  const p = PLANOS[t.plano];
  return !!(p && p.recursos && p.recursos[recurso]);
}

// ===== ativacao de plano (webhook MP ou manual pelo master) =====
function ativarPlano(tenantId, plano, por, dias){
  const d = Number(dias) > 0 ? Number(dias) : 30;
  const pagoAte = isoPlusDays(d);
  db.prepare('UPDATE tenants SET plano=?, pago_ate=? WHERE id=?').run(String(plano), pagoAte, tenantId);
  logAud(por || 'sistema', 'plano_ativado', tenantId, 'plano: ' + plano + ' (' + d + 'd)');
  return db.prepare('SELECT * FROM tenants WHERE id=?').get(tenantId);
}

// ===== webhook Mercado Pago (rota livre; assinatura HMAC via MP_WEBHOOK_SECRET) =====
router.post('/webhook/pagamento', (req,res)=>{
  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  if (MP.webhook_secret){
    const sig = String(req.headers['x-signature'] || '');
    const expect = crypto.createHmac('sha256', MP.webhook_secret).update(raw).digest('hex');
    const a = Buffer.from(sig), b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a,b)){
      logAud(null, 'mp_webhook_sig_invalida', '', '');
      return res.status(401).json({ ok:false, erro:'assinatura_invalida' });
    }
  }
  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(raw || '{}') : (req.body || {}); } catch(e){}
  // external_reference padrao: tenant:<id>:plano:<plano>; aceita tambem campos diretos
  let tenantId = body.tenant_id, plano = body.plano;
  const ref = body.external_reference || (body.data && body.data.external_reference);
  if (ref){ const m = /tenant:([^:]+):plano:([a-z]+)/.exec(String(ref)); if (m){ tenantId = m[1]; plano = m[2]; } }
  if (!MP.access_token){
    // modo seco: sem credenciais — loga payload, responde 200, NUNCA ativa nada
    console.log('[billing] webhook MP em modo seco (MP_ACCESS_TOKEN ausente):', raw.slice(0, 500));
    logAud(null, 'mp_webhook_seco', String(tenantId || ''), raw.slice(0, 200));
    return res.status(200).json({ ok:true, modo:'seco' });
  }
  const acao = body.action || body.type || '';
  const status = (body.data && body.data.status) || body.status || '';
  if (acao && !/payment/i.test(acao)) return res.status(200).json({ ok:true, ignorado: acao });
  if (status && status !== 'approved') return res.status(200).json({ ok:true, ignorado: status });
  if (!tenantPorId(tenantId) || !PLANOS[plano]) return res.status(400).json({ ok:false, erro:'tenant_ou_plano_invalido' });
  const t = ativarPlano(tenantId, plano, 'mp_webhook');
  return res.status(200).json({ ok:true, ativado: t.plano, pago_ate: t.pago_ate });
});

// ===== admin master: ativar plano manualmente (ex: Pix caiu fora do webhook) =====
router.post('/admin/tenant/plano', (req,res)=>{
  if (!requireMaster(req,res)) return;
  const b = req.body || {};
  const t = tenantPorId(String(b.tenant_id || ''));
  if (!t || !PLANOS[b.plano]) return res.status(404).json({ ok:false, erro:'tenant_ou_plano_invalido' });
  const nt = ativarPlano(t.id, String(b.plano), req.user.nome, b.dias);
  logAud(req.user.nome, 'plano_ativado_manual', t.nome, 'plano: ' + b.plano, t.id);
  res.json({ ok:true, plano: nt.plano, pago_ate: nt.pago_ate });
});

// ===== card Financeiro (painel master) =====
function planoBadge(plano){
  const cor = plano === 'master' ? 'b-blue' : (plano === 'pro' || plano === 'basico') ? 'b-green' : 'b-gray';
  return '<span class="badge ' + cor + '">' + esc(plano) + '</span>';
}
function financeiroCardHtml(req){
  const tenants = db.prepare('SELECT * FROM tenants ORDER BY criado_em ASC').all();
  let rows = '';
  for (const t of tenants){
    const nUsers = db.prepare('SELECT COUNT(*) c FROM users WHERE tenant_id=?').get(t.id).c;
    rows += '<tr><td>' + esc(t.nome) + '</td><td>' + planoBadge(t.plano) + '</td>'
      + '<td>' + (t.trial_ate ? fmtCardDT(t.trial_ate) : '—') + '</td>'
      + '<td>' + (t.pago_ate ? fmtCardDT(t.pago_ate) : '—') + '</td>'
      + '<td>' + nUsers + '</td>'
      + '<td style="text-align:right;white-space:nowrap">'
      + (t.plano !== 'pro' ? '<button class="btn btn-ok" onclick="doPlano(\'' + esc(t.id) + '\',\'pro\')">💳 Ativar Pro</button> ' : '')
      + (t.plano !== 'basico' ? '<button class="btn btn-ghost" onclick="doPlano(\'' + esc(t.id) + '\',\'basico\')">Básico</button>' : '')
      + '</td></tr>';
  }
  return '<div class=card style="margin:16px 0"><h3 style="margin:0 0 12px;font-size:16px;color:var(--gold2)">💳 Financeiro</h3>'
    + '<table class=recov><tr><th>Empresa</th><th>Plano</th><th>Trial até</th><th>Pago até</th><th>Users</th><th></th></tr>' + rows + '</table>'
    + '<scr' + 'ipt>async function doPlano(id,plano){if(!confirm("Ativar plano "+plano+" por 30 dias?"))return;'
    + 'const r=await fetch("/admin/tenant/plano",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({tenant_id:id,plano})});'
    + 'if(r.ok)location.reload();else alert("Erro ao ativar plano");}</scr' + 'ipt>'
    + '</div>';
}

module.exports = { router, statusPlano, tenantBloqueado, exigePlanoAtivo, podeAdicionarUser, limiteEventos, eventosNoMes, temRecurso, ativarPlano, financeiroCardHtml, linkPagamento, planoExpiradoPage };
