const express = require('express');
const router = express.Router();
const { db } = require('./db');
const { esc, logAud, DEFAULT_TENANT } = require('./util');
const { makePinHash, pinFraco, pinEmUso } = require('./auth');
const { subValido, subLivre, criarTenant } = require('./tenants');
// Fase 4: rate limit do cadastro (mesmo padrao do login): 5 POSTs/hora por IP = bloqueio 1h
const REG_FAILS = new Map();
const REG_JANELA = 60*60*1000, REG_MAX = 5, REG_BLOQUEIO = 60*60*1000;
function regPrune(){ const now = Date.now(); for (const [k,e] of REG_FAILS){ if ((e.blockUntil && now >= e.blockUntil) || (!e.blockUntil && now - (e.window||now) > REG_JANELA)) REG_FAILS.delete(k); } }
function regBloqueado(ip){ regPrune(); const e = REG_FAILS.get(ip); return !!(e && e.blockUntil && Date.now() < e.blockUntil); }
function regConta(ip){
  const now = Date.now();
  const e = REG_FAILS.get(ip) || { count: 0, window: now };
  if (now - e.window > REG_JANELA){ e.window = now; e.count = 0; }
  e.count++;
  if (e.count >= REG_MAX) e.blockUntil = now + REG_BLOQUEIO;
  REG_FAILS.set(ip, e);
}
// ===================== CADASTRO SELF-SERVICE DE TENANT =====================
// Empresa cria conta: nome da empresa + subdominio + nome do admin + PIN forte.
// Tenant nasce 'pendente' e admin do tenant 'pendente' — so o master aprova.
function regCss(){
  return ':root{--gold:#d4a53f;--gold2:#eecf7e;--bg:#17251d;--card:#213629;--line:rgba(212,165,63,.25);--line-strong:rgba(212,165,63,.45);--txt:#f7f3e9;--mut:#a8b0a0;--danger-soft:#e08a8a}'
  + 'body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--txt);line-height:1.5}'
  + '.card{background:var(--card);border:1px solid var(--line-strong);border-radius:14px;padding:32px;box-shadow:0 4px 16px rgba(0,0,0,.4);min-width:320px;max-width:380px}'
  + 'h1{font-size:26px;font-weight:800;letter-spacing:5px;margin:0 0 4px;color:var(--gold2);text-align:center}'
  + 'p{color:var(--mut);font-size:12px;margin:0 0 20px;text-align:center;letter-spacing:1px}'
  + 'input{width:100%;padding:8px 12px;border-radius:8px;border:1px solid var(--line-strong);background:var(--bg);color:var(--txt);font-size:14px;outline:none;box-sizing:border-box;margin-top:10px}'
  + 'input:focus{border-color:var(--gold)}'
  + '.pill{margin-top:16px;width:100%;padding:8px;border:0;border-radius:8px;background:var(--gold);color:#1a1033;font-weight:600;font-size:14px;cursor:pointer}'
  + '.err{color:var(--danger-soft);font-size:12px;margin-top:12px;min-height:14px}'
  + '.hint{color:var(--mut);font-size:11px;margin-top:6px}'
  + 'a{color:var(--gold2);font-size:12px}';
}
function registrarPage(err){
  const msgs = {
    campo: 'Preencha todos os campos.',
    sub_invalido: 'Subdomínio inválido: use letras minúsculas, números e hífen (3-32 caracteres).',
    sub_uso: 'Este subdomínio já está em uso.',
    nome_uso: 'Este nome de admin já está em uso.',
    pin_uso: 'Este PIN já está em uso, escolha outro.',
    ratelimit: 'Muitas tentativas de cadastro deste IP. Tente novamente em 1 hora.',
    pin_fraco: 'PIN muito fraco: não use número repetido ou sequência (mínimo 6 dígitos).',
    ok: 'Cadastro enviado! A empresa será ativada após aprovação do administrador.'
  };
  return '<!doctype html><html lang=pt-BR><head><meta charset=utf-8><title>LEGACY · Registrar empresa</title><meta name=viewport content="width=device-width,initial-scale=1"><style>' + regCss() + '</style></head><body><div class=card>'
    + '<h1>LEGACY</h1><p>Registrar minha empresa</p>'
    + '<form method=post action=/registrar>'
    + '<input type=text name=empresa placeholder="Nome da empresa" required maxlength=120>'
    + '<input type=text name=subdominio placeholder="Subdomínio desejado (ex: minhaempresa)" required maxlength=32 pattern="[a-z0-9][a-z0-9-]{1,30}[a-z0-9]">'
    + '<div class=hint>Seu painel e webhook usarão este identificador. Endpoint do webhook: POST /hook/SEU-SUBDOMINIO/origem</div>'
    + '<input type=text name=nome placeholder="Nome do admin" required maxlength=60>'
    + '<input type=password name=pin placeholder="PIN do admin (mínimo 6 dígitos)" required inputmode=numeric maxlength=12>'
    + '<button class=pill>Enviar cadastro</button><div class=err>' + (msgs[err]||'') + '</div></form>'
    + '<p style="margin-top:20px"><a href="/">← voltar ao login</a></p></div></body></html>';
}
router.get('/registrar', (req,res)=>{
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.send(registrarPage(String(req.query.erro||'')));
});
router.post('/registrar', (req,res)=>{
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || '?';
  if (regBloqueado(ip)) return res.redirect(302, '/registrar?erro=ratelimit');
  regConta(ip);
  let raw = typeof req.body === 'string' ? req.body : (req.body||{});
  let f = raw;
  if (typeof raw === 'string'){ try { const p = new URLSearchParams(raw); f = { empresa:p.get('empresa'), subdominio:p.get('subdominio'), nome:p.get('nome'), pin:p.get('pin') }; } catch(e){ f = {}; } }
  const empresa = String(f.empresa||'').trim();
  const subdominio = String(f.subdominio||'').trim().toLowerCase();
  const nome = String(f.nome||'').trim();
  const pin = String(f.pin||'');
  const bad = (e)=> res.redirect(302, '/registrar?erro=' + e);
  if (!empresa || !nome || !subdominio || !pin) return bad('campo');
  if (!subValido(subdominio)) return bad('sub_invalido');
  if (!subLivre(subdominio)) return bad('sub_uso');
  if (db.prepare('SELECT 1 FROM users WHERE nome=?').get(nome)) return bad('nome_uso');
  if (pinFraco(pin)) return bad('pin_fraco');
  try {
    const stored = makePinHash(pin);
    const info = db.transaction(() => {
      if (!subLivre(subdominio)) return null;
      const t = criarTenant({ nome: empresa, subdominio });
      const r = db.prepare("INSERT INTO users (nome, pin_hash, salt, status, role, criado_em, tenant_id) VALUES (?,?,?,?,?,?,?)")
        .run(nome, stored, stored.split(':')[0], 'pendente', 'admin', new Date().toISOString(), t.id);
      return { t, userId: r.lastInsertRowid };
    }).immediate();
    if (!info) return bad('sub_uso');
    if (pinEmUso(pin)) return bad('pin_uso'); // raro (race): rollback manual
    logAud(nome, 'cadastro_criado', nome, 'tenant pendente: ' + empresa + ' (' + subdominio + ')', info.t.id);
    return res.redirect(302, '/registrar?erro=ok');
  } catch(e){ console.error('registrar:', e.message); return bad('campo'); }
});
module.exports = router;
