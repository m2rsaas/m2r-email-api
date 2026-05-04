import type { FastifyPluginAsync } from 'fastify';
import type { Container } from '../container.js';
import { SendEmailPayloadSchema } from '../types.js';
import type { EmailDispatchService } from '../services/email-dispatch-service.js';
import type { EmailJobRepository } from '../repositories/email-job-repository.js';
import type { EmailJobLogRepository } from '../repositories/email-job-log-repository.js';

/**
 * Rotas HTTP de administracao de emails.
 *
 * Endpoints (prefixados por `URL_PREFIX`, default `/api/v1`):
 *  - POST /emails             — enfileira um envio (QUEUED ou SCHEDULED)
 *  - GET  /emails/:id         — detalhe do job + logs de tentativas
 *  - POST /emails/:id/resend  — promove FAILED -> QUEUED e dispara dispatch
 *
 * Auth: sem JWT nesta entrega — a porta so e exposta na rede interna do
 * Coolify. Auth via `EMAIL_ADMIN` scope fica como evolucao (ver spec).
 *
 * GET /emails (listar) omitido no MVP — requer paginacao por token do Scylla.
 */
export const createEmailsRoutes =
  (container: Container): FastifyPluginAsync =>
  async (app) => {
    const dispatch = container.resolve<EmailDispatchService>('dispatchService');
    const jobRepo = container.resolve<EmailJobRepository>('jobRepo');
    const logRepo = container.resolve<EmailJobLogRepository>('logRepo');

    app.post('/emails', async (req, reply) => {
      const parsed = SendEmailPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        reply
          .status(400)
          .send({ error: 'Invalid payload', details: parsed.error.flatten() });
        return;
      }
      const { dispatchId, jobIds } = await dispatch.enqueue(parsed.data);
      // Se nao e agendado, processa cada job imediatamente (mesmo pipeline
      // do consumer AMQP). Sem esse dispatch, jobs publicados via REST
      // ficariam eternamente em QUEUED, pois o evento `email.job.queued`
      // publicado pelo enqueue NAO casa com o binding do consumer
      // (`email.send.#`); ele e um evento informativo, nao um trigger de
      // processamento.
      if (!parsed.data.scheduledAt) {
        for (const jobId of jobIds) {
          try {
            await dispatch.dispatch(
              parsed.data.scope,
              parsed.data.tenantCode ?? null,
              jobId,
            );
          } catch (jobErr) {
            req.log.error(
              { jobId, err: (jobErr as Error).message },
              'Dispatch falhou para um job individual; demais continuam',
            );
          }
        }
      }
      reply.status(202).send({
        jobId: jobIds[0] ?? null,
        jobIds,
        dispatchId,
        status: parsed.data.scheduledAt ? 'SCHEDULED' : 'QUEUED',
      });
    });

    app.get<{
      Params: { id: string };
      Querystring: { scope: 'GPM' | 'TENANT'; tenantCode?: string };
    }>('/emails/:id', async (req, reply) => {
      const { id } = req.params;
      const { scope, tenantCode } = req.query;
      if (scope !== 'GPM' && scope !== 'TENANT') {
        reply.status(400).send({ error: 'scope must be GPM or TENANT' });
        return;
      }
      if (scope === 'TENANT' && !tenantCode) {
        reply.status(400).send({ error: 'tenantCode required for TENANT scope' });
        return;
      }
      const job = await jobRepo.findById(scope, tenantCode ?? null, id);
      if (!job) {
        reply.status(404).send({ error: 'Not found' });
        return;
      }
      const logs = await logRepo.listByJob(scope, tenantCode ?? null, id);
      reply.send({ job, logs });
    });

    app.post<{
      Params: { id: string };
      Querystring: { scope: 'GPM' | 'TENANT'; tenantCode?: string };
    }>('/emails/:id/resend', async (req, reply) => {
      const { id } = req.params;
      const { scope, tenantCode } = req.query;
      if (scope !== 'GPM' && scope !== 'TENANT') {
        reply.status(400).send({ error: 'scope must be GPM or TENANT' });
        return;
      }
      if (scope === 'TENANT' && !tenantCode) {
        reply.status(400).send({ error: 'tenantCode required for TENANT scope' });
        return;
      }
      const promoted = await jobRepo.updateStatusIf(
        scope,
        tenantCode ?? null,
        id,
        'FAILED',
        'QUEUED',
        { nextFireAt: new Date(), attempts: 0 },
      );
      if (!promoted) {
        reply.status(409).send({ error: 'Job not in FAILED state' });
        return;
      }
      await dispatch.dispatch(scope, tenantCode ?? null, id);
      reply.send({ jobId: id, status: 'QUEUED' });
    });
  };
