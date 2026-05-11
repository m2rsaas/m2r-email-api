import type { IAmqpConsumer } from '../shared/interfaces/amqp-consumer.js';
import type { EmailDispatchService } from '../services/email-dispatch-service.js';
import type { Logger } from '../lib/logger.js';
import { SendEmailPayloadSchema } from '../types.js';
import { NoDefaultTemplateError } from '../shared/errors/index.js';

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
      const { jobIds } = await dispatch.enqueue(parsed.data);
      // Se nao foi agendado (SCHEDULED), processa cada job (1 por destinatario)
      // imediatamente. Falha em um nao impede os demais de continuarem.
      if (!parsed.data.scheduledAt) {
        for (const jobId of jobIds) {
          try {
            await dispatch.dispatch(
              parsed.data.scope,
              parsed.data.tenantCode ?? null,
              jobId,
            );
          } catch (jobErr) {
            logger.error(
              { jobId, err: (jobErr as Error).message },
              'Dispatch falhou para um job individual; demais continuam',
            );
          }
        }
      }
      return { ack: true };
    } catch (err) {
      if (err instanceof NoDefaultTemplateError) {
        logger.warn(
          {
            type: err.type,
            channelType: err.channelType,
            correlationId: parsed.data.correlationId,
          },
          'NO_DEFAULT_TEMPLATE — job descartado para DLX',
        );
        return { ack: false, requeue: false };
      }
      logger.error(
        { err: (err as Error).message },
        'Dispatch failed; NACK to DLX',
      );
      return { ack: false, requeue: false };
    }
  });
}
