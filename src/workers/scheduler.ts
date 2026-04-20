import type { EmailJobRepository } from '../repositories/email-job-repository.js';
import type { EmailDispatchService } from '../services/email-dispatch-service.js';
import type { Logger } from '../lib/logger.js';

export interface SchedulerOptions {
  tickSeconds: number;
  batch: number;
}

/**
 * Scheduler de polling que promove jobs prontos para execucao.
 *
 * A cada tick (`tickSeconds`):
 *  1. Lista jobs com `status IN ('SCHEDULED','RETRYING')` e
 *     `next_fire_at <= now`, limitado a `batch`.
 *  2. Promove cada um via LWT: SCHEDULED->QUEUED ou RETRYING->QUEUED.
 *  3. Se a transicao foi aplicada, dispara `dispatch` em paralelo
 *     (cada dispatch re-adquire o lock QUEUED->SENDING, entao colisao
 *     entre tick e consumer AMQP e segura).
 *
 * Nota sobre escopo:
 *  - Apenas escopo **GPM** no MVP. Escopo TENANT exigiria varrer N keyspaces
 *    (um por tenant) — o que requer uma lista de tenants ativos em
 *    `gpm_m2rglobal.gpm_tenants`. Fica para v2 (ver plano §13 YAGNI).
 *    No MVP, jobs TENANT agendados podem ser republicados via AMQP pelo
 *    caller no horario planejado, ou processados quando outro evento
 *    dispara o consumer.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private readonly jobRepo: EmailJobRepository,
    private readonly dispatch: EmailDispatchService,
    private readonly logger: Logger,
    private readonly options: SchedulerOptions,
  ) {}

  start(): void {
    if (this.timer) return;
    this.logger.info(
      { tickSeconds: this.options.tickSeconds, batch: this.options.batch },
      'Scheduler started',
    );
    this.timer = setInterval(
      () =>
        this.tick().catch((err) =>
          this.logger.error(
            { err: (err as Error).message },
            'Scheduler tick failed',
          ),
        ),
      this.options.tickSeconds * 1000,
    );
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    while (this.running) {
      await new Promise((r) => setTimeout(r, 100));
    }
    this.logger.info('Scheduler stopped');
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      // Escopo GPM
      const gpmIds = await this.jobRepo.listByStatus(
        'GPM',
        null,
        ['SCHEDULED', 'RETRYING'],
        new Date(),
        this.options.batch,
      );
      for (const id of gpmIds) {
        const promoted =
          (await this.jobRepo.updateStatusIf('GPM', null, id, 'SCHEDULED', 'QUEUED')) ||
          (await this.jobRepo.updateStatusIf('GPM', null, id, 'RETRYING', 'QUEUED'));
        if (promoted) {
          this.dispatch.dispatch('GPM', null, id).catch((err) =>
            this.logger.error(
              { id, err: (err as Error).message },
              'Dispatch failed',
            ),
          );
        }
      }
      // Escopo TENANT — fora do MVP (v2). Ver JSDoc da classe.
    } finally {
      this.running = false;
    }
  }
}
