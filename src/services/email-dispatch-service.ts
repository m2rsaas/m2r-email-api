import { randomUUID } from 'crypto';
import type { Logger } from '../lib/logger.js';
import type { EmailJobRepository } from '../repositories/email-job-repository.js';
import type { EmailJobLogRepository } from '../repositories/email-job-log-repository.js';
import type { SendTemplateRepository } from '../repositories/send-template-repository.js';
import type { IntegrationResolverService } from './integration-resolver-service.js';
import type { TemplateRenderService } from './template-render-service.js';
import type { SenderFactory } from './senders/sender-factory.js';
import type { RetryPolicy } from './retry-policy.js';
import type { IAmqpPublisher } from '../shared/interfaces/amqp-publisher.js';
import type { SendEmailPayload } from '../types.js';
import {
  TemplateNotFoundError,
  TemplateInactiveError,
} from '../shared/errors/index.js';

export interface DispatchDeps {
  jobRepo: EmailJobRepository;
  logRepo: EmailJobLogRepository;
  templateRepo: SendTemplateRepository;
  integrationResolver: IntegrationResolverService;
  renderService: TemplateRenderService;
  senderFactory: SenderFactory;
  retryPolicy: RetryPolicy;
  publisher: IAmqpPublisher;
  logger: Logger;
  defaultTimeoutMs: number;
}

/**
 * Orquestrador de envio de email.
 *
 * Responsabilidades:
 *  - `enqueue`: persiste job (QUEUED ou SCHEDULED) e publica evento `email.job.queued`.
 *  - `dispatch`: processa job QUEUED com lock via LWT, resolve template+integracao,
 *    renderiza, escolhe sender, envia, grava log em `*_email_job_logs` e atualiza
 *    status para SENT/RETRYING/FAILED. Publica eventos `email.job.sent` ou
 *    `email.job.failed`.
 *
 * Maquina de estados:
 *   SCHEDULED -> QUEUED (scheduler quando chega `next_fire_at`)
 *   QUEUED -> SENDING (LWT `IF status = 'QUEUED'`)
 *   SENDING -> SENT (sucesso)
 *   SENDING -> RETRYING (falha soft + attempts < max)
 *   SENDING -> FAILED (falha hard/fatal ou attempts esgotados)
 *   RETRYING -> QUEUED (scheduler re-enqueue quando chega `next_fire_at`)
 */
export class EmailDispatchService {
  constructor(private readonly deps: DispatchDeps) {}

  /**
   * Enqueue: persiste 1 job por destinatario (todos com o mesmo dispatchId)
   * e decide QUEUED vs SCHEDULED para cada um. Retorna o dispatchId mais a
   * lista de jobIds criados.
   *
   * Cada item de payload.to / .cc / .bcc vira um job independente com
   * recipients_to/cc/bcc = [unico endereco]. Falha de SMTP em um destinatario
   * nao afeta os demais; cada um tem retry isolado.
   */
  async enqueue(payload: SendEmailPayload): Promise<{ dispatchId: string; jobIds: string[] }> {
    const dispatchId = randomUUID();
    const now = new Date();
    const scheduledAt = payload.scheduledAt ? new Date(payload.scheduledAt) : null;
    const isScheduled = scheduledAt !== null && scheduledAt.getTime() > now.getTime();
    const status = isScheduled ? 'SCHEDULED' : 'QUEUED';
    const nextFireAt = isScheduled ? scheduledAt : now;

    const recipients: Array<{ address: string; kind: 'TO' | 'CC' | 'BCC' }> = [
      ...payload.to.map((address) => ({ address, kind: 'TO' as const })),
      ...(payload.cc ?? []).map((address) => ({ address, kind: 'CC' as const })),
      ...(payload.bcc ?? []).map((address) => ({ address, kind: 'BCC' as const })),
    ];

    if (recipients.length === 0) {
      throw new Error('SendEmailPayload sem destinatarios (to/cc/bcc vazios)');
    }

    const jobIds: string[] = [];
    for (const recipient of recipients) {
      const jobId = randomUUID();
      await this.deps.jobRepo.insert({
        id: jobId,
        dispatchId,
        scope: payload.scope,
        tenantCode: payload.tenantCode ?? null,
        templateId: payload.templateId,
        dataJson: JSON.stringify(payload.data ?? {}),
        subjectOverride: payload.subjectOverride ?? null,
        recipientsTo: recipient.kind === 'TO' ? [recipient.address] : [],
        recipientsCc: recipient.kind === 'CC' ? [recipient.address] : [],
        recipientsBcc: recipient.kind === 'BCC' ? [recipient.address] : [],
        scheduledAt,
        nextFireAt,
        status,
        correlationId: payload.correlationId ?? null,
      });
      jobIds.push(jobId);

      if (!isScheduled) {
        await this.publishJobEvent('email.job.queued', jobId, {
          scope: payload.scope,
          tenantCode: payload.tenantCode ?? null,
          templateId: payload.templateId,
          dispatchId,
        });
      }
    }

    return { dispatchId, jobIds };
  }

