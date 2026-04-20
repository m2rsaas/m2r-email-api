import { BaseError } from './base-error.js';

export class SendSoftFailError extends BaseError {
  constructor(
    public readonly provider: string,
    public readonly reason: string,
    public readonly responseCode?: string | number,
  ) {
    super(`Soft fail from ${provider}: ${reason}`, 'soft');
  }
}
