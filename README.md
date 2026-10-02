# legacy-cura-hook

Painel de vendas + coletor de webhooks (Evolution/Eduzz etc.) — multi-tenant, SQLite, Node/Express.

## Webhooks

### Por empresa (Fase 2)

    POST /hook/<tenant>/<origem>

- `<tenant>`: **id** do tenant ou **subdomínio** (ex: `emptest`).
- `<origem>`: identificador livre da origem (ex: `evo-1`).
- Tenant inexistente → **404**; tenant pendente/suspenso → **403** (nada é gravado).
- Dedupe é **por tenant**: o mesmo `venda.id` em tenants diferentes não colide.

### Compatibilidade

    POST /hook/<origem>   → grava no tenant default (LEGACY)

Exemplo por empresa:

    curl -X POST https://SEU-HOST/hook/minhaempresa/evo-1 \
      -H 'Content-Type: application/json' \
      -d '{"webhook_evento":"venda.paga","venda":{"id":"123"}, "cliente":{"nome":"Maria"}}'

Healthcheck: `POST /hook/healthcheck` → 200.

## Cadastro self-service de empresa

- `GET /registrar` — empresa informa nome, subdomínio desejado (único, `[a-z0-9-]`), nome do admin e PIN forte (6+ dígitos, sem repetição/sequência).
- Tenant nasce **pendente** + admin **pendente**; só o admin master aprova (card Aprovações no painel). Nunca há auto-ativação.

## Papéis

- `master` — dono do sistema (1º admin criado; migração 003 promove o 1º admin existente). Vê/gerencia todos os tenants: aprovar/rejeitar/suspender/reativar empresas.
- `admin` — admin do seu tenant (escopo total por `tenant_id`; não acessa outros tenants).
- `membro` — operação do dia a dia no próprio tenant.

Isolamento: todas as rotas `/admin` e APIs são escopadas por `tenant_id`; suspensão do tenant bloqueia login, sessões e webhook da empresa. PIN de login é **único global** (login é feito só pelo PIN).

## Testes

    npm ci && node test/run.js

## Deploy

Ver README-DEPLOY.md (redeploy manual no working_dir do Dokploy, preservando o .env).

## Planos e Billing (Fase 3)

- Planos: **free** (trial 30 dias, 3 users, 500 eventos/mês), **basico** (10 users, 5.000 eventos/mês, export CSV), **pro** (50 users, 50.000 eventos/mês, export CSV + API), **master** (sem limite — tenant default LEGACY).
- Limites ajustáveis por env: `PLANO_FREE_MAX_USERS`, `PLANO_FREE_MAX_EVENTS_MES`, `PLANO_BASICO_MAX_USERS`, `PLANO_BASICO_MAX_EVENTS_MES`, `PLANO_PRO_MAX_USERS`, `PLANO_PRO_MAX_EVENTS_MES`.
- Trial/plano expirado: painel do tenant mostra página **"Plano expirado — renove"** (dados preservados) e o webhook do tenant responde **402**. Master e tenant default nunca são bloqueados.
- Eventos acima do limite mensal são gravados normalmente com `over_limit=1` (nunca perde venda).
- Card **💳 Financeiro** no painel master: plano/trial/pago de cada tenant + botão de ativar plano manualmente (para Pix que cai fora do webhook).

### Como plugar Mercado Pago (quando as credenciais existirem)

Defina no  do deploy (Dokploy) e reinicie:

- `MP_ACCESS_TOKEN` — token de produção do Mercado Pago. Enquanto ausente, o webhook roda em **modo seco**: loga o payload, responde 200 e não ativa nada.
- `MP_WEBHOOK_SECRET` — segredo usado para validar a assinatura HMAC-SHA256 (header `x-signature`) do webhook. Sem ele, a rota aceita qualquer chamada (use só em dev).
- `MP_PLAN_LINK_BASICO` / `MP_PLAN_LINK_PRO` — links de pagamento/checkout exibidos na página de renove.

Fluxo: configure no MP um webhook apontando para `POST /webhook/pagamento` (rota livre, sem cookie). O payload padrão usa `external_reference` no formato `tenant:<id>:plano:<basico|pro>`; pagamento `approved` ativa o plano por 30 dias (`pago_ate`). Ativação manual: painel master → 💳 Financeiro.
