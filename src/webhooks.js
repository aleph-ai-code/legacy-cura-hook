const express = require('express');
const router = express.Router();
const { insStmt, dedupKey } = require('./db');
const { DEFAULT_TENANT } = require('./util');
// TODO (Fase 2): /hook/:tenant/:origem — mapear tenant pela origem/URL.
// Por enquanto todo hook entra no tenant default ('default').
// Recebe QUALQUER POST em /hook/:origem — responde 200 sempre
router.post('/hook/:origem', (req,res)=>{
  let body = req.body;
  if (typeof body === 'string'){ try{ body = JSON.parse(body); }catch(e){} }
  const id = Date.now()+'-'+Math.random().toString(36).slice(2,7);
  const origem = req.params.origem;
  if (origem === 'healthcheck') return res.status(200).json({ok:true});
  const ts = new Date().toISOString();
  const ev = body && body.webhook_evento || 'outro';
  const vid = body && body.venda && (body.venda.id ?? body.venda.uid);
  const info = insStmt.run(id, origem, ev, vid==null?null:String(vid), ts, JSON.stringify(body), dedupKey(body), DEFAULT_TENANT);
  if (info.changes === 0) return res.status(200).json({ok:true, dedupe:true});
  res.status(200).json({ok:true});
});


module.exports = router;
