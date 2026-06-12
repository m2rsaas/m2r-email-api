# Instalação em Cloud — m2r-email-api

Guia de provisionamento do **m2r-email-api** nos provedores cloud (Coolify hoje; AWS/Azure a definir).

## Coolify

> Ambiente QA: projeto **M2R.IA.BR** · servidor `localhost` · rede `coolify`.

> ⚠️ Boot conecta Scylla/Redis/RabbitMQ **antes** de abrir a porta — alvo prioritário do fix de boot-order (ver Pendências).

Passos para instalar/atualizar este serviço no Coolify:

1. **Source**: GitHub `m2rsaas/m2r-email-api`, branch `qa`, build pack **Dockerfile**.
2. **Porta exposta** (*Ports Exposes*): `3009`.
3. **Domínio (FQDN)**: https://email-api.qa.m2r.ia.br.
4. **Network Alias** (*General → Network Aliases*) — ⚠️ **passo MANUAL na UI** (não há API/MCP):
   `m2r-email-api`. Necessário para comunicação service-to-service (`http://m2r-email-api:3009`).
5. **Health Check** (*Health Checks*): path `/api/v1/health` · porta `3009` · GET · 200. Ver estado abaixo.
6. **Variáveis de ambiente**: ver `.env.example` do repositório (Secrets no Coolify).
7. **Deploy**.

### Estado aplicado em QA (2026-06-11)
- [ ] **Health check** DESABILITADO. Com ele habilitado, o healthcheck interno do Coolify (`wget localhost:3009`) recebe `connection refused` e o deploy é **revertido** (rollback). Ocorre em serviços que esperam dependências no boot (porta abre tarde) **e também** nos que sobem rápido (appweb-backend/genai) — ver Pendências.
- [x] **Network alias** `m2r-email-api` — configurado.

### Pendência — health check (precisa investigação + fix)

Com health habilitado o deploy é revertido (`connection refused` no check interno). Passos:
1. **Inspeção no servidor** (`docker inspect`/logs do container novo): ver o `healthcheck` gerado pelo Coolify e confirmar em que porta o app realmente faz bind.
2. **Boot-order**: mover `app.listen()` em `src/index.ts` para **antes** das conexões de dependências (Scylla/Redis/RabbitMQ) e usar `/health` como readiness (ou `/livez` liveness puro p/ o gate).
Cross-service (~10 serviços) → candidata a Ruflo. Plano em `.claude/plans/coolify-health-boot-order.md`.

## AWS

> **TODO** — definir depois (ECS/Fargate, EKS ou EC2+compose; ALB; Secrets Manager; CloudWatch vs Loki).

## Azure

> **TODO** — definir depois (Container Apps, AKS ou VM; Key Vault; Azure Monitor vs Loki).
