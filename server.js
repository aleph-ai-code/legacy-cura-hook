// ===================== BOOTSTRAP =====================
// Fase 0: server.js e apenas o ponto de entrada (app, middlewares, routers, listen).
// Modulos: src/config (env/segredos), src/db (sqlite/dedupe/backup), src/util (helpers),
// src/auth (pin/cookie/rate-limit/login), src/views (html), src/webhooks, src/vendas,
// src/auditoria, src/ranking, src/admin.
const express = require('express');
const app = express();
const { getAuth } = require('./src/auth');
const { loginPage } = require('./src/views/login.html');

app.set('trust proxy', 1); // atras do Traefik: rate limit usa IP real (X-Forwarded-For)

app.use(express.json({limit:'2mb'}));
app.use(express.text({type:'*/*', limit:'2mb'}));

// Middleware: tudo exige cookie, EXCETO webhook (EVO nao autentica) e login/logout
app.use((req,res,next)=>{
  if (req.path.startsWith('/hook/')) return next();
  if (req.method==='POST' && (req.path==='/login' || req.path==='/login/criar' || req.path==='/login/novo' || req.path==='/logout' || req.path==='/registrar' || req.path==='/webhook/pagamento')) return next();
  if (req.method==='GET' && req.path==='/registrar') return next();
  if (req.path==='/favicon.ico') return res.status(404).end();
  const user = getAuth(req);
  if (user){ req.user = user; return next(); }
  if (req.path.startsWith('/api/')) return res.status(401).json({ok:false, erro:'nao_autenticado'});
  const errMap = { '1':'login', 'novo':'novo', 'admin':'admin', 'criar':'criar', 'pendente':'pendente', 'existe':'existe', 'ok':'ok', 'bloqueado':'bloqueado', 'ratelimit':'ratelimit' };
  res.status(200).setHeader('Content-Type','text/html; charset=utf-8');
  return res.send(loginPage(errMap[req.query && req.query.erro] || '', req.query && req.query.modo === 'criar' ? 'criar' : undefined));
});

app.use(require('./src/auth').router);   // /login, /login/criar, /login/novo, /logout
app.use(require('./src/registrar'));     // /registrar (self-service de tenant)
app.use(require('./src/tenants').router);// /admin/tenant/* (master)
app.use(require('./src/admin').router);  // /admin/*, /me/trocar_pin
app.use(require('./src/auditoria').router); // /auditoria, /auditoria.csv
app.use(require('./src/ranking').router);   // /api/ranking
app.use(require('./src/vendas'));        // /, /export.csv, /api/acao(+toggle), /backup
app.use(require('./src/billing').router); // /webhook/pagamento (MP, Fase 3)
app.use(require('./src/webhooks'));      // /hook/:origem

const PORT = Number(process.env.PORT) || 3210;
app.listen(PORT, ()=>console.log('Hook collector Legacy on :' + PORT + ' (SQLite, modo operacao)'));
