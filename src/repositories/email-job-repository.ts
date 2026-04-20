import type { Client } from 'cassandra-driver';
import type { EmailJob, JobStatus } from '../types.js';

export interface InsertJobInput {
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
  status: JobStatus;
  correlationId: string | null;
}

interface TablesInfo {
  keyspace: string;
  tableJobs: string;
  tableByStatus: string;
}

/**
 * Acesso aos dados de jobs de envio de email.
 *
 * - GPM: `gpm_m2rglobal.sys_email_jobs` + `gpm_m2rglobal.sys_email_jobs_by_status`
 * - TENANT: `ks_{tenantCode}.int_email_jobs` + `ks_{tenantCode}.int_email_jobs_by_status`
 *
 * A insercao e feita em batch para manter ambas as tabelas (principal + lookup)
 * consistentes. Para atualizacoes atomicas baseadas em estado atual, usa LWT
 * (`IF status = ?`) via `updateStatusIf`.
 */
export class EmailJobRepository {
  constructor(private readonly client: Client) {}

  async insert(input: InsertJobInput): Promise<void> {
    const { keyspace, tableJobs, tableByStatus } = this.tables(input.scope, input.tenantCode);
    const now = new Date();
    const fireAt = input.nextFireAt ?? now;

    const queries = [
      {
        // sys_email_jobs / int_email_jobs tem 18 colunas. Inserimos 17 explicitas
        // (deleted_at fica NULL = ativo). Campos inicializados:
        //   attempts = 0, sent_at = null, error = null.
        query: `INSERT INTO ${keyspace}.${tableJobs}
          (id, scope, tenant_code, template_id, data_json, subject_override,
           recipients_to, recipients_cc, recipients_bcc,
           scheduled_at, next_fire_at, attempts, status,
           correlation_id, sent_at, error, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?,null,null,?,?)`,
        params: [
          input.id,
          input.scope,
          input.tenantCode,
          input.templateId,
          input.dataJson,
          input.subjectOverride,
          input.recipientsTo,
          input.recipientsCc,
          input.recipientsBcc,
          input.scheduledAt,
          input.nextFireAt,
          input.status,
          input.correlationId,
          now,
          now,
        ],
      },
      {
        // Lookup denormalizada: alem de (status, next_fire_at, id) da PK, gravamos
        // template_id, correlation_id, attempts, created_at, updated_at para
        // permitir consumo direto pelo scheduler sem JOIN.
        query: `INSERT INTO ${keyspace}.${tableByStatus}
          (status, next_fire_at, id, template_id, correlation_id, attempts, created_at, updated_at)
          VALUES (?,?,?,?,?,0,?,?)`,
        params: [
          input.status,
          fireAt,
          input.id,
          input.templateId,
          input.correlationId,
          now,
          now,
        ],
      },
    ];

    await this.client.batch(queries, { prepare: true });
  }

  async findById(
    scope: 'GPM' | 'TENANT',
    tenantCode: string | null,
    id: string,
  ): Promise<EmailJob | null> {
    const { keyspace, tableJobs } = this.tables(scope, tenantCode);
    const result = await this.client.execute(
      `SELECT id, scope, tenant_code, template_id, data_json, subject_override,
              recipients_to, recipients_cc, recipients_bcc,
              scheduled_at, next_fire_at, attempts, status,
              correlation_id, sent_at, created_at, updated_at
         FROM ${keyspace}.${tableJobs} WHERE id = ?`,
      [id],
      { prepare: true },
    );
    const row = result.first();
    if (!row) return null;
    return this.rowToJob(row, scope);
  }

