const crypto = require('crypto');
const { TZ, DEFAULT_TENANT } = require('./config');
// UUIDv7: timestamp ms (48 bits) + random versionado (RFC 9562)
function uuidv7(){
  const ts = Date.now();
  const b = crypto.randomBytes(16);
  b[0] = (ts / 2**40) & 0xff; b[1] = (ts / 2**32) & 0xff; b[2] = (ts / 2**24) & 0xff;
  b[3] = (ts / 2**16) & 0xff; b[4] = (ts / 2**8) & 0xff;  b[5] = ts & 0xff;
  b[6] = (b[6] & 0x0f) | 0x70; // version 7
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  const h = b.toString('hex');
  return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
}
const { db } = require('./db');
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function logAud(usuario, acao, sobre, detalhe, tenantId){ try { db.prepare('INSERT INTO auditoria (ts, usuario, acao, sobre, detalhe, tenant_id) VALUES (?,?,?,?,?,?)').run(new Date().toISOString(), usuario==null?null:String(usuario), String(acao), sobre==null?null:String(sobre).slice(0,200), detalhe==null?null:String(detalhe).slice(0,500), tenantId || DEFAULT_TENANT); } catch(e){ console.error('auditoria:', e.message); } }
function adminCountExcept(nome, tenantId){ return db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin' AND nome != ? AND tenant_id = ?").get(nome, tenantId || DEFAULT_TENANT).c; }
function requireAdmin(req,res){ if (!req.user || req.user.role !== 'admin'){ res.status(403).json({ok:false, erro:'restrito_admin'}); return false; } return true; }
function requireUser(req,res){ if (!req.user){ res.status(401).json({ok:false, erro:'nao_autenticado'}); return false; } return true; }
// Export CSV
function csvField(v){
  let sv = v==null ? '' : String(v);
  if (/[",\n\r]/.test(sv)) sv = '"' + sv.replace(/"/g,'""') + '"';
  return sv;
}
// Helpers de acoes por evento/venda
const CHECKS = ['check_boasvindas','check_removido_vip','check_onboarding_ok'];
function acoesForKeys(keys, tenantId){
  const out = {};
  const stmt = db.prepare('SELECT * FROM acoes WHERE event_id=? AND tenant_id=? ORDER BY id ASC');
  for (const k of keys){ if (k) out[k] = stmt.all(String(k), tenantId || DEFAULT_TENANT); }
  return out;
}
function lastOf(list, acao){ for (let i=list.length-1;i>=0;i--) if (list[i].acao===acao) return list[i]; return null; }
function onboardingInfo(list){
  const done = [];
  for (const c of CHECKS){ const a = lastOf(list, c); if (a) done.push(a); }
  const n = done.length;
  const status = n===0 ? '🟡 Pendente' : (n===3 ? '✅ Completo' : '🔵 Em processo');
  return { n, status, done };
}
const dayFmt = new Intl.DateTimeFormat('en-CA', {timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit'}); // YYYY-MM-DD
const hourFmt = new Intl.DateTimeFormat('en-GB', {timeZone: TZ, hour:'numeric', hour12:false});
function localDay(ts){ try { return dayFmt.format(new Date(ts)); } catch(e){ return String(ts).slice(0,10); } }
function localHour(ts){ try { return Number(hourFmt.format(new Date(ts))); } catch(e){ return new Date(ts).getHours(); } }
function fmtDT(ts){ try { return new Date(ts).toLocaleString('pt-BR',{timeZone:TZ}); } catch(e){ return String(ts); } }
function fmtTime(ts){ try { return new Date(ts).toLocaleTimeString('pt-BR',{timeZone:TZ}); } catch(e){ return String(ts); } }
function fmtHHMM(ts){ try { return fmtTime(ts).slice(0,5); } catch(e){ return String(ts); } }
function fmtCardDT(ts){ try { const t=new Date(ts); const day=localDay(t), today=localDay(Date.now()), yest=localDay(Date.now()-86400000); const hora=fmtTime(t).slice(0,5); if(day===today) return 'hoje às '+hora; if(day===yest) return 'ontem às '+hora; return day.split('-').reverse().slice(0,2).join('/')+' às '+hora; } catch(e){ return fmtDT(ts); } }
function chartCard(title, inner){
  return '<div class="card chart-card"><h3>' + title + '</h3>' + inner + '</div>';
}
function startOfToday(){ return Date.parse(localDay(Date.now()) + 'T00:00:00-03:00'); } // meia-noite America/Fortaleza (UTC-3, sem DST)
function fmtBRL(centavos, moeda){
  const cur = moeda || 'BRL';
  try { return (centavos/100).toLocaleString('pt-BR',{style:'currency',currency:cur}); } catch(e){ return 'R$ ' + (centavos/100).toFixed(2); }
}

module.exports = { esc, uuidv7, DEFAULT_TENANT, logAud, adminCountExcept, requireAdmin, requireUser, csvField, CHECKS, acoesForKeys, lastOf, onboardingInfo, localDay, localHour, fmtDT, fmtTime, fmtHHMM, fmtCardDT, chartCard, startOfToday, fmtBRL };
