import { BaseError } from './base-error.js';

export class IntegrationInactiveError extends BaseError {
  constructor(public readonly integrationId: string, public readonly status: string) {
    super(`Integration ${integrationId} is not ACTIVE (status=${status})`, 'fatal');
  }
}
