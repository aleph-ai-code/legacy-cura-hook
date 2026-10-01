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

function startOfToday(){ const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); }
function fmtBRL(centavos, moeda){
  const cur = moeda || 'BRL';
  try { return (centavos/100).toLocaleString('pt-BR',{style:'currency',currency:cur}); } catch(e){ return 'R$ ' + (centavos/100).toFixed(2); }
}

// ===================== PAINEL LEGACY =====================
const PAGE = "<!doctype html><html lang=pt-BR><head><meta charset=utf-8><title>LEGACY · Painel de Vendas</title><meta name=viewport content=\"width=device-width,initial-scale=1\"><style>\n:root{--gold:#d4af37;--gold2:#f0d47a;--amber:#e8a13d;--purple:#1a1033;--bg:#0c0817;--card:#150d29;--txt:#efe9dc;--mut:#9d94b8}\n*{box-sizing:border-box}body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;margin:0;background:linear-gradient(180deg,#0c0817 0%,#120a24 60%,#0c0817 100%);color:var(--txt);min-height:100vh}\nheader{background:linear-gradient(135deg,var(--purple) 0%,#221340 55%,#2b1a52 100%);border-bottom:1px solid rgba(212,175,55,.45);padding:18px 24px;box-shadow:0 4px 24px rgba(212,175,55,.12)}\n.htop{display:flex;align-items:center;gap:14px;flex-wrap:wrap}\n.logo{font-size:26px;font-weight:800;letter-spacing:6px;background:linear-gradient(90deg,var(--gold),var(--gold2),var(--amber));-webkit-background-clip:text;background-clip:text;color:transparent}\n.title{font-size:15px;color:var(--mut);letter-spacing:1px}\n.live{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:13px;color:var(--gold2)}\n.dot{width:9px;height:9px;border-radius:50%;background:#39d98a;box-shadow:0 0 0 rgba(57,217,138,.6);animation:pulse 1.6s infinite}\n@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(57,217,138,.55)}70%{box-shadow:0 0 0 9px rgba(57,217,138,0)}100%{box-shadow:0 0 0 0 rgba(57,217,138,0)}}\n.clock{font-variant-numeric:tabular-nums;font-weight:600;color:var(--gold)}\n.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin:-22px 24px 0;position:relative;z-index:2}\n.kpi{background:linear-gradient(160deg,var(--card),#1b1136);border:1px solid rgba(212,175,55,.35);border-radius:14px;padding:16px 18px;box-shadow:0 6px 18px rgba(0,0,0,.45),inset 0 1px 0 rgba(212,175,55,.15)}\n.kpi .lbl{font-size:13px;color:var(--mut)}.kpi .val{font-size:26px;font-weight:800;margin-top:6px;background:linear-gradient(90deg,var(--gold),var(--gold2));-webkit-background-clip:text;background-clip:text;color:transparent}\n.kpi .sub{font-size:12px;color:var(--mut);margin-top:4px}\nmain{padding:20px 24px 40px}\n.bar{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:16px}\n#q{flex:1;min-width:220px;background:var(--card);border:1px solid rgba(212,175,55,.4);color:var(--txt);border-radius:10px;padding:10px 14px;font-size:14px;outline:none}\n#q:focus{border-color:var(--gold);box-shadow:0 0 0 2px rgba(212,175,55,.25)}\n.filters{display:flex;gap:8px;flex-wrap:wrap}\n.filters a{padding:7px 14px;border-radius:999px;border:1px solid rgba(212,175,55,.4);color:var(--gold2);text-decoration:none;font-size:13px;transition:.2s}\n.filters a:hover{background:rgba(212,175,55,.12)}\n.filters a.on{background:linear-gradient(90deg,var(--gold),var(--amber));color:#1a1033;font-weight:700;border-color:var(--gold)}\n.ev{background:linear-gradient(165deg,var(--card),#191033);border:1px solid rgba(212,175,55,.28);border-left:3px solid var(--gold);border-radius:12px;margin-bottom:12px;padding:14px 16px;box-shadow:0 4px 14px rgba(0,0,0,.4)}\n.ev .meta{color:var(--mut);font-size:12px;margin-bottom:8px;display:flex;gap:10px;flex-wrap:wrap;align-items:center}\n.ev .fields{display:flex;gap:8px;flex-wrap:wrap;align-items:center}\n.f{background:rgba(212,175,55,.08);border:1px solid rgba(212,175,55,.2);padding:4px 10px;border-radius:8px;font-size:13px}\n.f a{color:var(--gold2);text-decoration:none}\n.badge{padding:4px 10px;border-radius:8px;font-size:12px;font-weight:700}\n.b-gold{background:linear-gradient(90deg,var(--gold),var(--amber));color:#1a1033}\n.b-orange{background:#5a3b12;color:#ffc46b;border:1px solid #8a5a1d}\n.b-gray{background:#2a2140;color:var(--mut)}\n.hl{margin-top:8px;font-size:15px;font-weight:600;color:var(--gold2)}\n.btn{display:inline-block;margin-top:8px;background:linear-gradient(90deg,var(--gold),var(--amber));color:#1a1033;font-weight:700;padding:8px 16px;border-radius:10px;text-decoration:none;box-shadow:0 3px 10px rgba(212,175,55,.35);transition:.2s}\n.btn:hover{filter:brightness(1.1)}\ndetails{margin-top:8px}summary{cursor:pointer;color:var(--mut);font-size:12px}pre{margin:8px 0 0;white-space:pre-wrap;word-break:break-all;font-size:12px;color:#c9bdf0;background:#100a20;border-radius:8px;padding:10px}\n.empty{color:var(--mut);text-align:center;padding:40px 0;font-size:15px}\n@media(max-width:640px){header{padding:14px 16px}.kpis{grid-template-columns:repeat(2,1fr);margin:-18px 14px 0;gap:10px}main{padding:16px 14px 30px}.logo{font-size:20px;letter-spacing:4px}.kpi .val{font-size:20px}}\n</style></head><body>\n<header><div class=htop><div class=logo>LEGACY</div><div class=title>· Painel de Vendas</div><div class=live><span class=dot></span>ao vivo<span class=clock id=clock>--:--:--</span></div></div></header>\n<div class=kpis>\n<div class=kpi><div class=lbl>💰 Faturamento hoje</div><div class=val>__FAT__</div><div class=sub>vendas pagas de hoje</div></div>\n<div class=kpi><div class=lbl>✅ Vendas pagas hoje</div><div class=val>__PGD__</div><div class=sub>__PGT__</div></div>\n<div class=kpi><div class=lbl>🛒 Carrinhos abandonados hoje</div><div class=val>__CRD__</div><div class=sub>__CRT__</div></div>\n<div class=kpi><div class=lbl>📈 Totais gerais</div><div class=val>__TOT__</div><div class=sub>__TTD__ hoje · eventos coletados</div></div>\n</div>\n<main>\n<div class=bar><input id=q placeholder=\"🔎 Buscar por nome, whatsapp ou produto…\" oninput=\"fltr()\"><div class=filters><a href=\"/?evento=todos\" class=\"__C0__\">Todos</a><a href=\"/?evento=venda.paga\" class=\"__C1__\">✅ Pagas</a><a href=\"/?evento=carrinho.abandonado\" class=\"__C2__\">🛒 Abandonados</a></div></div>\n<div id=feed>__FEED__</div>\n</main>\n<script>\nsetInterval(()=>{document.getElementById('clock').textContent=new Date().toLocaleTimeString('pt-BR')},1000);document.getElementById('clock').textContent=new Date().toLocaleTimeString('pt-BR');\nconst qi=document.getElementById('q');qi.value=sessionStorage.getItem('legacy_q')||'';\nfunction fltr(){const q=qi.value.toLowerCase();sessionStorage.setItem('legacy_q',q);document.querySelectorAll('.ev').forEach(el=>{el.style.display=el.dataset.s.includes(q)?'':'none'})}\nfltr();\nsetTimeout(()=>{location.href=location.pathname+(location.search||'')},15000);\n</script></body></html>";

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
      return '<div class=ev data-s="'+esc(JSON.stringify(b).toLowerCase())+'"><div class=meta>#'+esc(e.id)+' · <b>'+esc(e.origem)+'</b> · '+new Date(e.ts).toLocaleString('pt-BR')+(e.dedup?' · 🔁 dedup':'')+'</div><details><summary>payload (formato antigo)</summary><pre>'+esc(JSON.stringify(b,null,2))+'</pre></details></div>';
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
      if (c.link_recuperacao) extra += '<a class=btn href="'+esc(c.link_recuperacao)+'" target=_blank rel=noopener>🔗 Recuperar carrinho</a>';
    }
    const searchable = JSON.stringify([cli.nome,cli.whatsapp,prod.nome]).toLowerCase();
    return '<div class=ev data-s="'+esc(searchable)+'"><div class=meta>#'+esc(e.id)+' · <b>'+esc(e.origem)+'</b> · 🕒 '+hora+(e.dedup?' · 🔁 dedup':'')+'</div>'
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
    .replace('__PGD__', stats.pagasDia).replace('__PGT__', stats.pagasTotal+' no total')
    .replace('__CRD__', stats.carrDia).replace('__CRT__', stats.carrTotal+' no total')
    .replace('__TOT__', stats.total).replace('__TTD__', stats.totalDia)
    .replace('__C0__', cls('todos')).replace('__C1__', cls('venda.paga')).replace('__C2__', cls('carrinho.abandonado'))
    .replace('__FEED__', feed);
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.send(out);
});
app.listen(3210, ()=>console.log('Hook collector Legacy on :3210'));