  /**
   * Atualiza status usando LWT (`IF status = ?`) para garantir transicao
   * atomica. Retorna `true` se a transicao foi aplicada, `false` se o status
   * esperado nao batia com o atual (ex: outro worker ja pegou o job).
   */
  async updateStatusIf(
    scope: 'GPM' | 'TENANT',
    tenantCode: string | null,
    id: string,
    expected: JobStatus,
    next: JobStatus,
    extras: Partial<{ nextFireAt: Date | null; attempts: number; sentAt: Date | null; error: string | null }> = {},
  ): Promise<boolean> {
    const { keyspace, tableJobs } = this.tables(scope, tenantCode);
    const setParts: string[] = ['status = ?', 'updated_at = ?'];
    const params: unknown[] = [next, new Date()];

    if (extras.nextFireAt !== undefined) {
      setParts.push('next_fire_at = ?');
      params.push(extras.nextFireAt);
    }
    if (extras.attempts !== undefined) {
      setParts.push('attempts = ?');
      params.push(extras.attempts);
    }
    if (extras.sentAt !== undefined) {
      setParts.push('sent_at = ?');
      params.push(extras.sentAt);
    }
    if (extras.error !== undefined) {
      setParts.push('error = ?');
      params.push(extras.error);
    }

    params.push(id, expected);

    const query = `UPDATE ${keyspace}.${tableJobs} SET ${setParts.join(', ')} WHERE id = ? IF status = ?`;
    const result = await this.client.execute(query, params, { prepare: true });
    const first = result.first() as Record<string, unknown> | null;
    return Boolean(first?.['[applied]']);
  }

  /**
   * Lista ids de jobs prontos para disparar (status em `statuses` e
   * `next_fire_at <= olderThan`), ordenados por `next_fire_at ASC` pelo CK
   * da tabela de lookup. Usa `LIMIT` e, se precisar varrer multiplos status,
   * para assim que atinge o limite combinado.
   */
  async listByStatus(
    scope: 'GPM' | 'TENANT',
    tenantCode: string | null,
    statuses: JobStatus[],
    olderThan: Date,
    limit: number,
  ): Promise<string[]> {
    const { keyspace, tableByStatus } = this.tables(scope, tenantCode);
    const ids: string[] = [];
    for (const status of statuses) {
      const remaining = limit - ids.length;
      if (remaining <= 0) break;
      const result = await this.client.execute(
        `SELECT id FROM ${keyspace}.${tableByStatus} WHERE status = ? AND next_fire_at <= ? LIMIT ?`,
        [status, olderThan, remaining],
        { prepare: true },
      );
      for (const row of result.rows) {
        ids.push(row.id.toString());
      }
    }
    return ids.slice(0, limit);
  }

  private tables(scope: 'GPM' | 'TENANT', tenantCode: string | null): TablesInfo {
    if (scope === 'GPM') {
      return {
        keyspace: 'gpm_m2rglobal',
        tableJobs: 'sys_email_jobs',
        tableByStatus: 'sys_email_jobs_by_status',
      };
    }
    if (!tenantCode) throw new Error('tenantCode required for TENANT scope');
    return {
      keyspace: `ks_${tenantCode}`,
      tableJobs: 'int_email_jobs',
      tableByStatus: 'int_email_jobs_by_status',
    };
  }

  private rowToJob(row: Record<string, any>, scope: 'GPM' | 'TENANT'): EmailJob {
    return {
      id: row.id.toString(),
      scope,
      tenantCode: row.tenant_code ?? null,
      templateId: row.template_id.toString(),
      dataJson: row.data_json ?? '{}',
      subjectOverride: row.subject_override ?? null,
      recipientsTo: row.recipients_to ? [...row.recipients_to] : [],
      recipientsCc: row.recipients_cc ? [...row.recipients_cc] : [],
      recipientsBcc: row.recipients_bcc ? [...row.recipients_bcc] : [],
      scheduledAt: row.scheduled_at ?? null,
      nextFireAt: row.next_fire_at ?? null,
      attempts: row.attempts ?? 0,
      status: row.status as JobStatus,
      correlationId: row.correlation_id ?? null,
      sentAt: row.sent_at ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
