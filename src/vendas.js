const express = require('express');
const router = express.Router();
const { db, allRows, rowToEvent, doBackup } = require('./db');
const { esc, logAud, requireUser, csvField, CHECKS, acoesForKeys, lastOf, onboardingInfo, localDay, localHour, fmtDT, fmtTime, fmtHHMM, fmtCardDT, chartCard, startOfToday, fmtBRL } = require('./util');
const { PAGE } = require('./views/painel.html');
const { usersCardHtml } = require('./admin');
const { auditResumoHtml, auditTableHtml } = require('./auditoria');
const { rankingDrawerHtml } = require('./ranking');
const ACAO_VALIDA = new Set(['check_boasvindas','check_removido_vip','check_onboarding_ok','claim_carrinho','resultado_conquistou','resultado_nao','nota']);
router.post('/api/acao', (req,res)=>{
  if (!requireUser(req,res)) return;
  const b = req.body || {};
  const eventId = String(b.event_id||'');
  if (!eventId || !ACAO_VALIDA.has(b.acao)) return res.status(400).json({ok:false, erro:'parametros_invalidos'});
  const exists = db.prepare('SELECT 1 FROM events WHERE id=?').get(eventId);
  if (!exists) return res.status(404).json({ok:false, erro:'evento_nao_encontrado'});
  const lastOfAcao = db.prepare('SELECT * FROM acoes WHERE event_id=? AND acao=? ORDER BY id DESC LIMIT 1').get(eventId, b.acao);
  if (b.acao === 'claim_carrinho'){
    if (lastOfAcao){
      if (lastOfAcao.user_nome !== req.user.nome) return res.status(403).json({ok:false, erro:'lead assumido por ' + lastOfAcao.user_nome, assumido_por: lastOfAcao.user_nome});
      return res.json({ok:true, assumido_por: req.user.nome});
    }
  }
  if (b.acao === 'resultado_conquistou' || b.acao === 'resultado_nao' || b.acao === 'nota'){
    const claim = db.prepare("SELECT * FROM acoes WHERE event_id=? AND acao='claim_carrinho' ORDER BY id DESC LIMIT 1").get(eventId);
    if (!claim) return res.status(403).json({ok:false, erro:'lead ainda nao assumido'});
    if (claim.user_nome !== req.user.nome) return res.status(403).json({ok:false, erro:'lead assumido por ' + claim.user_nome});
  }
  if (lastOfAcao && (b.acao === 'resultado_conquistou' || b.acao === 'resultado_nao')) return res.status(409).json({ok:false, erro:'resultado ja registrado (use toggle)'});
  db.prepare('INSERT INTO acoes (event_id, user_nome, acao, detalhe, ts) VALUES (?,?,?,?,?)')
    .run(eventId, req.user.nome, b.acao, b.detalhe ? String(b.detalhe).slice(0,500) : null, new Date().toISOString());
  logAud(req.user.nome, b.acao, eventId, b.detalhe || null);
  res.json({ok:true});
});
router.post('/api/acao/toggle', (req,res)=>{
  if (!requireUser(req,res)) return;
  const b = req.body || {};
  const eventId = String(b.event_id||'');
  if (!eventId || !ACAO_VALIDA.has(b.acao)) return res.status(400).json({ok:false, erro:'parametros_invalidos'});
  const last = db.prepare('SELECT id FROM acoes WHERE event_id=? AND acao=? ORDER BY id DESC LIMIT 1').get(eventId, b.acao);
  if (last){ db.prepare('DELETE FROM acoes WHERE id=?').run(last.id); return res.json({ok:true, removido:true}); }
  if (b.acao === 'claim_carrinho') return res.status(404).json({ok:false, erro:'nada_para_remover'});
  db.prepare('INSERT INTO acoes (event_id, user_nome, acao, detalhe, ts) VALUES (?,?,?,?,?)')
    .run(eventId, req.user.nome, b.acao, b.detalhe ? String(b.detalhe).slice(0,500) : null, new Date().toISOString());
  logAud(req.user.nome, b.acao, eventId, b.detalhe || null);
  return res.json({ok:true, marcado:true});
});

