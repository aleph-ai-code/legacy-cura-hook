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
    // duplicado: registra marcado, mas não conta como novo
    ev.dedup = true; ev.dedupKey = key; a.push(ev); save(a);
    return res.status(200).json({ok:true, dedupe:true});
  }
  ev.dedupKey = key; a.push(ev); save(a);
  res.status(200).json({ok:true});
});

// Stats: hoje 00:00 local
function startOfToday(){ const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); }
function fmtBRL(centavos, moeda){
  const cur = moeda || 'BRL';
  try { return (centavos/100).toLocaleString('pt-BR',{style:'currency',currency:cur}); } catch(e){ return 'R$ ' + (centavos/100).toFixed(2); }
}
const BADGES = {
  'venda.paga': '<span class="badge b-green">✅ venda.paga</span>',
  'carrinho.abandonado': '<span class="badge b-orange">🛒 carrinho.abandonado</span>'
};

// Painel com filtro ?evento=
app.get('/', (req,res)=>{
  const filtro = req.query.evento || 'todos';
  const all = load().slice(-5000);
  const t0 = startOfToday();
  const stats = {
    pagasDia: all.filter(e=>!e.dedup && e.body && e.body.webhook_evento==='venda.paga' && new Date(e.ts).getTime()>=t0).length,
    pagasTotal: all.filter(e=>!e.dedup && e.body && e.body.webhook_evento==='venda.paga').length,
    carrDia: all.filter(e=>!e.dedup && e.body && e.body.webhook_evento==='carrinho.abandonado' && new Date(e.ts).getTime()>=t0).length,
    carrTotal: all.filter(e=>!e.dedup && e.body && e.body.webhook_evento==='carrinho.abandonado').length,
    totalDia: all.filter(e=>!e.dedup && new Date(e.ts).getTime()>=t0).length,
    total: all.filter(e=>!e.dedup).length
  };
  let a = all.slice(-200).reverse();
  if (filtro==='venda.paga' || filtro==='carrinho.abandonado') a = a.filter(e=>e.body && e.body.webhook_evento===filtro);

  const card = (e)=>{
    const b = e.body || {};
    const cli = b.cliente || {};
    const prod = b.produto || {};
    const venda = b.venda || {};
    const c = b.carrinho || {};
    const badge = BADGES[b.webhook_evento] || (b.webhook_evento ? '<span class="badge b-gray">'+esc(b.webhook_evento)+'</span>' : '<span class="badge b-gray">outro</span>');
    let extra = '';
    if (b.webhook_evento === 'carrinho.abandonado'){
      const mins = c.criado_em ? Math.floor((Date.now() - new Date(c.criado_em).getTime())/60000) : (e.minutos_desde_criacao != null ? e.minutos_desde_criacao : null);
      extra = '<div class=hl>💰 ' + fmtBRL(c.total_venda||0, c.moeda) + (mins!=null ? ' · ⏱ ' + esc(mins) + ' min desde criação' : '') + '</div>';
      if (c.link_recuperacao) extra += '<div class=hl>🔗 <a class=btn href="' + esc(c.link_recuperacao) + '" target="_blank" rel="noopener">Recuperar carrinho</a></div>';
    }
    return '<div class=ev><div class=meta>#'+esc(e.id)+' · <b>'+esc(e.origem)+'</b> · '+esc(e.ts)+' · IP '+esc(e.ip)+(e.dedup?' <span class="badge b-gray">🔁 dedup</span>':'')+'</div>'
      + '<div class=fields>'+badge
      + (cli.nome?' <span class=f>👤 '+esc(cli.nome)+'</span>':'')
      + (cli.whatsapp?' <span class=f>📱 '+esc(cli.whatsapp)+'</span>':'')
      + (prod.nome?' <span class=f>📦 '+esc(prod.nome)+'</span>':'')
      + (venda.forma_pagamento?' <span class=f>💳 '+esc(venda.forma_pagamento)+'</span>':'')
      + '</div>' + extra
      + '<details><summary>payload</summary><pre>'+JSON.stringify(b,null,2).replace(/</g,'&lt;')+'</pre></details></div>';
  };

  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.send('<!doctype html><html><head><meta charset=utf-8><title>Hook Collector — Legacy Cura</title><meta name=viewport content="width=device-width,initial-scale=1">'
  +'<style>body{font-family:system-ui;margin:0;background:#0d1117;color:#e6edf3}header{padding:16px 24px;background:#161b22}h1{font-size:18px;margin:0 0 10px}.stats{display:flex;gap:10px;flex-wrap:wrap}.stat{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:8px 14px;font-size:14px}.stat b{color:#58a6ff;display:block;font-size:18px}main{padding:16px}.ev{background:#161b22;border:1px solid #30363d;border-radius:8px;margin-bottom:10px;padding:12px}.ev b{color:#58a6ff}.meta{color:#8b949e;font-size:12px;margin-bottom:6px}.fields{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.f{background:#21262d;padding:3px 8px;border-radius:6px;font-size:13px}.badge{padding:3px 8px;border-radius:6px;font-size:12px;font-weight:600}.b-green{background:#238636;color:#fff}.b-orange{background:#9e6a03;color:#fff}.b-gray{background:#30363d;color:#8b949e}.hl{margin-top:6px;font-size:14px}.btn{display:inline-block;background:#238636;color:#fff;padding:6px 12px;border-radius:6px;text-decoration:none}a.f{color:#58a6ff;text-decoration:none}.filters{margin-bottom:12px}.filters a{color:#58a6ff;margin-right:12px;text-decoration:none}pre{margin:8px 0 0;white-space:pre-wrap;word-break:break-all;font-size:12px;color:#a5d6ff}summary{cursor:pointer;color:#8b949e;font-size:12px}</style></head>'
  +'<body><header><h1>🎯 Hook Collector — Mentalidade de Cura</h1><div class=stats>'
  +'<div class=stat>✅ Vendas pagas<b>'+stats.pagasDia+' hoje · '+stats.pagasTotal+' total</b></div>'
  +'<div class=stat>🛒 Carrinhos abandonados<b>'+stats.carrDia+' hoje · '+stats.carrTotal+' total</b></div>'
  +'<div class=stat>📈 Total<b>'+stats.totalDia+' hoje · '+stats.total+' total</b></div>'
  +'</div></header><main>'
  +'<div class=filters>Filtrar: <a href="/?evento=todos">todos</a> · <a href="/?evento=venda.paga">venda.paga</a> · <a href="/?evento=carrinho.abandonado">carrinho.abandonado</a></div>'
  +(a.map(card).join('') || '<p>Nenhum evento ainda. Faça um POST em /hook/teste.</p>')
  +'</main><script>setTimeout(()=>location.reload(),15000)</script></body></html>');
});
app.listen(3210, ()=>console.log('Hook collector on :3210'));
