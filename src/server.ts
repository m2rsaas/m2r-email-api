import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import metrics from 'fastify-metrics';
import { healthRoutes } from './routes/health.js';
import { createEmailsRoutes } from './routes/emails.js';
import type { Container } from './container.js';

/**
 * Monta a instancia Fastify da API.
 *
 * Responsabilidades:
 *  - Instancia o Fastify usando o logger Pino do container (deep-config aceito).
 *  - Registra CORS liberado (a API ja fica atras de rede fechada).
 *  - Registra `fastify-metrics` em `/metrics` (sem prefixo — padrao Prometheus).
 *  - Registra `healthRoutes` e `createEmailsRoutes(container)` sob `URL_PREFIX`.
 */
export async function createServer(container: Container): Promise<FastifyInstance> {
  const config = container.resolve('config');
  const logger = container.resolve('logger');

  const app = Fastify({
    // Pino e compativel com o formato aceito pelo `logger` do Fastify.
    logger,
    bodyLimit: 512 * 1024,
  });

  await app.register(cors, { origin: true });
  await app.register(metrics, { endpoint: '/metrics' });

  await app.register(healthRoutes, { prefix: config.base.urlPrefix });
  await app.register(createEmailsRoutes(container), { prefix: config.base.urlPrefix });

  return app;
}
