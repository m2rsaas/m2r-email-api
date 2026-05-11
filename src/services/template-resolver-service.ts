import type { Logger } from '../lib/logger.js';
import { NoDefaultTemplateError } from '../shared/errors/index.js';

export interface TemplateResolverDeps {
  gpmBackendUrl: string;
  internalApiKey: string;
  fetchImpl?: typeof fetch;
  logger: Logger;
}

export interface ResolveParams {
  scope: 'GPM' | 'TENANT';
  tenantCode?: string;
  templateId?: string | null;
  type?: string;
  channelType: string;
}

export interface ResolveResult {
  templateId: string;
}

/**
 * Resolve `templateId` a partir de `{type, channelType}` consultando
 * o gpm-backend. Usado pelo EmailDispatchService.enqueue ao receber
 * payloads AMQP sem `templateId` direto.
 *
 * - scope=GPM + templateId → retorna direto (caminho legado / sandbox).
 * - scope=GPM + type+channel → GET gpm-backend /templates/defaults/:type/:channel.
 * - scope=TENANT → não suportado nesta fase (lança Error).
 *
 * Erros possíveis:
 * - NoDefaultTemplateError: gpm-backend devolveu 404 (config faltando).
 * - Error genérico: outros HTTPs (5xx, network).
 */
export class TemplateResolverService {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly deps: TemplateResolverDeps) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  async resolve(params: ResolveParams): Promise<ResolveResult> {
    if (params.templateId) {
      return { templateId: params.templateId };
    }

    if (!params.type) {
      throw new Error('templateId ou type é obrigatório no payload');
    }

    if (params.scope === 'TENANT') {
      throw new Error(
        'Resolução por type para scope=TENANT não suportado nesta fase',
      );
    }

    const url = `${this.deps.gpmBackendUrl}/api/v1/templates/defaults/${encodeURIComponent(
      params.type,
    )}/${encodeURIComponent(params.channelType)}`;

    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        'x-api-key': this.deps.internalApiKey,
        Accept: 'application/json',
      },
    });

    if (response.status === 404) {
      throw new NoDefaultTemplateError(params.type, params.channelType);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.deps.logger.error(
        {
          status: response.status,
          body,
          type: params.type,
          channelType: params.channelType,
        },
        'gpm-backend retornou erro ao resolver template default',
      );
      throw new Error(`Falha ao resolver template default (HTTP ${response.status})`);
    }

    const payload = (await response.json()) as {
      success?: boolean;
      data?: { id?: string };
    };
    const id = payload.data?.id;
    if (!id) {
      throw new NoDefaultTemplateError(params.type, params.channelType);
    }
    return { templateId: id };
  }
}
