const express = require('express');
const router = express.Router();
const { db, insStmt, dedupKey } = require('./db');
const { resolveTenant, tenantAtivo } = require('./tenants');
const { tenantBloqueado, limiteEventos, eventosNoMes } = require('./billing');
// ===================== WEBHOOKS =====================
// /hook/:origem          -> tenant default (compatibilidade, Fase 1)
// /hook/:tenant/:origem  -> tenant por id OU subdominio (Fase 2)
// Recebe QUALQUER POST — responde 200 sempre no default; 404/403 quando tenant invalido.
function gravar(res, origem, req, tenantId){
  let body = req.body;
  if (typeof body === 'string'){ try{ body = JSON.parse(body); }catch(e){} }
  if (origem === 'healthcheck') return res.status(200).json({ok:true});
  const id = Date.now()+'-'+Math.random().toString(36).slice(2,7);
  const ts = new Date().toISOString();
  const ev = body && body.webhook_evento || 'outro';
  const vid = body && body.venda && (body.venda.id ?? body.venda.uid);
  // limite de eventos do plano: grava SEMPRE (nao perde venda), marca over_limit quando estourar
  const limite = limiteEventos(tenantId);
  const over = limite != null && eventosNoMes(tenantId) >= limite;
  const info = insStmt.run(id, origem, ev, vid==null?null:String(vid), ts, JSON.stringify(body), dedupKey(body, tenantId), tenantId);
  if (info.changes === 0) return res.status(200).json({ok:true, dedupe:true});
  if (over){ try { db.prepare('UPDATE events SET over_limit=1 WHERE id=?').run(id); } catch(e){} }
  res.status(200).json({ok:true, over_limit: !!over});
}
router.post('/hook/:tenant/:origem', (req,res)=>{
  const t = resolveTenant(req.params.tenant);
  if (!t) return res.status(404).json({ok:false, erro:'tenant_nao_encontrado'});
  if (!tenantAtivo(t)) return res.status(403).json({ok:false, erro:'tenant_inativo'});
  if (tenantBloqueado(t)) return res.status(402).json({ok:false, erro:'plano_expirado', msg:'Plano expirado — renove'}); // Fase 3: dados preservados
  return gravar(res, req.params.origem, req, t.id);
});
router.post('/hook/:origem', (req,res)=>{
  return gravar(res, req.params.origem, req, 'default');
});

module.exports = router;
