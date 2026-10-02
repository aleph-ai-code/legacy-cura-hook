// Fase 4: metricas de uso por tenant (base de cobranca) + export CSV por tenant
// Rotas somente master: GET /master/metricas (JSON), /master/metricas.csv, /master/export/:tenant_id
const express = require('express');
const router = express.Router();
const { db, allRows, rowToEvent } = require('./db');
const { esc, requireMaster, csvField, fmtCardDT, logAud, DEFAULT_TENANT } = require('./util');

function iniDoMes(){
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

// Metricas por tenant (base de cobranca)
function coletarMetricas(){
  const ini = iniDoMes();
  const tenants = db.prepare('SELECT * FROM tenants ORDER BY criado_em ASC').all();
  return tenants.map(t => {
    const ev = db.prepare('SELECT COUNT(*) total, COALESCE(SUM(over_limit),0) over_limit FROM events WHERE tenant_id=? AND ts>=?').get(t.id, ini);
    const usersAtivos = db.prepare("SELECT COUNT(*) c FROM users WHERE tenant_id=? AND status='ativo'").get(t.id).c;
    const ultimo = db.prepare("SELECT ts FROM auditoria WHERE tenant_id=? AND acao='login_ok' ORDER BY id DESC LIMIT 1").get(t.id);
    return {
      tenant_id: t.id,
      empresa: t.nome,
      plano: t.plano,
      status: t.status,
      eventos_mes: ev.total,
      over_limit_mes: ev.over_limit || 0,
      users_ativos: usersAtivos,
      ultimo_acesso: ultimo ? ultimo.ts : null,
      trial_ate: t.trial_ate || null,
      pago_ate: t.pago_ate || null,
    };
  });
}

function metricasCardHtml(req){
  const ms = coletarMetricas();
  let rows = '';
  for (const m of ms){
    rows += '<tr><td>' + esc(m.empresa) + (m.tenant_id === DEFAULT_TENANT ? ' <span class="badge b-gray">padrão</span>' : '')
      + '</td><td><span class="badge ' + (m.plano==='master'?'b-blue':(m.plano==='pro'||m.plano==='basico')?'b-green':'b-gray') + '">' + esc(m.plano) + '</span>'
      + '</td><td>' + m.eventos_mes + (m.over_limit_mes ? ' <span class="badge b-orange">+' + m.over_limit_mes + ' over</span>' : '')
      + '</td><td>' + m.users_ativos
      + '</td><td>' + (m.ultimo_acesso ? fmtCardDT(m.ultimo_acesso) : '—')
      + '</td><td>' + (m.trial_ate ? fmtCardDT(m.trial_ate) : '—')
      + '</td><td>' + (m.pago_ate ? fmtCardDT(m.pago_ate) : '—')
      + '</td><td style="text-align:right;white-space:nowrap"><a class=btn-csv href="/master/export/' + esc(m.tenant_id) + '">⬇️ CSV</a></td></tr>';
  }
  return '<div class=card style="margin:16px 0"><div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">'
    + '<h3 style="margin:0;font-size:16px;color:var(--gold2)">📊 Métricas (mês atual)</h3>'
    + '<a class=btn-csv href="/master/metricas.csv">⬇️ Exportar CSV</a></div>'
    + '<table class=recov style="margin-top:12px"><tr><th>Empresa</th><th>Plano</th><th>Eventos no mês</th><th>Users ativos</th><th>Último acesso</th><th>Trial até</th><th>Pago até</th><th></th></tr>' + rows + '</table>'
    + '<p class=mut-note>Base de cobrança: eventos no mês (inclui marcados over_limit), users ativos e acesso mais recente por empresa.</p></div>';
}

router.get('/master/metricas', (req,res)=>{
  if (!requireMaster(req,res)) return;
  res.json({ ok:true, mes: iniDoMes().slice(0,7), metricas: coletarMetricas() });
});

router.get('/master/metricas.csv', (req,res)=>{
  if (!requireMaster(req,res)) return;
  const header = ['tenant_id','empresa','plano','status','eventos_mes','over_limit_mes','users_ativos','ultimo_acesso','trial_ate','pago_ate'];
  const lines = [header.join(',')];
  for (const m of coletarMetricas()){
    lines.push(header.map(k => csvField(m[k])).join(','));
  }
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="metricas-tenants.csv"');
  res.send('\ufeff' + lines.join('\r\n'));
});

// Backup logico por tenant: export.csv de todos os eventos do tenant (master)
router.get('/master/export/:tenant_id', (req,res)=>{
  if (!requireMaster(req,res)) return;
  const tid = String(req.params.tenant_id || '');
  const t = db.prepare('SELECT * FROM tenants WHERE id=?').get(tid);
  if (!t) return res.status(404).json({ ok:false, erro:'tenant_nao_encontrado' });
  const header = ['id','origem','evento','venda_id','ts','over_limit','json'];
  const lines = [header.join(',')];
  for (const r of allRows(tid)){
    const e = rowToEvent(r);
    lines.push([r.id, r.origem, e.body.webhook_evento || '', r.venda_id || '', r.ts, r.over_limit || 0, JSON.stringify(e.body)].map(csvField).join(','));
  }
  logAud(req.user.nome, 'tenant_export', t.nome, 'export.csv (' + (lines.length-1) + ' eventos)', tid);
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="export-' + tid + '.csv"');
  res.send('\ufeff' + lines.join('\r\n'));
});

module.exports = { router, coletarMetricas, metricasCardHtml, iniDoMes };
