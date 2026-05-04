import type { Client } from 'cassandra-driver';
import type { EmailJob, JobStatus } from '../types.js';

export interface InsertJobInput {
  id: string;
  dispatchId: string;
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
  tableByDispatch: string;
}

/**
 * Acesso aos dados de jobs de envio de email.
 *
 * - GPM: `gpm_m2rglobal.sys_email_jobs` (+ `_by_status`, `_by_dispatch`)
 * - TENANT: `ks_{tenantCode}.int_email_jobs` (+ `_by_status`, `_by_dispatch`)
 *
 * A insercao escreve em 3 tabelas em batch para manter principal + lookups
 * consistentes. Para atualizacoes atomicas baseadas em estado atual, usa LWT
 * (`IF status = ?`) via `updateStatusIf`.
 */
export class EmailJobRepository {
  constructor(private readonly client: Client) {}

  async insert(input: InsertJobInput): Promise<void> {
    const { keyspace, tableJobs, tableByStatus, tableByDispatch } = this.tables(
      input.scope,
      input.tenantCode,
    );
    const now = new Date();
    const fireAt = input.nextFireAt ?? now;
    const recipient = pickSingleRecipient(input);

    const queries = [
      {
        // sys_email_jobs / int_email_jobs com dispatch_id (introduzido pela
        // migration 049/INT-014). attempts inicia em 0; sent_at/error nulos.
        query: `INSERT INTO ${keyspace}.${tableJobs}
          (id, dispatch_id, scope, tenant_code, template_id, data_json, subject_override,
           recipients_to, recipients_cc, recipients_bcc,
           scheduled_at, next_fire_at, attempts, status,
           correlation_id, sent_at, error, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,null,null,?,?)`,
        params: [
          input.id,
          input.dispatchId,
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
        // Lookup denormalizada por status (scheduler).
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
      {
        // Lookup denormalizada por dispatch (painel admin: agrupar N jobs do
        // mesmo envio). Status inicial; nao e atualizado em updateStatusIf —
        // o painel resolve via JOIN logico em sys_email_jobs.
        query: `INSERT INTO ${keyspace}.${tableByDispatch}
          (dispatch_id, id, recipient, recipient_kind, status, template_id, correlation_id, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?)`,
        params: [
          input.dispatchId,
          input.id,
          recipient.address,
          recipient.kind,
          input.status,
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
      `SELECT id, dispatch_id, scope, tenant_code, template_id, data_json, subject_override,
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
   * da tabela de lookup.
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
        tableByDispatch: 'sys_email_jobs_by_dispatch',
      };
    }
    if (!tenantCode) throw new Error('tenantCode required for TENANT scope');
    return {
      keyspace: `ks_${tenantCode}`,
      tableJobs: 'int_email_jobs',
      tableByStatus: 'int_email_jobs_by_status',
      tableByDispatch: 'int_email_jobs_by_dispatch',
    };
  }

  private rowToJob(row: Record<string, any>, scope: 'GPM' | 'TENANT'): EmailJob {
    return {
      id: row.id.toString(),
      dispatchId: row.dispatch_id ? row.dispatch_id.toString() : null,
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

/**
 * Apos a explosao em N jobs no enqueue, cada job tem exatamente 1 endereco
 * em uma das listas. Esta funcao recupera esse endereco para denormalizar
 * em sys_email_jobs_by_dispatch.
 */
function pickSingleRecipient(input: InsertJobInput): {
  address: string;
  kind: 'TO' | 'CC' | 'BCC';
} {
  if (input.recipientsTo.length > 0) {
    return { address: input.recipientsTo[0], kind: 'TO' };
  }
  if (input.recipientsCc.length > 0) {
    return { address: input.recipientsCc[0], kind: 'CC' };
  }
  if (input.recipientsBcc.length > 0) {
    return { address: input.recipientsBcc[0], kind: 'BCC' };
  }
  throw new Error('Email job insert without any recipient');
}