router.get('/export.csv', (req,res)=>{
  const filtro = req.query.evento || 'todos';
  let a = allRows().map(rowToEvent);
  if (filtro==='venda.paga' || filtro==='carrinho.abandonado') a = a.filter(e=>e.body && e.body.webhook_evento===filtro);
  const keys = [];
  for (const e of a){ const v=(e.body&&e.body.venda)||{}; keys.push(e.id, v.id != null ? String(v.id) : null); }
  const amap = acoesForKeys(keys);
  const header = ['webhook_evento','venda.id','data','status','cliente.nome','cliente.cpf','cliente.email','cliente.whatsapp','produto.nome','valor','forma_pagamento','origem','link_recuperacao','onboarding_status','onboarding_por','carrinho_assumido_por','carrinho_resultado','ultima_acao_por'];
  const lines = [header.join(',')];
  for (const e of a){
    const b = e.body || {}, cli = b.cliente||{}, prod = b.produto||{}, v = b.venda||{}, c = b.carrinho||{};
    const valor = Number(c.total_venda) || Number(b.valor) || '';
    const list = amap[e.id] || (v.id != null ? amap[String(v.id)] : []) || [];
    const ob = onboardingInfo(list);
    const claim = lastOf(list, 'claim_carrinho');
    const rWin = lastOf(list, 'resultado_conquistou'), rLose = lastOf(list, 'resultado_nao');
    const resultado = rWin && (!rLose || rWin.id > rLose.id) ? 'conquistou' : (rLose && (!rWin || rLose.id > rWin.id) ? 'nao' : '');
    const ultima = list.length ? list[list.length-1].user_nome : '';
    lines.push([
      b.webhook_evento, v.id ?? v.uid ?? '', e.ts, v.status ?? b.status ?? '',
      cli.nome, cli.cpf ?? cli.documento, cli.email, cli.whatsapp ?? cli.telefone,
      prod.nome, valor, v.forma_pagamento ?? b.forma_pagamento, e.origem, c.link_recuperacao,
      b.webhook_evento==='venda.paga' ? ob.status : '',
      b.webhook_evento==='venda.paga' && ob.done.length ? ob.done.map(x=>x.user_nome).join(' / ') : '',
      claim ? claim.user_nome : '',
      resultado,
      ultima
    ].map(csvField).join(','));
  }
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="vendas-legacy.csv"');
  res.send('\ufeff' + lines.join('\r\n'));
});


// ===================== TIMEZONE (exibicao em America/Fortaleza) =====================

router.get('/backup', (req,res)=>{
  const f = doBackup();
  if (!f) return res.status(500).json({ok:false});
  res.json({ok:true, file:f});
});

