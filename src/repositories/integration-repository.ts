import type { Client } from 'cassandra-driver';

export interface IntegrationRow {
  id: string;
  scope: 'GPM' | 'TENANT';
  type: string;
  provider: string;
  /** JSON criptografado (string). Campos sensiveis sao cifrados por `@m2rsaas/crypto`. */
  config: string;
  status: string;
  /**
   * Lista de campos dentro do `config` JSON que estao cifrados (ex: ['password', 'api_key']).
   * Runtime usa essa lista para saber quais decrypt/encrypt aplicar.
   */
  encryptedFields: string[];
  /**
   * Versao da chave `M2R_CRYPTO_KEY` usada para cifrar os campos sensiveis.
   * `null` quando nunca houve cifragem (ex: integracoes 100% publicas).
   */
  keyVersion: number | null;
}

/**
 * Acesso aos dados de integracoes globais (GPM) e por tenant.
 *
 * - GPM: `gpm_m2rglobal.int_integrations`
 * - TENANT: `ks_{tenantCode}.int_integrations`
 */
export class IntegrationRepository {
  constructor(private readonly client: Client) {}

  async findById(
    scope: 'GPM' | 'TENANT',
    tenantCode: string | null,
    integrationId: string,
  ): Promise<IntegrationRow | null> {
    const keyspace = this.keyspaceFor(scope, tenantCode);
    const table = scope === 'GPM' ? 'int_integrations' : 'int_integrations';
    const query = `SELECT id, type, provider, config, status, encrypted_fields, key_version FROM ${keyspace}.${table} WHERE id = ?`;
    const result = await this.client.execute(query, [integrationId], { prepare: true });
    const row = result.first();
    if (!row) return null;
    return {
      id: row.id.toString(),
      scope,
      type: row.type,
      provider: row.provider,
      config: row.config,
      status: row.status,
      encryptedFields: Array.isArray(row.encrypted_fields) ? [...row.encrypted_fields] : [],
      keyVersion: row.key_version ?? null,
    };
  }

  private keyspaceFor(scope: 'GPM' | 'TENANT', tenantCode: string | null): string {
    if (scope === 'GPM') return 'gpm_m2rglobal';
    if (!tenantCode) throw new Error('tenantCode required for TENANT scope');
    return `ks_${tenantCode}`;
  }
}
