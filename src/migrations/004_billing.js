// 004: billing (Fase 3) — trial_ate/pago_ate nos tenants, over_limit nos events.
// Tenant default (LEGACY) vira plano 'master' (sem limite, sem expiracao).
// Tenants free existentes ganham trial de +30 dias (dados preservados).
const { DEFAULT_TENANT } = require('../config');
module.exports = {
  id: '004',
  up(db){
    const cols = db.prepare('PRAGMA table_info(tenants)').all().map(c=>c.name);
    if (!cols.includes('trial_ate')) db.exec("ALTER TABLE tenants ADD COLUMN trial_ate TEXT");
    if (!cols.includes('pago_ate')) db.exec("ALTER TABLE tenants ADD COLUMN pago_ate TEXT");
    const ecols = db.prepare('PRAGMA table_info(events)').all().map(c=>c.name);
    if (!ecols.includes('over_limit')) db.exec('ALTER TABLE events ADD COLUMN over_limit INTEGER NOT NULL DEFAULT 0');
    db.prepare("UPDATE tenants SET plano='master', trial_ate=NULL, pago_ate=NULL WHERE id=?").run(DEFAULT_TENANT);
    db.prepare("UPDATE tenants SET trial_ate=? WHERE plano='free' AND trial_ate IS NULL AND pago_ate IS NULL")
      .run(new Date(Date.now() + 30*86400000).toISOString());
  }
};
