import { types, type Client } from 'cassandra-driver';

export interface InsertLogInput {
  scope: 'GPM' | 'TENANT';
  tenantCode: string | null;
  emailJobId: string;
  attempt: number;
  status: string;
  smtpResponse: string | null;
  error: string | null;
}

export interface EmailJobLogEntry {
  attempt: number;
  status: string;
  createdAt: Date;
  smtpResponse: string | null;
  error: string | null;
}

/**
 * Acesso aos dados de logs de envio de email.
 *
 * - GPM: `gpm_m2rglobal.ntf_email_job_logs`
 * - TENANT: `ks_{tenantCode}.ntf_email_job_logs`
 *
 * PK: `email_job_id`, CK: `created_at DESC` — permite listar as tentativas
 * mais recentes primeiro para um job.
 */
export class EmailJobLogRepository {
  constructor(private readonly client: Client) {}

  async insert(input: InsertLogInput): Promise<void> {
    const keyspace = this.keyspaceFor(input.scope, input.tenantCode);
    const table = input.scope === 'GPM' ? 'ntf_email_job_logs' : 'ntf_email_job_logs';
    const now = new Date();
    const logId = types.Uuid.random();

    await this.client.execute(
      `INSERT INTO ${keyspace}.${table}
         (email_job_id, created_at, id, attempt, status, smtp_response, error, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      [
        input.emailJobId,
        now,
        logId,
        input.attempt,
        input.status,
        input.smtpResponse,
        input.error,
        now,
      ],
      { prepare: true },
    );
  }

  async listByJob(
    scope: 'GPM' | 'TENANT',
    tenantCode: string | null,
    emailJobId: string,
    limit = 50,
  ): Promise<EmailJobLogEntry[]> {
    const keyspace = this.keyspaceFor(scope, tenantCode);
    const table = scope === 'GPM' ? 'ntf_email_job_logs' : 'ntf_email_job_logs';
    const result = await this.client.execute(
      `SELECT attempt, status, created_at, smtp_response, error
         FROM ${keyspace}.${table} WHERE email_job_id = ? LIMIT ?`,
      [emailJobId, limit],
      { prepare: true },
    );
    return result.rows.map((row) => ({
      attempt: row.attempt,
      status: row.status,
      createdAt: row.created_at,
      smtpResponse: row.smtp_response ?? null,
      error: row.error ?? null,
    }));
  }

  private keyspaceFor(scope: 'GPM' | 'TENANT', tenantCode: string | null): string {
    if (scope === 'GPM') return 'gpm_m2rglobal';
    if (!tenantCode) throw new Error('tenantCode required for TENANT scope');
    return `ks_${tenantCode}`;
  }
}
