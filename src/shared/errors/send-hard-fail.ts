import { BaseError } from './base-error';

export class SendHardFailError extends BaseError {
  constructor(
    public readonly provider: string,
    public readonly reason: string,
    public readonly responseCode?: string | number,
  ) {
    super(`Hard fail from ${provider}: ${reason}`, 'hard');
  }
}
