# Deploy - legacy-cura-hook

## Regra: redeploys NA VPS (working_dir)

O app roda via Dokploy (compose) no working_dir `/etc/dokploy/compose/legacybot-legacywebhook-lcuhjd/code`.
Para redeploy, SEMPRE nessa pasta na VPS (163.176.39.195):

    git fetch origin && git reset --hard origin/main
    docker compose up -d --build

## ATENCAO: .env com PAINEL_SECRET nao pode ser perdido

O arquivo `.env` (chmod 600) no working_dir contem `PAINEL_SECRET` e `PAINEL_PASSWORD` e e carregado via `env_file` no docker-compose.yml.

- NAO apagar o .env em git reset/redeploy (ele esta fora do git por .gitignore).
- Manter backup do .env em local seguro (chmod 600, fora do git).
- Sem PAINEL_SECRET o app sobe com segredo aleatorio por boot (warning nos logs) e todas as sessoes caem a cada restart.

## Por que nao cadastrar env no Dokploy UI

O redeploy pelo Dokploy UI recria o working_dir a partir do repo e pode descartar o .env local / nao aplicar envs do UI neste compose. O caminho seguro documentado e o redeploy manual via working_dir acima, mantendo o .env no proprio working_dir.
