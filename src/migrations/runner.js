// Runner de migrations versionadas (Fase 1: multi-tenant)
// Cada migration: { id: '001', up(db) }. Registra em _migrations; idempotente.
function runMigrations(db, migrations){
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, rodado_em TEXT NOT NULL)');
  const done = new Set(db.prepare('SELECT id FROM _migrations').all().map(r=>r.id));
  const applied = [];
  for (const m of migrations){
    if (done.has(m.id)) continue;
    const tx = db.transaction(()=>{
      m.up(db);
      db.prepare('INSERT INTO _migrations (id, rodado_em) VALUES (?,?)').run(m.id, new Date().toISOString());
    });
    tx();
    applied.push(m.id);
    console.log('[migration] aplicada:', m.id);
  }
  return applied;
}
module.exports = { runMigrations };