  /**
   * Processa um job QUEUED: lock via LWT, resolve template+integracao, renderiza,
   * escolhe sender, envia, grava log e atualiza status.
   */
  async dispatch(
    scope: 'GPM' | 'TENANT',
    tenantCode: string | null,
    jobId: string,
  ): Promise<void> {
    const lockAcquired = await this.deps.jobRepo.updateStatusIf(
      scope,
      tenantCode,
      jobId,
      'QUEUED',
      'SENDING',
    );
    if (!lockAcquired) {
      this.deps.logger.warn(
        { jobId, scope },
        'Could not acquire lock (already processing)',
      );
      return;
    }

    const job = await this.deps.jobRepo.findById(scope, tenantCode, jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    const attempt = job.attempts + 1;

    try {
      const template = await this.deps.templateRepo.findById(
        scope,
        tenantCode,
        job.templateId,
      );
      if (!template) {
        throw new TemplateNotFoundError(job.templateId, scope);
      }
      if (template.status !== 'ACTIVE') {
        throw new TemplateInactiveError(job.templateId, template.status);
      }
      if (!template.integrationId) {
        throw new TemplateInactiveError(job.templateId, 'missing integration_id');
      }

      const integration = await this.deps.integrationResolver.resolve(
        scope,
        tenantCode,
        template.integrationId,
      );
      const data = JSON.parse(job.dataJson);
      const rendered = this.deps.renderService.render(
        { subject: job.subjectOverride ?? template.subject, body: template.body },
        data,
      );

      const sender = this.deps.senderFactory.pick(integration.provider);
      const result = await sender.send(
        {
          to: job.recipientsTo,
          cc: job.recipientsCc,
          bcc: job.recipientsBcc,
          subject: rendered.subject,
          body: rendered.body,
          timeoutMs: this.deps.defaultTimeoutMs,
        },
        integration.config,
      );

      const logStatus = result.success
        ? 'SENT'
        : result.classification === 'soft'
          ? 'RETRYING'
          : 'FAILED';

      await this.deps.logRepo.insert({
        scope,
        tenantCode,
        emailJobId: jobId,
        attempt,
        status: logStatus,
        smtpResponse: result.responseCode?.toString() ?? null,
        error: result.error ?? null,
      });

      if (result.success) {
        await this.deps.jobRepo.updateStatusIf(
          scope,
          tenantCode,
          jobId,
          'SENDING',
          'SENT',
          { sentAt: new Date(), attempts: attempt },
        );
        await this.publishJobEvent('email.job.sent', jobId, {
          scope,
          tenantCode,
          templateId: job.templateId,
        });
        return;
      }

      if (this.deps.retryPolicy.shouldRetry(result.classification ?? 'soft', attempt)) {
        const nextFireAt = this.deps.retryPolicy.nextFireAt(attempt);
        await this.deps.jobRepo.updateStatusIf(
          scope,
          tenantCode,
          jobId,
          'SENDING',
          'RETRYING',
          { attempts: attempt, nextFireAt },
        );
        return;
      }

      await this.deps.jobRepo.updateStatusIf(
        scope,
        tenantCode,
        jobId,
        'SENDING',
        'FAILED',
        { attempts: attempt },
      );
      await this.publishJobEvent('email.job.failed', jobId, {
        scope,
        tenantCode,
        templateId: job.templateId,
        errorMessage: result.error ?? null,
      });
    } catch (err) {
      const message = (err as Error).message;
      await this.deps.logRepo.insert({
        scope,
        tenantCode,
        emailJobId: jobId,
        attempt,
        status: 'FAILED',
        smtpResponse: null,
        error: message,
      });
      await this.deps.jobRepo.updateStatusIf(
        scope,
        tenantCode,
        jobId,
        'SENDING',
        'FAILED',
        { attempts: attempt },
      );
      await this.publishJobEvent('email.job.failed', jobId, {
        scope,
        tenantCode,
        errorMessage: message,
      });
    }
  }

  private async publishJobEvent(
    routingKey: string,
    jobId: string,
    extra: Record<string, unknown>,
  ): Promise<void> {
    await this.deps.publisher.publish(routingKey, {
      jobId,
      ...extra,
      timestamp: new Date().toISOString(),
    });
  }
}
