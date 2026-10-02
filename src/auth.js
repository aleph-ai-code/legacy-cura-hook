const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { AUTH_SECRET, AUTH_COOKIE } = require('./config');
const { db } = require('./db');
const { logAud } = require('./util');
// ===================== USUARIOS + LOGIN (nome + PIN) =====================
function hashPin(pin, salt){ return crypto.scryptSync(String(pin), salt, 64).toString('hex'); }
function makePinHash(pin){ const salt = crypto.randomBytes(16).toString('hex'); return salt + ':' + hashPin(pin, salt); }
function checkPin(pin, stored){ try { const parts = String(stored).split(':'); const h = hashPin(pin, parts[0]); return !!parts[1] && crypto.timingSafeEqual(Buffer.from(h,'hex'), Buffer.from(parts[1],'hex')); } catch(e){ return false; } }
function pinFraco(pin){
  const p = String(pin==null?'':pin);
  if (!/^\d{6,}$/.test(p)) return 'formato';
  if (/^(\d)\1+$/.test(p)) return 'repetido';
  let asc=true, desc=true;
  for (let i=1;i<p.length;i++){ if (+p[i] !== (+p[i-1]+1)%10) asc=false; if (+p[i] !== (+p[i-1]+9)%10) desc=false; }
  if (asc || desc) return 'sequencia';
  return null;
}
const MSG_PIN_FRACO = 'PIN muito fraco: nao use numero repetido ou sequencia.';
const MSG_PIN_EM_USO = 'Este PIN ja esta em uso, escolha outro.';
// PIN precisa ser UNICO entre os usuarios (login e feito so pelo PIN)
function pinEmUso(pin, excluirId){
  for (const u of db.prepare('SELECT id, pin_hash FROM users').all()){
    if (excluirId != null && u.id === excluirId) continue;
    if (checkPin(pin, u.pin_hash)) return true;
  }
  return false;
}
// Rate limit do login: 5 erros em 5 min = bloqueio de 15 min por IP
const LOGIN_FAILS = new Map();
const RL_JANELA = 5*60*1000, RL_MAX = 5, RL_BLOQUEIO = 15*60*1000;
function loginPrune(){ const now = Date.now(); for (const [k,e] of LOGIN_FAILS){ if ((e.blockUntil && now >= e.blockUntil) || (!e.blockUntil && now - (e.window||now) > RL_JANELA)) LOGIN_FAILS.delete(k); } }
function loginBloqueado(ip){ loginPrune(); const e = LOGIN_FAILS.get(ip); return !!(e && e.blockUntil && Date.now() < e.blockUntil); }
function loginRegFail(ip){
  const now = Date.now();
  const e = LOGIN_FAILS.get(ip) || { count: 0, window: now };
  if (now - e.window > RL_JANELA){ e.window = now; e.count = 0; }
  e.count++;
  if (e.count >= RL_MAX) e.blockUntil = now + RL_BLOQUEIO;
  LOGIN_FAILS.set(ip, e);
}
function loginRegOk(ip){ LOGIN_FAILS.delete(ip); }
function safeEq(a,b){ const A=Buffer.from(String(a==null?'':a)), B=Buffer.from(String(b==null?'':b)); return A.length===B.length && crypto.timingSafeEqual(A,B); }
const usersCount = () => db.prepare('SELECT COUNT(*) c FROM users').get().c;
function sign(payload){ return crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex'); }
function makeToken(user){
  const exp = Date.now() + 30*24*3600*1000;
  const payload = Buffer.from(JSON.stringify({ id: user.id, nome: user.nome, exp })).toString('base64url');
  return payload + '.' + sign(payload);
}
function parseToken(tok){
  try {
    const s = String(tok);
    const idx = s.indexOf('.');
    if (idx < 0) return null;
    const payload = s.slice(0, idx), sig = s.slice(idx+1);
    if (!safeEq(sig, sign(payload))) return null;
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!d.exp || d.exp < Date.now()) return null;
  const u = db.prepare('SELECT id, nome, status, role FROM users WHERE id=?').get(d.id);
  return (u && u.nome === d.nome && u.status === 'ativo') ? u : null;
  } catch(e){ return null; }
}
function getAuth(req){
  const re = new RegExp('(?:^|;\\s*)' + AUTH_COOKIE + '=([A-Za-z0-9_.-]+)');
  const m = re.exec(req.headers.cookie || '');
  return m ? parseToken(m[1]) : null;
}
function setAuthCookie(res, user){ res.setHeader('Set-Cookie', AUTH_COOKIE + '=' + makeToken(user) + '; Max-Age=2592000; HttpOnly; Path=/; SameSite=Lax; Secure'); }
function formFields(req){
  const raw = typeof req.body === 'string' ? req.body : (req.body && typeof req.body === 'object' ? req.body : {});
  if (typeof raw === 'string'){ try { const p = new URLSearchParams(raw); return { nome: p.get('nome')||'', pin: p.get('pin')||'', pin_admin: p.get('pin_admin')||'' }; } catch(e){ return { nome:'', pin:'', pin_admin:'' }; } }
  return { nome: raw.nome||'', pin: raw.pin||'', pin_admin: raw.pin_admin||'' };
}
router.post('/login', (req,res)=>{
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || '?';
  if (loginBloqueado(ip)){
    logAud(null, 'login_rate_limit', ip, 'bloqueio temporario ativo');
    return res.redirect(302, '/?erro=ratelimit');
  }
  const f = formFields(req);
  const pin = String(f.pin||'');
  if (!pin) return res.redirect(302, '/?erro=1');
  let match = null;
  for (const u of db.prepare('SELECT * FROM users ORDER BY id ASC').all()){
    if (checkPin(pin, u.pin_hash)){ match = u; break; }
  }
  if (match && match.status === 'pendente') return res.redirect(302, '/?erro=pendente');
  if (match && match.status === 'bloqueado'){ logAud(match.nome, 'login_bloqueado', match.nome); return res.redirect(302, '/?erro=bloqueado'); }
  if (match && match.status === 'ativo'){ loginRegOk(ip); logAud(match.nome, 'login_ok', match.nome); setAuthCookie(res, match); return res.redirect(302, '/'); }
  loginRegFail(ip);
  logAud(null, 'login_falho', ip, 'PIN nao encontrado');
  return res.redirect(302, '/?erro=1');
});
function rlGuard(req,res){ if (loginBloqueado(req.ip || (req.socket && req.socket.remoteAddress) || '?')){ res.redirect(302, '/?erro=ratelimit'); return false; } return true; }
router.post('/login/criar', (req,res)=>{
  if (!rlGuard(req,res)) return;
  const f = formFields(req);
  const nome = String(f.nome||'').trim();
  if (usersCount() > 0 || !nome || pinFraco(f.pin)){ loginRegFail(req.ip || '?'); return res.redirect(302, '/?erro=' + (pinFraco(f.pin)==='formato' ? '1' : 'fraco') + '&modo=criar'); }
  loginRegOk(req.ip || '?');
  try {
    const stored = makePinHash(f.pin);
    const info = db.transaction(() => {
      if (pinEmUso(f.pin)) return null;
      return db.prepare("INSERT INTO users (nome, pin_hash, salt, status, role, criado_em) VALUES (?,?,?,?,?,?)").run(nome, stored, stored.split(':')[0], 'ativo', 'admin', new Date().toISOString());
    }).immediate();
    if (!info) return res.redirect(302, '/?erro=pin_uso&modo=criar');
    logAud(nome, 'cadastro_criado', nome, 'primeiro acesso (admin)');
    setAuthCookie(res, { id: info.lastInsertRowid, nome });
    return res.redirect(302, '/');
  } catch(e){ return res.redirect(302, '/?erro=1&modo=criar'); }
});
router.post('/login/novo', (req,res)=>{
  if (!rlGuard(req,res)) return;
  const f = formFields(req);
  const nome = String(f.nome||'').trim();
  const fraco = pinFraco(f.pin);
  if (!nome || fraco){ loginRegFail(req.ip || '?'); return res.redirect(302, '/?erro=' + (fraco==='formato' ? 'existe' : 'fraco')); }
  loginRegOk(req.ip || '?');
  try {
    const stored = makePinHash(f.pin);
    const info = db.transaction(() => {
      if (pinEmUso(f.pin)) return null;
      return db.prepare("INSERT INTO users (nome, pin_hash, salt, status, role, criado_em) VALUES (?,?,?,?,?,?)").run(nome, stored, stored.split(':')[0], 'pendente', 'membro', new Date().toISOString());
    }).immediate();
    if (!info) return res.redirect(302, '/?erro=pin_uso');
    logAud(nome, 'cadastro_criado', nome, 'aguardando aprovacao');
    return res.redirect(302, '/?erro=ok');
  } catch(e){ return res.redirect(302, '/?erro=existe'); }
});
router.post('/logout', (req,res)=>{
  res.setHeader('Set-Cookie', AUTH_COOKIE + '=; Max-Age=0; HttpOnly; Path=/; SameSite=Lax; Secure');
  return res.redirect(302, '/');
});


module.exports = { router, hashPin, makePinHash, checkPin, pinFraco, pinEmUso, loginBloqueado, loginRegFail, loginRegOk, usersCount, getAuth, setAuthCookie, formFields, MSG_PIN_FRACO, MSG_PIN_EM_USO };
