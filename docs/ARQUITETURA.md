# ARQUITETURA — legacy-cura-hook

Painel + coletor de webhooks multi-tenant (Express + better-sqlite3), deploy Dokploy na VPS 163.176.39.195.

## Stack
- Node/Express, SQLite (WAL) em `/data/events.db`, backups diários em `/data/backups/`
- Auth por PIN (scrypt) + cookie assinado (HMAC `PAINEL_SECRET`), rate limit de login
- Suite própria: `node test/run.js` (96 testes, incluindo 2 boots de idempotência)

## Módulos (src/)
| Módulo | Papel |
|---|---|
| config.js | env, segredos, PLANOS, credenciais MP (scaffolding) |
| db.js | sqlite, schema, migrations, dedupe, backup diário |
| util.js | helpers (uuidv7, esc, fmt, requireAdmin/Master, auditoria) |
| auth.js | PIN/login/sessões; criação de users respeita max_users do plano |
| registrar.js | self-service de tenant (trial 30d, nasce pendente) |
| tenants.js | resolução de tenant + rotas master (aprovar/rejeitar/suspender) |
| billing.js | Fase 3: planos, enforcement, webhook MP, card Financeiro |
| metricas.js | Fase 4: métricas de uso por tenant (base de cobrança), CSV, export por tenant |
| sobre.js | Fase 4: landing institucional pública (/sobre) |
| webhooks.js | POST /hook/:tenant/:origem (dedupe, over_limit, 402 plano expirado) |
| vendas.js | painel, feed, KPIs, gráficos, export.csv, ações |
| auditoria.js / ranking.js | auditoria e ranking do time |

## Fases implementadas
- **Fase 0** — base operacional: coletor SQLite, dedupe, painel, backup.
- **Fase 1** — multi-tenant: tenants, tenant_id em users/events/acoes/auditoria, migration runner, tenant default LEGACY.
- **Fase 2** — webhook por tenant (`/hook/:subdominio/:origem`), self-service `/registrar`, painel master, isolamento por tenant.
- **Fase 3** — planos + billing (esta fase):
  - Planos (`src/config.js`): `free` (trial 30d, 3 users, 500 eventos/mês), `basico` (10 users, 5k/mês, export_csv), `pro` (50 users, 50k/mês, export_csv+api), `master` (sem limite; tenant default LEGACY).
  - Limites configuráveis por env: `PLANO_*_MAX_USERS`, `PLANO_*_MAX_EVENTS_MES`.
  - Migration 004: `tenants.trial_ate`, `tenants.pago_ate`, `events.over_limit`; default → master; tenants free existentes ganham trial +30d.
  - Enforcement: trial/plano expirado → painel mostra página "Plano expirado — renove" (link de pagamento via env), webhook do tenant responde **402**, dados preservados. Master e default **nunca** bloqueados.
  - Limites: criar user acima do plano é bloqueado; evento acima do limite é **gravado** com `over_limit=1` (nunca perde venda).
  - Billing scaffolding MP: `POST /webhook/pagamento` (rota livre, assinatura HMAC `MP_WEBHOOK_SECRET`); sem `MP_ACCESS_TOKEN` = modo seco (loga, 200, não ativa). Pagamento aprovado → `plano` + `pago_ate` +30d (via `external_reference` `tenant:<id>:plano:<plano>`).
  - Admin master: card 💳 Financeiro (plano/trial/pago de cada tenant) + ativação manual de plano (`POST /admin/tenant/plano`).

## Fase 4 (implementada)
- **Métricas por tenant** (base de cobrança): card 📊 Métricas no painel master (eventos no mês com over_limit, users ativos, último acesso, plano, trial/pago até). Endpoints master-only: `GET /master/metricas` (JSON), `GET /master/metricas.csv` (export), `GET /master/export/:tenant_id` (backup lógico CSV por tenant). `login_ok` agora registra o tenant (alimenta "último acesso").
- **Backups**: diários em `/data/backups/` com retenção de 14 (`pruneBackups`); timer com `.unref()` para não segurar processos.
- **Landing de vendas**: `GET /sobre` pública, estática, tema do painel, CTA "Criar conta grátis" → /registrar (sem dados reais).
- **Hardening**: rate limit em `POST /registrar` (5/hora por IP, bloqueio 1h, mesmo padrão do login); headers globais `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`. Webhooks (/hook/*, /webhook/pagamento) continuam livres de auth.

## Pendências de decisão do dono
- **Domínio próprio**: onde apontar (decisão de compra/subdomínio pendente) — hoje só documentado.
- **MP real**: criar assinaturas/links de checkout, consultar payment por id na API, conciliação (hoje scaffolding modo seco).
- **Cobrança recorrente**: lembretes de renovação, downgrade automático.
- **API pública por plano**: feature `api` e limites por recurso com medição.

## Deploy
Dokploy: working_dir `/etc/dokploy/compose/legacybot-legacywebhook-lcuhjd/code` → `git fetch && git reset --hard origin/main && docker compose up -d --build`. Backup do banco antes de mudanças: `VACUUM INTO /data/backups/pre-<tag>-<data>.db`.
