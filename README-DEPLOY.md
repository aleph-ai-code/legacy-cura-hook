# Deploy (Dokploy)

## Como o app roda na VPS

O servico roda no Dokploy como **Compose** (nao como Application nativa). O Dokploy
clona o repo em um working_dir na VPS e roda `docker compose up -d` nele:

```
/etc/dokploy/compose/legacybot-legacywebhook-lcuhjd/code/
├── docker-compose.yml      (versionado aqui, com env_file: .env)
├── docker-compose.override.yml (gerado pelo Dokploy — redes/traefik)
└── .env                    (NÃO versionado, chmod 600)
```

## Segredos (PAINEL_SECRET, PAINEL_PASSWORD)

- Os segredos vivem **apenas** no `.env` do working_dir na VPS (fora do git, chmod 600).
- O `docker-compose.yml` usa `env_file: .env`, então qualquer `docker compose up -d`
  nesse working_dir carrega os segredos — eles **sobrevivem a redeploy** por `git pull/reset`.
- **NÃO regenere o compose pelo painel do Dokploy sem preservar o `.env`** — se o painel
  recriar o working_dir, recrie o `.env` antes de subir o container.
- O código **não tem defaults hardcoded**: sem `PAINEL_SECRET` o app sobe com segredo
  randômico por boot (sessões invalidadas a cada restart) e loga erro claro.

## Redeploy manual (caminho seguro)

```bash
ssh root@163.176.39.195
cd /etc/dokploy/compose/legacybot-legacywebhook-lcuhjd/code
git fetch && git reset --hard origin/main
docker compose up -d --build   # NÃO apagar o .env
```

## Checklist pós-deploy

1. `docker ps` — container `hook` Up (não crashou por falta de env).
2. `curl -s -o /dev/null -w '%{http_code}' https://hooks.evolegacy.duckdns.org` → 200 ("Acesso restrito").
3. `curl -s -o /dev/null -w '%{http_code}' -X POST https://hooks.evolegacy.duckdns.org/hook/healthcheck` → 200.
4. Login por PIN funciona no painel.
