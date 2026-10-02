const express = require('express');
const router = express.Router();
const { db } = require('./db');
const { esc, requireAdmin, csvField, fmtHHMM, fmtDT, startOfToday, DEFAULT_TENANT } = require('./util');
const { exigePlanoAtivo } = require('./billing');
router.use(exigePlanoAtivo); // Fase 3
const tenantOf = (req) => (req.user && req.user.tenant_id) || DEFAULT_TENANT;
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
function auditResumo(tenantId){
  const t0 = new Date(startOfToday()).toISOString();
  const m = {};
  for (const r of db.prepare('SELECT acao, COUNT(*) c FROM auditoria WHERE ts >= ? AND tenant_id=? GROUP BY acao').all(t0, tenantId || DEFAULT_TENANT)) m[r.acao]=r.c;
  const sum = keys => keys.reduce((s,k)=>s+(m[k]||0),0);
  return { logins: sum(['login_ok']), checks: sum(['check_boasvindas','check_removido_vip','check_onboarding_ok']), claims: sum(['claim_carrinho']), resultados: sum(['resultado_conquistou','resultado_nao']) };
}
function auditResumoHtml(tenantId){
  const r = auditResumo(tenantId);
  const pl = (n,s)=> n===1 ? s : s+'s';
  return '<div style="margin:12px 0;padding:10px 14px;border-radius:10px;background:#213629;border:1px solid rgba(212,165,63,.25)">📌 <b>Hoje:</b> '+r.logins+' '+pl(r.logins,'login')+', '+r.checks+' '+pl(r.checks,'check')+' validado'+(r.checks===1?'':'s')+', '+r.claims+' carrinh'+(r.claims===1?'o':'os')+' assumid'+(r.claims===1?'o':'os')+', '+r.resultados+' resultado'+(r.resultados===1?'':'s')+'</div>';
}
function auditTableHtml(rows){
  const trs = rows.map(r=>'<tr><td>'+esc(auditDesc(r))+'</td><td style="color:var(--mut);white-space:nowrap">'+esc(fmtHHMM(r.ts))+'</td></tr>').join('');
  return '<table><tr><th>O que aconteceu</th><th style="width:70px">Hora</th></tr>' + (trs || '<tr><td colspan=2 style="color:var(--mut)">Sem registros.</td></tr>') + '</table>';
}
function auditoriaPage(rows, usuarios, tipos, fUsuario, fTipo){
  const opt = (list, sel) => '<option value="">todos</option>' + list.map(v=>'<option'+(v===sel?' selected':'')+' value="'+esc(v)+'">'+esc(v)+'</option>').join('');
  return '<!doctype html><html lang=pt-BR><head><meta charset=utf-8><title>LEGACY · Auditoria</title><meta name=viewport content="width=device-width,initial-scale=1"><style>:root{--gold:#d4a53f;--gold2:#eecf7e;--bg:#17251d;--card:#213629;--line:rgba(212,165,63,.25);--line-strong:rgba(212,165,63,.4);--txt:#f7f3e9;--mut:#a8b0a0;--ok:#39d98a;--danger:#b04a4a;--danger-soft:#e08a8a}body{font-family:system-ui,sans-serif;margin:0;background:var(--bg);color:var(--txt);font-size:13px;line-height:1.5}.wrap{max-width:1100px;margin:0 auto;padding:24px}h1{color:var(--gold2);letter-spacing:3px;font-size:22px;margin:0 0 8px}select{padding:6px 10px;border-radius:8px;border:1px solid var(--line-strong);background:var(--bg);color:var(--txt);cursor:pointer}.pill{padding:6px 10px;border-radius:999px;border:1px solid var(--line-strong);background:var(--bg);color:var(--txt);cursor:pointer}.pill.on{background:var(--gold);color:#1a1033;font-weight:600}table{width:100%;border-collapse:collapse;margin-top:16px}th{color:var(--mut);text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}td{padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.05)}a{color:var(--gold2)}</style></head><body><div class=wrap><h1>📜 AUDITORIA</h1>' + auditResumoHtml() + '<p><a href="/">← voltar ao painel</a> · <a href="/auditoria.csv">⬇️ baixar CSV</a></p><form method=get style="margin-top:12px"><select name=usuario>'+opt(usuarios,fUsuario)+'</select> <select name=tipo>'+opt(tipos,fTipo)+'</select> <button class="pill on">Filtrar</button></form>' + auditTableHtml(rows) + '</div></body></html>';
}

router.get('/auditoria', (req,res)=>{
  if (!requireAdmin(req,res)) return;
  const fUsuario = String(req.query.usuario||''), fTipo = String(req.query.tipo||'');
  let sql = 'SELECT * FROM auditoria WHERE tenant_id=?'; const params=[tenantOf(req)];
  if (fUsuario){ sql += ' AND usuario=?'; params.push(fUsuario); }
  if (fTipo){ sql += ' AND acao=?'; params.push(fTipo); }
  sql += ' ORDER BY id DESC LIMIT 500';
  const rows = db.prepare(sql).all(...params);
  const usuarios = db.prepare('SELECT DISTINCT usuario FROM auditoria WHERE tenant_id=? ORDER BY usuario').all(tenantOf(req)).map(r=>r.usuario).filter(Boolean);
  const tipos = db.prepare('SELECT DISTINCT acao FROM auditoria WHERE tenant_id=? ORDER BY acao').all(tenantOf(req)).map(r=>r.acao);
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.send(auditoriaPage(rows, usuarios, tipos, fUsuario, fTipo));
});
router.get('/auditoria.csv', (req,res)=>{
  if (!requireAdmin(req,res)) return;
  const fUsuario = String(req.query.usuario||''), fTipo = String(req.query.tipo||'');
  let sql = 'SELECT * FROM auditoria WHERE tenant_id=?'; const params=[tenantOf(req)];
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

module.exports.auditResumoHtml = auditResumoHtml;
module.exports.auditTableHtml = auditTableHtml;
module.exports.router = router;
