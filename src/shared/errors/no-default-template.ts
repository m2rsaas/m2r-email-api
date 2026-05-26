import { BaseError } from './base-error.js';

/**
 * Lançado quando o m2r-gpm-backend responde 404 ao tentar resolver
 * o template default ativo para um par (type, channelType).
 *
 * Classificação 'fatal': configuração faltando no GPM, retry não ajuda.
 * Consumer deve descartar o job para a DLX e logar.
 */
export class NoDefaultTemplateError extends BaseError {
  constructor(
    public readonly type: string,
    public readonly channelType: string,
  ) {
    super(
      `Não há template padrão para tipo ${type} no canal ${channelType}`,
      'fatal',
    );
  }
}
