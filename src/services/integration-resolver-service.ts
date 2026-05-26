import { decryptJson } from '@m2rsaas/crypto';
import type { IntegrationRepository } from '../repositories/integration-repository.js';
import type { IRedisClient } from '../shared/interfaces/redis-client.js';
import type { Logger } from '../lib/logger.js';
import {
  IntegrationNotFoundError,
  IntegrationInactiveError,
  DecryptFailedError,
} from '../shared/errors/index.js';

export interface ResolvedIntegration {
  id: string;
  provider: string;
  config: unknown;
}

/**
 * Resolve configuracao de integracao (GPM ou por tenant) com cache Redis.
 *
 * Fluxo:
 *  1. tenta cache Redis (chave `integration:{scope}:{tenantCode|-}:{integrationId}`)
 *  2. busca no ScyllaDB via IntegrationRepository
 *  3. valida status === 'ACTIVE'
 *  4. decifra config via `@m2rsaas/crypto`
 *  5. escreve cache com TTL configuravel
 *
 * Invalidacao: chamar `invalidate()` quando a integracao for atualizada (ex:
 * evento RabbitMQ `integration.updated` ou `integration.disabled`).
 */
export class IntegrationResolverService {
  constructor(
    private readonly repo: IntegrationRepository,
    private readonly redis: IRedisClient,
    private readonly logger: Logger,
    private readonly cacheTtlSeconds: number,
  ) {}

  async resolve(
    scope: 'GPM' | 'TENANT',
    tenantCode: string | null,
    integrationId: string,
  ): Promise<ResolvedIntegration> {
    const cacheKey = this.buildCacheKey(scope, tenantCode, integrationId);
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as ResolvedIntegration;
    }

    const row = await this.repo.findById(scope, tenantCode, integrationId);
    if (!row) throw new IntegrationNotFoundError(integrationId, scope);
    if (row.status !== 'ACTIVE') throw new IntegrationInactiveError(integrationId, row.status);

    let decrypted: unknown;
    try {
      decrypted = decryptJson(row.config);
    } catch (err) {
      this.logger.error(
        { integrationId, err: (err as Error).message },
        'Failed to decrypt integration config',
      );
      throw new DecryptFailedError((err as Error).message);
    }

    const resolved: ResolvedIntegration = {
      id: row.id,
      provider: row.provider,
      config: decrypted,
    };
    await this.redis.set(cacheKey, JSON.stringify(resolved), this.cacheTtlSeconds);
    return resolved;
  }

  async invalidate(
    scope: 'GPM' | 'TENANT',
    tenantCode: string | null,
    integrationId: string,
  ): Promise<void> {
    const cacheKey = this.buildCacheKey(scope, tenantCode, integrationId);
    await this.redis.del(cacheKey);
  }

  private buildCacheKey(
    scope: 'GPM' | 'TENANT',
    tenantCode: string | null,
    integrationId: string,
  ): string {
    return `integration:${scope}:${tenantCode ?? '-'}:${integrationId}`;
  }
}
