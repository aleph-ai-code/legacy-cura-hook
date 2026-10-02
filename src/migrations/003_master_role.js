// 003: papel 'master' para o primeiro admin criado (dono do sistema, ve/gerencia todos os tenants)
module.exports = {
  id: '003',
  up(db){
    const first = db.prepare("SELECT id FROM users WHERE role='admin' ORDER BY id ASC LIMIT 1").get();
    if (first) db.prepare("UPDATE users SET role='master' WHERE id=?").run(first.id);
  }
};
