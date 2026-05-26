import type { Client } from 'cassandra-driver';

export interface SendTemplateRow {
  id: string;
  scope: 'GPM' | 'TENANT';
  channelType: string;
  /** Categoria/slug do template (ex: WELCOME, PASSWORD_RECOVERY). */
  type: string;
  /** Nome descritivo do template (usado para auditoria e logs). */
  name: string;
  subject: string;
  body: string;
  variables: string[];
  status: string;
  /** FK logica -> integration row (tabela do mesmo keyspace ou GPM). `null` = resolver em runtime. */
  integrationId: string | null;
}

/**
 * Acesso aos dados de templates de envio globais (GPM) e por tenant.
 *
 * - GPM: `gpm_m2rglobal.ntf_send_templates` (PK id)
 * - TENANT: `ks_{tenantCode}.ntf_send_templates` (PK id)
 */
export class SendTemplateRepository {
  constructor(private readonly client: Client) {}

  async findById(
    scope: 'GPM' | 'TENANT',
    tenantCode: string | null,
    templateId: string,
  ): Promise<SendTemplateRow | null> {
    const keyspace = this.keyspaceFor(scope, tenantCode);
    const table = scope === 'GPM' ? 'ntf_send_templates' : 'ntf_send_templates';
    const query = `SELECT id, channel_type, type, name, subject, body, variables, status, integration_id FROM ${keyspace}.${table} WHERE id = ?`;
    const result = await this.client.execute(query, [templateId], { prepare: true });
    const row = result.first();
    if (!row) return null;
    return {
      id: row.id.toString(),
      scope,
      channelType: row.channel_type,
      type: row.type,
      name: row.name ?? '',
      subject: row.subject ?? '',
      body: row.body ?? '',
      variables: row.variables ? [...row.variables] : [],
      status: row.status,
      integrationId: row.integration_id ? row.integration_id.toString() : null,
    };
  }

  private keyspaceFor(scope: 'GPM' | 'TENANT', tenantCode: string | null): string {
    if (scope === 'GPM') return 'gpm_m2rglobal';
    if (!tenantCode) throw new Error('tenantCode required for TENANT scope');
    return `ks_${tenantCode}`;
  }
}
