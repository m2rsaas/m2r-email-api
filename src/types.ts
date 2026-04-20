import { z } from 'zod';

export const SendEmailPayloadSchema = z.object({
  scope: z.enum(['GPM', 'TENANT']),
  tenantCode: z.string().optional(),
  templateId: z.string().uuid(),
  data: z.record(z.unknown()).default({}),
  subjectOverride: z.string().nullable().optional(),
  to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).optional().default([]),
  bcc: z.array(z.string().email()).optional().default([]),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
  correlationId: z.string().optional(),
}).refine(
  (d) => d.scope === 'GPM' || !!d.tenantCode,
  { message: 'tenantCode required when scope=TENANT', path: ['tenantCode'] },
);

export type SendEmailPayload = z.infer<typeof SendEmailPayloadSchema>;

export type JobStatus = 'SCHEDULED' | 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' | 'RETRYING';

export interface EmailJob {
  id: string;
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
