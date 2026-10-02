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
