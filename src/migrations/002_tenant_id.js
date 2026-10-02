// 002: coluna tenant_id em users/events/acoes + backfill (tudo = tenant default) + indices
const { DEFAULT_TENANT } = require('../config');
module.exports = {
  id: '002',
  up(db){
    for (const t of ['users','events','acoes','auditoria']){
      const cols = db.prepare('PRAGMA table_info(' + t + ')').all().map(c=>c.name);
      if (!cols.includes('tenant_id')){
        db.exec('ALTER TABLE ' + t + ' ADD COLUMN tenant_id TEXT');
      }
      db.exec('UPDATE ' + t + " SET tenant_id='" + DEFAULT_TENANT + "' WHERE tenant_id IS NULL");
      db.exec('CREATE INDEX IF NOT EXISTS idx_' + t + '_tenant ON ' + t + '(tenant_id)');
    }
  }
};
