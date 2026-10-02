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

module.exports = { DATA_DIR, DB_FILE, LEGACY_JSON, BACKUP_DIR, AUTH_SECRET, AUTH_COOKIE, TZ, DEFAULT_TENANT };
