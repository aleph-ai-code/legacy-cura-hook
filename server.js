const express = require('express');
const fs = require('fs');
const app = express();
const DATA = '/data/events.json';
function load(){ try{ return JSON.parse(fs.readFileSync(DATA,'utf8')); }catch(e){ return []; } }
function save(a){ fs.mkdirSync('/data',{recursive:true}); fs.writeFileSync(DATA, JSON.stringify(a.slice(-5000))); }
app.use(express.json({limit:'2mb'}));
app.use(express.text({type:'*/*', limit:'2mb'}));
// Recebe QUALQUER POST em /hook/:origem — responde 200 sempre
app.post('/hook/:origem', (req,res)=>{
  const ev = { id: Date.now()+'-'+Math.random().toString(36).slice(2,7), origem: req.params.origem, ts: new Date().toISOString(), ip: req.ip, headers: req.headers, body: req.body };
  const a = load(); a.push(ev); save(a);
  res.status(200).json({ok:true});
});
// Painel
app.get('/', (req,res)=>{
  const a = load().slice(-200).reverse();
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.send(`<!doctype html><html><head><meta charset=utf-8><title>Hook Collector — Legacy Cura</title><meta name=viewport content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui;margin:0;background:#0d1117;color:#e6edf3}header{padding:16px 24px;background:#161b22;display:flex;justify-content:space-between;align-items:center}h1{font-size:18px;margin:0}.pill{background:#238636;color:#fff;padding:4px 10px;border-radius:99px;font-size:13px}main{padding:16px}.ev{background:#161b22;border:1px solid #30363d;border-radius:8px;margin-bottom:10px;padding:12px}.ev b{color:#58a6ff}.meta{color:#8b949e;font-size:12px;margin-bottom:6px}pre{margin:0;white-space:pre-wrap;word-break:break-all;font-size:12px;color:#a5d6ff}</style></head>
<body><header><h1>🎯 Hook Collector — Mentalidade de Cura</h1><span class=pill>${a.length} eventos (últimos 200)</span></header><main>
${a.map(e=>`<div class=ev><div class=meta>#${e.id} · <b>${e.origem}</b> · ${e.ts} · IP ${e.ip}</div><pre>${JSON.stringify(e.body,null,2).replace(/</g,'&lt;')}</pre></div>`).join('') || '<p>Nenhum evento ainda. Faça um POST em /hook/teste.</p>'}
</main><script>setTimeout(()=>location.reload(),15000)</script></body></html>`);
});
app.listen(3210, ()=>console.log('Hook collector on :3210'));
