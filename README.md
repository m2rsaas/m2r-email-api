# m2r-email-api

API M2RIA responsavel pelo envio de emails da plataforma (imediato e agendado),
com suporte a multiplos provedores de envio. Dois provedores sao suportados:

- **SMTP** (via `nodemailer`) — cobre integracao generica, Gmail, Hostinger,
  Hostgator e qualquer servidor SMTP compativel.
- **SendGrid** (via `@sendgrid/mail`) — inclui alias `TWILIO` para mapeamento
  de codigos legados do catalogo GPM.

Os templates de email sao armazenados no ScyllaDB e renderizados em runtime
com **Handlebars**. O servico opera em dois escopos logicos (`GPM` e `TENANT`),
usando tabelas distintas para persistencia de jobs e logs de tentativas.

## Caracteristicas

- Envio imediato ou agendado (`scheduledAt`) por qualquer endpoint ou consumer.
- Fila assincrona via RabbitMQ (exchange `m2ria.email`, binding `email.send.#`);
  mensagens invalidas sao descartadas para DLX sem requeue.
- Scheduler de polling (tick configuravel, default 30s) para promover jobs
  `SCHEDULED` e `RETRYING` quando `next_fire_at <= now`.
- Retry com backoff exponencial: 30s, 2min, 10min, 1h, 6h; ate 5 tentativas
  para falhas `soft`. Falhas `hard`/`fatal` descartam o job imediatamente.
- Cache Redis para configuracoes de integracao (TTL configuravel, default 300s);
  invalidacao manual via `IntegrationResolverService.invalidate()`.
- Credenciais de provedor (SMTP/SendGrid) cifradas em AES-256-GCM via
  `@m2rsaas/crypto`; nunca expostas em variaveis de ambiente.
- Swagger UI disponivel em `/documentation` (protegido por Basic Auth quando
  `SWAGGER_AUTH_ENABLED=true`).

## Stack

Node.js 20 · TypeScript 5 · Fastify 5 · `nodemailer` 6 · `@sendgrid/mail` 8 ·
`handlebars` 4 · `amqplib` 0.10 · `ioredis` 5 · ScyllaDB (`cassandra-driver` 4) ·
`@m2rsaas/contracts` · `@m2rsaas/crypto` · Awilix (DI) · Zod · Vitest.

## Setup local

```bash
cp .env.example .env
npm install
npm run dev
```

Servico ouve em `http://localhost:3009/api/v1`.

## Endpoints

### Emails (sem JWT no MVP — porta exposta apenas na rede interna Coolify)

| Metodo | Path | Descricao |
|--------|------|-----------|
| POST | `/emails` | Enfileira envio; retorna `202` com `jobId(s)` e status (`QUEUED` ou `SCHEDULED`) |
| GET | `/emails/:id?scope=&tenantCode=` | Detalhe do job + historico de tentativas |
| POST | `/emails/:id/resend?scope=&tenantCode=` | Promove job `FAILED` -> `QUEUED` e dispara dispatch |

### Health

| Metodo | Path |
|--------|------|
| GET | `/health` |

## Dependencias entre servicos

**Chamado por (consumers/callers diretos):**
- `m2r-gpm-backend` — dispara emails transacionais da plataforma (ativacao,
  billing, notificacoes de admin) via HTTP `POST /emails`.
- `m2r-appweb-backend` — BFF que pode enfileirar emails de produto (ex.:
  confirmacao de cadastro do tenant) via HTTP `POST /emails`.
- Qualquer servico que publique na exchange `m2ria.email` com routing key
  `email.send.*` — o consumer AMQP processa automaticamente.

**Depende de:**
- ScyllaDB (`cassandra-driver`) — jobs (`email_jobs`), logs (`email_job_logs`)
  e templates (`email_templates`); tabelas GPM no keyspace global, tabelas
  TENANT no keyspace do tenant.
- RabbitMQ (`amqplib`) — consumer da fila `m2r-email-api.send`; DLX em
  `m2ria.dlx`.
- Redis (`ioredis`) — cache de configuracoes de integracao.
- `m2r-gpm-backend` — consultado via HTTP interno (`GPM_BACKEND_URL`) para
  resolver integracoes de email por tenant.
- `@m2rsaas/crypto` — decifrar credenciais de provedor armazenadas em
  `gpm_integrations.config` / `int_integrations.config`.

**Compartilha contrato com:**
- `m2r-auth-api` — usa mesmo `JWT_SECRET` para validar tokens (sem chamada HTTP).

## Variaveis de ambiente

Ver `.env.example`. Destaques:

| Var | Descricao |
|-----|-----------|
| `PORT` | Porta HTTP (default `3009`) |
| `URL_PREFIX` | Prefixo das rotas (default `/api/v1`) |
| `SCYLLA_HOSTS` | CSV de hosts ScyllaDB |
| `SCYLLA_DATACENTER` | Datacenter local (default `datacenter1`) |
| `REDIS_HOSTS` | Host(s) Redis (usa o primeiro para conexao simples) |
| `REDIS_PORT` | Porta Redis (default `6379`) |
| `AMQP_URL` | URL de conexao RabbitMQ (`amqp://...`) |
| `AMQP_EXCHANGE` | Exchange de email (default `m2ria.email`) |
| `AMQP_DLX_EXCHANGE` | Dead-letter exchange (default `m2ria.dlx`) |
| `AMQP_QUEUE` | Fila principal (default `m2r-email-api.send`) |
| `AMQP_BINDINGS` | Routing keys, CSV (default `email.send.#`) |
| `AMQP_PREFETCH` | Prefetch do consumer (default `10`) |
| `SCHEDULER_ENABLED` | Liga/desliga o scheduler (default `true`) |
| `SCHEDULER_TICK_SECONDS` | Intervalo do polling em segundos (default `30`) |
| `SCHEDULER_BATCH` | Maximo de jobs por tick (default `100`) |
| `M2R_CRYPTO_KEY` | Chave AES-256-GCM em base64 (32 bytes) para decifrar credenciais |
| `INTEGRATION_CACHE_TTL_SECONDS` | TTL do cache Redis de integracoes (default `300`) |
| `JWT_SECRET` | Mesmo secret do `m2r-auth-api` |
| `SENDER_DEFAULT_TIMEOUT_MS` | Timeout de envio por provedor (default `30000`) |
| `GPM_BACKEND_URL` | URL interna do `m2r-gpm-backend` (default `http://gpm-backend:3008`) |
| `GPM_BACKEND_KEY` | API key para chamadas ao GPM backend |
| `SWAGGER_AUTH_ENABLED` | Protege `/documentation` com Basic Auth (default `false`) |

## Build / runtime

```bash
npm run build   # tsc -> dist/
npm start       # node dist/index.js
npm test        # vitest run
```

Container Docker multi-stage segue o padrao M2RIA (`m2r-tenant-api`).
