import type { IAmqpConsumer } from '../shared/interfaces/amqp-consumer.js';
import type { EmailDispatchService } from '../services/email-dispatch-service.js';
import type { Logger } from '../lib/logger.js';
import { SendEmailPayloadSchema } from '../types.js';

/**
 * Inicia o consumer da fila de envio de email.
 *
 * Pipeline:
 *  1. `AmqpConsumer` ja faz JSON.parse antes de chamar o handler — recebemos
 *     `envelope: unknown` ja deserializado.
 *  2. Valida com `SendEmailPayloadSchema` (Zod). Se invalido, NACK para DLX.
 *  3. Enqueue persiste o job (QUEUED ou SCHEDULED).
 *  4. Se nao for agendado, dispatch imediatamente.
 *  5. Retorna `{ ack: true }` em sucesso ou `{ ack: false, requeue: false }`
 *     em falha (vai pra DLX configurada no `AMQP_DLX_EXCHANGE`).
 */
export async function startSendConsumer(
  consumer: IAmqpConsumer,
  dispatch: EmailDispatchService,
  logger: Logger,
): Promise<void> {
  await consumer.consume(async (envelope) => {
    const parsed = SendEmailPayloadSchema.safeParse(envelope);
    if (!parsed.success) {
      logger.error(
        { errors: parsed.error.flatten() },
        'Invalid payload schema, NACK to DLX',
      );
      return { ack: false, requeue: false };
    }

    try {
      const jobId = await dispatch.enqueue(parsed.data);
      // Se nao foi agendado (SCHEDULED), processa imediatamente.
      if (!parsed.data.scheduledAt) {
        await dispatch.dispatch(
          parsed.data.scope,
          parsed.data.tenantCode ?? null,
          jobId,
        );
      }
      return { ack: true };
    } catch (err) {
      logger.error(
        { err: (err as Error).message },
        'Dispatch failed; NACK to DLX',
      );
      return { ack: false, requeue: false };
    }
  });
}