// ===================== GRAFICO SVG (vendas pagas) =====================
function salesChart(){
  const rows = db.prepare("SELECT ts FROM events WHERE evento='venda.paga'").all();
  const byDay = {}, byHour = {};
  const now = new Date();
  for (let i=13;i>=0;i--){ const d=new Date(now.getTime() - i*86400000); byDay[localDay(d)]=0; }
  for (let h=0;h<24;h++) byHour[h]=0;
  const todayKey = localDay(now);
  for (const r of rows){
    const t = new Date(r.ts);
    const day = localDay(r.ts);
    if (day in byDay) byDay[day]++;
    if (day===todayKey) byHour[localHour(r.ts)]++;
  }
  const W=1010,PAD=8,BW=(W-2*PAD)/14-8;
  const H=170,maxD=Math.max(1,...Object.values(byDay));
  let svgD = '';
  Object.entries(byDay).forEach(function(en,i){
    const day=en[0], cnt=en[1];
    const h=(H-40)*cnt/maxD, x=PAD+i*(BW+8), y=H-28-h;
    svgD += '<rect x="'+x+'" y="'+y+'" width="'+BW+'" height="'+Math.max(h,cnt?2:0)+'" rx="3" fill="#d4a53f"><title>'+day+': '+cnt+'</title></rect>';
    if (cnt) svgD += '<text x="'+(x+BW/2)+'" y="'+(y-4)+'" font-size="10" fill="#a8b0a0" text-anchor="middle">'+cnt+'</text>';
    svgD += '<text x="'+(x+BW/2)+'" y="'+(H-12)+'" font-size="10" fill="#8f9c8f" text-anchor="middle">'+day.slice(5)+'</text>';
  });
  const svgDay = '<svg width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Vendas por dia">'+svgD+'</svg>';
  const HH=150,bw=(W-2*PAD)/24-3,maxH=Math.max(1,...Object.values(byHour));
  let svgH = '';
  Object.entries(byHour).forEach(function(en,i){
    const hr=en[0], cnt=en[1];
    const h=(HH-40)*cnt/maxH, x=PAD+i*(bw+3), y=HH-28-h;
    svgH += '<rect x="'+x+'" y="'+y+'" width="'+bw+'" height="'+Math.max(h,cnt?2:0)+'" rx="2" fill="#d4a53f"><title>'+hr+'h: '+cnt+'</title></rect>';
    if (cnt) svgH += '<text x="'+(x+bw/2)+'" y="'+(y-4)+'" font-size="10" fill="#a8b0a0" text-anchor="middle">'+cnt+'</text>';
    if (hr%3===0) svgH += '<text x="'+(x+bw/2)+'" y="'+(HH-10)+'" font-size="10" fill="#8f9c8f" text-anchor="middle">'+hr+'h</text>';
  });
  const svgHour = '<svg width="'+W+'" height="'+HH+'" viewBox="0 0 '+W+' '+HH+'" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Vendas por hora (hoje)">'+svgH+'</svg>';
  return chartCard('Vendas por dia (14 dias)', svgDay) + chartCard('Vendas por hora (hoje)', svgHour);
}
// Recuperação por pessoa (drawer)
function recoveryTable(){
  const claims = db.prepare("SELECT event_id, user_nome FROM acoes WHERE acao='claim_carrinho' ORDER BY id ASC").all();
  const per = {};
  for (const c of claims){
    if (!per[c.user_nome]) per[c.user_nome] = { a:new Set(), c:new Set() };
    per[c.user_nome].a.add(c.event_id);
  }
  const wins = db.prepare("SELECT event_id, user_nome FROM acoes WHERE acao='resultado_conquistou' ORDER BY id ASC").all();
  const loses = db.prepare("SELECT event_id, user_nome FROM acoes WHERE acao='resultado_nao' ORDER BY id ASC").all();
  const lastResult = {};
  for (const r of wins.concat(loses).sort((a,b)=>a.id-b.id)) lastResult[r.event_id] = r;
  for (const r of Object.values(lastResult)){
    if (r.acao !== 'resultado_conquistou') continue;
    let claim = null;
    for (const c of claims){ if (c.event_id === r.event_id) claim = c; }
    if (claim && per[claim.user_nome]) per[claim.user_nome].c.add(r.event_id);
  }
  const rows = Object.keys(per).map(function(nome){
    const p = per[nome];
    const a = p.a.size, c = p.c.size, pct = a ? Math.round(c*100/a) : 0;
    return { nome, a, c, pct };
  }).sort((x,y)=> y.c-x.c || y.a-x.a);
  if (!rows.length) return chartCard('Recuperação por pessoa', '<div style="color:#a8b0a0;text-align:center;padding:16px 0;font-size:13px">Nenhum lead assumido ainda.</div>');
  let html = '<table class=recov><tr><th>Nome</th><th>Assumidos</th><th>Conquistados</th><th>%</th></tr>';
  for (const r of rows) html += '<tr><td>'+esc(r.nome)+'</td><td>'+r.a+'</td><td>'+r.c+'</td><td>'+r.pct+'%</td></tr>';
  html += '</table>';
  return chartCard('Recuperação por pessoa', html);
}

