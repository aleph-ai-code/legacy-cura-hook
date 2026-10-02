// Template HTML do painel (CSS + JS do cliente inline, como no legado)
// ===================== PAINEL LEGACY (design pass: grid, ritmo, hierarquia) =====================
const PAGE = `<!doctype html><html lang=pt-BR><head><meta charset=utf-8><title>LEGACY · Painel de Vendas</title><meta name=viewport content="width=device-width,initial-scale=1"><style>
:root{--gold:#d4a53f;--gold2:#eecf7e;--bg:#17251d;--card:#213629;--line:rgba(212,165,63,.25);--txt:#f7f3e9;--mut:#a8b0a0}
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;margin:0;background:var(--bg);color:var(--txt);font-size:14px;line-height:1.5}
.wrap{max-width:1100px;margin:0 auto;padding:0 24px}
header{border-bottom:1px solid var(--line);padding:24px 0 16px}
.htop{display:flex;align-items:baseline;gap:16px;flex-wrap:wrap}
h1{margin:0;font-size:28px;font-weight:800;letter-spacing:5px;color:var(--gold2)}
.sub{font-size:17px;color:var(--mut)}
.live{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--mut)}
.usermenu{position:relative;display:inline-block}
.uname{background:none;border:0;color:var(--gold2);font-size:13px;font-weight:600;cursor:pointer;padding:4px 6px;line-height:1.4;font-family:inherit}
.umenu{position:absolute;right:0;top:100%;margin-top:4px;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:6px;min-width:180px;z-index:90;box-shadow:0 8px 24px rgba(0,0,0,.5);display:flex;flex-direction:column;gap:2px}
.umenu a{color:var(--txt);text-decoration:none;padding:8px 12px;border-radius:8px;font-size:13px;line-height:1.4}
.umenu a:hover{background:rgba(212,165,63,.12)}
.foot{display:flex;justify-content:center;align-items:center;gap:8px;padding:28px 0 18px;color:var(--mut);font-size:11px}
.footlbl{letter-spacing:3px;font-weight:700}
.footmut{letter-spacing:1px}
.foot .clock{font-size:11px}
.dot{width:8px;height:8px;border-radius:50%;background:#39d98a}
.clock{font-variant-numeric:tabular-nums;color:var(--mut)}
.who{color:var(--gold2);font-size:12px;font-weight:600}
.sair{color:var(--mut);font-size:12px;text-decoration:none;margin-left:8px}
.sair:hover{color:var(--gold2)}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:24px 0 8px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 20px;box-shadow:0 1px 3px rgba(0,0,0,.35)}
.kpi .lbl{font-size:12px;color:var(--mut)}
.kpi .val{font-size:28px;font-weight:700;margin-top:4px;color:var(--txt);line-height:1.2}
.kpi .sub{font-size:12px;color:var(--mut);margin-top:2px}
.bar{display:flex;gap:16px;align-items:center;padding:24px 0 16px}
.filters{display:flex;gap:8px}
.filters a{padding:8px 14px;border-radius:8px;border:1px solid var(--line);color:var(--gold2);text-decoration:none;font-size:13px;line-height:1.4}
.filters a:hover{background:rgba(212,165,63,.1)}
.filters a.on{background:var(--gold);color:#1a1033;font-weight:600;border-color:var(--gold)}
#q{flex:1;min-width:200px;background:var(--card);border:1px solid var(--line);color:var(--txt);border-radius:8px;padding:8px 12px;font-size:14px;line-height:1.4;outline:none}
#q:focus{border-color:var(--gold)}
.btn-csv{padding:8px 14px;border-radius:8px;border:1px solid var(--line);color:var(--gold2);text-decoration:none;font-size:13px;line-height:1.4;white-space:nowrap}
.btn-csv:hover{background:rgba(212,165,63,.1)}
.charts{display:grid;gap:16px;padding-bottom:8px}
.chart-card h3{margin:0 0 12px;font-size:16px;font-weight:600;color:var(--txt)}
.chart-card svg{width:100%;height:auto;display:block}
table.recov{width:100%;border-collapse:collapse;font-size:13px}
table.recov th{color:var(--mut);text-align:left;font-weight:600;padding:6px 8px;border-bottom:1px solid var(--line)}
table.recov td{padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.05)}
#feed{padding:16px 0 40px}
.ev{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.35)}
.ev .meta{color:var(--mut);font-size:12px;margin-bottom:8px}
.ev .fields{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.f{font-size:14px}
.f .who{font-weight:600}
.f .prod{color:var(--mut);font-size:13px}
.f a{color:var(--gold2);text-decoration:none}
.badge{padding:2px 8px;border-radius:6px;font-size:12px;font-weight:600}
.b-gold{background:rgba(212,165,63,.15);color:var(--gold2);border:1px solid var(--line)}
.b-orange{background:rgba(205,137,0,.15);color:#ffc46b;border:1px solid rgba(205,137,0,.35)}
.b-gray{background:rgba(255,255,255,.05);color:var(--mut);border:1px solid rgba(255,255,255,.1)}
.b-green{background:rgba(57,217,138,.12);color:#7fe0ae;border:1px solid rgba(57,217,138,.3)}
.b-blue{background:rgba(80,150,255,.12);color:#8fbaff;border:1px solid rgba(80,150,255,.3)}
.hl{margin-top:8px;font-size:16px;font-weight:600;color:var(--gold2)}
.btn{display:inline-block;margin-top:8px;background:var(--gold);color:#1a1033;font-weight:600;padding:8px 16px;border-radius:8px;text-decoration:none;font-size:13px;border:0;cursor:pointer}
.ob{margin-top:10px;display:flex;flex-direction:column;gap:6px}
.ob label{display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer}
.ob input[type=checkbox]{width:16px;height:16px;accent-color:#d4a53f;cursor:pointer}
.ob .doneby{color:var(--mut);font-size:12px}
.claim{margin-top:10px;font-size:13px}
.claim .assumed{color:#8fbaff;font-weight:600}
.opbtns{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap}
.opbtns button{padding:6px 12px;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--gold2);font-size:12px;font-weight:600;cursor:pointer}
.opbtns button:hover{background:rgba(212,165,63,.1)}
.opbtns button.ok{border-color:rgba(57,217,138,.4);color:#7fe0ae}
.opbtns button.no{border-color:rgba(224,138,138,.4);color:#e08a8a}
.opbtns input{background:#17251d;border:1px solid var(--line);color:var(--txt);border-radius:8px;padding:6px 10px;font-size:12px;outline:none}
.nota{margin-top:6px;font-size:12px;color:var(--mut)}
.chartbar{display:flex;padding:12px 0 0;gap:8px}
.btn-charts{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;border:1px solid var(--line);color:var(--gold2);text-decoration:none;font-size:13px;cursor:pointer;background:transparent;line-height:1.4}
.btn-charts:hover{background:rgba(212,165,63,.1)}
.btn-charts.on{background:var(--gold);color:#1a1033;font-weight:600;border-color:var(--gold)}
.charts{position:fixed;top:64px;left:50%;transform:translateX(-50%);width:min(1060px,94vw);max-height:78vh;overflow:auto;z-index:60;display:none;background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:16px 20px;box-shadow:0 12px 40px rgba(0,0,0,.6)}
.charts.open{display:grid;gap:16px}
.charts-head{display:flex;align-items:center;justify-content:space-between;margin:0 0 4px}
.charts-head h3{margin:0;font-size:16px;color:var(--gold2)}
.btn-close{padding:6px 12px;border-radius:8px;border:1px solid var(--line);background:var(--gold);color:#1a1033;font-weight:600;font-size:13px;cursor:pointer;text-decoration:none;line-height:1.4}
@media(max-width:640px){.charts.open{inset:0;top:0;left:0;transform:none;width:100%;max-height:100%;border-radius:0;padding:12px 16px}}
.btn:hover{filter:brightness(1.08)}
.rkbtns{display:flex;gap:8px;margin:4px 0}
.rkbtns a{padding:6px 16px;border-radius:999px;border:1px solid var(--line);color:var(--gold2);text-decoration:none;font-size:12px;font-weight:600;line-height:1.4}
.rkbtns a:hover{background:rgba(212,165,63,.1)}
.rkbtns a.on{background:var(--gold);color:#1a1033;border-color:var(--gold);font-weight:700}
.tabs{display:flex;gap:8px;margin:14px 0 0;flex-wrap:wrap}
.tabs a.tab{padding:8px 20px;border-radius:999px;border:1px solid var(--line);color:var(--gold2);text-decoration:none;font-size:13px;font-weight:600;line-height:1.4}
.tabs a.tab:hover{background:rgba(212,165,63,.1)}
.tabs a.tab.on{background:var(--gold);color:#1a1033;border-color:var(--gold);font-weight:700}
[hidden]{display:none!important}
details{margin-top:8px}summary{cursor:pointer;color:var(--mut);font-size:12px}pre{margin:8px 0 0;white-space:pre-wrap;word-break:break-all;font-size:12px;color:#cfd8c6;background:#122019;border-radius:8px;padding:12px}
.empty{color:var(--mut);text-align:center;padding:40px 0;font-size:14px}
@media(max-width:900px){.kpis{grid-template-columns:repeat(2,1fr)}}
@media(max-width:640px){
.wrap{padding:0 16px}
.htop{gap:8px}h1{font-size:20px;letter-spacing:3px}
.kpis{gap:8px;padding:16px 0 8px}
.bar{flex-direction:column;align-items:stretch;gap:8px}
#q{min-width:0}
.charts{gap:8px}
.ev{padding:12px 16px;margin-bottom:8px}
}
</style></head><body>
<header><div class=wrap><div class=htop><h1>LEGACY</h1><span class=sub>Painel de Vendas</span><div class=live>__ADMINBADGE__<form action=/logout method=post style=display:none id=lo></form><div class=usermenu><button type=button class=uname id=uname-btn>▾ __USER__</button><div class=umenu id=umenu hidden><a href="#" onclick="toggleUserMenu(false);trocarPin();return false">🔑 Trocar meu PIN</a><a href="#" onclick="document.getElementById('lo').submit();return false">🚪 Sair</a></div></div></div><nav class=tabs>__TABS__</nav></div></header>
<footer class=foot><span class=dot></span><span class=footlbl>AO VIVO</span><span class=clock id=clock>--:--:--</span><span class=footmut>· Fortaleza</span></footer>
<div class=wrap><div id=sec-vendas>
<div class=kpis>
<div class="card kpi"><div class=lbl>Faturamento hoje</div><div class=val>__FAT__</div><div class=sub>__PGD__ vendas pagas</div></div>
<div class="card kpi"><div class=lbl>Vendas pagas hoje</div><div class=val>__PGD__</div><div class=sub>__PGT__ no total</div></div>
<div class="card kpi"><div class=lbl>Carrinhos abandonados hoje</div><div class=val>__CRD__</div><div class=sub>__CRT__ no total</div></div>
<div class="card kpi"><div class=lbl>Eventos hoje</div><div class=val>__TTD__</div><div class=sub>__TOT__ no total</div></div>
<div class="card kpi"><div class=lbl>⚠️ Onboarding pendente</div><div class=val>__OBP__</div><div class=sub>vendas pagas sem checklist completo</div></div>
<div class="card kpi"><div class=lbl>🛠️ Recuperação</div><div class=val>__RCV__</div><div class=sub>__RCVC__ conquistados · __RCVP__% conversão</div></div>
</div>
<div class=chartbar><a id=btn-charts class=btn-charts href=#>📈 Gráficos · __CHARTMINI__</a><a id=btn-ranking class=btn-charts href=#>🏆 Ranking</a></div>
<div class=bar>
<div class=filters><a href="/?evento=todos" class="__C0__">Todos</a><a href="/?evento=venda.paga" class="__C1__">Pagas</a><a href="/?evento=carrinho.abandonado" class="__C2__">Abandonados</a></div>
<input id=q placeholder="Buscar por nome, whatsapp ou produto…" oninput="fltr()">
<a class=btn-csv href="/export.csv?evento=__EVENC__">Exportar CSV</a>
</div>
<div id=feed>__FEED__</div></div>
<div id=sec-admin hidden>__ADMIN__</div>
<div id=sec-auditoria hidden>__AUDIT__</div>
<div class=charts id=charts-drawer><div class=charts-head><h3>📈 Gráficos</h3><a id=charts-close class=btn-close href=#>✕ Fechar</a></div>__CHART__</div>
__RANK__
</div>
<script>
function setTab(t){var ok=false;document.querySelectorAll('.tab').forEach(function(a){var on=a.dataset.tab===t;if(on)ok=true;a.classList.toggle('on',on)});if(!ok)t='vendas';['sec-vendas','sec-admin','sec-auditoria'].forEach(function(id){var s=document.getElementById(id);if(s)s.hidden=id!=='sec-'+t});sessionStorage.setItem('legacy_tab',t)}
(function(){var t=sessionStorage.getItem('legacy_tab')||'vendas';setTab(document.querySelector('.tab[data-tab="'+t+'"]')?t:'vendas')})();
function trocarPin(){var a=prompt('PIN atual:');if(!a)return;var n1=prompt('Novo PIN (mínimo 6 dígitos):');if(!n1)return;if(!/^\d{6,}$/.test(n1)){alert('O novo PIN precisa ter no mínimo 6 dígitos (apenas números).');return}var n2=prompt('Confirme o novo PIN:');if(n1!==n2){alert('Os PINs não conferem.');return}fetch('/me/trocar_pin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin_atual:a,pin_novo:n1})}).then(function(r){return r.json()}).then(function(j){if(j.ok){alert('PIN alterado com sucesso!')}else{alert(j.erro==='pin_atual_incorreto'?'PIN atual incorreto.':(j.erro==='pin_fraco'?(j.msg||'PIN muito fraco: nao use numero repetido ou sequencia.'):(j.msg||j.erro||'Erro')))}}).catch(function(){alert('Erro de rede')})}
function toggleUserMenu(force){var m=document.getElementById('umenu');if(!m)return;var open=(force===true)||(force!==false&&!m.hidden);m.hidden=open?true:false}
(function(){var b=document.getElementById('uname-btn');if(b)b.addEventListener('click',function(e){e.stopPropagation();toggleUserMenu()});document.addEventListener('click',function(e){var m=document.getElementById('umenu');if(m&&!m.hidden&&!m.contains(e.target))toggleUserMenu(false)})})();
function nowClock(){return new Date().toLocaleTimeString('pt-BR',{timeZone:'America/Fortaleza'})}
setInterval(function(){var c=document.getElementById('clock');if(c)c.textContent=nowClock()},1000);
(function(){var c=document.getElementById('clock');if(c)c.textContent=nowClock()})();
const qi=document.getElementById('q');qi.value=sessionStorage.getItem('legacy_q')||'';
function fltr(){const q=qi.value.toLowerCase();sessionStorage.setItem('legacy_q',q);document.querySelectorAll('.ev').forEach(el=>{el.style.display=el.dataset.s.includes(q)?'':'none'})}
fltr();
function postAcao(url,data){fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json()).then(j=>{if(j.ok){location.reload()}else{alert(j.erro||'Erro')}}).catch(e=>alert('Erro de rede'))}
function doAcao(ev,acao,detalhe){postAcao('/api/acao',{event_id:ev,acao:acao,detalhe:detalhe})}
function doAdmin(act,nome){postAcao('/admin/'+act,{nome:nome})}
function undoAcao(ev,acao){postAcao('/api/acao/toggle',{event_id:ev,acao:acao})}
(function(){
function adminPost(url,data,cb){fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json()).then(j=>{if(j.ok){if(cb){cb(j)}else{location.reload()}}else{alert(j.erro||'Erro')}}).catch(e=>alert('Erro de rede'))}
function admEditarNome(nome){var n=prompt('Novo nome para '+nome+':',nome);if(n&&n.trim()&&n!==nome)adminPost('/admin/editar_nome',{nome:nome,novo_nome:n.trim()})}
function admResetPin(nome){if(confirm('Resetar PIN de '+nome+'? Um novo PIN de 6 dígitos será gerado.'))adminPost('/admin/resetar_pin',{nome:nome},function(j){alert('Novo PIN de '+nome+': '+j.pin)})}
function admBloquear(nome,bloq){adminPost('/admin/bloquear',{nome:nome,bloquear:bloq})}
function admExcluir(nome){if(confirm('Excluir usuário '+nome+'? As ações antigas permanecem na auditoria.'))adminPost('/admin/excluir',{nome:nome})}
var drawer=document.getElementById('charts-drawer'),btnC=document.getElementById('btn-charts');
function applyCharts(){var open=sessionStorage.getItem('legacy_charts')==='1';drawer.classList.toggle('open',open);btnC.classList.toggle('on',open);}
btnC.addEventListener('click',function(e){e.preventDefault();sessionStorage.setItem('legacy_charts',sessionStorage.getItem('legacy_charts')==='1'?'0':'1');applyCharts();});
document.getElementById('charts-close').addEventListener('click',function(e){e.preventDefault();sessionStorage.setItem('legacy_charts','0');applyCharts();});
applyCharts();
})();
(function(){
var rdrawer=document.getElementById('ranking-drawer'),btnR=document.getElementById('btn-ranking');
if(!rdrawer||!btnR)return;
function applyRankP(){var p=sessionStorage.getItem('legacy_rankp')||'hoje';document.getElementById('rk-hoje').hidden=p!=='hoje';document.getElementById('rk-d7').hidden=p!=='d7';document.querySelectorAll('.rk-btn').forEach(function(b){b.classList.toggle('on',b.dataset.p===p)})}
function applyRank(){var open=sessionStorage.getItem('legacy_rank')==='1';rdrawer.classList.toggle('open',open);btnR.classList.toggle('on',open);applyRankP()}
btnR.addEventListener('click',function(e){e.preventDefault();sessionStorage.setItem('legacy_rank',sessionStorage.getItem('legacy_rank')==='1'?'0':'1');applyRank();});
document.getElementById('rank-close').addEventListener('click',function(e){e.preventDefault();sessionStorage.setItem('legacy_rank','0');applyRank();});
document.querySelectorAll('.rk-btn').forEach(function(b){b.addEventListener('click',function(e){e.preventDefault();sessionStorage.setItem('legacy_rankp',b.dataset.p);applyRankP();})});
applyRank();
})();
setTimeout(()=>{location.href=location.pathname+(location.search||'')},15000);
</script></body></html>`;

module.exports = { PAGE };
