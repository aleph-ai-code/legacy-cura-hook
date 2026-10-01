const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const app = express();
const DATA = process.env.DATA_FILE || '/data/events.json';
function load(){ try{ return JSON.parse(fs.readFileSync(DATA,'utf8')); }catch(e){ return []; } }
function save(a){ fs.mkdirSync(require('path').dirname(DATA),{recursive:true}); fs.writeFileSync(DATA, JSON.stringify(a.slice(-5000))); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
app.use(express.json({limit:'2mb'}));
app.use(express.text({type:'*/*', limit:'2mb'}));

// Dedup: chave = webhook_evento + ':' + (venda.id ?? venda.uid ?? hash do body)
function dedupKey(body){
  const ev = body && body.webhook_evento || 'outro';
  let id = body && body.venda && (body.venda.id ?? body.venda.uid);
  if (id == null) id = 'hash:' + crypto.createHash('sha1').update(JSON.stringify(body)).digest('hex').slice(0,16);
  return ev + ':' + id;
}

// Recebe QUALQUER POST em /hook/:origem — responde 200 sempre
app.post('/hook/:origem', (req,res)=>{
  let body = req.body;
  if (typeof body === 'string'){ try{ body = JSON.parse(body); }catch(e){} }
  const ev = { id: Date.now()+'-'+Math.random().toString(36).slice(2,7), origem: req.params.origem, ts: new Date().toISOString(), ip: req.ip, headers: req.headers, body: body };
  const key = dedupKey(body);
  const a = load();
  if (a.some(e => e.dedupKey === key)){
    ev.dedup = true; ev.dedupKey = key; a.push(ev); save(a);
    return res.status(200).json({ok:true, dedupe:true});
  }
  ev.dedupKey = key; a.push(ev); save(a);
  res.status(200).json({ok:true});
});

// Export CSV
app.get('/export.csv', (req,res)=>{
  const filtro = req.query.evento || 'todos';
  const all = load().slice(-5000).filter(e=>!e.dedup);
  let a = all;
  if (filtro==='venda.paga' || filtro==='carrinho.abandonado') a = a.filter(e=>e.body && e.body.webhook_evento===filtro);
  const rows = [['id','data','evento','origem','cliente','whatsapp','produto','valor','pagamento']];
  for (const e of a){
    const b = e.body || {}, cli = b.cliente||{}, prod = b.produto||{}, v = b.venda||{}, c = b.carrinho||{};
    rows.push([e.id, e.ts, b.webhook_evento||'', e.origem, cli.nome||'', cli.whatsapp||'', prod.nome||'',
      c.total_venda || b.valor || '', v.forma_pagamento || '']);
  }
  const csv = rows.map(r=>r.map(x=>'"'+String(x==null?'':x).replace(/"/g,'""')+'"').join(';')).join('\n');
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="legacy-eventos.csv"');
  res.send(csv);
});

function startOfToday(){ const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); }
function fmtBRL(centavos, moeda){
  const cur = moeda || 'BRL';
  try { return (centavos/100).toLocaleString('pt-BR',{style:'currency',currency:cur}); } catch(e){ return 'R$ ' + (centavos/100).toFixed(2); }
}

// ===================== PAINEL LEGACY (UX review: layout limpo) =====================
const PAGE = `<!doctype html><html lang=pt-BR><head><meta charset=utf-8><title>LEGACY · Painel de Vendas</title><meta name=viewport content="width=device-width,initial-scale=1"><style>
:root{--gold:#d4a53f;--gold2:#eecf7e;--amber:#cd8900;--bg:#17251d;--card:#213629;--txt:#f7f3e9;--mut:#c2bfa8}
*{box-sizing:border-box}body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;margin:0;background:linear-gradient(180deg,#17251d 0%,#1b2c22 60%,#17251d 100%);color:var(--txt);min-height:100vh}
/* Header único */
header{background:linear-gradient(135deg,var(--bg) 0%,#243c2e 55%,#1d3024 100%);border-bottom:1px solid rgba(212,165,63,.45);padding:18px 24px}
.htop{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
h1{margin:0;font-size:26px;font-weight:800;letter-spacing:6px;background:linear-gradient(90deg,var(--gold),var(--gold2),var(--amber));-webkit-background-clip:text;background-clip:text;color:transparent}
.sub{font-size:14px;color:var(--mut);letter-spacing:1px}
.live{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:13px;color:var(--gold2)}
.dot{width:9px;height:9px;border-radius:50%;background:#39d98a;animation:pulse 1.6s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(57,217,138,.55)}70%{box-shadow:0 0 0 9px rgba(57,217,138,0)}100%{box-shadow:0 0 0 0 rgba(57,217,138,0)}}
.clock{font-variant-numeric:tabular-nums;font-weight:600;color:var(--gold)}
/* KPIs: uma linha só */
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin:-22px 24px 0;position:relative;z-index:2}
.kpi{background:linear-gradient(160deg,var(--card),#2a4233);border:1px solid rgba(212,175,55,.35);border-radius:14px;padding:16px 18px;box-shadow:0 6px 18px rgba(0,0,0,.45)}
.kpi .lbl{font-size:13px;color:var(--mut)}
.kpi .val{font-size:26px;font-weight:800;margin-top:6px;background:linear-gradient(90deg,var(--gold),var(--gold2));-webkit-background-clip:text;background-clip:text;color:transparent}
.kpi .sub{font-size:12px;color:var(--mut);margin-top:4px}
main{padding:20px 24px 40px}
/* Barra de controles única */
.bar{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:16px}
#q{flex:1;min-width:220px;background:var(--card);border:1px solid rgba(212,175,55,.4);color:var(--txt);border-radius:10px;padding:10px 14px;font-size:14px;outline:none}
#q:focus{border-color:var(--gold);box-shadow:0 0 0 2px rgba(212,175,55,.25)}
.filters{display:flex;gap:8px}
.filters a{padding:7px 14px;border-radius:999px;border:1px solid rgba(212,175,55,.4);color:var(--gold2);text-decoration:none;font-size:13px;transition:.2s}
.filters a:hover{background:rgba(212,175,55,.12)}
.filters a.on{background:linear-gradient(90deg,var(--gold),var(--amber));color:#1a1033;font-weight:700;border-color:var(--gold)}
.btn-csv{padding:7px 14px;border-radius:999px;background:rgba(212,175,55,.12);border:1px solid rgba(212,175,55,.4);color:var(--gold2);text-decoration:none;font-size:13px}
.btn-csv:hover{background:rgba(212,175,55,.22)}
/* Cards */
.ev{background:linear-gradient(165deg,var(--card),#274032);border:1px solid rgba(212,175,55,.28);border-left:3px solid var(--gold);border-radius:12px;margin-bottom:12px;padding:14px 16px;box-shadow:0 4px 14px rgba(0,0,0,.4)}
.ev .meta{color:var(--mut);font-size:12px;margin-bottom:8px}
.ev .fields{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.f{background:rgba(212,175,55,.08);border:1px solid rgba(212,175,55,.2);padding:4px 10px;border-radius:8px;font-size:13px}
.f a{color:var(--gold2);text-decoration:none}
.badge{padding:4px 10px;border-radius:8px;font-size:12px;font-weight:700}
.b-gold{background:linear-gradient(90deg,var(--gold),var(--amber));color:#1a1033}
.b-orange{background:#5a3b12;color:#ffc46b;border:1px solid #8a5a1d}
.b-gray{background:#2e4636;color:var(--mut)}
.hl{margin-top:8px;font-size:15px;font-weight:600;color:var(--gold2)}
.btn{display:inline-block;margin-top:8px;background:linear-gradient(90deg,var(--gold),var(--amber));color:#1a1033;font-weight:700;padding:8px 16px;border-radius:10px;text-decoration:none}
.btn:hover{filter:brightness(1.1)}
details{margin-top:8px}summary{cursor:pointer;color:var(--mut);font-size:12px}pre{margin:8px 0 0;white-space:pre-wrap;word-break:break-all;font-size:12px;color:#cfd8c6;background:#122019;border-radius:8px;padding:10px}
.empty{color:var(--mut);text-align:center;padding:40px 0;font-size:15px}
@media(max-width:640px){header{padding:14px 16px}.kpis{grid-template-columns:repeat(2,1fr);margin:-18px 14px 0;gap:10px}main{padding:16px 14px 30px}h1{font-size:20px;letter-spacing:4px}.kpi .val{font-size:20px}}
</style></head><body>
<header><div class=htop><h1>LEGACY</h1><span class=sub>· Painel de Vendas</span><div class=live><span class=dot></span>ao vivo<span class=clock id=clock>--:--:--</span></div></div></header>
<div class=kpis>
<div class=kpi><div class=lbl>💰 Faturamento hoje</div><div class=val>__FAT__</div><div class=sub>__PGD__ vendas pagas</div></div>
<div class=kpi><div class=lbl>✅ Vendas pagas hoje</div><div class=val>__PGD__</div><div class=sub>__PGT__ no total</div></div>
<div class=kpi><div class=lbl>🛒 Carrinhos abandonados hoje</div><div class=val>__CRD__</div><div class=sub>__CRT__ no total</div></div>
<div class=kpi><div class=lbl>📥 Eventos hoje</div><div class=val>__TTD__</div><div class=sub>__TOT__ no total</div></div>
</div>
<main>
<div class=bar>
<div class=filters><a href="/?evento=todos" class="__C0__">Todos</a><a href="/?evento=venda.paga" class="__C1__">✅ Pagas</a><a href="/?evento=carrinho.abandonado" class="__C2__">🛒 Abandonados</a></div>
<input id=q placeholder="🔎 Buscar por nome, whatsapp ou produto…" oninput="fltr()">
<a class=btn-csv href="/export.csv?evento=__EVENC__">⬇ Exportar CSV</a>
</div>
<div id=feed>__FEED__</div>
</main>
<script>
setInterval(()=>{document.getElementById('clock').textContent=new Date().toLocaleTimeString('pt-BR')},1000);document.getElementById('clock').textContent=new Date().toLocaleTimeString('pt-BR');
const qi=document.getElementById('q');qi.value=sessionStorage.getItem('legacy_q')||'';
function fltr(){const q=qi.value.toLowerCase();sessionStorage.setItem('legacy_q',q);document.querySelectorAll('.ev').forEach(el=>{el.style.display=el.dataset.s.includes(q)?'':'none'})}
fltr();
setTimeout(()=>{location.href=location.pathname+(location.search||'')},15000);
</script></body></html>`;

app.get('/', (req,res)=>{
  const filtro = req.query.evento || 'todos';
  const all = load().slice(-5000);
  const t0 = startOfToday();
  const evo = all.filter(e=>!e.dedup && e.body && e.body.webhook_evento);
  const fatHoje = evo.filter(e=>e.body.webhook_evento==='venda.paga' && new Date(e.ts).getTime()>=t0)
    .reduce((s,e)=> s + (Number(e.body.carrinho && e.body.carrinho.total_venda) || Number(e.body.valor) || 0), 0);
  const stats = {
    fatHoje: fmtBRL(fatHoje),
    pagasDia: evo.filter(e=>e.body.webhook_evento==='venda.paga' && new Date(e.ts).getTime()>=t0).length,
    pagasTotal: evo.filter(e=>e.body.webhook_evento==='venda.paga').length,
    carrDia: evo.filter(e=>e.body.webhook_evento==='carrinho.abandonado' && new Date(e.ts).getTime()>=t0).length,
    carrTotal: evo.filter(e=>e.body.webhook_evento==='carrinho.abandonado').length,
    totalDia: all.filter(e=>!e.dedup && new Date(e.ts).getTime()>=t0).length,
    total: all.filter(e=>!e.dedup).length
  };
  let a = all.slice(-300).reverse();
  if (filtro==='venda.paga' || filtro==='carrinho.abandonado') a = a.filter(e=>e.body && e.body.webhook_evento===filtro);

  const card = (e)=>{
    const b = e.body || {};
    if (!b.webhook_evento){
      return '<div class=ev data-s="'+esc(JSON.stringify(b).toLowerCase())+'"><div class=meta>#'+esc(e.id)+' · <b>'+esc(e.origem)+'</b> · '+new Date(e.ts).toLocaleString('pt-BR')+'</div><details><summary>payload</summary><pre>'+esc(JSON.stringify(b,null,2))+'</pre></details></div>';
    }
    const cli = b.cliente || {}, prod = b.produto || {}, venda = b.venda || {}, c = b.carrinho || {};
    const hora = new Date(e.ts).toLocaleTimeString('pt-BR');
    const badge = b.webhook_evento==='venda.paga' ? '<span class="badge b-gold">✅ venda.paga</span>'
      : b.webhook_evento==='carrinho.abandonado' ? '<span class="badge b-orange">🛒 carrinho.abandonado</span>'
      : '<span class="badge b-gray">'+esc(b.webhook_evento)+'</span>';
    const wa = cli.whatsapp ? String(cli.whatsapp).replace(/\D/g,'') : '';
    const waLink = wa ? '<a href="https://wa.me/'+esc(wa)+'" target=_blank rel=noopener>📱 '+esc(cli.whatsapp)+'</a>' : (cli.whatsapp? '📱 '+esc(cli.whatsapp):'');
    let extra = '';
    if (b.webhook_evento === 'venda.paga'){
      const v = Number(c.total_venda) || Number(b.valor);
      if (v) extra += '<div class=hl>💰 '+fmtBRL(v, c.moeda)+'</div>';
    }
    if (b.webhook_evento === 'carrinho.abandonado'){
      const mins = c.criado_em ? Math.max(0,Math.floor((Date.now()-new Date(c.criado_em).getTime())/60000)) : null;
      if (c.total_venda) extra += '<div class=hl>💰 '+fmtBRL(c.total_venda, c.moeda)+(mins!=null?' · há '+mins+' min':'')+'</div>';
      else if (mins!=null) extra += '<div class=hl>há '+mins+' min</div>';
      if (c.link_recuperacao) extra += '<a class=btn href="'+esc(c.link_recuperacao)+'" target=_blank rel=noopener>🔗 Recuperar</a>';
    }
    const searchable = JSON.stringify([cli.nome,cli.whatsapp,prod.nome]).toLowerCase();
    return '<div class=ev data-s="'+esc(searchable)+'"><div class=meta>#'+esc(e.id)+' · 🕒 '+hora+'</div>'
      + '<div class=fields>'+badge
      + (cli.nome?' <span class=f>👤 '+esc(cli.nome)+'</span>':'')
      + (cli.whatsapp?' <span class=f>'+waLink+'</span>':'')
      + (prod.nome?' <span class=f>📦 '+esc(prod.nome)+'</span>':'')
      + (venda.forma_pagamento?' <span class=f>💳 '+esc(venda.forma_pagamento)+'</span>':'')
      + '</div>' + extra
      + '<details><summary>payload</summary><pre>'+esc(JSON.stringify(b,null,2))+'</pre></details></div>';
  };

  const feed = a.map(card).join('') || '<div class=empty>Nenhum evento ainda. Faça um POST em /hook/teste.</div>';
  const cls = f => (filtro===f?'on':'');
  let out = PAGE
    .replace('__FAT__', stats.fatHoje)
    .replace(/__PGD__/g, stats.pagasDia).replace('__PGT__', stats.pagasTotal)
    .replace('__CRD__', stats.carrDia).replace('__CRT__', stats.carrTotal)
    .replace('__TOT__', stats.total).replace('__TTD__', stats.totalDia)
    .replace('__C0__', cls('todos')).replace('__C1__', cls('venda.paga')).replace('__C2__', cls('carrinho.abandonado'))
    .replace('__EVENC__', encodeURIComponent(filtro))
    .replace('__FEED__', feed);
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.send(out);
});
app.listen(3210, ()=>console.log('Hook collector Legacy on :3210'));
