const express = require('express');
const router = express.Router();
const { db } = require('./db');
const { CHECKS, esc, chartCard, startOfToday, requireUser, DEFAULT_TENANT } = require('./util');
const { exigePlanoAtivo } = require('./billing');
router.use(exigePlanoAtivo); // Fase 3
// ===================== RANKING DO TIME (drawer) =====================
function rankPer(since, tenantId){
  const all = db.prepare('SELECT user_nome, acao FROM acoes WHERE ts >= ? AND tenant_id=?').all(new Date(since).toISOString(), tenantId || DEFAULT_TENANT);
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
function rankingDrawerHtml(tenantId){
  const hoje = rankPer(startOfToday(), tenantId), d7 = rankPer(Date.now() - 7*86400000, tenantId);
  return '<div class=charts id=ranking-drawer><div class=charts-head><h3>🏆 Ranking do Time</h3><a id=rank-close class=btn-close href=#>✕ Fechar</a></div>'
    + '<div class=rkbtns><a href=# class="rk-btn on" data-p=hoje>Hoje</a><a href=# class=rk-btn data-p=d7>7 dias</a></div>'
    + '<div id=rk-hoje>' + rankPeriodHtml(hoje) + '</div>'
    + '<div id=rk-d7 hidden>' + rankPeriodHtml(d7) + '</div></div>';
}
// Endpoint JSON do ranking (protegido por login)
router.get('/api/ranking', (req,res)=>{
  if (!requireUser(req,res)) return;
  const p = String(req.query.periodo||'hoje') === 'd7' ? 'd7' : 'hoje';
  const r = rankPer(p === 'd7' ? Date.now() - 7*86400000 : startOfToday(), (req.user && req.user.tenant_id) || DEFAULT_TENANT);
  res.json({ok:true, periodo:p, onboarding:r.onb, recuperacao:r.rec, atividade:r.tot});
});

module.exports = { router, rankingDrawerHtml };
