const crypto = require('crypto');
const path = require('path');
const DATA_DIR = process.env.DATA_DIR || '/data';
const DB_FILE = path.join(DATA_DIR, 'events.db');
const LEGACY_JSON = process.env.DATA_FILE || path.join(DATA_DIR, 'events.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const AUTH_SECRET = process.env.PAINEL_SECRET || (console.warn('[seguranca] PAINEL_SECRET nao definido: gerando segredo aleatorio por boot (sessoes/cookies serao invalidados a cada restart). Defina PAINEL_SECRET no .env.'), crypto.randomBytes(32).toString('hex'));
const AUTH_COOKIE = 'painel_auth';
const TZ = 'America/Fortaleza';
// Tenant padrao (Fase 1). Fase 2: /hook/:tenant/:origem
const DEFAULT_TENANT = 'default';

// ===== Fase 3: planos + billing (Mercado Pago scaffolding) =====
// Limites configuraveis por env (ex: PLANO_FREE_MAX_EVENTS_MES=500)
const envInt = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) && v > 0 ? v : d; };
const PLANOS = {
  free:   { nome: "Free",   trial_dias: 30, max_users: envInt("PLANO_FREE_MAX_USERS", 3),   max_events_mes: envInt("PLANO_FREE_MAX_EVENTS_MES", 500),   recursos: { export_csv: false, api: false } },
  basico: { nome: "Basico", trial_dias: 0,  max_users: envInt("PLANO_BASICO_MAX_USERS", 10), max_events_mes: envInt("PLANO_BASICO_MAX_EVENTS_MES", 5000), recursos: { export_csv: true, api: false } },
  pro:    { nome: "Pro",    trial_dias: 0,  max_users: envInt("PLANO_PRO_MAX_USERS", 50),   max_events_mes: envInt("PLANO_PRO_MAX_EVENTS_MES", 50000),  recursos: { export_csv: true, api: true } },
  master: { nome: "Master", trial_dias: 0,  max_users: null, max_events_mes: null, recursos: { export_csv: true, api: true } },
};
// Credenciais Mercado Pago (scaffolding: ausentes = modo seco, nunca quebra)
const MP = {
  access_token: process.env.MP_ACCESS_TOKEN || "",
  webhook_secret: process.env.MP_WEBHOOK_SECRET || "",
  plan_link_basico: process.env.MP_PLAN_LINK_BASICO || "",
  plan_link_pro: process.env.MP_PLAN_LINK_PRO || "",
};

module.exports = { DATA_DIR, DB_FILE, LEGACY_JSON, BACKUP_DIR, AUTH_SECRET, AUTH_COOKIE, TZ, DEFAULT_TENANT, PLANOS, MP };
