import { sendEmailPayloadSchema, type SendEmailPayload } from '@m2rsaas/contracts';

/**
 * Schema do payload AMQP consumido pelo `send-consumer`.
 *
 * Re-exportado do contrato canonico `@m2rsaas/contracts` para preservar os
 * imports existentes do consumer/services (`SendEmailPayloadSchema`).
 */
export const SendEmailPayloadSchema = sendEmailPayloadSchema;
export type { SendEmailPayload };

export type JobStatus = 'SCHEDULED' | 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' | 'RETRYING';

export interface EmailJob {
  id: string;
  dispatchId: string | null;
  scope: 'GPM' | 'TENANT';
  tenantCode: string | null;
  templateId: string;
  dataJson: string;
  subjectOverride: string | null;
  recipientsTo: string[];
  recipientsCc: string[];
  recipientsBcc: string[];
  scheduledAt: Date | null;
  nextFireAt: Date | null;
  attempts: number;
  status: JobStatus;
  correlationId: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmailJobLog {
  emailJobId: string;
  createdAt: Date;
  attempt: number;
  status: string;
  smtpResponse: string | null;
  error: string | null;
}
