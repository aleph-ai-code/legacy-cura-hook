const { usersCount, MSG_PIN_EM_USO } = require('../auth');
function inputCss(){
  return 'input{width:100%;padding:8px 12px;border-radius:8px;border:1px solid rgba(212,165,63,.4);background:#17251d;color:#f7f3e9;font-size:14px;outline:none;box-sizing:border-box;text-align:center;line-height:1.4}' +
  'input:focus{border-color:#d4a53f}' +
  'button{margin-top:16px;width:100%;padding:8px;border:0;border-radius:8px;background:#d4a53f;color:#1a1033;font-weight:600;font-size:14px;cursor:pointer;line-height:1.4}' +
  'button:hover{filter:brightness(1.08)}' +
  '.err{color:#e08a8a;font-size:12px;margin-top:12px;min-height:14px}' +
  '.alt{margin-top:24px;border-top:1px solid rgba(212,165,63,.25);padding-top:20px}' +
  '.alt h2{font-size:13px;color:#eecf7e;margin:0 0 12px;letter-spacing:1px;font-weight:600}' +
  '.hint{color:#a8b0a0;font-size:11px;margin-top:6px}';
}
function pageShell(title, inner){
  return '<!doctype html><html lang=pt-BR><head><meta charset=utf-8><title>LEGACY · ' + title + '</title><meta name=viewport content="width=device-width,initial-scale=1"><style>' +
  'body{font-family:system-ui,-apple-system,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#17251d;color:#f7f3e9;line-height:1.5}' +
  '.card{background:#213629;border:1px solid rgba(212,165,63,.45);border-radius:14px;padding:32px;box-shadow:0 4px 16px rgba(0,0,0,.4);text-align:center;min-width:320px;max-width:360px}' +
  'h1{font-size:28px;font-weight:800;letter-spacing:5px;margin:0 0 4px;color:#eecf7e}' +
  'p{color:#a8b0a0;font-size:12px;margin:0 0 24px;letter-spacing:1px}' + inputCss() +
  '</style></head><body><div class=card><h1>LEGACY</h1><p>Acesso restrito</p>' + inner + '</div></body></html>';
}
// Primeiro acesso: criar admin. Depois: entrar ou 'Sou novo aqui' com PIN-admin.
function loginPage(err, mode){
  mode = mode || (usersCount() === 0 ? 'criar' : 'login');
  if (mode === 'criar'){
    return pageShell('Criar acesso',
      '<p>Primeiro acesso · crie seu acesso</p>' +
      '<form method=post action=/login/criar>' +
      '<input type=text name=nome placeholder="Seu nome" autofocus required maxlength=60>' +
      '<input type=password name=pin placeholder="PIN (mínimo 6 dígitos)" required inputmode=numeric maxlength=12 style="margin-top:12px">' +
      '<button>Criar meu acesso</button><div class=err>' + (err==='pin_uso' ? MSG_PIN_EM_USO : (err ? 'Nome já existe ou PIN inválido/fraco (mínimo 6 dígitos).' : '')) + '</div></form>');
  }
  return pageShell('Acesso restrito',
    '<form method=post action=/login>' +
    '<input type=password name=pin placeholder="Seu PIN" autofocus required inputmode=numeric maxlength=12>' +
    '<button>Entrar</button><div class=err>' + (err==='login' ? 'PIN incorreto.' : (err==='novo' ? 'Não foi possível criar o acesso (nome em uso ou PIN inválido).' : (err==='admin' ? 'PIN de administrador incorreto.' : (err==='pendente' ? 'Cadastro aguardando aprovação do admin.' : (err==='existe' ? 'Não foi possível criar o acesso (nome em uso ou PIN inválido).' : (err==='pin_uso' ? MSG_PIN_EM_USO : (err==='ok' ? 'Cadastro criado! Aguarde a aprovação do admin.' : (err==='bloqueado' ? 'Acesso bloqueado. Fale com o administrador.' : (err==='fraco' ? 'PIN muito fraco: nao use numero repetido ou sequencia.' : (err==='ratelimit' ? 'Muitas tentativas. Aguarde 15 minutos.' : '')))))))))) + '</div></form>' +
    '<div class=alt><h2>SOU NOVO AQUI</h2>' +
    '<form method=post action=/login/novo>' +
    '<input type=text name=nome placeholder="Seu nome" required maxlength=60>' +
    '<input type=password name=pin placeholder="PIN (mínimo 6 dígitos)" required inputmode=numeric maxlength=12 style="margin-top:12px">' +
    '<button>Criar acesso</button><div class=hint>Seu cadastro ficará aguardando aprovação do admin.</div></form></div>');
}

module.exports = { inputCss, pageShell, loginPage };
