// Fase 4: landing page institucional publica (/sobre) — estatica, sem dados reais
const express = require('express');
const router = express.Router();

function sobrePage(){
  return '<!doctype html><html lang=pt-BR><head><meta charset=utf-8><title>LEGACY · Painel de vendas via webhook</title>'
  + '<meta name=viewport content="width=device-width,initial-scale=1"><meta name=description content="LEGACY: painel multi-empresa de vendas e recuperacao de carrinho via webhook.">'
  + '<style>:root{--gold:#d4a53f;--gold2:#eecf7e;--bg:#17251d;--card:#213629;--line:rgba(212,165,63,.25);--line-strong:rgba(212,165,63,.45);--txt:#f7f3e9;--mut:#a8b0a0}'
  + '*{box-sizing:border-box}body{font-family:system-ui,sans-serif;margin:0;background:var(--bg);color:var(--txt);line-height:1.6}'
  + 'header,footer{padding:24px 20px;max-width:880px;margin:0 auto}header{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}'
  + 'h1{font-size:28px;letter-spacing:6px;color:var(--gold2);margin:0}main{max-width:880px;margin:0 auto;padding:24px 20px 48px}'
  + '.hero{text-align:center;padding:48px 0 32px}.hero h2{font-size:30px;margin:0 0 12px;color:var(--txt)}.hero p{color:var(--mut);max-width:560px;margin:0 auto}'
  + '.cta{display:inline-block;margin-top:24px;padding:12px 26px;border-radius:10px;background:var(--gold);color:#1a1033;font-weight:700;text-decoration:none;font-size:15px}'
  + '.cta:hover{background:var(--gold2)}.ghost{color:var(--gold2);text-decoration:none;font-size:13px;margin-left:14px}'
  + '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;margin-top:36px}'
  + '.feat{background:var(--card);border:1px solid var(--line-strong);border-radius:14px;padding:20px}.feat h3{margin:0 0 8px;font-size:16px;color:var(--gold2)}.feat p{margin:0;color:var(--mut);font-size:13px}'
  + '.planos{margin-top:40px}.planos table{width:100%;border-collapse:collapse;background:var(--card);border-radius:12px;overflow:hidden}'
  + '.planos th,.planos td{padding:10px 14px;text-align:left;border-bottom:1px solid var(--line);font-size:14px}.planos th{color:var(--gold2)}'
  + 'footer{color:var(--mut);font-size:12px;text-align:center}a{color:var(--gold2)}'
  + '@media(max-width:600px){.hero h2{font-size:24px}}</style></head><body>'
  + '<header><h1>LEGACY</h1><a class=ghost href="/registrar">Registrar empresa →</a></header><main>'
  + '<section class=hero><h2>Vendas e recuperação de carrinho, direto do webhook pro painel</h2>'
  + '<p>O LEGACY recebe os webhooks da sua operação, organiza as vendas por empresa e dá ao seu time um painel simples pra acompanhar cada lead — com onboarding checkado e recuperação de carrinho em time.</p>'
  + '<a class=cta href="/registrar">Criar conta grátis</a><a class=ghost href="/registrar">já tenho conta</a></section>'
  + '<section class=grid>'
  + '<div class=feat><h3>🔗 Webhook por empresa</h3><p>Cada empresa tem seu próprio endpoint <code>POST /hook/sua-empresa/origem</code>. Sem misturar dados entre operações.</p></div>'
  + '<div class=feat><h3>🏢 Multi-empresa</h3><p>Um painel pra várias operações, com isolamento total de dados, usuários e auditoria por empresa.</p></div>'
  + '<div class=feat><h3>🛒 Recuperação em time</h3><p>Carrinho abandonado? Assuma o lead, registre o resultado e acompanhe a taxa de conquista do time.</p></div>'
  + '<div class=feat><h3>✅ Onboarding com checklist</h3><p>Boas-vindas, remoção VIP e onboarding concluído: cada venda paga tem status claro pra ninguém passar batido.</p></div>'
  + '</section>'
  + '<section class=planos><h3 style="color:var(--gold2)">Planos</h3>'
  + '<table><tr><th>Plano</th><th>Usuários</th><th>Eventos/mês</th><th>Recursos</th></tr>'
  + '<tr><td>Free (trial 30 dias)</td><td>até 3</td><td>500</td><td>painel completo</td></tr>'
  + '<tr><td>Básico</td><td>até 10</td><td>5.000</td><td>+ export CSV</td></tr>'
  + '<tr><td>Pro</td><td>até 50</td><td>50.000</td><td>+ API</td></tr></table>'
  + '<p style="color:var(--mut);font-size:12px">A conta nasce em avaliação gratuita e é ativada após confirmação do administrador.</p></section>'
  + '<section style="text-align:center;margin-top:40px"><a class=cta href="/registrar">Criar conta grátis</a></section>'
  + '</main><footer>LEGACY · painel de vendas via webhook · <a href="/registrar">registrar</a></footer></body></html>';
}

router.get('/sobre', (req,res)=>{
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.send(sobrePage());
});

module.exports = router;
