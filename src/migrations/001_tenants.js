// 001: tabela tenants + tenant default (LEGACY)
const { DEFAULT_TENANT } = require('../config');
module.exports = {
  id: '001',
  up(db){
    db.exec(`CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      subdominio TEXT UNIQUE,
      plano TEXT NOT NULL DEFAULT 'free',
      status TEXT NOT NULL DEFAULT 'ativo',
      criado_em TEXT NOT NULL
    )`);
    db.prepare("INSERT OR IGNORE INTO tenants (id, nome, subdominio, plano, status, criado_em) VALUES (?,?,?,?,?,?)")
      .run(DEFAULT_TENANT, 'LEGACY', 'default', 'free', 'ativo', new Date().toISOString());
  }
};