router.get('/', (req,res)=>{
  const filtro = req.query.evento || 'todos';
  const all = allRows().slice(-5000).map(rowToEvent);
  const t0 = startOfToday();
  const evo = all.filter(e=>!e.dedup && e.body && e.body.webhook_evento);
  const fatHoje = evo.filter(e=>e.body.webhook_evento==='venda.paga' && new Date(e.ts).getTime()>=t0)
    .reduce((s,e)=> s + (Number(e.body.carrinho && e.body.carrinho.total_venda) || Number(e.body.valor) || 0), 0);
  // KPIs de operação
  const paidEvents = evo.filter(e=>e.body.webhook_evento==='venda.paga');
  const cartEvents = evo.filter(e=>e.body.webhook_evento==='carrinho.abandonado');
  const keys = [];
  for (const e of paidEvents.concat(cartEvents)){ const v=e.body.venda||{}; keys.push(e.id, v.id != null ? String(v.id) : null); }
  const amap = acoesForKeys(keys);
  let obPend = 0;
  for (const e of paidEvents){ const v=e.body.venda||{}; const list = amap[e.id] || (v.id != null ? amap[String(v.id)] : []) || []; if (onboardingInfo(list).n < 3) obPend++; }
  const claimedIds = new Set();
  for (const e of cartEvents){ const list = amap[e.id] || []; if (lastOf(list,'claim_carrinho')) claimedIds.add(e.id); }
  let conquistados = 0;
  for (const idE of claimedIds){ const list = amap[idE] || []; const w = lastOf(list,'resultado_conquistou'), l = lastOf(list,'resultado_nao'); if (w && (!l || w.id > l.id)) conquistados++; }
  const rcvPct = claimedIds.size ? Math.round(conquistados*100/claimedIds.size) : 0;
  const stats = {
    fatHoje: fmtBRL(fatHoje),
    pagasDia: paidEvents.filter(e=>new Date(e.ts).getTime()>=t0).length,
    pagasTotal: paidEvents.length,
    carrDia: cartEvents.filter(e=>new Date(e.ts).getTime()>=t0).length,
    carrTotal: cartEvents.length,
    totalDia: all.filter(e=>!e.dedup && new Date(e.ts).getTime()>=t0).length,
    total: all.filter(e=>!e.dedup).length,
    obPend, rcvA: claimedIds.size, rcvC: conquistados, rcvPct
  };
  let a = all.slice(-300).reverse();
  if (filtro==='venda.paga' || filtro==='carrinho.abandonado') a = a.filter(e=>e.body && e.body.webhook_evento===filtro);

  const card = (e)=>{
    const b = e.body || {};
    const isEvo = String(e.origem||'').startsWith('evo-');
    if (!b.webhook_evento && !isEvo){
      return '<div class=ev data-s="'+esc(JSON.stringify(b).toLowerCase())+'"><div class=meta>#'+esc(e.id)+' · <b>'+esc(e.origem)+'</b> · '+fmtCardDT(e.ts)+'</div><details><summary>payload</summary><pre>'+esc(JSON.stringify(b,null,2))+'</pre></details></div>';
    }
    const cli = b.cliente || {}, prod = b.produto || {}, venda = b.venda || {}, c = b.carrinho || {};
    const badge = b.webhook_evento==='venda.paga' ? '<span class="badge b-gold">✅ venda.paga</span>'
      : b.webhook_evento==='carrinho.abandonado' ? '<span class="badge b-orange">🛒 carrinho.abandonado</span>'
      : '<span class="badge b-gray">'+esc(b.webhook_evento)+'</span>';
    const wa = cli.whatsapp ? String(cli.whatsapp).replace(/\D/g,'') : '';
    const waLink = wa ? '<a href="https://wa.me/'+esc(wa)+'" target=_blank rel=noopener>📱 '+esc(cli.whatsapp)+'</a>' : (cli.whatsapp? '📱 '+esc(cli.whatsapp):'');
    let extra = '';
    const list = amap[e.id] || [];
    if (b.webhook_evento === 'venda.paga' || !b.webhook_evento){
      const v = Number(c.total_venda) || Number(b.valor);
      if (v) extra += '<div class=hl>💰 '+fmtBRL(v, c.moeda)+'</div>';
      const ob = onboardingInfo(list);
      const stBadge = ob.n===3 ? '<span class="badge b-green">✅ Completo</span>' : ob.n>0 ? '<span class="badge b-blue">🔵 Em processo</span>' : '<span class="badge b-orange">🟡 Pendente</span>';
      extra += '<div class=ob><div>'+stBadge+'</div>';
      const labels = [['check_boasvindas','Lead no grupo de boas-vindas'],['check_removido_vip','Removido do grupo VIP com msg'],['check_onboarding_ok','Onboarding concluído']];
      for (const par of labels){
        const acao = par[0], label = par[1];
        const doneA = lastOf(list, acao);
        if (doneA){
          extra += '<label><input type=checkbox checked onchange="undoAcao(\''+esc(e.id)+'\',\''+acao+'\')">'+esc(label)+' <span class=doneby>✓ por '+esc(doneA.user_nome)+' às '+fmtHHMM(doneA.ts)+'</span></label>';
        } else {
          extra += '<label><input type=checkbox onchange="doAcao(\''+esc(e.id)+'\',\''+acao+'\')">'+esc(label)+'</label>';
        }
      }
      extra += '</div>';
    }
    if (b.webhook_evento === 'carrinho.abandonado' || !b.webhook_evento){
      const mins = c.criado_em ? Math.max(0,Math.floor((Date.now()-new Date(c.criado_em).getTime())/60000)) : null;
      if (c.total_venda) extra += '<div class=hl>💰 '+fmtBRL(c.total_venda, c.moeda)+(mins!=null?' · há '+mins+' min':'')+'</div>';
      else if (mins!=null) extra += '<div class=hl>há '+mins+' min</div>';
      if (c.link_recuperacao) extra += '<a class=btn href="'+esc(c.link_recuperacao)+'" target=_blank rel=noopener>🔗 Recuperar</a>';
      const claim = lastOf(list, 'claim_carrinho');
      extra += '<div class=claim>';
      if (!claim){
        extra += '<div class=opbtns><button onclick="doAcao(\''+esc(e.id)+'\',\'claim_carrinho\')">🙋 Assumir lead</button></div>';
      } else {
        const w = lastOf(list,'resultado_conquistou'), l = lastOf(list,'resultado_nao');
        const resultado = w && (!l || w.id > l.id) ? 'conquistou' : (l && (!w || l.id > w.id) ? 'nao' : null);
        extra += '<div>🙋 Assumido por <span class=assumed>'+esc(claim.user_nome)+'</span> às '+fmtHHMM(claim.ts)+'</div>';
        const isClaimer = req.user && req.user.nome === claim.user_nome;
        if (resultado){
          extra += '<div>Resultado: ' + (resultado==='conquistou' ? '<span class="badge b-green">✅ Conquistou</span>' : '<span class="badge b-gray">❌ Não conquistou</span>') + '</div>';
        } else if (isClaimer){
          extra += '<div class=opbtns><button class=ok onclick="doAcao(\''+esc(e.id)+'\',\'resultado_conquistou\')">✅ Conquistou</button>'
            + '<button class=no onclick="doAcao(\''+esc(e.id)+'\',\'resultado_nao\')">❌ Não conquistou</button>'
            + '<input id=nota-'+esc(e.id)+' placeholder="Observação (opcional)">'
            + '<button onclick="doAcao(\''+esc(e.id)+'\',\'nota\',document.getElementById(\'nota-'+esc(e.id)+'\').value)">💬 Nota</button></div>';
        }
      }
      for (const n of list){ if (n.acao==='nota' && n.detalhe) extra += '<div class=nota>💬 '+esc(n.user_nome)+': '+esc(n.detalhe)+'</div>'; }
      extra += '</div>';
    }
    const searchable = JSON.stringify([cli.nome,cli.whatsapp,prod.nome]).toLowerCase();
    return '<div class=ev data-s="'+esc(searchable)+'"><div class=meta>#'+esc(e.id)+' · 🕒 <span title="'+esc(fmtDT(e.ts))+'">'+fmtCardDT(e.ts)+'</span></div>'
      + '<div class=fields>'+badge
      + (cli.nome?' <span class="f who">👤 '+esc(cli.nome)+'</span>':'')
      + (cli.whatsapp?' <span class=f>'+waLink+'</span>':'')
      + (prod.nome?' <span class="f prod">📦 '+esc(prod.nome)+'</span>':'')
      + (venda.forma_pagamento?' <span class="f prod">💳 '+esc(venda.forma_pagamento)+'</span>':'')
      + '</div>' + extra
      + '<details><summary>payload</summary><pre>'+esc(JSON.stringify(b,null,2))+'</pre></details></div>';
  };

  const feed = a.map(card).join('') || '<div class=empty>Nenhum evento ainda. Faça um POST em /hook/teste.</div>';
  const isAdmin = req.user && req.user.role === 'admin';
  let adminBadge = '', adminHtml = '', auditHtml = '';
  const tabs = '<a href="#" class="tab on" data-tab=vendas onclick="setTab(&#39;vendas&#39;);return false">Vendas</a>'
    + (isAdmin ? '<a href="#" class=tab data-tab=admin onclick="setTab(&#39;admin&#39;);return false">Admin</a><a href="#" class=tab data-tab=auditoria onclick="setTab(&#39;auditoria&#39;);return false">Auditoria</a>' : '');
  if (isAdmin){
    const pend = db.prepare("SELECT nome, criado_em FROM users WHERE status='pendente' ORDER BY id ASC").all();
    if (pend.length){
      adminBadge = ' <a href="#" class="badge b-orange" style="text-decoration:none;margin-left:8px" onclick="setTab(&#39;admin&#39;);return false">⏳ ' + pend.length + ' aprovaç' + (pend.length===1?'ão':'ões') + ' pendente' + (pend.length===1?'':'s') + '</a>';
      let rows = '';
      for (const p of pend){
        rows += '<tr><td>' + esc(p.nome) + '</td><td>' + fmtCardDT(p.criado_em) + '</td>'
          + '<td style="text-align:right"><button class="btn" style="margin:0 8px 0 0;background:#39d98a" onclick="doAdmin(&#39;aprovar&#39;,&#39;' + esc(p.nome) + '&#39;)">Aprovar</button>'
          + '<button class="btn" style="margin:0;background:#b04a4a;color:#fff" onclick="doAdmin(&#39;rejeitar&#39;,&#39;' + esc(p.nome) + '&#39;)">Rejeitar</button></td></tr>';
      }
      adminHtml = '<div class=card style="margin:16px 0"><h3 style="margin:0 0 12px;font-size:16px;color:var(--gold2)">🛡️ Admin · Aprovações (' + pend.length + ')</h3>'
        + '<table class=recov><tr><th>Nome</th><th>Cadastrado</th><th></th></tr>' + rows + '</table></div>';
    }
    if (!adminHtml) adminHtml = '<div class=card style="margin:16px 0"><h3 style="margin:0 0 12px;font-size:16px;color:var(--gold2)">🛡️ Admin · Aprovações (0)</h3><div style="color:var(--mut);font-size:13px">Nenhum cadastro pendente. 🎉</div></div>';
  }
  if (isAdmin){
    adminHtml += usersCardHtml(req);
    const auditRows = db.prepare('SELECT * FROM auditoria ORDER BY id DESC LIMIT 100').all();
    auditHtml = '<div class=card style="margin:16px 0"><div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px"><h3 style="margin:0;font-size:16px;color:var(--gold2)">📜 Auditoria</h3><a class=btn-csv href="/auditoria">Abrir página completa (filtros + CSV)</a></div>' + auditResumoHtml() + auditTableHtml(auditRows) + '</div>';
  }
  const cls = f => (filtro===f?'on':'');
  let out = PAGE
    .replace('__USER__', esc(req.user ? req.user.nome : ''))
    .replace('__FAT__', stats.fatHoje)
    .replace(/__PGD__/g, stats.pagasDia).replace('__PGT__', stats.pagasTotal)
    .replace('__CRD__', stats.carrDia).replace('__CRT__', stats.carrTotal)
    .replace('__TOT__', stats.total).replace('__TTD__', stats.totalDia)
    .replace('__OBP__', stats.obPend)
    .replace('__RCV__', stats.rcvA + ' assumidos').replace('__RCVC__', stats.rcvC).replace('__RCVP__', stats.rcvPct)
    .replace('__C0__', cls('todos')).replace('__C1__', cls('venda.paga')).replace('__C2__', cls('carrinho.abandonado'))
    .replace('__EVENC__', encodeURIComponent(filtro))
    .replace('__CHARTMINI__', stats.pagasDia + (stats.pagasDia===1 ? ' venda hoje' : ' vendas hoje'))
    .replace('__CHART__', salesChart() + recoveryTable())
    .replace('__RANK__', rankingDrawerHtml())
    .replace('__TABS__', tabs)
    .replace('__ADMINBADGE__', adminBadge)
    .replace('__ADMIN__', adminHtml)
    .replace('__AUDIT__', auditHtml)
    .replace('__FEED__', feed);
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.send(out);
});

module.exports = router;
