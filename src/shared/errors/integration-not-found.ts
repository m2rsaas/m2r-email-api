import { BaseError } from './base-error';

export class IntegrationNotFoundError extends BaseError {
  constructor(public readonly integrationId: string, public readonly scope: string) {
    super(`Integration ${integrationId} not found in scope ${scope}`, 'fatal');
  }
}
