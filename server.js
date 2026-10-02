const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const app = express();
const { DATA_DIR, DB_FILE, LEGACY_JSON, BACKUP_DIR, AUTH_SECRET, AUTH_COOKIE, TZ } = require('./src/config');
const { db, insStmt, dedupKey, allRows, rowToEvent, doBackup } = require('./src/db');
const { esc, logAud, adminCountExcept, requireAdmin, requireUser, csvField, CHECKS, acoesForKeys, lastOf, onboardingInfo, localDay, localHour, fmtDT, fmtTime, fmtHHMM, fmtCardDT, chartCard, startOfToday, fmtBRL } = require('./src/util');
const { router: authRouter, hashPin, makePinHash, checkPin, pinFraco, pinEmUso, loginBloqueado, loginRegFail, loginRegOk, usersCount, getAuth, setAuthCookie, formFields, MSG_PIN_EM_USO } = require('./src/auth');
const { loginPage } = require('./src/views/login.html');
app.set('trust proxy', 1); // atrás do Traefik: rate limit usa IP real (X-Forwarded-For)

app.use(express.json({limit:'2mb'}));
app.use(express.text({type:'*/*', limit:'2mb'}));



// Middleware: tudo exige cookie, EXCETO webhook (EVO não autentica) e login/logout
app.use((req,res,next)=>{
  if (req.path.startsWith('/hook/')) return next();
  if (req.method==='POST' && (req.path==='/login' || req.path==='/login/criar' || req.path==='/login/novo' || req.path==='/logout')) return next();
  if (req.path==='/favicon.ico') return res.status(404).end();
  const user = getAuth(req);
  if (user){ req.user = user; return next(); }
  if (req.path.startsWith('/api/')) return res.status(401).json({ok:false, erro:'nao_autenticado'});
  const errMap = { '1':'login', 'novo':'novo', 'admin':'admin', 'criar':'criar', 'pendente':'pendente', 'existe':'existe', 'ok':'ok', 'bloqueado':'bloqueado', 'ratelimit':'ratelimit' };
  res.status(200).setHeader('Content-Type','text/html; charset=utf-8');
  return res.send(loginPage(errMap[req.query && req.query.erro] || '', req.query && req.query.modo === 'criar' ? 'criar' : undefined));
});

app.use(authRouter);
app.use(require('./src/vendas'));
app.use(require('./src/webhooks'));
const { usersCardHtml } = require('./src/admin');
const { auditResumoHtml, auditTableHtml } = require('./src/auditoria');
const { rankingDrawerHtml } = require('./src/ranking');
const { PAGE } = require('./src/views/painel.html');
app.use(require('./src/admin').router);
app.use(require('./src/auditoria').router);
app.use(require('./src/ranking').router);


// ===================== API DE ACOES (modo operacao) =====================






const PORT = Number(process.env.PORT) || 3210;
app.listen(PORT, ()=>console.log('Hook collector Legacy on :' + PORT + ' (SQLite, modo operacao)'));
